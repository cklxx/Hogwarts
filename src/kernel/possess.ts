/**
 * 附身 (a Feature): an agent takes over one of the castle's NPC wizards, or a wild creature, for the fun of it.
 *
 * - An NPC wizard: the agent's MCP session plays it (mcp/server.ts rebinds the session: look, move_to, cast, chat,
 *   reflexes… act as the NPC) while the NPC's own brain rests (the `npc` hook). The vessel stays an NPC for every rule
 *   — never Minister, no reputation from its stuns, the fresh and weak spared (npc.ts, docs/RULES.md). Up to
 *   POSSESS_S, then it is itself again.
 * - A wild creature within POSSESS_REACH of the agent's own wizard: `command` it — walk to a point (never more than
 *   POSSESS_ROAM from its lair), set upon someone (only whom it could harm anyway, never a newcomer), or roar a line
 *   those near hear. It fights with its own teeth; if it falls, the possession ends.
 * - The agent's own wizard stays where it stood, as vulnerable as ever. Nothing pays the possessor.
 *
 * (A player can find their way in too; this file does not say how.)
 */
import { CREATURES } from './creatures.js';
import { FRESH_SECONDS } from '../shared/constants.js';
import { npcMayFight } from './npc.js';
import { z } from 'zod';
import type { Feature } from './feature.js';
import type { Creature, Vec2, Wizard } from './types.js';
import type { World } from './world.js';

export const POSSESS_S = 600, POSSESS_REACH = 60, POSSESS_ROAM = 80, EGG_POSSESS_S = 60, EGG_REACH = 3;
const EGG = /^\s*(polyjuice|复方汤剂)[!！。.]*\s*$/i;

interface Hold { by: string; until: number; home?: Vec2 }
declare module './world.js' {
  interface World {
    /** 附身 (this module's Feature): who holds which vessel, and until when. */
    possess: { npcs: Map<string, Hold>; creatures: Map<string, Hold>; of: Map<string, { kind: 'npc' | 'creature'; id: string }> };
  }
}
declare module './types.js' {
  interface Creature {
    /** 附身: the wizard driving this creature (transient). */
    driver?: string;
  }
  interface Wizard {
    /** 附身: the wizard playing this NPC right now (transient): the duel and Quidditch drafts pass it over. */
    heldBy?: string;
  }
}

const d2 = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
const busyNpc = (world: World, w: Wizard) => !world.isActive(w) || world.possess.npcs.has(w.id) || world.duel.match?.sides.flat().includes(w.id) || world.qd.match?.roster[w.id];

/** The vessels this wizard could take now: every free NPC wizard, and the wild creatures within reach. */
export function vessels(world: World, wid: string) {
  const me = world.need(wid);
  return {
    npcs: [...world.wizards.values()].filter((w) => w.npc && !busyNpc(world, w)).map((w) => ({ handle: w.handle, name: w.name, house: w.house, year: w.year, at: world.placeName(w.pos), dist: Math.round(d2(w.pos, me.pos)) })).sort((a, b) => a.dist - b.dist),
    creatures: [...world.creatures.values()].filter((c) => wildFree(world, c) && d2(c.pos, me.pos) <= POSSESS_REACH).map((c) => ({ id: c.id, kind: c.kind, dist: Math.round(d2(c.pos, me.pos)) })).sort((a, b) => a.dist - b.dist).slice(0, 12),
    holding: world.possess.of.get(wid) ?? null,
  };
}
const wildFree = (world: World, c: Creature) => CREATURES[c.kind].faction === 'hostile' && !c.owner && !c.ev && !world.possess.creatures.has(c.id) && c.hp > 0;

/** Hands off the controls: what was held down does not keep walking the body you leave behind (or the one you give back). */
const me0 = (world: World, id: string) => { const x = world.wizards.get(id); if (x) { x.input = { dx: 0, dz: 0 }; world.stopWalk(x); } };

function taken(world: World, wid: string) {
  if (world.possess.of.has(wid)) throw new Error('You already hold a vessel: release it first. 你已经附身了：先 release。');
  if (world.wizards.get(wid)?.npc) throw new Error('An NPC cannot possess. NPC 不能附身。');
}

/** Take an NPC wizard (by handle or name). Returns its id: the caller (MCP) now acts as it. */
export function possessNpc(world: World, wid: string, key: string, secs = POSSESS_S): string {
  taken(world, wid);
  const id = world.resolveTarget(key, wid);
  const v = id ? world.wizards.get(id) : undefined;
  if (!v || !v.npc) throw new Error('Only an NPC wizard can be possessed (see possess list). 只能附身 NPC 巫师（possess list 看有哪些）。');
  if (busyNpc(world, v)) throw new Error(`${v.name} is busy (stunned, in a duel or a match, or already held). ${v.name} 现在没空。`);
  world.possess.npcs.set(v.id, { by: wid, until: world.now + secs });
  world.possess.of.set(wid, { kind: 'npc', id: v.id });
  me0(world, wid); v.heldBy = wid; me0(world, v.id);
  return v.id;
}

