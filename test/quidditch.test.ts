/** 魁地奇 (src/kernel/quidditch.ts): schedule, the balls, the Snitch, bounded rewards. */
import { describe, expect, it } from 'vitest';
import {
  QD_BLUDGER_DMG, QD_CALL_S, QD_CUP_MAX, QD_FLY, QD_GOAL, QD_HOOPS, QD_KEEP_R, QD_PAIRS, QD_PITCH, QD_REP_MAX, QD_SNITCH, QD_START_FRAC, QD_TOUCH_R, QD_WIN_PTS,
  qdChase, qdCup, qdJoin, qdLeave, qdPairing, qdRep, qdSeason, qdStatus, qdThrow, quidditchBolt, standings,
} from '../src/kernel/quidditch.js';
import { ensureNpcs } from '../src/kernel/npc.js';
import { World } from '../src/kernel/world.js';
import type { Wizard } from '../src/kernel/types.js';

function mk(npcs = 0) {
  const w = new World({ seed: 31, secret: 'quidditch' });
  w.rules.creatures.spawnMultiplier = 0;
  w.rules.events.pool = [];
  if (npcs) ensureNpcs(w, npcs);
  return w;
}
const run = (w: World, s: number) => { for (let i = 0; i < Math.round(s * 20); i++) w.tick(); };
function player(w: World, name: string, house: string): Wizard {
  const a = w.enroll(name, house as never).wizard;
  a.connections = 1;
  a.createdAt = -1e6;
  a.pos = { x: QD_PITCH.x, z: QD_PITCH.z + 10 };
  return a;
}
const whistle = (w: World) => w.term.startedAt + QD_START_FRAC * (w.term.endsAt - w.term.startedAt);
/** Jump to the call of this term's match. */
function toCall(w: World) {
  w.now = whistle(w) - QD_CALL_S + 1;
  run(w, 0.1);
  expect(w.qd.match?.phase).toBe('call');
}
function toPlay(w: World) {
  run(w, whistle(w) - w.now + 0.2);
  expect(w.qd.match?.phase).toBe('play');
}

