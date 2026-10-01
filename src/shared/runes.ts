/**
 * 符文零件 (docs/DESIGN.md §3.3; after Balatro's jokers and Noita's wand modifiers): small pieces, each one sentence,
 * that you put on a spell and that change how it lands. They sit over the Runes code — the card says what line of
 * code each one is worth — so a first-year gets the joy of building a spell before writing one.
 * Shared by the kernel (src/kernel/runes.ts: what they do, how you get them) and the browser (client/panels/runes.ts).
 */
export type RuneId = 'split' | 'chain' | 'burst';
export interface RuneDef { zh: string; en: string; docZh: string; docEn: string; /** the Runes it is worth, for the card */ code: string; howZh: string; howEn: string }
export const RUNES: Record<RuneId, RuneDef> = {
  split: { zh: '分裂', en: 'Split', docZh: '这发魔弹同时向左右各多射一发（每发 60% 威力）', docEn: 'the bolt goes out as three, fanned (60% power each)', code: '(bolt (rotate aim -18) …) (bolt (rotate aim 18) …)', howZh: '第一次打出元素反应', howEn: 'your first magic reaction' },
  chain: { zh: '连锁', en: 'Chain', docZh: '命中后跳到旁边最多两个敌人（每跳 8 点，同一元素）', docEn: 'a hit leaps on to up to two more foes nearby (8 each, same element)', code: '(chain target 8)', howZh: '清空温室的魔鬼网', howEn: 'clear the greenhouse of Devil’s Snare' },
  burst: { zh: '爆裂', en: 'Burst', docZh: '命中处炸开 3 米（6 点，同一元素）', docEn: 'a hit bursts 3 m round the target (6, same element)', code: '(nova 3 6)', howZh: '第一次解开一组道具谜题', howEn: 'your first puzzle of three props' },
};
export const RUNE_IDS = Object.keys(RUNES) as RuneId[];
/** Split's fan (degrees either side) and share of the power; chain's reach and leaps; burst's radius and power. */
export const SPLIT_DEG = 18, SPLIT_SHARE = 0.6, CHAIN_R = 8, CHAIN_LEAPS = 2, CHAIN_DMG = 8, BURST_R = 3, BURST_DMG = 6;
/** The greenhouse encounter: downing this many Devil's Snares there clears it (and pays the chain rune). */
export const GREENHOUSE_SNARES = 3;
export const GREENHOUSE = { x: 41, z: -28, r: 16 };
