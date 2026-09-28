import { ITEM_MODS, MAX_YEAR, type ItemMod } from '../shared/constants.js';
import { CORE_BONUS } from '../lore/wands.js';
import type { Rulebook } from './rulebook.js';
import type { Item, Wizard } from './types.js';

/** Total XP needed to *reach* each year (index = year). */
export const XP_FOR_YEAR = [0, 0, 150, 400, 800, 1400, 2200, 3300];
export const yearForXp = (xp: number) => {
  let y = 1;
  for (let i = 2; i <= MAX_YEAR; i++) if (xp >= XP_FOR_YEAR[i]) y = i;
  return y;
};

/** Reputation stolen when stunning a wizard: ⌊victim · pct / 100⌋ (formal/lean: steal_le, duel_conserves). */
export const stealAmount = (victim: number, pct: number) => Math.floor((Math.max(0, victim) * pct) / 100);

export const maxNodes = (year: number, rb: Rulebook) => 40 + rb.magic.nodesPerYear * (year - 1);
export const gasLimit = (year: number, rb: Rulebook) => 150 + rb.magic.gasPerYear * (year - 1);
export const spellbookSize = (year: number) => 4 + year;
export const MAX_ITEMS = 16;

export function equippedItems(w: Wizard): Item[] {
  return Object.values(w.equipped).map((id) => w.items.find((i) => i.id === id)).filter((i): i is Item => !!i);
}

export function mod(w: Wizard, m: ItemMod): number {
  return equippedItems(w).reduce((s, i) => s + (i.mods[m] ?? 0), 0);
}

export function derived(w: Wizard, rb: Rulebook) {
  const core = CORE_BONUS[w.wand.core] ?? {};
  const elder = equippedItems(w).some((i) => i.unique === 'elder_wand');
  return {
    // a unicorn's curse: a half-life (auras are pruned every tick, so presence means active)
    maxHp: Math.round((100 + 15 * (w.year - 1) + mod(w, 'maxHp')) * ((w.auras ?? []).some((a) => a.k === 'cursed') ? 0.7 : 1)),
    maxMana: rb.magic.baseMaxMana + rb.magic.manaPerYear * (w.year - 1) + mod(w, 'maxMana'),
    manaRegen: rb.magic.manaRegen + mod(w, 'manaRegen') + (core.regen ?? 0),
    speedMult: 1 + mod(w, 'speed') / 100,
    power: 1 + (mod(w, 'power') + (core.power ?? 0) + (elder ? 25 : 0)) / 100,
    care: 1 + (core.care ?? 0) / 100,
    ward: Math.min(0.5, mod(w, 'ward') / 100),
  };
}

/** Item forging economics: a budget of "enchantment points" set by the forger's year. */
export const MOD_LIMITS: Record<ItemMod, { max: number; pts: number; doc: string }> = {
  maxHp: { max: 60, pts: 0.25, doc: '+max health' },
  maxMana: { max: 60, pts: 0.25, doc: '+max mana' },
  manaRegen: { max: 5, pts: 3, doc: '+mana per second' },
  speed: { max: 25, pts: 0.6, doc: '+% move speed' },
  power: { max: 20, pts: 1, doc: '+% spell damage' },
  ward: { max: 20, pts: 1, doc: '% damage reduction' },
};
export const itemBudget = (forgerYear: number) => 6 + 4 * forgerYear;

export function itemPoints(mods: Partial<Record<ItemMod, number>>, charmNodes = 0): { points: number; errors: string[] } {
  const errors: string[] = [];
  let points = 0;
  for (const [k, v] of Object.entries(mods)) {
    if (!(ITEM_MODS as readonly string[]).includes(k)) { errors.push(`unknown mod '${k}' (valid: ${ITEM_MODS.join(', ')})`); continue; }
    const lim = MOD_LIMITS[k as ItemMod];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) { errors.push(`${k} must be a non-negative number`); continue; }
    if (v > lim.max) errors.push(`${k} ${v} exceeds the cap of ${lim.max}`);
    points += v * lim.pts;
  }
  points += charmNodes / 4;
  return { points: Math.round(points * 100) / 100, errors };
}
export const itemPrice = (points: number) => Math.max(5, Math.ceil(points * 3));