describe('Quidditch', () => {
  it('calls this term\'s pairing, lets only those two houses join, fills with NPCs and names a seeker a side', () => {
    const w = mk(4);
    const [A, B] = qdPairing(w.term.n);
    expect([A, B]).toEqual(['Gryffindor', 'Slytherin']);
    expect(qdPairing(2)).toEqual(['Ravenclaw', 'Hufflepuff']);
    const a = player(w, 'Oliver', A), b = player(w, 'Marcus', B), c = player(w, 'Cedric', 'Hufflepuff');
    expect(() => qdJoin(w, a.id)).toThrow(/No Quidditch match/);
    toCall(w);
    qdJoin(w, a.id, 'seeker');
    qdJoin(w, b.id);
    expect(() => qdJoin(w, c.id)).toThrow(/stands|看台/);
    toPlay(w);
    const m = w.qd.match!;
    const sides = [0, 1].map((s) => Object.entries(m.roster).filter(([, p]) => p.side === s));
    for (const s of sides) {
      expect(s.length).toBeGreaterThanOrEqual(2); // a player + an NPC
      expect(s.filter(([, p]) => p.role === 'seeker')).toHaveLength(1);
    }
    expect(m.roster[a.id].role).toBe('seeker'); // asked for it
    expect(Math.abs(a.pos.z - (-168))).toBeLessThan(1);
    expect(Math.abs(b.pos.z - (-132))).toBeLessThan(1);
  });

  it('you fly faster on the pitch while you play', () => {
    const w = mk();
    const a = player(w, 'Katie', 'Gryffindor');
    toCall(w); qdJoin(w, a.id); toPlay(w);
    const x0 = a.pos.x;
    w.setInput(a.id, 1, 0);
    run(w, 1);
    const flown = a.pos.x - x0;
    expect(flown).toBeGreaterThan(w.rules.physics.moveSpeed * 1.2);
    expect(flown).toBeLessThan(w.rules.physics.moveSpeed * QD_FLY + 0.5);
  });

  it('touch the Quaffle to take it, throw it through a hoop at the other end for a goal; a defender in its path intercepts', () => {
    const w = mk();
    const a = player(w, 'Angelina', 'Gryffindor'), b = player(w, 'Adrian', 'Slytherin');
    toCall(w); qdJoin(w, a.id); qdJoin(w, b.id); toPlay(w);
    const m = w.qd.match!;
    m.bludgers = [];
    run(w, 1.2); // the Quaffle is dead for a second at the whistle
    a.pos = { x: m.quaffle.x, z: m.quaffle.z };
    run(w, 0.1);
    expect(m.quaffle.carrier).toBe(a.id);
    expect(() => qdThrow(w, b.id)).toThrow(/do not have/);
    // Gryffindor (side 0) scores in the south hoops
    a.pos = { x: 40, z: QD_HOOPS[1][1].z - 10 };
    b.pos = { x: 10, z: -150 };
    run(w, 0.05);
    qdThrow(w, a.id, 'middle');
    run(w, 1.2);
    expect(m.score).toEqual([QD_GOAL, 0]);
    expect(m.roster[a.id].goals).toBe(1);
    // an interception
    run(w, 2.2);
    a.pos = { x: m.quaffle.x, z: m.quaffle.z };
    run(w, 0.1);
    expect(m.quaffle.carrier).toBe(a.id);
    a.pos = { x: 40, z: QD_HOOPS[1][1].z - 14 };
    b.pos = { x: 40, z: QD_HOOPS[1][1].z - 7 };
    run(w, 0.05);
    qdThrow(w, a.id, 'middle');
    run(w, 1.2);
    expect(m.quaffle.carrier).toBe(b.id);
    expect(m.score).toEqual([QD_GOAL, 0]);
  });

  it('a Bludger costs health (never below 1) and the Quaffle; a spell passing it beats it away', () => {
    const w = mk();
    const a = player(w, 'Fred', 'Gryffindor'), b = player(w, 'George', 'Slytherin');
    toCall(w); qdJoin(w, a.id); qdJoin(w, b.id); toPlay(w);
    const m = w.qd.match!;
    m.bludgers = [m.bludgers[0]];
    a.hp = 3;
    m.quaffle.carrier = a.id;
    const bl = m.bludgers[0];
    bl.x = a.pos.x + 0.5; bl.z = a.pos.z; bl.target = a.id; bl.retargetAt = w.now + 99;
    run(w, 0.1);
    expect(a.hp).toBeGreaterThanOrEqual(1);
    expect(a.hp).toBeLessThan(1.5); // 1, plus a tenth of a second's regen
    expect(a.st.stunnedUntil).toBe(0);
    expect(m.quaffle.carrier).not.toBe(a.id);
    expect(QD_BLUDGER_DMG).toBeGreaterThan(0);
    // beaten away toward the other side
    run(w, 1.5);
    bl.away = 0; bl.x = 40; bl.z = -150;
    quidditchBolt(w, { owner: a.id, pos: { x: 40.5, z: -150 }, vel: { x: 0, z: 20 } });
    expect(bl.away).toBeGreaterThan(0);
    expect(bl.target).toBe(b.id);
  });

  it('the Snitch: a seeker who stays close catches it, +150, the match ends and pays within the bounds; one match a term', () => {
    const w = mk(4);
    const a = player(w, 'Harry', 'Gryffindor'), b = player(w, 'Draco', 'Slytherin');
    toCall(w); qdJoin(w, a.id, 'seeker'); qdJoin(w, b.id, 'seeker'); toPlay(w);
    const m = w.qd.match!;
    m.bludgers = [];
    m.snitchAt = w.now;
    run(w, 0.1);
    expect(m.snitch).not.toBeNull();
    const rep0 = a.reputation, repB = b.reputation;
    for (let i = 0; i < 40 && w.qd.match?.phase === 'play'; i++) { a.pos = { x: m.snitch!.x, z: m.snitch!.z }; w.tick(); }
    expect(m.phase).toBe('done');
    expect(m.caughtBy).toBe(a.id);
    expect(m.score[0]).toBeGreaterThanOrEqual(QD_SNITCH);
    expect(a.reputation - rep0).toBe(qdRep(0, true, true));
    expect(b.reputation - repB).toBe(qdRep(0, false, false));
    expect(a.reputation - rep0).toBeLessThanOrEqual(QD_REP_MAX);
    for (const id of Object.keys(m.roster)) { const x = w.wizards.get(id)!; if (x.npc) expect(x.cup?.src?.quidditch ?? 0).toBe(0); }
    expect(w.events.some((e) => e.type === 'quidditch' && /抓住了金色飞贼/.test(e.zh ?? ''))).toBe(true);
    run(w, 25);
    expect(w.qd.match).toBeNull();
    w.now = whistle(w) - QD_CALL_S + 1;
    run(w, 0.2);
    expect(w.qd.match).toBeNull(); // already played this term
    expect(qdStatus(w, a.id).next?.term).toBe(w.term.n + 1);
    const back = World.restore(JSON.parse(JSON.stringify(w.serialize())));
    expect(back.qd.doneTerm).toBe(w.term.n);
  });

  it('a keeper: named when a side has three, reaches further for a shot at their own hoops, and an NPC keeper marks the Quaffle', () => {
    const w = mk(6);
    const a = player(w, 'Katie', 'Gryffindor'), k = player(w, 'Miles', 'Slytherin');
    toCall(w); qdJoin(w, a.id); qdJoin(w, k.id, 'keeper'); toPlay(w);
    const m = w.qd.match!;
    m.bludgers = [];
    expect(m.roster[k.id].role).toBe('keeper'); // asked, and Slytherin has three with the NPCs
    expect(Object.values(m.roster).filter((p) => p.side === 0 && p.role === 'keeper')).toHaveLength(1); // an NPC keeper for Gryffindor
    expect(qdStatus(w, k.id).you?.role).toBe('keeper');
    for (const [id, p] of Object.entries(m.roster)) if (id !== a.id && id !== k.id) { p.chase = false; w.wizards.get(id)!.pos = { x: 20, z: -150 }; } // just the two of them
    run(w, 1.2);
    a.pos = { x: m.quaffle.x, z: m.quaffle.z };
    run(w, 0.1);
    expect(m.quaffle.carrier).toBe(a.id);
    // a shot at the middle hoop passes 1.5 m from the keeper: beyond a defender's touch, inside a keeper's reach
    const hoop = QD_HOOPS[1][1];
    a.pos = { x: 40, z: hoop.z - 12 };
    k.pos = { x: 41.5, z: hoop.z - 3 };
    expect(1.5).toBeGreaterThan(QD_TOUCH_R);
    expect(1.5).toBeLessThan(QD_KEEP_R);
    run(w, 0.05);
    qdThrow(w, a.id, 'middle');
    run(w, 1.2);
    expect(m.quaffle.carrier).toBe(k.id);
    expect(m.score).toEqual([0, 0]);
    expect(m.roster[k.id].saves).toBe(1);
    // an NPC keeper on autopilot keeps to its hoop line, following the Quaffle across
    const npcKeeper = Object.entries(m.roster).find(([, p]) => p.side === 0 && p.role === 'keeper')![0];
    m.roster[npcKeeper].chase = true;
    const nk = w.wizards.get(npcKeeper)!;
    run(w, 3);
    expect(Math.abs(nk.pos.z - (QD_HOOPS[0][1].z + 3))).toBeLessThan(4);
  });

  it('the league: every match counts toward a season of six terms; the leader takes the Cup; kept across a restart', () => {
    const w = mk(4);
    expect(QD_PAIRS).toHaveLength(6);
    expect([qdSeason(1), qdSeason(6), qdSeason(7)]).toEqual([0, 0, 1]);
    const a = player(w, 'Harry', 'Gryffindor');
    toCall(w); qdJoin(w, a.id, 'seeker'); toPlay(w);
    const m = w.qd.match!;
    m.bludgers = []; m.snitchAt = w.now;
    run(w, 0.1);
    for (let i = 0; i < 40 && w.qd.match?.phase === 'play'; i++) { a.pos = { x: m.snitch!.x, z: m.snitch!.z }; w.tick(); }
    expect(m.winner).toBe(0);
    const table = standings(w.qd.league);
    expect(table[0]).toMatchObject({ house: 'Gryffindor', row: { played: 1, won: 1, pts: QD_WIN_PTS } });
    expect(table[1]).toMatchObject({ house: 'Slytherin', row: { played: 1, lost: 1, pts: 0 } });
    expect(qdStatus(w, a.id).league).toMatchObject({ season: 1, table: [{ house: 'Gryffindor', pts: QD_WIN_PTS }, { house: 'Slytherin' }] });
    const back = World.restore(JSON.parse(JSON.stringify(w.serialize())));
    expect(standings(back.qd.league)[0].row.pts).toBe(QD_WIN_PTS);
    // the next season: Gryffindor are crowned, the table starts empty
    w.term.n = QD_PAIRS.length + 1;
    run(w, 0.1);
    expect(w.qd.league).toMatchObject({ season: 1, table: {}, champions: [{ season: 0, house: 'Gryffindor' }] });
    expect(w.events.some((e) => e.type === 'quidditch' && /魁地奇杯/.test(e.zh ?? ''))).toBe(true);
  });

  it('rewards are bounded: qdRep ≤ QD_REP_MAX, qdCup ≤ QD_CUP_MAX, both monotone', () => {
    for (let g = 0; g < 40; g++) {
      for (const c of [false, true]) for (const won of [false, true]) {
        expect(qdRep(g, c, won)).toBeLessThanOrEqual(QD_REP_MAX);
        expect(qdRep(g + 1, c, won)).toBeGreaterThanOrEqual(qdRep(g, c, won));
      }
    }
    for (let s = 0; s < 2000; s += 7) { expect(qdCup(s)).toBeLessThanOrEqual(QD_CUP_MAX); expect(qdCup(s + 7)).toBeGreaterThanOrEqual(qdCup(s)); }
  });

  it('leaving the pitch benches you; the autopilot flies you at the ball; the wheel keeps its Snitch off the pitch meanwhile', () => {
    const w = mk(4); // an NPC takes each side's seeker, so Ginny chases the Quaffle
    const a = player(w, 'Ginny', 'Gryffindor'), b = player(w, 'Blaise', 'Slytherin');
    toCall(w); qdJoin(w, a.id); qdJoin(w, b.id); toPlay(w);
    const m = w.qd.match!;
    m.bludgers = [];
    expect(m.roster[a.id].role).toBe('chaser');
    qdChase(w, a.id, true);
    run(w, 1.3);
    const d0 = Math.hypot(a.pos.x - m.quaffle.x, a.pos.z - m.quaffle.z);
    expect(m.quaffle.carrier === a.id || d0 < 12).toBe(true);
    run(w, 6);
    expect(w.rules.events.pool).toEqual([]);
    w.rules.events.pool = ['snitch'];
    expect(w.wheel.active?.id).not.toBe('snitch');
    b.pos = { x: QD_PITCH.x + 60, z: QD_PITCH.z };
    run(w, 0.1);
    expect(m.roster[b.id]).toBeUndefined();
    qdLeave(w, a.id);
    expect(m.roster[a.id]).toBeUndefined();
  });
});

