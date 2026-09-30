/**
 * The browser panels (client/panels): the pure parts (directions, countdowns, the words for states), and that what
 * they read is what the kernel sends — the features' fields of privateState(), the snapshot's `dl`, the exam list and report.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { World } from '../src/kernel/world.js';
import { listExams, sitExam, weeklyExams } from '../src/kernel/exams.js';
import { derived } from '../src/kernel/progression.js';
import {
  FAMILIAR_KINDS, bearing, daStanding, familiarStatus, fmtClock, fmtDist, focusLevel, newlyReady, pickLang, quorumMet, readyIn, vetoPhase,
} from '../client/panels/logic.js';
import type { DaView, ExamList, FamiliarState, SitReport, UnfairMe } from '../client/panels/types.js';
import { updateDarkLord } from '../src/kernel/unfair.js';

const html = readFileSync(new URL('../client/index.html', import.meta.url), 'utf8');

function online(w: World, name: string, house: string, rep: number, x = 60, z = 60) {
  const a = w.enroll(name, house).wizard;
  a.connections = 1;
  a.createdAt = -10_000;
  a.reputation = rep;
  a.pos = { x, z };
  a.hp = derived(a, w.rules).maxHp;
  return a;
}
const da = (over: Partial<DaView> = {}): DaView => ({
  member: false, eligible: true, size: 3, online: 3, quorum: 3,
  veto: { perTerm: 1, usedThisTerm: false, windowSeconds: 180, decree: null, votes: 0, needed: 2, voted: false }, ...over,
});

describe('the panels, pure parts (client/panels/logic.ts)', () => {
  it('points the compass the way Homenum Revelio does', () => {
    expect(bearing({ x: 0, z: 0 }, { x: 0, z: -10 }, 0)).toEqual({ dist: 10, rot: 0 });
    expect(bearing({ x: 0, z: 0 }, { x: 10, z: 0 }, 0).rot).toBeCloseTo(Math.PI / 2);
    expect(bearing({ x: 0, z: 0 }, { x: 10, z: 0 }, 0.5).rot).toBeCloseTo(Math.PI / 2 + 0.5);
    expect(fmtDist(212.4)).toBe('212 米');
    expect(fmtDist(1500)).toBe('1.5 公里');
    expect(fmtClock(151)).toBe('2:31');
    expect(fmtClock(-3)).toBe('0:00');
  });
  it('announces a studyable spell once, when it becomes ready', () => {
    const list = [{ spell: 'Smoke96', from: 'Draco', handle: 'p2', readyAt: 100 }, { spell: 'Zap', from: 'Pansy', handle: 'p3', readyAt: 160 }];
    const told = new Set<string>();
    expect(readyIn(list[1], 100)).toBe(60);
    expect(newlyReady(list, 100, told).map((s) => s.spell)).toEqual(['Smoke96']);
    expect(newlyReady(list, 120, told)).toEqual([]);
    expect(newlyReady(list, 160, told).map((s) => s.spell)).toEqual(['Zap']);
  });
  it('knows where the veto stands', () => {
    const decree = { minister: 'Umbridge', changes: ['combat.pvp'], secondsLeft: 150 };
    expect(vetoPhase(null)).toBe('none');
    expect(vetoPhase(da())).toBe('none');
    expect(vetoPhase(da({ veto: { ...da().veto, decree } }))).toBe('open');
    expect(vetoPhase(da({ veto: { ...da().veto, decree, voted: true } }))).toBe('voted');
    expect(vetoPhase(da({ veto: { ...da().veto, decree, usedThisTerm: true } }))).toBe('used');
    expect(quorumMet(da({ online: 2 }))).toBe(false);
    expect(daStanding(da({ eligible: false, whyZh: '邓布利多军是弱者的联盟' }))).toContain('弱者');
    expect(daStanding(da({ member: true }))).toContain('一员');
  });
  it('says what the familiar is doing, and draws every kind', () => {
    const f: FamiliarState = { on: true, kind: 'cat', name: '使魔 · 猫', dormant: false, busy: false, queued: 0, left: 30, daily: 30 };
    expect(familiarStatus({ ...f, on: false }).tone).toBe('off');
    expect(familiarStatus(f).tone).toBe('on');
    expect(familiarStatus({ ...f, dormant: true }).tone).toBe('dormant');
    expect(familiarStatus({ ...f, queued: 2 }).text).toContain('第 2 位');
    expect(familiarStatus({ ...f, busy: true }).tone).toBe('busy');
    expect(familiarStatus({ ...f, left: 0 }).tone).toBe('tired');
    for (const k of FAMILIAR_KINDS) expect(html, k.icon).toContain(`<symbol id="i-${k.icon}"`);
  });
  it('fills the concentration tube and warns when it runs low', () => {
    expect(focusLevel({ on: true, cur: 30, max: 60, regen: 1 })).toEqual({ frac: 0.5, low: false });
    expect(focusLevel({ on: true, cur: 5, max: 60, regen: 1 }).low).toBe(true);
  });
  it('picks one language out of a "中文 English" string', () => {
    expect(pickLang('咒语失败了：没有目标。 The spell fizzled: no target.', 'zh')).toBe('咒语失败了：没有目标。');
    expect(pickLang('咒语失败了：没有目标。 The spell fizzled: no target.', 'en')).toBe('The spell fizzled: no target.');
    expect(pickLang('Par is 7 nodes. 达到标准线即为 O。', 'zh')).toBe('达到标准线即为 O。');
    expect(pickLang('Par is 7 nodes. 达到标准线即为 O。', 'en')).toBe('Par is 7 nodes.');
    expect(pickLang('unknown name "foo"', 'zh')).toBe('unknown name "foo"');
  });
  it('draws the Dark Mark from paths only (the 3D sprite reads them as Path2D)', () => {
    const sym = /<symbol id="i-darkmark"[^>]*>(.*?)<\/symbol>/.exec(html)![1];
    expect(sym).toContain('<path');
    expect(sym).not.toMatch(/<(circle|ellipse|rect|line)/);
  });
});

describe('what the panels read is what the kernel sends', () => {
  it("privateState()'s darkLord, da, studyable, focus, lawless and the snapshot `dl` have the shapes the panels use", () => {
    const w = new World({ seed: 3, secret: 'x' });
    w.rules.creatures.spawnMultiplier = 0;
    const dl = online(w, 'Tom Riddle', 'Slytherin', 400, 120, 40);
    const me = online(w, 'Neville', 'Gryffindor', 10);
    w.tick(0.05);
    updateDarkLord(w);
    const s = w.snapshot() as ReturnType<World['snapshot']> & { dl?: unknown };
    expect(s.dl).toMatchObject({ h: dl.handle, n: 'Tom Riddle', x: 120, z: 40 });
    const mine = w.privateState(me.id) as unknown as UnfairMe;
    expect(mine.darkLord).toBe(false);
    expect(Object.keys(mine.da).sort()).toEqual(expect.arrayContaining(['member', 'eligible', 'size', 'online', 'quorum', 'veto', 'jointBadge']));
    expect(Object.keys(mine.da.veto).filter((k) => !k.startsWith('blocked')).sort()).toEqual(['decree', 'needed', 'perTerm', 'usedThisTerm', 'voted', 'votes', 'windowSeconds']);
    expect(mine.focus).toMatchObject({ on: true, max: expect.any(Number), cur: expect.any(Number) });
    expect(mine.lawless).toBe(false);
    expect(Array.isArray(mine.studyable)).toBe(true);
    expect((w.privateState(dl.id) as unknown as UnfairMe).darkLord).toBe(true);
  });
  it('the exam list and a sitting carry what the O.W.L. panel draws', () => {
    const w = new World({ seed: 3, secret: 'x' });
    const me = online(w, 'Hermione', 'Gryffindor', 0);
    const list = listExams(w, me.id) as unknown as ExamList;
    expect(list.exams.length).toBeGreaterThan(0);
    const e = list.exams[0];
    for (const k of ['id', 'year', 'subject', 'title', 'brief', 'par', 'cases', 'reward', 'yourBest', 'top']) expect(e, k).toHaveProperty(k);
    const exam = weeklyExams(w.secret, Date.now()).find((x) => x.year <= 1)!;
    const r = sitExam(w, me.id, exam.id, '(say "hello")') as unknown as SitReport;
    for (const k of ['exam', 'verdict', 'grade', 'gradeName', 'passed', 'score', 'par', 'log', 'cases', 'best', 'rank', 'rewards', 'achievements']) expect(r, k).toHaveProperty(k);
    expect(['O', 'E', 'A', 'P', 'D', 'T']).toContain(r.grade);
  });
});
