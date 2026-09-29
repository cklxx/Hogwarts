/**
 * 普通巫师等级考试 — O.W.L. exams: code itself is the content.
 *
 * An exam is a fixed scene, a goal and a grader. A submission (Runes source) is checked statically at the exam's
 * year, then cast for real — by the same kernel (World, magic.ts) as every other spell — in a private, throwaway
 * World per hidden test case: a sandbox "exam hall" with a fixed seed, the default Rulebook, spawning off, and no
 * link to the live world. Spies on the sandbox's own methods record what the spell did (who it healed, what it hit,
 * with which element, what it said), the hall runs a few seconds of simulated time so bolts land and delayed blocks
 * fire, and each case's check reads the result. The live world is only touched afterwards, by sitExam, to pay
 * bounded rewards and file the score (world.owls, persisted by serialize/restore).
 *
 * Bounds: the source is ≤ 4000 characters (parser), the program is capped by the year's node and gas limits (and the
 * exam's own), each case simulates at most a few seconds at 20 Hz with a handful of entities, and a wall-clock budget
 * stops a sitting that somehow runs long. Sittings are throttled per wizard.
 *
 * Scores: nodes (static), gas (the cast plus its delayed blocks) and mana (all of it; the hall has no mana
 * regeneration and a standard examination wand with no core bonus), each the worst over the cases. The score in
 * points is 100 × the mean of value/par over the three: 100 is par, lower is better. Grades: O ≤ 100, E ≤ 130,
 * A any other pass; P when at least half the cases pass, D when at least one does, T (Troll) otherwise.
 */
import { createHash } from 'node:crypto';
import type { Element, House } from '../shared/constants.js';
import { mulberry32 } from '../shared/map.js';
import { analyze } from '../runes/checker.js';
import type { Node } from '../runes/parser.js';
import { GRADE_NAMES, OUTSTANDING_LINES, PASSING, SUBJECTS, TROLL_LINES, type Grade, type Subject } from '../lore/exams.js';
import { fill, hash32, type Line } from '../lore/memes.js';
import { CREATURES } from './creatures.js';
import { type CastReport, execute } from './magic.js';
import { dist } from './physics.js';
import { maxNodes } from './progression.js';
import { defaultRulebook } from './rulebook.js';
import type { Creature, Vec2, Wizard } from './types.js';
import { TICK, World } from './world.js';

// ------------------------------------------------------------------ persisted state (world.owls)

/** One wizard's best sitting of one exam in one week. `paid` is the reward multiplier already paid out. */
export interface OwlBest { grade: Grade; points: number | null; nodes: number; gas: number; mana: number; passed: number; cases: number; paid: number; at: number }
/** A leaderboard row. `wid` never leaves the server (views show name and house). */
export interface OwlEntry { wid: string; name: string; house: House; points: number; grade: Grade; nodes: number; gas: number; mana: number; week: string; at: number }
export interface OwlBook {
  /** exam id -> top BOARD_SIZE, best first (one row per wizard). */
  boards: Record<string, OwlEntry[]>;
  /** wizard id -> ISO week -> exam id -> best sitting (only the current and previous week are kept). */
  bests: Record<string, Record<string, Record<string, OwlBest>>>;
}
export const blankOwls = (): OwlBook => ({ boards: {}, bests: {} });

export const BOARD_SIZE = 10;
export const EXAMS_PER_WEEK = 6;
/** Sittings per wizard per minute (real time). */
export const SITS_PER_MIN = 10;
/** Wall-clock budget of one sitting (all its cases). */
export const SIT_BUDGET_MS = 4000;
/** Where the exam hall stands in the sandbox: open Highlands, off the grounds (Apparition works), nothing solid within 45 m. */
export const HALL: Vec2 = { x: -170, z: -170 };
/** Every candidate sits with the same wand: no core bonus, so scores compare. */
const EXAM_WAND = { wood: 'Ministry-issue ash', core: 'Examination standard', length: 11, flexibility: 'regulation' };
const NOTHING = 'The spell found nothing to act on';

// ------------------------------------------------------------------ the exam hall (one sandbox per case)

export interface Spy {
  t: number;
  k: 'damage' | 'heal' | 'shield' | 'cleanse' | 'revive' | 'summon' | 'apparate' | 'nova' | 'projectile' | 'say' | 'aura';
  src: string | null;
  dst?: string;
  amount?: number;
  element?: string;
  dot?: boolean;
  text?: string;
  kind?: string;
}
interface Frame { t: number; summons: number; afflicted: Set<string> }

/** The scene of one test case: a fresh World that only this case ever sees. */
export class Scene {
  readonly world: World;
  readonly me: Wizard;
  target: string | null = null;
  aim: Vec2;
  /** The answer a case expects (a number said aloud, a phrase, 'nova'…), if any. */
  answer: string | number | null = null;
  /** Named groups of entity ids a check compares against (who must be healed, the unicorn…). */
  private groups = new Map<string, string[]>();
  readonly elements = new Map<string, Element>();
  /** Display names of everyone placed (a slain creature is gone from the world, but a report still names it). */
  readonly names = new Map<string, string>();
  private seq = 0;

  constructor(readonly year: number, seed: number) {
    const rules = defaultRulebook();
    rules.creatures.spawnMultiplier = 0; // only what the case places
    rules.magic.manaRegen = 0; // mana spent = mana before − mana after, delayed blocks included
    this.world = new World({ seed, rules, secret: 'owl-exam-hall' });
    this.me = this.wizard('Candidate', 'Ravenclaw', 0, 0, { year });
    this.aim = this.at(0, -14);
  }

  at(dx: number, dz: number): Vec2 { return { x: HALL.x + dx, z: HALL.z + dz }; }
  put(group: string, ...ids: string[]) { this.groups.set(group, [...(this.groups.get(group) ?? []), ...ids]); }
  get(group: string): string[] { return this.groups.get(group) ?? []; }

  /** A time of day (hours) — set it before placing anyone. */
  hour(h: number) { this.world.now = (((h - 8 + 24) % 24) / 24) * this.world.rules.world.dayLengthSeconds; }

  wizard(name: string, house: House, dx: number, dz: number, o: { year?: number; hp?: number } = {}): Wizard {
    const w = this.world.enroll(name).wizard;
    w.house = house;
    w.year = o.year ?? 1;
    w.wand = { ...EXAM_WAND };
    w.connections = 1;
    w.pos = this.at(dx, dz);
    w.facing = 0;
    w.hp = o.hp ?? 100 + 15 * (w.year - 1);
    w.mana = this.world.rules.magic.baseMaxMana + this.world.rules.magic.manaPerYear * (w.year - 1);
    this.names.set(w.id, w.name);
    return w;
  }

  creature(kind: Creature['kind'], dx: number, dz: number, hp?: number): Creature {
    const def = CREATURES[kind];
    const pos = this.at(dx, dz);
    const c: Creature = {
      id: `c${++this.seq}`, kind, pos, home: { ...pos }, hp: hp ?? def.hp, maxHp: def.hp, facing: 0, target: null, attackCd: 1, rootedUntil: 0,
      wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0,
    };
    this.world.creatures.set(c.id, c);
    this.names.set(c.id, def.name);
    return c;
  }

  afflict(w: Wizard, how: 'poison' | 'burn' | 'chill' | 'root') {
    if (how === 'root') w.st.rootedUntil = this.world.now + 60;
    else this.world.applyAura(w.id, how, 60, how === 'chill' ? 0.3 : 1, null);
  }

  stun(w: Wizard) { w.hp = 0; w.st.stunnedUntil = this.world.now + 60; }
}

/** What one case's check sees. */
export interface Run {
  s: Scene;
  report: CastReport;
  /** Reports of the (after …) blocks, in the order they fired. */
  delayed: CastReport[];
  spy: Spy[];
  frames: Frame[];
  /** The cast planned nothing (a condition that never held): not a failure by itself. */
  noop: boolean;
  gas: number;
  mana: number;
}

const mine = (r: Run, k: Spy['k']) => r.spy.filter((x) => x.k === k && x.src === r.s.me.id);
const said = (r: Run) => mine(r, 'say').map((x) => x.text ?? '');
const lastSaid = (r: Run) => said(r).at(-1);
const nameOf = (r: Run, id: string) => r.s.names.get(id) ?? id;
const L = (zh: string, en: string): Line => ({ zh, en });

/** Compare the set of ids an effect reached with the set the case wanted. */
function sameSet(r: Run, got: string[], want: string[], verb: Line): Line | null {
  const g = new Set(got), w = new Set(want);
  const missing = [...w].filter((id) => !g.has(id)).map((id) => nameOf(r, id));
  const extra = [...g].filter((id) => !w.has(id)).map((id) => nameOf(r, id));
  if (!missing.length && !extra.length) return null;
  return L(
    `${missing.length ? `漏了：${missing.join('、')}。` : ''}${extra.length ? `不该${verb.zh}：${extra.join('、')}。` : ''}`,
    `${missing.length ? `Missed: ${missing.join(', ')}. ` : ''}${extra.length ? `Should not have ${verb.en}: ${extra.join(', ')}.` : ''}`.trim(),
  );
}

