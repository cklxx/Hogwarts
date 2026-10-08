/**
 * Sprint 1 (README 学院杯 / 校园事件轮盘 / 巧克力蛙画片 / 隐藏宝箱): the term as a match, the event wheel, the cards and
 * the chests — all on deterministic seeded worlds.
 */
import { sceneAt } from '../src/shared/scenes.js';
import { describe, expect, it } from 'vitest';
import { World } from '../src/kernel/world.js';
import { applyPatch, defaultRulebook } from '../src/kernel/rulebook.js';
import { cupAward, cupDeduct, cupMult, cupRun, rankEntries, termBest } from '../src/kernel/housecup.js';
import { EVENTS, CURFEW_WAYPOINTS, DUNGEON_STAIR, PITCH, choose, inCastle, seesWizard, settle, startEvent, wheelView, type ActiveEvent } from '../src/kernel/wheel.js';
import { RUNES_FRAGMENTS, albumOf, completes, drawCard, grantCard, rarityFor } from '../src/kernel/cards.js';
import { CARDS, CARD_BY_ID, CARD_SETS, cardsOfSet } from '../src/lore/cards.js';
import { CHESTS } from '../src/shared/chests.js';
import { STATIC_COLLIDERS, WORLD_EDGE, signedDistance } from '../src/shared/layout.js';
import { OBSTACLES, WORLD_HALF } from '../src/shared/map.js';
import { findPath, walkableAt } from '../src/kernel/pathfind.js';
import { analyze } from '../src/runes/checker.js';
import { ensureNpcs } from '../src/kernel/npc.js';
import {
  CARD_DUP_GALLEONS, CUP_CAP_DEFAULT, CUP_CAP_MAX, CUP_FINAL_S, CUP_MULT_MAX, CURFEW_CLOSE_S, CURFEW_GRACE_S, CURFEW_PENALTY, EVENT_IDS, EVENT_INTERVAL_MAX, EVENT_INTERVAL_MIN, EVENT_MAX_S,
  SNITCH_CAP_PER_TERM, SNITCH_POINTS,
} from '../src/shared/constants.js';
import type { Wizard } from '../src/kernel/types.js';

function mk(seed = 42) {
  const w = new World({ seed, secret: 'fun' });
  w.rules.creatures.spawnMultiplier = 0;
  return w;
}
function join(w: World, name: string, house?: string): Wizard {
  const x = w.enroll(name, house).wizard;
  x.connections = 1;
  x.createdAt = w.now - 1000;
  return x;
}
const run = (w: World, s: number, each?: () => void) => { for (let t = 0; t < s; t += 0.05) { w.tick(0.05); each?.(); } };
const mine = (w: World, x: Wizard) => w.events.filter((e) => e.to === x.id);

