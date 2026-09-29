import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import {
  BOARD_SIZE, EXAMS, EXAMS_PER_WEEK, EXAM_BY_ID, SITS_PER_MIN, ciLog, examLeaderboard, gradeExam, isoWeek, listExams, pointsFor, sitExam, weeklyExams,
} from '../src/kernel/exams.js';
import type { Creature, Wizard } from '../src/kernel/types.js';
import { ACHIEVEMENTS, World } from '../src/kernel/world.js';
import { GRADES } from '../src/lore/exams.js';
import { createMcpServer } from '../src/mcp/server.js';
import { LIMITS } from '../src/server/net.js';

/**
 * Every exam: a reference solution that must earn an O, and a naive wrong one that must fail. These are the
 * answer key — they live here, not in src, so no MCP tool can hand them out.
 */
const KEY: Record<string, { ref: string; wrong: string; also?: string[] }> = {
  'counting-door': { ref: '(say (count (creatures 15)))', wrong: '(say (count (enemies 15)))' },
  'two-headed-door': { ref: '(let c (creatures 40)) (say (floor (+ (hp (first c)) (hp (nth c 1)))))', wrong: '(let c (enemies 40)) (say (floor (+ (hp (first c)) (hp (nth c 1)))))' },
  'three-pixies': { ref: '(each p (enemies 30) (bolt p 12 :ice))', wrong: '(each p (enemies 30) (bolt p 16))', also: ['(each p (enemies 30) (bolt p (/ (hp p) 2) :ice))'] },
  triage: { ref: '(each a (allies 20) (when (< (hp a) (* 0.3 (max-hp a))) (heal a 16)))', wrong: '(each a (wizards 20) (when (< (hp a) 30) (heal a 16)))' },
  'shorthand-protego': { ref: '(shield self 20 4) (each a (allies 10) (shield a 20 4))', wrong: '(shield self 20 4) (each a (wizards 10) (shield a 20 4))' },
  curfew: { ref: '(if (night) (light) (say (floor (hour))))', wrong: '(light)' },
  'hello-owl': { ref: '(say (str "Hello, " (name (first (wizards 40))) "!"))', wrong: '(say "Hello, World!")' },
  'knut-wasted': { ref: '(bolt target (/ (hp target) 2) :ice)', wrong: '(bolt target (hp target))' },
  'double-tap': { ref: '(bolt target 10) (after 2 (bolt target 10))', wrong: '(bolt target 10) (bolt target 10)' },
  'now-you-see-it': { ref: '(summon :serpent 1) (after 2 (say (count (summons))))', wrong: '(summon :serpent 1) (say (count (summons)))' },
  'finite-precisely': { ref: '(when (afflicted self) (cleanse self)) (each a (allies 20) (when (afflicted a) (cleanse a)))', wrong: '(each a (allies 20) (cleanse a))' },
  'know-thy-enemy': { ref: '(each e (enemies 20) (bolt e 8 (if (= (kind e) "pixie") :ice (if (= (kind e) "snare") :light :fire))))', wrong: '(each e (enemies 20) (bolt e 8 :fire))' },
  'freeze-spare-unicorn': { ref: '(each e (enemies 12) (bolt e 6 :ice))', wrong: '(each e (creatures 12) (bolt e 6 :ice))', also: ['(each e (enemies 12) (root e 1))'] },
  rennervate: { ref: '(each f (fallen 6) (when (= (house f) (house self)) (revive f)))', wrong: '(revive (first (fallen 6)))' },
  'area-or-single': { ref: '(if (>= (count (enemies 6)) 3) (nova 6 10) (bolt (first (enemies 30)) 10))', wrong: '(nova 6 10)' },
  'weakest-link': {
    ref: '(let x (enemies 30)) (let m (min (hp (first x)) (hp (or (nth x 1) (first x))) (hp (or (nth x 2) (first x))) (hp (or (nth x 3) (first x))))) (each e x (when (= (hp e) m) (bolt e 10)))',
    wrong: '(bolt (first (enemies 30)) 10)',
  },
  'halfway-apparate': { ref: '(apparate (ahead (/ (dist self aim) 2)))', wrong: '(apparate aim)' },
};
/** More naive answers that must fail too. */
const ALSO_WRONG: Record<string, string[]> = {
  'counting-door': ['(say (count (creatures 40)))'],
  'freeze-spare-unicorn': ['(nova 6 12 :ice)'],
  'three-pixies': ['(bolt target 16)'],
  triage: ['(each a (allies 20) (heal a 16))'],
  'now-you-see-it': ['(summon :serpent 20) (after 2 (say (count (summons))))'],
  // the playtest's loophole: two power-1 tickles once beat par
  'double-tap': ['(bolt target 1) (after 2 (bolt target 1))'],
  // playtest round 2: power-0.01 blows once passed these two for two mana
  'area-or-single': ['(if (>= (count (enemies 6)) 3) (nova 6 0.01) (bolt (first (enemies 30)) 0.01))'],
  'weakest-link': ['(let es (enemies 30)) (let lo (min (hp (or (nth es 0) (first es))) (hp (or (nth es 1) (first es))) (hp (or (nth es 2) (first es))) (hp (or (nth es 3) (first es))))) (each e es (when (= (hp e) lo) (bolt e 0.01)))'],
};

