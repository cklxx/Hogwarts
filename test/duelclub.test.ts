/** 决斗俱乐部 (src/kernel/duelclub.ts): queue, match flow, isolation, bounded rewards. */
import { describe, expect, it } from 'vitest';
import {
  DUEL_ANY_AFTER_S, DUEL_BOW_S, DUEL_COUNT_S, DUEL_ENDS, DUEL_FIGHT_S, DUEL_LEASH, DUEL_NPC_AFTER_S, DUEL_PAIR_GAP_S, DUEL_STAGE, DUEL_TERM_CAP, DUEL_WIN_REP,
  duelGrant, duelJoin, duelLeave, duelStatus,
} from '../src/kernel/duelclub.js';
import { ensureNpcs } from '../src/kernel/npc.js';
import { World } from '../src/kernel/world.js';
import type { Wizard } from '../src/kernel/types.js';

function mk() {
  const w = new World({ seed: 21, secret: 'duelclub' });
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
const bolt = (w: World, a: Wizard, b: Wizard, power = 30) => w.spawnProjectile(a, 'bolt', b.pos, b.id, power, 'arcane', 0, []);
/** Queue two and run them into the fight. */
function fight(w: World, a: Wizard, b: Wizard) {
  duelJoin(w, a.id); duelJoin(w, b.id);
  run(w, 0.1);
  expect(w.duel.match).toMatchObject({ a: a.id, b: b.id, phase: 'bow' });
  run(w, DUEL_BOW_S + DUEL_COUNT_S + 0.1);
  expect(w.duel.match?.phase).toBe('fight');
}

describe('the Duelling Club', () => {
  it('pairs the queue, places and heals both, and holds them still through the bow and the countdown', () => {
    const w = mk();
    const a = join(w, 'Harry'), b = join(w, 'Ron'); // housemates: a duel, not PvP
    a.hp = 10;
    duelJoin(w, a.id); duelJoin(w, b.id);
    run(w, 0.1);
    expect(a.pos).toEqual(DUEL_ENDS[0]);
    expect(b.pos).toEqual(DUEL_ENDS[1]);
    expect(a.hp).toBe(w.derivedOf(a).maxHp);
    const spell = a.spells[0];
    expect(w.cast(a.id, spell.id, { target: b.id }).ok).toBe(false); // bowing
    w.setInput(a.id, 1, 0);
    run(w, 1);
    expect(a.pos).toEqual(DUEL_ENDS[0]);
    run(w, DUEL_BOW_S + DUEL_COUNT_S);
    expect(w.duel.match?.phase).toBe('fight');
  });

  it('lets the two harm each other whatever their houses, keeps everyone else out, and ends on a knock-out without a stun', () => {
    const w = mk();
    const a = join(w, 'Harry'), b = join(w, 'Ron'), c = join(w, 'Draco', 'Slytherin');
    w.rules.combat.friendlyFire = false;
    expect(w.canHarm(a.id, b.id)).toBe(false); // housemates, no friendly fire
    fight(w, a, b);
    expect(w.canHarm(a.id, b.id)).toBe(true);
    expect(w.canHarm(c.id, a.id)).toBe(false); // no interference
    expect(w.canHarm(a.id, c.id)).toBe(false);
    const hp = b.hp;
    w.heal(c, b, 50); // no help from the crowd either
    expect(b.hp).toBe(hp);
    for (let i = 0; i < 6 && w.duel.match; i++) { bolt(w, a, b); run(w, 0.6); }
    expect(w.duel.match).toBeNull();
    expect(b.st.stunnedUntil).toBe(0); // no Hospital Wing
    expect(b.hp).toBe(w.derivedOf(b).maxHp); // both healed after
    expect(w.duel.last.at(-1)).toMatchObject({ winner: a.id });
    expect(w.events.some((e) => e.type === 'duel' && /战胜/.test(e.zh ?? ''))).toBe(true);
  });

  it('pays the winner once per pair per gap, at most DUEL_TERM_CAP rewarded wins a term', () => {
    const l = { term: 0, wins: {}, pairs: {} };
    expect(duelGrant(l, 'a', 'b', 0, 1, false)).toMatchObject({ rep: DUEL_WIN_REP, why: 'ok' });
    expect(duelGrant(l, 'a', 'b', 10, 1, false)).toMatchObject({ rep: 0, xpWinner: 0, why: 'rematch' });
    expect(duelGrant(l, 'b', 'a', DUEL_PAIR_GAP_S + 1, 1, false)).toMatchObject({ rep: DUEL_WIN_REP });
    let total = DUEL_WIN_REP;
    for (let i = 0; i < 20; i++) total += duelGrant(l, 'a', `x${i}`, 20, 1, false).rep;
    expect(total).toBe(DUEL_TERM_CAP * DUEL_WIN_REP); // capped
    expect(duelGrant(l, 'a', 'y', 30, 2, false).rep).toBe(DUEL_WIN_REP); // a new term
    expect(duelGrant(l, 'a', 'npc', 40, 2, true)).toMatchObject({ rep: 0, why: 'npc' });
  });

  it('gives a lone wizard an NPC to spar with after a while, and the NPC fights back', () => {
    const w = mk();
    ensureNpcs(w, 1);
    const a = join(w, 'Neville');
    duelJoin(w, a.id);
    run(w, DUEL_NPC_AFTER_S + 0.2);
    const m = w.duel.match!;
    expect(m).toMatchObject({ a: a.id, npc: true });
    run(w, DUEL_BOW_S + DUEL_COUNT_S + 4);
    expect(a.hp).toBeLessThan(w.derivedOf(a).maxHp);
  });

  it('forfeits whoever walks off the stage or leaves; the bell decides a stalemate', () => {
    const w = mk();
    const a = join(w, 'Cho', 'Ravenclaw'), b = join(w, 'Cedric', 'Hufflepuff');
    fight(w, a, b);
    a.pos = { x: DUEL_STAGE.x + DUEL_LEASH + 3, z: DUEL_STAGE.z };
    run(w, 0.1);
    expect(w.duel.last.at(-1)).toMatchObject({ winner: b.id });
    const c = join(w, 'Luna', 'Ravenclaw'), d = join(w, 'Ginny');
    fight(w, c, d);
    const rep = c.reputation;
    duelLeave(w, d.id);
    expect(w.duel.last.at(-1)).toMatchObject({ winner: c.id });
    expect(c.reputation).toBe(rep); // no blow landed: a walk-off pays nothing
    expect(w.duel.ledger.wins[c.id] ?? 0).toBe(0);
    const e = join(w, 'Fred'), f = join(w, 'George', 'Slytherin');
    fight(w, e, f);
    bolt(w, e, f, 8); // one hit, then a stand-off: the bell goes to whoever dealt more
    run(w, DUEL_FIGHT_S + 0.2);
    expect(w.duel.last.at(-1)).toMatchObject({ winner: e.id });
  });

  it('pairs close years first, and anyone once the first in the queue has waited', () => {
    const w = mk();
    const a = join(w, 'First'), far = join(w, 'Senior', 'Slytherin'), near = join(w, 'Peer', 'Hufflepuff');
    far.year = 5; a.year = 1; near.year = 2;
    duelJoin(w, a.id); duelJoin(w, far.id);
    run(w, 1);
    expect(w.duel.match).toBeNull(); // four years apart: not yet
    duelJoin(w, near.id);
    run(w, 0.1);
    expect(w.duel.match).toMatchObject({ a: a.id, b: near.id });
    const w2 = mk();
    const x = join(w2, 'Alone'), y = join(w2, 'Elder', 'Slytherin');
    y.year = 6;
    duelJoin(w2, x.id); duelJoin(w2, y.id);
    run(w2, DUEL_ANY_AFTER_S + 0.2);
    expect(w2.duel.match).toMatchObject({ a: x.id, b: y.id });
  });

  it('is closed while PvP is off or the stage lies in a safe zone', () => {
    const w = mk();
    const a = join(w, 'Percy');
    w.rules.combat.pvp = false;
    expect(() => duelJoin(w, a.id)).toThrow(/PvP|禁止/);
    w.rules.combat.pvp = true;
    w.rules.combat.safeZones = ['great_hall', 'courtyard'];
    expect(() => duelJoin(w, a.id)).toThrow(/安全区|safe zone/);
    expect(duelStatus(w, a.id).closed).toBeTruthy();
  });

  it('keeps the term\'s reward ledger across a restart', () => {
    const w = mk();
    duelGrant(w.duel.ledger, 'a', 'b', w.now, w.term.n, false);
    const back = World.restore(JSON.parse(JSON.stringify(w.serialize())));
    expect(back.duel.ledger.wins).toEqual({ a: 1 });
  });
});

describe('the duel slip (client/panels/duel.ts) reads what the kernel sends', () => {
  it('shows the match from the snapshot `du`, and your queue place from the status reply', async () => {
    const { duelLine } = await import('../client/panels/duel.js');
    const w = mk();
    const a = join(w, 'Harry'), b = join(w, 'Ron');
    duelJoin(w, a.id);
    const st = duelStatus(w, a.id);
    expect(duelLine(undefined, st, () => '?', a.handle)?.sub).toMatch(/1/);
    duelJoin(w, b.id);
    run(w, 0.1);
    const du = (w.snapshot() as { du?: unknown }).du as Parameters<typeof duelLine>[0];
    const names = (h: string | undefined) => (h === a.handle ? a.name : h === b.handle ? b.name : '?');
    const line = duelLine(du, null, names, a.handle)!;
    expect(line).toMatchObject({ title: 'Harry ⚔ Ron', mine: true });
    expect(duelLine(du, null, names, 'someone')?.mine).toBe(false);
  });
});