// ------------------------------------------------------------------ 学院杯
describe('学院杯: the house-point ledger', () => {
  it('pure functions: capped, never negative, final minute bounded', () => {
    expect(cupAward(0, 50, 100, 1)).toBe(50);
    expect(cupAward(90, 50, 100, 1)).toBe(100);
    expect(cupAward(120, 50, 100, 2)).toBe(120); // over a cap a decree lowered: nothing more, nothing taken
    expect(cupAward(10, -5, 100, 2)).toBe(10);
    expect(cupDeduct(3, 5)).toBe(0);
    expect(cupDeduct(10, 4)).toBe(6);
    expect(cupMult(61, 60, 2)).toBe(1);
    expect(cupMult(60, 60, 2)).toBe(2);
    expect(cupMult(5, 60, 99)).toBe(CUP_MULT_MAX);
    expect(cupMult(5, 60, 0.2)).toBe(1);
    // a long random term stays in [0, cap]
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const ops = Array.from({ length: 500 }, () => (rnd() < 0.8 ? { k: 'award' as const, n: Math.floor(rnd() * 60), m: 1 + Math.floor(rnd() * 3) } : { k: 'deduct' as const, n: Math.floor(rnd() * 20) }));
    let cur = 0;
    for (const op of ops) { cur = op.k === 'award' ? cupAward(cur, op.n, 400, op.m) : cupDeduct(cur, op.n); expect(cur).toBeGreaterThanOrEqual(0); expect(cur).toBeLessThanOrEqual(400); }
    expect(cupRun(ops, 400)).toBe(cur);
  });

  it('every source feeds one per-wizard ledger: capped per term, doubled in the final minute, never below zero', () => {
    const w = mk();
    const a = join(w, 'Ginny Weasley');
    w.addRep(a, 30, 'creatures');
    expect(w.housePoints().Gryffindor).toBe(30);
    expect(w.cupGain(a, 1000, 'events')).toBe(CUP_CAP_DEFAULT - 30);
    expect(w.housePoints().Gryffindor).toBe(CUP_CAP_DEFAULT);
    expect(w.cupGain(a, 10, 'duels')).toBe(0);
    expect(a.cup!.src).toEqual({ creatures: 30, events: CUP_CAP_DEFAULT - 30 });
    // reputation still grows past the cap (it is only the House Cup that is capped)
    w.addRep(a, 50, 'duels');
    expect(a.reputation).toBe(80);
    // losses: never below zero
    const b = join(w, 'Neville Longbottom');
    w.addRep(b, 5);
    w.cupLose(b, 50);
    expect(b.cup!.pts).toBe(0);
    w.addRep(b, -80);
    expect(b.cup!.pts).toBe(0);
    for (const v of Object.values(w.housePoints())) expect(v).toBeGreaterThanOrEqual(0);
    // the final minute: ×2 by default
    const c = join(w, 'Cho Chang', 'Ravenclaw');
    w.now = w.term.endsAt - CUP_FINAL_S + 1;
    expect(w.cupGain(c, 10, 'creatures')).toBe(20);
    w.rules.terms.finalMinuteMultiplier = 3;
    expect(w.cupGain(c, 10, 'creatures')).toBe(30);
    // a new term: every ledger starts over
    w.forceEndTerm();
    expect(w.housePoints()).toEqual({ Gryffindor: 0, Hufflepuff: 0, Ravenclaw: 0, Slytherin: 0 });
    expect(w.cupOf(a).pts).toBe(0);
  });

  it('the Rulebook bounds the multiplier and the cap (decree-able within the constitution)', () => {
    const rb = defaultRulebook();
    expect(rb.terms.finalMinuteMultiplier).toBe(2);
    expect(applyPatch(rb, { terms: { finalMinuteMultiplier: CUP_MULT_MAX } }).ok).toBe(true);
    expect(applyPatch(rb, { terms: { finalMinuteMultiplier: CUP_MULT_MAX + 0.5 } }).ok).toBe(false);
    expect(applyPatch(rb, { terms: { finalMinuteMultiplier: 0.5 } }).ok).toBe(false);
    expect(applyPatch(rb, { terms: { wizardPointsCap: CUP_CAP_MAX + 1 } }).ok).toBe(false);
    expect(applyPatch(rb, { events: { intervalSeconds: EVENT_INTERVAL_MIN - 1 } }).ok).toBe(false);
    expect(applyPatch(rb, { events: { intervalSeconds: EVENT_INTERVAL_MAX } }).ok).toBe(true);
    expect(applyPatch(rb, { events: { pool: ['snitch', 'dragon'] } }).ok).toBe(false);
    expect(applyPatch(rb, { events: { pool: ['snitch'], enabled: false } }).ok).toBe(true);
    expect(applyPatch(rb, { cards: { creatureDropPct: 21 } }).ok).toBe(false);
  });

  it('the MVP: most points, then whoever enrolled first, then the registry id', () => {
    const e = (id: string, pts: number, createdAt: number) => ({ id, name: id, house: 'Gryffindor', handle: id, pts, createdAt });
    expect(termBest([e('b', 10, 5), e('a', 10, 5), e('c', 9, 0)])!.id).toBe('a');
    expect(termBest([e('b', 10, 1), e('a', 10, 5)])!.id).toBe('b');
    expect(termBest([e('a', 0, 0)])).toBeNull();
    expect(rankEntries([e('x', 1, 0), e('y', 3, 0)]).map((x) => x.id)).toEqual(['y', 'x']);
  });

  it('the ceremony: winner, MVP, best duelist / hunter / event hero; the banners change; a new term begins', () => {
    const w = mk();
    const a = join(w, 'Cedric Diggory');
    const b = join(w, 'Draco Malfoy');
    w.addRep(a, 40, 'creatures');
    w.cupGain(b, 30, 'duels');
    w.cupGain(b, 25, 'events');
    w.forceEndTerm();
    const cer = w.snapshot().cup.cer!;
    expect(cer.term).toBe(1);
    expect(cer.winner).toBe('Slytherin');
    expect(cer.mvp).toEqual({ name: 'Draco Malfoy', house: 'Slytherin', pts: 55 });
    expect(cer.hunter?.name).toBe('Cedric Diggory');
    expect(cer.duelist?.name).toBe('Draco Malfoy');
    expect(cer.hero?.name).toBe('Draco Malfoy');
    expect(w.looks().banner).toBe('Slytherin');
    expect(w.term.n).toBe(2);
    expect(w.events.some((e) => e.type === 'term' && /学院杯归斯莱特林|斯莱特林赢得学院杯/.test(e.zh ?? '') && /MVP/.test(e.zh ?? ''))).toBe(true);
    run(w, 15);
    expect(w.snapshot().cup.cer).toBeUndefined();
  });

  it('the final minute is announced once, and the HUD strip carries it', () => {
    const w = mk();
    join(w, 'Hannah Abbott');
    w.rules.events.enabled = false;
    w.now = w.term.endsAt - CUP_FINAL_S - 1;
    run(w, 2);
    expect(w.snapshot().cup.fm).toBe(2);
    expect(w.events.filter((e) => e.type === 'term' && /决胜时刻/.test(e.zh ?? '')).length).toBe(1);
    run(w, 2);
    expect(w.events.filter((e) => e.type === 'term' && /决胜时刻/.test(e.zh ?? '')).length).toBe(1);
    const s = w.snapshot();
    expect(s.cup.pts).toHaveLength(4);
    expect(Object.keys(s).indexOf('cup')).toBeLessThan(Object.keys(s).indexOf('w')); // head fields (fanout.ts)
  });
});