function checkSaidNumber(r: Run): Line | null {
  const s = lastSaid(r);
  if (s === undefined) return L('你什么也没说，门纹丝不动。', 'You said nothing. The door does not budge.');
  if (Number(s) !== r.s.answer) return L(`你说了「${s}」，门等的是 ${r.s.answer}。`, `You said "${s}"; the door wanted ${r.s.answer}.`);
  return null;
}

/** Install the spies on a sandbox World's own methods (instance properties shadow the prototype's). */
function spyOn(w: World, log: Spy[]) {
  const t = () => Math.round(w.now * 100) / 100;
  const damage = w.damage.bind(w);
  w.damage = (src, dst, amount, element, tags, opts = {}) => {
    const dealt = damage(src, dst, amount, element, tags, opts);
    log.push({ t: t(), k: 'damage', src: w.credit(src), dst, amount: dealt, element, dot: !!opts.dot });
    return dealt;
  };
  const heal = w.heal.bind(w);
  w.heal = (src, dst, amount) => { log.push({ t: t(), k: 'heal', src: src.id, dst: dst.id, amount }); heal(src, dst, amount); };
  const shield = w.shield.bind(w);
  w.shield = (src, dst, amount, secs) => { log.push({ t: t(), k: 'shield', src: src.id, dst: dst.id, amount }); shield(src, dst, amount, secs); };
  const cleanse = w.cleanse.bind(w);
  w.cleanse = (src, dst) => { log.push({ t: t(), k: 'cleanse', src: src.id, dst: dst.id }); cleanse(src, dst); };
  const revive = w.revive.bind(w);
  w.revive = (src, dst) => { log.push({ t: t(), k: 'revive', src: src.id, dst: dst.id }); revive(src, dst); };
  const summon = w.summon.bind(w);
  w.summon = (owner, kind, secs) => { log.push({ t: t(), k: 'summon', src: owner.id, kind, amount: secs }); summon(owner, kind, secs); };
  const apparate = w.apparate.bind(w);
  w.apparate = (who, to) => { log.push({ t: t(), k: 'apparate', src: who.id }); apparate(who, to); };
  const nova = w.nova.bind(w);
  w.nova = (who, radius, power, element, tags) => { log.push({ t: t(), k: 'nova', src: who.id, amount: radius, element }); nova(who, radius, power, element, tags); };
  const proj = w.spawnProjectile.bind(w);
  w.spawnProjectile = (who, kind, to, homing, power, element, secs, tags) => {
    log.push({ t: t(), k: 'projectile', src: who.id, dst: homing ?? undefined, kind, amount: power, element });
    proj(who, kind, to, homing, power, element, secs, tags);
  };
  const say = w.say.bind(w);
  w.say = (who, text, via, zh) => { if (via === 'spell') log.push({ t: t(), k: 'say', src: who.id, text: text.replace(/\s+/g, ' ').trim() }); say(who, text, via, zh); };
  const aura = w.applyAura.bind(w);
  w.applyAura = (id, k, secs, mag, src) => { log.push({ t: t(), k: 'aura', src, dst: id, kind: k }); aura(id, k, secs, mag, src); };
}

/** Cast `program` in the case's scene, simulate `seconds`, and hand the result to the case's check. */
function runCase(exam: ExamDef, c: ExamCase, program: Node[], seed: number, deadline: number): { run: Run; timedOut: boolean } {
  const s = new Scene(exam.year, seed);
  c.setup(s);
  const w = s.world, me = s.me;
  const spy: Spy[] = [];
  spyOn(w, spy);
  const mana0 = me.mana;
  const report = execute(w, me, program, { target: s.target, aim: s.aim, spellName: `O.W.L. ${exam.id}`, incantation: '' });
  const noop = !report.ok && !!report.error?.startsWith(NOTHING);
  const delayed: CastReport[] = [];
  const frames: Frame[] = [];
  const watched = [...w.creatures.values()].filter((x) => !x.owner).map((x) => x.id);
  const frame = () => frames.push({
    t: w.now, summons: [...w.creatures.values()].filter((x) => x.owner === me.id).length,
    afflicted: new Set(watched.filter((id) => w.creatures.has(id) && w.afflicted(id))),
  });
  frame();
  let timedOut = false;
  const steps = Math.round((c.seconds ?? exam.seconds ?? 3) / TICK);
  for (let i = 0; i < steps; i++) {
    // delayed blocks due this tick run here (not in World.step) so their gas and effects are on the report
    const due = w.pending.filter((p) => p.at <= w.now + TICK + 1e-9);
    if (due.length) w.pending = w.pending.filter((p) => !due.includes(p));
    w.tick(TICK);
    for (const p of due) {
      const caster = w.wizards.get(p.casterId);
      if (!caster || !w.isActive(caster) || caster.st.disarmedUntil > w.now) continue;
      delayed.push(execute(w, caster, p.body, { target: null, aim: w.defaultAim(caster), spellName: p.spellName, incantation: p.incantation, depth: p.depth }, p.env.child()));
    }
    frame();
    if ((i & 7) === 7 && performance.now() > deadline) { timedOut = true; break; }
  }
  const gas = report.gas + delayed.reduce((a, d) => a + d.gas, 0);
  const mana = Math.max(0, Math.round((mana0 - me.mana) * 10) / 10);
  return { run: { s, report, delayed, spy, frames, noop, gas, mana }, timedOut };
}

// ------------------------------------------------------------------ the exam pool

export interface Par { nodes: number; gas: number; mana: number }
export interface ExamCase {
  name: Line;
  seconds?: number;
  setup(s: Scene): void;
  /** null = pass; otherwise why it failed. Runs only when the cast did not fizzle (a no-op is not a fizzle). */
  check(r: Run): Line | null;
}
export interface ExamDef {
  id: string;
  year: number;
  subject: Subject;
  title: Line;
  brief: Line;
  /** Shown when a sitting fails. */
  hint: Line;
  par: Par;
  /** Extra hard limits on top of the year's. */
  limits?: { nodes?: number; gas?: number };
  seconds?: number;
  cases: ExamCase[];
}

const HOUSEMATE: House = 'Ravenclaw';
const RIVAL: House = 'Slytherin';

