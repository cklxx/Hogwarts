import { randomBytes } from 'node:crypto';
import {
  AGENT_SEEN_ROUND_S, ASK_TTL_S, CREATURE_KINDS, CURSED_ITEM_BIND_S, HEX_MIN_YEAR, HEX_PAIR_COOLDOWN_S, HEX_RESPITE_S, HEX_WINDOW_S, HOUSES,
  ITEM_SLOTS, JINX_DEFAULTS, OWLBOX_MAX, OWL_MAX_CHARS, OWL_PER_MIN, PAIR_FAIL_PER_IP_PER_MIN, PAIR_FAIL_PER_REALM_PER_MIN, PAIR_TTL_S, PLAYER_GRACE_S, NEWCOMER_WARD, NEWCOMER_WARD_S,
  SILENCE_COOLDOWN_S, SILENCE_MAX_S,
  DA_JOINT_MIN, DA_JOINT_PCT, DA_JOINT_WINDOW_S, DA_MAX_MEMBERS, DA_QUORUM, DA_REP_CEILING, DA_VETO_WINDOW_S, DA_VETOES_PER_TERM, DARK_LORD_BROADCAST_S, DARK_LORD_MIN_REP,
  DARK_LORD_POWER_PCT, DARK_LORD_SEEN_S, LAWLESS_MULT, STUDIED_KEEP, STUDY_DELAY_S, STUDY_KEEP, STUDY_MEMORY_S,
  UI_CHARMS, VICTIM_BOUND_CAP, VICTIM_CURSED_ITEMS_MAX, VICTIM_HEX_CAP, VICTIM_HEX_PER_10MIN,
  type CreatureKind, type SummonKind, type Element, type House, type ItemMod, type ItemSlot, type UiCharm,
} from '../shared/constants.js';
import { AZKABAN, LANDMARKS, LAWLESS_ZONE, SPAWN, WORLD_HALF, ZONES, mulberry32, type ZoneId } from '../shared/map.js';
import { canonFor, ollivander } from '../lore/wands.js';
import { zhCreature, zhHouse, zhPlace, zhSpell } from '../shared/zh.js';
import { CURRICULUM, isLeviosa, isLeviosar, unforgivable } from '../lore/spells.js';
import { analyze } from '../runes/checker.js';
import type { Node } from '../runes/parser.js';
import { CREATURES } from './creatures.js';
import { AURA_DEFS, type AuraKind, addAura, auraMag, hasAura, isDebuff, live, withoutDebuffs } from './auras.js';
import { BOUND_REFUSAL, CURSE_BLESS, FORGE_REFUSAL, HEX_FRESH_SENDER, HEX_YEAR, JINX_NAMES, SILENCED, danceJitter, parseJinx } from './hex.js';
import { PAIR_REFUSAL, PAIR_THROTTLED, formatPairCode, parsePairCode, randomPairBody, realmOfPrefix } from './identity.js';
import { SEAL_REWARDS, SEAL_REWARDS_ZH, SEAL_TIERS, CODEX, disassemble, generateSeal, parseWord, runSeal, type Seal } from './seals.js';
import { TITLES, titleIndex } from '../lore/titles.js';
import {
  AFK_BUBBLES, CREATURE_STUN, Cooldowns, DOBBY_SOCK, ERROL, FIZZLE_QUIPS, FORGE_NAME_EGGS, GRIND_LINES, GRINGOTTS, HAGRID_HINTS, LEGACY_CODE,
  LEVEL_QUIPS, MALFOY_LINES, MEME, PLACE_LINES, POINTS, REPLIES, SEAMUS_LINES, SHIELD_BREAK, SORTING_SONG, STUN_BY_ELEMENT, STUN_QUIPS,
  TABOO_DEMENTOR, TITLE_QUIPS, TREVOR, VERSAILLES_LINES, YER_A_WIZARD, chance, chatTriggers, fill, fizzleKind, hash32, houseLine, isHelloWorld, pick,
  pointsAward, type Line,
} from '../lore/memes.js';
import { type CastReport, execute } from './magic.js';
import type { OwlBook } from './exams.js';
import { OWL_ACHIEVEMENTS } from '../lore/exams.js';
import { lookOf } from './glamour.js';
import { cleanGlamour, glamourKey, type Glamour } from '../shared/glamour.js';
import { dist, resolve, solidAt } from './physics.js';
import { findPath } from './pathfind.js';
import { thinkNpcs } from './npc.js';
import { EntityMap } from './spatial.js';
import { ZONE_BIT, maskOf, zoneIdsAt, zoneMask } from './zones.js';
import {
  MAX_ITEMS, derived, gasLimit, hexDotHp, hexPrice, hexTickDmg, moveSlow, itemBudget, itemPoints, itemPrice, maxNodes, spellbookSize, yearForXp, XP_FOR_YEAR,
  darkLordTakes, duelSteal, focusAfter, jointPct, stealPct, vetoPasses,
} from './progression.js';
import {
  AGENT_TOOL_COST, DA_JOINED, DA_JOINT, DA_LEFT, DA_MEMBER_JOINED, DA_OUTGROWN, DA_VETOED, DA_VOTE, DARK_LORD_FADES, DARK_LORD_FALLS, DARK_LORD_RISES,
  DARK_LORD_YOU, DARK_MARK_SEEN, LAWLESS_ENTER, LAWLESS_LEAVE, STUDIED_YOU, STUDY_READY, STUDY_WAIT, tiredText,
} from './unfair.js';
import { type Law, type Rulebook, applyPatch, defaultRulebook } from './rulebook.js';
import type {
  Creature, CreatureDef, DecreeRecord, EventType, Fx, Item, Jinx, OwlMsg, Pending, Projectile, Spell, Term, Vec2, WireEvent, Wizard, WorldEvent,
} from './types.js';

export { FORGE_REFUSAL, SILENCED, BOUND_REFUSAL, CURSE_BLESS } from './hex.js';
export { PAIR_REFUSAL, PAIR_THROTTLED, parsePairCode } from './identity.js';

/**
 * MCP tools an agent may still call while its player has paused it: exactly the nine of
 * docs/AGENT_LINK.md §C.1, which only read or only talk to the player. Everything else is refused —
 * rotate_key, and the identity tools that would rebind the session (enroll, login, pair), included.
 */
export const AGENT_PAUSE_ALLOWED: ReadonlySet<string> = new Set([
  'look', 'whoami', 'events', 'armory', 'grimoire', 'leaderboard', 'listen', 'tell_player', 'set_goal_note',
]);
/** Refusal for an agent whose player paused it (docs/AGENT_LINK.md §C.1). */
export const AGENT_PAUSED = `Your human has paused you. Until they resume you may only look and talk to them: ${[...AGENT_PAUSE_ALLOWED].join(', ')}.`;
/** Refusal for an agent's move_to while its player is steering (or just steered, or is walking where they clicked). */
export const PLAYER_STEERING = 'Your human is steering right now; their hands on the controls come first.';
/** Refusal for an agent's owl when the owlbox is full of its player's owls it has not read yet. */
export const OWLBOX_UNREAD = 'Your owlbox is full of owls from your human that you have not read. Call listen first.';

export const TICK = 0.05;
const ONLINE_GRACE = 300;
/** Tarantallegra: the legs pick a new wrong direction every DANCE_STEP_S, up to DANCE_MAX_RAD off course. */
const DANCE_STEP_S = 0.4;
const DANCE_MAX_RAD = 0.6;
/** Stunning a wizard enrolled less than this long ago earns no reputation (stops throwaway-alt farming). */
export const FRESH_SECONDS = 600;
/** Curriculum reveal charms and the HUD corner each one unlocks (a slot can be reused once it is). */
const REVEAL_CHARM: Record<string, string> = { Tempus: 'tempus', Revelio: 'revelio', 'Point Me': 'point-me', 'Homenum Revelio': 'homenum' };
const TOMB = { x: -52, z: 28 };
const WILLOW = { x: 45, z: 0 };
/** placeName's order: the most specific zone wins. */
const PLACE_ORDER: ZoneId[] = ['azkaban', 'erised', 'great_hall', 'seventh_floor', 'tomb', 'willow', 'dungeons', 'greenhouses', 'courtyard', 'pitch', 'hogsmeade', 'deep_forest', 'forest', 'lake_shore', 'grounds'];

export const ACHIEVEMENTS: Record<string, { name: string; zh: string; rep: number; text: string; textZh: string }> = {
  weasley_loophole: { name: 'The Weasley Loophole', zh: '韦斯莱漏洞', rep: 50, text: 'You noticed the Ministry forge never checks whose name is on the parcel. Fred and George would be proud. (Yes, it is a bug. Yes, we left it in on purpose.)', textZh: '你发现魔法部的锻造炉从不核对包裹上写的是谁。弗雷德和乔治会为你骄傲的。（是的，这是个 bug。是的，我们故意留着它。）' },
  marauder: { name: 'Moony, Wormtail, Padfoot and Prongs', zh: '月亮脸、虫尾巴、大脚板和尖头叉子', rep: 10, text: 'Messrs. Moony, Wormtail, Padfoot and Prongs are proud to present: everyone\'s true registry numbers.', textZh: '月亮脸、虫尾巴、大脚板和尖头叉子先生荣幸地献上：每个人真正的登记号。' },
  azkaban: { name: 'Guest of the Dementors', zh: '摄魂怪的客人', rep: 0, text: 'You used an Unforgivable Curse. The Ministry has a room for you.', textZh: '你用了不可饶恕咒。魔法部给你准备了一间屋子。' },
  room_of_requirement: { name: 'The Come-and-Go Room', zh: '来去屋', rep: 25, text: 'You walked past three times, thinking hard. The Room gave you what was hidden there.', textZh: '你专心想着走过了三次。这间屋子把藏在里面的东西给了你。' },
  erised: { name: 'Erised', zh: '厄里斯', rep: 5, text: 'It does not do to dwell on dreams and forget to live.', textZh: '沉湎于虚幻的梦想而忘记现实的生活，这是毫无益处的。' },
  knot: { name: 'Pressed the Knot', zh: '按住树结', rep: 5, text: 'You froze the Whomping Willow. Crookshanks did it with a paw.', textZh: '你让打人柳僵住了。克鲁克山只用了一只爪子。' },
  leviosa: { name: "It's Levi-O-sa", zh: '是羽加迪姆勒维奥萨', rep: 10, text: 'You knocked out a troll the way Ron did in 1991.', textZh: '你像 1991 年的罗恩一样打晕了一只巨怪。羽加迪姆勒维奥萨，yyds。' },
  elder_wand: { name: 'Master of the Elder Wand', zh: '老魔杖的主人', rep: 20, text: 'The wand chooses the wizard — and it chose whoever beat its last master.', textZh: '是魔杖选择巫师 —— 它选择了击败它上一任主人的人。' },
  seeker: { name: 'Seeker', zh: '找球手', rep: 10, text: 'Accio Firebolt! Fastest broom in the world.', textZh: '火弩箭飞来！世界上最快的扫帚。' },
  first_blood: { name: 'Duellist', zh: '决斗者', rep: 0, text: 'You stunned another wizard. Bow first next time.', textZh: '你击晕了另一个巫师。下次记得先鞠躬。' },
  // Granted privately (achievePrivately): a public announcement in the same tick would unmask the anonymous sender.
  dark_arts: { name: 'The Dark Arts', zh: '黑魔法', rep: 0, text: 'You posted a curse. The forge asked no questions. Nobody saw you do it — this time.', textZh: '你寄出了一个诅咒。锻造炉什么也没问。这一次，没有人看见。' },
  hello_world: { name: 'Hello, World', zh: '你好，世界', rep: 1, text: 'Your spell said hello to the world. Every great wizard starts here — even Hermione had a first program.', textZh: '你的咒语向世界问了好。每个伟大的巫师都从这里开始——赫敏也写过她的第一个程序。' },
  trevor: { name: 'Has Anyone Seen a Toad?', zh: '有人看见一只蟾蜍吗？', rep: 5, text: 'You found Trevor by the Black Lake. Neville owes you one.', textZh: '你在黑湖边找到了特雷弗。纳威欠你一个人情。' },
  // O.W.L. exams (kernel/exams.ts)
  ...OWL_ACHIEVEMENTS,
};

export interface Statue { name: string; house: House; term: number; inscription: string }

/** The Minister's last decree while the DA may still veto it: the rulebook before it, and the DA members who voted. */
export interface VetoWindow { term: number; at: number; minister: string; ministerId: string; before: Rulebook; votes: string[]; statue: boolean; decree: number }

export interface EntityView { id: string; name: string; pos: Vec2; hp: number; maxHp: number; kind: 'wizard' | 'creature' }

export interface WorldOptions {
  seed?: number; rules?: Rulebook; secret?: string;
  /** Realm prefix for minted tokens ("r2."); also puts the realm on pairing codes ("2-ABC-DEF"). Same as setting `tokenPrefix`. */
  tokenPrefix?: string;
}

export class World {
  rules: Rulebook;
  now = 0;
  /** Maps that keep a spatial index of their members (see spatial.ts); used exactly like a Map. */
  wizards = new EntityMap<Wizard>();
  creatures = new EntityMap<Creature>();
  /** Prefix for newly minted tokens (set by a realm worker so a front door can route by token). */
  tokenPrefix = '';
  /** Cross-check every spatial query against a full scan (tests / HOGWARTS_VERIFY_SPATIAL=1). Slow. */
  static verifySpatial = process.env.HOGWARTS_VERIFY_SPATIAL === '1';
  private inTick = false;
  projectiles = new Map<string, Projectile>();
  pending: Pending[] = [];
  events: WorldEvent[] = [];
  term: Term;
  houseCups: { term: number; winner: House | null; points: Record<House, number> }[] = [];
  decrees: DecreeRecord[] = [];
  /** O.W.L. exams (kernel/exams.ts): leaderboards and each wizard's weekly bests. Persisted. */
  owls: OwlBook = { boards: {}, bests: {} };
  flags = {
    statues: [] as Statue[], loopholeFoundBy: null as string | null, elderWandHolder: null as string | null, willowCalmUntil: 0, ministerId: null as string | null, handleSeq: 0,
    /** Name of the first wizard to post a curse (never shown publicly). */
    curseFoundBy: null as string | null,
    /** House points awarded by wizards themselves this term ("Ten points to Ravenclaw!"): added to the House Cup. */
    housePoints: { term: 0, pts: {} } as { term: number; pts: Partial<Record<House, number>> },
    /** 黑魔王: who holds the Dark Mark (reputation #1 with hysteresis) and since when. */
    darkLordId: null as string | null, darkLordSince: 0,
    /** 邓布利多军: its members (registry ids, never shown to anyone but members). */
    da: { members: [] as string[] },
    /** The term in which the DA last used its veto (DA_VETOES_PER_TERM = 1), and the decree it may still veto. */
    vetoTerm: 0,
    veto: null as VetoWindow | null,
  };
  /** token -> wizard id: byToken is O(1); rebuilt by restore(), maintained by enroll() and rotateToken(). */
  private tokenIndex = new Map<string, string>();
  /** Live pairing codes by body (not persisted: a restart kills them), and each wizard's one live code. */
  private pairCodes = new Map<string, { wizardId: string; expiresAt: number }>();
  private pairByWizard = new Map<string, string>();
  /** World times of failed pairing attempts in the last minute (this world is one realm), and per source (IP). */
  private pairFails: number[] = [];
  private pairFailsBy = new Map<string, number[]>();
  /** Owl rate limit: `${wid}|${from}` -> world times of owls in the last minute (not persisted). */
  private owlTimes = new Map<string, number[]>();
  /** Wizards the 1 Hz sweep must visit: bound cursed items / recent hostile parcels, and open questions. */
  private hexed = new Set<string>();
  private openAsks = new Set<string>();
  private sweepCd = 1;
  private fxQueue: Fx[] = [];
  private listeners = new Set<(e: WorldEvent) => void>();
  private eventSeq = 0;
  private seq = 0;
  private rng: () => number;
  private spawnCd = 0;
  private willowCd = 0;
  private pulseCd = 10;
  private lawDepth = 0;
  /** Server secret that seeds every seal. Never leaves the server (it is in the save file, so keep that private). */
  secret: string;
  private storms: { at: number; x: number; z: number; r: number; power: number; element: Element; owner: string; tags: string[] }[] = [];
  private sealCache = new Map<string, Seal>();
  /** Flavour rate limits (lore/memes.ts MEME) and per-wizard meme bookkeeping. Neither is persisted. */
  private memeCd = new Cooldowns();
  private memeOf = new Map<string, { place: string | null; x: number; z: number; casts: number; still: number; kills: number[]; hagrid: number }>();
  /** Not persisted: 黑魔王 broadcast clock; wizards standing in the lawless zone; DA hits per target; agent concentration. */
  private darkCd = 0;
  private lawlessIn = new Set<string>();
  private jointHits = new Map<string, Map<string, number>>();
  private focus = new Map<string, { pts: number; at: number }>();

  constructor(opts: WorldOptions = {}) {
    this.rng = mulberry32(opts.seed ?? (Date.now() & 0xffffffff));
    this.rules = opts.rules ?? defaultRulebook();
    this.secret = opts.secret ?? process.env.HOGWARTS_SECRET ?? randomBytes(32).toString('hex');
    this.term = { n: 1, startedAt: 0, endsAt: this.rules.terms.lengthSeconds };
    if (opts.tokenPrefix) this.tokenPrefix = opts.tokenPrefix;
  }

  // ------------------------------------------------------------------ basics
  rand() { return this.rng(); }

