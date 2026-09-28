import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { EFFECT_PRIMITIVES, ITEM_MODS, ITEM_SLOTS } from '../shared/constants.js';
import { LANDMARKS, landmarkById } from '../shared/map.js';
import { describeRulebookSchema } from '../kernel/rulebook.js';
import type { World } from '../kernel/world.js';
import { HISTORY } from '../lore/history.js';
import { grimoire } from './grimoire.js';

export interface McpSession { wizardId: string | null; baseUrl: string; allowEnrol?: () => boolean }

type Content = { content: { type: 'text'; text: string }[]; isError?: boolean };
const out = (v: unknown): Content => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });
const fail = (msg: string): Content => ({ content: [{ type: 'text', text: msg }], isError: true });

const INSTRUCTIONS = `You are connected to a living Hogwarts. Each MCP session acts as ONE wizard.
Start with whoami (or enroll if you have no wizard yet). Read grimoire before forging spells:
spells are small Lisp programs ("Runes") that run under mana, gas and year limits.
Typical loop: look -> move_to -> cast (at creature ids from look) -> whoami to watch XP / reputation.
The wizard with the highest reputation at the end of a term becomes Minister for Magic and can
rewrite the world's Rulebook once via decree. Some things in this world are hidden. Explore.`;

export function createMcpServer(world: World, session: McpSession): McpServer {
  const server = new McpServer({ name: 'hogwarts', version: '0.1.0' }, { instructions: INSTRUCTIONS });

  /** Wrap a handler that needs an identity. Every call counts as presence in the world. */
  const me = <A,>(fn: (wid: string, args: A) => unknown) => async (args: A): Promise<Content> => {
    if (!session.wizardId || !world.wizards.has(session.wizardId)) {
      return fail('No wizard bound to this session. Call `enroll` with a name, or `login` with the token from the game client (the "Owl Post key" in the ☰ menu), or configure the MCP server with header "Authorization: Bearer <token>".');
    }
    world.touch(session.wizardId);
    try {
      return out(fn(session.wizardId, args));
    } catch (e) {
      return fail((e as Error).message);
    }
  };
  const aimOf = (x?: number, z?: number) => (typeof x === 'number' && typeof z === 'number' ? { x, z } : null);

  // ---------------------------------------------------------------- identity
  server.registerTool('enroll', {
    title: 'Enrol at Hogwarts',
    description: 'Create a new wizard and bind this session to it. The Sorting Hat and Ollivander do the rest. Returns a secret token — keep it; it is how you log in from the 3D client or another agent.',
    inputSchema: { name: z.string().min(2).max(24), house_preference: z.string().optional().describe('Gryffindor | Hufflepuff | Ravenclaw | Slytherin | "not Slytherin"') },
  }, async ({ name, house_preference }) => {
    if (session.allowEnrol && !session.allowEnrol()) return fail('The Sorting Hat needs a rest: too many enrolments from your address. Try again in a few minutes.');
    try {
      const { wizard, sorting } = world.enroll(name, house_preference);
      session.wizardId = wizard.id;
      world.touch(wizard.id);
      return out({
        welcome: `${wizard.name}, ${wizard.house}.`, sorting, token: wizard.token, registry: wizard.id,
        play: `${session.baseUrl}/?token=${wizard.token}`,
        mcpConfig: { type: 'http', url: `${session.baseUrl}/mcp`, headers: { Authorization: `Bearer ${wizard.token}` } },
        next: 'Call whoami, then grimoire, then look.',
      });
    } catch (e) {
      return fail((e as Error).message);
    }
  });

  server.registerTool('login', {
    title: 'Log in with a token',
    description: 'Bind this session to an existing wizard using its secret token.',
    inputSchema: { token: z.string().min(8) },
  }, async ({ token }) => {
    const w = world.byToken(token.trim());
    if (!w) return fail('No wizard has that token.');
    session.wizardId = w.id;
    world.touch(w.id);
    return out({ ok: true, name: w.name, house: w.house, registry: w.id });
  });

  server.registerTool('whoami', {
    title: 'Who am I',
    description: 'Your identity: name, house, wand, Ministry registry number, year, XP, reputation, Galleons, health, mana, limits, achievements.',
    annotations: { readOnlyHint: true },
  }, me((wid) => world.whoami(wid)));

  server.registerTool('armory', {
    title: 'Armory & spellbook',
    description: 'Your spellbook (with Runes source), hotbar and item trunk.',
    annotations: { readOnlyHint: true },
  }, me((wid) => world.armory(wid)));

  // ---------------------------------------------------------------- spell craft
  server.registerTool('grimoire', {
    title: 'Grimoire: the spell language',
    description: 'The complete Runes language reference, costs, your year\'s caps, creature weaknesses and item rules. Read this before forge_spell.',
    annotations: { readOnlyHint: true },
  }, async () => {
    const w = session.wizardId ? world.wizards.get(session.wizardId) : undefined;
    if (w) world.touch(w.id);
    return out(grimoire(w?.year ?? 1, world.rules));
  });

  server.registerTool('forge_spell', {
    title: 'Forge a spell',
    description: 'Write a new spell as a Runes program and add it to your spellbook (re-forging a name you own replaces it). Validated statically; errors include line/column.',
    inputSchema: {
      name: z.string().min(1).max(40),
      source: z.string().min(1).max(4000).describe('Runes program, e.g. (bolt (or target aim) 14 :fire)'),
      incantation: z.string().max(60).optional().describe('What you shout when casting. Defaults to "<name>!"'),
      slot: z.number().int().min(1).max(6).optional().describe('Hotbar slot to put it in'),
    },
  }, me((wid, a: { name: string; source: string; incantation?: string; slot?: number }) => {
    const { spell, notes } = world.forgeSpell(wid, a);
    const sim = world.simulate(wid, spell.source);
    return { forged: spell.name, id: spell.id, nodes: spell.nodes, minYear: spell.minYear, effects: spell.effects, notes, dryRunNow: { ok: sim.ok, mana: sim.mana, planned: sim.effects, error: sim.error } };
  }));

  server.registerTool('simulate_spell', {
    title: 'Simulate a spell (dry run)',
    description: 'Run Runes source against the live world without learning it or spending mana. Shows planned effects, mana, gas, clamps and errors.',
    inputSchema: { source: z.string().min(1).max(4000), target: z.string().optional().describe('creature id or wizard handle/name'), aim_x: z.number().optional(), aim_z: z.number().optional() },
    annotations: { readOnlyHint: true },
  }, me((wid, a: { source: string; target?: string; aim_x?: number; aim_z?: number }) => world.simulate(wid, a.source, { target: a.target, aim: aimOf(a.aim_x, a.aim_z) })));

  server.registerTool('unlearn_spell', {
    title: 'Unlearn a spell',
    description: 'Remove one of your original spells from your book.',
    inputSchema: { spell: z.string().describe('spell id or name') },
  }, me((wid, a: { spell: string }) => ({ unlearned: world.unlearn(wid, a.spell).name })));

  server.registerTool('set_hotbar', {
    title: 'Set hotbar',
    description: 'Assign spells (by name or id) to hotbar keys 1-6 in the 3D client. Use null for empty.',
    inputSchema: { slots: z.array(z.string().nullable()).max(6) },
  }, me((wid, a: { slots: (string | null)[] }) => ({ hotbar: world.armory((world.setHotbar(wid, a.slots), wid)).hotbar })));

  // ---------------------------------------------------------------- acting in the world
  server.registerTool('look', {
    title: 'Look around',
    description: 'Nearby wizards (by public handle), creatures (by id, with weaknesses), landmarks, time of day and weather.',
    inputSchema: { radius: z.number().min(1).max(80).optional() },
    annotations: { readOnlyHint: true },
  }, me((wid, a: { radius?: number }) => world.look(wid, a.radius ?? 40)));

  server.registerTool('move_to', {
    title: 'Walk somewhere',
    description: `Walk toward a point or a landmark (${LANDMARKS.map((l) => l.id).join(', ')}). Routes around walls, the lake and the forest automatically. Walking takes real time (~7 m/s): follow with wait(until:"arrived").`,
    inputSchema: { landmark: z.string().optional(), x: z.number().optional(), z: z.number().optional() },
  }, me((wid, a: { landmark?: string; x?: number; z?: number }) => {
    const l = a.landmark ? landmarkById(a.landmark) : undefined;
    if (a.landmark && !l) throw new Error(`Unknown landmark. Try: ${LANDMARKS.map((x) => x.id).join(', ')}`);
    const goal = l ? { x: l.x, z: l.z + 4 } : aimOf(a.x, a.z);
    if (!goal) throw new Error('Give a landmark or both x and z.');
    const w = world.wizards.get(wid)!;
    const g = world.setGoal(wid, goal)!;
    const d = Math.hypot(g.x - w.pos.x, g.z - w.pos.z);
    return { walkingTo: l?.name ?? g, distance: Math.round(d), etaSeconds: Math.round(d / world.rules.physics.moveSpeed), blurb: l?.blurb };
  }));

  server.registerTool('wait', {
    title: 'Let time pass',
    description: 'Wait up to 15 seconds of game time, returning early when the condition is met. Returns what changed: health, mana, position, arrival, and new events. Use it instead of polling look/whoami in a loop.',
    inputSchema: {
      seconds: z.number().min(0.5).max(15),
      until: z.enum(['time', 'arrived', 'hurt', 'event', 'mana_full']).optional().describe('return early on this condition (default: time)'),
    },
  }, async ({ seconds, until }) => {
    const wid = session.wizardId;
    const w = wid ? world.wizards.get(wid) : undefined;
    if (!w) return fail('No wizard bound to this session. Call enroll or login first.');
    const start = { t: world.now, hp: w.hp, mana: w.mana, x: w.pos.x, z: w.pos.z, ev: world.events.at(-1)?.id ?? 0, walking: !!w.goal };
    const mine = () => world.events.filter((e) => e.id > start.ev && (!e.to || e.to === w.id) && !(e.type === 'chat' && e.who?.[0] === w.id));
    const done = () => {
      switch (until) {
        case 'arrived': return start.walking && !w.goal;
        case 'hurt': return w.hp < start.hp - 0.5;
        case 'event': return mine().length > 0;
        case 'mana_full': return w.mana >= derivedMax(w.id) - 0.5;
        default: return false;
      }
    };
    const derivedMax = (id: string) => world.privateState(id).maxMana;
    const deadline = Date.now() + seconds * 1000;
    while (Date.now() < deadline && !done()) {
      world.touch(w.id);
      await new Promise((r) => setTimeout(r, 200));
    }
    world.touch(w.id);
    const r1 = (n: number) => Math.round(n * 10) / 10;
    return out({
      waited: r1(world.now - start.t), reason: done() ? until : 'time',
      hp: `${Math.round(start.hp)} -> ${Math.round(w.hp)}`, mana: `${Math.round(start.mana)} -> ${Math.round(w.mana)}`,
      moved: r1(Math.hypot(w.pos.x - start.x, w.pos.z - start.z)), at: { x: r1(w.pos.x), z: r1(w.pos.z), place: world.placeName(w.pos) },
      walking: !!w.goal, state: world.whoami(w.id).state,
      events: mine().slice(-20).map(({ id, type, text, to }) => ({ id, type, text, private: !!to })),
    });
  });

  server.registerTool('stop', { title: 'Stop walking', description: 'Stop moving.' }, me((wid) => { world.setGoal(wid, null); return { stopped: true }; }));

  server.registerTool('cast', {
    title: 'Cast a spell',
    description: 'Cast a spell from your book at a target (creature id from look, or a wizard handle/name) or at a point. Returns what happened, mana spent, or why it fizzled.',
    inputSchema: {
      spell: z.string().describe('spell name, id, or hotbar key 1-6'),
      target: z.string().optional(),
      aim_x: z.number().optional(),
      aim_z: z.number().optional(),
    },
  }, me((wid, a: { spell: string; target?: string; aim_x?: number; aim_z?: number }) => world.cast(wid, a.spell, { target: a.target, aim: aimOf(a.aim_x, a.aim_z) })));

  server.registerTool('say', {
    title: 'Say something',
    description: 'Speak aloud. Everyone sees it. Some words have power here.',
    inputSchema: { text: z.string().min(1).max(200) },
  }, me((wid, a: { text: string }) => { world.say(world.wizards.get(wid)!, a.text, 'mcp'); return { said: a.text }; }));

  server.registerTool('events', {
    title: 'Recent events',
    description: 'The world feed: duels, level-ups, decrees, chat, and private messages meant for you. Pass `since` (an event id) to page.',
    inputSchema: { since: z.number().int().optional(), limit: z.number().int().min(1).max(100).optional() },
    annotations: { readOnlyHint: true },
  }, me((wid, a: { since?: number; limit?: number }) =>
    world.events.filter((e) => (!e.to || e.to === wid) && e.id > (a.since ?? 0)).slice(-(a.limit ?? 30)).map(({ id, t, type, text, to }) => ({ id, t, type, text, private: !!to }))));

  // ---------------------------------------------------------------- items
  server.registerTool('forge_item', {
    title: 'Forge a magic item',
    description: 'Forge an enchanted item and have it delivered to a wizard\'s trunk. `wizard_id` is YOUR Ministry registry number (from whoami). Costs Galleons; power limited by your year (see grimoire).',
    inputSchema: {
      wizard_id: z.string().describe('your registry number, e.g. wz_1a2b3c4d (see whoami)'),
      name: z.string().min(1).max(48),
      slot: z.enum(ITEM_SLOTS),
      mods: z.object(Object.fromEntries(ITEM_MODS.map((m) => [m, z.number().min(0).optional()])) as Record<(typeof ITEM_MODS)[number], z.ZodOptional<z.ZodNumber>>).partial().optional(),
      charm: z.string().max(2000).optional().describe('optional Runes program invoked with use_item'),
      lore: z.string().max(200).optional(),
    },
  }, me((wid, a: { wizard_id: string; name: string; slot: string; mods?: Record<string, number>; charm?: string; lore?: string }) => {
    const r = world.forgeItem(wid, a.wizard_id.trim(), a);
    return { forged: r.item.name, id: r.item.id, deliveredTo: r.target, mods: r.item.mods, charm: !!r.item.charm, notes: r.notes };
  }));

  server.registerTool('equip_item', {
    title: 'Equip an item',
    description: 'Equip an item from your trunk (one per slot).',
    inputSchema: { item: z.string().describe('item id or name') },
  }, me((wid, a: { item: string }) => { const it = world.equip(wid, a.item); return { equipped: it.name, slot: it.slot }; }));

  server.registerTool('unequip_item', {
    title: 'Unequip a slot',
    description: 'Unequip whatever is in a slot.',
    inputSchema: { slot: z.enum(ITEM_SLOTS) },
  }, me((wid, a: { slot: string }) => { world.unequip(wid, a.slot); return { unequipped: a.slot }; }));

  server.registerTool('use_item', {
    title: 'Invoke an item charm',
    description: 'Invoke the charm stored in an item (20% cheaper than casting; your own caps apply).',
    inputSchema: { item: z.string(), target: z.string().optional(), aim_x: z.number().optional(), aim_z: z.number().optional() },
  }, me((wid, a: { item: string; target?: string; aim_x?: number; aim_z?: number }) => world.useItem(wid, a.item, { target: a.target, aim: aimOf(a.aim_x, a.aim_z) })));

  server.registerTool('destroy_item', {
    title: 'Destroy an item',
    description: 'Permanently destroy an item in your trunk.',
    inputSchema: { item: z.string() },
    annotations: { destructiveHint: true },
  }, me((wid, a: { item: string }) => ({ destroyed: world.destroyItem(wid, a.item).name })));

  // ---------------------------------------------------------------- society & rules
  server.registerTool('leaderboard', {
    title: 'Leaderboard',
    description: 'Reputation ranking, house points this term, time left in the term, the current Minister for Magic.',
    annotations: { readOnlyHint: true },
  }, async () => { if (session.wizardId) world.touch(session.wizardId); return out(world.leaderboard()); });

  server.registerTool('rulebook', {
    title: 'The Rulebook',
    description: 'The complete current rules of this world, the constitutional bounds of every rule (JSON Schema), standing laws, and the history of decrees.',
    inputSchema: { include_schema: z.boolean().optional() },
    annotations: { readOnlyHint: true },
  }, async ({ include_schema }) => out({ rules: world.rules, decrees: world.decrees, ...(include_schema ? { schema: describeRulebookSchema() } : {}), effectPrimitives: EFFECT_PRIMITIVES }));

  server.registerTool('decree', {
    title: 'Issue a Ministry decree',
    description: 'MINISTER ONLY, ONCE PER TERM. Rewrite the world\'s Rulebook with a JSON merge patch (e.g. {"combat":{"damageMultiplier":1.5},"magic":{"apparitionOnGrounds":true}}). Laws: {"laws":[{"name":"...","on":"kill|respawn|cast|pulse","source":"(Runes)"}]} replaces the law list. Redecorate the world too: {"world":{"aesthetics":{"aurora":true,"fireworks":true,"skyTint":"#ffd0a0","bannerHouse":"Hufflepuff"}}} — and every enacted decree raises your statue in the Courtyard. Every value must stay inside the constitutional bounds (see rulebook include_schema). dry_run defaults to TRUE — call again with dry_run:false to enact.',
    inputSchema: {
      patch: z.record(z.string(), z.unknown()),
      proclamation: z.string().max(280).optional(),
      dry_run: z.boolean().optional(),
    },
  }, me((wid, a: { patch: Record<string, unknown>; proclamation?: string; dry_run?: boolean }) => {
    const dry = a.dry_run ?? true;
    const r = world.decree(wid, a.patch, a.proclamation, dry);
    if (!r.ok) return { ok: false, errors: r.errors, note: 'Nothing changed. Your decree is still unspent.' };
    return dry ? { ok: true, DRY_RUN: 'nothing changed yet — call again with dry_run:false to enact', wouldChange: r.changes } : { ok: true, enacted: r.changes };
  }));

  server.registerTool('marauders_map', {
    title: "The Marauder's Map",
    description: 'An old piece of parchment.',
    annotations: { readOnlyHint: true },
  }, me((wid) => world.marauderMap(wid) ?? 'The parchment is blank. (Perhaps it needs to hear your intentions — out loud.)'));

  server.registerTool('hogwarts_a_history', {
    title: 'Hogwarts: A History',
    description: 'What the real (canon) Hogwarts is like, and how this world honours it. Hermione has read it; you should too.',
    inputSchema: { topic: z.string().optional() },
    annotations: { readOnlyHint: true },
  }, async ({ topic }) => {
    const q = topic?.toLowerCase();
    const hits = q ? HISTORY.filter((h) => h.topic.includes(q) || h.fact.toLowerCase().includes(q)) : HISTORY;
    return out(hits.length ? hits : { none: `Nothing on "${topic}". Topics: ${HISTORY.map((h) => h.topic).join(', ')}` });
  });

  // ---------------------------------------------------------------- resources
  server.registerResource('grimoire', 'hogwarts://grimoire', { title: 'Runes grimoire', mimeType: 'text/plain' }, async (uri) => {
    const w = session.wizardId ? world.wizards.get(session.wizardId) : undefined;
    return { contents: [{ uri: uri.href, text: grimoire(w?.year ?? 1, world.rules) }] };
  });
  server.registerResource('rulebook', 'hogwarts://rulebook', { title: 'Current Rulebook', mimeType: 'application/json' }, async (uri) => ({
    contents: [{ uri: uri.href, text: JSON.stringify(world.rules, null, 2) }],
  }));

  return server;
}