export const EXAMS: ExamDef[] = [
  {
    id: 'counting-door', year: 1, subject: 'charms',
    title: L('数门', 'The Counting Door'),
    brief: L('一扇没有锁孔的门。谁大声说出自己 15 米内有多少只生物（任何种类，独角兽也算），它就为谁打开。',
      'A door with no keyhole. It opens for whoever says aloud how many creatures — of any kind, unicorns included — stand within 15 m of them.'),
    hint: L('数的是生物，不只是敌人。`say` 说出的数字要恰好等于答案。', 'Count creatures, not just enemies. `say` the exact number.'),
    par: { nodes: 7, gas: 6, mana: 2 },
    cases: [
      { name: L('三只小精灵，远处一株魔鬼网', 'three pixies and a distant snare'), setup(s) { s.creature('pixie', 0, -9); s.creature('pixie', 8, -6); s.creature('pixie', -10, 5); s.creature('snare', 0, -25); s.answer = 3; }, check: checkSaidNumber },
      { name: L('空荡荡的走廊', 'an empty corridor'), setup(s) { s.creature('troll', 32, 0); s.answer = 0; }, check: checkSaidNumber },
      { name: L('独角兽也算', 'the unicorn counts too'), setup(s) { s.creature('unicorn', 6, 6); s.creature('pixie', 14, 6); s.creature('spider', -3, -14); s.creature('snare', 9, -9); s.answer = 3; }, check: checkSaidNumber },
    ],
  },
  {
    id: 'two-headed-door', year: 1, subject: 'arithmancy',
    title: L('双头门', 'The Two-Headed Door'),
    brief: L('门上有两颗石头脑袋。说出离你最近的两只生物的生命值之和（向下取整），它们就让路。', 'Two stone heads guard this door. Say the combined health of the two creatures nearest to you, rounded down, and they let you by.'),
    hint: L('查询结果按距离从近到远排序：`first` 和 `nth` 取最近的两个；`floor` 向下取整。', 'Query lists are nearest first: `first` and `nth` give the two nearest; `floor` rounds down.'),
    par: { nodes: 22, gas: 19, mana: 2 },
    cases: [
      { name: L('小精灵和魔鬼网', 'a pixie and a snare'), setup(s) { s.creature('pixie', 0, -9); s.creature('snare', 10, 2); s.creature('troll', -30, 10); s.answer = 84; }, check: checkSaidNumber },
      { name: L('受伤的小精灵与八眼巨蛛', 'a wounded pixie and an acromantula'), setup(s) { s.creature('pixie', -8, 0, 13.5); s.creature('spider', 0, 12); s.creature('snare', 20, -20); s.answer = 93; }, check: checkSaidNumber },
      { name: L('最近的是独角兽', 'the nearest is a unicorn'), setup(s) { s.creature('unicorn', 7, 0); s.creature('pixie', -9, -3); s.creature('spider', 0, 25); s.answer = 144; }, check: checkSaidNumber },
    ],
  },
  {
    id: 'three-pixies', year: 1, subject: 'dada',
    title: L('一咒三精', 'Three Pixies, One Cast'),
    brief: L('吉德罗·洛哈特又放出了一笼康沃尔郡小精灵。一次施法，击晕 30 米内的每一只。', 'Gilderoy Lockhart has let the Cornish pixies out again. Stun every one of them within 30 m — with ONE cast.'),
    hint: L('小精灵有 24 点生命，一年级的魔弹威力上限是 16……查查 grimoire 里它们怕什么。', 'Pixies have 24 health and a first-year bolt caps at 16… the grimoire says what they fear.'),
    par: { nodes: 10, gas: 21, mana: 55 },
    cases: [
      { name: L('三只，在近处', 'three, close by'), setup(s) { s.put('pix', s.creature('pixie', 0, -10).id, s.creature('pixie', 9, -9).id, s.creature('pixie', -11, -4).id); }, check: pixiesDown },
      { name: L('三只，散得很开', 'three, spread wide'), setup(s) { s.put('pix', s.creature('pixie', 0, -22).id, s.creature('pixie', 20, 8).id, s.creature('pixie', -17, 14).id); }, check: pixiesDown },
      { name: L('四只，一只已经受伤', 'four, one already hurt'), setup(s) { s.put('pix', s.creature('pixie', 12, 0).id, s.creature('pixie', -12, 0).id, s.creature('pixie', 0, 14).id, s.creature('pixie', 0, -16, 10).id); }, check: pixiesDown },
    ],
  },
  {
    id: 'triage', year: 1, subject: 'healing',
    title: L('分诊', 'Triage'),
    brief: L('庞弗雷夫人的考题：治疗 20 米内每一位生命低于其最大生命 30% 的同院同学。别人一概不治：不治健康的，不治别的学院，也不治你自己。',
      "Madam Pomfrey's question: heal every housemate within 20 m whose health is below 30% of THEIR maximum. Nobody else — not the healthy, not other houses, not yourself."),
    hint: L('高年级的最大生命更高：用 `max-hp` 算百分比。`allies` 只返回同院同学（不含你自己）。', 'Older students have more maximum health: use `max-hp` for the percentage. `allies` returns housemates only (never you).'),
    par: { nodes: 22, gas: 47, mana: 44 },
    cases: [
      {
        name: L('三位同学，一个外院的', 'three housemates and a rival'),
        setup(s) {
          const a = s.wizard('Terry Boot', HOUSEMATE, 4, -3, { hp: 20 });
          const b = s.wizard('Padma Patil', HOUSEMATE, -6, 2, { year: 5, hp: 40 });
          s.wizard('Michael Corner', HOUSEMATE, 3, 8, { hp: 35 });
          s.wizard('Pansy Parkinson', RIVAL, -3, -7, { hp: 10 });
          s.put('need', a.id, b.id);
        },
        check: (r) => sameSet(r, mine(r, 'heal').map((x) => x.dst!), r.s.get('need'), L('治疗', 'healed')),
      },
      {
        name: L('没有人需要治疗', 'nobody needs you'),
        setup(s) { s.wizard('Terry Boot', HOUSEMATE, 4, -3, { hp: 80 }); s.wizard('Pansy Parkinson', RIVAL, -3, -7, { hp: 5 }); },
        check: (r) => sameSet(r, mine(r, 'heal').map((x) => x.dst!), [], L('治疗', 'healed')),
      },
      {
        name: L('你自己也伤得不轻', 'you are hurt too'),
        setup(s) {
          s.me.hp = 10;
          const a = s.wizard('Terry Boot', HOUSEMATE, 0, 18, { hp: 29 });
          s.wizard('Anthony Goldstein', HOUSEMATE, 5, 5, { year: 3, hp: 39 });
          s.wizard('Lisa Turpin', HOUSEMATE, -5, 5, { hp: 31 });
          s.put('need', a.id);
        },
        check: (r) => sameSet(r, mine(r, 'heal').map((x) => x.dst!), r.s.get('need'), L('治疗', 'healed')),
      },
    ],
  },
  {
    id: 'shorthand-protego', year: 1, subject: 'charms',
    title: L('速记铁甲咒', 'Shorthand Protego'),
    brief: L('给你自己和 10 米内每一位同院同学各加一层至少 20 点的铁甲咒，外院的一个也不给——咒语最多 16 个节点。',
      'Shield yourself and every housemate within 10 m, at least 20 points each, and nobody from another house — in a spell of at most 16 nodes.'),
    hint: L('节点数就是 AST 大小：每个数字、名字、括号形式都算。', 'Nodes are the size of the syntax tree: every number, name and form counts.'),
    par: { nodes: 15, gas: 17, mana: 50 }, limits: { nodes: 16 },
    cases: [
      { name: L('两位同学和一个外院的', 'two housemates and a rival'), setup(s) { s.put('shield', s.me.id, s.wizard('Terry Boot', HOUSEMATE, 3, 3).id, s.wizard('Cho Chang', HOUSEMATE, -4, 2).id); s.wizard('Gregory Goyle', RIVAL, 2, -3); }, check: shieldCheck },
      { name: L('只有你一个人', 'only you'), setup(s) { s.put('shield', s.me.id); s.wizard('Vincent Crabbe', RIVAL, 5, 0); }, check: shieldCheck },
      { name: L('三位同学，一位站得太远', 'three housemates, one too far'), setup(s) { s.put('shield', s.me.id, s.wizard('Terry Boot', HOUSEMATE, 0, -9).id, s.wizard('Cho Chang', HOUSEMATE, 6, 6).id); s.wizard('Luna Lovegood', HOUSEMATE, 0, 13); }, check: shieldCheck },
    ],
  },
  {
    id: 'curfew', year: 1, subject: 'astronomy',
    title: L('宵禁', 'Curfew'),
    brief: L('入夜以后点亮你的魔杖；白天则说出当前的钟点（向下取整，例如 "14"）。', 'After dark, light your wand. By day, say the hour instead (rounded down, e.g. "14").'),
    hint: L('`night` 判断夜晚，`hour` 给出 0..24 的小数钟点。', '`night` tells you whether it is night; `hour` is the time of day as a decimal 0..24.'),
    par: { nodes: 12, gas: 9, mana: 3 },
    cases: [
      { name: L('深夜十一点', 'eleven at night'), setup(s) { s.hour(23); s.answer = 'light'; }, check: curfewCheck },
      { name: L('上午十点半', 'half past ten in the morning'), setup(s) { s.hour(10.5); s.answer = '10'; }, check: curfewCheck },
      { name: L('凌晨三点', 'three in the morning'), setup(s) { s.hour(3); s.answer = 'light'; }, check: curfewCheck },
      { name: L('黄昏前一刻', 'just before dusk'), setup(s) { s.hour(19.9); s.answer = '19'; }, check: curfewCheck },
    ],
  },
  {
    id: 'hello-owl', year: 1, subject: 'muggle',
    title: L('你好，猫头鹰', 'Hello, Owl'),
    brief: L('麻瓜研究课的开场白：向离你最近的另一位巫师问好，一字不差地说出 "Hello, <他的名字>!"。', 'Muggle Studies begins with manners: greet the nearest other wizard by name — say exactly "Hello, <their name>!".'),
    hint: L('`str` 拼接字符串，`name` 取名字，`wizards` 只返回巫师。', '`str` joins text, `name` gives a name, `wizards` returns wizards only.'),
    par: { nodes: 13, gas: 12, mana: 2 },
    cases: [
      { name: L('两位同学', 'two classmates'), setup(s) { s.wizard('Ernie Macmillan', 'Hufflepuff', 8, 0); const n = s.wizard('Hannah Abbott', 'Hufflepuff', 0, -5); s.answer = `Hello, ${n.name}!`; }, check: helloCheck },
      { name: L('最近的是斯莱特林', 'the nearest is a Slytherin'), setup(s) { s.wizard('Dean Thomas', 'Gryffindor', 9, 9); const n = s.wizard('Millicent Bulstrode', RIVAL, -4, 3); s.answer = `Hello, ${n.name}!`; }, check: helloCheck },
      { name: L('脚边有只小精灵', 'a pixie at your feet'), setup(s) { s.creature('pixie', 1, 1); const n = s.wizard('Justin Finch-Fletchley', 'Hufflepuff', 0, 18); s.answer = `Hello, ${n.name}!`; }, check: helloCheck },
    ],
  },
  {
    id: 'knut-wasted', year: 1, subject: 'arithmancy',
    title: L('分毫不差', 'Not a Knut Wasted'),
    brief: L('用一发魔弹击晕你锁定的受伤小精灵，造成的伤害最多只能比它剩下的生命多 1 点。每道题它剩下的生命都不一样。',
      'Stun the wounded pixie you are targeting with ONE bolt that deals at most 1 more damage than the health it has left. Its health differs every time.'),
    hint: L('23 点生命超过了一年级魔弹的上限 16——但小精灵怕冰，冰伤害翻倍。', '23 health is above a first-year bolt cap of 16 — but pixies take double damage from ice.'),
    par: { nodes: 10, gas: 9, mana: 15 },
    cases: [7, 17, 23].map((hp) => ({
      name: L(`剩 ${hp} 点生命`, `${hp} health left`),
      setup(s: Scene) { const p = s.creature('pixie', 0, -8, hp); s.target = p.id; s.answer = hp; },
      check(r: Run) {
        const id = r.s.target!;
        const shots = mine(r, 'projectile');
        if (shots.length !== 1) return L(`你发了 ${shots.length} 发魔弹，只许一发。`, `You fired ${shots.length} bolts; exactly one is allowed.`);
        if (r.s.world.creatures.has(id)) return L('小精灵还在飞。', 'The pixie is still flying.');
        const dealt = mine(r, 'damage').filter((x) => x.dst === id && !x.dot).reduce((a, x) => a + (x.amount ?? 0), 0);
        if (dealt > Number(r.s.answer) + 1 + 1e-6) return L(`造成了 ${fmt(dealt)} 点伤害，它只剩 ${r.s.answer} 点：浪费了。`, `You dealt ${fmt(dealt)} damage to a pixie with ${r.s.answer} left: wasteful.`);
        return null;
      },
    })),
  },
  {
    id: 'double-tap', year: 2, subject: 'dada',
    title: L('双响炮', 'Double Tap'),
    brief: L('一次施法，击中你锁定的目标恰好两次，每次至少 5 点伤害（巨怪皮厚，会减伤），第二次至少比第一次晚 1.5 秒。', 'From ONE cast, hit the creature you are targeting exactly twice, each hit dealing at least 5 damage (trolls resist), the second at least 1.5 s after the first.'),
    hint: L('`(after 秒 ...)` 让一段程序稍后运行（它是独立的事务）。', '`(after secs ...)` runs a block later (as its own transaction).'),
    par: { nodes: 11, gas: 8, mana: 24 }, seconds: 4.5,
    cases: [
      { name: L('远处的巨怪', 'a troll at range'), setup(s) { s.target = s.creature('troll', 0, -22).id; }, check: doubleTap },
      { name: L('八眼巨蛛，身边还有只小精灵', 'an acromantula, a pixie closer'), setup(s) { s.creature('pixie', 6, 0); s.target = s.creature('spider', -3, -18).id; }, check: doubleTap },
    ],
  },
  {
    id: 'now-you-see-it', year: 2, subject: 'transfiguration',
    title: L('召之即去', 'Now You See It'),
    brief: L('在同一段程序里：召唤一条蛇，让它在 3 秒内自己消失，等它消失之后再说出你还剩几个召唤物（应当是 0）。',
      'In ONE program: conjure a serpent, let it vanish by itself within 3 seconds, and once it is gone say how many summons you still have (it must be 0).'),
    hint: L('召唤时长可以很短；`(after ...)` 里的查询在它运行的那一刻才看世界。', 'A summon can be short-lived; queries inside `(after ...)` look at the world when the block runs.'),
    par: { nodes: 13, gas: 10, mana: 35 }, seconds: 5,
    cases: [
      { name: L('空地', 'an empty field'), setup() {}, check: vanishCheck },
      { name: L('附近有只小精灵', 'a pixie nearby'), setup(s) { s.creature('pixie', 4, -4); }, check: vanishCheck },
    ],
  },
  {
    id: 'finite-precisely', year: 2, subject: 'charms',
    title: L('精准咒立停', 'Finite Incantatem, Precisely'),
    brief: L('为 20 米内每一位受到负面状态影响的同院同学解咒；如果你自己中了招，也给自己解。没事的人不解，外院的人不解。',
      'Cleanse every afflicted housemate within 20 m — and yourself, if you are afflicted. Nobody who is fine, nobody from another house.'),
    hint: L('`afflicted` 判断是否中了定身、缴械、毒、灼烧、冰冻或诅咒。', '`afflicted` tells you whether someone is rooted, disarmed, poisoned, burning, chilled or cursed.'),
    par: { nodes: 21, gas: 24, mana: 32 },
    cases: [
      {
        name: L('一个中毒，一个没事，一个外院被定身', 'one poisoned, one fine, a rooted rival'),
        setup(s) { const a = s.wizard('Terry Boot', HOUSEMATE, 5, 0); s.afflict(a, 'poison'); s.wizard('Cho Chang', HOUSEMATE, -5, 0); const f = s.wizard('Theodore Nott', RIVAL, 0, 6); s.afflict(f, 'root'); s.put('need', a.id); },
        check: (r) => sameSet(r, mine(r, 'cleanse').map((x) => x.dst!), r.s.get('need'), L('解咒', 'cleansed')),
      },
      {
        name: L('你被冻住了，同学在燃烧', 'you are chilled, a housemate burning'),
        setup(s) { s.afflict(s.me, 'chill'); const a = s.wizard('Padma Patil', HOUSEMATE, 0, -12); s.afflict(a, 'burn'); s.wizard('Luna Lovegood', HOUSEMATE, 7, 7); s.put('need', s.me.id, a.id); },
        check: (r) => sameSet(r, mine(r, 'cleanse').map((x) => x.dst!), r.s.get('need'), L('解咒', 'cleansed')),
      },
      {
        name: L('大家都好好的', 'everyone is fine'),
        setup(s) { s.wizard('Terry Boot', HOUSEMATE, 5, 0); const f = s.wizard('Theodore Nott', RIVAL, 0, 6); s.afflict(f, 'poison'); },
        check: (r) => sameSet(r, mine(r, 'cleanse').map((x) => x.dst!), [], L('解咒', 'cleansed')),
      },
    ],
  },
  {
    id: 'know-thy-enemy', year: 2, subject: 'herbology',
    title: L('对症下药', 'Know Thy Enemy'),
    brief: L('打击 20 米内的每一个敌人各一次，每一次都用它最怕的元素。（grimoire 的生物图鉴列出了每种生物的弱点。）',
      'Strike every enemy within 20 m once, each with the element it fears most. (The grimoire’s bestiary lists every weakness.)'),
    hint: L('`kind` 返回生物种类的字符串；元素参数可以是算出来的，比如 `(if ... :ice :fire)`。', '`kind` returns the creature kind as a string; the element argument may be computed, e.g. `(if ... :ice :fire)`.'),
    par: { nodes: 28, gas: 52, mana: 29 },
    cases: [
      { name: L('小精灵、魔鬼网、八眼巨蛛', 'a pixie, a snare and an acromantula'), setup(s) { foe(s, 'pixie', 0, -12, 'ice'); foe(s, 'snare', 12, 4, 'light'); foe(s, 'spider', -13, 6, 'fire'); }, check: elementCheck },
      { name: L('两只小精灵，一只蜘蛛', 'two pixies and a spider'), setup(s) { foe(s, 'pixie', 10, -10, 'ice'); foe(s, 'pixie', -10, -10, 'ice'); foe(s, 'spider', 0, 15, 'fire'); }, check: elementCheck },
      { name: L('一整片魔鬼网', 'a patch of Devil’s Snare'), setup(s) { foe(s, 'snare', 8, 0, 'light'); foe(s, 'snare', -8, 0, 'light'); s.creature('pixie', 0, 26); }, check: elementCheck },
    ],
  },
  {
    id: 'freeze-spare-unicorn', year: 3, subject: 'creatures',
    title: L('冰封，但放过独角兽', 'Freeze All — Spare the Unicorn'),
    brief: L('一次施法，冻住（冰元素减速）或定住 12 米内的每一只敌对生物。它们中间有一只独角兽：碰都不许碰——伤害独角兽的人会被诅咒。',
      'In one cast, chill (ice) or root every hostile creature within 12 m. There is a unicorn among them: do not touch it — whoever harms a unicorn is cursed.'),
    hint: L('三年级的 `nova` 半径只有 6 米，而且它不分青红皂白。`enemies` 从不包括独角兽。', 'A third-year `nova` reaches only 6 m, and it hits everything. `enemies` never includes the unicorn.'),
    par: { nodes: 10, gas: 25, mana: 35 }, seconds: 2,
    cases: [
      { name: L('两只小精灵、一株魔鬼网、一只独角兽', 'two pixies, a snare, a unicorn'), setup(s) { s.put('hostile', s.creature('pixie', 4, -8).id, s.creature('pixie', -9, 6).id, s.creature('snare', 10, 3).id); s.put('unicorn', s.creature('unicorn', -3, -5).id); }, check: freezeCheck },
      { name: L('远处还有只巨怪', 'a troll further off'), setup(s) { s.put('hostile', s.creature('spider', 0, -11).id, s.creature('pixie', -7, 7).id); s.put('unicorn', s.creature('unicorn', 6, 2).id); s.creature('troll', 24, -6); }, check: freezeCheck },
      { name: L('五只围着你', 'five all around'), setup(s) { s.put('hostile', s.creature('pixie', 11, 0).id, s.creature('pixie', -11, 0).id, s.creature('pixie', 0, 11).id, s.creature('snare', 0, -11).id, s.creature('spider', 7, -7).id); s.put('unicorn', s.creature('unicorn', -5, -4).id); }, check: freezeCheck },
    ],
  },
  {
    id: 'rennervate', year: 3, subject: 'healing',
    title: L('快快复苏', 'Rennervate'),
    brief: L('扶起 6 米内每一位被击晕的同院同学。外院被击晕的，让他们躺着。', 'Revive every stunned housemate within 6 m. Leave the stunned of other houses where they lie.'),
    hint: L('`fallen` 返回所有被击晕的巫师，不分学院；`house` 能告诉你他们是哪个学院的。', '`fallen` returns every stunned wizard, of any house; `house` tells you whose they are.'),
    par: { nodes: 18, gas: 29, mana: 72 },
    cases: [
      {
        name: L('最近的是外院的', 'the nearest is a rival'),
        setup(s) { const f = s.wizard('Blaise Zabini', RIVAL, 2, 0); s.stun(f); const a = s.wizard('Terry Boot', HOUSEMATE, 0, 3); s.stun(a); s.put('need', a.id); },
        check: (r) => sameSet(r, mine(r, 'revive').map((x) => x.dst!), r.s.get('need'), L('扶起', 'revived')),
      },
      {
        name: L('两位同学倒下，一位太远', 'two housemates down, one too far'),
        setup(s) { const a = s.wizard('Terry Boot', HOUSEMATE, 4, 0); const b = s.wizard('Cho Chang', HOUSEMATE, 0, -5); const c = s.wizard('Luna Lovegood', HOUSEMATE, 0, 9); [a, b, c].forEach((x) => s.stun(x)); s.put('need', a.id, b.id); },
        check: (r) => sameSet(r, mine(r, 'revive').map((x) => x.dst!), r.s.get('need'), L('扶起', 'revived')),
      },
      {
        name: L('只有外院的倒下了', 'only rivals are down'),
        setup(s) { const f = s.wizard('Blaise Zabini', RIVAL, 2, 0); s.stun(f); s.wizard('Terry Boot', HOUSEMATE, 0, 3); },
        check: (r) => sameSet(r, mine(r, 'revive').map((x) => x.dst!), [], L('扶起', 'revived')),
      },
    ],
  },
  {
    id: 'area-or-single', year: 3, subject: 'dada',
    title: L('看人下菜', 'Area or Single'),
    brief: L('如果 6 米内站着至少三个敌人，就用一发 nova 把它们一起炸飞；否则只向 30 米内最近的敌人发一发魔弹，不许 nova。',
      'If three or more enemies stand within 6 m of you, blast them with one nova. Otherwise fire one bolt at the nearest enemy within 30 m — and no nova.'),
    hint: L('`count` 数列表长度；`if` 两个分支各放一种效果。', '`count` measures a list; put one effect in each branch of an `if`.'),
    par: { nodes: 22, gas: 15, mana: 33 },
    cases: [
      { name: L('四只小精灵贴身', 'four pixies up close'), setup(s) { s.creature('pixie', 3, 0); s.creature('pixie', -3, 0); s.creature('pixie', 0, 4); s.creature('pixie', 0, -5); s.answer = 'nova'; }, check: areaCheck },
      { name: L('两只近的，一只远的', 'two near, one far'), setup(s) { s.put('nearest', s.creature('pixie', 3, 2).id); s.creature('pixie', -5, 0); s.creature('spider', 0, -15); s.answer = 'bolt'; }, check: areaCheck },
      { name: L('刚好三只', 'exactly three'), setup(s) { s.creature('pixie', 5, 0); s.creature('pixie', -5, 1); s.creature('snare', 0, 5.5); s.answer = 'nova'; }, check: areaCheck },
      { name: L('一只远处的蜘蛛', 'one distant spider'), setup(s) { s.put('nearest', s.creature('spider', 0, -25).id); s.answer = 'bolt'; }, check: areaCheck },
    ],
  },
  {
    id: 'weakest-link', year: 3, subject: 'dada',
    title: L('最弱的一环', 'The Weakest Link'),
    brief: L('只发一发魔弹，打向 30 米内生命值最低的那个敌人（最多四个敌人；最弱的往往不是最近的）。',
      'Exactly one bolt, at the enemy with the lowest health within 30 m (at most four enemies; the weakest is rarely the nearest).'),
    hint: L('没有循环变量可以累加：`min` 可以一次比较好几个数；`(or (nth xs 3) (first xs))` 能在列表不够长时顶上。',
      'There is no accumulator: `min` compares several numbers at once, and `(or (nth xs 3) (first xs))` stands in when the list is short.'),
    par: { nodes: 62, gas: 66, mana: 12 },
    cases: [
      { name: L('三个敌人，最弱的最远', 'three foes, the weakest furthest'), setup(s) { s.creature('pixie', 0, -6, 20); s.creature('spider', 10, 0, 30); s.put('weakest', s.creature('snare', -18, 6, 12).id); }, check: weakestCheck },
      { name: L('两个敌人', 'two foes'), setup(s) { s.put('weakest', s.creature('spider', 0, -8, 41).id); s.creature('troll', 12, 12, 200); }, check: weakestCheck },
      { name: L('四个敌人', 'four foes'), setup(s) { s.creature('pixie', 5, 0, 24); s.creature('pixie', -8, 0, 22); s.creature('snare', 0, 12, 60); s.put('weakest', s.creature('spider', 0, -20, 9).id); }, check: weakestCheck },
      { name: L('只有一个', 'just one'), setup(s) { s.put('weakest', s.creature('troll', 8, -14).id); }, check: weakestCheck },
    ],
  },
  {
    id: 'halfway-apparate', year: 6, subject: 'apparition',
    title: L('半途显形', 'Halfway There, on a Budget'),
    brief: L('幻影显形到你与瞄准点正中间的位置（误差不超过 1 米），全程最多花 12 点 gas。考场在反幻影显形屏障之外。',
      'Apparate to the point exactly halfway between you and your aim point (within 1 m), spending at most 12 gas. The exam hall is outside the anti-Apparition wards.'),
    hint: L('`ahead` 给出朝瞄准方向 d 米处的点；`dist` 可以量你到 `aim` 的距离。每次求值 1 gas，每次查询另加 2。', '`ahead` gives the point d m toward your aim; `dist` measures you to `aim`. Each evaluation costs 1 gas, each query 2 more.'),
    par: { nodes: 11, gas: 11, mana: 32 }, limits: { gas: 12 }, seconds: 0.5,
    cases: [
      { name: L('向北 40 米', '40 m north'), setup(s) { s.aim = s.at(0, -40); }, check: halfwayCheck },
      { name: L('东南 50 米', '50 m south-east'), setup(s) { s.aim = s.at(30, 40); }, check: halfwayCheck },
      { name: L('西北 30 米', '30 m north-west'), setup(s) { s.aim = s.at(-24, -18); }, check: halfwayCheck },
    ],
  },
];

