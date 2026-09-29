import type { ItemMod, ItemSlot } from './constants.js';

/**
 * The browser shop (Diagon Alley by owl): a few fixed presets so Galleons are useful without an agent.
 * Buying one is an ordinary forge_item for yourself (World#forgeItem), so every budget, price and trunk
 * rule applies; the server only checks the key against this list (src/server/shop.ts).
 */
export interface ShopItem { key: string; slot: ItemSlot; zh: string; en: string; mods: Partial<Record<ItemMod, number>>; lore: { zh: string; en: string } }

export const SHOP: readonly ShopItem[] = [
  { key: 'amulet', slot: 'amulet', zh: '生命护符', en: 'Amulet of Vigour', mods: { maxHp: 20 }, lore: { zh: '庞弗雷夫人推荐。', en: 'Madam Pomfrey approves.' } },
  { key: 'broom', slot: 'broom', zh: '飞天扫帚', en: 'Cleansweep Broom', mods: { speed: 10 }, lore: { zh: '不是光轮 2000，但也够快。', en: 'Not a Nimbus 2000, but quick enough.' } },
  { key: 'ring', slot: 'trinket', zh: '回蓝指环', en: 'Ring of Focus', mods: { manaRegen: 1, maxMana: 12 }, lore: { zh: '戴上它，魔杖不容易没电。', en: 'Your wand runs flat less often.' } },
  { key: 'robe', slot: 'robe', zh: '龙皮护甲长袍', en: 'Dragon-hide Robe', mods: { ward: 5 }, lore: { zh: '查理·韦斯莱从罗马尼亚寄来的边角料。', en: 'Offcuts Charlie Weasley sent from Romania.' } },
];

export const shopItem = (key: string) => SHOP.find((s) => s.key === key) ?? null;
