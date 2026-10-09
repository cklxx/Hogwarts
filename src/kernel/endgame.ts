/**
 * 终局 (the Endgame Feature): what waits after year 7.
 *
 *  - N.E.W.T.: five practical "papers" measured from the wizard's own record (Charms casts, DADA hunts, a forged
 *    spell, a Restricted-Section seal, public service at events). Three papers pass at grade A, four E, five O;
 *    a better grade can be earned later and pays the difference.
 *  - Graduation (prestige): a year-7 N.E.W.T. holder may graduate any time. The wizard keeps name, house, wand,
 *    spells, cards, items and Galleons; year and XP reset; each graduation earns one capped choice among three
 *    strategy legacies that affect regional bounties, not permanent combat stats.
 *  - Overflow XP: after the year-7 floor, every 500 overflow XP becomes 1 Galleon and every 1000 becomes 1
 *    reputation, computed from XP (no extra persistence).
 *  - The daily Bounty Board: three hunt-location bounties a day (grounds, greenhouses, dungeons, forest). Kills are
 *    tallied by the zone the killer stands in, specific zones first (forest sits inside the grounds zone). It is
 *    the visible guide that spreads wizards across the map (issue #27).
 */
import { z } from 'zod';
import { inZoneId, ZONES } from '../shared/map.js';
import type { Feature } from './feature.js';
import { derived } from './progression.js';
import { QUEST_ALL_REP, QUEST_REP } from './quests.js';
import { ecologyControl, ecologyYieldPct, type EcologyZone } from './ecology.js';
import type { Wizard } from './types.js';
import type { World } from './world.js';

declare module './types.js' {
  interface Wizard {
    /** N.E.W.T. result this life; reset at graduation. Persisted. */
    newt?: { grade: Grade; papers: number; at: number } | null;
    /** Chosen alumni strategies. Each path is capped; old saves receive unspent choices. */
    legacies?: AlumniLegacies;
  }
}

export type Grade = 'A' | 'E' | 'O';
export type LegacyPath = 'ranger' | 'steward' | 'conservator';
export interface AlumniLegacies { ranger: number; steward: number; conservator: number; available: number }
export const LEGACY_CAP = 3;
export const blankLegacies = (): AlumniLegacies => ({ ranger: 0, steward: 0, conservator: 0, available: 0 });
export const legacyRank = (w: Wizard, path: LegacyPath) => Math.max(0, Math.min(LEGACY_CAP, w.legacies?.[path] ?? 0));
function ensureLegacies(w: Wizard) {
  if (!w.legacies) w.legacies = { ...blankLegacies(), available: Math.min(LEGACY_CAP * 3, w.graduates ?? 0) };
  return w.legacies;
}
const MAX_YEAR = 7;
const NEWT_FLOOR_XP = 3300; // XP_FOR_YEAR[7]
const XP_PER_GALLEON = 500;
const XP_PER_REP = 1000;
const NEWT_REP = 50;
const NEWT_GALLEONS = 80;
const NEWT_TITLE = 'N.E.W.T. Auror Candidate';
const GRADE_RANK: Record<Grade, number> = { A: 0, E: 1, O: 2 };
const GRADE_MULT: Record<Grade, number> = { A: 1, E: 1.2, O: 1.5 };

interface Paper { id: string; name: string; en: string; zh: string; met: (w: Wizard) => boolean }
const PAPERS: readonly Paper[] = [
  { id: 'charms', name: 'Charms', en: 'Cast spells 120 times', zh: '施法 120 次', met: (w) => w.stats.casts >= 120 },
  { id: 'dada', name: 'Defence Against the Dark Arts', en: 'Defeat 60 creatures', zh: '打倒 60 只生物', met: (w) => w.stats.creatures >= 60 },
  { id: 'spellcraft', name: 'Spellcraft', en: 'Forge a spell of your own', zh: '铸造一个自己的咒语', met: (w) => (w.stats.spells ?? 0) >= 1 },
  { id: 'seals', name: 'Study of Ancient Runes', en: 'Break one Restricted-Section seal', zh: '破解一道禁书区封印', met: (w) => w.seals >= 1 },
  {
    id: 'service', name: 'Public Service', en: 'Score for your house in a school event', zh: '在校园事件里为学院拿分',
    met: (w) => (w.cup?.src.events ?? 0) + (w.cup?.src.quidditch ?? 0) >= 1,
  },
];
const gradeFor = (papers: number): Grade | null => (papers >= 5 ? 'O' : papers === 4 ? 'E' : papers === 3 ? 'A' : null);

