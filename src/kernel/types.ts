import type { CreatureKind, Element, House, ItemMod, ItemSlot, JinxKind } from '../shared/constants.js';
import type { Node } from '../runes/parser.js';
import type { Env } from '../runes/interp.js';
import type { Aura, AuraKind } from './auras.js';
import type { Glamour } from '../shared/glamour.js';
import type { CupLedger } from './housecup.js';

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
  /** 偷师: a copy made with study_spell records whose spell it was (their public name and handle). */
  origin?: { author: string; handle: string; spell: string; at: number };
  /** 咒语集市: the market listing (and version) this spell was published as, copied from or forked into (kernel/market.ts). */
  market?: { id: string; v: number };
  /** What the last successful cast cost (the hotbar shows it; World.manaOf estimates it before the first cast). */
  lastMana?: number;
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
  /** A hostile parcel (negative enchantments and/or a jinx in its lore, sent to someone else). */
  cursed?: boolean;
  /** Sticky-equipped: cannot be unequipped or destroyed until boundUntil (or Finite Incantatem on yourself). */
  bound?: boolean;
  boundUntil?: number;
  /** The sender is hidden (armory omits forgedBy/forgedByName) until the recipient casts Revelio. */
  anon?: boolean;
  /** The jinx the parcel carried when it arrived (kernel-chosen strength). */
  jinx?: Jinx;
}

export interface Jinx { kind: JinxKind; mag: number; seconds: number }

/** A Colour-Change jinx on a wizard's look: what it lays over theirs, until when, and who cast it (never shown). */
export interface JinxLook { look: Glamour; until: number; src: string }

export interface WizardStatus {
  shield: number; shieldUntil: number;
  hasteMult: number; hasteUntil: number;
  rootedUntil: number;
  disarmedUntil: number;
  lightUntil: number;
  patronusUntil: number;
  stunnedUntil: number;
  jailedUntil: number;
  /** Langlock / Bat-Bogey: cannot cast, speak publicly or use items (≤ SILENCE_MAX_S at a time). */
  silencedUntil: number;
  /** New silences before this are dropped (so there is always a window to cast in). */
  silenceCdUntil: number;
  /** Which jinx the current silence belongs to (a Bat-Bogey's silence is part of that one hex). */
  silenceBy: 'langlock' | 'bats' | null;
  /** Who sent it (World.jinxBites: the silence rests while the PvP rules would not let them harm you). Never shown. */
  silenceSrc?: string | null;
  /** 决斗手感: when the current Protego went up (a bolt landing within PERFECT_PROTEGO_S of it is sent back). */
  shieldAt?: number;
  /** 翻滚闪避: dashing (and untouchable by projectiles and claws) until then; the next dodge from dodgeReadyAt. */
  dodgeUntil?: number;
  dodgeReadyAt?: number;
  dashDx?: number;
  dashDz?: number;
}

/** One message in the private Owl Post between a player and their own agent. */
export interface OwlMsg {
  id: number;
  from: 'player' | 'agent';
  text: string;
  t: number;
  /** An agent's question: the player answers with one of the options before expiresAt. */
  ask?: { options: string[]; expiresAt: number };
  answered?: boolean;
  /** The chosen option, or '(expired)'. */
  answer?: string;
  /** For a player's answer: the id of the question it answers. */
  re?: number;
  /** A player's owl: this many older owls from the player were dropped unread just before it (the owlbox was full). */
  lost?: number;
}

/** What the agent last did (not persisted; `at` is world time). */
export interface AgentSeen { client: string; tool: string; at: number }