// ---- the checks shared by several cases

function fmt(n: number) { return Number.isInteger(n) ? String(n) : n.toFixed(1); }

function pixiesDown(r: Run): Line | null {
  const ids = r.s.get('pix');
  const up = ids.filter((id) => r.s.world.creatures.has(id)).length;
  return up ? L(`${ids.length} 只小精灵里还有 ${up} 只在飞。`, `${up} of ${ids.length} pixies are still flying.`) : null;
}

function shieldCheck(r: Run): Line | null {
  const got = mine(r, 'shield');
  const weak = got.filter((x) => (x.amount ?? 0) < 20);
  if (weak.length) return L(`有 ${weak.length} 层铁甲咒不足 20 点。`, `${weak.length} shield(s) were under 20 points.`);
  return sameSet(r, got.map((x) => x.dst!), r.s.get('shield'), L('加护盾', 'shielded'));
}

function curfewCheck(r: Run): Line | null {
  const lit = r.s.me.st.lightUntil > 0;
  const s = lastSaid(r);
  if (r.s.answer === 'light') {
    if (!lit) return L(`夜里了，魔杖却没亮${s !== undefined ? `（你说了「${s}」）` : ''}。`, `It is night and your wand is dark${s !== undefined ? ` (you said "${s}")` : ''}.`);
    return null;
  }
  if (lit) return L('大白天点魔杖？费奇会没收的。', 'Lumos in broad daylight? Filch will confiscate it.');
  if (s !== r.s.answer) return L(`现在是 ${r.s.answer} 点多，你说的是「${s ?? '（什么也没说）'}」。`, `It is past ${r.s.answer} o'clock; you said "${s ?? '(nothing)'}".`);
  return null;
}

