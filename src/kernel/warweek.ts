/**
 * 大战周 War Week (a Feature): the living-world countdown.
 *
 * Seven terms = seven days. At the start of each term the world announces Day N (1-7);
 * when Day 7 ends, the Dark assault begins: waves of hostile creatures march on the castle.
 * When the assault ends the world reports the outcome — who lived, who fought.
 *
 * Toggle: world.flags.warweek (default on). When off, terms run exactly as before.
 * Phase 1: the countdown, the assault, the report. No fate chains, no save-scumming (Phase 2).
 */
import { CREATURES } from './creatures.js';
import type { CreatureKind, House } from '../shared/constants.js';
import type { Creature, Vec2 } from './types.js';
import type { Feature } from './feature.js';
import type { World } from './world.js';
import { applyCycleStart, buildAftermath, tombstonesOf, type AftermathState } from './aftermath.js';

/** Seven terms make one War Week cycle: Day N = ((term.n - 1) % 7) + 1. */
export const WARWEEK_TERMS = 7;
/** The assault runs in waves this far apart, and ends by this deadline no matter what. */
export const WARWEEK_WAVE_GAP_S = 45;
export const WARWEEK_ASSAULT_MAX_S = 600;
/** Creatures per wave (×1, ×1.5, ×2 of the base): the "how many" multiplier on the normal spawn tables. */
export const WARWEEK_WAVE_SIZE = [6, 9, 12];
/** Victory XP for every player who hurt an assault creature. */
export const WARWEEK_HERO_XP = 50;

declare module './world.js' {
  interface World {
    /** 大战周 (this module's Feature): the term we last saw, and the running assault if any. */
    warweek: WarWeekState;
  }
}

interface WarWeekAssault {
  /** Assault creature ids (dead ones leave world.creatures; the set is pruned each tick). */
  mobs: Set<string>;
  /** Waves spawned so far. */
  wave: number;
  /** world.now when the next wave spawns. */
  nextWaveAt: number;
  /** Hard deadline: the assault ends here even with mobs still standing. */
  endsAt: number;
  /** Player (non-NPC) ids that damaged an assault creature. */
  participants: Set<string>;
  /** NPCs alive when the assault began (for the casualty count). */
  npcAliveAtStart: number;
  /** NPCs who fell during the assault (id -> where they fell): death is permanent for the cycle. */
  fallen: Map<string, { name: string; house: House; x: number; z: number }>;
}

interface WarWeekState {
  lastTerm: number;
  assault: WarWeekAssault | null;
}

const dayOf = (termN: number) => ((termN - 1) % WARWEEK_TERMS) + 1;

/** What marches on the castle: fast harassers, heavy hitters, and the soul-eaters. */
const ASSAULT_KINDS: CreatureKind[] = ['dementor', 'troll', 'spider', 'inferius'];
/** Where the waves come from: three approaches around the castle grounds. */
const ASSAULT_GATES: Vec2[] = [
  { x: -60, z: 40 },   // from the Forbidden Forest
  { x: 60, z: 40 },    // from the lake shore
  { x: 0, z: 100 },    // up the Hogsmeade road
];

function spawnAssaultMob(world: World, kind: CreatureKind, at: Vec2): Creature {
  const def = CREATURES[kind];
  const pos = { x: at.x + (world.rand() - 0.5) * 20, z: at.z + (world.rand() - 0.5) * 20 };
  if (!def.flying) world.solids.resolve(pos, def.radius);
  const hp = Math.round(def.hp * world.rules.creatures.statMultiplier);
  const c: Creature = {
    id: world.mintId('c'), kind, pos, home: { ...pos }, hp, maxHp: hp, facing: world.rand() * 6.28,
    target: null, attackCd: 1, rootedUntil: 0, wander: null, lastHitBy: null, damageBy: {},
    auras: [], owner: null, until: 0,
  };
  world.creatures.set(c.id, c);
  world.fx({ k: 'apparate', x: pos.x, z: pos.z });
  return c;
}