const SECRET = 'owl-test-secret';
function mk() {
  const w = new World({ seed: 7, secret: SECRET });
  w.rules.creatures.spawnMultiplier = 0;
  return w;
}
function join(w: World, name: string, year = 7): Wizard {
  const x = w.enroll(name).wizard;
  x.connections = 1;
  x.year = year;
  x.pos = { x: 60, z: 60 };
  return x;
}
/** The first week (from `from`, by default Monday 2026-09-28) whose rotation includes `id`. */
function weekWith(id: string, from = Date.UTC(2026, 8, 28, 12)): number {
  for (let k = 0; k < 400; k++) {
    const ms = from + k * 7 * 86400e3;
    if (weeklyExams(SECRET, ms).some((e) => e.id === id)) return ms;
  }
  throw new Error(`no week has ${id}`);
}
const WEEK = Date.UTC(2026, 8, 29, 10); // Tuesday of ISO week 2026-W40

describe('O.W.L. exams: the pool', () => {
  it('has at least 15 exams, each with hidden cases, a par and bilingual texts', () => {
    expect(EXAMS.length).toBeGreaterThanOrEqual(15);
    expect(new Set(EXAMS.map((e) => e.id)).size).toBe(EXAMS.length);
    for (const e of EXAMS) {
      expect(e.cases.length).toBeGreaterThanOrEqual(2);
      expect(e.year).toBeGreaterThanOrEqual(1);
      expect(e.year).toBeLessThanOrEqual(7);
      for (const l of [e.title, e.brief, e.hint, ...e.cases.map((c) => c.name)]) {
        expect(l.zh).toMatch(/[一-鿿]/);
        expect(l.en.length).toBeGreaterThan(2);
      }
      expect(e.par.nodes).toBeGreaterThan(0);
      expect(e.par.gas).toBeGreaterThan(0);
      expect(e.par.mana).toBeGreaterThan(0);
      expect(KEY[e.id], `answer key for ${e.id}`).toBeTruthy();
    }
    expect(Object.keys(KEY).sort()).toEqual(EXAMS.map((e) => e.id).sort());
  });

  for (const e of EXAMS) {
    it(`${e.id}: the reference earns an O, the naive answer fails`, () => {
      const g = gradeExam(e, KEY[e.id].ref);
      expect(g.ok, ciLog(e, g)).toBe(true);
      expect(g.grade).toBe('O');
      expect(g.points).toBeLessThanOrEqual(100);
      for (const alt of KEY[e.id].also ?? []) expect(gradeExam(e, alt).ok, alt).toBe(true);
      for (const bad of [KEY[e.id].wrong, ...(ALSO_WRONG[e.id] ?? [])]) {
        const b = gradeExam(e, bad);
        expect(b.ok, `${bad}\n${ciLog(e, b)}`).toBe(false);
        expect(['P', 'D', 'T']).toContain(b.grade);
        expect(b.cases.some((c) => !c.ok && c.detail)).toBe(true);
      }
    });
  }

  it('grades from the score vs par: O, E, A for a pass; P, D, T by how many cases pass', () => {
    const e = EXAM_BY_ID.get('counting-door')!;
    expect(pointsFor(e.par, e.par)).toBe(100);
    const twice = gradeExam(e, '(say (count (creatures 15))) (say (count (creatures 15)))');
    expect(twice.ok).toBe(true);
    expect(twice.points).toBeGreaterThan(130);
    expect(twice.grade).toBe('A');
    const e2 = gradeExam(e, '(say (count (creatures (+ 10 5))))');
    expect(e2.grade).toBe('E');
    expect(gradeExam(e, '(say (count (enemies 15)))').grade).toBe('P'); // 2 of 3
    expect(gradeExam(EXAM_BY_ID.get('curfew')!, '(say (floor (hour)))').grade).toBe('P'); // 2 of 4 (the days)
    expect(gradeExam(EXAM_BY_ID.get('triage')!, '(each a (wizards 20) (when (< (hp a) 30) (heal a 16)))').grade).toBe('D'); // 1 of 3
    const t = gradeExam(e, '(say 42)');
    expect(t.grade).toBe('T');
    expect(GRADES).toEqual(['O', 'E', 'A', 'P', 'D', 'T']);
  });

  it('a report reads like CI: one line per case, why it failed, and the verdict', () => {
    const e = EXAM_BY_ID.get('counting-door')!;
    const g = gradeExam(e, '(say (count (enemies 15)))');
    const log = ciLog(e, g);
    expect(log).toMatch(/✓ case 1\/3/);
    expect(log).toMatch(/✗ case 3\/3/);
    expect(log).toMatch(/the door wanted 3/);
    expect(log).toMatch(/^FAIL 2\/3 — P/m);
  });
});