// ------------------------------------------------------------------ the daily Bounty Board
interface HuntZone { zone: EcologyZone; name: string; bx?: number; bz?: number }
const HUNT_ZONES: readonly HuntZone[] = [
  // the grounds zone center (0,-30) sits inside the Courtyard box, so the bounty marker uses an open point
  { zone: 'grounds', name: 'Hogwarts Grounds', bx: 75, bz: -55 },
  { zone: 'greenhouses', name: 'Greenhouses' },
  { zone: 'dungeons', name: 'Dungeon Stair' },
  { zone: 'forest', name: 'The Forbidden Forest' },
];
/** Specific zones first: the Forbidden Forest sits inside the larger grounds zone. */
const ZONE_PRIORITY: readonly EcologyZone[] = ['forest', 'greenhouses', 'dungeons', 'grounds'];
const BOUNTY_N = [6, 8, 10];
const BOUNTY_REP = [6, 8, 10];
const BOUNTY_GALLEONS = [10, 12, 15];
const BOUNTIES_PER_DAY = 3;

/** Deterministic non-crypto string hash (FNV-1a). */
function hashStr(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
export interface Bounty { zone: EcologyZone; n: number; rep: number; galleons: number }
/** Three location bounties for this day: the zone order is shuffled by a day hash, no world dice. */
export function pickBounties(day: number): Bounty[] {
  let h = 2166136261 ^ day;
  const pool = HUNT_ZONES.map((z) => z.zone);
  const out: Bounty[] = [];
  for (let i = 0; i < BOUNTIES_PER_DAY; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const zone = pool.splice(h % pool.length, 1)[0];
    out.push({ zone, n: BOUNTY_N[i], rep: BOUNTY_REP[i], galleons: BOUNTY_GALLEONS[i] });
  }
  return out;
}
/** A stable home hunt-zone for a wizard handle: even with no board call, identical handles shard apart. */
export function homeZone(handle: string): EcologyZone {
  return HUNT_ZONES[hashStr(handle) % HUNT_ZONES.length].zone;
}

interface EGState {
  day: number; creatures: number;
  done: Record<string, number>; claimed: string[];
  gTier: number; rTier: number;
}
const states = new Map<string, EGState>();
const dayOf = (world: World) => Math.floor(world.now / 86400);
function stateOf(world: World, w: Wizard): EGState {
  const day = dayOf(world);
  let st = states.get(w.id);
  if (!st) {
    st = { day, creatures: w.stats.creatures, done: {}, claimed: [], gTier: 0, rTier: 0 };
    states.set(w.id, st);
  }
  if (st.day !== day) { st.day = day; st.done = {}; st.claimed = []; st.creatures = w.stats.creatures; }
  return st;
}

/** Overflow XP beyond the year-7 floor converts to Galleons and reputation. */
function overflow(world: World, w: Wizard, st: EGState) {
  if (w.year < MAX_YEAR || w.xp <= NEWT_FLOOR_XP) {
    st.gTier = Math.max(0, Math.floor((w.xp - NEWT_FLOOR_XP) / XP_PER_GALLEON));
    st.rTier = Math.max(0, Math.floor((w.xp - NEWT_FLOOR_XP) / XP_PER_REP));
    return;
  }
  const over = w.xp - NEWT_FLOOR_XP;
  const g = Math.floor(over / XP_PER_GALLEON);
  if (g > st.gTier) {
    const d = g - st.gTier;
    w.galleons += d;
    world.tell(w, { zh: `溢出经验转换：加隆 +${d}（每 ${XP_PER_GALLEON} 溢出经验）。`, en: `Overflow XP converted: +${d} Galleons (${XP_PER_GALLEON} overflow XP each).` });
  }
  st.gTier = g;
  const r = Math.floor(over / XP_PER_REP);
  if (r > st.rTier) world.addRep(w, r - st.rTier, 'events');
  st.rTier = r;
}

/** Attribute new kills to the hunt-zone the killer stands in (specific zones first). */
function tally(world: World, w: Wizard, st: EGState) {
  if (w.stats.creatures <= st.creatures) return;
  let inc = Math.min(10, w.stats.creatures - st.creatures);
  st.creatures = w.stats.creatures;
  const active = new Set(pickBounties(st.day).map((b) => b.zone));
  for (const zone of ZONE_PRIORITY) {
    if (!active.has(zone) || st.claimed.includes(zone)) continue;
    if (inZoneId(zone, w.pos.x, w.pos.z)) { st.done[zone] = (st.done[zone] ?? 0) + inc; return; }
  }
}

/** Auto-pay bounties that reached their target. */
function claim(world: World, w: Wizard, st: EGState) {
  for (const b of pickBounties(st.day)) {
    if (st.claimed.includes(b.zone)) continue;
    if ((st.done[b.zone] ?? 0) >= b.n) {
      const eco = world.ecology.zones[b.zone];
      const yieldPct = ecologyYieldPct(eco.resources);
      const control = ecologyControl(eco);
      const ranger = legacyRank(w, 'ranger');
      const steward = legacyRank(w, 'steward');
      const conservator = legacyRank(w, 'conservator');
      const rep = Math.round(b.rep * (1 + steward * 0.08));
      const galleons = Math.round(b.galleons * yieldPct / 100 * (1 + ranger * 0.08) * (control === w.house ? 1.1 : 1));
      world.addRep(w, rep, 'events');
      w.galleons += galleons;
      if (conservator > 0) eco.resources = Math.min(100, eco.resources + conservator);
      st.claimed.push(b.zone);
      const place = ZONES.find((z) => z.id === b.zone)?.name ?? b.zone;
      world.emit('achievement', `💰 Bounty done: defeat ${b.n} creatures at ${place}. +${rep} reputation, +${galleons} Galleons (regional yield ${yieldPct}%).`, {
        to: w.id, zh: `💰 悬赏完成：在${place}打倒 ${b.n} 只生物。声望 +${rep}，加隆 +${galleons}（区域收益 ${yieldPct}%）。`,
      });
    }
  }
}

// ------------------------------------------------------------------ N.E.W.T.
function newtStatus(world: World, wid: string) {
  const w = world.need(wid);
  const papers = PAPERS.map((p) => ({ id: p.id, name: p.name, requirement: p.en, zh: p.zh, met: p.met(w) }));
  const n = papers.filter((p) => p.met).length;
  return {
    eligible: w.year >= MAX_YEAR,
    papers, papersMet: n, passAt: 3, gradeNow: gradeFor(n),
    passed: w.newt ? { grade: w.newt.grade, papers: w.newt.papers } : null,
    rewards: { reputation: NEWT_REP, galleons: NEWT_GALLEONS, gradeMultiplier: GRADE_MULT },
  };
}

function sitNewt(world: World, wid: string) {
  const w = world.need(wid);
  if (w.year < MAX_YEAR) throw new Error('N.E.W.T. opens in year 7.');
  const n = PAPERS.reduce((s, p) => s + (p.met(w) ? 1 : 0), 0);
  const g = gradeFor(n);
  if (!g) throw new Error(`You meet ${n} of ${PAPERS.length} papers; N.E.W.T. needs 3. Call the newt tool with action status to see what to do.`);
  if (w.newt) {
    if (GRADE_RANK[g] <= GRADE_RANK[w.newt.grade]) throw new Error(`You already hold N.E.W.T. grade ${w.newt.grade}.`);
    const dMult = GRADE_MULT[g] - GRADE_MULT[w.newt.grade];
    const rep = Math.round(NEWT_REP * dMult);
    const galleons = Math.round(NEWT_GALLEONS * dMult);
    if (rep > 0) world.addRep(w, rep, 'owls');
    w.galleons += galleons;
    w.newt = { grade: g, papers: n, at: world.now };
    return { improved: g, rep, galleons };
  }
  const rep = Math.round(NEWT_REP * GRADE_MULT[g]);
  const galleons = Math.round(NEWT_GALLEONS * GRADE_MULT[g]);
  world.addRep(w, rep, 'owls');
  w.galleons += galleons;
  w.newt = { grade: g, papers: n, at: world.now };
  if (!w.titles.includes(NEWT_TITLE)) w.titles.push(NEWT_TITLE);
  world.emit('achievement', `🎓 ${w.name} passed N.E.W.T. with grade ${g}! +${rep} reputation, +${galleons} Galleons.`, {
    who: [w.id], zh: `🎓 ${w.name} 通过 N.E.W.T.，等级 ${g}！声望 +${rep}，加隆 +${galleons}。`,
  });
  return { passed: g, rep, galleons, title: NEWT_TITLE };
}

// ------------------------------------------------------------------ graduation (prestige)
function chooseLegacy(world: World, wid: string, path: LegacyPath) {
  const w = world.need(wid), legacies = ensureLegacies(w);
  if (legacies.available < 1) throw new Error('No alumni legacy choice is available. Graduate to earn one.');
  if (legacies[path] >= LEGACY_CAP) throw new Error(`${path} is already at its cap of ${LEGACY_CAP}.`);
  legacies[path]++;
  legacies.available--;
  world.emit('achievement', `${w.name} shapes an alumni legacy: ${path} rank ${legacies[path]}/${LEGACY_CAP}.`, {
    who: [w.id], zh: `${w.name} 选择了毕业遗产：${path} ${legacies[path]}/${LEGACY_CAP} 级。`,
  });
  return { path, rank: legacies[path], cap: LEGACY_CAP, available: legacies.available, legacies };
}

function graduate(world: World, wid: string) {
  const w = world.need(wid);
  if (w.year < MAX_YEAR) throw new Error('You can graduate after year 7.');
  if (!w.newt) throw new Error('Pass N.E.W.T. first (the newt tool, action sit).');
  const legacies = ensureLegacies(w);
  w.graduates = (w.graduates ?? 0) + 1;
  legacies.available++;
  w.year = 1;
  w.xp = 0;
  w.newt = null;
  w.termReputation = 0;
  world.stopWalk(w);
  const d = derived(w, world.rules);
  w.hp = d.maxHp;
  w.mana = d.maxMana;
  const title = `Hogwarts Alumnus ×${w.graduates}`;
  if (!w.titles.includes(title)) w.titles.push(title);
  states.delete(w.id);
  world.emit('achievement', `🎓 ${w.name} graduated and begins a new school life. ${title}: one strategy legacy choice earned.`, {
    who: [w.id], zh: `🎓 ${w.name} 毕业并开启新的学校生涯。${title}：获得一次策略遗产选择。`,
  });
  return { graduated: w.graduates, year: 1, maxHp: d.maxHp, maxMana: d.maxMana, title, legacyChoices: ensureLegacies(w).available };
}

// ------------------------------------------------------------------ the board view
function bountyBoard(world: World, wid: string) {
  const w = world.need(wid);
  const st = stateOf(world, w);
  return {
    day: st.day, resetsIn: (st.day + 1) * 86400 - world.now,
    bounties: pickBounties(st.day).map((b) => {
      const hz = HUNT_ZONES.find((q) => q.zone === b.zone)!;
      const z = ZONES.find((q) => q.id === b.zone)!;
      return {
        zone: b.zone, place: z.name, x: hz.bx ?? z.x, z: hz.bz ?? z.z, needed: b.n,
        slain: Math.min(b.n, st.done[b.zone] ?? 0), claimed: st.claimed.includes(b.zone),
        reward: { reputation: b.rep, galleons: b.galleons },
      };
    }),
  };
}

const ACTION = z.enum(['status', 'sit']);
const LEGACY = z.enum(['ranger', 'steward', 'conservator']);
export const ENDGAME_FEATURE: Feature = {
  id: 'endgame',
  sweep(world) {
    for (const w of world.wizards.values()) {
      if (w.npc || !world.online(w)) continue;
      const st = stateOf(world, w);
      overflow(world, w, st);
      tally(world, w, st);
      claim(world, w, st);
    }
    for (const id of [...states.keys()]) if (!world.wizards.has(id)) states.delete(id);
  },
  view: {
    key: 'endgame',
    whoami(world, w) {
      return {
        graduates: w.graduates ?? 0,
        legacies: ensureLegacies(w),
        legacyEffects: {
          ranger: 'Each rank adds 8% Galleons to regional bounties.',
          steward: 'Each rank adds 8% reputation to regional bounties.',
          conservator: 'Each rank restores 1 regional resource when a bounty completes.',
          cap: LEGACY_CAP,
        },
        newt: w.newt ? { grade: w.newt.grade, papers: w.newt.papers } : null,
        reputationPaths: [
          { en: `Daily lessons: +${QUEST_REP} reputation each, +${QUEST_ALL_REP} for all three`, zh: `今日课表：每项 +${QUEST_REP} 声望，全清 +${QUEST_ALL_REP}`, tool: 'lessons' },
          { en: 'Bounty Board: three location bounties a day, +6/+8/+10 reputation each', zh: '悬赏板：每天 3 个地点悬赏，各 +6/+8/+10 声望', tool: 'bounty_board' },
          { en: `N.E.W.T.: pass in year 7 for +${NEWT_REP} reputation (grade multiplier)`, zh: `N.E.W.T.：7 年级通过给 +${NEWT_REP} 声望（等级倍数）`, tool: 'newt' },
          { en: `Overflow XP: after year 7, every ${XP_PER_REP} overflow XP = 1 reputation`, zh: `溢出经验：7 年级后每 ${XP_PER_REP} 溢出经验 = 1 声望` },
          { en: 'Hunting: creatures carry their own reputation (spider +4, troll +14)', zh: '打怪：生物自带声望（蜘蛛 +4、巨怪 +14）' },
        ],
      };
    },
  },
  tools: [
    {
      name: 'newt', title: 'N.E.W.T.', cost: 1,
      description: 'The N.E.W.T. board: the five practical papers, which you meet, and your grade. Action "sit" takes the exam in year 7; pass at three papers (grade A), four (E), five (O).',
      input: { action: ACTION },
      run: (world, wid, a) => (a.action === 'sit' ? sitNewt(world, wid) : newtStatus(world, wid)),
    },
    {
      name: 'graduate', title: 'Graduate', cost: 3,
      description: 'Graduate from Hogwarts (year 7 and a passed N.E.W.T.). Year and XP reset to 1; you keep spells, cards, items and Galleons; each graduation earns one capped strategy legacy choice.',
      input: {},
      run: (world, wid) => graduate(world, wid),
    },
    {
      name: 'choose_legacy', title: 'Choose Alumni Legacy', cost: 1,
      description: `Spend one graduation choice on ranger, steward or conservator. Each path is capped at ${LEGACY_CAP}. Choices are permanent and create strategy differences instead of unlimited health stacking.`,
      input: { path: LEGACY },
      run: (world, wid, a) => chooseLegacy(world, wid, a.path as LegacyPath),
    },
    {
      name: 'bounty_board', title: 'Bounty Board', cost: 0, readOnly: true,
      description: "Today's creature bounties and where to hunt them (grounds, greenhouses, dungeons, forest). Each pays reputation and Galleons; bounties auto-complete when the target is reached.",
      input: {},
      run: (world, wid) => bountyBoard(world, wid),
    },
  ],
};