export function possessCreature(world: World, wid: string, key: string, secs = POSSESS_S) {
  taken(world, wid);
  const me = world.need(wid);
  const c = world.creatures.get(key);
  if (!c || !wildFree(world, c)) throw new Error('Only a free wild creature can be possessed (see possess list). 只能附身没人占的野生魔物。');
  if (d2(c.pos, me.pos) > POSSESS_REACH) throw new Error(`Too far: within ${POSSESS_REACH} m of you. 太远了：要在你 ${POSSESS_REACH} 米内。`);
  world.possess.creatures.set(c.id, { by: wid, until: world.now + secs, home: { ...c.home } });
  world.possess.of.set(wid, { kind: 'creature', id: c.id });
  c.driver = wid; c.target = null;
  return { id: c.id, kind: c.kind, secs, note: 'Drive it with possess op:"command": x+z to walk, attack = a name, roar = a line. possess release to let go.' };
}

export function release(world: World, wid: string) {
  const h = world.possess.of.get(wid);
  if (!h) return { released: null };
  world.possess.of.delete(wid);
  if (h.kind === 'npc') { world.possess.npcs.delete(h.id); const v = world.wizards.get(h.id); if (v) delete v.heldBy; me0(world, h.id); }
  else {
    const hold = world.possess.creatures.get(h.id);
    world.possess.creatures.delete(h.id);
    const c = world.creatures.get(h.id);
    if (c) { delete c.driver; c.target = null; if (hold?.home) c.home = hold.home; }
  }
  return { released: h.kind === 'npc' ? world.wizards.get(h.id)?.name ?? h.id : CREATURES[world.creatures.get(h.id)?.kind ?? 'troll'].name, you: world.wizards.get(wid)?.name };
}

/** Drive the creature you hold: walk to a point, set upon someone, roar a line. */
export function command(world: World, wid: string, a: { x?: number; z?: number; attack?: string; roar?: string }) {
  const h = world.possess.of.get(wid);
  if (!h || h.kind !== 'creature') throw new Error('You hold no creature (possess take a creature first). 你没附身魔物。');
  const c = world.creatures.get(h.id)!, lair = world.possess.creatures.get(h.id)!.home!;
  const out: Record<string, unknown> = {};
  if (typeof a.x === 'number' && typeof a.z === 'number') {
    let p = { x: a.x, z: a.z };
    const d = d2(p, lair);
    if (d > POSSESS_ROAM) p = { x: lair.x + ((p.x - lair.x) / d) * POSSESS_ROAM, z: lair.z + ((p.z - lair.z) / d) * POSSESS_ROAM }; // it will not stray far from its lair
    c.home = p; c.target = null; out.to = { x: Math.round(p.x), z: Math.round(p.z) };
  }
  if (a.attack) {
    const t = world.resolveTarget(a.attack, wid);
    const tw = t ? world.wizards.get(t) : undefined;
    if (!t || !world.canHarm(c.id, t)) throw new Error('It cannot reach them (a safe zone, a stunned wizard, or no such one). 它碰不到对方。');
    if (tw && world.now - tw.createdAt < FRESH_SECONDS) throw new Error('Not a newcomer. 不能欺负新生。');
    c.target = t; out.attacking = world.entity(t)?.name;
  }
  if (a.roar) {
    const text = String(a.roar).replace(/\s+/g, ' ').trim().slice(0, 120);
    const aud = [...world.nearWizards(c.pos, 30)].filter((x) => d2(x.pos, c.pos) <= 30).map((x) => x.id);
    const name = CREATURES[c.kind].name;
    if (text) world.emit('chat', `[near] ${name}: ${text}`, { zh: `[附近] ${name}：${text}`, ch: 'near', aud: [...new Set([...aud, wid])] });
    out.roared = text;
  }
  return { ...out, hp: Math.round(c.hp), maxHp: Math.round(c.maxHp), pos: { x: Math.round(c.pos.x), z: Math.round(c.pos.z) } };
}

/** 彩蛋: a player says the word close to an NPC wizard and slips into them for a minute. */
function said(world: World, w: Wizard, text: string) {
  if (!EGG.test(text) || world.possess.of.has(w.id)) return;
  const v = [...world.nearWizards(w.pos, EGG_REACH)].find((x) => x.npc && !busyNpc(world, x) && d2(x.pos, w.pos) <= EGG_REACH);
  if (!v) return;
  possessNpc(world, w.id, v.handle, EGG_POSSESS_S);
  world.emit('egg', `The potion bubbles. For one minute you are ${v.name}.`, { to: w.id, zh: `药水咕嘟冒泡。接下来一分钟，你就是 ${v.name}。` });
}