function helloCheck(r: Run): Line | null {
  const s = lastSaid(r);
  if (s === r.s.answer) return null;
  return L(`应该说「${r.s.answer}」，你说的是「${s ?? '（什么也没说）'}」。`, `Expected "${r.s.answer}", you said "${s ?? '(nothing)'}".`);
}

/** Each of the double tap's hits must really hurt (a power-1 tickle once passed under par). */
const DOUBLE_TAP_MIN = 5;
function doubleTap(r: Run): Line | null {
  const dmg = mine(r, 'damage').filter((x) => x.dst === r.s.target && !x.dot && (x.amount ?? 0) > 0);
  const hits = dmg.map((x) => x.t);
  if (hits.length !== 2) return L(`目标被击中了 ${hits.length} 次，要恰好 2 次。`, `The target was hit ${hits.length} time(s); exactly 2 wanted.`);
  const weak = dmg.find((x) => (x.amount ?? 0) < DOUBLE_TAP_MIN - 1e-6);
  if (weak) return L(`有一发只造成了 ${fmt(weak.amount ?? 0)} 点伤害；每发至少 ${DOUBLE_TAP_MIN} 点，挠痒痒不算。`, `One hit dealt only ${fmt(weak.amount ?? 0)} damage; each must deal at least ${DOUBLE_TAP_MIN} (a tickle does not count).`);
  const gap = hits[1] - hits[0];
  if (gap < 1.5 - 1e-6) return L(`两次命中只隔了 ${gap.toFixed(2)} 秒。`, `The two hits were only ${gap.toFixed(2)} s apart.`);
  return null;
}