function spawnWave(world: World, a: WarWeekAssault) {
  const size = WARWEEK_WAVE_SIZE[Math.min(a.wave, WARWEEK_WAVE_SIZE.length - 1)];
  for (let i = 0; i < size; i++) {
    const kind = ASSAULT_KINDS[Math.floor(world.rand() * ASSAULT_KINDS.length)];
    const gate = ASSAULT_GATES[i % ASSAULT_GATES.length];
    a.mobs.add(spawnAssaultMob(world, kind, gate).id);
  }
  a.wave++;
  a.nextWaveAt = world.now + WARWEEK_WAVE_GAP_S;
}

function startAssault(world: World) {
  const npcs = [...world.wizards.values()].filter((w) => w.npc && world.isActive(w));
  const a: WarWeekAssault = {
    mobs: new Set(), wave: 0, nextWaveAt: world.now,
    endsAt: world.now + WARWEEK_ASSAULT_MAX_S,
    participants: new Set(), npcAliveAtStart: npcs.length,
    fallen: new Map(),
  };
  world.warweek.assault = a;
  world.emit('term',
    `🌑 Day 7 has ended. The Dark assault begins — hold the castle!`,
    { zh: `🌑 第 7 天结束了。黑暗大军开始进攻 —— 守住城堡！` });
}

function liveMobs(world: World, a: WarWeekAssault): string[] {
  const live: string[] = [];
  for (const id of a.mobs) {
    if (world.creatures.has(id)) live.push(id);
    else a.mobs.delete(id);
  }
  return live;
}

function settleAssault(world: World, a: WarWeekAssault) {
  world.warweek.assault = null;
  const live = liveMobs(world, a);
  const won = live.length === 0;
  // remaining assault creatures melt away at dawn (the assault is over either way)
  for (const id of live) world.creatures.delete(id);
  // 战后世界 (kernel/aftermath.ts): 名录、墓碑、商店、下周目加成
  const fallen = [...a.fallen.values()];
  const after: AftermathState = buildAftermath(world, won, fallen);
  const heroes = [...a.participants]
    .map((id) => world.wizards.get(id))
    .filter((w) => w && !w.npc);
  if (won) for (const w of heroes) world.gainXp(w!, WARWEEK_HERO_XP);
  const heroNames = heroes.map((w) => w!.name).slice(0, 5).join(', ') || 'no one';
  const alive = after.roster.filter((r) => r.alive).length;
  const dead = after.roster.filter((r) => !r.alive);
  const deadNames = dead.map((r) => r.name).slice(0, 6).join(', ');
  const lines = [
    won ? `☀️ The assault is broken!` : `🌘 The assault withdraws, undefeated.`,
    `${alive} villagers stand.`,
    dead.length ? `${dead.length} fell: ${deadNames}${dead.length > 6 ? '…' : ''}.` : `No one fell.`,
    `Heroes: ${heroNames} (+${WARWEEK_HERO_XP} XP).`,
    after.shopClosedUntilTerm >= world.term.n ? `The market closes its shutters.` : `The market stands at 20% off.`,
  ];
  const linesZh = [
    won ? `☀️ 进攻被击退了！` : `🌘 进攻退去了，但没有被打败。`,
    `还有 ${alive} 位村民站着。`,
    dead.length ? `倒下 ${dead.length} 位：${deadNames}${dead.length > 6 ? '……' : ''}。` : `无人倒下。`,
    `英雄：${heroNames}（+${WARWEEK_HERO_XP} 经验）。`,
    after.shopClosedUntilTerm >= world.term.n ? `集市关上了门板。` : `集市八折迎客。`,
  ];
  world.emit('term', lines.join(' '), { zh: linesZh.join('') });
}