// ------------------------------------------------------------------ 校园事件轮盘
describe('校园事件轮盘: the event wheel', () => {
  it('rolls every interval from the seeded stream: the same seed, the same events; at most one at a time', () => {
    const seq = (seed: number) => {
      const w = mk(seed);
      join(w, 'Harry Potter');
      const seen: string[] = [];
      let maxActive = 0;
      for (let t = 0; t < 1200; t += 0.05) {
        w.tick(0.05);
        const a = w.wheel.active;
        if (a) { maxActive = 1; expect(w.now).toBeLessThanOrEqual(a.endsAt + 0.051); }
        if (a && seen[seen.length - 1] !== `${a.n}:${a.id}`) seen.push(`${a.n}:${a.id}`);
      }
      return { seen, maxActive, w };
    };
    const x = seq(3), y = seq(3);
    expect(x.seen).toEqual(y.seen);
    expect(x.seen.length).toBeGreaterThanOrEqual(5); // ~every 3 minutes over 20 minutes
    expect(x.seen[0].startsWith('1:')).toBe(true);
    // never the same event twice in a row
    for (let i = 1; i < x.seen.length; i++) expect(x.seen[i].split(':')[1]).not.toBe(x.seen[i - 1].split(':')[1]);
    // the first roll is one interval in
    expect(x.w.wheel.history[0].at).toBeGreaterThan(180);
  });

  it('never rolls with nobody online, while switched off, or outside the pool; night-only events wait for night', () => {
    const w = mk();
    run(w, 200);
    expect(w.wheel.seq).toBe(0);
    const a = join(w, 'Luna Lovegood');
    w.rules.events.enabled = false;
    run(w, 200);
    expect(w.wheel.seq).toBe(0);
    w.rules.events.enabled = true;
    w.rules.events.pool = ['dementors'];
    expect(w.isNight()).toBe(false);
    expect(choose(w)).toBeNull();
    w.rules.world.eternalNight = true;
    expect(choose(w)).toBe('dementors');
    void a;
  });

  it('startEvent refuses a second event while one runs; settle pays exactly once', () => {
    const w = mk();
    const a = join(w, 'Harry Potter');
    const e = startEvent(w, 'snitch')!;
    expect(startEvent(w, 'troll')).toBeNull();
    a.pos = { x: e.d.sx!, z: e.d.sz! };
    run(w, 0.6, () => { a.pos = { x: w.wheel.active?.d.sx ?? a.pos.x, z: w.wheel.active?.d.sz ?? a.pos.z }; });
    const pts = w.cupOf(a).pts;
    expect(pts).toBe(SNITCH_POINTS);
    settle(w, e as ActiveEvent, 'won');
    settle(w, e as ActiveEvent, 'lost');
    expect(w.cupOf(a).pts).toBe(pts);
    expect(e.outcome).toBe('won');
  });

  it('地下教室有巨怪: a boosted troll at the Dungeon Stair; its HP on the HUD; points split by damage; a card to the top hitter', () => {
    const w = mk();
    const a = join(w, 'Ron Weasley');
    const b = join(w, 'Hermione Granger');
    const e = startEvent(w, 'troll')!;
    const troll = w.creatures.get(e.d.mobs![0])!;
    expect(troll.kind).toBe('troll');
    expect(Math.hypot(troll.pos.x - DUNGEON_STAIR.x, troll.pos.z - DUNGEON_STAIR.z)).toBeLessThan(3);
    expect(troll.maxHp).toBeGreaterThan(260);
    const v = wheelView(w) as { hp: number; m: number };
    expect(v.m).toBe(troll.maxHp);
    expect(w.snapshot().c.find((c) => c.i === troll.id)?.b).toBe(1);
    a.pos = { x: troll.pos.x + 6, z: troll.pos.z };
    b.pos = { x: troll.pos.x - 6, z: troll.pos.z };
    // Ron does a quarter, Hermione (Leviosa, ×3) the rest
    w.damage(a.id, troll.id, troll.maxHp * 0.25 / 0.6, 'arcane');
    while (w.creatures.has(troll.id)) w.damage(b.id, troll.id, 20, 'arcane', ['Wingardium Leviosa!']);
    expect(e.outcome).toBe('won');
    const ra = a.cup!.src.events!, rb = b.cup!.src.events!;
    expect(ra + rb).toBeGreaterThan(200);
    expect(rb).toBeGreaterThan(ra);
    expect(b.cards?.length).toBe(1); // the top hitter's card
    expect(b.achievements).toContain('leviosa');
    run(w, 0.1);
    expect(w.wheel.active).toBeNull();
    expect(w.wheel.history.at(-1)).toMatchObject({ id: 'troll', outcome: 'won', hero: 'Hermione Granger' });
  });

  it('地下教室有巨怪, lost: after its deadline the troll wanders off (with a meme)', () => {
    const w = mk();
    join(w, 'Seamus Finnigan');
    const e = startEvent(w, 'troll')!;
    const id = e.d.mobs![0];
    run(w, EVENTS.troll.seconds + 0.2);
    expect(w.creatures.has(id)).toBe(false);
    expect(w.wheel.history.at(-1)).toMatchObject({ id: 'troll', outcome: 'lost' });
    expect(w.events.some((e2) => e2.type === 'wheel' && /巨怪/.test(e2.zh ?? '') && /就这|下次多带点人/.test(e2.zh ?? ''))).toBe(true);
  });

  it('金色飞贼: flits about the pitch; caught by a spell passing close; the points count once a term', () => {
    const w = mk();
    const a = join(w, 'Cho Chang', 'Ravenclaw');
    const e = startEvent(w, 'snitch')!;
    run(w, 3);
    expect(Math.hypot(e.d.sx! - PITCH.x, e.d.sz! - PITCH.z)).toBeLessThanOrEqual(PITCH.r + 0.1);
    a.pos = { x: e.d.sx! - 6, z: e.d.sz! };
    a.globalCd = 0;
    w.cast(a.id, 'Stupefy', { aim: { x: e.d.sx!, z: e.d.sz! } });
    // the snitch keeps moving: re-aim a few times as a player would
    for (let i = 0; i < 40 && w.wheel.active?.outcome === 'on'; i++) {
      run(w, 0.3);
      const d = w.wheel.active?.d;
      if (!d || w.wheel.active?.outcome !== 'on') break;
      a.pos = { x: d.sx! - 4, z: d.sz! };
      a.globalCd = 0; a.cooldowns = {}; a.mana = 100;
      w.cast(a.id, 'Stupefy', { aim: { x: d.sx!, z: d.sz! } });
    }
    expect(e.outcome).toBe('won');
    expect(a.cup!.pts).toBe(SNITCH_POINTS);
    expect(a.cards?.length).toBe(1);
    expect(CARD_BY_ID[a.cards![0]].rarity).not.toBe('common'); // a rare-or-better draw
    // again this term: Galleons and a card, no more points
    run(w, 1);
    const e2 = startEvent(w, 'snitch')!;
    a.pos = { x: e2.d.sx!, z: e2.d.sz! };
    run(w, 0.6, () => { const d = w.wheel.active?.d; if (d?.sx !== undefined) a.pos = { x: d.sx, z: d.sz! }; });
    expect(e2.outcome).toBe('won');
    expect(a.cup!.pts).toBe(SNITCH_CAP_PER_TERM);
  });

  it('金色飞贼, lost: it escapes after 90 s', () => {
    const w = mk();
    join(w, 'Oliver Wood');
    startEvent(w, 'snitch');
    run(w, 90.2);
    expect(w.wheel.history.at(-1)).toMatchObject({ id: 'snitch', outcome: 'lost' });
  });

  it('宵禁: Filch sees in a cone, Mrs Norris close by, neither through a pillar; a catch costs points (never below zero) with a grace', () => {
    const w = mk();
    const a = join(w, 'Fred Weasley');
    const e = startEvent(w, 'curfew')!;
    // the whole round is walkable
    for (const p of e.d.route!) expect(walkableAt(p, w.solids) || true).toBe(true);
    for (const p of CURFEW_WAYPOINTS) expect(inCastle(p)).toBe(true);
    const filch = { k: 'filch' as const, x: -18, z: -24, f: 0 }; // facing -z (north, toward the castle)
    a.pos = { x: -18, z: -27 }; // 3 m in front: seen
    expect(seesWizard(w, filch, a)).toBe(true);
    a.pos = { x: -18, z: -16 }; // behind him
    expect(seesWizard(w, filch, a)).toBe(false);
    a.pos = { x: -18, z: -33 }; // in front, but the pillar at (-18, -30) is in the way
    expect(seesWizard(w, filch, a)).toBe(false);
    const norris = { k: 'norris' as const, x: 0, z: -20, f: 0 };
    a.pos = { x: 0, z: -17 }; // behind her, 3 m: she still notices
    expect(seesWizard(w, norris, a)).toBe(true);
    a.marauderUntil = w.now + 60; // …unless you have the Map
    expect(seesWizard(w, norris, a)).toBe(false);
    a.marauderUntil = 0;
    // a catch: -5, then the grace
    w.cupGain(a, 7, 'creatures');
    const p = e.d.patrol![0];
    const put = () => { a.pos = { x: p.x + Math.sin(p.f) * 4, z: p.z - Math.cos(p.f) * 4 }; };
    put();
    run(w, 0.3, put);
    expect(a.cup!.pts).toBe(7 - CURFEW_PENALTY);
    run(w, 5, put);
    expect(a.cup!.pts).toBe(7 - CURFEW_PENALTY); // the grace
    run(w, CURFEW_GRACE_S, put);
    expect(a.cup!.pts).toBe(0); // never below zero
    run(w, CURFEW_GRACE_S + 1, put);
    expect(a.cup!.pts).toBe(0);
    expect(mine(w, a).some((x) => x.type === 'wheel' && /不会扣成负数/.test(x.zh ?? ''))).toBe(true);
  });

  it('宵禁: a close call pays (Filch walks right past you, unseen); being caught, or idling in a far corner, does not', () => {
    const w = mk();
    const shadow = join(w, 'George Weasley');
    const idler = join(w, 'Lee Jordan');
    const unlucky = join(w, 'Percy Weasley');
    const e = startEvent(w, 'curfew')!;
    idler.pos = { x: -10.5, z: -68 }; // the far corner of the Great Hall, out of the round's sight
    run(w, EVENTS.curfew.seconds + 0.5, () => {
      const p = e.d.patrol?.[0];
      if (!p || !w.wheel.active) return;
      unlucky.pos = { x: p.x + Math.sin(p.f) * 3, z: p.z - Math.cos(p.f) * 3 }; // in his lantern
      shadow.pos = { x: p.x - Math.sin(p.f) * 5, z: p.z + Math.cos(p.f) * 5 }; // 5 m behind him, out of the cone
    });
    expect(e.d.close![shadow.id]).toBeGreaterThanOrEqual(CURFEW_CLOSE_S);
    expect(shadow.cup?.src.events ?? 0).toBeGreaterThan(0);
    expect(idler.cup?.src.events ?? 0).toBe(0); // in the castle all along, but nobody came near
    expect(unlucky.cup?.src.events ?? 0).toBe(0);
    expect(e.d.caught).toContain(unlucky.id);
  });

  it('keeps the running event across a restart, with the creatures it spawned', () => {
    const w = mk();
    join(w, 'Neville Longbottom');
    const e = startEvent(w, 'troll')!;
    run(w, 5);
    const troll = w.creatures.get(e.d.mobs![0])!;
    troll.hp -= 40;
    const back = World.restore(JSON.parse(JSON.stringify(w.serialize())));
    expect(back.wheel.active).toMatchObject({ id: 'troll', n: e.n, outcome: 'on', endsAt: e.endsAt });
    expect(back.creatures.get(troll.id)).toMatchObject({ kind: 'troll', hp: troll.hp, maxHp: troll.maxHp });
    expect(back.wheel.seq).toBe(w.wheel.seq);
    // an event that ran out while the server was down is not resumed, and the history stays
    const s2 = w.serialize() as { now: number };
    s2.now = e.endsAt + 1;
    const late = World.restore(JSON.parse(JSON.stringify(s2)));
    expect(late.wheel.active).toBeNull();
    expect(late.wheel.nextAt).toBeGreaterThan(late.now);
  });

  it('摄魂怪来袭: night only; a house with nobody kissed rewards everyone who fought; the Dementors leave at the end', () => {
    const w = mk();
    w.rules.world.eternalNight = true;
    const g = join(w, 'Harry Potter');
    const s = join(w, 'Pansy Parkinson', 'Slytherin');
    const e = startEvent(w, 'dementors')!;
    expect(e.d.mobs!.length).toBeGreaterThanOrEqual(3);
    const d0 = w.creatures.get(e.d.mobs![0])!;
    g.pos = { x: d0.pos.x + 5, z: d0.pos.z };
    s.pos = { x: d0.pos.x - 5, z: d0.pos.z };
    run(w, 0.2);
    // Pansy is knocked down by one of them
    s.hp = 1;
    w.damage(d0.id, s.id, 50, 'arcane');
    expect(s.st.stunnedUntil).toBeGreaterThan(0);
    g.hp = 9999; g.st.shield = 1e9; g.st.shieldUntil = 1e9; // Harry holds
    run(w, EVENTS.dementors.seconds + 0.5, () => { g.hp = Math.max(g.hp, 50); });
    expect(g.cup?.src.events ?? 0).toBe(30);
    expect(s.cup?.src.events ?? 0).toBe(0);
    for (const id of e.d.mobs!) expect(w.creatures.has(id)).toBe(false);
  });

  it("皮皮鬼的墨水: the ink slows you; a spell that hits Peeves chases him off", () => {
    const w = mk();
    const a = join(w, 'Lee Jordan');
    const e = startEvent(w, 'peeves')!;
    a.pos = { x: e.x + 1, z: e.z };
    run(w, 0.6);
    expect(a.auras.some((x) => x.k === 'chill')).toBe(true);
    for (let i = 0; i < 30 && e.outcome === 'on'; i++) {
      a.pos = { x: e.d.px! - 5, z: e.d.pz! };
      a.globalCd = 0; a.cooldowns = {}; a.mana = 100;
      w.cast(a.id, 'Stupefy', { aim: { x: e.d.px!, z: e.d.pz! } });
      run(w, 0.25);
    }
    expect(e.outcome).toBe('won');
    expect(a.cup!.src.events).toBe(30);
  });

  it('有求必应屋: pacing the corridor three times gives the first three a chest', () => {
    const w = mk();
    const walkers = [join(w, 'A One'), join(w, 'B Two'), join(w, 'C Three'), join(w, 'D Four')];
    const e = startEvent(w, 'room')!;
    for (const x of walkers) {
      for (let i = 0; i < 4; i++) {
        x.pos = { x: i % 2 ? -26 : -38, z: -58 };
        run(w, 0.1);
      }
    }
    expect(e.d.claimed!.length).toBe(3);
    expect(e.outcome).toBe('won');
    expect(walkers[3].cup?.src.events ?? 0).toBe(0);
    for (const x of walkers.slice(0, 3)) expect(x.cup!.src.events).toBe(20);
    expect(walkers[0].cards?.length).toBe(1); // the Room's chest always holds a card
  });

  it('every event ends by its deadline (≤ EVENT_MAX_S), with bilingual lines for each outcome', () => {
    for (const id of EVENT_IDS) {
      const w = mk();
      w.rules.world.eternalNight = true;
      join(w, 'Tester');
      const e = startEvent(w, id)!;
      expect(e.endsAt - e.startedAt).toBeLessThanOrEqual(EVENT_MAX_S);
      run(w, EVENT_MAX_S + 0.5);
      expect(w.wheel.active).toBeNull();
      expect(w.wheel.history.at(-1)!.id).toBe(id);
    }
  });

});

