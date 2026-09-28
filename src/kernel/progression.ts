import {
  HEX_HP_FLOOR_FRAC, HEX_MALICE_TAX, HP_FLOOR, HP_FLOOR_FRAC, ITEM_MODS, MANA_FLOOR, MANA_FLOOR_FRAC, MANAREGEN_FLOOR_FRAC, MAX_YEAR,
  MOVE_SLOW_FLOOR, NEG_LIMITS, POWER_FLOOR, SPEED_FLOOR, WARD_MAX, WARD_MIN, type ItemMod,
} from '../shared/constants.js';
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

export interface Derived {
  readonly maxHp: number;
  readonly maxMana: number;
  readonly manaRegen: number;
  readonly speedMult: number;
  readonly power: number;
  readonly care: number;
  readonly ward: number;
}

// ------------------------------------------------------------------ stat floors (docs/AGENT_LINK.md §B.7)
// Pure functions of derived()'s own inputs, so the cache below needs no new key. Each mirrors a Lean
// definition in formal/lean/Hogwarts.lean (hp_floor, mana_floor, manaregen_floor, speed_floor,
// power_pos, ward_bounded, move_floor, hex_dot_floor) and is compared through formal/vectors.json.
// With non-negative enchantments none of them ever binds: they only matter for cursed items.

/** Max health of a year before items and curses. */
export const yearBaseHp = (year: number) => 100 + 15 * (year - 1);
/** maxHp ≥ max(40, 60% of the year's base). */
export const hpFloor = (year: number) => Math.max(HP_FLOOR, Math.floor(yearBaseHp(year) * HP_FLOOR_FRAC));
/** maxMana ≥ max(20, 50% of the year's base mana). */
export const manaFloor = (baseMana: number) => Math.max(MANA_FLOOR, Math.floor(baseMana * MANA_FLOOR_FRAC));
/** manaRegen ≥ 50% of the rulebook's rate (never a drain). */
export const manaRegenFloor = (ruleRegen: number) => ruleRegen * MANAREGEN_FLOOR_FRAC;
/** Movement multiplier from speed enchantments (percent): ≥ 0.5. */
export const speedMultFor = (speedPct: number) => Math.max(SPEED_FLOOR, 1 + speedPct / 100);
/** Damage multiplier from power bonuses (percent): ≥ 0.25, so damage can never turn into healing. */
export const powerFor = (powerPct: number) => Math.max(POWER_FLOOR, 1 + powerPct / 100);
/** Damage reduction from ward (percent): within [-0.25, 0.5]. */
export const wardFor = (wardPct: number) => Math.min(WARD_MAX, Math.max(WARD_MIN, wardPct / 100));
/** Slow from chill and Jelly-Legs together: you always keep at least a quarter of your speed. */
export const moveSlow = (chill: number, jelly: number) => Math.max(MOVE_SLOW_FLOOR, 1 - chill - jelly);
/** A jinx's damage over time never takes you below max(1, 25% of max health): hexes harass, they never knock out. */
export const hexHpFloor = (maxHp: number) => Math.max(1, Math.floor(maxHp * HEX_HP_FLOOR_FRAC));
/** Health after `dmg` of jinx damage: never below the floor (nor below what you already had, if you were under it). */
export const hexDotHp = (hp: number, maxHp: number, dmg: number) => Math.max(Math.min(hp, hexHpFloor(maxHp)), hp - Math.max(0, dmg));

/**
 * Uncached reference implementation (the cache below is tested against it). The unicorn's curse is the
 * only aura read here: jinxes (jelly, dance, boils, bats, silence) act live where they apply, so the
 * cache key below needs nothing new. Any future stat-changing aura must join that key.
 */
export function derivedUncached(w: Wizard, rb: Rulebook): Derived {
  const core = CORE_BONUS[w.wand.core] ?? {};
  const elder = equippedItems(w).some((i) => i.unique === 'elder_wand');
  const baseMana = rb.magic.baseMaxMana + rb.magic.manaPerYear * (w.year - 1);
  return {
    // a unicorn's curse: a half-life (auras are pruned every tick, so presence means active)
    maxHp: Math.max(hpFloor(w.year), Math.round((yearBaseHp(w.year) + mod(w, 'maxHp')) * ((w.auras ?? []).some((a) => a.k === 'cursed') ? 0.7 : 1))),
    maxMana: Math.max(manaFloor(baseMana), baseMana + mod(w, 'maxMana')),
    manaRegen: Math.max(manaRegenFloor(rb.magic.manaRegen), rb.magic.manaRegen + mod(w, 'manaRegen') + (core.regen ?? 0)),
    speedMult: speedMultFor(mod(w, 'speed')),
    power: powerFor(mod(w, 'power') + (core.power ?? 0) + (elder ? 25 : 0)),
    care: 1 + (core.care ?? 0) / 100,
    ward: wardFor(mod(w, 'ward')),
  };
}