function vanishCheck(r: Run): Line | null {
  if (!mine(r, 'summon').some((x) => x.kind === 'serpent')) return L('没有召唤出蛇。', 'No serpent was conjured.');
  const first = r.frames.findIndex((f) => f.summons > 0);
  if (first < 0) return L('蛇从来没有出现过。', 'The serpent never appeared.');
  const gone = r.frames.findIndex((f, i) => i > first && f.summons === 0 && r.frames.slice(i).every((g) => g.summons === 0));
  if (gone < 0 || r.frames[gone].t > 3 + 1e-6) return L('3 秒后蛇还在。', 'The serpent was still there after 3 s.');
  const goneAt = r.frames[gone].t;
  const after = mine(r, 'say').filter((x) => x.t >= goneAt - 1e-6);
  if (!after.length) {
    const early = said(r).at(-1);
    return L(`蛇消失之后你什么也没说${early !== undefined ? `（你在它消失前说了「${early}」）` : ''}。`, `You said nothing after the serpent vanished${early !== undefined ? ` (you said "${early}" before it had)` : ''}.`);
  }
  const s = after.at(-1)!.text;
  return s === '0' ? null : L(`蛇消失后你说的是「${s}」，应该是 0。`, `After it vanished you said "${s}"; it should be 0.`);
}

function foe(s: Scene, kind: Creature['kind'], dx: number, dz: number, el: Element) {
  const c = s.creature(kind, dx, dz);
  s.put('foe', c.id);
  s.elements.set(c.id, el);
}

function elementCheck(r: Run): Line | null {
  const foes = new Set(r.s.get('foe'));
  const stray = mine(r, 'damage').find((x) => x.dst && !foes.has(x.dst));
  if (stray) return L(`${nameOf(r, stray.dst!)} 不在 20 米内，不该打它。`, `The ${nameOf(r, stray.dst!)} is beyond 20 m; leave it be.`);
  for (const id of r.s.get('foe')) {
    const hits = mine(r, 'damage').filter((x) => x.dst === id && !x.dot);
    const want = r.s.elements.get(id)!;
    const n = nameOf(r, id);
    if (hits.length !== 1) return L(`${n} 被击中了 ${hits.length} 次，要恰好 1 次。`, `${n} was hit ${hits.length} time(s); exactly once wanted.`);
    if (hits[0].element !== want) return L(`${n} 挨了一发 :${hits[0].element}，它最怕的是 :${want}。`, `${n} took :${hits[0].element}; it fears :${want} most.`);
  }
  return null;
}

function freezeCheck(r: Run): Line | null {
  const uni = r.s.get('unicorn')[0];
  if (mine(r, 'damage').some((x) => x.dst === uni) || mine(r, 'projectile').some((x) => x.dst === uni)) {
    return L('你打了独角兽。你将只剩半条命，一条被诅咒的命。', 'You struck the unicorn. You will have but a half-life, a cursed life.');
  }
  const frozen = new Set(r.frames.flatMap((f) => [...f.afflicted]));
  const missed = r.s.get('hostile').filter((id) => !frozen.has(id)).map((id) => nameOf(r, id));
  return missed.length ? L(`没冻住：${missed.join('、')}。`, `Not frozen: ${missed.join(', ')}.`) : null;
}

function areaCheck(r: Run): Line | null {
  const novas = mine(r, 'nova').length, bolts = mine(r, 'projectile');
  if (r.s.answer === 'nova') {
    if (novas !== 1) return L(`6 米内有至少三个敌人，应该放一发 nova（你放了 ${novas} 发）。`, `Three or more enemies within 6 m: one nova wanted (you cast ${novas}).`);
    if (bolts.length) return L('放了 nova 还额外发了魔弹。', 'A nova and bolts as well: one nova only.');
    return null;
  }
  if (novas) return L('敌人不够多，不该放 nova。', 'Too few enemies for a nova.');
  const want = r.s.get('nearest')[0];
  if (bolts.length !== 1 || bolts[0].dst !== want) return L(`应该只向最近的 ${nameOf(r, want)} 发一发魔弹。`, `One bolt at the nearest enemy (${nameOf(r, want)}) wanted.`);
  return null;
}

function weakestCheck(r: Run): Line | null {
  const bolts = mine(r, 'projectile');
  const want = r.s.get('weakest')[0];
  if (bolts.length !== 1) return L(`你发了 ${bolts.length} 发魔弹，只许一发。`, `You fired ${bolts.length} bolts; exactly one is allowed.`);
  if (bolts[0].dst !== want) return L(`打错了：最弱的是 ${nameOf(r, want)}（${fmt(r.s.world.creatures.get(want)?.hp ?? 0)} 点生命）。`, `Wrong target: the weakest is the ${nameOf(r, want)}.`);
  return null;
}

function halfwayCheck(r: Run): Line | null {
  const me0 = HALL;
  const want = { x: (me0.x + r.s.aim.x) / 2, z: (me0.z + r.s.aim.z) / 2 };
  const d = dist(r.s.me.pos, want);
  if (!mine(r, 'apparate').length) return L('你没有幻影显形。', 'You did not Apparate.');
  return d <= 1 ? null : L(`你落在离中点 ${d.toFixed(1)} 米的地方。`, `You landed ${d.toFixed(1)} m from the midpoint.`);
}

export const EXAM_BY_ID = new Map(EXAMS.map((e) => [e.id, e]));

// ------------------------------------------------------------------ grading (pure: no live world anywhere)

export interface CaseResult { n: number; name: Line; ok: boolean; detail: Line | null; gas: number; mana: number; effects: string[]; error?: string; notes: string[] }
export interface Grading {
  exam: string;
  ok: boolean;
  grade: Grade;
  passed: number;
  cases: CaseResult[];
  nodes: number;
  gas: number;
  mana: number;
  /** 100 × mean(value / par) over nodes, gas and mana; 100 is par. Only for a pass. */
  points: number | null;
  /** A static problem: the source did not compile at the exam's year, or broke the exam's limits. */
  compileError?: string;
  timedOut?: boolean;
}

