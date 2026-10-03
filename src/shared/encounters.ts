/**
 * 遭遇 (docs/DESIGN.md §3.4, after Hades' chambers): each scene has one toy, a goal you can read in one line, and
 * when you reach it, a choice of three rewards — a rune you do not have, a level on one you do, or a purse. Each
 * encounter pays once per term per wizard (docs/RULES.md: rewards are capped).
 *
 * Each toy is built so that whatever a new player does there, something answers (docs/DESIGN.md §4):
 *  - 温室 greenhouse: humid — its Devil's Snares are always wet, so any hurting spell sets off a reaction;
 *  - 蜘蛛巢 the acromantula nest: webs in clusters of three — any hurting spell tears one, fire burns its cluster;
 *  - 黑湖 the Black Lake (from the second year): an ice spell over the water freezes a path along its way
 *    (src/shared/ice.ts), out to the grindylows' float in the middle;
 *  - 佐科后院 Zonko's yard: a row of whizbangs close enough that fire on any one sets off all five, and the Cornish
 *    pixies loose among them go up with it.
 * Shared by the kernel (src/kernel/encounters.ts) and the browser (client/panels/encounters.ts).
 */
import type { CreatureKind } from './constants.js';
import type { PropKind } from './props.js';
import { RUNES, runeAt, type RuneId } from './runes.js';
import type { SceneId } from './scenes.js';

export type EncounterId = 'greenhouse' | 'nest' | 'zonko' | 'lake';
export interface EncounterDef {
  id: EncounterId; scene: SceneId; zh: string; en: string;
  /** Where (a circle): what counts happens inside it, and the goal shows on your screen while you are in it. */
  x: number; z: number; r: number;
  /** What to do: down `need` creatures of a kind there, break `need` props of a kind there (within `within` s), or
   *  stand on a spot (its centre, REACH_R). */
  goal: { t: 'down'; kind: CreatureKind } | { t: 'break'; kind: PropKind } | { t: 'reach' };
  need: number; within?: number;
  goalZh: string; goalEn: string; tipZh: string; tipEn: string;
  /** The rune this encounter offers first (a new one, or a level on it). */
  rune: RuneId;
}

export const ENCOUNTERS: readonly EncounterDef[] = [
  {
    id: 'greenhouse', scene: 'castle', zh: '温室', en: 'the greenhouse', x: 41, z: -28, r: 16,
    goal: { t: 'down', kind: 'snare' }, need: 3, rune: 'chain',
    goalZh: '打倒 3 株魔鬼网', goalEn: "down 3 Devil's Snares",
    tipZh: '温室湿气重，魔鬼网一直是湿的：什么咒语打上去都有反应，火和光最疼', tipEn: 'the greenhouse is humid, the snares always wet: any spell sets off a reaction; fire and light hurt most',
  },
  {
    id: 'nest', scene: 'forest', zh: '蜘蛛巢', en: 'the acromantula nest', x: 140, z: 37, r: 13,
    goal: { t: 'break', kind: 'web' }, need: 9, rune: 'burst',
    goalZh: '烧掉巢里的 9 片蛛网', goalEn: 'burn the nest’s 9 webs',
    tipZh: '蛛网三片连成一簇：火一碰整簇都烧，烧着的蛛网也烫伤旁边的蜘蛛', tipEn: 'the webs hang in threes: fire on one burns the cluster, and scalds the spiders by it',
  },
  {
    id: 'zonko', scene: 'hogsmeade', zh: '佐科后院', en: 'Zonko’s yard', x: 14, z: 139, r: 9,
    goal: { t: 'break', kind: 'whizbang' }, need: 5, within: 3, rune: 'split',
    goalZh: '一口气炸掉 5 个烟火桶', goalEn: 'set off 5 whizbangs in one go',
    tipZh: '烟火桶挨得很近：火点着一个，一排都炸，跑出来的小精灵也一起炸飞', tipEn: 'the barrels stand close: fire on one sets off the row, and the loose pixies with it',
  },
  {
    id: 'lake', scene: 'lake', zh: '黑湖冰路', en: 'the ice road', x: -101, z: 40, r: 17,
    goal: { t: 'reach' }, need: 1, rune: 'chain',
    goalZh: '走到湖心的格林迪洛浮标', goalEn: "walk out to the grindylows' float",
    tipZh: '用二年级的冰冻三尺朝湖心射：冰沿着咒语的路冻成一条路，25 秒后化掉', tipEn: 'cast Glacius (second year) out over the water: it freezes a road along its way, gone in 25 s',
  },
];
/** A reach goal: standing this near the encounter's centre. */
export const REACH_R = 1.6;
export const encounterById = (id: string) => ENCOUNTERS.find((e) => e.id === id) ?? null;
export const encounterAt = (x: number, z: number) => ENCOUNTERS.find((e) => Math.hypot(x - e.x, z - e.z) <= e.r) ?? null;

/** Doors past the runes: a purse (galleons and a little experience), and study (experience): three doors while a rune
 *  can still be given or raised, two after. */
export const PURSE_GALLEONS = 10, PURSE_XP = 30, STUDY_XP = 60;

/** One door: a new rune, a level on one, the purse, or study. */
export type Door = { t: 'rune'; rune: RuneId } | { t: 'level'; rune: RuneId; to: number } | { t: 'purse' } | { t: 'study' };

/** What a door says (one line each language). */
export function doorText(d: Door): { zh: string; en: string } {
  if (d.t === 'rune') { const r = RUNES[d.rune], a = runeAt(d.rune, 1); return { zh: `新符文「${r.zh}」：${a.zh}`, en: `New rune ${r.en}: ${a.en}` }; }
  if (d.t === 'level') { const r = RUNES[d.rune], a = runeAt(d.rune, d.to); return { zh: `「${r.zh}」升到 ${d.to} 级：${a.zh}`, en: `${r.en} to level ${d.to}: ${a.en}` }; }
  if (d.t === 'purse') return { zh: `一袋加隆：+${PURSE_GALLEONS} 加隆、+${PURSE_XP} 经验`, en: `A purse: +${PURSE_GALLEONS} galleons, +${PURSE_XP} XP` };
  return { zh: `潜心研习：+${STUDY_XP} 经验`, en: `Study: +${STUDY_XP} XP` };
}

