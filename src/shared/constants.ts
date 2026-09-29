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
 * 以大欺小: knocking out a wizard more than BULLY_YEAR_GAP years below you pays no reputation (progression.ts
 * stunPaysRep, Lean `stun_pays_rep`), and an NPC never picks a fight with a player that far below it (npc.ts).
 */
export const BULLY_YEAR_GAP = 2;
/** NPCs keep the peace this close to the spawn point (npc.ts npcMayFight): nobody's first steps end in the Hospital Wing. */
export const NPC_CALM_R = 30;
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

// ------------------------------------------------------------------ 不公平，但好玩 (README "## 不公平，但好玩")
// Strength is visible, has counterplay, and the leader is worth hunting. One source for the kernel,
// formal/lean/Hogwarts.lean (compared through formal/vectors.json) and formal/tla/DAVeto.tla / Hex.tla.

/** 黑魔王: the Dark Lord is the reputation #1 among non-NPC wizards seen in the last DARK_LORD_SEEN_S, with at least this much. */
export const DARK_LORD_MIN_REP = 150;
export const DARK_LORD_SEEN_S = 180;
/** Hysteresis: a challenger takes the mark only with ≥ (100 + this)% of the holder's reputation (Lean: dark_lord_no_flap). */
export const DARK_LORD_HYSTERESIS_PCT = 10;
/** The Dark Lord's direct spell damage, in percent (×1.15; never stacks with the DA's joint bonus). */
export const DARK_LORD_POWER_PCT = 115;
/** How often the Dark Mark names the Dark Lord's whereabouts to everyone. */
export const DARK_LORD_BROADCAST_S = 60;

/**
 * 输赢代价不对称: the share of the victim's reputation a duel stun steals, by the victim's reputation
 * (at the rulebook's default duelRepStealPct = 10). [threshold, percent]: below 50 (newcomers) 5%, then 10%,
 * 15% from 200, 20% from 500; the Dark Lord always 30%. Never more than STEAL_CAP_PCT (Lean: duel_steal_cap).
 */
export const STEAL_TIERS: readonly (readonly [number, number])[] = [[0, 5], [50, 10], [200, 15], [500, 20]];
export const STEAL_DARK_LORD_PCT = 30;
export const STEAL_CAP_PCT = 30;
/** duelRepStealPct is scaled against this: the curve above is what the default (10) gives. */
export const STEAL_BASE_PCT = 10;

/** 邓布利多军: who may join (reputation below this, or below the median of wizards seen recently). */
export const DA_REP_CEILING = 100;
export const DA_MAX_MEMBERS = 24;
/** Members online needed for a veto vote to count (and a strict majority of them must vote). */
export const DA_QUORUM = 3;
/** A veto must come within this long of the decree, and at most DA_VETOES_PER_TERM per term. */
export const DA_VETO_WINDOW_S = 180;
export const DA_VETOES_PER_TERM = 1;
/** Joint spell: ≥ DA_JOINT_MIN members hitting the same target within DA_JOINT_WINDOW_S deal ×DA_JOINT_PCT%. */
export const DA_JOINT_MIN = 3;
export const DA_JOINT_WINDOW_S = 4;
export const DA_JOINT_PCT = 125;

/** 偷师: a custom spell that hit you can be studied STUDY_DELAY_S after it first did, while it hit you in the last STUDY_MEMORY_S. */
export const STUDY_DELAY_S = 120;
export const STUDY_MEMORY_S = 600;
/** Spells remembered per victim, and studies remembered (one study per spell per victim). */
export const STUDY_KEEP = 8;
export const STUDIED_KEEP = 64;

/** 无规则区: the deep Forbidden Forest (shared/map.ts LAWLESS_ZONE). Creature loot and duel reputation there ×this. */
export const LAWLESS_MULT = 2;

/**
 * 咒语集市 the spell market (src/kernel/market.ts; Lean `royalty_*`, TLA+ Market.tla). Royalties are counted in
 * tenths of a reputation point: when another (non-NPC, not freshly enrolled) wizard casts a market spell
 * successfully, its author gets MARKET_AUTHOR_TENTHS (+1 reputation) once per caster per spell per day, a fork's
 * parent author MARKET_PARENT_TENTHS (+0.3), and nobody more than rules.market.dailyCap reputation a day from
 * royalties (default MARKET_CAP_DEFAULT, constitutional bound MARKET_CAP_MAX).
 */