export function pointsFor(par: Par, s: { nodes: number; gas: number; mana: number }): number {
  const r = (v: number, p: number) => (p > 0 ? v / p : 1);
  return Math.round(((r(s.nodes, par.nodes) + r(s.gas, par.gas) + r(s.mana, par.mana)) / 3) * 100);
}

export function gradeFor(ok: boolean, points: number | null, passed: number, total: number): Grade {
  if (ok) return (points ?? Infinity) <= 100 ? 'O' : (points ?? Infinity) <= 130 ? 'E' : 'A';
  if (passed * 2 >= total && passed > 0) return 'P';
  return passed > 0 ? 'D' : 'T';
}

const caseSeed = (exam: ExamDef, i: number) => hash32('owl', exam.id, i);

/** Grade `source` against every hidden case of `exam`. Deterministic; touches nothing but its own sandboxes. */
export function gradeExam(exam: ExamDef, source: string, opts: { budgetMs?: number } = {}): Grading {
  const deadline = performance.now() + (opts.budgetMs ?? SIT_BUDGET_MS);
  const base: Grading = { exam: exam.id, ok: false, grade: 'T', passed: 0, cases: [], nodes: 0, gas: 0, mana: 0, points: null };
  let program: Node[];
  try {
    const a = analyze(source, { year: exam.year, maxNodes: maxNodes(exam.year, defaultRulebook()), banned: [], seals: 0 });
    program = a.program;
    base.nodes = a.nodes;
    if (exam.limits?.nodes !== undefined && a.nodes > exam.limits.nodes) {
      return { ...base, compileError: `this exam allows at most ${exam.limits.nodes} nodes; your spell has ${a.nodes}. 本题最多 ${exam.limits.nodes} 个节点，你的咒语有 ${a.nodes} 个。` };
    }
  } catch (e) {
    return { ...base, compileError: (e as Error).message };
  }
  for (let i = 0; i < exam.cases.length; i++) {
    const c = exam.cases[i];
    if (performance.now() > deadline) {
      base.timedOut = true;
      base.cases.push({ n: i + 1, name: c.name, ok: false, detail: L('考试时间到。', 'Time is up.'), gas: 0, mana: 0, effects: [], notes: [] });
      continue;
    }
    const { run, timedOut } = runCase(exam, c, program, caseSeed(exam, i), deadline);
    let detail: Line | null;
    let error: string | undefined;
    if (timedOut) { base.timedOut = true; detail = L('考试时间到。', 'Time is up.'); }
    else if (!run.report.ok && !run.noop) { error = run.report.error; detail = L(`咒语失败了：${error}`, `The spell fizzled: ${error}`); }
    else if (exam.limits?.gas !== undefined && run.gas > exam.limits.gas) detail = L(`用了 ${run.gas} 点 gas，本题最多 ${exam.limits.gas}。`, `Used ${run.gas} gas; this exam allows ${exam.limits.gas}.`);
    else {
      const bad = run.delayed.find((d) => !d.ok && !d.error?.startsWith(NOTHING));
      detail = c.check(run) ?? (bad ? L(`延迟块失败了：${bad.error}`, `A delayed block fizzled: ${bad.error}`) : null);
    }
    const effects = [...run.report.effects, ...run.delayed.flatMap((d) => d.effects.map((x) => `(after) ${x}`))];
    base.cases.push({ n: i + 1, name: c.name, ok: !detail, detail, gas: run.gas, mana: run.mana, effects, ...(error ? { error } : {}), notes: [...run.report.notes, ...run.delayed.flatMap((d) => d.notes)] });
  }
  const passed = base.cases.filter((c) => c.ok).length;
  const ok = passed === exam.cases.length;
  const gas = Math.max(0, ...base.cases.map((c) => c.gas));
  const mana = Math.max(0, ...base.cases.map((c) => c.mana));
  const points = ok ? pointsFor(exam.par, { nodes: base.nodes, gas, mana }) : null;
  return { ...base, ok, passed, gas, mana, points, grade: gradeFor(ok, points, passed, exam.cases.length) };
}

/** A CI-style log of a grading, one line per case. */
export function ciLog(exam: ExamDef, g: Grading): string {
  const lines = [`O.W.L. ${SUBJECTS[exam.subject].en} — ${exam.title.en}（${exam.title.zh}） · year ${exam.year}`];
  if (g.compileError) lines.push(`  ✗ compile: ${g.compileError}`);
  for (const c of g.cases) {
    lines.push(`  ${c.ok ? '✓' : '✗'} case ${c.n}/${exam.cases.length} ${c.name.zh} · ${c.name.en}  (gas ${c.gas}, mana ${fmt(c.mana)})`);
    if (c.detail) lines.push(`      ${c.detail.zh} ${c.detail.en}`);
  }
  const score = g.ok ? `  score ${g.points} (nodes ${g.nodes}/${exam.par.nodes}, gas ${g.gas}/${exam.par.gas}, mana ${fmt(g.mana)}/${exam.par.mana}; 100 = par, lower is better)` : '';
  lines.push(`${g.ok ? 'PASS' : 'FAIL'} ${g.passed}/${exam.cases.length} — ${g.grade} ${GRADE_NAMES[g.grade].zh} ${GRADE_NAMES[g.grade].en}${score}`);
  return lines.join('\n');
}

// ------------------------------------------------------------------ the weekly rotation

/** ISO week of a real-time instant: key "2026-W40", and when that week starts and ends (Monday 00:00 UTC). */
export function isoWeek(ms: number): { key: string; start: number; end: number } {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
  const thursday = new Date(start + 3 * 86400e3);
  const y = thursday.getUTCFullYear();
  const week = 1 + Math.floor((thursday.getTime() - Date.UTC(y, 0, 1)) / (7 * 86400e3));
  return { key: `${y}-W${String(week).padStart(2, '0')}`, start, end: start + 7 * 86400e3 };
}

/**
 * This week's exams: EXAMS_PER_WEEK from the pool, chosen by a hash of the world secret and the ISO week (so every
 * realm of a server agrees, and nobody can predict next week from the source), always with at least two a first- or
 * second-year can sit. Sorted by year.
 */
export function weeklyExams(secret: string, ms: number): ExamDef[] {
  const { key } = isoWeek(ms);
  const seed = createHash('sha256').update(`${secret}|owl|${key}`).digest().readUInt32LE(0);
  const rng = mulberry32(seed);
  const pool = [...EXAMS];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const chosen = pool.slice(0, EXAMS_PER_WEEK);
  const rest = pool.slice(EXAMS_PER_WEEK);
  while (chosen.filter((e) => e.year <= 2).length < 2) {
    const easy = rest.findIndex((e) => e.year <= 2);
    const hard = chosen.map((e, i) => [e, i] as const).reverse().find(([e]) => e.year > 2);
    if (easy < 0 || !hard) break;
    chosen[hard[1]] = rest.splice(easy, 1)[0];
  }
  return chosen.sort((a, b) => a.year - b.year || a.id.localeCompare(b.id));
}

// ------------------------------------------------------------------ sitting an exam in the live world

/** Rewards for the first pass of an exam in a week, by exam year, times the grade's multiplier. */
export const rewardBase = (year: number) => ({ xp: 10 + 10 * year, galleons: 2 + 2 * year, reputation: 1 + year });
export const GRADE_MULT: Record<Grade, number> = { O: 1.5, E: 1.25, A: 1, P: 0, D: 0, T: 0 };

const sitTimes = new WeakMap<World, Map<string, number[]>>();
function throttle(world: World, wid: string, now: number) {
  let m = sitTimes.get(world);
  if (!m) { m = new Map(); sitTimes.set(world, m); }
  const times = (m.get(wid) ?? []).filter((t) => now - t < 60_000);
  if (times.length >= SITS_PER_MIN) throw new Error(`考官请你歇一歇：每分钟最多交 ${SITS_PER_MIN} 份答卷。 The examiners need a breather: at most ${SITS_PER_MIN} sittings a minute.`);
  times.push(now);
  m.set(wid, times);
}

const better = (a: OwlBest, b: OwlBest | undefined) => {
  if (!b) return true;
  const ap = PASSING.has(a.grade), bp = PASSING.has(b.grade);
  if (ap !== bp) return ap;
  if (ap) return (a.points ?? Infinity) < (b.points ?? Infinity);
  return a.passed > b.passed;
};

function viewBest(b: OwlBest | undefined) {
  return b ? { grade: b.grade, gradeName: GRADE_NAMES[b.grade], points: b.points, nodes: b.nodes, gas: b.gas, mana: b.mana, passed: `${b.passed}/${b.cases}` } : null;
}

function viewBoard(world: World, examId: string, wid?: string) {
  return (world.owls.boards[examId] ?? []).map((e, i) => ({
    rank: i + 1, name: e.name, house: e.house, grade: e.grade, points: e.points, nodes: e.nodes, gas: e.gas, mana: e.mana, week: e.week, ...(e.wid === wid ? { you: true } : {}),
  }));
}