describe('O.W.L. exams: bounds', () => {
  it('grading is deterministic', () => {
    for (const id of ['three-pixies', 'freeze-spare-unicorn', 'now-you-see-it', 'know-thy-enemy']) {
      const e = EXAM_BY_ID.get(id)!;
      const a = gradeExam(e, KEY[id].ref), b = gradeExam(e, KEY[id].ref);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      const x = gradeExam(e, KEY[id].wrong), y = gradeExam(e, KEY[id].wrong);
      expect(JSON.stringify(y)).toBe(JSON.stringify(x));
    }
  });

  it('checks at the exam\'s year and limits: compile errors, locked words and oversized spells are a T', () => {
    const door = EXAM_BY_ID.get('counting-door')!;
    const unclosed = gradeExam(door, '(say (count (creatures 15))');
    expect(unclosed.grade).toBe('T');
    expect(unclosed.compileError).toMatch(/unclosed/);
    expect(unclosed.cases).toHaveLength(0);
    expect(gradeExam(door, '(nova 6 10)').compileError).toMatch(/year 3/); // a year-1 exam is sat with year-1 magic
    const golf = EXAM_BY_ID.get('shorthand-protego')!;
    const long = gradeExam(golf, '(shield self 20 4) (each a (allies 10) (when a (shield a 20 4)))');
    expect(long.grade).toBe('T');
    expect(long.compileError).toMatch(/at most 16 nodes/);
  });

  it('gas is bounded: a runaway program collapses, and a gas budget is enforced', () => {
    const door = EXAM_BY_ID.get('counting-door')!;
    const bomb = gradeExam(door, '(repeat 10 (repeat 10 (repeat 10 (count (creatures 15))))) (say 1)');
    expect(bomb.ok).toBe(false);
    expect(bomb.cases.every((c) => /out of gas/.test(c.error ?? ''))).toBe(true);
    const hop = EXAM_BY_ID.get('halfway-apparate')!;
    const lavish = gradeExam(hop, '(let d (dist self aim)) (let h (/ d 2)) (apparate (ahead h))');
    expect(lavish.ok).toBe(false);
    expect(lavish.cases[0].detail?.en).toMatch(/this exam allows 12/);
  });

  it('time is bounded: a sitting past its wall-clock budget stops and fails', () => {
    const e = EXAM_BY_ID.get('three-pixies')!;
    const t0 = performance.now();
    const g = gradeExam(e, KEY[e.id].ref, { budgetMs: 0 });
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(g.timedOut).toBe(true);
    expect(g.ok).toBe(false);
    // and a normal sitting of the heaviest exam is far inside the budget
    const t1 = performance.now();
    gradeExam(EXAM_BY_ID.get('triage')!, KEY.triage.ref);
    expect(performance.now() - t1).toBeLessThan(2000);
  });

  it('the sandbox never touches the live world', () => {
    const w = mk();
    const a = join(w, 'Hermione Granger');
    const b = join(w, 'Ron Weasley');
    b.pos = { x: 62, z: 60 };
    const c: Creature = { id: 'c_live', kind: 'pixie', pos: { x: 66, z: 60 }, home: { x: 66, z: 60 }, hp: 24, maxHp: 24, facing: 0, target: null, attackCd: 99, rootedUntil: 0, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
    w.creatures.set(c.id, c);
    const ms = weekWith('three-pixies');
    const before = JSON.parse(JSON.stringify({ ...w.serialize(), owls: null }));
    const events0 = w.events.length;
    // a failing sitting (P/D, no reward): nothing but world.owls changes
    const fail = sitExam(w, a.id, 'three-pixies', '(bolt (first (enemies 30)) 16 :ice)', ms);
    expect(fail.verdict).toBe('FAIL');
    const mid = JSON.parse(JSON.stringify({ ...w.serialize(), owls: null }));
    const strip = (x: typeof before) => ({ ...x, wizards: x.wizards.map((z: Wizard) => ({ ...z, achievements: [] })) });
    expect(strip(mid)).toEqual(strip(before));
    // a passing one: bolts fly in the exam hall, none here
    const pass = sitExam(w, a.id, 'three-pixies', KEY['three-pixies'].ref, ms);
    expect(pass.verdict).toBe('PASS');
    expect(w.projectiles.size).toBe(0);
    expect(w.pending).toHaveLength(0);
    expect(w.creatures.get('c_live')!.hp).toBe(24);
    expect([...w.creatures.keys()]).toEqual(['c_live']);
    expect(a.mana).toBe(before.wizards.find((z: Wizard) => z.id === a.id).mana);
    expect(a.pos).toEqual({ x: 60, z: 60 });
    expect(b.hp).toBe(before.wizards.find((z: Wizard) => z.id === b.id).hp);
    // only the candidate's own result lines reach the live feed; the hall's chatter stays in the hall
    const added = w.events.slice(events0);
    expect(added.every((e) => e.to === a.id || (e.who ?? []).includes(a.id))).toBe(true);
    expect(added.some((e) => e.type === 'chat')).toBe(false);
  });
});

describe('O.W.L. exams: the weekly rotation', () => {
  it('ISO weeks', () => {
    expect(isoWeek(WEEK).key).toBe('2026-W40');
    expect(isoWeek(Date.UTC(2021, 0, 1)).key).toBe('2020-W53');
    expect(isoWeek(Date.UTC(2024, 11, 30)).key).toBe('2025-W01');
    const w = isoWeek(WEEK);
    expect(new Date(w.start).toISOString()).toBe('2026-09-28T00:00:00.000Z');
    expect(w.end - w.start).toBe(7 * 86400e3);
  });

  it('is deterministic per (secret, week), has 5–8 exams with something for first-years, and rotates', () => {
    const a = weeklyExams(SECRET, WEEK).map((e) => e.id);
    expect(weeklyExams(SECRET, WEEK + 3 * 86400e3).map((e) => e.id)).toEqual(a); // same week, Friday
    expect(a).toHaveLength(EXAMS_PER_WEEK);
    expect(EXAMS_PER_WEEK).toBeGreaterThanOrEqual(5);
    expect(EXAMS_PER_WEEK).toBeLessThanOrEqual(8);
    expect(new Set(a).size).toBe(a.length);
    const sets = new Set<string>();
    const seen = new Set<string>();
    for (let k = 0; k < 30; k++) {
      const ex = weeklyExams(SECRET, WEEK + k * 7 * 86400e3);
      expect(ex.filter((e) => e.year <= 2).length).toBeGreaterThanOrEqual(2);
      sets.add(ex.map((e) => e.id).join());
      ex.forEach((e) => seen.add(e.id));
    }
    expect(sets.size).toBeGreaterThan(10);
    expect(seen.size).toBe(EXAMS.length); // every exam comes round
    expect(weeklyExams('another-realm-secret', WEEK).map((e) => e.id).join()).not.toBe(a.join());
  });
});

describe('O.W.L. exams: sitting, rewards, leaderboards, persistence', () => {
  it('pays the first pass of the week, then only an improvement, and never for a fail', () => {
    const w = mk();
    const a = join(w, 'Hermione Granger');
    const ms = weekWith('counting-door');
    const xp0 = a.xp, g0 = a.galleons, r0 = a.reputation;
    const bad = sitExam(w, a.id, 'counting-door', '(say (count (enemies 15)))', ms);
    expect(bad.rewards).toBeNull();
    expect(a.xp).toBe(xp0);
    const okA = sitExam(w, a.id, 'counting-door', '(say (count (creatures 15))) (say (count (creatures 15)))', ms);
    expect(okA.grade).toBe('A');
    expect(okA.rewards).toEqual({ xp: 60, galleons: 4, reputation: 2 });
    expect(a.xp).toBe(xp0 + 60);
    expect(a.galleons).toBe(g0 + 4);
    expect(a.reputation).toBe(r0 + 2);
    expect(sitExam(w, a.id, 'counting-door', '(say (count (creatures 15))) (say (count (creatures 15)))', ms).rewards).toBeNull();
    const okO = sitExam(w, a.id, 'counting-door', KEY['counting-door'].ref, ms);
    expect(okO.grade).toBe('O');
    expect(okO.rewards).toEqual({ xp: 30, galleons: 2, reputation: 1 }); // the difference: ×1.5 − ×1
    expect(okO.meme).toBeTruthy();
    expect(sitExam(w, a.id, 'counting-door', KEY['counting-door'].ref, ms).rewards).toBeNull();
    // a worse sitting later does not lower the best
    const worse = sitExam(w, a.id, 'counting-door', '(say 1)', ms);
    expect(worse.improved).toBe(false);
    expect(worse.best?.grade).toBe('O');
    // next week it pays again
    expect(sitExam(w, a.id, 'counting-door', KEY['counting-door'].ref, weekWith('counting-door', ms + 7 * 86400e3)).rewards).toEqual({ xp: 90, galleons: 6, reputation: 3 });
  });

  it('a Troll gets a joke and an achievement; refusals for the wrong week, a low year and too many sittings', () => {
    const w = mk();
    const a = join(w, 'Neville Longbottom', 1);
    const ms = weekWith('counting-door');
    const t = sitExam(w, a.id, 'counting-door', '(say "troll")', ms);
    expect(t.grade).toBe('T');
    expect(t.meme).toMatch(/[一-鿿]/);
    expect(t.achievements).toContain('owl_troll');
    expect(a.achievements).toContain('owl_troll');
    expect(ACHIEVEMENTS.owl_all_o.zh).toBe('O.W.L. 全 O');
    const notThisWeek = EXAMS.find((e) => !weeklyExams(SECRET, ms).includes(e))!;
    expect(() => sitExam(w, a.id, notThisWeek.id, '(say 1)', ms)).toThrow(/not one of this week/);
    const hard = weeklyExams(SECRET, ms).find((e) => e.year > 1);
    if (hard) expect(() => sitExam(w, a.id, hard.id, '(say 1)', ms)).toThrow(/year-\d exam; you are year 1/);
    for (let i = 1; i < SITS_PER_MIN; i++) sitExam(w, a.id, 'counting-door', '(say 1)', ms + i);
    expect(() => sitExam(w, a.id, 'counting-door', '(say 1)', ms + 100)).toThrow(/breather/);
    expect(sitExam(w, a.id, 'counting-door', '(say 1)', ms + 61_000).grade).toBe('T');
  });

  it('every exam of the week passed with O: "O.W.L. 全 O"', () => {
    const w = mk();
    const a = join(w, 'Hermione Granger');
    const ms = WEEK;
    const week = weeklyExams(SECRET, ms);
    let last;
    for (const e of week) last = sitExam(w, a.id, e.id, KEY[e.id].ref, ms);
    expect(last!.achievements).toEqual(expect.arrayContaining(['owl_full_marks', 'owl_all_o']));
    expect(a.achievements).toEqual(expect.arrayContaining(['owl_full_marks', 'owl_all_o']));
    const list = listExams(w, a.id, ms);
    expect(list.progress).toEqual({ passed: week.length, outstanding: week.length, of: week.length });
    expect(list.exams.every((e) => e.yourBest?.grade === 'O')).toBe(true);
  });

  it('keeps a top-10 board per exam, one row per wizard, best first, and never shows registry ids', () => {
    const w = mk();
    const ms = weekWith('counting-door');
    const ws = Array.from({ length: 12 }, (_, i) => join(w, `Student ${String.fromCharCode(65 + i)}`));
    const src = (k: number) => `(say (count (creatures 15)))${' (say (count (creatures 15)))'.repeat(k)}`;
    ws.forEach((x, i) => sitExam(w, x.id, 'counting-door', src(i % 4), ms + i));
    const board = examLeaderboard(w, ws[0].id, 'counting-door') as { top: { rank: number; name: string; points: number; you?: boolean }[] };
    expect(board.top).toHaveLength(BOARD_SIZE);
    expect(board.top.map((r) => r.points)).toEqual([...board.top.map((r) => r.points)].sort((x, y) => x - y));
    expect(board.top[0].name).toBe('Student A'); // ties go to whoever got there first
    expect(board.top.filter((r) => r.you)).toHaveLength(1);
    expect(JSON.stringify(board)).not.toMatch(/wz_/);
    // improving replaces your row instead of adding one
    sitExam(w, ws[3].id, 'counting-door', src(0), ms + 100);
    const again = w.owls.boards['counting-door'];
    expect(again.filter((r) => r.wid === ws[3].id)).toHaveLength(1);
    expect(again.findIndex((r) => r.wid === ws[3].id)).toBeLessThan(4);
    const all = examLeaderboard(w, null, undefined, ms) as { boards: { id: string }[] };
    expect(all.boards.map((b) => b.id)).toEqual(weeklyExams(SECRET, ms).map((e) => e.id));
  });

  it('survives serialize/restore', () => {
    const w = mk();
    const a = join(w, 'Hermione Granger');
    const ms = weekWith('counting-door');
    sitExam(w, a.id, 'counting-door', KEY['counting-door'].ref, ms);
    const back = World.restore(JSON.parse(JSON.stringify(w.serialize())));
    expect(back.owls).toEqual(w.owls);
    expect(back.owls.boards['counting-door'][0].name).toBe('Hermione Granger');
    const view = listExams(back, a.id, ms).exams.find((e) => e.id === 'counting-door')!;
    expect(view.yourBest?.grade).toBe('O');
    // a first pass already paid stays paid after a restart
    expect(sitExam(back, a.id, 'counting-door', KEY['counting-door'].ref, ms).rewards).toBeNull();
    // and saves from before the exams existed load with an empty book
    const old = JSON.parse(JSON.stringify(w.serialize()));
    delete old.owls;
    expect(World.restore(old).owls).toEqual({ boards: {}, bests: {} });
  });
});

describe('O.W.L. exams: MCP tools and WebSocket limits', () => {
  it('owl_exams, sit_exam and exam_leaderboard', async () => {
    const w = mk();
    const a = join(w, 'Hermione Granger');
    const server = createMcpServer(w, { wizardId: a.id, baseUrl: 'http://x' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const c = new Client({ name: 'test', version: '0' });
    await c.connect(ct);
    const tools = (await c.listTools()).tools;
    for (const n of ['owl_exams', 'sit_exam', 'exam_leaderboard']) expect(tools.find((t) => t.name === n)?.description?.length).toBeGreaterThan(40);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = (await c.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      return { isError: !!r.isError, text: r.content[0].text, data: (() => { try { return JSON.parse(r.content[0].text); } catch { return null; } })() };
    };
    const list = await call('owl_exams');
    expect(list.isError).toBe(false);
    expect(list.data.exams).toHaveLength(EXAMS_PER_WEEK);
    const first = list.data.exams[0];
    expect(first.par.nodes).toBeGreaterThan(0);
    const sat = await call('sit_exam', { exam_id: first.id, source: KEY[first.id].ref });
    expect(sat.isError).toBe(false);
    expect(sat.data.verdict).toBe('PASS');
    expect(sat.data.log).toMatch(/PASS/);
    const bad = await call('sit_exam', { exam_id: first.id, source: '(say' });
    expect(bad.data.grade).toBe('T');
    expect(bad.data.compileError).toBeTruthy();
    const nope = await call('sit_exam', { exam_id: 'no-such-exam', source: '(say 1)' });
    expect(nope.isError).toBe(true);
    const board = await call('exam_leaderboard', { exam_id: first.id });
    expect(board.data.top[0].name).toBe('Hermione Granger');
    expect(board.data.top[0].you).toBe(true);
    await c.close();
  });

  it('the browser messages have their own budgets', () => {
    expect(LIMITS.exams).toBeTruthy();
    expect(LIMITS.sit).toBeTruthy();
    expect(LIMITS.sit[0]).toBeLessThan(1);
  });
});
