import type { World } from '../kernel/world.js';
import { shopItem } from '../shared/shop.js';

export const UNKNOWN_SHOP_ITEM = 'The shop does not sell that.';

/**
 * {t:'buy', item}: a preset from src/shared/shop.ts forged into your own trunk through the one forge
 * syscall (World#forgeItem: budget, price and trunk limits all apply), then worn if that slot is free.
 */
export function buyPreset(world: World, wid: string, key: string, lang: 'zh' | 'en' = 'zh') {
  const p = shopItem(key);
  if (!p) throw new Error(UNKNOWN_SHOP_ITEM);
  const r = world.forgeItem(wid, wid, { name: lang === 'en' ? p.en : p.zh, slot: p.slot, mods: { ...p.mods }, lore: lang === 'en' ? p.lore.en : p.lore.zh });
  const w = world.wizards.get(wid);
  let equipped = false;
  if (w && !w.equipped[p.slot]) { world.equip(wid, r.item.id); equipped = true; }
  return { item: r.item.name, slot: p.slot, equipped, notes: r.notes };
}
