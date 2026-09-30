/**
 * 决斗俱乐部, playtest round 6 (five agents playing as humans): no sheltering in a safe zone, a leave before the fight
 * calls the match off, the queue says why it drops you, NPC partners fight, targeted challenges and chosen partners, a
 * bolt sent back scores for its sender, `last` shows both sides, and the battery joke only when it is true.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createMcpServer } from '../src/mcp/server.js';
import {
  DUEL_BOW_S, DUEL_CHALLENGE_S, DUEL_COUNT_S, DUEL_ENDS, DUEL_LEASH, DUEL_NPC_AFTER_S, DUEL_STAGE,
  duelJoin, duelLeave, duelStatus,
} from '../src/kernel/duelclub.js';
import { ensureNpcs } from '../src/kernel/npc.js';
import { PRESETS, setReflexes } from '../src/kernel/reflexes.js';
import { armWard } from '../src/kernel/ward.js';
import { World } from '../src/kernel/world.js';
import type { Wizard } from '../src/kernel/types.js';

function mk() {
  const w = new World({ seed: 23, secret: 'duelclub3' });
  w.rules.creatures.spawnMultiplier = 0;
  return w;
}
function join(w: World, name: string, house = 'Gryffindor'): Wizard {
  const a = w.enroll(name, house as never).wizard;
  a.connections = 1;
  a.createdAt = -1e6;
  a.pos = { x: DUEL_STAGE.x, z: DUEL_STAGE.z + 5 };
  return a;
}
const run = (w: World, s: number) => { for (let i = 0; i < Math.round(s * 20); i++) w.tick(); };
const toMe = (w: World, a: Wizard, re: RegExp) => w.events.some((e) => e.to === a.id && re.test(`${e.text} ${e.zh ?? ''}`));
function fight(w: World, a: Wizard, b: Wizard) {
  duelJoin(w, a.id); duelJoin(w, b.id);
  run(w, DUEL_BOW_S + DUEL_COUNT_S + 0.2);
  expect(w.duel.match).toMatchObject({ a: a.id, b: b.id, phase: 'fight' });
}

describe('no sheltering in a safe zone during a duel', () => {
  it('the Great Hall reaches onto the stage; a duelist who steps in is out, and a cast at them names the safe zone', () => {
    const w = mk();
    const a = join(w, 'Harry'), b = join(w, 'Draco', 'Slytherin');
    fight(w, a, b);
    const hall = { x: 0, z: -45 }; // inside the Great Hall's box, 15 m from the stage's centre (< DUEL_LEASH)
    expect(Math.hypot(hall.x - DUEL_STAGE.x, hall.z - DUEL_STAGE.z)).toBeLessThan(DUEL_LEASH);
    expect(w.inSafe(hall)).toBe(true);
    a.pos = { ...hall };
    const r = w.cast(b.id, 'Stupefy', { target: a.handle });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/safe zone/);
    expect(r.error).not.toMatch(/only your opponents/);
    run(w, 0.1);
    expect(w.duel.match).toBeNull();
    expect(w.duel.last.at(-1)).toMatchObject({ winner: b.id });
    expect(toMe(w, a, /safe zone/)).toBe(true);
  });

  it('a stage end in a safe zone closes the club', () => {
    const w = mk();
    const a = join(w, 'Percy');
    const inSafe = w.inSafe.bind(w);
    w.inSafe = (p) => (p.x === DUEL_ENDS[1].x && p.z === DUEL_ENDS[1].z) || inSafe(p);
    expect(() => duelJoin(w, a.id)).toThrow(/safe zone/);
  });
});

describe('leaving', () => {
  it('during the bow or the countdown calls the match off: no result, no reward, no rematch wait, both told', () => {
    const w = mk();
    const a = join(w, 'Cho', 'Ravenclaw'), b = join(w, 'Cedric', 'Hufflepuff');
    duelJoin(w, a.id); duelJoin(w, b.id);
    run(w, 0.1);
    expect(w.duel.match?.phase).toBe('bow');
    const r = duelLeave(w, a.id);
    expect(r).toMatchObject({ left: 'cancelled' });
    expect(r.note).toMatch(/match is off/);
    expect(w.duel.match).toBeNull();
    expect(w.duel.last).toHaveLength(0);
    expect(w.duel.ledger.pairs).toEqual({});
    expect(toMe(w, b, /match is off/)).toBe(true);
    expect(duelStatus(w, b.id).you).toMatchObject({ position: 1 }); // back at the front
    // the countdown too; then a real fight between the same two pays in full (no rematch wait)
    duelJoin(w, a.id);
    run(w, DUEL_BOW_S + 0.2);
    expect(w.duel.match?.phase).toBe('count');
    expect(duelLeave(w, b.id)).toMatchObject({ left: 'cancelled' });
    expect(w.duel.last).toHaveLength(0);
    duelJoin(w, b.id);
    run(w, DUEL_BOW_S + DUEL_COUNT_S + 0.2);
    expect(w.duel.match?.phase).toBe('fight');
    const rep = a.reputation;
    for (let i = 0; i < 30 && w.duel.match; i++) { w.damage(a.id, b.id, 30, 'arcane'); run(w, 0.1); }
    expect(w.duel.last.at(-1)).toMatchObject({ winner: a.id });
    expect(a.reputation).toBeGreaterThan(rep);
  });

  it('going offline before the fight calls it off too; leaving during the fight is a forfeit, and the reply says so', () => {
    const w = mk();
    const a = join(w, 'Luna', 'Ravenclaw'), b = join(w, 'Ginny');
    duelJoin(w, a.id); duelJoin(w, b.id);
    run(w, 0.1);
    a.connections = 0; a.lastMcpAt = -1e9;
    run(w, 0.1);
    expect(w.duel.match).toBeNull();
    expect(w.duel.last).toHaveLength(0);
    expect(toMe(w, b, /offline/)).toBe(true);
    a.connections = 1;
    const c = join(w, 'Fred');
    duelLeave(w, b.id);
    fight(w, a, c);
    const r = duelLeave(w, c.id);
    expect(r).toMatchObject({ left: 'forfeit' });
    expect(r.note).toMatch(/forfeit/);
    expect(w.duel.last.at(-1)).toMatchObject({ winner: a.id });
  });
});

describe('the queue says why it drops you', () => {
  it('Azkaban, going offline or the Quidditch pitch: taken off and told; a stun keeps your place', () => {
    const w = mk();
    const a = join(w, 'Neville'), b = join(w, 'Dean'), c = join(w, 'Seamus');
    a.year = 1; b.year = 5; c.year = 1;
    duelJoin(w, a.id);
    a.hp = 0; a.st.stunnedUntil = w.now + 3; // knocked out by a pixie while waiting
    run(w, 1);
    expect(duelStatus(w, a.id).you).toMatchObject({ position: 1 });
    duelJoin(w, b.id);
    b.st.jailedUntil = w.now + 60;
    run(w, 0.2);
    expect(duelStatus(w, b.id).you).toBeNull();
    expect(toMe(w, b, /taken off.*Azkaban/)).toBe(true);
    duelJoin(w, c.id);
    c.connections = 0; c.lastMcpAt = -1e9;
    run(w, 0.2);
    expect(duelStatus(w, c.id).you).toBeNull();
    expect(toMe(w, c, /taken off.*offline/)).toBe(true);
    // back on their feet, the stunned one is matched
    run(w, 3);
    const d = join(w, 'Hannah', 'Hufflepuff');
    duelJoin(w, d.id);
    run(w, 0.2);
    expect(w.duel.match).toMatchObject({ a: a.id, b: d.id });
  });
});

describe('club NPCs fight', () => {
  it('a sparring NPC closes in on a foe who backs away and lands blows', () => {
    const w = mk();
    ensureNpcs(w, 1);
    const a = join(w, 'Neville');
    duelJoin(w, a.id);
    run(w, DUEL_NPC_AFTER_S + DUEL_BOW_S + DUEL_COUNT_S + 0.5);
    const m = w.duel.match!;
    expect(m).toMatchObject({ phase: 'fight', npc: true });
    const npc = w.wizards.get(m.b)!;
    a.pos = { x: DUEL_STAGE.x - 12, z: DUEL_STAGE.z + 12 }; // 25 m from the NPC's end, still on the stage
    const far = Math.hypot(a.pos.x - npc.pos.x, a.pos.z - npc.pos.z);
    run(w, 3);
    expect(Math.hypot(a.pos.x - npc.pos.x, a.pos.z - npc.pos.z)).toBeLessThan(far - 4);
    run(w, 10);
    expect(m.stats[npc.id].dealt).toBeGreaterThan(0);
  });

  it('NPCs in a 2v2 deal damage', () => {
    const w = mk();
    ensureNpcs(w, 4);
    const a = join(w, 'Harry'), b = join(w, 'Ron');
    a.year = 3;
    duelJoin(w, a.id, '2v2'); duelJoin(w, b.id, '2v2');
    run(w, DUEL_NPC_AFTER_S + DUEL_BOW_S + DUEL_COUNT_S + 0.5);
    const m = w.duel.match!;
    expect(m.phase).toBe('fight');
    const npcs = m.sides.flat().filter((id) => w.wizards.get(id)!.npc);
    expect(npcs).toHaveLength(2);
    run(w, 8);
    for (const id of npcs) expect(m.stats[id]?.dealt ?? 0).toBeGreaterThan(0);
  });

  it('never drafts an NPC more than BULLY_YEAR_GAP years above the player', () => {
    const w = mk();
    ensureNpcs(w, 1);
    const npc = [...w.wizards.values()].find((x) => x.npc)!;
    npc.year = 6;
    const a = join(w, 'Firstie');
    duelJoin(w, a.id);
    run(w, DUEL_NPC_AFTER_S + 1);
    expect(w.duel.match).toBeNull();
    npc.year = 3;
    run(w, 0.2);
    expect(w.duel.match).toMatchObject({ a: a.id, b: npc.id, npc: true });
  });
});

describe('challenges and chosen partners', () => {
  it('join with a name waits for that wizard (no NPC, nobody else), who is told and accepts by joining', () => {
    const w = mk();
    ensureNpcs(w, 1);
    const a = join(w, 'Harry'), b = join(w, 'Draco', 'Slytherin'), c = join(w, 'Ron');
    duelJoin(w, a.id, '1v1', { with: 'Draco' });
    expect(toMe(w, b, /challenges you/)).toBe(true);
    expect(duelStatus(w, b.id).challengedBy).toEqual(['Harry']);
    expect(duelStatus(w, a.id).you).toMatchObject({ challenging: 'Draco' });
    duelJoin(w, c.id); // same year, plain join: not for Harry
    run(w, 1);
    expect(w.duel.match).toBeNull();
    duelLeave(w, c.id);
    run(w, DUEL_NPC_AFTER_S + 5);
    expect(w.duel.match).toBeNull(); // no NPC for a challenge
    duelJoin(w, b.id, '1v1', { with: 'Harry' });
    run(w, 0.1);
    expect(w.duel.match).toMatchObject({ a: a.id, b: b.id, npc: false });
  });

  it('a plain join by the one challenged accepts; an unanswered challenge lapses, told', () => {
    const w = mk();
    const a = join(w, 'Cho', 'Ravenclaw'), b = join(w, 'Cedric', 'Hufflepuff'), c = join(w, 'Luna', 'Ravenclaw');
    duelJoin(w, a.id, '1v1', { with: b.handle });
    duelJoin(w, b.id);
    run(w, 0.1);
    expect(w.duel.match).toMatchObject({ a: a.id, b: b.id });
    duelLeave(w, a.id); // (cancelled in the bow)
    duelLeave(w, b.id);
    duelJoin(w, c.id, '1v1', { with: 'Cedric' });
    run(w, DUEL_CHALLENGE_S + 0.5);
    expect(duelStatus(w, c.id).you).toBeNull();
    expect(toMe(w, c, /did not take up your challenge/)).toBe(true);
  });

  it('refuses yourself, an NPC, a stranger and a registry number', () => {
    const w = mk();
    ensureNpcs(w, 1);
    const a = join(w, 'Harry'), b = join(w, 'Ron');
    expect(() => duelJoin(w, a.id, '1v1', { with: 'Harry' })).toThrow(/yourself/);
    expect(() => duelJoin(w, a.id, '1v1', { with: 'Seamus Finnigan' })).toThrow(/NPC/);
    expect(() => duelJoin(w, a.id, '1v1', { with: 'Nobody' })).toThrow(/no wizard/);
    expect(() => duelJoin(w, a.id, '1v1', { with: b.id })).toThrow(/no wizard/);
    expect(() => duelJoin(w, a.id, '2v2', { with: 'Ron' })).toThrow(/partner/);
  });

  it('a chosen 2v2 partner is on your side, whatever the years; a pair gets NPC foes after the wait', () => {
    const w = mk();
    const [p1, p2, p3, p4] = ['Fred', 'George', 'Lee', 'Angelina'].map((n) => join(w, n));
    p1.year = 5; p2.year = 4; p3.year = 2; p4.year = 1; // balanced would be 5+1 against 4+2
    duelJoin(w, p1.id, '2v2', { partner: 'George' });
    expect(toMe(w, p2, /partner/)).toBe(true);
    duelJoin(w, p3.id, '2v2'); duelJoin(w, p4.id, '2v2');
    run(w, 0.5);
    expect(w.duel.match).toBeNull(); // George has not joined yet
    duelJoin(w, p2.id, '2v2');
    run(w, 0.1);
    const m = w.duel.match!;
    expect(new Set(m.sides[0])).toEqual(new Set([p1.id, p2.id]));
    expect(new Set(m.sides[1])).toEqual(new Set([p3.id, p4.id]));

    const w2 = mk();
    ensureNpcs(w2, 4);
    const x = join(w2, 'Harry'), y = join(w2, 'Hermione');
    duelJoin(w2, x.id, '2v2', { partner: 'Hermione' });
    duelJoin(w2, y.id, '2v2', { partner: 'Harry' });
    run(w2, DUEL_NPC_AFTER_S + 0.5);
    const m2 = w2.duel.match!;
    expect(new Set(m2.sides[0])).toEqual(new Set([x.id, y.id]));
    expect(m2.sides[1].every((id) => w2.wizards.get(id)!.npc)).toBe(true);
  });
});

describe('a bolt sent back by a perfect Protego scores for its sender', () => {
  it('counts when it is sent back, even if it is then shielded, and a landing does not count it twice', () => {
    const w = mk();
    const a = join(w, 'Harry'), b = join(w, 'Draco', 'Slytherin');
    fight(w, a, b);
    const m = w.duel.match!;
    armWard(w, b.id);
    a.st.shield = 999; a.st.shieldUntil = w.now + 20; a.st.shieldAt = -1e9; // Harry's plain Protego soaks the return
    expect(w.cast(a.id, 'Stupefy', { target: b.handle }).ok).toBe(true);
    run(w, 2);
    expect(b.stats.reflects).toBe(1);
    expect(a.hp).toBe(w.derivedOf(a).maxHp);
    expect(m.stats[b.id].returned).toBeGreaterThan(0);
    expect(m.stats[b.id].dealt).toBeCloseTo(m.stats[b.id].returned!);
    expect(m.stats[a.id].dealt).toBe(0);
    // now it lands: counted once
    a.st.shield = 0; a.st.shieldUntil = 0;
    run(w, 8.5); // the ward recharges
    b.st.shieldUntil = 0; b.st.shield = 0;
    armWard(w, b.id);
    const before = m.stats[b.id].dealt, hp = a.hp;
    w.cast(a.id, 'Stupefy', { target: b.handle });
    run(w, 2);
    expect(b.stats.reflects).toBe(2);
    expect(a.hp).toBeLessThan(hp);
    expect(m.stats[b.id].dealt - before).toBeCloseTo(hp - a.hp, 0);
    expect(duelStatus(w, a.id).match?.hp.find((h) => h?.name === 'Draco')).toMatchObject({ sentBack: expect.any(Number) });
  });
});

describe('status `last` shows both sides in full', () => {
  it('a 2v2 lists all four and the winning pair', () => {
    const w = mk();
    const [p1, p2, p3, p4] = ['Harry', 'Ron', 'Draco', 'Goyle'].map((n) => join(w, n));
    for (const p of [p1, p2, p3, p4]) { p.year = 3; duelJoin(w, p.id, '2v2'); }
    run(w, DUEL_BOW_S + DUEL_COUNT_S + 0.3);
    const m = w.duel.match!;
    const [s0, s1] = m.sides;
    for (const id of s1) w.damage(s0[0], id, 10_000, 'arcane');
    run(w, 0.1);
    const last = duelStatus(w, p1.id).last[0];
    const nm = (id: string) => w.wizards.get(id)!.name;
    expect(last).toMatchObject({ a: `${nm(s0[0])} & ${nm(s0[1])}`, b: `${nm(s1[0])} & ${nm(s1[1])}`, winner: `${nm(s0[0])} & ${nm(s0[1])}` });
  });
});

describe('reflexes aim at wizards by handle', () => {
  it("the duelist preset's Stupefy reaches a duel opponent (a registry number used to be refused)", () => {
    const w = mk();
    const a = join(w, 'Harry'), b = join(w, 'Draco', 'Slytherin');
    fight(w, a, b);
    setReflexes(w, a.id, PRESETS.duelist.build((s) => !!w.findSpell(a, s)));
    b.pos = { x: a.pos.x + 8, z: a.pos.z };
    const casts = a.stats.casts;
    run(w, 1);
    expect(a.stats.casts).toBeGreaterThan(casts);
  });
});

describe('the battery joke', () => {
  it('only on a nearly empty wand, once per dry spell', () => {
    const w = mk();
    const a = join(w, 'Neville');
    a.pos = { x: 60, z: 60 };
    const joke = /battery|Mana is empty/; // FIZZLE_QUIPS.mana
    const quipped = (r: { notes: string[] }) => r.notes.some((n) => joke.test(n));
    const told = () => w.events.filter((e) => e.to === a.id && joke.test(e.text)).length;
    a.mana = 1;
    const reps = Array.from({ length: 6 }, () => w.cast(a.id, 'Stupefy'));
    expect(reps.every((r) => /not enough mana/.test(r.error ?? ''))).toBe(true);
    expect(reps.filter(quipped)).toHaveLength(1);
    expect(told()).toBe(1);
    // still dry half a minute later (a reflex retrying on an empty wand): no second joke
    for (let i = 0; i < 32; i++) { a.mana = 1; run(w, 1); }
    a.mana = 1;
    expect(quipped(w.cast(a.id, 'Stupefy'))).toBe(false);
    expect(told()).toBe(1);
    // refilled, then dry again: a new dry spell
    a.mana = w.derivedOf(a).maxMana;
    run(w, 0.1);
    a.mana = 1;
    expect(quipped(w.cast(a.id, 'Stupefy'))).toBe(true);
    // not while the wand still holds plenty (the spell just costs more than what is left)
    const b = join(w, 'Dean');
    b.pos = { x: 60, z: 62 };
    b.mana = w.derivedOf(b).maxMana * 0.3;
    w.forgeSpell(b.id, { name: 'Big Bang', source: '(do (bolt aim 16) (bolt aim 16) (bolt aim 16) (bolt aim 16))' });
    const r = w.cast(b.id, 'Big Bang');
    expect(r.error).toMatch(/not enough mana/);
    expect(quipped(r)).toBe(false);
  });
});

describe('through the MCP tool', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function player(world: World, name: string, house: string): Promise<{ w: Wizard; call: (n: string, a?: Record<string, unknown>) => Promise<{ err: boolean; v: any }> }> {
    const server = createMcpServer(world, { wizardId: null, baseUrl: 'http://duel3' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const c = new Client({ name: 'duel3-agent', version: '0' });
    await c.connect(ct);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = async (n: string, a: Record<string, unknown> = {}): Promise<{ err: boolean; v: any }> => {
      const r = (await c.callTool({ name: n, arguments: a })) as { content: { text: string }[]; isError?: boolean };
      let v: unknown = r.content[0].text;
      try { v = JSON.parse(r.content[0].text); } catch { /* plain text */ }
      return { err: !!r.isError, v };
    };
    const r = await call('enroll', { name, house_preference: house });
    expect(r.err).toBe(false);
    const w = world.wizards.get(r.v.registry)!;
    w.connections = 1; w.createdAt = -1e6; w.pos = { x: DUEL_STAGE.x, z: DUEL_STAGE.z + 6 };
    return { w, call };
  }

  it('duel_club join with a name challenges; the other accepts by naming back; leave in the bow calls it off', async () => {
    const world = mk();
    world.rules.events.pool = [];
    world.term.endsAt = 1e12;
    const ada = await player(world, 'Ada Quill', 'Ravenclaw'), bram = await player(world, 'Bram Oakes', 'Gryffindor');
    const j = await ada.call('duel_club', { op: 'join', with: 'Bram Oakes' });
    expect(j.err).toBe(false);
    expect(j.v.you).toMatchObject({ challenging: 'Bram Oakes', secondsLeft: DUEL_CHALLENGE_S });
    expect((await bram.call('duel_club', { op: 'status' })).v.challengedBy).toEqual(['Ada Quill']);
    const ev = (await bram.call('events', { limit: 50 })).v as { text: string; private: boolean }[];
    expect(ev.some((e) => e.private && /Ada Quill challenges you/.test(e.text))).toBe(true);
    await bram.call('duel_club', { op: 'join', with: 'Ada Quill' });
    run(world, 0.1);
    expect(world.duel.match).toMatchObject({ a: ada.w.id, b: bram.w.id, phase: 'bow' });
    const l = await bram.call('duel_club', { op: 'leave' });
    expect(l.v).toMatchObject({ left: 'cancelled' });
    expect(world.duel.match).toBeNull();
    expect((await ada.call('duel_club', { op: 'status' })).v.you).toMatchObject({ position: 1 });
  });
});