/** One MCP call of a wizard's agent, as its owner's activity panel shows it (the arguments are never kept). */
export interface AgentCall { at: number; tool: string; ok: boolean; spell?: string }

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
  stats: { stuns: number; stunned: number; creatures: number; casts: number; forged: number; reflects?: number; dodges?: number;
    /** Spells forged (forge_spell, copies and forks); `forged` counts items. */
    spells?: number };
  st: WizardStatus;
  cooldowns: Record<string, number>;
  globalCd: number;
  decreeCharges: number;
  createdAt: number;
  lastMcpAt: number;
  connections: number;
  marauderUntil: number;
  say: { text: string; until: number } | null;
  /** Easter-egg state. pointsTerm: the term in which this wizard last awarded house points ("Ten points to …!"). */
  eggs: { rorCrossings: number[]; rorSide: number; inErised: boolean; pointsTerm?: number };
  lastDuel: Record<string, number>;
  hurtAt: number;
  /** Id of whoever last damaged this wizard. */
  lastHurtBy: string | null;
  /** World time this wizard was last present (persisted). */
  lastSeenAt: number;
  /** HUD corners unlocked by the reveal charm. */
  ui: string[];
  /** Restricted-Section seals broken (0..4): it lifts the Runes caps (the quest itself: kernel/seals.ts). */
  seals: number;
  wasMinister: boolean;
  /** Server-driven non-player wizard. */
  npc: boolean;
  auras: Aura[];
  /** Per-wizard cooldown for phoenix tears. */
  tearsAt: number;
  /** Hostile parcels sent: recipient id -> world time (pruned on write). */
  hexLog: Record<string, number>;
  /** Hostile parcels received in the last HEX_WINDOW_S (world times). */
  hexWindow: number[];
  /** No hostile parcel is accepted before this (set by Finite Incantatem). */
  respiteUntil: number;
  /** Private Owl Post with this wizard's own agent (persisted, ≤ OWLBOX_MAX). */
  owlbox: OwlMsg[];
  owlSeq: number;
  /** The last player owl id the agent has consumed (listen). */
  agentReadUpTo: number;
  /** The agent's goal note, shown on the player's HUD. */
  agentGoal: string | null;
  /** Transfiguration of self: the look this wizard chose with a glamour spell (null = house colours). Persisted. */
  look: Glamour | null;
  /** Not persisted: someone's Colour-Change jinx (≤ GLAMOUR_PRANK_MAX_S; Finite Incantatem ends it). */
  jinxLook: JinxLook | null;
  /** 学院杯: this term's house-point ledger (kernel/housecup.ts; persisted, reset by a new term). */
  cup?: CupLedger;
  /** 巧克力蛙画片: the cards in this wizard's album (ids from lore/cards.ts; persisted). */
  cards?: string[];
  /** Not persisted: the player paused their agent (MCP actions refused). */
  agentPaused: boolean;
  /** Not persisted: the agent's last MCP call. */
  agentSeen: AgentSeen | null;
  /** Not persisted: the agent's recent MCP calls, newest last (观战: what the agent is doing; World.noteAgentCall). */
  agentLog?: AgentCall[];
  /** Not persisted: who set `goal` (a player's WASD cancels either; pausing the agent cancels the agent's). */
  goalBy?: 'agent' | 'player' | null;
  /** Not persisted: world time the player last steered (WASD, a click walk, reaching its end); PLAYER_GRACE_S. */
  steerAt?: number;
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
  /**
   * A shot it fires at a target beyond its melee range: a real projectile (seen, and dodged by moving), aimed where
   * the target stands. `provoked`: only at someone who hurt it in the last PROVOKED_SECS (a snare does not snipe
   * passers-by). `root` shots hold instead of hurting (a web).
   */
  ranged?: { range: number; power: number; cooldown: number; element: Element; kind: 'bolt' | 'root'; secs?: number; provoked?: boolean };
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
  /** 校园事件轮盘: the event instance (kernel/wheel.ts) that brought it, and its damage multiplier (the boosted troll). */
  ev?: number;
  dmgMult?: number;
  /** Hurt by its target until then: it chases (and shoots) further than its aggro range. */
  provokedUntil?: number;
  rangedCd?: number;
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

export type EventType = 'system' | 'chat' | 'combat' | 'creature' | 'achievement' | 'decree' | 'term' | 'level' | 'egg' | 'azkaban' | 'elder' | 'forge' | 'cast'
  | 'owl' | 'ask' | 'curse' | 'dark' | 'da' | 'market' | 'wheel' | 'card' | 'duel' | 'quidditch';

export interface WorldEvent {
  id: number;
  t: number;
  type: EventType;
  text: string;
  /** 简体中文 */
  zh?: string;
  /** Private events are delivered only to this wizard id. */
  to?: string;
  /** Server-internal: registry ids of the wizards involved. Never put on the wire (World.wireEvent). */
  who?: string[];
  /** Owl Post: who wrote it — the player or their agent. */
  from?: 'player' | 'agent';
  /** Owl Post: the owlbox message this event carries (id), its options if it is a question, and what it answers. */
  owl?: { id: number; options?: string[]; expiresAt?: number; re?: number };
  /** 巧克力蛙画片: the card this private event hands over (the browser flips it over). */
  card?: string;
  /** Chat (kernel/chat.ts): the channel of a chat line. */
  ch?: 'all' | 'house' | 'near' | 'dm';
  /** Server-internal: delivered only to these wizard ids (a house, those near, a whisper's two ends). Never on the wire. */
  aud?: string[];
}

/** A WorldEvent as it may be sent to a browser: no `who`, no `aud`. */
export type WireEvent = Omit<WorldEvent, 'who' | 'aud'>;

/** May `wid` see this event? Public, or addressed to them (`to`), or they are in its audience (`aud`). */
export const visibleTo = (e: WorldEvent, wid: string) => (e.to ? e.to === wid : e.aud ? e.aud.includes(wid) : true);

export interface Fx {
  k: 'hit' | 'nova' | 'heal' | 'shield' | 'apparate' | 'patronus' | 'fizzle' | 'stun' | 'levelup' | 'willow' | 'cast' | 'azkaban' | 'chain' | 'storm' | 'stormhit' | 'reveal' | 'seal' | 'dodge' | 'reflect' | 'clash';
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

export interface DecreeRecord { at: number; term: number; minister: string; changes: string[]; proclamation: string; vetoed?: boolean }
