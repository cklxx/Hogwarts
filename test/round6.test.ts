/**
 * Playtest round 4 (the society: five agents playing as people): what they tripped over. The inbox remembers
 * what a wizard has read across MCP sessions; batch waits out the wand arm; wait until:"arrived" does not wait
 * for a walk that never began; the DA shows the veto it can really cast, how a joint strike is going, and has a
 * channel; the Minister's bar is the same number everywhere; chests hand over a page you have not got; the
 * Quidditch roster says whose house a guest is from; reflexes hit wizards and keep mana back.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createMcpServer } from '../src/mcp/server.js';
import { chatRead, chatSend } from '../src/kernel/chat.js';
import { RUNES_FRAGMENTS } from '../src/kernel/cards.js';
import { daState, joinDA } from '../src/kernel/unfair.js';
import { setReflexes } from '../src/kernel/reflexes.js';
import { QD_CALL_S, QD_PITCH, QD_START_FRAC, qdJoin, qdPairing, qdStatus } from '../src/kernel/quidditch.js';
import { ensureNpcs } from '../src/kernel/npc.js';
import { broom } from '../src/kernel/travel.js';
import { World } from '../src/kernel/world.js';
import { DA_JOINT_MIN, DA_QUORUM } from '../src/shared/constants.js';
import type { Creature, Wizard } from '../src/kernel/types.js';

function mk(seed = 6) {
  const w = new World({ seed, secret: 'round6' });
  w.rules.creatures.spawnMultiplier = 0;
  w.rules.events.pool = [];
  w.rules.combat.pvp = true;
  w.term.endsAt = 1e12;
  return w;
}
function join(w: World, name: string, house: string, x: number, z: number, year = 3): Wizard {
  const a = w.enroll(name, house as never).wizard;
  a.connections = 1; a.createdAt = -1e6; a.year = year; a.pos = { x, z };
  a.hp = w.privateState(a.id).maxHp; a.mana = w.privateState(a.id).maxMana;
  return a;
}
function beast(w: World, id: string, x: number, z: number, hp = 400): Creature {
  const c: Creature = { id, kind: 'troll', pos: { x, z }, home: { x, z }, hp, maxHp: hp, facing: 0, target: null, attackCd: 1e9, rootedUntil: 1e9, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
  w.creatures.set(id, c);
  return c;
}
const run = (w: World, s: number) => { for (let i = 0; i < Math.round(s * 20); i++) w.tick(); };
/** One MCP session bound to `wid` (the playtest CLI opens a new one for every command). */
async function mcp(w: World, wid: string) {
  const server = createMcpServer(w, { wizardId: wid, baseUrl: 'http://x' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(ct);
  return async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await c.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    let v: unknown = r.content[0].text;
    try { v = JSON.parse(r.content[0].text); } catch { /* text */ }
    return { err: !!r.isError, v: v as Record<string, any> };
  };
}

describe('MCP: what a wizard has read, and waiting', () => {
  it('inbox marks read for the wizard, not the session: a second session is not handed the same items', async () => {
    const w = mk();
    const a = join(w, 'Colin Reader', 'Gryffindor', 100, 100), b = join(w, 'Ginny Writer', 'Gryffindor', 100, 104);
    chatSend(w, b.id, { ch: 'dm', to: a.handle, text: 'Join the DA?' });
    const first = await (await mcp(w, a.id))('inbox');
    expect(first.v.items.map((i: { text: string }) => i.text).join(' ')).toMatch(/Join the DA/);
    const again = await (await mcp(w, a.id))('inbox'); // a fresh session, as the CLI makes
    expect(again.v.items).toEqual([]);
    chatSend(w, b.id, { ch: 'dm', to: a.handle, text: 'Well?' });
    const next = await (await mcp(w, a.id))('inbox');
    expect(next.v.items.map((i: { text: string }) => i.text)).toEqual([expect.stringMatching(/Well\?/)]);
  });

  it('wait until:"arrived" returns at once when you are not walking, and says so', async () => {
    const w = mk();
    const a = join(w, 'Still Stander', 'Hufflepuff', 100, 100);
    const t0 = Date.now();
    const r = await (await mcp(w, a.id))('wait', { seconds: 5, until: 'arrived' });
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(r.v).toMatchObject({ reason: 'arrived', note: expect.stringMatching(/not walking/) });
  });

  it('batch: two casts back to back both go (the wand arm\'s pause is waited out), and the example is {"calls":[…]}', async () => {
    const w = mk();
    const a = join(w, 'Quick Caster', 'Ravenclaw', 100, 100);
    beast(w, 'troll_b', 100, 90);
    let on = true;
    const ticker = (async () => { while (on) { w.tick(); await new Promise((r) => setTimeout(r, 10)); } })();
    const call = await mcp(w, a.id);
    const r = await call('batch', { calls: [{ tool: 'cast', args: { spell: 'Stupefy', target: 'troll_b' } }, { tool: 'cast', args: { spell: 'Expelliarmus', target: 'troll_b' } }] });
    on = false; await ticker;
    expect(r.v.results.map((x: { ok: boolean; result: unknown }) => [x.ok, JSON.stringify(x.result)])).toEqual([[true, expect.any(String)], [true, expect.any(String)]]);
    const tools = await (async () => {
      const server = createMcpServer(w, { wizardId: a.id, baseUrl: 'http://x' });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await server.connect(st);
      const c = new Client({ name: 't', version: '0' });
      await c.connect(ct);
      return (await c.listTools()).tools;
    })();
    expect(tools.find((t) => t.name === 'batch')!.description).toContain('{"calls":[');
  });

  it('forge_spell with nothing to aim at: forged, and the dry run says why it did nothing', async () => {
    const w = mk();
    const a = join(w, 'Lone Forger', 'Slytherin', 100, 100);
    const r = await (await mcp(w, a.id))('forge_spell', { name: 'Poke', source: '(let t (first (enemies 20)))\n(when t (bolt t 8))' });
    expect(r.err).toBe(false);
    expect(r.v.forged).toBe('Poke');
    if (!r.v.dryRunNow.ok) expect(r.v.dryRunNow.hint).toMatch(/forged and kept/);
  });

  it('the rulebook says what the Minister\'s bar comes to now, the same number as the leaderboard', async () => {
    const w = mk();
    w.rules.terms.lengthSeconds = 600;
    const a = join(w, 'Percy Counter', 'Gryffindor', 100, 100);
    const r = await (await mcp(w, a.id))('rulebook');
    expect(r.v.inEffect.ministerMinReputation).toBe(w.ministerBar());
    expect(w.leaderboard().ministerMinReputation).toBe(w.ministerBar());
    expect(w.ministerBar()).toBeLessThan(w.rules.terms.ministerMinReputation);
  });
});

describe('邓布利多军: the veto it can cast, a joint strike in progress, a channel', () => {
  it('below quorum: needed is a majority of the quorum, and it says the veto is blocked', () => {
    const w = mk();
    const g = join(w, 'Ginny Rally', 'Ravenclaw', 100, 100, 1);
    const s = daState(w, g.id);
    expect(s.veto.needed).toBe(Math.floor(DA_QUORUM / 2) + 1);
    expect(s.veto.blocked).toMatch(/below quorum/);
  });

  it('a member sees how many members are on the target they hit, and the DA channel reaches members only', () => {
    const w = mk();
    const [g, c, f] = ['Ginny Rally', 'Colin Creevey', 'Fred Weasley'].map((n, i) => join(w, n, ['Ravenclaw', 'Gryffindor', 'Hufflepuff'][i], 100 + i * 2, 100, 1));
    const out = join(w, 'Blaise Outsider', 'Slytherin', 104, 104, 1);
    for (const x of [g, c, f]) joinDA(w, x.id);
    beast(w, 'troll_da', 102, 88);
    expect(w.cast(g.id, 'Stupefy', { target: 'troll_da' }).ok).toBe(true);
    run(w, 1.2);
    const now = daState(w, g.id).joint.now!;
    expect(now).toEqual([expect.objectContaining({ target: 'Mountain Troll', id: 'troll_da', members: 1, need: DA_JOINT_MIN })]);
    expect(daState(w, g.id).joint.how).toMatch(/no Patronus needed/);
    chatSend(w, g.id, { ch: 'da', text: 'Strike on three' });
    expect(chatRead(w, c.id, { ch: 'da' }).map((l) => l.text)).toEqual([expect.stringMatching(/\[D\.A\.\] Ginny Rally: Strike on three/)]);
    expect(chatRead(w, out.id, { ch: 'da' })).toEqual([]);
    expect(() => chatSend(w, out.id, { ch: 'da', text: 'let me in' })).toThrow(/Only members/);
  });
});

describe('the world, said plainly', () => {
  it('look marks a creature a school event brought, and what it resists', () => {
    const w = mk();
    const a = join(w, 'Newbie Looker', 'Hufflepuff', 100, 100);
    const t = beast(w, 'troll_ev', 100, 90);
    t.ev = 1; t.dmgMult = 1.5;
    const c = w.look(a.id).creatures.find((x) => x.id === 'troll_ev') as Record<string, unknown>;
    expect(c).toMatchObject({ schoolEvent: true, hitsHarder: '×1.5', resists: expect.arrayContaining([expect.stringMatching(/^arcane ×0\.6/)]) });
  });

  it('a chest page is one you have not found and do not know; none left: Galleons', () => {
    const w = mk();
    const a = join(w, 'Page Hunter', 'Ravenclaw', 100, 100);
    w.rules.cards.chestCardPct = 0;
    const seen = new Set<string>();
    for (let i = 0; i < 200 && seen.size < RUNES_FRAGMENTS.length; i++) {
      const r = w.chestLoot(a, { en: 'A chest', zh: '宝箱' });
      if (r.fragment) { expect(seen.has(r.fragment.source)).toBe(false); seen.add(r.fragment.source); }
    }
    expect(seen.size).toBe(RUNES_FRAGMENTS.length);
    for (let i = 0; i < 40; i++) expect(w.chestLoot(a, { en: 'A chest', zh: '宝箱' }).fragment).toBeUndefined();
  });

  it('a broom in the courtyard: refused, and it says the courtyard counts', () => {
    const w = mk();
    const a = join(w, 'Broom Rider', 'Gryffindor', 0, -22);
    expect(w.look(a.id).you.onGrounds).toBe(true);
    expect(() => broom(w, a.id, true)).toThrow(/courtyard/);
  });

  it('Quidditch: a guest shows its own house beside its team; a seeker asked for mid-match takes the NPC\'s place, or is told why not', () => {
    const w = mk();
    w.term.endsAt = w.term.startedAt + 900;
    ensureNpcs(w, 4);
    const [A] = qdPairing(w.term.n);
    const whistle = w.term.startedAt + QD_START_FRAC * (w.term.endsAt - w.term.startedAt);
    w.now = whistle - QD_CALL_S + 1;
    run(w, 0.1);
    const p = join(w, 'Percy Seeker', A, QD_PITCH.x, QD_PITCH.z + 10);
    const called = qdJoin(w, p.id, 'seeker') as { note?: string };
    expect(called.note).toMatch(/whistle/);
    run(w, whistle - w.now + 0.2);
    const st = qdStatus(w, p.id);
    expect(st.match!.roster.find((r) => r.name === p.name)).toMatchObject({ team: A, house: A, role: 'seeker' });
    for (const r of st.match!.roster) expect(r.house).toBe(w.wizards.get([...w.wizards.values()].find((x) => x.name === r.name)!.id)!.house);
    // a second player asks for seeker mid-match: a player holds it, so they are told
    const q = join(w, 'Oliver Late', A, QD_PITCH.x, QD_PITCH.z + 12);
    const late = qdJoin(w, q.id, 'seeker') as { note?: string };
    expect(late.note).toMatch(/a player: you play chaser/);
  });
});

describe('反射: wizards by handle, "self", and mana kept back', () => {
  it('a reflex answers a wizard who struck first (by handle: it used to pass a registry id cast refused), and keep holds mana back', () => {
    const w = mk();
    const a = join(w, 'Blaise Reflex', 'Slytherin', 100, 100), b = join(w, 'Percy Target', 'Gryffindor', 100, 110);
    setReflexes(w, a.id, [{ when: 'enemy_near', do: 'cast', range: 20, spell: 'Stupefy', target: 'nearest_enemy' }]);
    run(w, 1.5);
    expect(b.hp).toBe(w.privateState(b.id).maxHp); // a passer-by: a reflex never starts a fight
    expect(w.cast(b.id, 'Stupefy', { target: a.handle }).ok).toBe(true); // b strikes first
    run(w, 1);
    a.st.stunnedUntil = 0; a.hp = w.privateState(a.id).maxHp; a.mana = w.privateState(a.id).maxMana;
    const hp = b.hp;
    run(w, 2);
    expect(b.hp).toBeLessThan(hp);
    b.hp = w.privateState(b.id).maxHp;
    setReflexes(w, a.id, [{ when: 'enemy_near', do: 'cast', range: 20, spell: 'Stupefy', target: 'nearest_enemy', keep: 0.9 }]);
    a.mana = w.privateState(a.id).maxMana * 0.5;
    const hp2 = b.hp;
    run(w, 1.5);
    expect(b.hp).toBe(hp2);
  });

  it('cast at "self" and "me" is you', () => {
    const w = mk();
    const a = join(w, 'Self Healer', 'Hufflepuff', 100, 100);
    a.hp = 10;
    expect(w.cast(a.id, 'Episkey', { target: 'self' }).ok).toBe(true);
    expect(w.resolveTarget('me', a.id)).toBe(a.id);
  });
});

describe('the owner\'s two calls (round 4): an absentee never takes office; the joint strike has 8 s', () => {
  it('the top reputation away all term does not become Minister: the top player who came does', () => {
    const w = mk();
    w.term.startedAt = w.now; w.term.endsAt = w.now + 600;
    const away = join(w, 'Away Grandee', 'Slytherin', 100, 100), here = join(w, 'Here Percy', 'Gryffindor', 110, 100);
    away.reputation = 500; here.reputation = 200;
    away.connections = 0; away.lastMcpAt = -1e9; away.lastSeenAt = w.term.startedAt - 1;
    here.lastSeenAt = w.now;
    expect(w.leaderboard().ministerInLine).toBe(here.name);
    w.forceEndTerm();
    expect(w.flags.ministerId).toBe(here.id);
    expect(away.reputation).toBe(500); // the absent keep theirs, as before
  });

  it('three members hitting one target 3 s apart still strike together (the window is DA_JOINT_WINDOW_S = 8)', () => {
    const w = mk();
    const ms = ['Ginny Rally', 'Colin Creevey', 'Fred Weasley'].map((n, i) => join(w, n, ['Ravenclaw', 'Gryffindor', 'Hufflepuff'][i], 100 + i * 2, 100, 1));
    for (const x of ms) joinDA(w, x.id);
    beast(w, 'troll_j', 102, 88, 2000);
    for (const [i, x] of ms.entries()) { expect(w.cast(x.id, 'Stupefy', { target: 'troll_j' }).ok).toBe(true); run(w, i < 2 ? 3 : 1); } // hits ~6 s apart end to end
    expect(daState(w, ms[2].id).joint.now![0]).toMatchObject({ members: 3 });
    expect(w.events.some((e) => e.type === 'da' && /together|Patronum/.test(e.text))).toBe(true);
  });
});
