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
  'regen', 'mend', 'revive', 'cleanse', 'summon', 'glamour',
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

// ------------------------------------------------------------------ Owl Post agent link (docs/AGENT_LINK.md §E)
// One source for the TypeScript kernel, formal/lean/Hogwarts.lean (checked through formal/vectors.json)
// and the TLA+ models' constants.

/** Pairing codes: 6 characters of a 31-letter alphabet without look-alikes (no I L O 0 1), shown ABC-DEF. */
export const PAIR_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PAIR_LEN = 6;
/** 31^6 = 887 503 681 possible codes (Lean: pair_space). */
export const PAIR_SPACE = PAIR_ALPHABET.length ** PAIR_LEN;
export const PAIR_TTL_S = 600;
/** A new wizard's first minutes: creatures hit 30% softer (the Hogwarts nurses call it 新生护符). */
export const NEWCOMER_WARD_S = 180;
export const NEWCOMER_WARD = 0.3;
/**
 * Failed pairing attempts per minute: per source (IP) and per realm. A source over its own cap is refused
 * without spending the realm's budget (World.redeemPairCode(code, source)), so locking a realm out takes
 * at least PAIR_FAIL_PER_REALM_PER_MIN / PAIR_FAIL_PER_IP_PER_MIN = 3 sources (Lean: realm_lock_needs_sources).
 */
export const PAIR_FAIL_PER_IP_PER_MIN = 10;
export const PAIR_FAIL_PER_REALM_PER_MIN = 30;
export const LOGIN_FAIL_PER_IP_PER_MIN = 20;

/** derived() floors: a curse scales you down, never out (Lean: hp_floor … ward_bounded). */
export const HP_FLOOR = 40;
export const HP_FLOOR_FRAC = 0.6;
export const MANA_FLOOR = 20;
export const MANA_FLOOR_FRAC = 0.5;
export const MANAREGEN_FLOOR_FRAC = 0.5;
export const SPEED_FLOOR = 0.5;
export const MOVE_SLOW_FLOOR = 0.25;
export const POWER_FLOOR = 0.25;
export const WARD_MIN = -0.25;
export const WARD_MAX = 0.5;

/** Cursed items: the most negative value each enchantment may take on a parcel for someone else. */
export const NEG_LIMITS: Record<ItemMod, number> = { maxHp: -30, maxMana: -30, manaRegen: -3, speed: -20, power: -15, ward: -20 };
export const CURSED_ITEM_BIND_S = 300;
export const HEX_MIN_YEAR = 2;
export const HEX_PAIR_COOLDOWN_S = 300;
export const HEX_MALICE_TAX = 3;
export const VICTIM_HEX_CAP = 3;
export const VICTIM_CURSED_ITEMS_MAX = 2;
export const VICTIM_BOUND_CAP = 1;
export const VICTIM_HEX_PER_10MIN = 3;
/** The window VICTIM_HEX_PER_10MIN counts over. */
export const HEX_WINDOW_S = 600;
export const HEX_RESPITE_S = 60;
export const SILENCE_MAX_S = 5;
export const SILENCE_COOLDOWN_S = 20;
export const HEX_HP_FLOOR_FRAC = 0.25;
export const FORGE_FAIL_PER_MIN = 12;

export const JINX_KINDS = ['jelly', 'dance', 'boils', 'bats', 'langlock'] as const;
export type JinxKind = (typeof JINX_KINDS)[number];
/** Kernel-chosen strength and duration of each jinx: nothing a player writes can make one stronger. */
export const JINX_DEFAULTS: Record<JinxKind, { mag: number; seconds: number }> = {
  jelly: { mag: 0.4, seconds: 20 }, dance: { mag: 1, seconds: 20 }, boils: { mag: 3, seconds: 12 },
  bats: { mag: 3, seconds: 5 }, langlock: { mag: 1, seconds: 5 },
};

/** Owl Post between a player and their own agent. */
export const OWLBOX_MAX = 50;
export const OWL_MAX_CHARS = 400;
/** Owls a minute from each side (the player and the agent count separately, so a chatty agent never gags its player). */
export const OWL_PER_MIN = 30;
export const ASK_TTL_S = 45;
export const LISTEN_MAX_S = 45;
/** Agent presence timestamps are rounded down to this many seconds (so `me` does not change every tick). */
export const AGENT_SEEN_ROUND_S = 5;
/** The human comes first: an agent's move_to is refused for this long after the player last steered (WASD or a click walk). */
export const PLAYER_GRACE_S = 2;