const DAY_LINES: Record<number, { en: string; zh: string }> = {
  1: { en: '📜 War Week, Day 1. Seven days until the Dark assault. Prepare.', zh: '📜 大战周，第 1 天。黑暗大军 7 天后进攻。准备吧。' },
  2: { en: '📜 War Week, Day 2. Stock potions, mend your wands.', zh: '📜 大战周，第 2 天。囤魔药，修好魔杖。' },
  3: { en: '📜 War Week, Day 3. Scouts report movement in the forest.', zh: '📜 大战周，第 3 天。斥候报告禁林里有动静。' },
  4: { en: '📜 War Week, Day 4. The castle wards are being strengthened.', zh: '📜 大战周，第 4 天。城堡防护正在加固。' },
  5: { en: '📜 War Week, Day 5. Dementors circle the lake. Two days left.', zh: '📜 大战周，第 5 天。摄魂怪在湖上盘旋。还剩两天。' },
  6: { en: '📜 War Week, Day 6. Tomorrow they come. Rest while you can.', zh: '📜 大战周，第 6 天。明天他们就来了。能休息就休息。' },
  7: { en: '📜 War Week, Day 7 — the last day. Arm yourselves. Tonight the sky burns.', zh: '📜 大战周，第 7 天 —— 最后一天。拿起武器。今晚天空会燃烧。' },
};

function stepWarWeek(world: World) {
  const st = world.warweek;
  if (world.term.n !== st.lastTerm) {
    const oldDay = st.lastTerm > 0 ? dayOf(st.lastTerm) : 0;
    const newDay = dayOf(world.term.n);
    st.lastTerm = world.term.n;
    if (!world.flags.warweek) return;
    // Day 7 just ended: the assault begins (before the new cycle's Day 1 line)
    if (oldDay === WARWEEK_TERMS && !st.assault) startAssault(world);
    const line = DAY_LINES[newDay];
    if (line) world.emit('term', line.en, { zh: line.zh });
    // 新周目 Day 1: 上周目战报摘要 + 发放 pending buffs (kernel/aftermath.ts)
    if (newDay === 1 && oldDay === WARWEEK_TERMS) applyCycleStart(world);
  }
  if (!world.flags.warweek) return;
  const a = st.assault;
  if (!a) return;
  // track who is fighting: any player damage on an assault creature counts
  for (const id of liveMobs(world, a)) {
    const c = world.creatures.get(id)!;
    for (const wid of Object.keys(c.damageBy)) {
      const w = world.wizards.get(wid);
      if (w && !w.npc) a.participants.add(wid);
    }
  }
  // track the fallen: an NPC stunned during the assault does not get up (death is permanent for the cycle)
  for (const w of world.wizards.values()) {
    if (!w.npc || a.fallen.has(w.id)) continue;
    if (w.st.stunnedUntil > world.now || w.hp <= 0) {
      a.fallen.set(w.id, { name: w.name, house: w.house, x: w.pos.x, z: w.pos.z });
    }
  }
  if (a.wave < WARWEEK_WAVE_SIZE.length && world.now >= a.nextWaveAt) spawnWave(world, a);
  const remaining = liveMobs(world, a);
  const wavesDone = a.wave >= WARWEEK_WAVE_SIZE.length;
  if ((wavesDone && remaining.length === 0) || world.now >= a.endsAt) settleAssault(world, a);
}

export const WARWEEK_FEATURE: Feature = {
  id: 'warweek',
  init(world) {
    world.warweek = { lastTerm: 0, assault: null };
  },
  stepLate(world) { stepWarWeek(world); },
  save: (world) => ({ lastTerm: world.warweek.lastTerm }),
  load(world, data) {
    const d = (data ?? {}) as { lastTerm?: unknown };
    world.warweek.lastTerm = typeof d.lastTerm === 'number' ? d.lastTerm : world.term.n;
    world.warweek.assault = null; // never resume mid-assault across a restart
  },
  wire: {
    key: 'warweek',
    get: (world) => ({
      day: dayOf(world.term.n),
      total: WARWEEK_TERMS,
      // 墓碑：2D 客户端渲染（client2d/renderer.ts）
      tombstones: tombstonesOf(world).map((t) => ({ n: t.name, x: t.x, z: t.z })),
    }),
  },
};