export const MARKET_AUTHOR_TENTHS = 10;
export const MARKET_PARENT_TENTHS = 3;
export const MARKET_DAY_S = 86400;
export const MARKET_CAP_DEFAULT = 20;
export const MARKET_CAP_MAX = 50;
/** A public "new in the market" line at most once per author per this long. */
export const MARKET_ANNOUNCE_S = 600;
/** Immutable versions a listing keeps (v1…v16), live listings per author, listings in the whole market. */
export const MARKET_MAX_VERSIONS = 16;
export const MARKET_MAX_PER_AUTHOR = 12;
export const MARKET_MAX_LISTINGS = 4000;
/** The decree lists (rules.market.banned / promoted) and a listing's description (per language). */
export const MARKET_BAN_MAX = 16;
export const MARKET_PROMOTE_MAX = 8;
export const MARKET_DESC_MAX = 140;
/** (spell, caster) pairs the royalty ledger remembers per day; beyond it no more royalties are paid that day. */
export const MARKET_LEDGER_MAX = 20000;
/** Market ids: "m_" and up to 12 base-36 characters. */
export const MARKET_ID_RE = /^m_[a-z0-9]{1,12}$/;

// ------------------------------------------------------------------ 学院杯 · 事件轮盘 · 巧克力蛙画片 (sprint 1, README 学院杯)
// One source for the kernel (kernel/housecup.ts, kernel/wheel.ts, kernel/cards.ts), formal/lean/Hogwarts.lean (house-point
// bounds, compared through formal/vectors.json) and formal/tla/EventWheel.tla.

/** Where a wizard's house points came from this term (十分梗 is a house-level bonus, kept apart in flags.housePoints). */
export const CUP_SOURCES = ['creatures', 'duels', 'events', 'owls', 'chests', 'quidditch', 'other'] as const;
export type CupSource = (typeof CUP_SOURCES)[number];
/** 决胜时刻: the last CUP_FINAL_S seconds of a term multiply every house point gained (rules.terms.finalMinuteMultiplier). */
export const CUP_FINAL_S = 60;
export const CUP_MULT_DEFAULT = 2;
/** The constitutional bound on the final-minute multiplier (Lean cup_mult_bounded). */
export const CUP_MULT_MAX = 3;
/** Anti-farm: one wizard adds at most rules.terms.wizardPointsCap house points a term (Lean cup_award_capped). */
export const CUP_CAP_DEFAULT = 400;
export const CUP_CAP_MIN = 50;
export const CUP_CAP_MAX = 5000;
/** How long the House Cup ceremony card stays up after a term ends (seconds). */
export const CUP_CEREMONY_S = 14;

/** 校园事件轮盘: every rules.events.intervalSeconds (bounds below) the world rolls one event from rules.events.pool. */
export const EVENT_IDS = ['troll', 'snitch', 'curfew', 'dementors', 'peeves', 'room'] as const;
export type EventId = (typeof EVENT_IDS)[number];
export const EVENT_INTERVAL_DEFAULT = 180;
export const EVENT_INTERVAL_MIN = 60;
export const EVENT_INTERVAL_MAX = 1800;
/** The longest any event may run (every event ends by its deadline: EventWheel.tla EndsByDeadline). */
export const EVENT_MAX_S = 150;
/** 金色飞贼: points for the catch, and the most snitch points one wizard can take in a term. */
export const SNITCH_POINTS = 150;
export const SNITCH_CAP_PER_TERM = 150;
/** 宵禁: points lost when Filch or Mrs Norris catches you (never below zero), and the grace before they can again. */
export const CURFEW_PENALTY = 5;
export const CURFEW_GRACE_S = 20;

/** 巧克力蛙画片: rarities, and the Galleons a duplicate turns into. */
export const CARD_RARITIES = ['common', 'rare', 'epic', 'legendary'] as const;
export type CardRarity = (typeof CARD_RARITIES)[number];
export const CARD_DUP_GALLEONS: Record<CardRarity, number> = { common: 5, rare: 12, epic: 30, legendary: 80 };
export const CARD_DROP_PCT_DEFAULT = 3;
export const CARD_DROP_PCT_MAX = 20;

/** Stunning a wizard enrolled less than this long ago earns no reputation (stops throwaway-alt farming); also no royalties, no hexes. */
export const FRESH_SECONDS = 600;

/** The browser's WebSocket carries the key as a subprotocol entry (it cannot set headers): src/server/key.ts. */
export const WS_PROTOCOL = 'hogwarts';
export const WS_KEY_PREFIX = 'hw-key.';

/** 触发式铁甲咒 (src/kernel/ward.ts): the longest a ward stays armed, the seconds between wards, the mana it costs. */
export const WARD_MAX_S = 3, WARD_CD_S = 8, WARD_MANA = 25;