/**
 * Per-wizard cache of derived stats. derived() runs many times per wizard per tick (movement,
 * regeneration, damage, entity views, snapshots) and computing it walks the equipment seven times.
 * The cache is validated against everything the result depends on: year, wand core, the items array
 * (identity and length), every equipped slot, the curse aura and the three rulebook numbers. So
 * equip/unequip/forge/destroy/level-up/curse/decree all invalidate it without any call site having to
 * remember to (tests and MCP tools mutate wizards directly). Items are immutable once forged.
 * The returned object is shared: treat it as read-only.
 */
interface DerivedCache {
  year: number; core: string; items: Item[]; nItems: number; eqKeys: string[]; eqVals: (string | undefined)[]; cursed: boolean;
  base: number; perYear: number; regen: number; value: Derived;
}
const derivedCache = new WeakMap<Wizard, DerivedCache>();

function isCursed(w: Wizard) {
  const a = w.auras;
  if (!a) return false;
  for (let i = 0; i < a.length; i++) if (a[i].k === 'cursed') return true;
  return false;
}

function sameEquip(c: DerivedCache, eq: Wizard['equipped']) {
  let i = 0;
  for (const k in eq) {
    if (i >= c.eqKeys.length || c.eqKeys[i] !== k || c.eqVals[i] !== eq[k as keyof typeof eq]) return false;
    i++;
  }
  return i === c.eqKeys.length;
}

export function derived(w: Wizard, rb: Rulebook): Derived {
  const cursed = isCursed(w);
  const m = rb.magic;
  const c = derivedCache.get(w);
  if (c && c.year === w.year && c.core === w.wand.core && c.items === w.items && c.nItems === w.items.length && c.cursed === cursed
    && c.base === m.baseMaxMana && c.perYear === m.manaPerYear && c.regen === m.manaRegen && sameEquip(c, w.equipped)) return c.value;
  const value = derivedUncached(w, rb);
  const eqKeys = Object.keys(w.equipped);
  derivedCache.set(w, {
    year: w.year, core: w.wand.core, items: w.items, nItems: w.items.length, cursed, base: m.baseMaxMana, perYear: m.manaPerYear, regen: m.manaRegen, value,
    eqKeys, eqVals: eqKeys.map((k) => w.equipped[k as keyof Wizard['equipped']]),
  });
  return value;
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

/**
 * Enchantment points of a set of mods. Negative values are allowed only on a parcel for someone else
 * (`allowNeg`), down to NEG_LIMITS, and cost the same per point as positive ones (|v| × price).
 */
export function itemPoints(mods: Partial<Record<ItemMod, number>>, charmNodes = 0, allowNeg = false): { points: number; errors: string[] } {
  const errors: string[] = [];
  let points = 0;
  for (const [k, v] of Object.entries(mods)) {
    if (!(ITEM_MODS as readonly string[]).includes(k)) { errors.push(`unknown mod '${k}' (valid: ${ITEM_MODS.join(', ')})`); continue; }
    const lim = MOD_LIMITS[k as ItemMod];
    if (typeof v !== 'number' || !Number.isFinite(v) || (v < 0 && !allowNeg)) { errors.push(`${k} must be a non-negative number`); continue; }
    if (v > lim.max) errors.push(`${k} ${v} exceeds the cap of ${lim.max}`);
    if (v < NEG_LIMITS[k as ItemMod]) errors.push(`${k} ${v} is below the floor of ${NEG_LIMITS[k as ItemMod]}`);
    points += Math.abs(v) * lim.pts;
  }
  points += charmNodes / 4;
  return { points: Math.round(points * 100) / 100, errors };
}
export const itemPrice = (points: number) => Math.max(5, Math.ceil(points * 3));
/** What a hostile parcel costs its sender: the item's price plus the malice tax (Lean: hex_cost_pos). */
export const hexPrice = (points: number) => itemPrice(points) + HEX_MALICE_TAX;
