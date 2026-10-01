/**
 * 掉落 (the owner, 2026-10-01: 「丰富内容元素」): what breaking things leaves on the ground — a galleon, a drop of
 * mana, a heart, and the cauldrons' potions — sparkling until someone walks over it (LOOT_PICK_R) or LOOT_S passes.
 * Shared by the kernel (src/kernel/loot.ts) and the browser (client/loot3d.ts).
 */
export type LootKind = 'coin' | 'mana' | 'heart' | 'potion';
export interface LootDef { zh: string; en: string; /** what it gives */ galleons?: number; mana?: number; hp?: number }
export const LOOT: Record<LootKind, LootDef> = {
  coin: { zh: '加隆', en: 'galleon', galleons: 1 },
  mana: { zh: '魔力', en: 'mana', mana: 20 },
  heart: { zh: '生命', en: 'health', hp: 20 },
  potion: { zh: '药水', en: 'potion', hp: 45, mana: 25 },
};
/** A breakable drops one this often (an ice block always does); which one, by these weights. */
export const LOOT_PCT = 35;
export const LOOT_WEIGHTS: readonly [LootKind, number][] = [['coin', 50], ['mana', 25], ['heart', 25]];
/** Picked up within this of you; gone after LOOT_S; at most LOOT_MAX lie about at once. */
export const LOOT_PICK_R = 1.5, LOOT_S = 40, LOOT_MAX = 160;
/** Galleons picked up count against this a term, per wizard (docs/RULES.md: rewards are capped); after it, coins give nothing. */
export const LOOT_GALLEONS_PER_TERM = 60;