describe('the Quidditch slip (client/panels/quidditch.ts) reads what the kernel sends', () => {
  it('the call, your role, the Quaffle in your hands, and the stands for other houses', async () => {
    const { qdLine } = await import('../client/panels/quidditch.js');
    const w = mk(4);
    const a = player(w, 'Oliver', 'Gryffindor');
    toCall(w);
    type Q = Parameters<typeof qdLine>[0];
    const snap = () => (w.snapshot() as { qd?: unknown }).qd as Q;
    expect(qdLine(snap(), a.handle, 'Gryffindor')).toMatchObject({ canJoin: true, mine: false });
    expect(qdLine(snap(), 'x', 'Hufflepuff')?.sub).toMatch(/看台/);
    qdJoin(w, a.id);
    toPlay(w);
    const m = w.qd.match!;
    m.quaffle.carrier = a.id;
    const l = qdLine(snap(), a.handle, 'Gryffindor')!;
    expect(l.mine).toBe(true);
    expect(l.title).toMatch(/格兰芬多 0 : 0 斯莱特林/);
    expect(l.sub).toMatch(/F 射门/);
  });
});

describe('the Quidditch slip reads the keeper and the league', () => {
  it('names the keeper role and sums up the table in one line', async () => {
    const { qdLine, leagueLine } = await import('../client/panels/quidditch.js');
    const qd = { s: ['Gryffindor', 'Slytherin'] as [string, string], sc: [0, 0] as [number, number], ph: 'play' as const, t: 100, q: null, bl: [], sn: null, sa: 10, r: [['me', 1, 2] as [string, number, number]] };
    expect(qdLine(qd, 'me', 'Slytherin')?.sub).toMatch(/守门员|Keeper/);
    expect(leagueLine(undefined)).toBe('');
    expect(leagueLine({ season: 2, table: [{ house: 'Gryffindor', pts: 3, played: 1 }, { house: 'Slytherin', pts: 0, played: 1 }] })).toMatch(/2.*3.*0/);
  });
});