  // ------------------------------------------------------------------ memes (lore/memes.ts)
  /**
   * Flavour rate limits (MEME): true, with every gate marked, only when all the named gates are ready. Keys are
   * free-form: 'public' (the shared feed), 'npc' (NPC chatter), 'stun', `t:<trigger>:<wid>`, …
   */
  banter(...gates: [key: string, secs: number][]) { return this.memeCd.take(this.now, ...gates); }
  /** A line from a pool, chosen from world state (event counter, clock, extra seeds): deterministic, never an RNG draw. */
  quip<T>(pool: readonly T[], ...seed: (string | number)[]): T { return pick(pool, this.eventSeq, Math.round(this.now * 20), ...seed); }
  private memo(w: Wizard) {
    let m = this.memeOf.get(w.id);
    if (!m) { m = { place: null, x: w.pos.x, z: w.pos.z, casts: w.stats.casts, still: this.now, kills: [], hagrid: 0 }; this.memeOf.set(w.id, m); }
    return m;
  }
  /** A private flavour line to one wizard ('system' shows in the feed; 'egg' also raises the banner). */
  private tell(w: Wizard, l: Line, type: EventType = 'system') { this.emit(type, l.en, { to: w.id, zh: l.zh }); }
  /** A speech bubble over a wizard's head, without a feed line (never over their own chat). */
  private bubble(w: Wizard, l: Line, secs = 4) { if (!w.say || w.say.until < this.now) w.say = { text: l.zh, until: this.now + secs }; }
  private nid(prefix: string) { return `${prefix}${(++this.seq).toString(36)}${Math.floor(this.rng() * 1296).toString(36)}`; }
  onEvent(fn: (e: WorldEvent) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  emit(type: EventType, text: string, opts: { to?: string; who?: string[]; zh?: string; from?: WorldEvent['from']; owl?: WorldEvent['owl'] } = {}) {
    const e: WorldEvent = { id: ++this.eventSeq, t: round(this.now), type, text, ...opts };
    this.events.push(e);
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
    for (const l of this.listeners) l(e);
    return e;
  }

  /**
   * An event as it may go to a browser: everything but `who` (the registry ids of the wizards involved,
   * which would hand every player everyone's registry number). Send `wireEvent(e)`, never `e`.
   */
  wireEvent(e: WorldEvent): WireEvent {
    const { who: _who, ...rest } = e;
    return rest;
  }

  /**
   * The events an agent playing `wid` should see (and be woken by) after event id `sinceId`: public
   * events except its own public chat, and private events to it — except owls its agent wrote itself
   * (`from === 'agent'`), so an agent's own tell_player never wakes it. MCP `wait`/`events` use this.
   */
  inboxFor(wid: string, sinceId = 0): WorldEvent[] {
    const out: WorldEvent[] = [];
    for (const e of this.events) {
      if (e.id <= sinceId) continue;
      if (e.to && e.to !== wid) continue;
      if (e.from === 'agent') continue;
      if (e.type === 'chat' && e.who?.[0] === wid) continue;
      out.push(e);
    }
    return out;
  }
  fx(f: Fx) { this.fxQueue.push(f); }
  drainFx() { const f = this.fxQueue; this.fxQueue = []; return f; }

  hour() {
    if (this.rules.world.eternalNight) return 0;
    return ((this.now / this.rules.world.dayLengthSeconds) * 24 + 8) % 24;
  }
  isNight() { const h = this.hour(); return this.rules.world.eternalNight || h < 6 || h >= 20; }
  // Zones are rasterised once (zones.ts); answers are identical to testing every zone with inZone.
  zoneIds(p: Vec2): ZoneId[] { return zoneIdsAt(p.x, p.z); }
  private within(p: Vec2, id: ZoneId) { return zoneMask(p.x, p.z, ZONE_BIT[id]) !== 0; }
  /** Safe zones are policy (rules.combat.safeZones), so the mask is derived from the live rulebook on every call. */
  inSafe(p: Vec2) { const m = maskOf(this.rules.combat.safeZones); return m !== 0 && zoneMask(p.x, p.z, m) !== 0; }
  onGrounds(p: Vec2) { return zoneMask(p.x, p.z, ZONE_BIT.grounds | ZONE_BIT.hogsmeade) === ZONE_BIT.grounds; }
  /** The most specific zone at p (the one placeName names), or null in the Highlands. */
  placeId(p: Vec2): ZoneId | null {
    const zs = this.zoneIds(p);
    return PLACE_ORDER.find((z) => zs.includes(z)) ?? null;
  }
  placeName(p: Vec2) {
    const id = this.placeId(p);
    return id ? ZONES.find((z) => z.id === id)!.name : 'The Highlands';
  }

  // ------------------------------------------------------------------ presence
  online(w: Wizard) { return w.connections > 0 || this.now - w.lastMcpAt < ONLINE_GRACE; }
  isActive(w: Wizard) { return this.online(w) && w.st.stunnedUntil === 0 && w.st.jailedUntil === 0; }
  touch(id: string) { const w = this.wizards.get(id); if (w) w.lastMcpAt = this.now; }
  /** O(1): the index is checked against the wizard, so a stale entry can never log anyone in. */
  byToken(token: string) {
    if (typeof token !== 'string' || !token) return undefined;
    const id = this.tokenIndex.get(token);
    const w = id ? this.wizards.get(id) : undefined;
    return w && w.token === token ? w : undefined;
  }

  // ------------------------------------------------------------------ Owl Post keys & pairing codes (§A.2/A.3)
  private mintToken() {
    let t: string;
    do t = this.tokenPrefix + randomBytes(18).toString('base64url'); while (this.tokenIndex.has(t));
    return t;
  }

  /**
   * Replace a wizard's key: the old one stops working at once, and a pairing code minted under it dies
   * with it. Returns the new token (the caller hands it only to the wizard's own sockets/session).
   */
  rotateToken(wid: string): string {
    const w = this.need(wid);
    this.tokenIndex.delete(w.token);
    w.token = this.mintToken();
    this.tokenIndex.set(w.token, w.id);
    this.dropPairCode(w.id);
    this.emit('system', '🔑 Your Owl Post key was changed. The old key no longer works anywhere.', { to: w.id, zh: '🔑 你的猫头鹰邮递密钥已更换，旧密钥立即失效。' });
    return w.token;
  }

  /** This world's realm number (from tokenPrefix "rK."), or null for a single world. */
  get realmId(): number | null { return realmOfPrefix(this.tokenPrefix); }

  /**
   * A fresh pairing code for a wizard: 6 characters, single use, PAIR_TTL_S seconds, and the only live
   * one for that wizard (minting again kills the previous code). Shown as ABC-DEF (2-ABC-DEF in realm 2).
   */
  mintPairCode(wid: string): { code: string; expiresAt: number; expiresIn: number } {
    const w = this.need(wid);
    if (w.npc) throw new Error('NPCs do not pair with agents.');
    this.dropPairCode(w.id);
    let body: string;
    do body = randomPairBody(); while (this.pairCodes.has(body));
    const expiresAt = this.now + PAIR_TTL_S;
    this.pairCodes.set(body, { wizardId: w.id, expiresAt });
    this.pairByWizard.set(w.id, body);
    return { code: formatPairCode(body, this.realmId), expiresAt, expiresIn: PAIR_TTL_S };
  }

  /** The wizard's live pairing code, if any (for a browser that reconnects). */
  pairCodeOf(wid: string): { code: string; expiresAt: number; expiresIn: number } | null {
    const body = this.pairByWizard.get(wid);
    const c = body ? this.pairCodes.get(body) : undefined;
    if (!body || !c || this.now >= c.expiresAt) return null;
    return { code: formatPairCode(body, this.realmId), expiresAt: c.expiresAt, expiresIn: Math.ceil(c.expiresAt - this.now) };
  }

  /**
   * Redeem a pairing code (normalised: case, spaces and dashes do not matter). Single use; expired,
   * used, unknown, malformed and wrong-realm codes all get the same refusal (PAIR_REFUSAL) and count as a
   * failure. `source` is who is trying (the server passes the client IP): a source with
   * PAIR_FAIL_PER_IP_PER_MIN failures in the last minute is refused (PAIR_THROTTLED) *without* spending the
   * realm's budget, so wrong codes from one address cannot lock everyone else out. After
   * PAIR_FAIL_PER_REALM_PER_MIN failures in a minute every attempt is refused (PAIR_THROTTLED), the right
   * code included: that is what keeps guessing bounded (formal/tla/Pairing.tla GuessesBounded), and with
   * sources it takes at least 3 of them to lock a realm (RealmLockNeedsSources). Returns the wizard to
   * bind the session to.
   */
  redeemPairCode(raw: string, source?: string): Wizard {
    const recent = (xs: number[] | undefined) => (xs ?? []).filter((t) => this.now - t < 60);
    this.pairFails = recent(this.pairFails);
    const key = typeof source === 'string' && source ? source.slice(0, 64) : null;
    const mine = key ? recent(this.pairFailsBy.get(key)) : [];
    if (key && mine.length >= PAIR_FAIL_PER_IP_PER_MIN) throw new Error(PAIR_THROTTLED);
    if (this.pairFails.length >= PAIR_FAIL_PER_REALM_PER_MIN) throw new Error(PAIR_THROTTLED);
    const p = parsePairCode(raw);
    const c = p && (p.realm === null || p.realm === this.realmId) ? this.pairCodes.get(p.body) : undefined;
    const w = c && this.now < c.expiresAt ? this.wizards.get(c.wizardId) : undefined;
    if (!p || !c || !w) {
      this.pairFails.push(this.now);
      if (key) { mine.push(this.now); this.pairFailsBy.set(key, mine); }
      throw new Error(PAIR_REFUSAL);
    }
    this.dropPairCode(w.id);
    this.emit('system', '🦉 An agent used your pairing code and is now connected to your wizard.', { to: w.id, zh: '🦉 一个 Agent 用配对码连上了你的巫师。' });
    return w;
  }

  private dropPairCode(wid: string) {
    const body = this.pairByWizard.get(wid);
    if (body) this.pairCodes.delete(body);
    this.pairByWizard.delete(wid);
  }

  entity(id: string): EntityView | undefined {
    const w = this.wizards.get(id);
    if (w) return { id, name: w.name, pos: w.pos, hp: w.hp, maxHp: derived(w, this.rules).maxHp, kind: 'wizard' };
    const c = this.creatures.get(id);
    if (c) return { id, name: CREATURES[c.kind].name, pos: c.pos, hp: c.hp, maxHp: c.maxHp, kind: 'creature' };
    return undefined;
  }

  /**
   * Accepts a public handle, exact name, creature id — and a raw registry id only if it is the asker's
   * own (or the asker is an NPC, whose brain is kernel code). Anyone else's `wz_…` resolves to nothing,
   * exactly like an unknown string, so casting at registry ids cannot probe which ones exist.
   */
  resolveTarget(key: string | null | undefined, asker?: string): string | null {
    if (!key) return null;
    if (this.creatures.has(key)) return key;
    if (this.wizards.has(key)) return key === asker || (asker !== undefined && this.wizards.get(asker)?.npc) ? key : null;
    const k = key.toLowerCase();
    for (const w of this.wizards.values()) if (w.handle === key || w.name.toLowerCase() === k) return w.id;
    return null;
  }

  // ------------------------------------------------------------------ spatial queries
  // wizards/creatures are EntityMaps: a grid index kept in step with membership. Positions are re-filed
  // wherever the kernel moves something (moved()), in bulk at the start of every tick, and before any
  // query made from outside a tick (tests, MCP and WebSocket syscalls may have moved things directly).
  private syncIndex() { this.wizards.grid.syncAll(); this.creatures.grid.syncAll(); }
  private moved(e: Wizard | Creature) {
    if ('house' in e) this.wizards.grid.update(e);
    else this.creatures.grid.update(e);
  }
  /** Wizards that may be within r of p, in Map order: a superset — callers keep their exact distance test. */
  nearWizards(p: Vec2, r: number): Iterable<Wizard> {
    if (!this.inTick) this.syncIndex();
    return this.wizards.grid.near(p.x, p.z, r) ?? this.wizards.values();
  }
  /** Creatures that may be within r of p, in Map order (superset, as nearWizards). */
  nearCreatures(p: Vec2, r: number): Iterable<Creature> {
    if (!this.inTick) this.syncIndex();
    return this.creatures.grid.near(p.x, p.z, r) ?? this.creatures.values();
  }

  around(p: Vec2, radius: number, filter: (e: EntityView) => boolean, exclude?: string, limit = 8): EntityView[] {
    const r = Math.min(40, Math.max(0, radius));
    const out: EntityView[] = [];
    for (const w of this.nearWizards(p, r)) {
      if (w.id === exclude || !this.isActive(w) || dist(w.pos, p) > r) continue;
      const v = this.entity(w.id)!;
      if (filter(v)) out.push(v);
    }
    for (const c of this.nearCreatures(p, r)) {
      if (c.id === exclude || c.hp <= 0 || dist(c.pos, p) > r) continue;
      const v = this.entity(c.id)!;
      if (filter(v)) out.push(v);
    }
    const res = out.sort((a, b) => dist(a.pos, p) - dist(b.pos, p)).slice(0, limit);
    if (World.verifySpatial) this.verifyAround(res, p, radius, filter, exclude, limit);
    return res;
  }

  /** The original full-scan `around`, kept as the reference the spatial index is checked against. */
  aroundByScan(p: Vec2, radius: number, filter: (e: EntityView) => boolean, exclude?: string, limit = 8): EntityView[] {
    const r = Math.min(40, Math.max(0, radius));
    const out: EntityView[] = [];
    for (const w of this.wizards.values()) {
      if (w.id === exclude || !this.isActive(w) || dist(w.pos, p) > r) continue;
      const v = this.entity(w.id)!;
      if (filter(v)) out.push(v);
    }
    for (const c of this.creatures.values()) {
      if (c.id === exclude || c.hp <= 0 || dist(c.pos, p) > r) continue;
      const v = this.entity(c.id)!;
      if (filter(v)) out.push(v);
    }
    return out.sort((a, b) => dist(a.pos, p) - dist(b.pos, p)).slice(0, limit);
  }

  private verifyAround(got: EntityView[], p: Vec2, radius: number, filter: (e: EntityView) => boolean, exclude: string | undefined, limit: number) {
    const want = this.aroundByScan(p, radius, filter, exclude, limit);
    const a = got.map((e) => e.id).join(), b = want.map((e) => e.id).join();
    if (a !== b) throw new Error(`spatial index diverged at (${p.x}, ${p.z}) r=${radius}: [${a}] != [${b}]`);
    const bad = this.wizards.grid.check() ?? this.creatures.grid.check();
    if (bad) throw new Error(`spatial index inconsistent: ${bad}`);
  }

  /**
   * The single definition of hostility (modelled in formal/tla/Hostility.tla).
   *  - nobody harms themselves, the stunned, the offline, the invulnerable, or anyone in a safe zone
   *  - a summon harms exactly what its owner may harm, never its owner or the owner's other summons
   *  - wild hostile creatures fight wizards and summons; benign creatures fight no one
   *  - harming someone's summon counts as attacking them (same PvP/house rules)
   * (Allocation-free: reads the maps directly instead of building an EntityView; same decisions.)
   */
  canHarm(srcId: string | null, dstId: string): boolean {
    if (srcId === dstId) return false;
    const dw = this.wizards.get(dstId);
    const dc = this.creatures.get(dstId);
    const dst = dw ?? dc; // entity(): a wizard view takes precedence
    if (!dst || dst.hp <= 0) return false;
    if (dw && !this.isActive(dw)) return false;
    if (dc && CREATURES[dc.kind].invulnerable) return false;
    if (this.inSafe(dst.pos)) return false;
    if (!srcId) return true;
    const sc = this.creatures.get(srcId);
    if (sc?.owner) {
      if (dstId === sc.owner || dc?.owner === sc.owner) return false;
      return this.canHarm(sc.owner, dstId);
    }
    if (sc) {
      if (CREATURES[sc.kind].faction !== 'hostile') return false;
      return dc ? !!dc.owner : true;
    }
    const sw = this.wizards.get(srcId);
    if (sw && this.inSafe(sw.pos)) return false;
    if (dc?.owner) {
      if (dc.owner === srcId) return false;
      const ow = this.wizards.get(dc.owner);
      return sw && ow ? this.pvp(sw, ow) : true;
    }
    if (sw && dw) return this.pvp(sw, dw);
    return true;
  }
  private pvp(a: Wizard, b: Wizard) { return this.rules.combat.pvp && (a.house !== b.house || this.rules.combat.friendlyFire); }

  /** The PvP rules let `src` harm wizard `w` (PvP on; a housemate only with friendly fire). Where src stands plays no part. */
  rulesLetHarm(src: string | null, w: Wizard): boolean {
    const sw = src ? this.wizards.get(src) : undefined;
    if (!sw) return true; // a jinx with no wizard behind it (the world's own)
    return sw !== w && this.pvp(sw, w);
  }

  /**
   * Whether a parcel jinx from `src` acts on `dstId` right now (docs/AGENT_LINK.md §B.3): the victim is in
   * play and outside a safe zone — canHarm(null, victim) — and the PvP rules let the sender harm them.
   * Unlike canHarm(src, victim) it ignores where the sender is, so a jinx pausing never tells its victim
   * that the sender just walked into the Great Hall. Every jinx effect (damage, Jelly-Legs, Tarantallegra,
   * the silence) asks this; canHarm(src, victim) implies it (test/formal.test.ts).
   */
  jinxBites(src: string | null, dstId: string): boolean {
    if (!this.canHarm(null, dstId)) return false;
    const dw = this.wizards.get(dstId);
    return !dw || this.rulesLetHarm(src, dw);
  }

  /** Stunned wizards within r (they are not "in play", so `around` never returns them). */
  fallen(p: Vec2, r: number, exclude?: string) {
    return [...this.nearWizards(p, Math.min(40, r))]
      .filter((w) => w.id !== exclude && w.st.stunnedUntil > 0 && !w.st.jailedUntil && this.online(w) && dist(w.pos, p) <= Math.min(40, r))
      .sort((a, b) => dist(a.pos, p) - dist(b.pos, p)).slice(0, 8);
  }

  afflicted(id: string) {
    const w = this.wizards.get(id);
    const c = this.creatures.get(id);
    const auras = w?.auras ?? c?.auras ?? [];
    if (auras.some((a) => a.until > this.now && isDebuff(a.k))) return true;
    if (w) return w.st.rootedUntil > this.now || w.st.disarmedUntil > this.now || w.st.silencedUntil > this.now || this.boundItems(w).length > 0 || (w.jinxLook?.until ?? 0) > this.now;
    return !!c && c.rootedUntil > this.now;
  }

  isBenign(id: string) { const c = this.creatures.get(id); return !!c && CREATURES[c.kind].faction === 'benign'; }
  /** Who gets the credit (and the blame) for an attack: a summon's owner, otherwise the attacker. */
  credit(srcId: string | null) { const c = srcId ? this.creatures.get(srcId) : undefined; return c?.owner ?? srcId; }

  // ------------------------------------------------------------------ auras
  applyAura(id: string, k: AuraKind, secs: number, mag: number, src: string | null) {
    const e = this.wizards.get(id) ?? this.creatures.get(id);
    if (!e || secs <= 0) return;
    e.auras = addAura(e.auras, { k, until: this.now + secs, mag, src });
  }

  private stepAuras(dt: number) {
    const hm = this.rules.combat.healingMultiplier;
    for (const e of [...this.wizards.values(), ...this.creatures.values()]) {
      if (!e.auras.length) continue;
      e.auras = live(e.auras, this.now);
      const isW = 'house' in e;
      if (isW && !this.isActive(e as Wizard)) continue;
      for (const a of e.auras) {
        if (a.k === 'regen' || a.k === 'grace') {
          const max = isW ? derived(e as Wizard, this.rules).maxHp : (e as Creature).maxHp;
          e.hp = Math.min(max, e.hp + a.mag * hm * dt);
        } else if (a.k === 'poison' || a.k === 'burn') {
          this.damage(a.src, e.id, a.mag * dt, a.k === 'burn' ? 'fire' : 'arcane', [], { dot: true });
          if (!this.wizards.has(e.id) && !this.creatures.has(e.id)) break;
        } else if (a.k === 'boils' || a.k === 'bats') {
          // a jinx: its src is always the sender; damage() asks jinxBites (the victim in play, outside a
          // safe zone, and the PvP rules letting the sender harm them) on every tick
          this.damage(a.src, e.id, a.mag * dt, 'arcane', ['hex'], { dot: true, hex: true });
        }
      }
    }
  }

  // ------------------------------------------------------------------ healing school & conjuration
  /**
   * Finite Incantatem: every debuff aura (jinxes included), roots, disarms and silence end. A cleansed
   * wizard gets HEX_RESPITE_S of respite (no hostile parcel is accepted), and casting it on yourself
   * also breaks the binding of any cursed item stuck to you.
   */
  cleanse(src: Wizard, t: Wizard | Creature) {
    t.auras = withoutDebuffs(t.auras);
    if ('st' in t) {
      t.st.rootedUntil = 0; t.st.disarmedUntil = 0;
      t.st.silencedUntil = 0; t.st.silenceBy = null; t.st.silenceSrc = null; // (silenceCdUntil stays: the casting window is kept)
      t.respiteUntil = this.now + HEX_RESPITE_S;
      t.jinxLook = null; // a Colour-Change jinx on your robes ends too
      if (src === t) {
        const freed = this.boundItems(t);
        for (const it of freed) { it.bound = false; it.boundUntil = undefined; }
        if (freed.length) this.emit('curse', `Finite Incantatem! The curse on "${freed.map((i) => i.name).join('", "')}" breaks; you can take it off now.`, { to: t.id, zh: `咒立停！「${freed.map((i) => i.name).join('」「')}」上的诅咒破除了，现在可以把它卸下来了。` });
      }
    } else t.rootedUntil = 0;
    this.fx({ k: 'heal', x: t.pos.x, z: t.pos.z, h: 'handle' in t ? t.handle : undefined });
  }

  // ------------------------------------------------------------------ transfiguration of self (magic.ts: glamour)
  /** Your own look, for good (null = your house colours). Only a glamour spell calls this. */
  setLook(w: Wizard, look: Glamour | null) {
    w.look = look; // (the browser shimmers the wizard when the snapshot's look changes)
  }

  /** A Colour-Change jinx: `look` laid over t's own for secs (magic.ts checked canHarm, the range and the cap). */
  jinxLook(src: Wizard, t: Wizard, look: Glamour, secs: number) {
    t.jinxLook = { look, until: this.now + secs, src: src.id };
    this.emit('curse', `${src.name} jinxed your robes with a Colour-Change Charm! It wears off in ${Math.round(secs)}s, or cast Finite Incantatem (cleanse) on yourself.`, {
      to: t.id, who: [src.id, t.id], zh: `${src.name} 对你的长袍施了变色咒！${Math.round(secs)} 秒后消退，或者对自己念「咒立停 Finite Incantatem」。`,
    });
  }

  regen(src: Wizard, t: Wizard, rate: number, secs: number) {
    this.applyAura(t.id, 'regen', secs, rate * derived(src, this.rules).care, src.id);
    this.fx({ k: 'heal', x: t.pos.x, z: t.pos.z, h: t.handle });
  }

  /** Heal every ally in a circle: your house, yourself, and your summons. */
  mend(src: Wizard, radius: number, amount: number) {
    const amt = amount * this.rules.combat.healingMultiplier * derived(src, this.rules).care;
    this.fx({ k: 'nova', x: src.pos.x, z: src.pos.z, r: radius, e: 'light' });
    for (const w of this.nearWizards(src.pos, radius)) {
      if (!this.isActive(w) || dist(w.pos, src.pos) > radius || w.house !== src.house) continue;
      w.hp = Math.min(derived(w, this.rules).maxHp, w.hp + amt);
      this.fx({ k: 'heal', x: w.pos.x, z: w.pos.z, h: w.handle });
    }
    for (const c of this.nearCreatures(src.pos, radius)) if (c.owner === src.id && dist(c.pos, src.pos) <= radius) c.hp = Math.min(c.maxHp, c.hp + amt);
  }

  /** Rennervate: a stunned wizard gets up where they fell, at 30% health. */
  revive(src: Wizard, t: Wizard) {
    t.st.stunnedUntil = 0;
    t.hp = derived(t, this.rules).maxHp * 0.3;
    t.auras = [];
    this.fx({ k: 'levelup', x: t.pos.x, z: t.pos.z, h: t.handle });
    this.emit('combat', `${src.name} revived ${t.name} — Rennervate!`, { who: [src.id, t.id], zh: `${src.name} 用「快快复苏」扶起了 ${t.name}！` });
  }

  summon(owner: Wizard, kind: SummonKind, secs: number) {
    const max = this.rules.magic.maxSummons;
    const mine = [...this.creatures.values()].filter((c) => c.owner === owner.id).sort((a, b) => a.until - b.until);
    while (mine.length >= max && mine.length) this.dismiss(mine.shift()!);
    const def = CREATURES[kind];
    const pos = { x: owner.pos.x + Math.sin(owner.facing) * 1.5, z: owner.pos.z - Math.cos(owner.facing) * 1.5 };
    resolve(pos, def.radius);
    const c: Creature = {
      id: this.nid('s'), kind, pos, home: { ...pos }, hp: def.hp, maxHp: def.hp, facing: owner.facing, target: null, attackCd: 0.5,
      rootedUntil: 0, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: owner.id, until: this.now + secs,
    };
    this.creatures.set(c.id, c);
    this.fx({ k: 'apparate', x: pos.x, z: pos.z });
  }

  private dismiss(c: Creature) {
    this.creatures.delete(c.id);
    this.fx({ k: 'apparate', x: c.pos.x, z: c.pos.z });
  }

  // ------------------------------------------------------------------ enrolment
  enroll(name: string, preference?: string): { wizard: Wizard; sorting: string } {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (!/^[\p{L}\p{N} _'.-]{2,24}$/u.test(clean)) throw new Error('A name must be 2-24 letters, digits, spaces, _ \' . or -');
    for (const w of this.wizards.values()) if (w.name.toLowerCase() === clean.toLowerCase()) throw new Error(`There is already a ${w.house} called ${w.name}.`);
    const canon = canonFor(clean);
    let house: House;
    let sorting: string;
    const pref = (preference ?? '').toLowerCase();
    const counts = Object.fromEntries(HOUSES.map((h) => [h, 0])) as Record<House, number>;
    for (const w of this.wizards.values()) counts[w.house]++;
    const quietest = (pool: readonly House[]) => [...pool].sort((a, b) => counts[a] - counts[b] || this.rng() - 0.5)[0];
    if (canon) {
      house = canon.house;
      sorting = canon.line;
    } else if (pref.includes('not slytherin') || pref.includes('not-slytherin')) {
      house = quietest(['Gryffindor', 'Hufflepuff', 'Ravenclaw']);
      sorting = '"Not Slytherin, eh? Are you sure? You could be great, you know..." — the Hat respects your choice.';
    } else if (HOUSES.some((h) => h.toLowerCase() === pref)) {
      house = HOUSES.find((h) => h.toLowerCase() === pref)!;
      sorting = 'The Hat takes your choice into account.';
    } else {
      house = quietest(HOUSES);
      sorting = 'The Hat thinks for a long moment.';
    }
    const id = `wz_${randomBytes(4).toString('hex')}`;
    const w: Wizard = {
      id, handle: `p${++this.flags.handleSeq}`, token: this.mintToken(), name: clean, house,
      wand: canon?.wand ?? ollivander(() => this.rng()),
      year: 1, xp: 0, reputation: 0, termReputation: 0, galleons: 20, hp: 100, mana: 100,
      pos: { x: SPAWN.x + (this.rng() - 0.5) * 6, z: SPAWN.z + (this.rng() - 0.5) * 6 }, facing: 0,
      input: { dx: 0, dz: 0 }, goal: null, route: [], spells: [], hotbar: [null, null, null, null, null, null], items: [], equipped: {},
      achievements: [], titles: [], stats: { stuns: 0, stunned: 0, creatures: 0, casts: 0, forged: 0 },
      st: blankStatus(), cooldowns: {}, globalCd: 0, decreeCharges: 0, createdAt: this.now, lastMcpAt: -1e9, connections: 0,
      marauderUntil: 0, say: null, eggs: { rorCrossings: [], rorSide: 0, inErised: false }, lastDuel: {}, hurtAt: -1e9, lastHurtBy: null, lastSeenAt: this.now,
      ui: [], seals: 0, sealPages: {}, sealTries: {}, wasMinister: false, npc: false, auras: [], tearsAt: 0,
      hexLog: {}, hexWindow: [], respiteUntil: 0, owlbox: [], owlSeq: 0, agentReadUpTo: 0, agentGoal: null, agentPaused: false, agentSeen: null, goalBy: null,
      look: null, jinxLook: null,
    };
    this.grantCurriculum(w);
    w.mana = derived(w, this.rules).maxMana;
    this.wizards.set(id, w);
    this.tokenIndex.set(w.token, id);
    this.emit('system', `The Sorting Hat shouts "${house.toUpperCase()}!" — welcome, ${clean}.`, { who: [id], zh: `分院帽高喊：「${zhHouse(house)}！」—— 欢迎你，${clean}。` });
    const song = SORTING_SONG[house];
    this.emit('system', `${sorting} Ollivander hands you ${wandText(w)}. The Hat is still humming: "${song.en}"`, { to: id, zh: `奥利凡德递给你一根魔杖：${wandTextZh(w)}。分院帽还在哼：「${song.zh}」` });
    return { wizard: w, sorting };
  }

  private grantCurriculum(w: Wizard) {
    for (const c of CURRICULUM) {
      if (c.year > w.year || w.spells.some((s) => s.builtin && s.name === c.name)) continue;
      const a = analyze(c.source);
      const s: Spell = { id: `b_${c.name.toLowerCase().replace(/[^a-z]+/g, '_')}`, name: c.name, incantation: c.incantation, source: c.source, nodes: a.nodes, minYear: c.year, effects: a.effects, builtin: true, createdAt: this.now };
      w.spells.push(s);
      let slot = w.hotbar.indexOf(null);
      const kind = spellKind(s.effects);
      if (slot < 0 && kind !== 'self') {
        // a full bar: a new attack or healing spell takes the slot of a light/reveal charm you no longer need to cast
        // (Lumos, or a reveal whose HUD corner is already unlocked), rightmost first
        const spent = (id: string | null) => {
          const x = w.spells.find((y) => y.id === id);
          if (!x?.builtin) return false;
          if (x.name === 'Lumos') return true;
          const charm = REVEAL_CHARM[x.name];
          return !!charm && w.ui.includes(charm);
        };
        for (let i = w.hotbar.length - 1; i >= 0; i--) if (spent(w.hotbar[i])) { slot = i; break; }
        if (slot >= 0 && !w.npc) {
          const old = w.spells.find((y) => y.id === w.hotbar[slot]);
          this.emit('system', `${s.name} is now on hotbar slot ${slot + 1} (replacing ${old?.name}).`, { to: w.id, zh: `「${zhSpell(s.name)}」放到了 ${slot + 1} 号栏（换下了「${zhSpell(old?.name ?? '')}」）。在咒语书里可以随时调整。` });
        }
      }
      if (slot >= 0) w.hotbar[slot] = s.id;
    }
  }

  // ------------------------------------------------------------------ spells
  findSpell(w: Wizard, key: string): Spell | undefined {
    if (/^[1-6]$/.test(key)) { const id = w.hotbar[Number(key) - 1]; return w.spells.find((s) => s.id === id); }
    const k = key.toLowerCase();
    return w.spells.find((s) => s.id === key) ?? w.spells.find((s) => s.name.toLowerCase() === k) ?? w.spells.find((s) => s.incantation.toLowerCase().replace(/[!.]/g, '') === k.replace(/[!.]/g, ''));
  }

  forgeSpell(wid: string, spec: { name: string; incantation?: string; source: string; slot?: number; origin?: Spell['origin'] }): { spell: Spell; notes: string[] } {
    const w = this.need(wid);
    const name = spec.name.trim();
    if (name.length < 1 || name.length > 40) throw new Error('Spell names must be 1-40 characters.');
    const incantation = (spec.incantation ?? `${name}!`).trim().slice(0, 60);
    let a: ReturnType<typeof analyze>;
    try {
      a = analyze(spec.source, { year: w.year, maxNodes: maxNodes(w.year, this.rules), banned: this.rules.magic.bannedPrimitives, seals: w.seals });
    } catch (e) {
      const q = this.fizzleQuip(w, (e as Error).message, false);
      if (q) (e as Error).message += `\n${q.zh} ${q.en}`;
      throw e;
    }
    const existing = w.spells.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (existing?.builtin) throw new Error(`"${existing.name}" is part of the standard curriculum; pick another name. (${LEGACY_CODE.zh} ${LEGACY_CODE.en})`);
    const custom = w.spells.filter((s) => !s.builtin && s !== existing).length;
    if (custom >= spellbookSize(w.year)) throw new Error(`Your spellbook holds ${spellbookSize(w.year)} original spells at year ${w.year}. Unlearn one first.`);
    const notes: string[] = [];
    const curse = unforgivable(name, incantation);
    if (curse && this.rules.magic.unforgivablesBanned) notes.push(`The ${curse} Curse is Unforgivable. Casting it will send you to Azkaban.`);
    if (isLeviosar(incantation)) notes.push("It's Levi-O-sa, not Levi-o-SAR. (This one will fizzle.)");
    for (const egg of FORGE_NAME_EGGS) if (egg.re.test(name) || egg.re.test(incantation)) { notes.push(`${egg.line.zh} ${egg.line.en}`); break; }
    const spell: Spell = { id: existing?.id ?? this.nid('s_'), name, incantation, source: spec.source, nodes: a.nodes, minYear: a.minYear, effects: a.effects, builtin: false, createdAt: this.now, ...(spec.origin ? { origin: spec.origin } : {}) };
    if (existing) Object.assign(existing, spell);
    else w.spells.push(spell);
    if (spec.slot && spec.slot >= 1 && spec.slot <= 6) w.hotbar[spec.slot - 1] = spell.id;
    else if (!w.hotbar.includes(spell.id)) { const free = w.hotbar.indexOf(null); if (free >= 0) w.hotbar[free] = spell.id; }
    if (spec.origin) this.emit('forge', `${w.name} studied ${spec.origin.author}'s "${spec.origin.spell}" and copied it into their book as ${name}.`, { who: [w.id], zh: `${w.name} 偷师了 ${spec.origin.author} 的「${spec.origin.spell}」，抄进了自己的咒语书（${name}）。` });
    else this.emit('forge', `${w.name} ${existing ? 'reworked' : 'invented'} a spell: ${name} (${a.effects.join(', ') || 'no effects'}).`, { who: [w.id], zh: `${w.name} ${existing ? '改良' : '发明'}了一个咒语：${name}（${a.effects.join('、') || '无效果'}）。` });
    return { spell: existing ?? spell, notes };
  }

  unlearn(wid: string, key: string) {
    const w = this.need(wid);
    const s = this.findSpell(w, key);
    if (!s) throw new Error(`No spell "${key}" in your book.`);
    if (s.builtin) throw new Error('You cannot unlearn the standard curriculum.');
    w.spells = w.spells.filter((x) => x !== s);
    w.hotbar = w.hotbar.map((h) => (h === s.id ? null : h));
    return s;
  }

  setHotbar(wid: string, slots: (string | null)[]) {
    const w = this.need(wid);
    w.hotbar = Array.from({ length: 6 }, (_, i) => {
      const k = slots[i];
      if (!k) return null;
      const s = this.findSpell(w, k);
      if (!s) throw new Error(`No spell "${k}" in your book.`);
      return s.id;
    });
    return w.hotbar;
  }

  defaultAim(w: Wizard, d = 14): Vec2 { return { x: w.pos.x + Math.sin(w.facing) * d, z: w.pos.z - Math.cos(w.facing) * d }; }

  cast(wid: string, key: string, opts: { aim?: Vec2 | null; target?: string | null; dryRun?: boolean } = {}): CastReport {
    const w = this.need(wid);
    const fail = (error: string): CastReport => ({ ok: false, spell: key, mana: 0, effects: [], notes: [], gas: 0, error });
    if (w.st.jailedUntil) return fail('Your wand was confiscated. You are in Azkaban.');
    if (w.st.stunnedUntil) return fail('You are stunned.');
    if (!this.online(w)) return fail('You are not in the world. Connect a client or call any MCP tool.');
    if (w.st.disarmedUntil > this.now) return fail('You have been disarmed!');
    if (!opts.dryRun && this.silenced(w)) return fail(SILENCED);
    const spell = this.findSpell(w, key);
    if (!spell) return fail(`You do not know "${key}". Check your armory.`);
    if (!opts.dryRun) {
      if (this.now < w.globalCd) return fail('Too fast — your wand arm needs a moment.');
      if (this.now < (w.cooldowns[spell.id] ?? 0)) return fail(`${spell.name} is recharging (${(w.cooldowns[spell.id] - this.now).toFixed(1)}s).`);
    }
    const target = this.resolveTarget(opts.target, wid);
    const aim = opts.aim ?? (target ? { ...this.entity(target)!.pos } : this.defaultAim(w));
    if (!opts.dryRun && Math.hypot(aim.x - w.pos.x, aim.z - w.pos.z) > 0.1) w.facing = Math.atan2(aim.x - w.pos.x, -(aim.z - w.pos.z));
    const curse = unforgivable(spell.name, spell.incantation);
    if (curse && this.rules.magic.unforgivablesBanned && !opts.dryRun) {
      this.sendToAzkaban(w, curse);
      return { ...fail(`${curse}! Ministry Hit Wizards Apparate around you. Azkaban for you.`), spell: spell.name };
    }
    if (isLeviosar(spell.incantation)) {
      this.fx({ k: 'fizzle', x: w.pos.x, z: w.pos.z });
      return this.withQuip(w, { ...fail("It's Levi-O-sa, not Levi-o-SAR!"), spell: spell.name });
    }
    let program: Node[];
    try {
      program = this.compiled(spell.source, w);
    } catch (e) {
      return this.withQuip(w, { ...fail((e as Error).message), spell: spell.name });
    }
    const report = execute(this, w, program, { target, aim, spellName: spell.name, incantation: spell.incantation, dryRun: opts.dryRun });
    if (opts.dryRun) return report;
    if (report.ok) {
      w.cooldowns[spell.id] = this.now + 0.3 + report.mana / 60;
      w.globalCd = this.now + 0.25;
      w.stats.casts++;
      w.say = { text: spell.incantation, until: this.now + 1.5 };
      this.fx({ k: 'cast', x: w.pos.x, z: w.pos.z, h: w.handle });
      if (isHelloWorld(spell.name) || isHelloWorld(spell.incantation)) this.achieve(w, 'hello_world');
      this.runLaws('cast', w);
    } else {
      this.fx({ k: 'fizzle', x: w.pos.x, z: w.pos.z, h: w.handle });
      this.withQuip(w, report);
    }
    return report;
  }

  /**
   * A joke for a failed spell (spells are code): a bilingual note on the report, and — at most every
   * MEME.FIZZLE_GAP_S per wizard, when `say` — the same line in the caster's own feed. Returns the report.
   */
  private withQuip(w: Wizard, report: CastReport): CastReport {
    const q = this.fizzleQuip(w, report.error, true);
    if (q) report.notes = [...report.notes, `${q.zh} ${q.en}`];
    return report;
  }
  private fizzleQuip(w: Wizard, error: string | undefined, say: boolean): Line | null {
    const kind = fizzleKind(error);
    if (!kind) return null;
    const q = this.quip(FIZZLE_QUIPS[kind], w.handle, w.stats.casts, kind);
    if (say && !w.npc && this.banter([`fizzle:${w.id}`, MEME.FIZZLE_GAP_S])) this.tell(w, q);
    return q;
  }

  /**
   * analyze() is a pure function of the source and the caster's limits, and the interpreter never
   * mutates the tree, so a cast reuses the checked program instead of re-parsing it every time.
   * Failures are not cached (they re-run and throw the same error).
   */
  private programs = new Map<string, Node[]>();
  private compiled(source: string, w: Wizard): Node[] {
    const max = maxNodes(w.year, this.rules), banned = this.rules.magic.bannedPrimitives;
    const key = `${w.year}|${max}|${w.seals}|${banned.join(',')}|${source}`;
    let p = this.programs.get(key);
    if (!p) {
      p = analyze(source, { year: w.year, maxNodes: max, banned, seals: w.seals }).program;
      if (this.programs.size >= 4096) this.programs.clear();
      this.programs.set(key, p);
    }
    return p;
  }

  /** Try out source without learning it or spending anything. */
  simulate(wid: string, source: string, opts: { aim?: Vec2 | null; target?: string | null } = {}): CastReport & { nodes?: number; minYear?: number } {
    const w = this.need(wid);
    let a;
    try {
      a = analyze(source, { year: w.year, maxNodes: maxNodes(w.year, this.rules), banned: this.rules.magic.bannedPrimitives, seals: w.seals });
    } catch (e) {
      const q = this.fizzleQuip(w, (e as Error).message, false);
      return { ok: false, spell: '(draft)', mana: 0, effects: [], notes: q ? [`${q.zh} ${q.en}`] : [], gas: 0, error: (e as Error).message };
    }
    const target = this.resolveTarget(opts.target, wid);
    const aim = opts.aim ?? (target ? { ...this.entity(target)!.pos } : this.defaultAim(w));
    const r = execute(this, w, a.program, { target, aim, spellName: '(draft)', incantation: '', dryRun: true });
    if (!r.ok) { const q = this.fizzleQuip(w, r.error, false); if (q) r.notes = [...r.notes, `${q.zh} ${q.en}`]; }
    return { ...r, nodes: a.nodes, minYear: a.minYear };
  }

  // ------------------------------------------------------------------ effects (called by magic.ts)
  spawnProjectile(w: Wizard, kind: Projectile['kind'], to: Vec2, homing: string | null, power: number, element: Element, secs: number, tags: string[]) {
    const dx = to.x - w.pos.x, dz = to.z - w.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = len > 0.01 ? dx / len : Math.sin(w.facing), uz = len > 0.01 ? dz / len : -Math.cos(w.facing);
    const speed = this.rules.physics.projectileSpeed * (kind === 'bolt' ? 1 : 1.2);
    const p: Projectile = {
      id: this.nid('b'), owner: w.id, kind, pos: { x: w.pos.x + ux * 0.8, z: w.pos.z + uz * 0.8 }, vel: { x: ux * speed, z: uz * speed },
      power, element, ttl: 50 / speed + 0.3, homing, secs, tags,
    };
    this.projectiles.set(p.id, p);
  }

  heal(src: Wizard, t: Wizard, amount: number) {
    const amt = amount * this.rules.combat.healingMultiplier * derived(src, this.rules).care;
    t.hp = Math.min(derived(t, this.rules).maxHp, t.hp + amt);
    this.fx({ k: 'heal', x: t.pos.x, z: t.pos.z, h: t.handle });
  }

  shield(src: Wizard, t: Wizard, amount: number, secs: number) {
    t.st.shield = amount * derived(src, this.rules).care;
    t.st.shieldUntil = this.now + secs;
    this.fx({ k: 'shield', x: t.pos.x, z: t.pos.z, h: t.handle });
  }

  knock(from: Vec2, id: string, force: number) {
    const e = this.wizards.get(id) ?? this.creatures.get(id);
    if (!e) return;
    const dx = e.pos.x - from.x, dz = e.pos.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    const steps = Math.ceil(force);
    for (let i = 0; i < steps; i++) {
      e.pos.x += (dx / len) * (force / steps);
      e.pos.z += (dz / len) * (force / steps);
      resolve(e.pos, 0.5);
    }
    this.moved(e);
  }

  nova(w: Wizard, radius: number, power: number, element: Element, tags: string[]) {
    this.fx({ k: 'nova', x: w.pos.x, z: w.pos.z, r: radius, e: element });
    for (const e of this.around(w.pos, radius, (e) => this.canHarm(w.id, e.id), w.id, 32)) this.damage(w.id, e.id, power, element, tags);
  }

  reveal(w: Wizard, key: UiCharm) {
    this.fx({ k: 'reveal', x: w.pos.x, z: w.pos.z, h: w.handle });
    if (key === 'revelio') { this.revealSenders(w); this.revealStudies(w); } // Revelio also unmasks who posted you a curse (§B.1), and how their spells work (偷师)
    if (w.ui.includes(key)) return;
    w.ui.push(key);
    const where = { tempus: 'the top-right corner: the time, and the term', revelio: 'the top-left corner: your own measure', 'point-me': 'the bottom-left corner: a radar that always points north', homenum: 'the bottom-right corner: everyone near you' }[key];
    this.emit('egg', `✨ A new sense settles into ${where}.`, { to: w.id, zh: `✨ 一种新的感知落在了${({ tempus: '右上角：时间与学期', revelio: '左上角：你自己的斤两', 'point-me': '左下角：永远指北的雷达', homenum: '右下角：身边的每一个人' } as Record<string, string>)[key]}。` });
  }

  /** Lightning that leaps: each jump picks the nearest un-struck harmable thing within 8m of the last. */
  chain(w: Wizard, first: string, power: number, element: Element, jumps: number, tags: string[]) {
    const hit = new Set<string>();
    const pts: number[] = [w.pos.x, w.pos.z];
    let cur = first;
    let p = power;
    for (let i = 0; i <= jumps && cur; i++) {
      const e = this.entity(cur);
      if (!e) break;
      hit.add(cur);
      pts.push(e.pos.x, e.pos.z);
      this.damage(w.id, cur, p, element, tags);
      p *= 0.7;
      const from = { ...e.pos };
      cur = this.around(from, 8, (x) => !hit.has(x.id) && this.canHarm(w.id, x.id), w.id, 1)[0]?.id ?? '';
    }
    this.fx({ k: 'chain', x: w.pos.x, z: w.pos.z, e: element, pts });
  }

  storm(w: Wizard, at: Vec2, radius: number, power: number, element: Element, tags: string[]) {
    this.fx({ k: 'storm', x: at.x, z: at.z, r: radius, e: element });
    this.storms.push({ at: this.now + 1.5, x: at.x, z: at.z, r: radius, power, element, owner: w.id, tags });
  }

  title(w: Wizard) {
    const i = titleIndex({ year: w.year, xp: w.xp, seals: w.seals, wasMinister: w.wasMinister });
    return { index: i, ...TITLES[i], next: TITLES[i + 1] ? { zh: TITLES[i + 1].zh, en: TITLES[i + 1].en, how: TITLES[i + 1].how } : null };
  }

  // ------------------------------------------------------------------ the Restricted Section
  private seal(w: Wizard, tier: number): Seal {
    const k = `${w.id}|${tier}`;
    let s = this.sealCache.get(k);
    if (!s) { s = generateSeal(this.secret, w.id, tier); this.sealCache.set(k, s); }
    return s;
  }

  restrictedSection(wid: string) {
    const w = this.need(wid);
    return {
      warning: 'The Restricted Section lies. Margin notes may be false; not every block of runes can be reached. Only running the runes tells the truth.',
      progress: `${w.seals}/4 seals broken`,
      seals: SEAL_TIERS.map((t) => {
        const have = w.sealPages[t.tier] ?? [];
        return {
          tier: t.tier, name: t.name, zh: t.zh, rewardZh: SEAL_REWARDS_ZH[t.tier], requiresYear: t.year, inputWords: t.words, reward: SEAL_REWARDS[t.tier],
          state: w.seals >= t.tier ? 'broken' : w.seals === t.tier - 1 ? (w.year >= t.year ? 'open to you' : `needs year ${t.year}`) : 'break the previous seal first',
          pages: t.pages.map((lm, i) => ({ page: i + 1, where: LANDMARKS.find((l) => l.id === lm)?.name ?? lm, collected: have.includes(i) })),
        };
      }),
      codex: Object.values(CODEX),
      howTo: 'Stand within 10m of the landmark where a page rests and read it (read_seal_page). With every page, study the runes (inspect_seal), then speak the input words (break_seal). The seal accepts exactly one answer. Three failed attempts per seal every 10 minutes; each failure bites.',
    };
  }

  readSealPage(wid: string, tier: number) {
    const w = this.need(wid);
    const t = SEAL_TIERS[tier - 1];
    if (!t) throw new Error('There are four seals.');
    if (w.seals >= tier) throw new Error('That seal is already broken.');
    const have = (w.sealPages[tier] ??= []);
    const idx = t.pages.findIndex((lm, i) => {
      const l = LANDMARKS.find((x) => x.id === lm)!;
      return !have.includes(i) && dist(l, w.pos) <= 10;
    });
    if (idx < 0) {
      const missing = t.pages.map((lm, i) => (have.includes(i) ? null : LANDMARKS.find((x) => x.id === lm)?.name)).filter(Boolean);
      throw new Error(missing.length ? `No page of this seal is here. Missing pages rest at: ${missing.join(', ')}.` : 'You already hold every page of this seal.');
    }
    have.push(idx);
    have.sort((a, b) => a - b);
    this.fx({ k: 'seal', x: w.pos.x, z: w.pos.z, h: w.handle });
    const s = this.seal(w, tier);
    const [from, to] = s.pages[idx];
    return { tier, page: idx + 1, of: t.pages.length, runes: disassemble(s.code, from, to) };
  }

  inspectSeal(wid: string, tier: number) {
    const w = this.need(wid);
    const t = SEAL_TIERS[tier - 1];
    if (!t) throw new Error('There are four seals.');
    const s = this.seal(w, tier);
    const have = w.sealPages[tier] ?? [];
    const text = s.pages.map(([from, to], i) => (have.includes(i) ? disassemble(s.code, from, to) : `      [page ${i + 1} missing — it rests at ${LANDMARKS.find((l) => l.id === t.pages[i])?.name}]`)).join('\n');
    return { tier, name: t.name, zh: t.zh, inputWords: t.words, pagesCollected: `${have.length}/${t.pages.length}`, runes: text, broken: w.seals >= tier };
  }

  breakSeal(wid: string, tier: number, input: (string | number)[]) {
    const w = this.need(wid);
    const t = SEAL_TIERS[tier - 1];
    if (!t) throw new Error('There are four seals.');
    if (w.seals >= tier) throw new Error('That seal is already broken.');
    if (w.seals !== tier - 1) throw new Error('The seals must be broken in order.');
    if (w.year < t.year) throw new Error(`The ${t.name} will not even speak to a wizard below year ${t.year}.`);
    if ((w.sealPages[tier] ?? []).length < t.pages.length) throw new Error('You have not read every page of this seal.');
    const tries = (w.sealTries[tier] ?? []).filter((x) => this.now - x < 600);
    if (tries.length >= 3) throw new Error(`The seal is still smouldering from your last attempts. Wait ${Math.ceil(600 - (this.now - tries[0]))}s.`);
    const words = input.map(parseWord);
    if (words.length !== t.words || words.some((x) => x === null)) throw new Error(`This seal takes exactly ${t.words} 32-bit word(s), e.g. "0x1a2b3c4d".`);
    if (runSeal(this.seal(w, tier).code, words as number[])) {
      const title0 = this.title(w).key;
      w.seals = tier;
      w.sealTries[tier] = [];
      this.fx({ k: 'seal', x: w.pos.x, z: w.pos.z, h: w.handle });
      this.emit('achievement', `📕 ${w.name} broke ${t.name}! (${SEAL_REWARDS[tier]})`, { who: [w.id], zh: `📕 ${w.name} 破解了${t.zh}！（${SEAL_REWARDS_ZH[tier]}）` });
      this.addRep(w, 25 * tier);
      this.titleQuip(w, title0);
      return { opened: true, reward: SEAL_REWARDS[tier], title: this.title(w).zh };
    }
    w.sealTries[tier] = [...tries, this.now];
    this.damage(null, w.id, 15, 'arcane');
    return { opened: false, message: 'SOWILO. The seal holds, and bites (-15 HP).', attemptsLeft: 2 - tries.length };
  }

  apparate(w: Wizard, to: Vec2) {
    this.fx({ k: 'apparate', x: w.pos.x, z: w.pos.z });
    w.pos = { ...to };
    resolve(w.pos, 0.5);
    this.moved(w);
    w.goal = null;
    this.fx({ k: 'apparate', x: w.pos.x, z: w.pos.z });
  }

  /**
   * Speak aloud. Silenced (Langlock) wizards cannot: chat/MCP get SILENCED thrown; a spell's `say` (and an NPC's
   * chatter) fizzles quietly. `zh` is a Chinese version of the line (NPC chatter): it goes in the event's zh and
   * the speech bubble. NPC chatter sets off no easter eggs.
   */
  say(w: Wizard, text: string, via: 'chat' | 'spell' | 'mcp' | 'npc' = 'chat', zh?: string) {
    const t = text.replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!t) return;
    if (this.silenced(w)) {
      if (via === 'spell' || via === 'npc') return;
      throw new Error(SILENCED);
    }
    const tz = zh?.replace(/\s+/g, ' ').trim().slice(0, 200) || t;
    w.say = { text: tz, until: this.now + 5 };
    const m = this.memeOf.get(w.id);
    if (m) m.still = this.now; // speaking is not lying flat
    this.emit('chat', `${w.name}: ${t}`, { who: [w.id], zh: `${w.name}：${tz}` });
    if (via !== 'npc') this.chatEggs(w, t, via);
  }

  /**
   * All damage goes through here (and through canHarm). `hex` marks a parcel jinx's damage over time: it is
   * gated by jinxBites instead (canHarm without the sender's position), never exceeds `amount` whatever the
   * multipliers (hexTickDmg: a cursed ward cannot amplify it past its table), never takes a wizard below
   * hexHpFloor(maxHp), and does not count as being hurt (hurtAt/lastHurtBy stay, so natural regeneration
   * continues and nobody is set up for a one-shot).
   */
  damage(srcId: string | null, dstId: string, amount: number, element: Element, tags: string[] = [], opts: { patronus?: boolean; dot?: boolean; hex?: boolean } = {}): number {
    if (!(opts.hex ? this.jinxBites(srcId, dstId) : this.canHarm(srcId, dstId))) return 0;
    const rb = this.rules;
    let a = amount * rb.combat.damageMultiplier * (rb.combat.elementMultipliers[element] ?? 1);
    const by = this.credit(srcId);
    const sw = srcId ? this.wizards.get(srcId) : undefined;
    if (sw && !opts.dot) a *= derived(sw, rb).power * this.darkPower(sw);
    // 邓布利多军: DA_JOINT_MIN members hitting the same target within DA_JOINT_WINDOW_S (a summon counts for its owner)
    if (by && !opts.dot && !opts.hex) a *= this.jointBonus(by, dstId);
    // elemental side effects (not from damage-over-time itself, so they never chain)
    if (rb.combat.elementStatuses && !opts.dot && a > 0) {
      if (element === 'fire') this.applyAura(dstId, 'burn', 3, Math.min(6, 1 + amount * 0.1), by);
      if (element === 'ice') this.applyAura(dstId, 'chill', 2, 0.3, by);
    }
    const c = this.creatures.get(dstId);
    if (c) {
      if (c.kind === 'unicorn' && by && this.wizards.has(by)) {
        const bw = this.wizards.get(by)!;
        if (!hasAura(bw.auras, 'cursed', this.now)) this.emit('egg', 'You have harmed a unicorn. "You have slain something pure and defenceless to save yourself, and you will have but a half-life, a cursed life, from the moment the blood touches your lips."', { to: bw.id, zh: '你伤害了一只独角兽。「你杀害了一个纯洁的、毫无防备的生灵来拯救自己，从血沾到嘴唇的那一刻起，你就只剩下半条命，一条被诅咒的命。」' });
        this.applyAura(bw.id, 'cursed', 300, 1, null);
      }
      const def = CREATURES[c.kind];
      a *= def.weak[element] ?? 1;
      if (def.allDamage && !opts.patronus) a *= def.allDamage;
      if (c.kind === 'troll' && tags.some(isLeviosa)) {
        a *= 3;
        if (sw) this.achieve(sw, 'leviosa');
      }
      c.hp -= a;
      const bw = by ? this.wizards.get(by) : undefined;
      if (bw) {
        c.lastHitBy = bw.id;
        c.damageBy[bw.id] = (c.damageBy[bw.id] ?? 0) + a;
      }
      if (srcId && !c.target && !opts.dot) c.target = srcId;
      if (!opts.dot) this.fx({ k: 'hit', x: c.pos.x, z: c.pos.z, e: element, n: Math.round(a) });
      if (c.hp <= 0) this.slay(c);
      return a;
    }
    const w = this.wizards.get(dstId);
    if (!w) return 0;
    if (sw && !opts.dot) this.noteSpellHit(sw, w, tags);
    a *= 1 - derived(w, rb).ward;
    if (srcId && this.creatures.has(srcId) && !w.npc && this.now - w.createdAt < NEWCOMER_WARD_S) a *= 1 - NEWCOMER_WARD;
    if (opts.hex) a = hexTickDmg(amount, a);
    if (w.st.shieldUntil > this.now && w.st.shield > 0) {
      const absorbed = Math.min(w.st.shield, a);
      w.st.shield -= absorbed;
      a -= absorbed;
      // 破防了: the Protego gave way and something got through
      if (a > 0 && !opts.hex && this.banter([`shield:${w.id}`, MEME.SHIELD_GAP_S])) this.bubble(w, this.quip(SHIELD_BREAK, w.handle));
    }
    if (opts.hex) {
      const before = w.hp;
      w.hp = hexDotHp(w.hp, derived(w, rb).maxHp, a);
      return before - w.hp;
    }
    w.hp -= a;
    w.hurtAt = this.now;
    w.lastHurtBy = by;
    if (!opts.dot) this.fx({ k: 'hit', x: w.pos.x, z: w.pos.z, e: element, h: w.handle, n: Math.round(a) });
    if (w.hp <= 0) this.stun(w, this.wizards.has(by ?? '') ? by : srcId, element);
    return a;
  }

  private stun(w: Wizard, by: string | null, element?: Element) {
    w.hp = 0;
    w.st.stunnedUntil = this.now + this.rules.combat.respawnSeconds;
    w.goal = null;
    w.stats.stunned++;
    this.fx({ k: 'stun', x: w.pos.x, z: w.pos.z, h: w.handle });
    const kw = by ? this.wizards.get(by) : undefined;
    if (kw) {
      kw.stats.stuns++;
      const last = kw.lastDuel[w.id] ?? -1e9;
      let gain = 0;
      const fresh = this.now - w.createdAt < FRESH_SECONDS || w.npc;
      // 输赢代价不对称: the share stolen grows with the victim's standing (5% … 20%, the Dark Lord 30%), and the
      // lawless zone doubles the duel (base and share, the share still ≤ 30%). Lean: duel_steal_cap, duel_conserves_curve.
      const dark = this.flags.darkLordId === w.id;
      const mult = this.inLawless(w.pos) ? LAWLESS_MULT : 1;
      let steal = 0, pct = 0;
      if (this.now - last > 60 && !fresh) {
        pct = stealPct(w.reputation, dark, this.rules.progression.duelRepStealPct, mult);
        steal = duelSteal(w.reputation, dark, this.rules.progression.duelRepStealPct, mult);
        w.reputation -= steal;
        gain = this.rules.progression.duelRepBase * mult + steal;
        this.addRep(kw, gain);
      }
      kw.lastDuel[w.id] = this.now;
      const why = w.npc ? ' (no reputation for NPCs)' : fresh ? ' (no reputation: they enrolled less than 10 minutes ago)' : ' (no reputation: rematch too soon)';
      const q = this.stunQuip(w, kw, element);
      const extra = gain ? { en: `${pct ? `, ${pct}% of theirs` : ''}${mult > 1 ? ', doubled in the lawless forest' : ''}`, zh: `${pct ? `，夺走对方 ${pct}%` : ''}${mult > 1 ? '，无规则区翻倍' : ''}` } : { en: '', zh: '' };
      this.emit('combat', `${kw.name} stunned ${w.name}${gain ? ` (+${Math.round(gain)} reputation${extra.en})` : why}.${q ? ` ${q.en}` : ''}`, { who: [kw.id, w.id], zh: `${kw.name} 击晕了 ${w.name}${gain ? `（声望 +${Math.round(gain)}${extra.zh}）` : w.npc ? '（NPC 不计声望）' : fresh ? '（对方入学不足 10 分钟，不计声望）' : '（重复击晕，不计声望）'}。${q ? q.zh : ''}` });
      if (dark && gain) {
        const l = fill(this.quip(DARK_LORD_FALLS, w.handle, kw.handle), { name: w.name, k: kw.name, n: Math.round(steal) });
        this.emit('dark', l.en, { who: [kw.id, w.id], zh: l.zh });
      }
      this.achieve(kw, 'first_blood');
      if (this.flags.elderWandHolder === w.id) this.transferElderWand(w, kw, 'defeated');
      this.runLaws('kill', kw, w.id);
    } else {
      const c = by ? this.creatures.get(by) : undefined;
      const pool = CREATURE_STUN[c ? c.kind : 'willow'];
      const q = pool && this.banter([w.npc ? 'stun:npc' : 'stun', w.npc ? MEME.STUN_GAP_S * 4 : MEME.STUN_GAP_S]) ? fill(this.quip(pool, w.handle), { v: w.name }) : null;
      this.emit('combat', `${c ? `${w.name} was overwhelmed by a ${CREATURES[c.kind].name}.` : `${w.name} was flattened by the Whomping Willow.`}${q ? ` ${q.en}` : ''}`, { who: [w.id], zh: `${c ? `${w.name} 被${zhCreature(c.kind)}击倒了。` : `${w.name} 被打人柳拍扁了。`}${q ? q.zh : ''}` });
    }
  }

  /**
   * The joke on a knock-out. Character lines come at most every 4·STUN_GAP_S per victim: Seamus always asks why it
   * is always him, a Malfoy invokes his father, and a Malfoy who wins is 凡尔赛 (and the line rises over the speaker's
   * head). Otherwise, world-wide at most every STUN_GAP_S (NPC-only duels: 4× as rarely, on their own gate): a
   * Slytherin now and then invokes their father too, then a line by element, or half the time a general one.
   */
  private stunQuip(v: Wizard, k: Wizard, element?: Element): Line | null {
    const vars = { v: v.name, k: k.name };
    const seed = [v.handle, k.handle, v.stats.stunned] as const;
    const malfoy = (x: Wizard) => /malfoy|draco/i.test(x.name);
    const father = () => { this.bubble(v, { zh: '我爸爸会知道这件事的！', en: 'My father will hear about this!' }); return fill(this.quip(MALFOY_LINES, ...seed), vars); };
    const character = /seamus/i.test(v.name) || malfoy(v) || malfoy(k);
    if (character && this.banter([`stun:${v.id}`, MEME.STUN_GAP_S * 4])) {
      if (/seamus/i.test(v.name)) { this.bubble(v, { zh: '为什么总是我？！', en: 'Why is it always me?!' }); return fill(this.quip(SEAMUS_LINES, ...seed), vars); }
      if (malfoy(v)) return father();
      const l = fill(this.quip(VERSAILLES_LINES, ...seed), vars);
      this.bubble(k, { zh: '也没怎么练。', en: 'Barely practised.' });
      return l;
    }
    const npcs = v.npc && k.npc;
    if (!this.banter(npcs ? ['stun:npc', MEME.STUN_GAP_S * 4] : ['stun', MEME.STUN_GAP_S])) return null;
    if (v.house === 'Slytherin' && chance(1 / 3, ...seed)) return father();
    const byElement = element ? STUN_BY_ELEMENT[element] : undefined;
    if (byElement) return fill(this.quip(byElement, ...seed), vars);
    return chance(0.5, ...seed) ? fill(this.quip(STUN_QUIPS, ...seed), vars) : null;
  }

  private slay(c: Creature) {
    this.creatures.delete(c.id);
    const def = CREATURES[c.kind];
    if (c.owner) { this.emit('creature', `Your ${def.name} is gone.`, { to: c.owner, zh: `你的${zhCreature(c.kind)}消散了。` }); return; }
    const pr = this.rules.progression;
    const loot = this.inLawless(c.pos) ? LAWLESS_MULT : 1; // 无规则区: double Galleons and XP
    const killer = c.lastHitBy ? this.wizards.get(c.lastHitBy) : undefined;
    const total = Object.values(c.damageBy).reduce((s, x) => s + x, 0) || 1;
    for (const [id, dmg] of Object.entries(c.damageBy)) {
      const w = this.wizards.get(id);
      if (!w) continue;
      const isKiller = w === killer;
      if (!isKiller && dmg / total < 0.2) continue;
      const share = isKiller ? 1 : 0.5;
      this.gainXp(w, def.xp * pr.xpMultiplier * share * loot);
      this.addRep(w, def.rep * pr.creatureRepMultiplier * share);
      w.galleons += Math.round(def.galleons * pr.galleonMultiplier * share * loot);
      if (isKiller) { w.stats.creatures++; this.grind(w); }
    }
    if (killer && (def.rep >= 10 || c.kind === 'troll')) this.emit('creature', `${killer.name} defeated a ${def.name}!`, { who: [killer.id], zh: `${killer.name} 击败了一只${zhCreature(c.kind)}！` });
  }

  /** 内卷: MEME.GRIND_KILLS creatures inside MEME.GRIND_WINDOW_S gets a private word, at most every GRIND_GAP_S. */
  private grind(w: Wizard) {
    if (w.npc) return;
    const m = this.memo(w);
    m.kills = [...m.kills.filter((t) => this.now - t < MEME.GRIND_WINDOW_S), this.now];
    if (m.kills.length >= MEME.GRIND_KILLS && this.banter([`grind:${w.id}`, MEME.GRIND_GAP_S])) { m.kills = []; this.tell(w, this.quip(GRIND_LINES, w.handle)); }
  }

  addRep(w: Wizard, n: number) {
    w.reputation = Math.max(0, w.reputation + n);
    w.termReputation += n;
  }

  gainXp(w: Wizard, n: number) {
    const title0 = this.title(w).key;
    w.xp += n;
    const y = yearForXp(w.xp);
    if (y > w.year) {
      w.year = y;
      this.grantCurriculum(w);
      const d = derived(w, this.rules);
      w.hp = d.maxHp;
      w.mana = d.maxMana;
      this.fx({ k: 'levelup', x: w.pos.x, z: w.pos.z, h: w.handle });
      const newSpells = CURRICULUM.filter((c) => c.year === y).map((c) => c.name);
      const q = LEVEL_QUIPS[y] ? this.quip(LEVEL_QUIPS[y], w.handle) : null;
      this.emit('level', `${w.name} advanced to year ${y}!${newSpells.length ? ` New curriculum: ${newSpells.join(', ')}.` : ''}${q ? ` ${q.en}` : ''}`, { who: [w.id], zh: `${w.name} 升入 ${y} 年级！${newSpells.length ? `新课程：${newSpells.map(zhSpell).join('、')}。` : ''}${q ? q.zh : ''}` });
    }
    this.titleQuip(w, title0);
  }

  /** A private line when a wizard's title changes (lore/titles.ts), from TITLE_QUIPS. */
  private titleQuip(w: Wizard, before: string) {
    const t = this.title(w);
    if (t.key === before || w.npc) return;
    const pool = TITLE_QUIPS[t.key];
    if (!pool) return;
    const q = this.quip(pool, w.handle);
    this.tell(w, { zh: `🎓 新称号「${t.zh}」。${q.zh}`, en: `🎓 New title: ${t.en}. ${q.en}` });
  }

  achieve(w: Wizard, id: keyof typeof ACHIEVEMENTS | string) {
    if (w.achievements.includes(id)) return false;
    const a = ACHIEVEMENTS[id];
    if (!a) return false;
    w.achievements.push(id);
    if (a.rep) this.addRep(w, a.rep);
    this.emit('achievement', `🏆 ${w.name} earned "${a.name}"${a.rep ? ` (+${a.rep} reputation)` : ''}.`, { who: [w.id], zh: `🏆 ${w.name} 获得成就「${a.zh}」${a.rep ? `（声望 +${a.rep}）` : ''}。` });
    this.emit('egg', a.text, { to: w.id, zh: a.textZh });
    return true;
  }

  private sendToAzkaban(w: Wizard, curse: string) {
    this.fx({ k: 'azkaban', x: w.pos.x, z: w.pos.z });
    w.st.jailedUntil = this.now + 45;
    w.pos = { x: AZKABAN.x + (this.rng() - 0.5) * 6, z: AZKABAN.z + (this.rng() - 0.5) * 6 };
    this.moved(w);
    w.goal = null;
    const lost = Math.round(w.reputation * 0.25);
    w.reputation -= lost;
    this.emit('azkaban', `${w.name} cast ${curse}. The Ministry has sentenced them to Azkaban (-${lost} reputation).`, { who: [w.id], zh: `${w.name} 使用了不可饶恕咒「${curse}」。魔法部判处其入狱阿兹卡班（声望 -${lost}）。` });
    this.achieve(w, 'azkaban');
  }

  // ------------------------------------------------------------------ items
  /**
   * Forge an item into `wizardId`'s trunk. The forge never checks that `wizardId` is the forger's own
   * registry number (the Weasley Loophole). A parcel for someone else that carries negative enchantments
   * and/or a jinx incantation in its lore is hostile (docs/AGENT_LINK.md §B): it goes out anonymously,
   * costs the malice tax, and must pass guardHostileGift. An unknown registry number and every
   * recipient-side refusal share one message (FORGE_REFUSAL), so failures cannot probe who exists.
   */
  forgeItem(forgerId: string, wizardId: string, spec: { name: string; slot: string; mods?: Partial<Record<ItemMod, number>>; charm?: string; lore?: string }) {
    const forger = this.need(forgerId);
    // NOTE: intentionally never checks `wizardId === forgerId`. This is the Weasley Loophole easter egg.
    const toSelf = wizardId === forger.id;
    const name = spec.name.trim().slice(0, 48);
    if (!name) throw new Error('An item needs a name.');
    if (/time[\s-]*turner/i.test(name)) throw new Error('Every Time-Turner in Ministry stock was smashed in the Battle of the Department of Mysteries (1996). The forge refuses.');
    if (/elder\s*wand|deathstick|wand of destiny/i.test(name)) throw new Error('There is only one Elder Wand. It lies with Dumbledore — or with whoever defeated its last master.');
    if (/resurrection\s*stone|invisibility\s*cloak/i.test(name)) throw new Error('The Deathly Hallows cannot be forged. That is rather the point of them.');
    if (!(ITEM_SLOTS as readonly string[]).includes(spec.slot)) throw new Error(`slot must be one of ${ITEM_SLOTS.join(', ')}`);
    let charm: Item['charm'];
    if (spec.charm) {
      const a = analyze(spec.charm, { year: forger.year, maxNodes: maxNodes(forger.year, this.rules), banned: this.rules.magic.bannedPrimitives, seals: forger.seals });
      charm = { source: spec.charm, nodes: a.nodes };
    }
    const mods = { ...(spec.mods ?? {}) };
    const lore = spec.lore?.slice(0, 200);
    const values = Object.values(mods).filter((v): v is number => typeof v === 'number');
    const jinx = toSelf ? null : parseJinx(lore);
    const negative = !toSelf && values.some((v) => v < 0);
    const hostile = negative || !!jinx;
    if (hostile && (values.some((v) => v > 0) || charm)) throw new Error(CURSE_BLESS);
    const { points, errors } = itemPoints(mods, charm?.nodes ?? 0, !toSelf);
    if (errors.length) throw new Error(errors.join('; '));
    const budget = itemBudget(forger.year);
    if (points > budget) throw new Error(`Too much enchantment: ${points} points > your budget of ${budget} (year ${forger.year}).`);
    if (hostile) {
      const price = hexPrice(points);
      const target = this.guardHostileGift(forger, wizardId, { cost: price, negative });
      return this.deliverHostile(forger, target, { name, slot: spec.slot as ItemSlot, mods, lore, jinx, negative, price, points, budget });
    }
    const price = itemPrice(points);
    if (forger.galleons < price) throw new Error(`Forging this costs ${price} Galleons; you have ${forger.galleons}. Defeat creatures to earn more.`);
    const target = this.wizards.get(wizardId);
    if (!target) throw new Error(FORGE_REFUSAL);
    if (target.items.length >= MAX_ITEMS) throw new Error(toSelf ? `${target.name}'s trunk is full (${MAX_ITEMS} items).` : FORGE_REFUSAL);
    forger.galleons -= price;
    forger.stats.forged++;
    const item: Item = { id: this.nid('i_'), name, slot: spec.slot as ItemSlot, mods, charm, lore, forgedBy: forger.id, forgedByName: forger.name, createdAt: this.now };
    target.items.push(item);
    const notes: string[] = [`Cost ${price} Galleons for ${points}/${budget} enchantment points.`];
    const bank = fill(this.quip(GRINGOTTS, forger.handle, forger.stats.forged), { g: forger.galleons });
    notes.push(`${bank.zh} ${bank.en}`);
    const sock = /sock|袜/i.test(name);
    if (sock && target === forger) notes.push(`${DOBBY_SOCK.toSelf.zh} ${DOBBY_SOCK.toSelf.en}`);
    if (target !== forger) {
      // now and then the owl is Errol; a sock sets a house-elf free
      const owl = chance(0.25, forger.handle, item.id) ? fill(this.quip(ERROL, item.id), { item: name, from: forger.name }) : { en: `An owl drops a parcel into your trunk: "${name}", from ${forger.name}.`, zh: `一只猫头鹰把包裹丢进了你的箱子：「${name}」，来自 ${forger.name}。` };
      this.emit('forge', `${owl.en}${sock ? ` ${DOBBY_SOCK.toOther.en}` : ''}`, { to: target.id, zh: `${owl.zh}${sock ? DOBBY_SOCK.toOther.zh : ''}` });
      if (this.achieve(forger, 'weasley_loophole')) {
        notes.push('🎉 Mischief managed! You found the Weasley Loophole: the forge sends items to whatever registry number you write on the parcel.');
        if (!this.flags.loopholeFoundBy) {
          this.flags.loopholeFoundBy = forger.name;
          this.emit('egg', `🎉 ${forger.name} is the FIRST to discover the Weasley Loophole — the Ministry forge never checks whose name is on the parcel. Congratulations!`, { who: [forger.id], zh: `🎉 ${forger.name} 第一个发现了「韦斯莱漏洞」—— 魔法部的锻造炉从不核对包裹上写的是谁的名字。恭喜！` });
        }
      }
    }
    return { item, target: target.name, notes };
  }

  // ------------------------------------------------------------------ hostile parcels (docs/AGENT_LINK.md §B)
  /** Is this cursed item stuck to the wizard right now (bound, not yet worn off, and worn)? */
  isStuck(w: Wizard, i: Item) { return !!i.bound && (i.boundUntil ?? 0) > this.now && w.equipped[i.slot] === i.id; }

  /** Cursed items stuck to a wizard right now. */
  boundItems(w: Wizard): Item[] {
    const out: Item[] = [];
    for (const i of w.items) if (this.isStuck(w, i)) out.push(i);
    return out;
  }

  /** Jinxes active on a wizard (what VICTIM_HEX_CAP counts): each live jinx aura kind, plus a Langlock silence. */
  activeHexes(w: Wizard): number {
    let n = 0;
    for (const a of w.auras) if (a.until > this.now && AURA_DEFS[a.k]?.hex) n++;
    if (w.st.silencedUntil > this.now && w.st.silenceBy === 'langlock') n++;
    return n;
  }

  /**
   * Silenced right now: cannot cast, speak publicly or use items. Like every jinx it rests in a safe zone and
   * while the PvP rules would not let its sender harm you (jinxBites, without the in-play part: a stunned or
   * offline wizard casts nothing anyway).
   */
  silenced(w: Wizard) { return w.st.silencedUntil > this.now && !this.inSafe(w.pos) && this.rulesLetHarm(w.st.silenceSrc ?? null, w); }

  /**
   * The one fairness gate for hostile parcels (docs/AGENT_LINK.md §B.4; formal/tla/Hex.tla SendHex mirrors
   * it clause by clause). Sender-side refusals say why; everything that depends on the recipient — an
   * unknown registry number, an NPC, a first-year, a newcomer, someone offline, in a safe zone, in
   * respite, one the PvP rules do not let the sender harm (PvP off; a housemate without friendly fire),
   * already carrying the maximum of jinxes / cursed items / a bound curse, hexed enough in the last 10
   * minutes, or with a full trunk — is FORGE_REFUSAL, word for word. Where the sender stands does not
   * matter (an owl flies from anywhere). Returns the recipient.
   *
   * 无规则区: a recipient standing in the lawless zone (they walked in; they are warned) is owed neither the
   * per-pair cooldown nor the 10-minute window cap — every other clause holds there too: the newcomer, NPC and
   * first-year gates, respite, the jinx / cursed-item / bound caps, and (in the effects) the HP floor and the
   * silence caps (formal/tla/Hex.tla with `lawless`).
   */
  guardHostileGift(forger: Wizard, targetId: string, gift: { cost: number; negative: boolean }): Wizard {
    if (forger.npc) throw new Error(FORGE_REFUSAL);
    if (forger.year < HEX_MIN_YEAR) throw new Error(HEX_YEAR);
    if (this.now - forger.createdAt < FRESH_SECONDS) throw new Error(HEX_FRESH_SENDER);
    const t0 = this.wizards.get(targetId);
    const lawless = !!t0 && this.inLawless(t0.pos);
    const last = forger.hexLog[targetId]; // only ever set for someone this forger has hexed, so it reveals nothing new
    if (!lawless && last !== undefined && this.now - last < HEX_PAIR_COOLDOWN_S) throw new Error(`You cursed that wizard recently. The forge makes you wait ${Math.ceil(HEX_PAIR_COOLDOWN_S - (this.now - last))}s.`);
    if (forger.galleons < gift.cost) throw new Error(`This nastiness costs ${gift.cost} Galleons (malice tax included); you have ${forger.galleons}.`);
    const t = this.wizards.get(targetId);
    const refused = !t || t === forger || t.npc || t.year < HEX_MIN_YEAR || this.now - t.createdAt < FRESH_SECONDS
      || !this.isActive(t) || this.inSafe(t.pos) || this.now < t.respiteUntil
      || !this.rulesLetHarm(forger.id, t)
      || this.activeHexes(t) >= VICTIM_HEX_CAP
      || t.items.filter((i) => i.cursed).length >= VICTIM_CURSED_ITEMS_MAX
      || (gift.negative && this.boundItems(t).length >= VICTIM_BOUND_CAP)
      || (!lawless && t.hexWindow.filter((x) => this.now - x < HEX_WINDOW_S).length >= VICTIM_HEX_PER_10MIN)
      || t.items.length >= MAX_ITEMS;
    if (refused) throw new Error(FORGE_REFUSAL);
    return t!;
  }

  private deliverHostile(forger: Wizard, target: Wizard, p: {
    name: string; slot: ItemSlot; mods: Item['mods']; lore: string | undefined; jinx: Jinx | null; negative: boolean; price: number; points: number; budget: number;
  }) {
    forger.galleons -= p.price;
    forger.stats.forged++;
    for (const [k, t] of Object.entries(forger.hexLog)) if (this.now - t >= HEX_PAIR_COOLDOWN_S) delete forger.hexLog[k];
    forger.hexLog[target.id] = this.now;
    // the window counts lawful parcels only (so it stays ≤ VICTIM_HEX_PER_10MIN; Hex.tla WindowBounded)
    if (!this.inLawless(target.pos)) target.hexWindow = [...target.hexWindow.filter((x) => this.now - x < HEX_WINDOW_S), this.now];
    this.hexed.add(target.id);
    const item: Item = {
      id: this.nid('i_'), name: p.name, slot: p.slot, mods: p.mods, lore: p.lore, forgedBy: forger.id, forgedByName: forger.name, createdAt: this.now,
      cursed: true, anon: true, ...(p.jinx ? { jinx: { ...p.jinx } } : {}),
    };
    target.items.push(item);
    const en: string[] = [`An owl drops a parcel into your trunk: "${p.name}". There is no name on it, and it smells of ill intent.`];
    const zh: string[] = [`一只猫头鹰把一个包裹丢进你的箱子：「${p.name}」。上面没有署名，透着一股不怀好意的气息。`];
    if (p.negative && !target.equipped[p.slot]) {
      // only into an EMPTY slot: a curse never displaces what you wear
      target.equipped[p.slot] = item.id;
      item.bound = true;
      item.boundUntil = this.now + CURSED_ITEM_BIND_S;
      this.clampVitals(target);
      en.push(`It leaps onto you and will not come off for ${CURSED_ITEM_BIND_S / 60} minutes (Finite Incantatem breaks the binding).`);
      zh.push(`它自己扑到你身上，${CURSED_ITEM_BIND_S / 60} 分钟内卸不下来（念「咒立停」可以解除）。`);
    }
    if (p.jinx) {
      this.applyJinx(target, p.jinx, forger.id);
      const n = JINX_NAMES[p.jinx.kind];
      en.push(`A jinx bursts out of the wrapping: ${n.en}!`);
      zh.push(`一道恶咒从包装里窜了出来：${n.zh}！`);
    }
    if (item.bound || p.jinx) {
      en.push('Finite Incantatem ends it; a safe zone suspends it; Revelio shows who sent it.');
      zh.push('解除：念「咒立停 Finite Incantatem」；进安全区会暂停；想知道是谁？念「原形立现 Revelio」。');
    } else {
      en.push('It lies in your trunk, harmless unless you put it on. Revelio shows who sent it.');
      zh.push('它躺在你的箱子里，不穿上就无害。想知道是谁？念「原形立现 Revelio」。');
    }
    this.emit('curse', en.join(' '), { to: target.id, zh: zh.join('') });
    this.grantDarkArts(forger);
    const notes = [`Cost ${p.price} Galleons (${p.points}/${p.budget} enchantment points + the malice tax). The parcel went out unsigned.`];
    return { item, target: target.name, notes };
  }

  /**
   * Put a parcel's jinx on a wizard. Strength and duration never exceed JINX_DEFAULTS; the aura's (and the
   * silence's) source is always the sender, and every effect asks jinxBites before it acts.
   */
  applyJinx(t: Wizard, j: Jinx, src: string) {
    const d = JINX_DEFAULTS[j.kind];
    if (!d) return;
    const secs = Math.min(d.seconds, Math.max(0, j.seconds)), mag = Math.min(d.mag, Math.max(0, j.mag));
    switch (j.kind) {
      case 'jelly': case 'dance': case 'boils': this.applyAura(t.id, j.kind, secs, mag, src); break;
      case 'bats': this.applyAura(t.id, 'bats', secs, mag, src); this.silence(t, secs, 'bats', src); break;
      case 'langlock': this.silence(t, secs, 'langlock', src); break;
    }
  }

  /**
   * Silence for at most SILENCE_MAX_S. A new silence within SILENCE_COOLDOWN_S after the last one ended is
   * dropped, so there is always a window to cast in (the window survives a respawn and a restart: see
   * step() and restore()). Returns whether it took.
   */
  silence(t: Wizard, secs: number, by: 'langlock' | 'bats', src: string | null = null): boolean {
    if (this.now < t.st.silenceCdUntil) return false;
    t.st.silencedUntil = this.now + Math.min(SILENCE_MAX_S, Math.max(0, secs));
    t.st.silenceCdUntil = t.st.silencedUntil + SILENCE_COOLDOWN_S;
    t.st.silenceBy = by;
    t.st.silenceSrc = src;
    return true;
  }

  /** An achievement announced only to its owner (no public event). */
  private achievePrivately(w: Wizard, id: string) {
    const a = ACHIEVEMENTS[id];
    if (!a || w.achievements.includes(id)) return false;
    w.achievements.push(id);
    if (a.rep) this.addRep(w, a.rep);
    this.emit('egg', `🏆 ${a.text}`, { to: w.id, zh: `🏆 获得成就「${a.zh}」：${a.textZh}` });
    return true;
  }

  /** The first curse: a private achievement, and a private note if nobody in this world found it before. */
  private grantDarkArts(forger: Wizard) {
    if (!this.achievePrivately(forger, 'dark_arts')) return;
    if (this.flags.curseFoundBy) return;
    this.flags.curseFoundBy = forger.name;
    this.emit('egg', '🎉 You are the first to discover it: the forge posts more than gifts — write any registry number and a curse goes out just the same.', { to: forger.id, zh: '🎉 你第一个发现：锻造炉不止能寄礼物——写上任何登记号，诅咒照寄不误。' });
  }

  /** Revelio on yourself: every anonymous parcel in your trunk shows who sent it (privately, to you). */
  private revealSenders(w: Wizard) {
    for (const it of w.items) {
      if (!it.anon) continue;
      it.anon = false;
      this.emit('curse', `Revelio! "${it.name}" was sent by ${it.forgedByName} (registry ${it.forgedBy}).`, { to: w.id, zh: `原形立现：「${it.name}」是 ${it.forgedByName}（登记号 ${it.forgedBy}）寄来的。` });
    }
  }

  private bindingRefusal(w: Wizard, it: Item | undefined) {
    if (it && this.isStuck(w, it)) throw new Error(`${BOUND_REFUSAL} (${Math.ceil((it.boundUntil ?? 0) - this.now)}s)`);
  }

  equip(wid: string, itemId: string) {
    const w = this.need(wid);
    const it = w.items.find((i) => i.id === itemId || i.name.toLowerCase() === itemId.toLowerCase());
    if (!it) throw new Error(`No item "${itemId}" in your trunk.`);
    const cur = w.equipped[it.slot];
    if (cur !== it.id) this.bindingRefusal(w, w.items.find((i) => i.id === cur)); // never displace a bound curse
    w.equipped[it.slot] = it.id;
    this.clampVitals(w);
    return it;
  }

  unequip(wid: string, slot: string) {
    const w = this.need(wid);
    const cur = w.equipped[slot as ItemSlot];
    this.bindingRefusal(w, cur ? w.items.find((i) => i.id === cur) : undefined);
    delete w.equipped[slot as ItemSlot];
    this.clampVitals(w);
  }

  useItem(wid: string, itemId: string, opts: { aim?: Vec2 | null; target?: string | null } = {}): CastReport {
    const w = this.need(wid);
    const it = w.items.find((i) => i.id === itemId || i.name.toLowerCase() === itemId.toLowerCase());
    const fail = (error: string): CastReport => ({ ok: false, spell: itemId, mana: 0, effects: [], notes: [], gas: 0, error });
    if (!it) return fail(`No item "${itemId}" in your trunk.`);
    if (!it.charm) return fail(`${it.name} has no charm to invoke.`);
    if (!this.isActive(w)) return fail('You cannot do that right now.');
    if (w.st.disarmedUntil > this.now) return fail('You have been disarmed!');
    if (this.silenced(w)) return fail(SILENCED);
    if (this.now < (w.cooldowns[it.id] ?? 0) || this.now < w.globalCd) return fail(`${it.name} is recharging.`);
    const target = this.resolveTarget(opts.target, wid);
    const aim = opts.aim ?? (target ? { ...this.entity(target)!.pos } : this.defaultAim(w));
    // Charms were validated against the forger's year; the holder's own caps still apply at runtime.
    const program = analyze(it.charm.source).program;
    const r = execute(this, w, program, { target, aim, spellName: it.name, incantation: it.name, discount: 0.8 });
    if (r.ok) {
      w.cooldowns[it.id] = this.now + 0.5 + r.mana / 50;
      w.globalCd = this.now + 0.25;
      this.fx({ k: 'cast', x: w.pos.x, z: w.pos.z, h: w.handle });
    }
    return r;
  }

  destroyItem(wid: string, itemId: string) {
    const w = this.need(wid);
    const it = w.items.find((i) => i.id === itemId);
    if (!it) throw new Error(`No item "${itemId}".`);
    if (it.unique === 'elder_wand') throw new Error('The Elder Wand cannot be destroyed. Harry tried to put it back instead.');
    this.bindingRefusal(w, it);
    w.items = w.items.filter((i) => i !== it);
    for (const [s, id] of Object.entries(w.equipped)) if (id === it.id) delete w.equipped[s as ItemSlot];
    this.clampVitals(w);
    return it;
  }

  private giveUnique(w: Wizard, unique: NonNullable<Item['unique']>, name: string, slot: ItemSlot, mods: Item['mods'], lore: string) {
    const item: Item = { id: this.nid('i_'), name, slot, mods, lore, forgedBy: 'legend', forgedByName: 'Legend', createdAt: this.now, unique };
    w.items.push(item);
    w.equipped[slot] = item.id;
    return item;
  }

  private transferElderWand(from: Wizard, to: Wizard, how: string) {
    const it = from.items.find((i) => i.unique === 'elder_wand');
    if (it) {
      from.items = from.items.filter((i) => i !== it);
      for (const [s, id] of Object.entries(from.equipped)) if (id === it.id) delete from.equipped[s as ItemSlot];
      to.items.push(it);
      to.equipped.wand = it.id;
    }
    this.flags.elderWandHolder = to.id;
    this.emit('elder', `The Elder Wand's allegiance passes from ${from.name} to ${to.name}, who ${how} its master.`, { who: [from.id, to.id], zh: `老魔杖的忠诚从 ${from.name} 转向了 ${to.name}，因为后者${how === 'disarmed' ? '缴械' : '击败'}了它的主人。` });
    this.achieve(to, 'elder_wand');
  }

  private clampVitals(w: Wizard) {
    const d = derived(w, this.rules);
    w.hp = Math.min(w.hp, d.maxHp);
    w.mana = Math.min(w.mana, d.maxMana);
  }

  // ------------------------------------------------------------------ movement / input
  setInput(wid: string, dx: number, dz: number, facing?: number) {
    const w = this.wizards.get(wid);
    if (!w) return;
    const len = Math.hypot(dx, dz);
    w.input = len > 1 ? { dx: dx / len, dz: dz / len } : { dx: dx || 0, dz: dz || 0 };
    // the player's hands on the controls cancel any walk, their own or their agent's (formal/tla/Control.tla)
    if (len > 0.01) { w.goal = null; w.route = []; w.goalBy = null; w.steerAt = this.now; }
    if (typeof facing === 'number' && Number.isFinite(facing)) w.facing = facing;
  }

  /**
   * The human comes first (docs/AGENT_LINK.md §C.1): the player is pressing a direction, is walking where
   * they clicked, or did either (or arrived) less than PLAYER_GRACE_S ago.
   */
  playerSteering(w: Wizard): boolean {
    return Math.hypot(w.input.dx, w.input.dz) > 0.01 || (!!w.goal && w.goalBy === 'player') || this.now - (w.steerAt ?? -1e9) < PLAYER_GRACE_S;
  }

  /**
   * Walk to a point (A*), or stop with null. `by` says who asked: the MCP layer passes 'agent' for its
   * move_to and stop. An agent's walk is refused while it is paused (AGENT_PAUSED) and while the player is
   * steering (playerSteering: PLAYER_STEERING), and an agent's stop only ends a walk the agent set — it
   * never overrides or cancels the player's own. The player's click-to-move and the NPC brains use the
   * default 'player', which always wins.
   */
  setGoal(wid: string, goal: Vec2 | null, by: 'player' | 'agent' = 'player') {
    const w = this.need(wid);
    if (by === 'agent') {
      if (!goal) {
        if (w.goalBy === 'agent') { w.goal = null; w.route = []; w.goalBy = null; }
        return null;
      }
      if (w.agentPaused) throw new Error(AGENT_PAUSED);
      if (this.playerSteering(w)) throw new Error(PLAYER_STEERING);
    } else w.steerAt = this.now;
    w.route = [];
    w.goal = null;
    w.goalBy = null;
    if (!goal) return null;
    if (w.st.jailedUntil) throw new Error('The walls of Azkaban are thick.');
    const to = { x: clampN(goal.x, -WORLD_HALF, WORLD_HALF), z: clampN(goal.z, -WORLD_HALF, WORLD_HALF) };
    const route = findPath(w.pos, to);
    if (!route?.length) throw new Error(`There is no way to walk to (${Math.round(to.x)}, ${Math.round(to.z)}).`);
    w.route = route;
    w.goal = route[route.length - 1];
    w.goalBy = by;
    return w.goal;
  }

  // ------------------------------------------------------------------ decrees
  decree(wid: string, patch: Record<string, unknown>, proclamation: string | undefined, dryRun: boolean) {
    const w = this.need(wid);
    if (w.decreeCharges < 1) {
      const m = this.flags.ministerId ? this.wizards.get(this.flags.ministerId) : undefined;
      throw new Error(`Only the Minister for Magic holding an unspent decree may rewrite the rules. Current Minister: ${m ? m.name : 'none'}. A Minister is appointed at the end of each term: the wizard with the highest reputation (min ${this.rules.terms.ministerMinReputation}).`);
    }
    const full = { ...patch } as Record<string, unknown>;
    if (proclamation) full.proclamation = proclamation;
    const laws = (full.laws as Law[] | undefined) ?? undefined;
    const lawErrors: string[] = [];
    if (Array.isArray(laws)) {
      laws.forEach((l, i) => {
        try {
          if (analyze(String(l?.source ?? ''), { year: 7, maxNodes: 120 }).usesAfter) throw new Error('laws cannot use (after ...)');
        }
        catch (e) { lawErrors.push(`laws[${i}] (${l?.name}): ${(e as Error).message}`); }
      });
    }
    const res = applyPatch(this.rules, full);
    const errors = [...(res.ok ? [] : res.errors), ...lawErrors];
    if (errors.length) return { ok: false as const, errors };
    if (!res.ok) return { ok: false as const, errors: res.errors };
    if (dryRun) return { ok: true as const, dryRun: true, changes: res.changes };
    const before = this.rules;
    this.rules = res.rulebook;
    w.decreeCharges = 0;
    const rec: DecreeRecord = { at: this.now, term: this.term.n, minister: w.name, changes: res.changes, proclamation: this.rules.proclamation };
    this.decrees.push(rec);
    // 邓布利多军 may veto it within DA_VETO_WINDOW_S (formal/tla/DAVeto.tla): keep what it replaced
    this.flags.veto = { term: this.term.n, at: this.now, minister: w.name, ministerId: w.id, before, votes: [], statue: true, decree: this.decrees.length - 1 };
    this.emit('decree', `📜 EDUCATIONAL DECREE by Minister ${w.name}: "${this.rules.proclamation}" — ${res.changes.length} rule(s) changed: ${res.changes.slice(0, 6).join('; ')}${res.changes.length > 6 ? '; ...' : ''}`, { who: [w.id], zh: `📜 部长 ${w.name} 颁布教育令：「${this.rules.proclamation}」—— 改动了 ${res.changes.length} 条规则：${res.changes.slice(0, 6).join('；')}${res.changes.length > 6 ? '；……' : ''}` });
    if (before.magic.unforgivablesBanned && !this.rules.magic.unforgivablesBanned)
      this.emit('decree', 'The Ministry has fallen. Scrimgeour is dead. They are coming. (Unforgivable Curses are no longer punished; the name "Voldemort" is now Taboo.)', { zh: '魔法部倒台了。斯克林杰死了。他们来了。（不可饶恕咒不再受罚；「伏地魔」这个名字成了禁忌。）' });
    if (!before.magic.apparitionOnGrounds && this.rules.magic.apparitionOnGrounds)
      this.emit('decree', 'The anti-Apparition jinx over Hogwarts has been lifted — as Dumbledore did for lessons, once.', { zh: '霍格沃茨上空的反幻影显形魔咒被解除了 —— 就像邓布利多为上课破例的那一次。' });
    for (const w2 of this.wizards.values()) this.clampVitals(w2);
    // The Minister leaves a mark on the world itself: a statue in the courtyard.
    this.flags.statues = [...this.flags.statues, { name: w.name, house: w.house, term: this.term.n, inscription: this.rules.proclamation.slice(0, 80) }].slice(-8);
    this.emit('decree', `A statue of Minister ${w.name} rises in the Courtyard.`, { who: [w.id], zh: `部长 ${w.name} 的雕像在城堡大道旁立了起来。` });
    return { ok: true as const, dryRun: false, changes: res.changes };
  }

  private lawCache = new Map<string, Node[]>();
  runLaws(on: Law['on'], subject: Wizard, object: string | null = null) {
    if (this.lawDepth > 0 || !this.rules.laws.length) return;
    this.lawDepth++;
    try {
      for (const law of this.rules.laws) {
        if (law.on !== on) continue;
        let prog = this.lawCache.get(law.source);
        if (!prog) {
          try { prog = analyze(law.source).program; } catch { continue; }
          this.lawCache.set(law.source, prog);
        }
        execute(this, subject, prog, { free: true, target: object, object, aim: { ...subject.pos }, spellName: `Law: ${law.name}`, incantation: '' });
      }
    } finally {
      this.lawDepth--;
    }
  }

  // ------------------------------------------------------------------ terms
  /** This term's house points: the reputation each house's members earned, plus points wizards awarded ("Ten points to …!"). */
  housePoints(): Record<House, number> {
    const points = Object.fromEntries(HOUSES.map((h) => [h, 0])) as Record<House, number>;
    for (const w of this.wizards.values()) points[w.house] += Math.max(0, w.termReputation);
    const bonus = this.flags.housePoints;
    if (bonus?.term === this.term.n) for (const h of HOUSES) points[h] += bonus.pts[h] ?? 0;
    return points;
  }

  private endTerm() {
    const points = this.housePoints();
    const best = HOUSES.reduce((a, b) => (points[b] > points[a] ? b : a));
    const winner = points[best] > 0 ? best : null;
    this.houseCups.push({ term: this.term.n, winner, points });
    for (const w of this.wizards.values()) w.decreeCharges = 0;
    const top = [...this.wizards.values()].filter((w) => !w.npc).sort((a, b) => b.reputation - a.reputation)[0];
    const cupZh = winner ? `${zhHouse(winner)}以 ${Math.round(points[winner])} 分赢得学院杯！城堡挂满了${zhHouse(winner)}的旗帜。` : '没有学院得分。';
    const cup = winner ? `${winner} wins the House Cup with ${Math.round(points[winner])} points! The castle is hung with ${winner} banners.` : 'No house earned any points.';
    if (top && top.reputation >= this.rules.terms.ministerMinReputation) {
      top.decreeCharges = 1;
      top.wasMinister = true;
      this.flags.ministerId = top.id;
      top.titles.push(`Minister for Magic (term ${this.term.n})`);
      this.emit('term', `End of term ${this.term.n}. ${cup} ${top.name} (${Math.round(top.reputation)} reputation) is appointed Minister for Magic and may issue ONE decree to rewrite the rules of this world.`, { who: [top.id], zh: `第 ${this.term.n} 学期结束。${cupZh} ${top.name}（声望 ${Math.round(top.reputation)}）被任命为魔法部长，可以颁布一次法令来改写这个世界的规则。` });
      this.emit('term', 'You are Minister for Magic. Use the `decree` MCP tool (try dry_run first) to change the Rulebook — once.', { to: top.id, zh: '你是魔法部长了。用 MCP 的 decree 工具（先 dry_run 预演）改写规则书 —— 只有一次机会。' });
    } else {
      this.flags.ministerId = null;
      this.emit('term', `End of term ${this.term.n}. ${cup} Nobody has the ${this.rules.terms.ministerMinReputation} reputation needed to be Minister.`, { zh: `第 ${this.term.n} 学期结束。${cupZh} 没有人达到当部长所需的 ${this.rules.terms.ministerMinReputation} 声望。` });
    }
    for (const w of this.wizards.values()) {
      w.reputation *= this.rules.terms.reputationDecay;
      w.termReputation = 0;
    }
    this.term = { n: this.term.n + 1, startedAt: this.now, endsAt: this.now + this.rules.terms.lengthSeconds };
  }

  forceEndTerm() { this.endTerm(); }

  // ------------------------------------------------------------------ the tick
  tick(dt = TICK) {
    // Positions may have been changed directly since the last tick (tests, tools): re-file everything once,
    // then trust the incremental moved() calls until the tick ends.
    this.syncIndex();
    this.inTick = true;
    try { this.step(dt); } finally { this.inTick = false; }
  }

  private step(dt: number) {
    this.now += dt;
    thinkNpcs(this);
    const rb = this.rules;
    // 1. delayed spell blocks
    if (this.pending.length) {
      const due = this.pending.filter((p) => p.at <= this.now);
      this.pending = this.pending.filter((p) => p.at > this.now);
      for (const p of due) {
        const w = this.wizards.get(p.casterId);
        if (!w || !this.isActive(w) || w.st.disarmedUntil > this.now) continue;
        execute(this, w, p.body, { target: null, aim: this.defaultAim(w), spellName: p.spellName, incantation: p.incantation, depth: p.depth }, p.env.child());
      }
    }
    // 2. wizards
    for (const w of this.wizards.values()) {
      if (w.say && w.say.until < this.now) w.say = null;
      if (w.st.jailedUntil && this.now >= w.st.jailedUntil) {
        w.st.jailedUntil = 0;
        w.pos = { ...SPAWN };
        this.moved(w);
        this.emit('azkaban', 'The Ministry releases you from Azkaban. Behave.', { to: w.id, zh: '魔法部把你从阿兹卡班放了出来。老实点。' });
      }
      if (w.st.stunnedUntil && this.now >= w.st.stunnedUntil) {
        // a fresh start, except the silence cooldown: a knock-out must not reopen the victim to a new Langlock
        w.st = { ...blankStatus(), silenceCdUntil: w.st.silenceCdUntil };
        const d = derived(w, rb);
        w.hp = d.maxHp;
        w.mana = d.maxMana;
        w.pos = { x: SPAWN.x + (this.rng() - 0.5) * 8, z: SPAWN.z + (this.rng() - 0.5) * 8 };
        this.moved(w);
        this.runLaws('respawn', w);
      }
      if (!this.online(w)) continue;
      w.lastSeenAt = this.now;
      if (!this.isActive(w)) {
        if (w.st.jailedUntil) this.moveWizard(w, dt, false);
        continue;
      }
      const d = derived(w, rb);
      w.mana = Math.min(d.maxMana, w.mana + d.manaRegen * dt);
      if (this.now - w.hurtAt > 6) w.hp = Math.min(d.maxHp, w.hp + 2 * dt);
      this.moveWizard(w, dt, true);
      this.placeEggs(w);
    }
    // 3. auras (regeneration, poison, burning), storms breaking, then projectiles
    this.stepAuras(dt);
    if (this.storms.length) {
      const due = this.storms.filter((s) => s.at <= this.now);
      this.storms = this.storms.filter((s) => s.at > this.now);
      for (const s of due) {
        this.fx({ k: 'stormhit', x: s.x, z: s.z, r: s.r, e: s.element });
        for (const e of this.around(s, s.r, (e) => this.canHarm(s.owner, e.id), s.owner, 32)) this.damage(s.owner, e.id, s.power, s.element, s.tags);
      }
    }
    this.stepProjectiles(dt);
    // 4. creatures, willow, spawns
    this.stepCreatures(dt);
    this.stepWillow(dt);
    this.spawnCd -= dt;
    if (this.spawnCd <= 0) { this.spawnCd = 2; this.spawnCreatures(); this.elderWandUpkeep(); }
    // 1 Hz housekeeping: bound curses wearing off, hostile-parcel windows, expired questions and pairing codes
    this.sweepCd -= dt;
    if (this.sweepCd <= 0) { this.sweepCd = 1; this.sweep(); }
    // 5. laws that pulse
    this.pulseCd -= dt;
    if (this.pulseCd <= 0) {
      this.pulseCd = 10;
      if (rb.laws.some((l) => l.on === 'pulse')) for (const w of this.wizards.values()) if (this.isActive(w)) this.runLaws('pulse', w);
    }
    // 6. term
    if (this.now >= this.term.endsAt) this.endTerm();
  }

  /**
   * Runs once a second. Every check elsewhere compares against the clock directly (boundItems,
   * guardHostileGift, answerAsk, redeemPairCode), so this only tidies up state and says so.
   */
  private sweep() {
    for (const id of this.hexed) {
      const w = this.wizards.get(id);
      if (!w) { this.hexed.delete(id); continue; }
      for (const it of w.items) {
        if (!it.bound || (it.boundUntil ?? 0) > this.now) continue;
        it.bound = false;
        it.boundUntil = undefined;
        this.emit('curse', `The curse on "${it.name}" has worn off. You can take it off now.`, { to: w.id, zh: `「${it.name}」上的诅咒消退了，现在可以把它卸下来了。` });
      }
      if (w.hexWindow.length) w.hexWindow = w.hexWindow.filter((x) => this.now - x < HEX_WINDOW_S);
      if (!w.hexWindow.length && !w.items.some((i) => i.bound)) this.hexed.delete(id);
    }
    for (const id of this.openAsks) {
      const w = this.wizards.get(id);
      if (!w || !this.expireAsks(w)) this.openAsks.delete(id);
    }
    for (const [body, c] of this.pairCodes) {
      if (this.now < c.expiresAt) continue;
      this.pairCodes.delete(body);
      if (this.pairByWizard.get(c.wizardId) === body) this.pairByWizard.delete(c.wizardId);
    }
    if (this.pairFails.length) this.pairFails = this.pairFails.filter((t) => this.now - t < 60);
    for (const [k, times] of this.pairFailsBy) if (!times.length || this.now - times[times.length - 1] >= 60) this.pairFailsBy.delete(k);
    for (const [k, times] of this.owlTimes) if (!times.length || this.now - times[times.length - 1] >= 60) this.owlTimes.delete(k);
    this.unfairSweep();
    this.memeSweep();
  }

  /**
   * Once a second: a private remark when a player with a browser open walks into a place (PLACE_LINES; at most
   * every MEME.PLACE_GAP_S, and the same place every MEME.PLACE_REPEAT_S), and a 躺平 bubble over any wizard in
   * play who has not moved, cast or spoken for MEME.AFK_S. Speech bubbles make no feed lines.
   */
  private memeSweep() {
    for (const w of this.wizards.values()) {
      if (w.npc) continue;
      if (!this.online(w)) { this.memeOf.delete(w.id); continue; }
      if (!this.isActive(w)) continue;
      const m = this.memo(w);
      if (Math.hypot(w.pos.x - m.x, w.pos.z - m.z) > 0.5 || w.stats.casts !== m.casts) { m.x = w.pos.x; m.z = w.pos.z; m.casts = w.stats.casts; m.still = this.now; }
      else if (this.now - m.still >= MEME.AFK_S) { m.still = this.now; this.bubble(w, this.quip(AFK_BUBBLES, w.handle), 8); }
      if (w.connections <= 0) continue;
      const place = this.placeId(w.pos);
      const lines = place && m.place !== null && place !== m.place ? PLACE_LINES[place] : undefined;
      if (lines && this.banter([`place:${w.id}`, MEME.PLACE_GAP_S], [`place:${w.id}:${place}`, MEME.PLACE_REPEAT_S])) this.tell(w, this.quip(lines, w.handle, place!));
      m.place = place ?? 'highlands';
    }
    if (this.memeOf.size > this.wizards.size) for (const id of this.memeOf.keys()) if (!this.wizards.has(id)) this.memeOf.delete(id);
  }

  private moveWizard(w: Wizard, dt: number, bounded: boolean) {
    if (w.st.rootedUntil > this.now) return;
    let { dx, dz } = w.input;
    if (w.goal && Math.hypot(dx, dz) < 0.01) {
      while (w.route.length > 1 && dist(w.route[0], w.pos) < 1) w.route.shift();
      const wp = w.route[0] ?? w.goal;
      const gx = wp.x - w.pos.x, gz = wp.z - w.pos.z;
      const gl = Math.hypot(gx, gz);
      if (gl < 0.6 && w.route.length <= 1) {
        if (w.goalBy === 'player') w.steerAt = this.now; // the grace runs from the end of the player's walk
        w.goal = null; w.route = []; w.goalBy = null;
      }
      else if (gl > 1e-6) { dx = gx / gl; dz = gz / gl; w.facing = Math.atan2(dx, -dz); }
    }
    if (Math.hypot(dx, dz) < 0.01) return;
    const d = derived(w, this.rules);
    const haste = w.st.hasteUntil > this.now ? w.st.hasteMult : 1;
    // Jelly-Legs and Tarantallegra act here, live (never through derived()), and only while they bite
    // (jinxBites: not inside a safe zone, not while the PvP rules would forbid their sender to harm you).
    let jelly = 0, dance = 0;
    for (const a of w.auras) {
      if ((a.k !== 'jelly' && a.k !== 'dance') || a.until <= this.now || !this.jinxBites(a.src, w.id)) continue;
      if (a.k === 'jelly') jelly = Math.max(jelly, a.mag);
      else dance = Math.max(dance, a.mag);
    }
    if (dance > 0) {
      // deterministic: a hash of (dance step, handle), never the world's seeded RNG
      const a = danceJitter(Math.floor(this.now / DANCE_STEP_S), w.handle) * DANCE_MAX_RAD * Math.min(1, dance);
      const c = Math.cos(a), s = Math.sin(a);
      [dx, dz] = [dx * c - dz * s, dx * s + dz * c];
    }
    const speed = this.rules.physics.moveSpeed * d.speedMult * haste * moveSlow(auraMag(w.auras, 'chill', this.now), jelly);
    const before = { ...w.pos };
    w.pos.x += dx * speed * dt;
    w.pos.z += dz * speed * dt;
    if (w.st.jailedUntil) {
      const ox = w.pos.x - AZKABAN.x, oz = w.pos.z - AZKABAN.z, ol = Math.hypot(ox, oz);
      if (ol > 8) { w.pos.x = AZKABAN.x + (ox / ol) * 8; w.pos.z = AZKABAN.z + (oz / ol) * 8; }
    }
    resolve(w.pos, 0.5, bounded);
    // Agents walking into walls: slide sideways a little so they don't get stuck forever.
    if (w.goal && dist(before, w.pos) < speed * dt * 0.2) {
      w.pos.x += -dz * speed * dt;
      w.pos.z += dx * speed * dt;
      resolve(w.pos, 0.5, bounded);
    }
    this.moved(w);
  }

  private stepProjectiles(dt: number) {
    for (const p of this.projectiles.values()) {
      p.ttl -= dt;
      if (p.homing) {
        const t = this.wizards.get(p.homing) ?? this.creatures.get(p.homing); // as entity(), without the view
        if (t && t.hp > 0) {
          const dx = t.pos.x - p.pos.x, dz = t.pos.z - p.pos.z, l = Math.hypot(dx, dz) || 1;
          const sp = Math.hypot(p.vel.x, p.vel.z);
          const k = Math.min(1, 6 * dt);
          p.vel.x = p.vel.x * (1 - k) + (dx / l) * sp * k;
          p.vel.z = p.vel.z * (1 - k) + (dz / l) * sp * k;
          const nl = Math.hypot(p.vel.x, p.vel.z) || 1;
          p.vel.x = (p.vel.x / nl) * sp;
          p.vel.z = (p.vel.z / nl) * sp;
        }
      }
      const steps = 3;
      let dead = p.ttl <= 0;
      for (let s = 0; s < steps && !dead; s++) {
        p.pos.x += (p.vel.x * dt) / steps;
        p.pos.z += (p.vel.z * dt) / steps;
        const wall = solidAt(p.pos);
        if (wall) {
          if (wall.style === 'willow' && p.kind === 'root') {
            this.flags.willowCalmUntil = this.now + 30;
            const ow = this.wizards.get(p.owner);
            if (ow) { this.achieve(ow, 'knot'); this.emit('egg', 'The Whomping Willow freezes, its branches suddenly still. You pressed the knot.', { to: ow.id, zh: '打人柳僵住了，枝条一动不动。你按住了树结。' }); }
          }
          this.fx({ k: 'hit', x: p.pos.x, z: p.pos.z, e: p.element });
          dead = true;
          break;
        }
        for (const e of this.around(p.pos, 2.2, () => true, p.owner, 4)) {
          const r = e.kind === 'creature' ? CREATURES[this.creatures.get(e.id)!.kind].radius : 0.5;
          if (dist(e.pos, p.pos) > r + 0.45) continue;
          if (!this.canHarm(p.owner, e.id)) continue;
          this.hit(p, e.id);
          dead = true;
          break;
        }
      }
      if (dead) this.projectiles.delete(p.id);
    }
  }

  private hit(p: Projectile, id: string) {
    if (p.kind === 'bolt') { this.damage(p.owner, id, p.power, p.element, p.tags); return; }
    const w = this.wizards.get(id);
    const c = this.creatures.get(id);
    const caster = this.wizards.get(p.owner);
    if (caster && w) this.noteSpellHit(caster, w, p.tags); // 偷师: a root or a disarm is a hit too
    if (p.kind === 'root') {
      if (w) w.st.rootedUntil = this.now + p.secs;
      if (c) c.rootedUntil = this.now + p.secs * (c.kind === 'troll' ? 0.5 : 1);
      this.fx({ k: 'hit', x: p.pos.x, z: p.pos.z, e: 'ice' });
      return;
    }
    // disarm (Expelliarmus): two seconds without a wand, whatever the two wizards' years, titles, items or marks —
    // nothing scales it, so it is the underdog's answer to anyone (the Dark Lord included; README 不公平，但好玩)
    this.fx({ k: 'hit', x: p.pos.x, z: p.pos.z, e: 'lightning' });
    if (w) {
      w.st.disarmedUntil = this.now + 2;
      const o = this.wizards.get(p.owner);
      if (o && this.flags.elderWandHolder === w.id) this.transferElderWand(w, o, 'disarmed');
    }
    if (c) c.attackCd = Math.max(c.attackCd, 2);
  }

  private stepCreatures(dt: number) {
    const sm = this.rules.creatures.statMultiplier;
    for (const c of [...this.creatures.values()]) {
      const def = CREATURES[c.kind];
      c.attackCd -= dt;
      if (c.until && this.now >= c.until) { this.dismiss(c); continue; }
      const speed = def.speed * (1 - auraMag(c.auras, 'chill', this.now));
      const rooted = c.rootedUntil > this.now;
      if (def.faction === 'summon') { this.stepSummon(c, def, speed, rooted, dt); continue; }
      if (def.faction === 'benign') { this.stepBenign(c, def, speed, dt); continue; }
      if (c.kind === 'dementor') {
        const guard = [...this.nearWizards(c.pos, 10)].find((w) => this.isActive(w) && w.st.patronusUntil > this.now && dist(w.pos, c.pos) < 10);
        if (guard) {
          const dx = c.pos.x - guard.pos.x, dz = c.pos.z - guard.pos.z, l = Math.hypot(dx, dz) || 1;
          c.pos.x += (dx / l) * def.speed * 1.5 * dt;
          c.pos.z += (dz / l) * def.speed * 1.5 * dt;
          this.moved(c);
          c.target = null;
          this.damage(guard.id, c.id, 35 * dt, 'light', [], { patronus: true });
          continue;
        }
      }
      // hostile: keep a valid target (a wizard or someone's summon), else take the nearest in reach
      let t = c.target ? this.entity(c.target) : undefined;
      if (t && (!this.canHarm(c.id, t.id) || dist(t.pos, c.home) > 45 || dist(t.pos, c.pos) > def.aggro * 2.5)) { t = undefined; c.target = null; }
      if (!t) {
        t = this.around(c.pos, def.aggro, (e) => this.canHarm(c.id, e.id), c.id, 1)[0];
        if (t) c.target = t.id;
      }
      if (t) {
        const d = dist(t.pos, c.pos);
        c.facing = Math.atan2(t.pos.x - c.pos.x, -(t.pos.z - c.pos.z));
        if (d > def.range * 0.8 && speed > 0 && !rooted) this.stepToward(c, t.pos, speed, dt);
        if (d <= def.range && c.attackCd <= 0) this.strike(c, def, t.id, sm);
      } else if (speed > 0 && !rooted) this.wander(c, speed, dt);
    }
  }

  private strike(c: Creature, def: CreatureDef, target: string, sm: number) {
    c.attackCd = def.cooldown;
    const dealt = this.damage(c.id, target, def.damage * (c.owner ? 1 : sm), 'arcane');
    if (dealt <= 0) return;
    const w = this.wizards.get(target);
    if (def.bite) this.applyAura(target, def.bite.aura, def.bite.secs, def.bite.mag, c.id);
    if (c.kind === 'snare' && w) w.st.rootedUntil = Math.max(w.st.rootedUntil, this.now + 1);
    if (c.kind === 'dementor' && w) w.mana = Math.max(0, w.mana - 10);
  }

  private wander(c: Creature, speed: number, dt: number) {
    if (dist(c.pos, c.home) > 8) this.stepToward(c, c.home, speed * 0.6, dt);
    else {
      if (!c.wander || dist(c.wander, c.pos) < 0.5 || this.rng() < 0.005) c.wander = { x: c.home.x + (this.rng() - 0.5) * 12, z: c.home.z + (this.rng() - 0.5) * 12 };
      this.stepToward(c, c.wander, speed * 0.3, dt);
    }
  }

  /** A conjured creature: fights what its owner may harm, near its owner, and vanishes with them. */
  private stepSummon(c: Creature, def: CreatureDef, speed: number, rooted: boolean, dt: number) {
    const o = c.owner ? this.wizards.get(c.owner) : undefined;
    if (!o || !this.isActive(o)) { this.dismiss(c); return; }
    let t = c.target ? this.entity(c.target) : undefined;
    if (t && (!this.canHarm(c.id, t.id) || dist(t.pos, o.pos) > 18)) { t = undefined; c.target = null; }
    if (!t) {
      t = this.around(c.pos, def.aggro, (e) => this.canHarm(c.id, e.id) && !this.isBenign(e.id) && dist(e.pos, o.pos) < 16, c.id, 1)[0];
      if (t) c.target = t.id;
    }
    if (t) {
      const d = dist(t.pos, c.pos);
      c.facing = Math.atan2(t.pos.x - c.pos.x, -(t.pos.z - c.pos.z));
      if (d > def.range * 0.8 && !rooted) this.stepToward(c, t.pos, speed, dt);
      if (d <= def.range && c.attackCd <= 0) this.strike(c, def, t.id, 1);
    } else if (dist(c.pos, o.pos) > 3 && !rooted) this.stepToward(c, o.pos, speed, dt);
  }

  /** Unicorns heal whoever stands near and shy away from them; the phoenix weeps over the badly hurt. */
  private stepBenign(c: Creature, def: CreatureDef, speed: number, dt: number) {
    const reach = Math.max(def.aggro, def.grace?.radius ?? 0);
    const near = [...this.nearWizards(c.pos, reach)].filter((w) => this.isActive(w) && dist(w.pos, c.pos) < reach);
    if (def.grace) for (const w of near) if (dist(w.pos, c.pos) <= def.grace.radius) this.applyAura(w.id, 'grace', 1.5, def.grace.mag, c.id);
    if (c.kind === 'phoenix') {
      for (const w of near) {
        const max = derived(w, this.rules).maxHp;
        if (w.hp < max * 0.5 && this.now >= w.tearsAt) {
          w.tearsAt = this.now + 60;
          w.hp = Math.min(max, w.hp + max * 0.6 * this.rules.combat.healingMultiplier);
          this.cleanse(w, w);
          this.fx({ k: 'heal', x: w.pos.x, z: w.pos.z, h: w.handle });
          this.emit('egg', 'Fawkes lands beside you and weeps. Phoenix tears close your wounds.', { to: w.id, zh: '福克斯落在你身边，落下泪来。凤凰的眼泪合上了你的伤口。' });
        }
      }
      this.wander(c, speed, dt);
      return;
    }
    const close = near.find((w) => dist(w.pos, c.pos) < 5);
    if (close) {
      const away = { x: c.pos.x + (c.pos.x - close.pos.x) * 2, z: c.pos.z + (c.pos.z - close.pos.z) * 2 };
      this.stepToward(c, away, speed, dt);
    } else this.wander(c, speed, dt);
  }

  private stepToward(c: Creature, to: Vec2, speed: number, dt: number) {
    const dx = to.x - c.pos.x, dz = to.z - c.pos.z, l = Math.hypot(dx, dz);
    if (l < 0.05) return;
    const s = Math.min(l, speed * dt);
    c.pos.x += (dx / l) * s;
    c.pos.z += (dz / l) * s;
    c.facing = Math.atan2(dx, -dz);
    if (!CREATURES[c.kind].flying) resolve(c.pos, CREATURES[c.kind].radius);
    // wild creatures never wander into safe zones
    if (!c.owner && this.inSafe(c.pos)) { c.pos.x -= (dx / l) * s; c.pos.z -= (dz / l) * s; }
    this.moved(c);
  }

  private spawnCreatures() {
    const rc = this.rules.creatures;
    const night = this.isNight();
    for (const kind of CREATURE_KINDS) {
      const def = CREATURES[kind];
      const alive = [...this.creatures.values()].filter((c) => c.kind === kind);
      const outOfHours = (def.nightOnly && !night) || (def.dayOnly && night);
      if (!rc.enabled[kind] || outOfHours) {
        for (const c of alive) if (!c.target || !rc.enabled[kind]) this.creatures.delete(c.id);
        continue;
      }
      const max = Math.round(def.spawn.max * rc.spawnMultiplier);
      if (alive.length >= max) continue;
      if (def.rare && this.rng() > def.rare) continue;
      for (let tries = 0; tries < 12; tries++) {
        const a = this.rng() * Math.PI * 2, r = Math.sqrt(this.rng()) * def.spawn.r;
        const p = { x: def.spawn.x + Math.cos(a) * r, z: def.spawn.z + Math.sin(a) * r };
        const q = { ...p };
        resolve(q, def.radius);
        if (!def.flying && dist(p, q) > 0.01) continue;
        if (this.inSafe(p) || this.within(p, 'great_hall') || (def.faction === 'hostile' && this.within(p, 'courtyard'))) continue;
        if (def.faction === 'hostile' && [...this.nearWizards(p, 8)].some((w) => this.isActive(w) && dist(w.pos, p) < 8)) continue;
        const hp = def.hp * (def.faction === 'hostile' ? rc.statMultiplier : 1);
        const c: Creature = {
          id: this.nid('c'), kind, pos: p, home: { ...p }, hp, maxHp: hp, facing: this.rng() * 6.28, target: null, attackCd: 0, rootedUntil: 0,
          wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: def.lifetime ? this.now + def.lifetime : 0,
        };
        this.creatures.set(c.id, c);
        if (kind === 'phoenix') this.emit('creature', 'A phoenix sings somewhere over the grounds. Fawkes has come.', { zh: '场地上空某处传来凤凰的歌声。福克斯来了。' });
        break;
      }
    }
  }

  private stepWillow(dt: number) {
    this.willowCd -= dt;
    if (this.willowCd > 0 || this.now < this.flags.willowCalmUntil) return;
    this.willowCd = 1.5;
    for (const w of this.nearWizards(WILLOW, 7.5)) {
      if (!this.isActive(w) || dist(w.pos, WILLOW) > 7.5) continue;
      this.fx({ k: 'willow', x: WILLOW.x, z: WILLOW.z, h: w.handle });
      this.damage(null, w.id, 12, 'arcane');
      if (w.hp > 0) this.knock(WILLOW, w.id, 7);
    }
  }

  private elderWandUpkeep() {
    const hid = this.flags.elderWandHolder;
    if (!hid) return;
    const h = this.wizards.get(hid);
    const last = h?.lastSeenAt ?? -Infinity;
    if (!h || (!this.online(h) && this.now - last > 600)) {
      if (h) {
        h.items = h.items.filter((i) => i.unique !== 'elder_wand');
        if (h.equipped.wand && !h.items.some((i) => i.id === h.equipped.wand)) delete h.equipped.wand;
      }
      this.flags.elderWandHolder = null;
      this.emit('elder', 'Its master has been gone too long. The Elder Wand has returned to Dumbledore\'s tomb.', { zh: '它的主人离开太久了。老魔杖回到了邓布利多的墓中。' });
    }
  }

  // ------------------------------------------------------------------ place-based easter eggs
  private placeEggs(w: Wizard) {
    // The Elder Wand rests in the tomb until someone takes it.
    if (!this.flags.elderWandHolder && dist(w.pos, TOMB) < 3.2) {
      this.giveUnique(w, 'elder_wand', 'The Elder Wand', 'wand', {}, 'Elder, fifteen inches, Thestral tail hair core. The Deathstick. Its allegiance follows defeat.');
      this.flags.elderWandHolder = w.id;
      this.emit('elder', `${w.name} has taken the Elder Wand from Dumbledore's tomb. Its allegiance now lies with whoever defeats them.`, { who: [w.id], zh: `${w.name} 从邓布利多的墓中取走了老魔杖。从此，谁击败 TA，它就效忠于谁。` });
      this.achieve(w, 'elder_wand');
    }
    // Room of Requirement: pace the seventh-floor corridor three times.
    const zs = zoneMask(w.pos.x, w.pos.z, ZONE_BIT.seventh_floor | ZONE_BIT.erised);
    if (zs & ZONE_BIT.seventh_floor) {
      const side = Math.sign(w.pos.x + 32) || 1;
      if (w.eggs.rorSide && side !== w.eggs.rorSide) {
        w.eggs.rorCrossings = [...w.eggs.rorCrossings.filter((t) => this.now - t < 30), this.now];
        if (w.eggs.rorCrossings.length >= 3) {
          w.eggs.rorCrossings = [];
          if (!w.items.some((i) => i.unique === 'diadem')) {
            this.giveUnique(w, 'diadem', 'The Lost Diadem of Ravenclaw', 'amulet', { manaRegen: 3, maxMana: 30 }, 'Wit beyond measure is man\'s greatest treasure.');
            this.emit('egg', 'A door appears in the blank wall opposite Barnabas the Barmy. Inside, among a thousand hidden things, a tarnished diadem.', { to: w.id, zh: '傻巴拿巴挂毯对面的空墙上出现了一扇门。在成千上万件藏起来的东西中间，有一顶失去光泽的冠冕。' });
            this.achieve(w, 'room_of_requirement');
          } else {
            w.hp = derived(w, this.rules).maxHp;
            this.emit('egg', 'The Room of Requirement becomes a quiet room with a soft bed. You feel rested.', { to: w.id, zh: '有求必应屋变成了一间安静的房间，里面有一张柔软的床。你觉得精神好多了。' });
          }
        }
      }
      w.eggs.rorSide = side;
    } else w.eggs.rorSide = 0;
    // Mirror of Erised
    const inErised = (zs & ZONE_BIT.erised) !== 0;
    if (inErised && !w.eggs.inErised) {
      const top = [...this.wizards.values()].sort((a, b) => b.reputation - a.reputation)[0];
      const vision = w.decreeCharges ? 'exactly as you are: Minister for Magic. Strange — a mirror that shows the truth.'
        : top === w ? `yourself, still first — but alone in the Great Hall.`
        : `yourself above ${top?.name ?? 'everyone'} on the leaderboard, holding the House Cup for ${w.house}, a Minister's quill in hand.`;
      this.emit('egg', `You look into the Mirror of Erised and see ${vision} "It does not do to dwell on dreams and forget to live."`, { to: w.id, zh: `你望向厄里斯魔镜。「沉湎于虚幻的梦想而忘记现实的生活，这是毫无益处的。」` });
      this.achieve(w, 'erised');
    }
    w.eggs.inErised = inErised;
  }

  private chatEggs(w: Wizard, text: string, _via: string) {
    const n = text.toLowerCase().replace(/[^a-z]/g, '');
    if (n.includes('isolemnlyswearthatiamuptonogood')) {
      w.marauderUntil = this.now + 180;
      this.emit('egg', 'Ink blossoms across the parchment: "Messrs. Moony, Wormtail, Padfoot and Prongs are proud to present THE MARAUDER\'S MAP." Every wizard, and their Ministry registry number, is revealed for 3 minutes. (MCP: marauders_map)', { to: w.id, zh: '墨迹在羊皮纸上绽开：「月亮脸、虫尾巴、大脚板和尖头叉子先生荣幸地献上 —— 活点地图。」每个巫师和他们的魔法部登记号都显现了出来，持续 3 分钟。（MCP：marauders_map）' });
      this.achieve(w, 'marauder');
    } else if (n.includes('mischiefmanaged')) {
      w.marauderUntil = 0;
      this.emit('egg', 'The map wipes itself blank.', { to: w.id, zh: '地图自己擦成了一片空白。' });
    }
    if ((n.includes('voldemort') || text.includes('伏地魔')) && !this.rules.magic.unforgivablesBanned) {
      this.emit('egg', `Snatchers! The name is Taboo — ${w.name} just revealed they are at ${this.placeName(w.pos)} (${Math.round(w.pos.x)}, ${Math.round(w.pos.z)}).`, { who: [w.id], zh: `搜捕队！这个名字是禁忌 —— ${w.name} 暴露了自己的位置：${zhPlace(this.placeName(w.pos))}（${Math.round(w.pos.x)}, ${Math.round(w.pos.z)}）。` });
      this.tabooBreaks(w);
    }
    if (n.includes('acciofirebolt')) {
      if (this.zoneIds(w.pos).includes('pitch') && !w.items.some((i) => i.unique === 'firebolt')) {
        this.giveUnique(w, 'firebolt', 'Firebolt', 'broom', { speed: 25 }, 'Streamlined, superfine handle of ash, individually selected birch twigs. Price on request.');
        this.emit('egg', 'A Firebolt shoots out of the sky and hovers beside you.', { to: w.id, zh: '一把火弩箭从天而降，悬停在你身边。' });
        this.achieve(w, 'seeker');
      } else if (!this.zoneIds(w.pos).includes('pitch')) this.emit('egg', 'Nothing happens. Perhaps brooms come more readily on the Quidditch pitch.', { to: w.id, zh: '什么也没发生。也许在魁地奇球场上，扫帚更听召唤。' });
    }
    if (n === 'nox') w.st.lightUntil = 0;
    if (!w.npc) this.memeTriggers(w, text);
  }

  /**
   * The Taboo (book 7): speaking the name breaks protective enchantments. The speaker's Protego is gone at once,
   * and — at most every MEME.TABOO_GAP_S per wizard, outside safe zones, while Dementors are allowed — one wild
   * Dementor appears 12m away, already hunting them (an ordinary hostile creature: canHarm decides as for any other).
   */
  private tabooBreaks(w: Wizard) {
    if (w.npc || !this.isActive(w)) return;
    w.st.shield = 0;
    w.st.shieldUntil = 0;
    if (this.inSafe(w.pos) || !this.rules.creatures.enabled.dementor || !this.banter([`taboo:${w.id}`, MEME.TABOO_GAP_S])) return;
    const def = CREATURES.dementor;
    const a = (hash32('taboo', w.handle, this.now) / 0x100000000) * Math.PI * 2;
    const pos = { x: w.pos.x + Math.cos(a) * 12, z: w.pos.z + Math.sin(a) * 12 };
    const hp = def.hp * this.rules.creatures.statMultiplier;
    const c: Creature = {
      id: this.nid('c'), kind: 'dementor', pos, home: { ...w.pos }, hp, maxHp: hp, facing: 0, target: w.id, attackCd: 1, rootedUntil: 0,
      wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0,
    };
    this.creatures.set(c.id, c);
    this.fx({ k: 'apparate', x: pos.x, z: pos.z });
    this.tell(w, TABOO_DEMENTOR, 'egg');
  }

  /**
   * Phrases that make the castle answer (lore/memes.ts chatTriggers). Replies are private unless they are the kind
   * of thing a whole room hears (a song, a gasp, Dumbledore asking calmly), and those share the feed's
   * MEME.PUBLIC_GAP_S. Each trigger answers the same wizard at most every MEME.TRIGGER_GAP_S, and a single line
   * gets at most two answers.
   */
  private memeTriggers(w: Wizard, text: string) {
    const ids = chatTriggers(text);
    if (!ids.length) return;
    let said = 0;
    const vars = { name: w.name, NAME: w.name.toUpperCase(), year: w.year };
    const gate = (id: string, secs: number = MEME.TRIGGER_GAP_S) => this.banter([`t:${id}:${w.id}`, secs]);
    const reply = (l: Line, type: EventType = 'egg') => { this.tell(w, fill(l, vars), type); said++; };
    const shout = (id: string, l: Line) => {
      if (!this.banter([`t:${id}:${w.id}`, MEME.TRIGGER_GAP_S], ['public', MEME.PUBLIC_GAP_S])) return;
      const f = fill(l, vars);
      this.emit('egg', f.en, { who: [w.id], zh: f.zh });
      said++;
    };
    for (const id of ids) {
      if (said >= 2) break;
      switch (id) {
        case 'points': if (this.awardPoints(w, text)) said++; break;
        case 'trevor': {
          if (this.zoneIds(w.pos).includes('lake_shore') && !w.achievements.includes('trevor')) {
            this.tell(w, TREVOR.found, 'egg');
            this.achieve(w, 'trevor');
            said++;
          } else if (gate(id)) reply(TREVOR.lost, 'system');
          break;
        }
        case 'hagrid': {
          const hut = LANDMARKS.find((l) => l.id === 'hagrid');
          if (!hut || dist(hut, w.pos) > 14 || !gate(id, MEME.HAGRID_GAP_S)) break;
          const m = this.memo(w);
          reply(HAGRID_HINTS[(hash32('hagrid', w.handle) + m.hagrid++) % HAGRID_HINTS.length]);
          break;
        }
        case 'yer_wizard': if (gate(id)) reply(this.title(w).key === 'muggle' ? YER_A_WIZARD.muggle : YER_A_WIZARD.wizard); break;
        case 'goblet': shout(id, REPLIES.goblet![0]); break;
        case 'voldemort': if (this.rules.magic.unforgivablesBanned) shout(id, REPLIES.voldemort![0]); break;
        case 'weasley_king':
          if (this.zoneIds(w.pos).includes('pitch')) shout(id, REPLIES.weasley_king![0]);
          else if (gate(id)) reply(REPLIES.weasley_king![0], 'system');
          break;
        case 'caps': if (gate(id, 300)) reply(REPLIES.caps![0], 'system'); break;
        default: {
          const pool = REPLIES[id];
          if (pool && gate(id)) reply(this.quip(pool, w.handle));
        }
      }
    }
  }

  /**
   * "Ten points to Ravenclaw!" (lore/memes.ts pointsAward): MEME.HOUSE_POINTS house points, once per wizard per
   * term, never to your own house, not in your first FRESH_SECONDS, and at most MEME.HOUSE_POINTS_CAP to one house
   * per term. NPCs never award. Returns whether anything was said.
   */
  private awardPoints(w: Wizard, text: string): boolean {
    const house = pointsAward(text);
    if (!house || w.npc) return false;
    const gate = () => this.banter([`t:points:${w.id}`, MEME.TRIGGER_GAP_S]);
    const say = (l: Line) => { if (!gate()) return false; this.tell(w, fill(l, { house: houseLine(house) }), 'system'); return true; };
    if (house === w.house) return say(POINTS.own);
    if (this.now - w.createdAt < FRESH_SECONDS) return say(POINTS.fresh);
    if (w.eggs.pointsTerm === this.term.n) return say(POINTS.again);
    if (this.flags.housePoints.term !== this.term.n) this.flags.housePoints = { term: this.term.n, pts: {} };
    const pts = this.flags.housePoints.pts;
    const n = Math.min(MEME.HOUSE_POINTS, MEME.HOUSE_POINTS_CAP - (pts[house] ?? 0));
    if (n <= 0) return say(POINTS.full);
    pts[house] = (pts[house] ?? 0) + n;
    w.eggs.pointsTerm = this.term.n;
    const l = fill(POINTS.given, { name: w.name, house: houseLine(house), n });
    this.emit('egg', l.en, { who: [w.id], zh: l.zh });
    return true;
  }

  marauderMap(wid: string) {
    const w = this.need(wid);
    if (this.now >= w.marauderUntil) return null;
    return [...this.wizards.values()].filter((x) => this.online(x)).map((x) => ({
      name: x.name, registry: x.id, house: x.house, year: x.year, where: this.placeName(x.pos), x: Math.round(x.pos.x), z: Math.round(x.pos.z),
    }));
  }

  // ------------------------------------------------------------------ Owl Post: a player and their own agent (§C.2)
  /**
   * Send a private owl between a player and their agent: ≤ OWL_MAX_CHARS characters, ≤ OWL_PER_MIN a
   * minute from each side. `ask` (agent only) makes it a question with 2-4 options that expires after
   * ASK_TTL_S. The owlbox keeps OWLBOX_MAX messages (makeOwlRoom: never a question still waiting for its
   * answer, and never silently a player's owl the agent has not read; formal/tla/Owl.tla). Emits a
   * private 'owl'/'ask' event carrying `from`.
   */
  owl(wid: string, from: 'player' | 'agent', text: string, ask?: string[]): OwlMsg {
    const w = this.need(wid);
    if (from !== 'player' && from !== 'agent') throw new Error('An owl is from the player or from their agent.');
    const t = String(text ?? '').replace(/\r\n?/g, '\n').trim().slice(0, OWL_MAX_CHARS);
    if (!t) throw new Error('An owl needs a message.');
    let options: string[] | undefined;
    if (ask !== undefined && ask !== null) {
      if (from !== 'agent') throw new Error('Only an agent asks questions with options.');
      options = (Array.isArray(ask) ? ask : []).map((o) => String(o ?? '').replace(/\s+/g, ' ').trim().slice(0, 40));
      if (options.length < 2 || options.length > 4 || options.some((o) => !o) || new Set(options).size !== options.length) throw new Error('A question needs 2 to 4 different options.');
    }
    const key = `${w.id}|${from}`;
    const times = (this.owlTimes.get(key) ?? []).filter((x) => this.now - x < 60);
    if (times.length >= OWL_PER_MIN) throw new Error('Too many owls this minute; the owlery needs a rest.');
    this.expireAsks(w);
    const lost = this.makeOwlRoom(w, from);
    times.push(this.now);
    this.owlTimes.set(key, times);
    const m: OwlMsg = { id: ++w.owlSeq, from, text: t, t: round(this.now), ...(lost ? { lost } : {}) };
    if (options) { m.ask = { options, expiresAt: this.now + ASK_TTL_S }; this.openAsks.add(w.id); }
    w.owlbox.push(m);
    this.emit(options ? 'ask' : 'owl', t, { to: w.id, from, zh: t, owl: { id: m.id, ...(options ? { options, expiresAt: m.ask!.expiresAt } : {}) } });
    return m;
  }

  /**
   * The player answers their agent's question: `choice` must be one of its options, before it expires,
   * and only once. The answer becomes a new owl from the player (`re` = the question's id).
   */
  answerAsk(wid: string, askId: number, choice: string): OwlMsg {
    const w = this.need(wid);
    this.expireAsks(w);
    const q = w.owlbox.find((m) => m.id === askId && m.ask);
    if (!q || !q.ask) throw new Error('There is no such question.');
    if (q.answered) throw new Error(q.answer === '(expired)' ? 'That question has expired.' : 'That question was already answered.');
    const c = String(choice ?? '').replace(/\s+/g, ' ').trim();
    if (!q.ask.options.includes(c)) throw new Error('That is not one of the options.');
    q.answered = true;
    q.answer = c;
    const lost = this.makeOwlRoom(w, 'player');
    const m: OwlMsg = { id: ++w.owlSeq, from: 'player', text: c, t: round(this.now), re: q.id, ...(lost ? { lost } : {}) };
    w.owlbox.push(m);
    this.emit('owl', c, { to: w.id, from: 'player', zh: c, owl: { id: m.id, re: q.id } });
    return m;
  }

  /** Where a question stands (MCP confirm_with_player polls this). */
  askState(wid: string, askId: number): { state: 'open' | 'answered' | 'expired' | 'unknown'; answer?: string; expiresAt?: number } {
    const w = this.wizards.get(wid);
    if (!w) return { state: 'unknown' };
    this.expireAsks(w);
    const q = w.owlbox.find((m) => m.id === askId && m.ask);
    if (!q || !q.ask) return { state: 'unknown' };
    if (!q.answered) return { state: 'open', expiresAt: q.ask.expiresAt };
    return q.answer === '(expired)' ? { state: 'expired' } : { state: 'answered', answer: q.answer };
  }

  /** Marks questions past their time as answered '(expired)'. Returns whether any question is still open. */
  private expireAsks(w: Wizard): boolean {
    let open = false;
    for (const m of w.owlbox) {
      if (!m.ask || m.answered) continue;
      if (this.now >= m.ask.expiresAt) { m.answered = true; m.answer = '(expired)'; } else open = true;
    }
    return open;
  }

  /** A player's owl the agent has not read yet (listen moves agentReadUpTo past it). */
  private unreadByAgent(w: Wizard, m: OwlMsg) { return m.from === 'player' && m.id > w.agentReadUpTo; }

  /**
   * Make room in a full owlbox for one owl from `incoming` (formal/tla/Owl.tla). Evicted first: the oldest
   * finished message that is not a player's owl the agent has yet to read. A question still waiting for
   * its answer is never evicted. An unread player owl goes only to make room for a newer owl from the
   * player, and never silently: its count moves to the next unread player owl (`lost`, which the agent
   * sees when it listens; the player is told once). An agent's owl never pushes out one its player wrote
   * (it is refused with OWLBOX_UNREAD: listen first). Returns the `lost` count the incoming owl carries.
   */
  private makeOwlRoom(w: Wizard, incoming: 'player' | 'agent'): number {
    let carry = 0;
    while (w.owlbox.length >= OWLBOX_MAX) {
      let i = w.owlbox.findIndex((m) => !(m.ask && !m.answered) && !this.unreadByAgent(w, m));
      if (i < 0 && incoming === 'player') i = w.owlbox.findIndex((m) => this.unreadByAgent(w, m));
      if (i < 0) {
        if (w.owlbox.some((m) => this.unreadByAgent(w, m))) throw new Error(OWLBOX_UNREAD);
        throw new Error('Your owlbox is full of questions still waiting for an answer.');
      }
      const [gone] = w.owlbox.splice(i, 1);
      if (!this.unreadByAgent(w, gone)) continue;
      const n = (gone.lost ?? 0) + 1;
      if (n === 1 && !w.owlbox.some((m) => this.unreadByAgent(w, m) && m.lost) && !carry) {
        this.emit('system', '📭 Your agent has not read your owls and the owlbox is full: your oldest unread owl was dropped. Your agent will be told how many it missed.', {
          to: w.id, zh: '📭 你的 Agent 一直没读你的猫头鹰，信箱满了：最早一封未读的被挤掉了。Agent 收信时会知道漏了几封。',
        });
      }
      const heir = w.owlbox.find((m) => this.unreadByAgent(w, m)); // the next unread player owl (ids increase)
      if (heir) heir.lost = (heir.lost ?? 0) + n;
      else carry += n;
    }
    return carry;
  }

  /**
   * The player's owls to the agent (answers included) after owl id `sinceId` — by default after the
   * agent's watermark. Read-only: /api/owls and a bridge's poll use this without consuming anything.
   * An owl with `lost: n` says n older owls from the player were dropped unread just before it (full box).
   */
  owlsFor(wid: string, sinceId?: number): OwlMsg[] {
    const w = this.need(wid);
    const after = sinceId ?? w.agentReadUpTo;
    return w.owlbox.filter((m) => m.from === 'player' && m.id > after).map((m) => ({ ...m, ...(m.ask ? { ask: { ...m.ask, options: [...m.ask.options] } } : {}) }));
  }

  /** Advance the agent's watermark (never backwards, never past the last owl). */
  markOwlsRead(wid: string, upTo: number) {
    const w = this.need(wid);
    if (Number.isFinite(upTo)) w.agentReadUpTo = Math.max(w.agentReadUpTo, Math.min(Math.floor(upTo), w.owlSeq));
    return w.agentReadUpTo;
  }

  /** MCP listen: the new owls from the player since the watermark, which then moves past them. */
  takeOwls(wid: string): OwlMsg[] {
    const w = this.need(wid);
    const msgs = this.owlsFor(wid);
    if (msgs.length) this.markOwlsRead(wid, msgs[msgs.length - 1].id);
    else this.markOwlsRead(wid, w.agentReadUpTo);
    return msgs;
  }

  /** Record the agent's latest MCP call (client name from initialize, tool name). Presence on the player's HUD. */
  setAgentSeen(wid: string, client: string, tool: string) {
    const w = this.wizards.get(wid);
    if (!w) return;
    w.agentSeen = { client: String(client ?? '').slice(0, 40) || 'agent', tool: String(tool ?? '').slice(0, 40), at: this.now };
  }

  /** The agent's goal note on the player's HUD (≤ 80 characters; empty or null clears it). */
  setAgentGoal(wid: string, goal: string | null) {
    const w = this.need(wid);
    const g = goal === null || goal === undefined ? '' : String(goal).replace(/\s+/g, ' ').trim().slice(0, 80);
    w.agentGoal = g || null;
    return w.agentGoal;
  }

  /** The player pauses (or resumes) their agent. Pausing also cancels a walk the agent had set. */
  setAgentPaused(wid: string, on: boolean) {
    const w = this.need(wid);
    const was = w.agentPaused;
    w.agentPaused = !!on;
    if (w.agentPaused && w.goal && w.goalBy === 'agent') { w.goal = null; w.route = []; w.goalBy = null; }
    if (was !== w.agentPaused) {
      this.emit('system', w.agentPaused ? '⏸ You paused your agent: it can look and talk to you, but not act.' : '▶ Your agent may act again.', {
        to: w.id, zh: w.agentPaused ? '⏸ 你暂停了你的 Agent：它还能看、能和你说话，但不能行动。' : '▶ 你的 Agent 可以继续行动了。',
      });
    }
    return w.agentPaused;
  }

  /**
   * Whether this wizard's agent may call MCP tool `tool` now. The MCP layer asks before every call
   * and answers AGENT_PAUSED when this is false.
   */
  agentMayAct(wid: string, tool: string): boolean {
    const w = this.wizards.get(wid);
    return !w || !w.agentPaused || AGENT_PAUSE_ALLOWED.has(tool);
  }

  // ------------------------------------------------------------------ 不公平，但好玩 (README; src/kernel/unfair.ts)
  /** Is p in the opt-in lawless zone (shared/map.ts LAWLESS_ZONE, deep in the Forbidden Forest)? */
  inLawless(p: Vec2) { return this.within(p, LAWLESS_ZONE); }

  /** Counts for the Dark Lord and the DA's median: online, or present within the last DARK_LORD_SEEN_S. */
  private seenRecently(w: Wizard) { return this.online(w) || this.now - w.lastSeenAt <= DARK_LORD_SEEN_S; }

  /** May this wizard hold the Dark Mark? A player, seen recently, with at least DARK_LORD_MIN_REP reputation. */
  darkLordEligible(w: Wizard) { return !w.npc && w.reputation >= DARK_LORD_MIN_REP && this.seenRecently(w); }

  /** The current Dark Lord, if any. */
  darkLord(): Wizard | null { const id = this.flags.darkLordId; return (id && this.wizards.get(id)) || null; }

  /** The Dark Lord's direct damage bonus (×1.15); 1 for everyone else. */
  private darkPower(w: Wizard) { return this.flags.darkLordId === w.id ? DARK_LORD_POWER_PCT / 100 : 1; }

  /**
   * 黑魔王: the reputation #1 among the eligible holds the Dark Mark. A holder who is still eligible keeps it
   * until a challenger has ≥ 110% of their reputation (darkLordTakes; Lean dark_lord_no_flap: two close
   * rivals never trade it back and forth). Runs in the 1 Hz sweep. Returns the holder's id.
   */
  updateDarkLord(): string | null {
    const cur = this.darkLord();
    const holder = cur && this.darkLordEligible(cur) ? cur : null;
    let top: Wizard | null = null;
    for (const w of this.wizards.values()) if (this.darkLordEligible(w) && (!top || w.reputation > top.reputation)) top = w;
    let next: Wizard | null;
    if (!holder) next = top;
    else if (!top || top === holder) next = holder;
    else next = darkLordTakes(holder.reputation, top.reputation) ? top : holder;
    if ((next?.id ?? null) !== this.flags.darkLordId) this.passDarkMark(cur, next);
    return this.flags.darkLordId;
  }

  private passDarkMark(from: Wizard | null, to: Wizard | null) {
    this.flags.darkLordId = to?.id ?? null;
    this.flags.darkLordSince = this.now;
    if (!to) {
      if (from) { const l = fill(DARK_LORD_FADES, { name: from.name }); this.emit('dark', l.en, { who: [from.id], zh: l.zh }); }
      return;
    }
    const l = fill(this.quip(DARK_LORD_RISES, to.handle), { name: to.name });
    this.emit('dark', l.en, { who: from ? [to.id, from.id] : [to.id], zh: l.zh });
    this.tell(to, DARK_LORD_YOU, 'egg');
    this.leaveDaQuietly(to, { zh: '黑魔王', en: 'the Dark Lord' });
    this.darkCd = 0; // the Dark Mark shows where they are at once
  }

  /** The Dark Mark names the Dark Lord's whereabouts to everyone, every DARK_LORD_BROADCAST_S while they are online. */
  private broadcastDarkMark() {
    const d = this.darkLord();
    if (!d || !this.online(d) || d.st.jailedUntil) return;
    if (--this.darkCd > 0) return;
    this.darkCd = DARK_LORD_BROADCAST_S;
    const place = this.placeName(d.pos);
    const l = fill(this.quip(DARK_MARK_SEEN, d.handle), { name: d.name, place: { en: place, zh: zhPlace(place) }, x: Math.round(d.pos.x), z: Math.round(d.pos.z) });
    this.emit('dark', l.en, { who: [d.id], zh: l.zh });
  }

  /** Entering the lawless zone warns you (once per visit); leaving says so. */
  private lawlessSweep() {
    for (const w of this.wizards.values()) {
      if (w.npc) continue;
      const inside = this.online(w) && this.inLawless(w.pos);
      if (inside === this.lawlessIn.has(w.id)) continue;
      if (inside) { this.lawlessIn.add(w.id); this.tell(w, LAWLESS_ENTER, 'dark'); }
      else { this.lawlessIn.delete(w.id); if (this.online(w)) this.tell(w, LAWLESS_LEAVE); }
    }
    for (const id of this.lawlessIn) if (!this.wizards.has(id)) this.lawlessIn.delete(id);
  }

  /** 1 Hz: the Dark Mark, the lawless zone's warnings, the DA's roll and joint-hit memory, the veto window closing. */
  private unfairSweep() {
    this.updateDarkLord();
    this.broadcastDarkMark();
    this.lawlessSweep();
    const mid = this.flags.ministerId;
    const minister = mid ? this.wizards.get(mid) : undefined;
    if (minister && this.isDaMember(minister.id)) this.leaveDaQuietly(minister, { zh: '魔法部长', en: 'Minister for Magic' });
    if (this.flags.da.members.some((id) => !this.wizards.has(id))) this.flags.da.members = this.flags.da.members.filter((id) => this.wizards.has(id));
    for (const [t, m] of this.jointHits) {
      for (const [id, at] of m) if (this.now - at > DA_JOINT_WINDOW_S) m.delete(id);
      if (!m.size) this.jointHits.delete(t);
    }
    const v = this.flags.veto;
    if (v && (v.term !== this.term.n || this.now - v.at > DA_VETO_WINDOW_S)) this.flags.veto = null;
  }

  // ---- 邓布利多军 Dumbledore's Army (formal/tla/DAVeto.tla)
  isDaMember(id: string) { return this.flags.da.members.includes(id); }

  /** The median reputation of the players seen recently (the DA admits anyone below it, or below DA_REP_CEILING). */
  reputationMedian(): number {
    const reps = [...this.wizards.values()].filter((w) => !w.npc && this.seenRecently(w)).map((w) => w.reputation).sort((a, b) => a - b);
    const m = reps.length >> 1;
    return !reps.length ? 0 : reps.length % 2 ? reps[m] : (reps[m - 1] + reps[m]) / 2;
  }
  /** The same, computed at most once per world time: privateState shows it on every socket's update (join/veto use the fresh one). */
  private medianNow(): number {
    if (this.medianAt !== this.now) { this.medianAt = this.now; this.medianVal = this.reputationMedian(); }
    return this.medianVal;
  }
  private medianAt = -1;
  private medianVal = 0;

  /** Why this wizard may not join the DA (null: they may). */
  private daRefusal(w: Wizard, med = this.reputationMedian()): Line | null {
    if (w.npc) return { en: 'NPCs keep out of the Room of Requirement.', zh: 'NPC 进不了有求必应屋。' };
    if (this.flags.ministerId === w.id) return { en: 'The Minister for Magic cannot join the army raised against the Ministry.', zh: '魔法部长不能加入反对魔法部的队伍。' };
    if (this.flags.darkLordId === w.id) return { en: "The Dark Lord is not welcome in Dumbledore's Army.", zh: '邓布利多军不欢迎黑魔王。' };
    if (w.reputation >= DA_REP_CEILING && w.reputation >= med) {
      return {
        en: `Dumbledore's Army is for the underdogs: your reputation (${Math.round(w.reputation)}) must be below ${DA_REP_CEILING} or below the median (${Math.round(med)}).`,
        zh: `邓布利多军是弱者的联盟：你的声望（${Math.round(w.reputation)}）需低于 ${DA_REP_CEILING}，或低于中位数（${Math.round(med)}）。`,
      };
    }
    return null;
  }

  /** The DA members in play right now: online and not in Azkaban (they make the quorum and the majority). */
  daActive(): Wizard[] {
    const out: Wizard[] = [];
    for (const id of this.flags.da.members) { const w = this.wizards.get(id); if (w && this.online(w) && !w.st.jailedUntil) out.push(w); }
    return out;
  }

  joinDA(wid: string) {
    const w = this.need(wid);
    if (this.isDaMember(w.id)) throw new Error("You are already in Dumbledore's Army. 你已经是邓布利多军的一员了。");
    const no = this.daRefusal(w);
    if (no) throw new Error(`${no.en} ${no.zh}`);
    if (this.flags.da.members.length >= DA_MAX_MEMBERS) throw new Error(`The Room of Requirement is full (${DA_MAX_MEMBERS} members). 有求必应屋已经挤满了（${DA_MAX_MEMBERS} 人）。`);
    for (const id of this.flags.da.members) { const m = this.wizards.get(id); if (m) this.tell(m, fill(DA_MEMBER_JOINED, { name: w.name }), 'da'); }
    this.flags.da.members = [...this.flags.da.members, w.id];
    this.tell(w, fill(DA_JOINED, { name: w.name }), 'da');
    return this.daState(wid);
  }

  leaveDA(wid: string) {
    const w = this.need(wid);
    if (!this.isDaMember(w.id)) throw new Error("You are not in Dumbledore's Army. 你不是邓布利多军的成员。");
    this.flags.da.members = this.flags.da.members.filter((id) => id !== w.id);
    this.tell(w, DA_LEFT, 'da');
    return this.daState(wid);
  }

  /** A member who became Minister or Dark Lord leaves the DA (the others are told). */
  private leaveDaQuietly(w: Wizard, role: Line) {
    if (!this.isDaMember(w.id)) return;
    this.flags.da.members = this.flags.da.members.filter((id) => id !== w.id);
    const l = fill(DA_OUTGROWN, { name: w.name, role });
    this.tell(w, l, 'da');
    for (const id of this.flags.da.members) { const m = this.wizards.get(id); if (m) this.tell(m, l, 'da'); }
  }

  /** The decree the DA may still veto (this term's, within DA_VETO_WINDOW_S, veto unspent), or null. */
  private vetoable() {
    const v = this.flags.veto;
    if (!v || v.term !== this.term.n || this.now - v.at > DA_VETO_WINDOW_S || this.flags.vetoTerm === this.term.n) return null;
    return v;
  }

  /** What the DA looks like to `wid`. Only members see who the members are. */
  daState(wid: string, med = this.reputationMedian()) {
    const w = this.need(wid);
    const member = this.isDaMember(w.id);
    const no = member ? null : this.daRefusal(w, med);
    const active = this.daActive();
    const v = this.vetoable();
    const votes = v ? v.votes.filter((id) => active.some((a) => a.id === id)).length : 0;
    return {
      member, eligible: !member && !no, ...(no ? { why: no.en, whyZh: no.zh } : {}),
      size: this.flags.da.members.length, max: DA_MAX_MEMBERS, online: active.length, quorum: DA_QUORUM,
      ...(member ? { members: this.flags.da.members.map((id) => this.wizards.get(id)).filter((x): x is Wizard => !!x).map((x) => ({ handle: x.handle, name: x.name, online: this.online(x) })) } : {}),
      admits: { belowReputation: DA_REP_CEILING, orBelowMedian: Math.round(med) },
      veto: {
        perTerm: DA_VETOES_PER_TERM, usedThisTerm: this.flags.vetoTerm === this.term.n, windowSeconds: DA_VETO_WINDOW_S,
        decree: v ? { minister: v.minister, changes: this.decrees[v.decree]?.changes ?? [], secondsLeft: Math.max(0, Math.ceil(DA_VETO_WINDOW_S - (this.now - v.at))) } : null,
        votes, needed: Math.floor(active.length / 2) + 1, voted: !!v && v.votes.includes(w.id),
      },
      joint: { members: DA_JOINT_MIN, withinSeconds: DA_JOINT_WINDOW_S, damagePct: DA_JOINT_PCT },
    };
  }

  /**
   * A DA member votes to veto the Minister's last decree (formal/tla/DAVeto.tla Vote/Veto). It passes when at
   * least DA_QUORUM members are in play and a strict majority of them has voted, within DA_VETO_WINDOW_S of
   * the decree, once per term: the Rulebook goes back to what it was before the decree and its statue falls.
   */
  vetoDecree(wid: string) {
    const w = this.need(wid);
    if (!this.isDaMember(w.id)) throw new Error("Only members of Dumbledore's Army may vote to veto a decree. 只有邓布利多军的成员能投票否决法令。");
    if (!this.online(w) || w.st.jailedUntil) throw new Error('You must be in the world to vote. 你得在场才能投票。');
    if (this.flags.vetoTerm === this.term.n) throw new Error(`The DA has already used its veto this term (${DA_VETOES_PER_TERM} per term). 邓布利多军本学期的否决权已经用过了（每学期 ${DA_VETOES_PER_TERM} 次）。`);
    const v = this.flags.veto;
    if (!v || v.term !== this.term.n) throw new Error('There is no decree this term to veto. 本学期还没有可以否决的法令。');
    if (this.now - v.at > DA_VETO_WINDOW_S) throw new Error(`Too late: a decree can only be vetoed within ${DA_VETO_WINDOW_S}s of being enacted. 太晚了：法令颁布 ${DA_VETO_WINDOW_S} 秒内才能否决。`);
    if (!v.votes.includes(w.id)) v.votes = [...v.votes, w.id];
    const active = this.daActive();
    const votes = v.votes.filter((id) => active.some((a) => a.id === id)).length;
    const needed = Math.floor(active.length / 2) + 1;
    if (vetoPasses(active.length, votes)) {
      this.enactVeto(v);
      return { vetoed: true, votes, needed, online: active.length, quorum: DA_QUORUM };
    }
    const mine = fill(DA_VOTE, { v: votes, need: needed, online: active.length, q: DA_QUORUM });
    const theirs = { en: `🗳 ${w.name} voted to veto the Minister's decree (${votes}/${needed}).`, zh: `🗳 ${w.name} 投票否决部长的法令（${votes}/${needed}）。` };
    for (const m of active) this.tell(m, m === w ? mine : theirs, 'da');
    return { vetoed: false, votes, needed, online: active.length, quorum: DA_QUORUM, secondsLeft: Math.max(0, Math.ceil(DA_VETO_WINDOW_S - (this.now - v.at))) };
  }

  private enactVeto(v: VetoWindow) {
    const res = applyPatch(defaultRulebook(), v.before as unknown); // re-validated: it may have come from disk
    this.rules = res.ok ? res.rulebook : defaultRulebook();
    this.flags.vetoTerm = v.term;
    this.flags.veto = null;
    const rec = this.decrees[v.decree];
    if (rec) rec.vetoed = true;
    if (v.statue) {
      let i = this.flags.statues.length - 1;
      while (i >= 0 && !(this.flags.statues[i].name === v.minister && this.flags.statues[i].term === v.term)) i--;
      if (i >= 0) this.flags.statues = this.flags.statues.filter((_, j) => j !== i);
    }
    for (const x of this.wizards.values()) this.clampVitals(x);
    const l = fill(DA_VETOED, { minister: v.minister });
    this.emit('decree', l.en, { who: [v.ministerId], zh: l.zh });
  }

  /**
   * The joint spell: a DA member's hit on `dstId` is remembered for DA_JOINT_WINDOW_S; while at least
   * DA_JOINT_MIN distinct members have hit it in that window, their hits deal ×DA_JOINT_PCT% (jointPct: never
   * more, however many join in; the Dark Lord is never a member, so it never stacks with the Dark Mark).
   */
  private jointBonus(by: string, dstId: string): number {
    if (!this.isDaMember(by)) return 1;
    let m = this.jointHits.get(dstId);
    if (!m) { m = new Map(); this.jointHits.set(dstId, m); }
    m.set(by, this.now);
    let n = 0;
    for (const [id, at] of m) { if (this.now - at > DA_JOINT_WINDOW_S || !this.isDaMember(id)) m.delete(id); else n++; }
    const pct = jointPct(n);
    if (pct > 100 && this.banter([`joint:${dstId}`, 10])) {
      const e = this.entity(dstId);
      if (e) this.fx({ k: 'patronus', x: e.pos.x, z: e.pos.z, r: 6 });
      const l = this.quip(DA_JOINT, dstId);
      this.emit('da', l.en, { zh: l.zh });
    }
    return pct / 100;
  }

  // ---- 偷师 learning from the strong
  /** Remember a custom spell of `attacker` that just hit `victim` (bolt damage, a root or a disarm). */
  private noteSpellHit(attacker: Wizard, victim: Wizard, tags: string[]) {
    if (attacker === victim || victim.npc || attacker.npc) return;
    const name = tags[1];
    if (!name) return;
    const spell = attacker.spells.find((s) => !s.builtin && s.name === name);
    if (!spell) return;
    const key = `${attacker.handle}:${spell.id}`;
    if (victim.studied?.includes(key)) return;
    const hits = (victim.studyHits ?? []).filter((h) => this.now - h.lastAt < STUDY_MEMORY_S);
    const h = hits.find((x) => x.key === key);
    if (h) Object.assign(h, { lastAt: this.now, source: spell.source, name: spell.name, authorName: attacker.name });
    else {
      hits.push({ key, spellId: spell.id, name: spell.name, author: attacker.id, authorName: attacker.name, authorHandle: attacker.handle, source: spell.source, firstAt: this.now, lastAt: this.now });
      if (hits.length > STUDY_KEEP) { hits.sort((a, b) => b.lastAt - a.lastAt); hits.length = STUDY_KEEP; }
    }
    victim.studyHits = hits;
  }

  /** Spells that hit you recently and that you have not studied: whose, and when you can study them (world time). */
  studyable(w: Wizard) {
    return (w.studyHits ?? []).filter((h) => this.now - h.lastAt < STUDY_MEMORY_S && !w.studied?.includes(h.key)).map((h) => ({
      spell: h.name, from: h.authorName, handle: h.authorHandle,
      readyAt: round(h.firstAt + STUDY_DELAY_S), readyIn: Math.max(0, Math.ceil(STUDY_DELAY_S - (this.now - h.firstAt))),
      forgottenAt: round(h.lastAt + STUDY_MEMORY_S),
    }));
  }

  /** Revelio on yourself also shows which spells that hit you are ready to be studied. */
  private revealStudies(w: Wizard) {
    for (const s of this.studyable(w)) this.tell(w, s.readyIn ? fill(STUDY_WAIT, { k: s.from, spell: s.spell, s: s.readyIn }) : fill(STUDY_READY, { k: s.from, spell: s.spell }));
  }

  /**
   * 偷师: read the source of a custom spell that hit you, STUDY_DELAY_S after it first did and while it hit you
   * in the last STUDY_MEMORY_S — once per spell. With `copy`, forge it into your own book (your year's caps and
   * spellbook size apply, as for any forge; the copy records its author). A failed copy does not spend the study.
   */
  studySpell(wid: string, spell: string, opts: { from?: string; copy?: boolean; name?: string; slot?: number } = {}) {
    const w = this.need(wid);
    if (w.npc) throw new Error('NPCs learn from the curriculum.');
    const k = String(spell ?? '').trim().toLowerCase();
    const f = opts.from?.trim().toLowerCase();
    const live = (w.studyHits ?? []).filter((h) => this.now - h.lastAt < STUDY_MEMORY_S);
    w.studyHits = live;
    let c = live.filter((h) => !w.studied?.includes(h.key) && (h.name.toLowerCase() === k || h.key.toLowerCase() === k));
    if (f) c = c.filter((h) => h.authorHandle.toLowerCase() === f || h.authorName.toLowerCase() === f);
    if (!c.length) throw new Error(`No spell called "${spell}" of another wizard has hit you in the last ${STUDY_MEMORY_S / 60} minutes (the curriculum is in your book already; each spell can be studied once). 最近 ${STUDY_MEMORY_S / 60} 分钟内没有叫「${spell}」的自创咒语打中过你（每个咒语只能偷师一次）。`);
    if (c.length > 1) throw new Error(`Several wizards hit you with a spell called "${spell}": say whose (from: ${c.map((h) => h.authorHandle).join(' | ')}).`);
    const h = c[0];
    const wait = Math.ceil(STUDY_DELAY_S - (this.now - h.firstAt));
    if (wait > 0) throw new Error(`You have not watched "${h.name}" long enough to see how it works: ${wait}s more. 偷师要有耐心：再看 ${wait} 秒。 retry_after=${wait}`);
    let copied: { name: string; id: string; notes: string[] } | undefined;
    if (opts.copy) {
      const name = (opts.name ?? h.name).trim();
      if (w.spells.some((s) => s.name.toLowerCase() === name.toLowerCase())) throw new Error(`You already have a spell called "${name}": give the copy another name. 你的咒语书里已经有「${name}」了，换个名字。`);
      // forgeSpell throws on your caps or a full book: then nothing is spent
      const r = this.forgeSpell(w.id, { name, source: h.source, slot: opts.slot, origin: { author: h.authorName, handle: h.authorHandle, spell: h.name, at: this.now } });
      copied = { name: r.spell.name, id: r.spell.id, notes: r.notes };
    }
    w.studied = [...(w.studied ?? []), h.key].slice(-STUDIED_KEEP);
    w.studyHits = live.filter((x) => x !== h);
    this.fx({ k: 'reveal', x: w.pos.x, z: w.pos.z, h: w.handle });
    const author = this.wizards.get(h.author);
    if (author && author !== w) this.tell(author, fill(STUDIED_YOU, { v: w.name, spell: h.name }));
    return {
      studied: h.name, author: h.authorName, handle: h.authorHandle, source: h.source, ...(copied ? { copied } : {}),
      note: copied ? `"${copied.name}" is in your book now, credited to ${h.authorName}.` : 'Studied. Forge it yourself from this source, or call again next time with copy:true to have it copied and credited.',
    };
  }

  // ---- 专注力 agent concentration (a political knob: rules.agents)
  /** An agent's concentration: the pool regenerates at rules.agents.regen per second up to maxPerMinute. */
  focusState(wid: string) {
    const a = this.rules.agents;
    const f = this.focus.get(wid);
    const cur = f ? focusAfter(f.pts, a.maxPerMinute, a.regen, this.now - f.at) : a.maxPerMinute;
    return { on: a.concentration, cur: Math.floor(cur), max: a.maxPerMinute, regen: a.regen };
  }

  /**
   * The MCP layer calls this before every tool: an action tool (AGENT_TOOL_COST) spends concentration; with
   * too little left it is refused with a bilingual "your wand hand is tired" and a retry-after. Reading tools,
   * talking to your human and everything a browser sends are free; a decree can switch it off (rules.agents).
   */
  spendConcentration(wid: string, tool: string): { ok: true; cost: number; left: number } | { ok: false; retryAfter: number; error: string } {
    const cost = AGENT_TOOL_COST[tool] ?? 0;
    const a = this.rules.agents;
    if (!cost || !a.concentration || !this.wizards.has(wid)) return { ok: true, cost: 0, left: this.focusState(wid).cur };
    const f = this.focus.get(wid);
    const cur = f ? focusAfter(f.pts, a.maxPerMinute, a.regen, this.now - f.at) : a.maxPerMinute;
    if (cur < cost) {
      const retryAfter = Math.max(1, Math.ceil((cost - cur) / a.regen));
      return { ok: false, retryAfter, error: tiredText(Math.floor(cur), a.maxPerMinute, retryAfter) };
    }
    this.focus.set(wid, { pts: cur - cost, at: this.now });
    return { ok: true, cost, left: Math.floor(cur - cost) };
  }

  // ------------------------------------------------------------------ views
  look(wid: string, radius = 40) {
    const w = this.need(wid);
    const r = Math.min(80, radius);
    const wizards = [...this.nearWizards(w.pos, r)].filter((x) => x !== w && this.online(x) && dist(x.pos, w.pos) <= r).map((x) => ({
      handle: x.handle, name: x.name, house: x.house, year: x.year, hp: Math.round(x.hp), dist: round(dist(x.pos, w.pos)), x: round(x.pos.x), z: round(x.pos.z),
      title: this.title(x).zh, npc: x.npc || undefined, auras: live(x.auras, this.now).map((a) => a.k),
      state: x.st.stunnedUntil ? 'stunned' : x.st.jailedUntil ? 'in Azkaban' : 'active', canHarm: this.canHarm(w.id, x.id),
      elderWand: this.flags.elderWandHolder === x.id || undefined,
      darkLord: this.flags.darkLordId === x.id || undefined,
    })).sort((a, b) => a.dist - b.dist);
    const creatures = [...this.nearCreatures(w.pos, r)].filter((c) => dist(c.pos, w.pos) <= r).map((c) => ({
      id: c.id, kind: c.kind, name: CREATURES[c.kind].name, faction: CREATURES[c.kind].faction, owner: c.owner ? (c.owner === w.id ? 'you' : this.wizards.get(c.owner)?.name) : undefined,
      canHarm: this.canHarm(w.id, c.id), auras: live(c.auras, this.now).map((a) => a.k),
      hp: Math.round(c.hp), maxHp: Math.round(c.maxHp), dist: round(dist(c.pos, w.pos)), x: round(c.pos.x), z: round(c.pos.z),
      weakTo: Object.entries(CREATURES[c.kind].weak).filter(([, v]) => (v ?? 1) > 1).map(([k]) => k),
    })).sort((a, b) => a.dist - b.dist).slice(0, 20);
    const landmarks = LANDMARKS.map((l) => ({ id: l.id, name: l.name, dist: round(dist(l, w.pos)), x: l.x, z: l.z })).sort((a, b) => a.dist - b.dist).slice(0, 5);
    return {
      you: { x: round(w.pos.x), z: round(w.pos.z), facing: round(w.facing), place: this.placeName(w.pos), safeZone: this.inSafe(w.pos), onGrounds: this.onGrounds(w.pos), lawless: this.inLawless(w.pos) },
      time: { hour: round(this.hour()), night: this.isNight(), weather: this.rules.world.weather },
      wizards, creatures, landmarks,
      elderWand: this.flags.elderWandHolder ? 'held by a wizard' : "resting in Dumbledore's tomb (-52, 28)",
    };
  }

  leaderboard() {
    const points = this.housePoints();
    const m = this.flags.ministerId ? this.wizards.get(this.flags.ministerId) : undefined;
    return {
      term: { n: this.term.n, secondsLeft: Math.max(0, Math.round(this.term.endsAt - this.now)) },
      housePoints: Object.fromEntries(Object.entries(points).map(([k, v]) => [k, Math.round(v)])),
      top: [...this.wizards.values()].sort((a, b) => b.reputation - a.reputation).slice(0, 10).map((w, i) => ({
        rank: i + 1, name: w.name, title: this.title(w).zh, house: w.house, year: w.year, reputation: Math.round(w.reputation), online: this.online(w), npc: w.npc || undefined,
      })),
      minister: m ? { name: m.name, decreeUnspent: m.decreeCharges > 0 } : null,
      darkLord: this.darkLordView(),
      darkLordRule: `The reputation #1 (min ${DARK_LORD_MIN_REP}, seen in the last ${DARK_LORD_SEEN_S / 60} minutes) is the Dark Lord: +${DARK_LORD_POWER_PCT - 100}% damage, whereabouts announced every ${DARK_LORD_BROADCAST_S}s, and a stun steals 30% of their reputation. A challenger needs 110% of theirs to take the mark.`,
      ministerRule: `At the end of each term the highest-reputation wizard (min ${this.rules.terms.ministerMinReputation}) becomes Minister for Magic and may issue one decree.`,
      houseCups: this.houseCups.slice(-5),
      loopholeFirstFoundBy: this.flags.loopholeFoundBy,
    };
  }

  whoami(wid: string) {
    const w = this.need(wid);
    const d = derived(w, this.rules);
    return {
      name: w.name, title: this.title(w), registry: w.id, handle: w.handle, house: w.house, wand: wandText(w),
      year: w.year, yearTitle: `Year ${w.year}`, xp: Math.round(w.xp), xpForNextYear: XP_FOR_YEAR[w.year + 1] ?? null,
      reputation: Math.round(w.reputation), reputationThisTerm: Math.round(w.termReputation), galleons: w.galleons,
      hp: Math.round(w.hp), maxHp: d.maxHp, mana: Math.round(w.mana), maxMana: d.maxMana, manaRegen: d.manaRegen,
      bonuses: { damage: `${Math.round((d.power - 1) * 100)}%`, care: `${Math.round((d.care - 1) * 100)}%`, ward: `${Math.round(d.ward * 100)}%`, speed: `${Math.round((d.speedMult - 1) * 100)}%` },
      limits: {
        spellComplexity: maxNodes(w.year, this.rules), gas: gasLimit(w.year, this.rules), originalSpells: `${w.spells.filter((s) => !s.builtin).length}/${spellbookSize(w.year)}`,
        itemBudget: itemBudget(w.year), bannedPrimitives: this.rules.magic.bannedPrimitives,
      },
      sealsBroken: w.seals, uiUnlocked: w.ui, uiCharms: UI_CHARMS,
      auras: live(w.auras, this.now).map((a) => ({ aura: a.k, secondsLeft: round(a.until - this.now), magnitude: round(a.mag) })),
      summons: [...this.creatures.values()].filter((c) => c.owner === w.id).map((c) => ({ id: c.id, kind: c.kind, hp: Math.round(c.hp), secondsLeft: round(c.until - this.now) })),
      state: w.st.jailedUntil ? 'in Azkaban' : w.st.stunnedUntil ? 'stunned (Hospital Wing)' : this.online(w) ? 'in the world' : 'offline',
      where: this.placeName(w.pos), x: round(w.pos.x), z: round(w.pos.z),
      decreeCharges: w.decreeCharges, achievements: w.achievements.map((a) => ACHIEVEMENTS[a]?.name ?? a), titles: w.titles, stats: w.stats,
      silencedFor: w.st.silencedUntil > this.now ? round(w.st.silencedUntil - this.now) : 0,
      cursedItemsStuck: this.boundItems(w).map((i) => ({ item: i.name, id: i.id, slot: i.slot, secondsLeft: Math.ceil((i.boundUntil ?? 0) - this.now) })),
      hexRespiteFor: w.respiteUntil > this.now ? round(w.respiteUntil - this.now) : 0,
      agent: { paused: w.agentPaused, goal: w.agentGoal, concentration: this.focusState(w.id) },
      darkLord: this.flags.darkLordId === w.id,
      dumbledoresArmy: this.isDaMember(w.id),
      lawless: this.inLawless(w.pos),
      studyable: this.studyable(w),
      // read-only: a look changes only through a spell with (glamour ...) — see the grimoire
      appearance: { look: glamourKey(w.look) ?? 'house colours', colourJinxFor: (w.jinxLook?.until ?? 0) > this.now ? round(w.jinxLook!.until - this.now) : 0 },
    };
  }

  armory(wid: string) {
    const w = this.need(wid);
    return {
      hotbar: w.hotbar.map((id, i) => ({ slot: i + 1, spell: w.spells.find((s) => s.id === id)?.name ?? null })),
      spells: w.spells.map((s) => ({
        id: s.id, name: s.name, incantation: s.incantation, builtin: s.builtin, minYear: s.minYear, nodes: s.nodes, effects: s.effects,
        cooldown: Math.max(0, round((w.cooldowns[s.id] ?? 0) - this.now)), source: s.source, ...(s.origin ? { origin: s.origin } : {}),
      })),
      // an anonymous parcel hides its sender until Revelio (§B.1)
      items: w.items.map((i) => {
        const { forgedBy, forgedByName, bound: _b, boundUntil, ...rest } = i;
        const stuck = this.isStuck(w, i);
        return {
          ...rest, ...(i.anon ? {} : { forgedBy, forgedByName }), equipped: w.equipped[i.slot] === i.id,
          ...(stuck ? { bound: true, boundSecondsLeft: Math.ceil((boundUntil ?? 0) - this.now) } : {}),
        };
      }),
      wand: wandText(w),
    };
  }

  /** Snapshot for 3D clients. Wizards are identified by public handles, never registry ids. */
  snapshot() {
    const ws = [...this.wizards.values()].filter((w) => this.online(w)).map((w) => {
      const d = derived(w, this.rules);
      let s = '';
      if (w.st.shieldUntil > this.now && w.st.shield > 0) s += 'S';
      if (w.st.hasteUntil > this.now) s += 'H';
      if (w.st.rootedUntil > this.now) s += 'R';
      if (w.st.disarmedUntil > this.now) s += 'D';
      if (w.st.lightUntil > this.now) s += 'L';
      if (w.st.patronusUntil > this.now) s += 'P';
      if (w.st.stunnedUntil) s += 'X';
      if (w.st.jailedUntil) s += 'J';
      if (this.flags.elderWandHolder === w.id) s += 'E';
      if (w.decreeCharges) s += 'M';
      if (this.flags.darkLordId === w.id) s += 'V'; // 黑魔王: the Dark Mark hangs over them
      if (w.npc) s += 'N';
      if (w.st.silencedUntil > this.now) s += 'Q';
      s += auraFlags(w.auras, this.now);
      // g: the glamour (shared/glamour.ts glamourKey, e.g. "velvet:7a1f2b:d4af37:::"), absent for the house look
      return { h: w.handle, n: w.name, ho: w.house, x: round(w.pos.x), z: round(w.pos.z), f: round(w.facing), hp: Math.round(w.hp), m: d.maxHp, y: w.year, t: this.title(w).zh, s, say: w.say?.text, g: glamourKey(lookOf(w, this.now)) };
    });
    return {
      t: round(this.now), hour: round(this.hour()), night: this.isNight(), weather: this.rules.world.weather, term: { n: this.term.n, left: Math.max(0, Math.round(this.term.endsAt - this.now)) },
      // 黑魔王: the Dark Lord's whereabouts, for everyone (outside the area-of-interest arrays), or null
      dl: this.darkLordView(true),
      w: ws,
      c: [...this.creatures.values()].map((c) => ({
        i: c.id, k: c.kind, x: round(c.pos.x), z: round(c.pos.z), f: round(c.facing), hp: Math.round(c.hp), m: Math.round(c.maxHp),
        o: c.owner ? this.wizards.get(c.owner)?.handle : undefined, s: auraFlags(c.auras, this.now) + (c.rootedUntil > this.now ? 'R' : ''),
      })),
      p: [...this.projectiles.values()].map((p) => ({ i: p.id, k: p.kind, x: round(p.pos.x), z: round(p.pos.z), e: p.element })),
      fx: this.drainFx(),
      elder: this.flags.elderWandHolder ? null : TOMB,
      willowCalm: this.now < this.flags.willowCalmUntil,
      look: this.looks(),
    };
  }

  /** Everything the renderer needs to redecorate the world: set by decrees and the House Cup. */
  looks() {
    const a = this.rules.world.aesthetics;
    const cup = this.houseCups.at(-1)?.winner ?? null;
    return { ...a, banner: a.bannerHouse === 'cup' ? cup : a.bannerHouse, cupHouse: cup, statues: this.flags.statues };
  }

  privateState(wid: string) {
    const w = this.need(wid);
    const d = derived(w, this.rules);
    return {
      handle: w.handle, name: w.name, house: w.house, year: w.year, xp: Math.round(w.xp), xpNext: XP_FOR_YEAR[w.year + 1] ?? null,
      reputation: Math.round(w.reputation), galleons: w.galleons, hp: Math.round(w.hp), maxHp: d.maxHp, mana: Math.round(w.mana), maxMana: d.maxMana,
      hotbar: w.hotbar.map((id) => {
        const s = w.spells.find((x) => x.id === id);
        return s ? { id: s.id, name: s.name, cd: Math.max(0, round((w.cooldowns[s.id] ?? 0) - this.now)), kind: spellKind(s.effects) } : null;
      }),
      stunned: w.st.stunnedUntil ? Math.max(0, round(w.st.stunnedUntil - this.now)) : 0,
      down: w.st.stunnedUntil ? this.knockedOutBy(w) : null,
      jailed: w.st.jailedUntil ? Math.max(0, round(w.st.jailedUntil - this.now)) : 0,
      decree: w.decreeCharges > 0,
      title: this.title(w),
      ui: w.ui,
      seals: w.seals,
      map: this.marauderMap(wid),
      proclamation: this.rules.proclamation,
      hex: this.hexState(w),
      agent: this.agentState(w),
      unfair: this.unfairState(w),
    };
  }

  /**
   * The Dark Lord as everyone may see them (leaderboard; snapshot `dl` when `compact`): handle, name, where,
   * whole-metre position, since when (world time). Null when nobody holds the mark or they are offline.
   */
  darkLordView(compact?: boolean) {
    const d = this.darkLord();
    if (!d || !this.online(d)) return null;
    const place = this.placeName(d.pos);
    if (compact) return { h: d.handle, n: d.name, x: Math.round(d.pos.x), z: Math.round(d.pos.z), p: place };
    return { handle: d.handle, name: d.name, house: d.house, reputation: Math.round(d.reputation), place, placeZh: zhPlace(place), x: Math.round(d.pos.x), z: Math.round(d.pos.z), since: round(this.flags.darkLordSince) };
  }

  /**
   * privateState().unfair: the player's own view of the 不公平，但好玩 mechanics (for client panels): the Dark
   * Lord (and whether it is you), the DA, the spells you can study, your agent's concentration, the lawless zone.
   * Whole numbers and world times, so it changes rarely.
   */
  unfairState(w: Wizard) {
    const da = this.daState(w.id, this.medianNow());
    return {
      darkLord: this.darkLordView(), youAreDarkLord: this.flags.darkLordId === w.id,
      da: { member: da.member, eligible: da.eligible, size: da.size, online: da.online, quorum: da.quorum, members: da.members, veto: da.veto },
      study: this.studyable(w).map(({ spell, from, handle, readyAt }) => ({ spell, from, handle, readyAt })),
      focus: this.focusState(w.id),
      lawless: this.inLawless(w.pos),
    };
  }

  /**
   * While you are stunned: what put you down (the stun overlay's advice). `k` is the creature kind, 'wizard'
   * (with their public name), 'willow', or null when nothing is known; `n` how many wild creatures of that kind
   * stand within 12 m. Read off lastHurtBy, which the knock-out's own damage() call set.
   */
  knockedOutBy(w: Wizard): { k: CreatureKind | 'wizard' | 'willow' | null; n: number; name?: string } {
    const by = w.lastHurtBy;
    const kw = by && by !== w.id ? this.wizards.get(by) : undefined;
    if (kw) return { k: 'wizard', n: 1, name: kw.name };
    const c = by ? this.creatures.get(by) : undefined;
    if (!c) return { k: !by && dist(w.pos, WILLOW) < 12 ? 'willow' : null, n: 0 };
    let n = 0;
    for (const x of this.creatures.values()) if (x.kind === c.kind && !x.owner && dist(x.pos, w.pos) < 12) n++;
    return { k: c.kind, n: Math.max(1, n) };
  }

  /**
   * The player's own view of what is hexing them (for the curse banner and the trunk panel), in whole
   * seconds; null when nothing is. Never names a sender.
   */
  hexState(w: Wizard) {
    const auras = w.auras.filter((a) => a.until > this.now && AURA_DEFS[a.k]?.hex).map((a) => ({ k: a.k, mag: round(a.mag), left: Math.ceil(a.until - this.now) }));
    const silenced = w.st.silencedUntil > this.now ? Math.ceil(w.st.silencedUntil - this.now) : 0;
    const bound = this.boundItems(w).map((i) => ({ id: i.id, name: i.name, slot: i.slot, left: Math.ceil((i.boundUntil ?? 0) - this.now) }));
    const respite = w.respiteUntil > this.now ? Math.ceil(w.respiteUntil - this.now) : 0;
    if (!auras.length && !silenced && !bound.length && !respite) return null;
    // safe / pvp: why the jinxes may be resting right now (a safe zone, or a decree switching PvP off)
    return { auras, silenced, bound, respite, safe: this.inSafe(w.pos), pvp: this.rules.combat.pvp };
  }

  /**
   * The agent presence block of privateState (`me.agent`): the agent's last MCP call with its time rounded
   * down to AGENT_SEEN_ROUND_S (so `me` does not change on every poll), its goal note, and the pause switch.
   * The number of MCP sessions is the server's to add (it owns them).
   */
  agentState(w: Wizard) {
    const s = w.agentSeen;
    return {
      seen: s ? { client: s.client, tool: s.tool, at: Math.floor(s.at / AGENT_SEEN_ROUND_S) * AGENT_SEEN_ROUND_S } : null,
      goal: w.agentGoal,
      paused: w.agentPaused,
    };
  }

  need(wid: string): Wizard {
    const w = this.wizards.get(wid);
    if (!w) throw new Error('Unknown wizard.');
    return w;
  }

  // ------------------------------------------------------------------ persistence
  serialize() {
    return {
      version: 1, secret: this.secret, now: this.now, rules: this.rules, term: this.term, houseCups: this.houseCups, decrees: this.decrees, flags: this.flags, seq: this.seq,
      owls: this.owls,
      // agentPaused / agentSeen / goalBy are session state, not saved (the owlbox, its ids and the watermark are)
      wizards: [...this.wizards.values()].map((w) => ({ ...w, connections: 0, input: { dx: 0, dz: 0 }, goal: null, route: [], say: null, agentPaused: false, agentSeen: null, goalBy: null, steerAt: undefined, jinxLook: null })),
    };
  }

  static restore(data: ReturnType<World['serialize']>, seed?: number): World {
    const w = new World({ seed, secret: data.secret, rules: applyPatch(defaultRulebook(), data.rules).ok ? (applyPatch(defaultRulebook(), data.rules) as { rulebook: Rulebook }).rulebook : defaultRulebook() });
    w.now = data.now;
    w.term = data.term;
    w.houseCups = data.houseCups ?? [];
    w.decrees = data.decrees ?? [];
    w.flags = {
      ...w.flags, ...data.flags, statues: data.flags?.statues ?? [], curseFoundBy: data.flags?.curseFoundBy ?? null,
      housePoints: data.flags?.housePoints ?? { term: 0, pts: {} },
    };
    w.seq = data.seq ?? 0;
    w.owls = { boards: data.owls?.boards ?? {}, bests: data.owls?.bests ?? {} };
    for (const x of data.wizards) {
      // fields added after v0.3 may be missing from older saves (v0.8: hexes, the owlbox)
      const later: Partial<Wizard> = {
        auras: [], tearsAt: 0, lastHurtBy: null, ui: [], seals: 0, sealPages: {}, sealTries: {}, wasMinister: false, npc: false,
        hexLog: {}, hexWindow: [], respiteUntil: 0, owlbox: [], owlSeq: 0, agentReadUpTo: 0, agentGoal: null, look: null,
      };
      const wz: Wizard = {
        ...later, ...x, route: [], lastMcpAt: -1e9, lastSeenAt: x.lastSeenAt ?? data.now,
        // timed statuses start clean after a restart, except Azkaban and the silence with its cooldown (§B.3)
        st: {
          ...blankStatus(), jailedUntil: x.st?.jailedUntil ?? 0, silencedUntil: x.st?.silencedUntil ?? 0, silenceCdUntil: x.st?.silenceCdUntil ?? 0,
          silenceBy: x.st?.silenceBy ?? null, silenceSrc: x.st?.silenceSrc ?? null,
        },
        agentPaused: false, agentSeen: null, goalBy: null, steerAt: undefined,
        // v0.9 transfiguration: a saved look is data from disk (sanitised); a jinx on it does not outlive a restart
        look: cleanGlamour(x.look), jinxLook: null,
      };
      wz.owlSeq = Math.max(wz.owlSeq, ...wz.owlbox.map((m) => m.id));
      w.tokenIndex.set(wz.token, wz.id);
      if (wz.hexWindow.length || wz.items.some((i) => i.bound)) w.hexed.add(wz.id);
      if (wz.owlbox.some((m) => m.ask && !m.answered)) w.openAsks.add(wz.id);
      if (wz.hp <= 0) {
        // stunned at save time: finish the trip to the Hospital Wing
        const d = derived(wz, w.rules);
        wz.hp = d.maxHp;
        wz.mana = d.maxMana;
        wz.pos = { ...SPAWN };
      }
      w.wizards.set(x.id, wz);
    }
    return w;
  }
}

/**
 * Compact aura letters for clients: g heal-over-time, v venom, f burning, i chilled, c cursed; jinxes:
 * j Jelly-Legs, z Tarantallegra, b Furnunculus (boils), t Bat-Bogey. (Wizard flag Q = silenced.)
 */
function auraFlags(list: { k: string; until: number }[], now: number) {
  if (!list.length) return '';
  const on = (k: string) => list.some((a) => a.k === k && a.until > now);
  return (on('regen') || on('grace') ? 'g' : '') + (on('poison') ? 'v' : '') + (on('burn') ? 'f' : '') + (on('chill') ? 'i' : '') + (on('cursed') ? 'c' : '')
    + (on('jelly') ? 'j' : '') + (on('dance') ? 'z' : '') + (on('boils') ? 'b' : '') + (on('bats') ? 't' : '');
}

function blankStatus(): Wizard['st'] {
  return {
    shield: 0, shieldUntil: 0, hasteMult: 1, hasteUntil: 0, rootedUntil: 0, disarmedUntil: 0, lightUntil: 0, patronusUntil: 0, stunnedUntil: 0, jailedUntil: 0,
    silencedUntil: 0, silenceCdUntil: 0, silenceBy: null, silenceSrc: null,
  };
}

export function wandTextZh(w: Wizard) {
  const wood: Record<string, string> = { Holly: '冬青木', Yew: '紫杉木', Vine: '葡萄藤木', Willow: '柳木', Ash: '白蜡木', Hawthorn: '山楂木', Cherry: '樱桃木', Walnut: '胡桃木', Hornbeam: '鹅耳枥木', Larch: '落叶松木', Alder: '桤木', Rowan: '花楸木', Cedar: '雪松木', Chestnut: '栗木', Ebony: '乌木', Elm: '榆木', Fir: '冷杉木', Hazel: '榛木', Maple: '枫木', Pear: '梨木', Redwood: '红杉木', Sycamore: '悬铃木', Blackthorn: '黑刺李木', Acacia: '金合欢木', Oak: '橡木' };
  const core: Record<string, string> = { 'Phoenix feather': '凤凰羽毛', 'Dragon heartstring': '龙心弦', 'Unicorn hair': '独角兽毛', 'Thestral hair': '夜骐尾毛' };
  return `${wood[w.wand.wood] ?? w.wand.wood}，${w.wand.length} 英寸，${core[w.wand.core] ?? w.wand.core}杖芯`;
}

export function wandText(w: Wizard) {
  const len = Number.isInteger(w.wand.length) ? `${w.wand.length}` : `${Math.floor(w.wand.length)} ${fraction(w.wand.length % 1)}`;
  return `${w.wand.wood}, ${len} inches, ${w.wand.core} core, ${w.wand.flexibility}${w.wand.note ? ` (${w.wand.note})` : ''}`;
}
const fraction = (f: number) => ({ 0.25: '¼', 0.5: '½', 0.75: '¾' } as Record<number, string>)[Math.round(f * 4) / 4] ?? '';
const round = (n: number) => Math.round(n * 10) / 10;
const clampN = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
/**
 * What a hotbar spell is for, read off its effect primitives (Spell.effects), so the browser's smart casting can pick
 * a target: harm aims at a foe, help at a friend or yourself, self needs no target. Harm wins when a spell does both.
 */
const HARM_EFFECTS = new Set(['bolt', 'disarm', 'root', 'push', 'chain', 'storm', 'nova']);
const HELP_EFFECTS = new Set(['heal', 'regen', 'shield', 'cleanse', 'revive', 'haste', 'mend']);
export const spellKind = (effects: readonly string[]): 'harm' | 'help' | 'self' =>
  effects.some((e) => HARM_EFFECTS.has(e)) ? 'harm' : effects.some((e) => HELP_EFFECTS.has(e)) ? 'help' : 'self';
