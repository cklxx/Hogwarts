export const HOUSES = ['Gryffindor', 'Hufflepuff', 'Ravenclaw', 'Slytherin'] as const;
export type House = (typeof HOUSES)[number];

export const HOUSE_COLORS: Record<House, number> = {
  Gryffindor: 0xae0001,
  Hufflepuff: 0xecb939,
  Ravenclaw: 0x2a5bd7,
  Slytherin: 0x2a8a3e,
};

export const ELEMENTS = ['arcane', 'fire', 'ice', 'lightning', 'light'] as const;
export type Element = (typeof ELEMENTS)[number];

export const ELEMENT_COLORS: Record<Element, number> = {
  arcane: 0xd46cff,
  fire: 0xff6a1a,
  ice: 0x8fe3ff,
  lightning: 0xfff45c,
  light: 0xffffff,
};

/** Creatures that spawn in the wild (and can be toggled by decree). */
export const CREATURE_KINDS = ['pixie', 'snare', 'spider', 'troll', 'dementor', 'inferius', 'unicorn', 'phoenix'] as const;
export type WildKind = (typeof CREATURE_KINDS)[number];
/** Creatures conjured by the summon primitive. */
export const SUMMON_KINDS = ['serpent', 'birds'] as const;
export type SummonKind = (typeof SUMMON_KINDS)[number];
export type CreatureKind = WildKind | SummonKind;
export const SUMMON_YEAR: Record<SummonKind, number> = { serpent: 2, birds: 3 };

export const EFFECT_PRIMITIVES = [
  'bolt', 'heal', 'shield', 'push', 'haste', 'root', 'nova', 'disarm', 'patronus', 'apparate', 'light', 'say', 'reveal', 'chain', 'storm',
  'regen', 'mend', 'revive', 'cleanse', 'summon',
] as const;
export type EffectPrimitive = (typeof EFFECT_PRIMITIVES)[number];

export const ITEM_SLOTS = ['wand', 'robe', 'amulet', 'trinket', 'broom'] as const;
export type ItemSlot = (typeof ITEM_SLOTS)[number];

export const ITEM_MODS = ['maxHp', 'maxMana', 'manaRegen', 'speed', 'power', 'ward'] as const;
export type ItemMod = (typeof ITEM_MODS)[number];

/** Hogwarts years 1..7, then life after school. */
export const YEAR_TITLES = [
  '',
  'First Year', 'Second Year', 'Third Year', 'Fourth Year (O.W.L. prep)',
  'Fifth Year (O.W.L.s)', 'Sixth Year (N.E.W.T. prep)', 'Seventh Year (N.E.W.T.s)',
];
export const MAX_YEAR = 7;

/** HUD corners unlocked by casting a charm (reveal). */
export const UI_CHARMS = { tempus: 1, revelio: 1, 'point-me': 2, homenum: 3 } as const;
export type UiCharm = keyof typeof UI_CHARMS;
