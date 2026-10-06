/**
 * 符文零件 (docs/DESIGN.md §3.3; after Balatro's jokers and Noita's wand modifiers): small pieces, each one sentence,
 * that you put on a spell and that change how it lands. They sit over the Runes code — the card illustrates the
 * effect, not executable source — so a first-year gets the joy of building a spell before writing one.
 * Shared by the kernel (src/kernel/runes.ts: what they do, how you get them) and the browser (client/panels/runes.ts).
 */
export type RuneId = 'split' | 'chain' | 'burst';
export interface RuneDef { zh: string; en: string; docZh: string; docEn: string; /** Illustrative effect sketch, not executable Runes source. */ code: string; howZh: string; howEn: string }
export const RUNES: Record<RuneId, RuneDef> = {
  split: { zh: '分裂', en: 'Split', docZh: '这发魔弹同时向左右各多射一发（每发 60% 威力）', docEn: 'the bolt goes out as three, fanned (60% power each)', code: '(bolt (rotate aim -18) …) (bolt (rotate aim 18) …)', howZh: '第一次打出元素反应', howEn: 'your first magic reaction' },
  chain: { zh: '连锁', en: 'Chain', docZh: '命中后跳到旁边最多两个敌人（每跳 8 点，同一元素）', docEn: 'a hit leaps on to up to two more foes nearby (8 each, same element)', code: '(chain target 8)', howZh: '通关一个遭遇时挑选（温室、蜘蛛巢、佐科后院）', howEn: 'pick it when you clear an encounter (the greenhouse, the spider nest, Zonko’s yard)' },
  burst: { zh: '爆裂', en: 'Burst', docZh: '命中处炸开 3 米（6 点，同一元素）', docEn: 'a hit bursts 3 m round the target (6, same element)', code: '(nova 3 6)', howZh: '第一次解开一组道具谜题，或通关遭遇时挑选', howEn: 'your first puzzle of three props, or pick it when you clear an encounter' },
};
export const RUNE_IDS = Object.keys(RUNES) as RuneId[];
/** Split's fan (degrees either side) and share of the power; chain's reach and leaps; burst's radius and power (level 1). */
export const SPLIT_DEG = 18, SPLIT_SHARE = 0.6, CHAIN_R = 8, CHAIN_LEAPS = 2, CHAIN_DMG = 8, BURST_R = 3, BURST_DMG = 6;
/**
 * Levels (an encounter's reward can raise one, src/shared/encounters.ts), 1..RUNE_MAX: split's extra bolts each side
 * (SPLIT_DEG apart) and their share; chain's leaps; burst's radius and power.
 */
export const RUNE_MAX = 3;
export const SPLIT_LV = [{ each: 1, share: SPLIT_SHARE }, { each: 2, share: SPLIT_SHARE }, { each: 2, share: 0.75 }] as const;
export const CHAIN_LV = [CHAIN_LEAPS, 3, 4] as const;
export const BURST_LV = [{ r: BURST_R, dmg: BURST_DMG }, { r: 4, dmg: 8 }, { r: 5, dmg: 10 }] as const;
/** What a rune does at level `lv` (1-based), one line each language. */
export function runeAt(k: RuneId, lv: number): { zh: string; en: string } {
  const i = Math.max(0, Math.min(RUNE_MAX, lv) - 1);
  if (k === 'split') { const s = SPLIT_LV[i], n = 1 + 2 * s.each, pc = Math.round(s.share * 100); return { zh: `一发变 ${n} 发（每发 ${pc}% 威力）`, en: `one bolt goes out as ${n} (${pc}% power each)` }; }
  if (k === 'chain') return { zh: `命中后跳到旁边最多 ${CHAIN_LV[i]} 个敌人（每跳 ${CHAIN_DMG} 点）`, en: `a hit leaps on to up to ${CHAIN_LV[i]} more foes (${CHAIN_DMG} each)` };
  const b = BURST_LV[i];
  return { zh: `命中处炸开 ${b.r} 米（${b.dmg} 点）`, en: `a hit bursts ${b.r} m round (${b.dmg})` };
}
