/**
 * 魔法化学 (docs/DESIGN.md §3.1; after Breath of the Wild's chemistry engine and Genshin's reactions): one small table
 * of states and reactions that holds for every wizard and creature. A target can be 湿 (wet: the south lawn's dew,
 * the lake shore, rain, Aguamenti) or 冻结 (frozen: ice on the wet); burning and chill are the kernel's own auras.
 * A hurting spell on a target in a state reacts by its element — every element does something to the wet, so the
 * first hit on a wet pixie is always a reaction, whatever the first-year casts. Shared by the kernel
 * (src/kernel/chem.ts: the effects), the browser (client/chem3d.ts: the names, the bursts) and agents (look).
 */
import type { Element } from './constants.js';
import { PROP_DEFS, PROPS } from './props.js';

export type ReactionId = 'soak' | 'vaporize' | 'freeze' | 'conduct' | 'slip' | 'rainbow' | 'shatter' | 'melt' | 'overload' | 'douse';
export interface Reaction { zh: string; en: string; /** damage multiplier on the hit that set it off */ mult: number; doc: string }
export const REACTIONS: Record<ReactionId, Reaction> = {
  soak: { zh: '湿透', en: 'Soaked', mult: 0, doc: 'water on anything: wet for WET_S (the next spell reacts)' },
  vaporize: { zh: '蒸发', en: 'Vaporize', mult: 1.5, doc: 'fire on the wet: ×1.5, a burst of steam' },
  freeze: { zh: '冻结', en: 'Freeze', mult: 1, doc: 'ice on the wet: frozen solid for FREEZE_S (it cannot move)' },
  conduct: { zh: '感电', en: 'Conduct', mult: 1.5, doc: 'lightning on the wet: ×1.5, and it arcs to every wet foe within CONDUCT_R (half damage)' },
  slip: { zh: '滑倒', en: 'Slip', mult: 1, doc: 'a stunner on the wet: knocked SLIP_PUSH m back, off its feet for a moment' },
  rainbow: { zh: '彩虹', en: 'Rainbow', mult: 1, doc: "light on the wet: a rainbow heals the caster's house around them" },
  shatter: { zh: '碎冰', en: 'Shatter', mult: 2, doc: 'any hurting spell on the frozen: ×2, the ice breaks' },
  melt: { zh: '融化', en: 'Melt', mult: 1.5, doc: 'fire on the chilled: ×1.5, the chill thaws' },
  overload: { zh: '超载', en: 'Overload', mult: 1, doc: 'lightning on the burning: a fire blast of OVERLOAD_R round it' },
  douse: { zh: '浇灭', en: 'Douse', mult: 1, doc: 'water on the burning: the fire goes out' },
};

/** Wet lasts this long after the last soaking. */
export const WET_S = 8;
export const FREEZE_S = 2;
export const CONDUCT_R = 6;
export const SLIP_PUSH = 3;
export const OVERLOAD_R = 3.5;
export const RAINBOW_HEAL = 6;
/** The tag Aguamenti's bolt carries (a water bolt: it soaks, it does not hurt). */
export const WATER_TAG = 'water';

/** Where the ground itself soaks you. The south lawn: dew from the fountain in its middle — the first pixies a
 *  first-year meets live in it (src/kernel/creatures.ts), so their first hit is a reaction. */
export const WET_ZONES: readonly { id: string; zh: string; x: number; z: number; r: number }[] = [
  { id: 'lawn', zh: '草地露水', x: 12, z: 10, r: 20 },
  { id: 'lake', zh: '湖边浅水', x: -86, z: 36, r: 10 },
  // the greenhouses are humid: their Devil's Snare is always wet (the encounter there: src/kernel/runes.ts)
  { id: 'greenhouse', zh: '温室水汽', x: 41, z: -28, r: 14 },
];
/** A puddle (src/shared/props.ts, `wets`) wets whoever stands within this of it. */
export const PUDDLE_R = 1.8;
const PUDDLES = PROPS.filter((p) => PROP_DEFS[p.kind].wets);
export const inWetZone = (x: number, z: number) => WET_ZONES.some((w) => Math.hypot(x - w.x, z - w.z) <= w.r) || PUDDLES.some((p) => Math.abs(p.x - x) <= PUDDLE_R && Math.abs(p.z - z) <= PUDDLE_R && Math.hypot(p.x - x, p.z - z) <= PUDDLE_R);

/** What a hurting spell of `element` does to a target in these states (null: nothing), in the table's order. */
export function reactionOf(element: Element, st: { wet: boolean; frozen: boolean; burning: boolean; chilled: boolean }, water = false): ReactionId | null {
  if (water) return st.burning ? 'douse' : 'soak';
  if (st.frozen) return 'shatter';
  if (st.wet) return element === 'fire' ? 'vaporize' : element === 'ice' ? 'freeze' : element === 'lightning' ? 'conduct' : element === 'light' ? 'rainbow' : 'slip';
  if (st.burning && element === 'lightning') return 'overload';
  if (st.chilled && element === 'fire') return 'melt';
  return null;
}
