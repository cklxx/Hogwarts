import type { CreatureKind, Element, House, ItemMod, ItemSlot } from '../shared/constants.js';
import type { Node } from '../runes/parser.js';
import type { Env } from '../runes/interp.js';
import type { Aura, AuraKind } from './auras.js';

export interface Vec2 { x: number; z: number }

export interface Wand { wood: string; core: string; length: number; flexibility: string; note?: string }

export interface Spell {
  id: string;
  name: string;
  incantation: string;
  source: string;
  nodes: number;
  minYear: number;
  effects: string[];
  builtin: boolean;
  createdAt: number;
}

export interface Item {
  id: string;
  name: string;
  slot: ItemSlot;
  mods: Partial<Record<ItemMod, number>>;
  charm?: { source: string; nodes: number };
  lore?: string;
  forgedBy: string;
  forgedByName: string;
  createdAt: number;
  unique?: 'elder_wand' | 'diadem' | 'firebolt';
}

export interface WizardStatus {
  shield: number; shieldUntil: number;
  hasteMult: number; hasteUntil: number;
  rootedUntil: number;
  disarmedUntil: number;
  lightUntil: number;
  patronusUntil: number;
  stunnedUntil: number;
  jailedUntil: number;
}

export interface Wizard {
  id: string;
  handle: string;
  token: string;
  name: string;
  house: House;
  wand: Wand;
  year: number;
  xp: number;
  reputation: number;
  termReputation: number;
  galleons: number;
  hp: number;
  mana: number;
  pos: Vec2;
  facing: number;
  input: { dx: number; dz: number };
  goal: Vec2 | null;
  /** Waypoints toward `goal` from the pathfinder (not persisted). */
  route: Vec2[];
  spells: Spell[];
  hotbar: (string | null)[];
  items: Item[];
  equipped: Partial<Record<ItemSlot, string>>;
  achievements: string[];
  titles: string[];
  stats: { stuns: number; stunned: number; creatures: number; casts: number; forged: number };
  st: WizardStatus;
  cooldowns: Record<string, number>;
  globalCd: number;
  decreeCharges: number;
  createdAt: number;
  lastMcpAt: number;
  connections: number;
  marauderUntil: number;
  say: { text: string; until: number } | null;
  eggs: { rorCrossings: number[]; rorSide: number; inErised: boolean };
  lastDuel: Record<string, number>;
  hurtAt: number;
  /** Id of whoever last damaged this wizard. */
  lastHurtBy: string | null;
  /** World time this wizard was last present (persisted). */
  lastSeenAt: number;
  /** HUD corners unlocked by the reveal charm. */
  ui: string[];
  /** Restricted-Section seals broken (0..4), pages collected and recent failed attempts per tier. */
  seals: number;
  sealPages: Record<string, number[]>;
  sealTries: Record<string, number[]>;
  wasMinister: boolean;
  /** Server-driven non-player wizard. */
  npc: boolean;
  auras: Aura[];
  /** Per-wizard cooldown for phoenix tears. */
  tearsAt: number;
}

export interface CreatureDef {
  kind: CreatureKind;
  name: string;
  faction: 'hostile' | 'benign' | 'summon';
  hp: number;
  speed: number;
  damage: number;
  range: number;
  cooldown: number;
  aggro: number;
  radius: number;
  xp: number;
  rep: number;
  galleons: number;
  weak: Partial<Record<Element, number>>;
  allDamage?: number;
  nightOnly?: boolean;
  dayOnly?: boolean;
  flying?: boolean;
  invulnerable?: boolean;
  /** Chance per spawn check (every 2s) that a rare creature appears. */
  rare?: number;
  /** Seconds before a spawned creature leaves on its own. */
  lifetime?: number;
  /** Aura applied to whoever it hits. */
  bite?: { aura: AuraKind; secs: number; mag: number };
  /** Aura granted to wizards standing near it. */
  grace?: { radius: number; mag: number };
  spawn: { x: number; z: number; r: number; max: number };
  lore: string;
}

export interface Creature {
  id: string;
  kind: CreatureKind;
  pos: Vec2;
  home: Vec2;
  hp: number;
  maxHp: number;
  facing: number;
  target: string | null;
  attackCd: number;
  rootedUntil: number;
  wander: Vec2 | null;
  lastHitBy: string | null;
  damageBy: Record<string, number>;
  auras: Aura[];
  /** Conjured creatures: who they serve and when they vanish. */
  owner: string | null;
  until: number;
}

export interface Projectile {
  id: string;
  owner: string;
  kind: 'bolt' | 'disarm' | 'root';
  pos: Vec2;
  vel: Vec2;
  power: number;
  element: Element;
  ttl: number;
  homing: string | null;
  secs: number;
  tags: string[];
}

export interface Pending {
  at: number;
  casterId: string;
  body: Node[];
  env: Env;
  depth: number;
  spellName: string;
  incantation: string;
}

export type EventType = 'system' | 'chat' | 'combat' | 'creature' | 'achievement' | 'decree' | 'term' | 'level' | 'egg' | 'azkaban' | 'elder' | 'forge' | 'cast';

export interface WorldEvent {
  id: number;
  t: number;
  type: EventType;
  text: string;
  /** Private events are delivered only to this wizard id. */
  to?: string;
  who?: string[];
}

export interface Fx {
  k: 'hit' | 'nova' | 'heal' | 'shield' | 'apparate' | 'patronus' | 'fizzle' | 'stun' | 'levelup' | 'willow' | 'cast' | 'azkaban' | 'chain' | 'storm' | 'stormhit' | 'reveal' | 'seal';
  x: number;
  z: number;
  r?: number;
  e?: Element;
  h?: string;
  /** damage dealt, for floating numbers */
  n?: number;
  /** polyline x,z pairs (chain lightning) */
  pts?: number[];
}

export interface Term { n: number; startedAt: number; endsAt: number }

export interface DecreeRecord { at: number; term: number; minister: string; changes: string[]; proclamation: string }