/** The NPC this wizard plays right now, if any: their tools and their browser's keys move it. */
const vesselOf = (world: World, wid: string): string | null => { const h = world.possess.of.get(wid); return h?.kind === 'npc' ? h.id : null; };
/** What an agent may do as an NPC: move, fight, talk, look. (Its own wizard's shopping, exams and decrees wait.) */
const VESSEL_TOOLS: ReadonlySet<string> = new Set(['whoami', 'look', 'move_to', 'stop', 'wait', 'dodge', 'cast', 'simulate_spell', 'grimoire', 'armory', 'say', 'chat', 'inbox', 'batch', 'events', 'ward', 'reflexes', 'possess', 'leaderboard', 'rulebook', 'school_events']);

function step(world: World) {
  const P = world.possess;
  if (!P.of.size) return;
  for (const [wid, h] of [...P.of]) {
    const hold = (h.kind === 'npc' ? P.npcs : P.creatures).get(h.id);
    const alive = h.kind === 'npc' ? world.wizards.has(h.id) : (world.creatures.get(h.id)?.hp ?? 0) > 0;
    if (!hold || world.now >= hold.until || !alive || !world.wizards.has(wid)) {
      release(world, wid);
      if (world.wizards.has(wid)) world.emit('system', 'The possession wears off: you are yourself again.', { to: wid, zh: '附身结束了：你回到了自己身上。' });
    }
  }
}

export const POSSESS_FEATURE: Feature = {
  id: 'possess',
  init(world) { world.possess = { npcs: new Map(), creatures: new Map(), of: new Map() }; },
  step,
  said,
  // a held NPC's own brain rests: its possessor plays it
  npc: (world, w) => world.possess.npcs.has(w.id),
  // …but it is still an NPC: what its brain would never hit (a newcomer, the weak, a far younger year, at spawn) it cannot
  hit(world, by, src, dstId) {
    const v = by ? world.wizards.get(by) : undefined, dst = world.wizards.get(dstId);
    return v?.heldBy && dst && src === v && !npcMayFight(world, v, dst) ? 0 : 1;
  },
  actAs: vesselOf,
  toolBlock: (world, wid, tool) => (vesselOf(world, wid) && !VESSEL_TOOLS.has(tool) ? `You are playing an NPC: ${tool} waits until possess release. 你正附身在 NPC 身上：${tool} 要等 possess release 之后。` : null),
  view: {
    key: 'actAs',
    me(world, w) {
      const h = world.possess.of.get(w.id), v = h?.kind === 'npc' ? world.wizards.get(h.id) : undefined;
      return v ? { handle: v.handle, name: v.name, until: Math.round(world.possess.npcs.get(v.id)!.until) } : undefined;
    },
  },
  tools: [{
    name: 'possess', title: 'Possess an NPC or a creature', cost: 1,
    description: `附身, for fun. op: list (the free NPC wizards, and the wild creatures within ${POSSESS_REACH} m of you) | take (target = an NPC's handle or name, or a creature's id) | release | command (the creature you hold: x+z = walk there, at most ${POSSESS_ROAM} m from its lair; attack = someone it could harm anyway, never a newcomer; roar = a line those within 30 m hear). An NPC: for up to ${POSSESS_S / 60} min your tools act as it (look, move_to, cast, dodge, chat, say, ward, reflexes, wait, inbox, batch…; the rest wait for release), and it is still an NPC — it cannot hurt newcomers, the weak or far younger years. A creature fights with its own teeth; it falls, the possession ends. Your own wizard stays where it is, and can be hit. Nothing here pays you.`,
    input: {
      op: z.enum(['list', 'take', 'release', 'command']),
      target: z.string().max(60).optional(),
      x: z.number().optional(), z: z.number().optional(), attack: z.string().max(60).optional(), roar: z.string().max(120).optional(),
    },
    run(world, wid, a) {
      const self = world.wizards.get(wid)?.heldBy ?? wid;
      const t = typeof a.target === 'string' ? a.target : '';
      switch (a.op) {
        case 'list': return vessels(world, self);
        case 'release': return release(world, self);
        case 'command': return command(world, self, a as { x?: number; z?: number; attack?: string; roar?: string });
        default: {
          if (!t) throw new Error('take needs a target: an NPC\'s handle or name, or a creature id (possess list). take 需要 target。');
          if (world.creatures.has(t)) return possessCreature(world, self, t);
          const id = possessNpc(world, self, t);
          const v = world.wizards.get(id)!;
          return { now: v.name, handle: v.handle, secs: POSSESS_S, note: 'Your tools now act as them (whoami shows who you are). possess release to come back.' };
        }
      }
    },
  }],
};