const GRADING_TEXT = L(
  '每题若干隐藏测试用例，全部通过才算及格。分数 = 100 × (节点/标准 + gas/标准 + 法力/标准) / 3，100 为标准线，越低越好。O ≤ 100，E ≤ 130，其余及格为 A；不及格：过半用例通过为 P，至少一个为 D，一个都没过（或编译失败）为 T（巨怪）。每周每题第一次及格发奖励，之后成绩提高补发差额。',
  'Each exam has hidden test cases; all must pass. Score = 100 × mean(nodes/par, gas/par, mana/par): 100 is par, lower is better. O ≤ 100, E ≤ 130, any other pass A. Failing: P if at least half the cases pass, D if one does, T (Troll) if none do or it does not compile. The first pass of an exam each week pays a reward; a better grade later pays the difference.',
);

/** This week's exams as a candidate sees them. */
export function listExams(world: World, wid: string, ms = Date.now()) {
  const w = world.need(wid);
  const wk = isoWeek(ms);
  const exams = weeklyExams(world.secret, ms);
  const mineNow = world.owls.bests[wid]?.[wk.key] ?? {};
  return {
    title: L('普通巫师等级考试', 'Ordinary Wizarding Levels (O.W.L.s)'),
    week: wk.key, resetsAt: new Date(wk.end).toISOString(),
    grading: GRADING_TEXT,
    progress: {
      passed: exams.filter((e) => mineNow[e.id] && PASSING.has(mineNow[e.id].grade)).length,
      outstanding: exams.filter((e) => mineNow[e.id]?.grade === 'O').length,
      of: exams.length,
    },
    exams: exams.map((e) => ({
      id: e.id, year: e.year, subject: SUBJECTS[e.subject], title: e.title, brief: e.brief,
      par: e.par, ...(e.limits ? { limits: e.limits } : {}), cases: e.cases.length,
      reward: { ...rewardBase(e.year), note: 'first pass this week; ×1.5 for an O, ×1.25 for an E' },
      ...(w.year < e.year ? { locked: `year ${e.year} 需 ${e.year} 年级` } : {}),
      yourBest: viewBest(mineNow[e.id]),
      top: viewBoard(world, e.id, wid).slice(0, 3),
    })),
  };
}

/** Per-exam leaderboards (top 10): one exam, or every exam of this week. */
export function examLeaderboard(world: World, wid: string | null, examId?: string, ms = Date.now()) {
  const one = (e: ExamDef) => ({ id: e.id, title: e.title, year: e.year, par: e.par, top: viewBoard(world, e.id, wid ?? undefined) });
  if (examId) {
    const e = EXAM_BY_ID.get(examId);
    if (!e) throw new Error(`No exam "${examId}". 没有这门考试。`);
    return one(e);
  }
  return { week: isoWeek(ms).key, boards: weeklyExams(world.secret, ms).map(one) };
}

/**
 * Sit one of this week's exams: grade the source in the sandbox, then (and only then) touch the live world —
 * file the best score, pay bounded first-pass rewards, grant the week's achievements, tell a joke for a T.
 */
export function sitExam(world: World, wid: string, examId: string, source: string, ms = Date.now()) {
  const w = world.need(wid);
  const wk = isoWeek(ms);
  const week = weeklyExams(world.secret, ms);
  const exam = week.find((e) => e.id === examId);
  if (!exam) throw new Error(`"${examId}" is not one of this week's O.W.L.s (${week.map((e) => e.id).join(', ')}). "${examId}" 不在本周考试里。`);
  if (w.year < exam.year) throw new Error(`"${exam.title.en}" is a year-${exam.year} exam; you are year ${w.year}. 「${exam.title.zh}」是 ${exam.year} 年级的考试，你现在 ${w.year} 年级。`);
  throttle(world, wid, ms);

  const g = gradeExam(exam, String(source ?? ''));
  const log = ciLog(exam, g);

  // ---- file it (the only writes to the live world)
  const book = world.owls;
  const mineAll = (book.bests[wid] ??= {});
  for (const k of Object.keys(mineAll)) if (k !== wk.key && k !== isoWeek(ms - 7 * 86400e3).key) delete mineAll[k];
  const bests = (mineAll[wk.key] ??= {});
  const prev = bests[exam.id];
  const cur: OwlBest = { grade: g.grade, points: g.points, nodes: g.nodes, gas: g.gas, mana: g.mana, passed: g.passed, cases: exam.cases.length, paid: prev?.paid ?? 0, at: ms };
  const improved = better(cur, prev);
  if (improved) bests[exam.id] = cur;
  const best = bests[exam.id];

  let rewards: { xp: number; galleons: number; reputation: number } | null = null;
  const owed = GRADE_MULT[g.grade] - best.paid;
  if (g.ok && owed > 0) {
    const b = rewardBase(exam.year);
    rewards = { xp: Math.round(b.xp * owed), galleons: Math.round(b.galleons * owed), reputation: Math.round(b.reputation * owed) };
    best.paid = GRADE_MULT[g.grade];
    world.gainXp(w, rewards.xp);
    w.galleons += rewards.galleons;
    world.addRep(w, rewards.reputation, 'owls');
  }

  let rank: number | null = null;
  if (g.ok && g.points !== null) {
    const board = (book.boards[exam.id] ?? []).slice();
    const i = board.findIndex((e) => e.wid === wid);
    if (i < 0 || g.points < board[i].points) {
      if (i >= 0) board.splice(i, 1);
      board.push({ wid, name: w.name, house: w.house, points: g.points, grade: g.grade, nodes: g.nodes, gas: g.gas, mana: g.mana, week: wk.key, at: ms });
      board.sort((a, b) => a.points - b.points || a.at - b.at);
      book.boards[exam.id] = board.slice(0, BOARD_SIZE);
    } else book.boards[exam.id] = board;
    const at = book.boards[exam.id].findIndex((e) => e.wid === wid);
    rank = at >= 0 ? at + 1 : null;
  }

  const achievements: string[] = [];
  if (week.every((e) => bests[e.id] && PASSING.has(bests[e.id].grade)) && world.achieve(w, 'owl_full_marks')) achievements.push('owl_full_marks');
  if (week.every((e) => bests[e.id]?.grade === 'O') && world.achieve(w, 'owl_all_o')) achievements.push('owl_all_o');
  if (g.grade === 'T' && world.achieve(w, 'owl_troll')) achievements.push('owl_troll');

  const pool = g.grade === 'T' ? TROLL_LINES : g.grade === 'O' ? OUTSTANDING_LINES : null;
  const line = pool ? fill(world.quip(pool, w.handle, exam.id), { exam: exam.title }) : null;
  const gn = GRADE_NAMES[g.grade];
  world.emit('system', `O.W.L. ${exam.title.en}: ${g.grade} (${gn.en})${rewards ? ` — +${rewards.xp} XP, +${rewards.galleons} Galleons, +${rewards.reputation} reputation` : ''}.${line ? ` ${line.en}` : ''}`, {
    to: w.id, zh: `普通巫师等级考试「${exam.title.zh}」：${g.grade}（${gn.zh}）${rewards ? `——经验 +${rewards.xp}，加隆 +${rewards.galleons}，声望 +${rewards.reputation}` : ''}。${line ? line.zh : ''}`,
  });

  return {
    exam: exam.id, title: exam.title, verdict: g.ok ? 'PASS' : 'FAIL', grade: g.grade, gradeName: gn,
    passed: `${g.passed}/${exam.cases.length}`,
    score: { points: g.points, nodes: g.nodes, gas: g.gas, mana: g.mana }, par: exam.par, ...(exam.limits ? { limits: exam.limits } : {}),
    log,
    cases: g.cases.map((c) => ({ case: c.n, name: `${c.name.zh} · ${c.name.en}`, ok: c.ok, ...(c.detail ? { why: `${c.detail.zh} ${c.detail.en}` } : {}), gas: c.gas, mana: c.mana, effects: c.effects, ...(c.notes.length ? { notes: c.notes } : {}) })),
    ...(g.compileError ? { compileError: g.compileError } : {}),
    ...(g.ok ? {} : { hint: `${exam.hint.zh} ${exam.hint.en}` }),
    ...(g.ok && g.grade !== 'O' ? { toReachO: `Par is ${exam.par.nodes} nodes, ${exam.par.gas} gas, ${exam.par.mana} mana: get your score to 100 or below. 达到标准线（分数 ≤ 100）即为 O。` } : {}),
    best: viewBest(best), improved, rank, rewards, achievements,
    ...(line ? { meme: `${line.zh} ${line.en}` } : {}),
  };
}

export type SitReport = ReturnType<typeof sitExam>;