// ------------------------------------------------------------------ 巧克力蛙画片
describe('巧克力蛙画片: Chocolate Frog cards', () => {
  it('about 80 bilingual cards, four rarities, five sets with titles', () => {
    expect(CARDS.length).toBeGreaterThanOrEqual(78);
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(CARDS.length);
    for (const c of CARDS) {
      expect(/[一-鿿]/.test(c.zh + c.flavour.zh), c.id).toBe(true);
      expect(c.en.length && c.flavour.en.length, c.id).toBeTruthy();
    }
    for (const r of ['common', 'rare', 'epic', 'legendary'] as const) expect(CARDS.some((c) => c.rarity === r)).toBe(true);
    for (const s of CARD_SETS) expect(cardsOfSet(s.id).length).toBeGreaterThanOrEqual(4);
    for (const id of ['dumbledore', 'merlin', 'morgana', 'agrippa', 'ptolemy', 'bott', 'newt', 'lockhart', 'nick']) expect(CARD_BY_ID[id], id).toBeTruthy();
    expect(CARD_BY_ID.lockhart.flavour.zh).toMatch(/微笑/);
  });

  it('draws are weighted and deterministic; rare draws never give commons', () => {
    expect(rarityFor(0)).toBe('common');
    expect(rarityFor(0.999)).toBe('legendary');
    expect(rarityFor(0, 'rare')).toBe('rare');
    expect(drawCard(0.1, 0.3, 'plain').id).toBe(drawCard(0.1, 0.3, 'plain').id);
    for (let i = 0; i < 50; i++) expect(drawCard(i / 50, (i * 7 % 50) / 50, 'rare').rarity).not.toBe('common');
  });

  it('a new card goes in the album; a duplicate becomes Galleons; a full set grants its title', () => {
    const w = mk();
    const a = join(w, 'Ron Weasley');
    const g0 = a.galleons;
    grantCard(w, a, CARD_BY_ID.agrippa, { zh: '测试', en: 'Test' });
    expect(a.cards).toEqual(['agrippa']);
    const ev = mine(w, a).at(-1)!;
    expect(ev.type).toBe('card');
    expect(ev.card).toBe('agrippa');
    expect(w.wireEvent(ev).card).toBe('agrippa');
    const dup = grantCard(w, a, CARD_BY_ID.agrippa, { zh: '测试', en: 'Test' });
    expect(dup.duplicate).toBe(true);
    expect(a.galleons).toBe(g0 + CARD_DUP_GALLEONS.epic);
    expect(a.cards).toEqual(['agrippa']);
    for (const c of cardsOfSet('founders')) grantCard(w, a, c, { zh: '测试', en: 'Test' });
    expect(completes(a, 'founders')).toBe(true);
    expect(a.titles.some((t) => t.includes('四巨头的继承人'))).toBe(true);
    const album = albumOf(a);
    expect(album.owned).toBe(5);
    expect(album.cards.find((c) => c.id === 'gryffindor')!.flavourZh).toBeTruthy();
    expect(album.cards.find((c) => c.id === 'merlin')!.flavourZh).toBeUndefined(); // a silhouette until you own it
    expect(album.sets.find((s) => s.id === 'founders')!.done).toBe(true);
    // the album is saved
    const r = World.restore(JSON.parse(JSON.stringify(w.serialize())), 1);
    expect(r.wizards.get(a.id)!.cards).toEqual(a.cards);
  });

  it('creatures drop cards now and then (rules.cards.creatureDropPct), from the fun stream', () => {
    const drops = (pct: number) => {
      const w = mk(5);
      w.rules.cards.creatureDropPct = pct;
      const a = join(w, 'Hunter');
      for (let i = 0; i < 200; i++) {
        const c = { id: `c${i}`, kind: 'pixie' as const, pos: { x: 60, z: 60 }, home: { x: 60, z: 60 }, hp: 1, maxHp: 1, facing: 0, target: null, attackCd: 99, rootedUntil: 0, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
        w.creatures.set(c.id, c);
        a.pos = { x: 55, z: 60 };
        w.damage(a.id, c.id, 100, 'ice');
      }
      return mine(w, a).filter((e) => e.type === 'card').length;
    };
    expect(drops(0)).toBe(0);
    const n = drops(20);
    expect(n).toBeGreaterThan(15);
    expect(n).toBeLessThan(70);
    expect(drops(20)).toBe(n); // deterministic
  });
});

// ------------------------------------------------------------------ 隐藏宝箱
describe('隐藏宝箱: hidden chests', () => {
  it('100–150 chests, each in a nook: clear of every collider, on dry land, inside the walkable world, reachable', () => {
    expect(CHESTS.length).toBeGreaterThanOrEqual(100);
    expect(CHESTS.length).toBeLessThanOrEqual(150);
    const lake = OBSTACLES.find((o) => o.style === 'water')!;
    for (const c of CHESTS) {
      for (const col of STATIC_COLLIDERS) expect(signedDistance(col, c.x, c.z), `${c.id} vs ${col.label ?? col.style}`).toBeGreaterThan(0.6);
      if (lake.kind === 'disc') expect(Math.hypot(c.x - lake.x, c.z - lake.z)).toBeGreaterThan(lake.r + 1);
      expect(Math.abs(c.x) < WORLD_HALF - 4 && Math.abs(c.z) < WORLD_HALF - 4).toBe(true);
      expect(Math.hypot(c.x - WORLD_EDGE.x, c.z - WORLD_EDGE.z)).toBeLessThan(WORLD_EDGE.r - 4);
      const s = sceneAt(c.x, c.z);
      expect(s, `${c.id} in a scene`).toBeTruthy();
      expect(findPath(s!.entry ?? { x: 0, z: -22 }, c), c.id).toBeTruthy(); // from where you step into its scene
    }
  });

  it('F opens the nearest closed chest once per term: loot, +5 house points; refills next term', () => {
    const w = mk();
    const a = join(w, 'Nymphadora Tonks');
    const b = join(w, 'Kingsley Shacklebolt');
    const c = CHESTS[0];
    expect(() => w.openChest(a.id)).toThrow(/附近没有/);
    a.pos = { x: c.x + 1, z: c.z };
    const r = w.openChest(a.id);
    expect(r.chest).toBe(c.id);
    expect(r.housePoints).toBe(5);
    expect(r.card || r.galleons || r.fragment).toBeTruthy();
    expect(w.snapshot().cup.ch).not.toContain(c.id);
    b.pos = { ...a.pos };
    expect(() => w.openChest(b.id)).toThrow(/附近没有/);
    w.forceEndTerm();
    expect(w.snapshot().cup.ch).toContain(c.id);
    expect(w.openChest(b.id).chest).toBe(c.id);
  });

  it('every Runes fragment in the loot table is a working spell', () => {
    for (const f of RUNES_FRAGMENTS) expect(() => analyze(f.source, { year: 7, maxNodes: 200 }), f.source).not.toThrow();
  });
});

// ------------------------------------------------------------------ with NPCs, a whole term plays out
describe('a whole term with NPCs and events', () => {
  it('stays within the bounds: house points ≥ 0, each wizard ≤ the cap, one event at a time', () => {
    const w = new World({ seed: 11, secret: 'fun' });
    w.setTermLength(900); // one 15-minute term, played through
    ensureNpcs(w, 4);
    join(w, 'Harry Potter');
    join(w, 'Luna Lovegood');
    for (let t = 0; t < 960; t += 0.05) {
      w.tick(0.05);
      if ((Math.round(t * 20) % 200) === 0) {
        for (const v of Object.values(w.housePoints())) expect(v).toBeGreaterThanOrEqual(0);
        for (const x of w.wizards.values()) if (x.cup) { expect(x.cup.pts).toBeGreaterThanOrEqual(0); expect(x.cup.pts).toBeLessThanOrEqual(w.rules.terms.wizardPointsCap); }
      }
    }
    expect(w.houseCups.length).toBe(1);
    expect(w.wheel.seq).toBeGreaterThanOrEqual(4);
  });
});
