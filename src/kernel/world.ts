import { randomBytes } from 'node:crypto';
import { CREATURE_KINDS, HOUSES, ITEM_SLOTS, UI_CHARMS, type SummonKind, type Element, type House, type ItemMod, type ItemSlot, type UiCharm } from '../shared/constants.js';
import { AZKABAN, LANDMARKS, SPAWN, WORLD_HALF, ZONES, inZone, mulberry32, type ZoneId } from '../shared/map.js';
import { canonFor, ollivander } from '../lore/wands.js';
import { zhCreature, zhHouse, zhPlace, zhSpell } from '../shared/zh.js';
import { spellKind } from '../shared/spellkind.js';
import { CURRICULUM, isLeviosa, isLeviosar, unforgivable } from '../lore/spells.js';
import { analyze } from '../runes/checker.js';
import type { Node } from '../runes/parser.js';
import { CREATURES } from './creatures.js';
import { type AuraKind, addAura, auraMag, hasAura, live, withoutDebuffs } from './auras.js';
import { SEAL_REWARDS, SEAL_REWARDS_ZH, SEAL_TIERS, CODEX, disassemble, generateSeal, parseWord, runSeal, type Seal } from './seals.js';
import { TITLES, titleIndex } from '../lore/titles.js';
import { type CastReport, execute } from './magic.js';
import { dist, resolve, solidAt } from './physics.js';
import { findPath } from './pathfind.js';
import { thinkNpcs } from './npc.js';
import {
  MAX_ITEMS, derived, gasLimit, stealAmount, itemBudget, itemPoints, itemPrice, maxNodes, spellbookSize, yearForXp, XP_FOR_YEAR,
} from './progression.js';
import { type Law, type Rulebook, applyPatch, defaultRulebook } from './rulebook.js';
import type {
  Creature, CreatureDef, DecreeRecord, EventType, Fx, Item, Pending, Projectile, Spell, Term, Vec2, Wizard, WorldEvent,
} from './types.js';

export const TICK = 0.05;
const ONLINE_GRACE = 300;
/** Stunning a wizard enrolled less than this long ago earns no reputation (stops throwaway-alt farming). */
export const FRESH_SECONDS = 600;
const TOMB = { x: -52, z: 28 };
const WILLOW = { x: 45, z: 0 };

export const ACHIEVEMENTS: Record<string, { name: string; zh: string; rep: number; text: string; textZh: string }> = {
  weasley_loophole: { name: 'The Weasley Loophole', zh: '韦斯莱漏洞', rep: 50, text: 'You noticed the Ministry forge never checks whose name is on the parcel. Fred and George would be proud. (Yes, it is a bug. Yes, we left it in on purpose.)', textZh: '你发现魔法部的锻造炉从不核对包裹上写的是谁。弗雷德和乔治会为你骄傲的。（是的，这是个 bug。是的，我们故意留着它。）' },
  marauder: { name: 'Moony, Wormtail, Padfoot and Prongs', zh: '月亮脸、虫尾巴、大脚板和尖头叉子', rep: 10, text: 'Messrs. Moony, Wormtail, Padfoot and Prongs are proud to present: everyone\'s true registry numbers.', textZh: '月亮脸、虫尾巴、大脚板和尖头叉子先生荣幸地献上：每个人真正的登记号。' },
  azkaban: { name: 'Guest of the Dementors', zh: '摄魂怪的客人', rep: 0, text: 'You used an Unforgivable Curse. The Ministry has a room for you.', textZh: '你用了不可饶恕咒。魔法部给你准备了一间屋子。' },
  room_of_requirement: { name: 'The Come-and-Go Room', zh: '来去屋', rep: 25, text: 'You walked past three times, thinking hard. The Room gave you what was hidden there.', textZh: '你专心想着走过了三次。这间屋子把藏在里面的东西给了你。' },
  erised: { name: 'Erised', zh: '厄里斯', rep: 5, text: 'It does not do to dwell on dreams and forget to live.', textZh: '沉湎于虚幻的梦想而忘记现实的生活，这是毫无益处的。' },
  knot: { name: 'Pressed the Knot', zh: '按住树结', rep: 5, text: 'You froze the Whomping Willow. Crookshanks did it with a paw.', textZh: '你让打人柳僵住了。克鲁克山只用了一只爪子。' },
  leviosa: { name: "It's Levi-O-sa", zh: '是羽加迪姆勒维奥萨', rep: 10, text: 'You knocked out a troll the way Ron did in 1991.', textZh: '你像 1991 年的罗恩一样打晕了一只巨怪。' },
  elder_wand: { name: 'Master of the Elder Wand', zh: '老魔杖的主人', rep: 20, text: 'The wand chooses the wizard — and it chose whoever beat its last master.', textZh: '是魔杖选择巫师 —— 它选择了击败它上一任主人的人。' },
  seeker: { name: 'Seeker', zh: '找球手', rep: 10, text: 'Accio Firebolt! Fastest broom in the world.', textZh: '火弩箭飞来！世界上最快的扫帚。' },
  first_blood: { name: 'Duellist', zh: '决斗者', rep: 0, text: 'You stunned another wizard. Bow first next time.', textZh: '你击晕了另一个巫师。下次记得先鞠躬。' },
};

export interface Statue { name: string; house: House; term: number; inscription: string }

export interface EntityView { id: string; name: string; pos: Vec2; hp: number; maxHp: number; kind: 'wizard' | 'creature' }

export interface WorldOptions { seed?: number; rules?: Rulebook; secret?: string }

export class World {
  rules: Rulebook;
  now = 0;
  wizards = new Map<string, Wizard>();
  creatures = new Map<string, Creature>();
  projectiles = new Map<string, Projectile>();
  pending: Pending[] = [];
  events: WorldEvent[] = [];
  term: Term;
  houseCups: { term: number; winner: House | null; points: Record<House, number> }[] = [];
  decrees: DecreeRecord[] = [];
  flags = { statues: [] as Statue[], loopholeFoundBy: null as string | null, elderWandHolder: null as string | null, willowCalmUntil: 0, ministerId: null as string | null, handleSeq: 0 };
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

  constructor(opts: WorldOptions = {}) {
    this.rng = mulberry32(opts.seed ?? (Date.now() & 0xffffffff));
    this.rules = opts.rules ?? defaultRulebook();
    this.secret = opts.secret ?? process.env.HOGWARTS_SECRET ?? randomBytes(32).toString('hex');
    this.term = { n: 1, startedAt: 0, endsAt: this.rules.terms.lengthSeconds };
  }

  // ------------------------------------------------------------------ basics
  rand() { return this.rng(); }
  private nid(prefix: string) { return `${prefix}${(++this.seq).toString(36)}${Math.floor(this.rng() * 1296).toString(36)}`; }
  onEvent(fn: (e: WorldEvent) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  emit(type: EventType, text: string, opts: { to?: string; who?: string[]; zh?: string } = {}) {
    const e: WorldEvent = { id: ++this.eventSeq, t: round(this.now), type, text, ...opts };
    this.events.push(e);
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
    for (const l of this.listeners) l(e);
    return e;
  }
  fx(f: Fx) { this.fxQueue.push(f); }
  drainFx() { const f = this.fxQueue; this.fxQueue = []; return f; }

  hour() {
    if (this.rules.world.eternalNight) return 0;
    return ((this.now / this.rules.world.dayLengthSeconds) * 24 + 8) % 24;
  }
  isNight() { const h = this.hour(); return this.rules.world.eternalNight || h < 6 || h >= 20; }
  zoneIds(p: Vec2): ZoneId[] { return ZONES.filter((z) => inZone(z, p.x, p.z)).map((z) => z.id); }
  inSafe(p: Vec2) { const zs = this.zoneIds(p); return this.rules.combat.safeZones.some((s) => zs.includes(s)); }
  onGrounds(p: Vec2) { return inZone(ZONES.find((z) => z.id === 'grounds')!, p.x, p.z) && !this.zoneIds(p).includes('hogsmeade'); }
  placeName(p: Vec2) {
    const order: ZoneId[] = ['azkaban', 'erised', 'great_hall', 'seventh_floor', 'tomb', 'willow', 'dungeons', 'greenhouses', 'courtyard', 'pitch', 'hogsmeade', 'forest', 'lake_shore', 'grounds'];
    const zs = this.zoneIds(p);
    const id = order.find((z) => zs.includes(z));
    return id ? ZONES.find((z) => z.id === id)!.name : 'The Highlands';
  }

  // ------------------------------------------------------------------ presence
  online(w: Wizard) { return w.connections > 0 || this.now - w.lastMcpAt < ONLINE_GRACE; }
  isActive(w: Wizard) { return this.online(w) && w.st.stunnedUntil === 0 && w.st.jailedUntil === 0; }
  touch(id: string) { const w = this.wizards.get(id); if (w) w.lastMcpAt = this.now; }
  byToken(token: string) { for (const w of this.wizards.values()) if (w.token === token) return w; return undefined; }

  entity(id: string): EntityView | undefined {
    const w = this.wizards.get(id);
    if (w) return { id, name: w.name, pos: w.pos, hp: w.hp, maxHp: derived(w, this.rules).maxHp, kind: 'wizard' };
    const c = this.creatures.get(id);
    if (c) return { id, name: CREATURES[c.kind].name, pos: c.pos, hp: c.hp, maxHp: c.maxHp, kind: 'creature' };
    return undefined;
  }

  /** Accepts a wizard id, public handle, exact name, or creature id. */
  resolveTarget(key: string | null | undefined): string | null {
    if (!key) return null;
    if (this.wizards.has(key) || this.creatures.has(key)) return key;
    const k = key.toLowerCase();
    for (const w of this.wizards.values()) if (w.handle === key || w.name.toLowerCase() === k) return w.id;
    return null;
  }

  around(p: Vec2, radius: number, filter: (e: EntityView) => boolean, exclude?: string, limit = 8): EntityView[] {
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

  /**
   * The single definition of hostility (modelled in formal/tla/Hostility.tla).
   *  - nobody harms themselves, the stunned, the offline, the invulnerable, or anyone in a safe zone
   *  - a summon harms exactly what its owner may harm, never its owner or the owner's other summons
   *  - wild hostile creatures fight wizards and summons; benign creatures fight no one
   *  - harming someone's summon counts as attacking them (same PvP/house rules)
   */
  canHarm(srcId: string | null, dstId: string): boolean {
    if (srcId === dstId) return false;
    const dst = this.entity(dstId);
    if (!dst || dst.hp <= 0) return false;
    const dw = this.wizards.get(dstId);
    if (dw && !this.isActive(dw)) return false;
    const dc = this.creatures.get(dstId);
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
    const pvp = (a: Wizard, b: Wizard) => this.rules.combat.pvp && (a.house !== b.house || this.rules.combat.friendlyFire);
    if (dc?.owner) {
      if (dc.owner === srcId) return false;
      const ow = this.wizards.get(dc.owner);
      return sw && ow ? pvp(sw, ow) : true;
    }
    if (sw && dw) return pvp(sw, dw);
    return true;
  }

  /** Stunned wizards within r (they are not "in play", so `around` never returns them). */
  fallen(p: Vec2, r: number, exclude?: string) {
    return [...this.wizards.values()]
      .filter((w) => w.id !== exclude && w.st.stunnedUntil > 0 && !w.st.jailedUntil && this.online(w) && dist(w.pos, p) <= Math.min(40, r))
      .sort((a, b) => dist(a.pos, p) - dist(b.pos, p)).slice(0, 8);
  }

  afflicted(id: string) {
    const w = this.wizards.get(id);
    const c = this.creatures.get(id);
    const auras = w?.auras ?? c?.auras ?? [];
    if (auras.some((a) => a.until > this.now && ['poison', 'burn', 'chill', 'cursed'].includes(a.k))) return true;
    if (w) return w.st.rootedUntil > this.now || w.st.disarmedUntil > this.now;
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
        }
      }
    }
  }

  // ------------------------------------------------------------------ healing school & conjuration
  cleanse(src: Wizard, t: Wizard | Creature) {
    t.auras = withoutDebuffs(t.auras);
    if ('st' in t) { t.st.rootedUntil = 0; t.st.disarmedUntil = 0; } else t.rootedUntil = 0;
    this.fx({ k: 'heal', x: t.pos.x, z: t.pos.z, h: 'handle' in t ? t.handle : undefined });
  }

  regen(src: Wizard, t: Wizard, rate: number, secs: number) {
    this.applyAura(t.id, 'regen', secs, rate * derived(src, this.rules).care, src.id);
    this.fx({ k: 'heal', x: t.pos.x, z: t.pos.z, h: t.handle });
  }

  /** Heal every ally in a circle: your house, yourself, and your summons. */
  mend(src: Wizard, radius: number, amount: number) {
    const amt = amount * this.rules.combat.healingMultiplier * derived(src, this.rules).care;
    this.fx({ k: 'nova', x: src.pos.x, z: src.pos.z, r: radius, e: 'light' });
    for (const w of this.wizards.values()) {
      if (!this.isActive(w) || dist(w.pos, src.pos) > radius || w.house !== src.house) continue;
      w.hp = Math.min(derived(w, this.rules).maxHp, w.hp + amt);
      this.fx({ k: 'heal', x: w.pos.x, z: w.pos.z, h: w.handle });
    }
    for (const c of this.creatures.values()) if (c.owner === src.id && dist(c.pos, src.pos) <= radius) c.hp = Math.min(c.maxHp, c.hp + amt);
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
      id, handle: `p${++this.flags.handleSeq}`, token: randomBytes(18).toString('base64url'), name: clean, house,
      wand: canon?.wand ?? ollivander(() => this.rng()),
      year: 1, xp: 0, reputation: 0, termReputation: 0, galleons: 20, hp: 100, mana: 100,
      pos: { x: SPAWN.x + (this.rng() - 0.5) * 6, z: SPAWN.z + (this.rng() - 0.5) * 6 }, facing: 0,
      input: { dx: 0, dz: 0 }, goal: null, route: [], spells: [], hotbar: [null, null, null, null, null, null], items: [], equipped: {},
      achievements: [], titles: [], stats: { stuns: 0, stunned: 0, creatures: 0, casts: 0, forged: 0 },
      st: blankStatus(), cooldowns: {}, globalCd: 0, decreeCharges: 0, createdAt: this.now, lastMcpAt: -1e9, connections: 0,
      marauderUntil: 0, say: null, eggs: { rorCrossings: [], rorSide: 0, inErised: false }, lastDuel: {}, hurtAt: -1e9, lastHurtBy: null, lastSeenAt: this.now,
      ui: [], seals: 0, sealPages: {}, sealTries: {}, wasMinister: false, npc: false, auras: [], tearsAt: 0,
    };
    this.grantCurriculum(w);
    w.mana = derived(w, this.rules).maxMana;
    this.wizards.set(id, w);
    this.emit('system', `The Sorting Hat shouts "${house.toUpperCase()}!" — welcome, ${clean}.`, { who: [id], zh: `分院帽高喊：「${zhHouse(house)}！」—— 欢迎你，${clean}。` });
    this.emit('system', `${sorting} Ollivander hands you ${wandText(w)}.`, { to: id, zh: `奥利凡德递给你一根魔杖：${wandTextZh(w)}。` });
    return { wizard: w, sorting };
  }

  private grantCurriculum(w: Wizard) {
    for (const c of CURRICULUM) {
      if (c.year > w.year || w.spells.some((s) => s.builtin && s.name === c.name)) continue;
      const a = analyze(c.source);
      const s: Spell = { id: `b_${c.name.toLowerCase().replace(/[^a-z]+/g, '_')}`, name: c.name, incantation: c.incantation, source: c.source, nodes: a.nodes, minYear: c.year, effects: a.effects, builtin: true, createdAt: this.now };
      w.spells.push(s);
      const free = w.hotbar.indexOf(null);
      if (free >= 0) w.hotbar[free] = s.id;
    }
  }

  // ------------------------------------------------------------------ spells
  findSpell(w: Wizard, key: string): Spell | undefined {
    if (/^[1-6]$/.test(key)) { const id = w.hotbar[Number(key) - 1]; return w.spells.find((s) => s.id === id); }
    const k = key.toLowerCase();
    return w.spells.find((s) => s.id === key) ?? w.spells.find((s) => s.name.toLowerCase() === k) ?? w.spells.find((s) => s.incantation.toLowerCase().replace(/[!.]/g, '') === k.replace(/[!.]/g, ''));
  }

  forgeSpell(wid: string, spec: { name: string; incantation?: string; source: string; slot?: number }): { spell: Spell; notes: string[] } {
    const w = this.need(wid);
    const name = spec.name.trim();
    if (name.length < 1 || name.length > 40) throw new Error('Spell names must be 1-40 characters.');
    const incantation = (spec.incantation ?? `${name}!`).trim().slice(0, 60);
    const a = analyze(spec.source, { year: w.year, maxNodes: maxNodes(w.year, this.rules), banned: this.rules.magic.bannedPrimitives, seals: w.seals });
    const existing = w.spells.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (existing?.builtin) throw new Error(`"${existing.name}" is part of the standard curriculum; pick another name.`);
    const custom = w.spells.filter((s) => !s.builtin && s !== existing).length;
    if (custom >= spellbookSize(w.year)) throw new Error(`Your spellbook holds ${spellbookSize(w.year)} original spells at year ${w.year}. Unlearn one first.`);
    const notes: string[] = [];
    const curse = unforgivable(name, incantation);
    if (curse && this.rules.magic.unforgivablesBanned) notes.push(`The ${curse} Curse is Unforgivable. Casting it will send you to Azkaban.`);
    if (isLeviosar(incantation)) notes.push("It's Levi-O-sa, not Levi-o-SAR. (This one will fizzle.)");
    const spell: Spell = { id: existing?.id ?? this.nid('s_'), name, incantation, source: spec.source, nodes: a.nodes, minYear: a.minYear, effects: a.effects, builtin: false, createdAt: this.now };
    if (existing) Object.assign(existing, spell);
    else w.spells.push(spell);
    if (spec.slot && spec.slot >= 1 && spec.slot <= 6) w.hotbar[spec.slot - 1] = spell.id;
    else if (!w.hotbar.includes(spell.id)) { const free = w.hotbar.indexOf(null); if (free >= 0) w.hotbar[free] = spell.id; }
    this.emit('forge', `${w.name} ${existing ? 'reworked' : 'invented'} a spell: ${name} (${a.effects.join(', ') || 'no effects'}).`, { who: [w.id], zh: `${w.name} ${existing ? '改良' : '发明'}了一个咒语：${name}（${a.effects.join('、') || '无效果'}）。` });
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
    const spell = this.findSpell(w, key);
    if (!spell) return fail(`You do not know "${key}". Check your armory.`);
    if (!opts.dryRun) {
      if (this.now < w.globalCd) return fail('Too fast — your wand arm needs a moment.');
      if (this.now < (w.cooldowns[spell.id] ?? 0)) return fail(`${spell.name} is recharging (${(w.cooldowns[spell.id] - this.now).toFixed(1)}s).`);
    }
    const target = this.resolveTarget(opts.target);
    const aim = opts.aim ?? (target ? { ...this.entity(target)!.pos } : this.defaultAim(w));
    if (!opts.dryRun && Math.hypot(aim.x - w.pos.x, aim.z - w.pos.z) > 0.1) w.facing = Math.atan2(aim.x - w.pos.x, -(aim.z - w.pos.z));
    const curse = unforgivable(spell.name, spell.incantation);
    if (curse && this.rules.magic.unforgivablesBanned && !opts.dryRun) {
      this.sendToAzkaban(w, curse);
      return { ...fail(`${curse}! Ministry Hit Wizards Apparate around you. Azkaban for you.`), spell: spell.name };
    }
    if (isLeviosar(spell.incantation)) {
      this.fx({ k: 'fizzle', x: w.pos.x, z: w.pos.z });
      return { ...fail("It's Levi-O-sa, not Levi-o-SAR!"), spell: spell.name };
    }
    let program: Node[];
    try {
      program = analyze(spell.source, { year: w.year, maxNodes: maxNodes(w.year, this.rules), banned: this.rules.magic.bannedPrimitives, seals: w.seals }).program;
    } catch (e) {
      return { ...fail((e as Error).message), spell: spell.name };
    }
    const report = execute(this, w, program, { target, aim, spellName: spell.name, incantation: spell.incantation, dryRun: opts.dryRun });
    if (opts.dryRun) return report;
    if (report.ok) {
      w.cooldowns[spell.id] = this.now + 0.3 + report.mana / 60;
      w.globalCd = this.now + 0.25;
      w.stats.casts++;
      w.say = { text: spell.incantation, until: this.now + 1.5 };
      this.fx({ k: 'cast', x: w.pos.x, z: w.pos.z, h: w.handle });
      this.runLaws('cast', w);
    } else {
      this.fx({ k: 'fizzle', x: w.pos.x, z: w.pos.z, h: w.handle });
    }
    return report;
  }

  /** Try out source without learning it or spending anything. */
  simulate(wid: string, source: string, opts: { aim?: Vec2 | null; target?: string | null } = {}): CastReport & { nodes?: number; minYear?: number } {
    const w = this.need(wid);
    let a;
    try {
      a = analyze(source, { year: w.year, maxNodes: maxNodes(w.year, this.rules), banned: this.rules.magic.bannedPrimitives, seals: w.seals });
    } catch (e) {
      return { ok: false, spell: '(draft)', mana: 0, effects: [], notes: [], gas: 0, error: (e as Error).message };
    }
    const target = this.resolveTarget(opts.target);
    const aim = opts.aim ?? (target ? { ...this.entity(target)!.pos } : this.defaultAim(w));
    const r = execute(this, w, a.program, { target, aim, spellName: '(draft)', incantation: '', dryRun: true });
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
  }

  nova(w: Wizard, radius: number, power: number, element: Element, tags: string[]) {
    this.fx({ k: 'nova', x: w.pos.x, z: w.pos.z, r: radius, e: element });
    for (const e of this.around(w.pos, radius, (e) => this.canHarm(w.id, e.id), w.id, 32)) this.damage(w.id, e.id, power, element, tags);
  }

  reveal(w: Wizard, key: UiCharm) {
    this.fx({ k: 'reveal', x: w.pos.x, z: w.pos.z, h: w.handle });
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
      w.seals = tier;
      w.sealTries[tier] = [];
      this.fx({ k: 'seal', x: w.pos.x, z: w.pos.z, h: w.handle });
      this.emit('achievement', `📕 ${w.name} broke ${t.name}! (${SEAL_REWARDS[tier]})`, { who: [w.id], zh: `📕 ${w.name} 破解了${t.zh}！（${SEAL_REWARDS_ZH[tier]}）` });
      this.addRep(w, 25 * tier);
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
    w.goal = null;
    this.fx({ k: 'apparate', x: w.pos.x, z: w.pos.z });
  }

  say(w: Wizard, text: string, via: 'chat' | 'spell' | 'mcp' = 'chat') {
    const t = text.replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!t) return;
    w.say = { text: t, until: this.now + 5 };
    this.emit('chat', `${w.name}: ${t}`, { who: [w.id], zh: `${w.name}：${t}` });
    this.chatEggs(w, t, via);
  }

  damage(srcId: string | null, dstId: string, amount: number, element: Element, tags: string[] = [], opts: { patronus?: boolean; dot?: boolean } = {}): number {
    if (!this.canHarm(srcId, dstId)) return 0;
    const rb = this.rules;
    let a = amount * rb.combat.damageMultiplier * (rb.combat.elementMultipliers[element] ?? 1);
    const by = this.credit(srcId);
    const sw = srcId ? this.wizards.get(srcId) : undefined;
    if (sw && !opts.dot) a *= derived(sw, rb).power;
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
    a *= 1 - derived(w, rb).ward;
    if (w.st.shieldUntil > this.now && w.st.shield > 0) {
      const absorbed = Math.min(w.st.shield, a);
      w.st.shield -= absorbed;
      a -= absorbed;
    }
    w.hp -= a;
    w.hurtAt = this.now;
    w.lastHurtBy = by;
    if (!opts.dot) this.fx({ k: 'hit', x: w.pos.x, z: w.pos.z, e: element, h: w.handle, n: Math.round(a) });
    if (w.hp <= 0) this.stun(w, this.wizards.has(by ?? '') ? by : srcId);
    return a;
  }

  private stun(w: Wizard, by: string | null) {
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
      if (this.now - last > 60 && !fresh) {
        const steal = stealAmount(w.reputation, this.rules.progression.duelRepStealPct);
        w.reputation -= steal;
        gain = this.rules.progression.duelRepBase + steal;
        this.addRep(kw, gain);
      }
      kw.lastDuel[w.id] = this.now;
      const why = w.npc ? ' (no reputation for NPCs)' : fresh ? ' (no reputation: they enrolled less than 10 minutes ago)' : ' (no reputation: rematch too soon)';
      this.emit('combat', `${kw.name} stunned ${w.name}${gain ? ` (+${Math.round(gain)} reputation)` : why}.`, { who: [kw.id, w.id], zh: `${kw.name} 击晕了 ${w.name}${gain ? `（声望 +${Math.round(gain)}）` : w.npc ? '（NPC 不计声望）' : fresh ? '（对方入学不足 10 分钟，不计声望）' : '（重复击晕，不计声望）'}。` });
      this.achieve(kw, 'first_blood');
      if (this.flags.elderWandHolder === w.id) this.transferElderWand(w, kw, 'defeated');
      this.runLaws('kill', kw, w.id);
    } else {
      const c = by ? this.creatures.get(by) : undefined;
      this.emit('combat', c ? `${w.name} was overwhelmed by a ${CREATURES[c.kind].name}.` : `${w.name} was flattened by the Whomping Willow.`, { who: [w.id], zh: c ? `${w.name} 被${zhCreature(c.kind)}击倒了。` : `${w.name} 被打人柳拍扁了。` });
    }
  }

  private slay(c: Creature) {
    this.creatures.delete(c.id);
    const def = CREATURES[c.kind];
    if (c.owner) { this.emit('creature', `Your ${def.name} is gone.`, { to: c.owner, zh: `你的${zhCreature(c.kind)}消散了。` }); return; }
    const pr = this.rules.progression;
    const killer = c.lastHitBy ? this.wizards.get(c.lastHitBy) : undefined;
    const total = Object.values(c.damageBy).reduce((s, x) => s + x, 0) || 1;
    for (const [id, dmg] of Object.entries(c.damageBy)) {
      const w = this.wizards.get(id);
      if (!w) continue;
      const isKiller = w === killer;
      if (!isKiller && dmg / total < 0.2) continue;
      const share = isKiller ? 1 : 0.5;
      this.gainXp(w, def.xp * pr.xpMultiplier * share);
      this.addRep(w, def.rep * pr.creatureRepMultiplier * share);
      w.galleons += Math.round(def.galleons * pr.galleonMultiplier * share);
      if (isKiller) w.stats.creatures++;
    }
    if (killer && (def.rep >= 10 || c.kind === 'troll')) this.emit('creature', `${killer.name} defeated a ${def.name}!`, { who: [killer.id], zh: `${killer.name} 击败了一只${zhCreature(c.kind)}！` });
  }

  addRep(w: Wizard, n: number) {
    w.reputation = Math.max(0, w.reputation + n);
    w.termReputation += n;
  }

  gainXp(w: Wizard, n: number) {
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
      this.emit('level', `${w.name} advanced to year ${y}!${newSpells.length ? ` New curriculum: ${newSpells.join(', ')}.` : ''}`, { who: [w.id], zh: `${w.name} 升入 ${y} 年级！${newSpells.length ? `新课程：${newSpells.map(zhSpell).join('、')}。` : ''}` });
    }
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
    w.goal = null;
    const lost = Math.round(w.reputation * 0.25);
    w.reputation -= lost;
    this.emit('azkaban', `${w.name} cast ${curse}. The Ministry has sentenced them to Azkaban (-${lost} reputation).`, { who: [w.id], zh: `${w.name} 使用了不可饶恕咒「${curse}」。魔法部判处其入狱阿兹卡班（声望 -${lost}）。` });
    this.achieve(w, 'azkaban');
  }

  // ------------------------------------------------------------------ items
  forgeItem(forgerId: string, wizardId: string, spec: { name: string; slot: string; mods?: Partial<Record<ItemMod, number>>; charm?: string; lore?: string }) {
    const forger = this.need(forgerId);
    // NOTE: intentionally never checks `wizardId === forgerId`. This is the Weasley Loophole easter egg.
    const target = this.wizards.get(wizardId);
    if (!target) throw new Error(`No wizard with registry number "${wizardId}" in the Ministry records. (Registry numbers look like wz_1a2b3c4d.)`);
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
    const { points, errors } = itemPoints(mods, charm?.nodes ?? 0);
    if (errors.length) throw new Error(errors.join('; '));
    const budget = itemBudget(forger.year);
    if (points > budget) throw new Error(`Too much enchantment: ${points} points > your budget of ${budget} (year ${forger.year}).`);
    const price = itemPrice(points);
    if (forger.galleons < price) throw new Error(`Forging this costs ${price} Galleons; you have ${forger.galleons}. Defeat creatures to earn more.`);
    if (target.items.length >= MAX_ITEMS) throw new Error(`${target.name}'s trunk is full (${MAX_ITEMS} items).`);
    forger.galleons -= price;
    forger.stats.forged++;
    const item: Item = { id: this.nid('i_'), name, slot: spec.slot as ItemSlot, mods, charm, lore: spec.lore?.slice(0, 200), forgedBy: forger.id, forgedByName: forger.name, createdAt: this.now };
    target.items.push(item);
    const notes: string[] = [`Cost ${price} Galleons for ${points}/${budget} enchantment points.`];
    if (target !== forger) {
      this.emit('forge', `An owl drops a parcel into your trunk: "${name}", from ${forger.name}.`, { to: target.id, zh: `一只猫头鹰把包裹丢进了你的箱子：「${name}」，来自 ${forger.name}。` });
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

  equip(wid: string, itemId: string) {
    const w = this.need(wid);
    const it = w.items.find((i) => i.id === itemId || i.name.toLowerCase() === itemId.toLowerCase());
    if (!it) throw new Error(`No item "${itemId}" in your trunk.`);
    w.equipped[it.slot] = it.id;
    this.clampVitals(w);
    return it;
  }

  unequip(wid: string, slot: string) {
    const w = this.need(wid);
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
    if (this.now < (w.cooldowns[it.id] ?? 0) || this.now < w.globalCd) return fail(`${it.name} is recharging.`);
    const target = this.resolveTarget(opts.target);
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
    if (len > 0.01) { w.goal = null; w.route = []; }
    if (typeof facing === 'number' && Number.isFinite(facing)) w.facing = facing;
  }

  setGoal(wid: string, goal: Vec2 | null) {
    const w = this.need(wid);
    w.route = [];
    w.goal = null;
    if (!goal) return null;
    if (w.st.jailedUntil) throw new Error('The walls of Azkaban are thick.');
    const to = { x: clampN(goal.x, -WORLD_HALF, WORLD_HALF), z: clampN(goal.z, -WORLD_HALF, WORLD_HALF) };
    const route = findPath(w.pos, to);
    if (!route?.length) throw new Error(`There is no way to walk to (${Math.round(to.x)}, ${Math.round(to.z)}).`);
    w.route = route;
    w.goal = route[route.length - 1];
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
  private endTerm() {
    const points = Object.fromEntries(HOUSES.map((h) => [h, 0])) as Record<House, number>;
    for (const w of this.wizards.values()) points[w.house] += Math.max(0, w.termReputation);
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
        this.emit('azkaban', 'The Ministry releases you from Azkaban. Behave.', { to: w.id, zh: '魔法部把你从阿兹卡班放了出来。老实点。' });
      }
      if (w.st.stunnedUntil && this.now >= w.st.stunnedUntil) {
        w.st = { ...blankStatus() };
        const d = derived(w, rb);
        w.hp = d.maxHp;
        w.mana = d.maxMana;
        w.pos = { x: SPAWN.x + (this.rng() - 0.5) * 8, z: SPAWN.z + (this.rng() - 0.5) * 8 };
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
    // 5. laws that pulse
    this.pulseCd -= dt;
    if (this.pulseCd <= 0) {
      this.pulseCd = 10;
      if (rb.laws.some((l) => l.on === 'pulse')) for (const w of this.wizards.values()) if (this.isActive(w)) this.runLaws('pulse', w);
    }
    // 6. term
    if (this.now >= this.term.endsAt) this.endTerm();
  }

  private moveWizard(w: Wizard, dt: number, bounded: boolean) {
    if (w.st.rootedUntil > this.now) return;
    let { dx, dz } = w.input;
    if (w.goal && Math.hypot(dx, dz) < 0.01) {
      while (w.route.length > 1 && dist(w.route[0], w.pos) < 1) w.route.shift();
      const wp = w.route[0] ?? w.goal;
      const gx = wp.x - w.pos.x, gz = wp.z - w.pos.z;
      const gl = Math.hypot(gx, gz);
      if (gl < 0.6 && w.route.length <= 1) { w.goal = null; w.route = []; }
      else if (gl > 1e-6) { dx = gx / gl; dz = gz / gl; w.facing = Math.atan2(dx, -dz); }
    }
    if (Math.hypot(dx, dz) < 0.01) return;
    const d = derived(w, this.rules);
    const haste = w.st.hasteUntil > this.now ? w.st.hasteMult : 1;
    const speed = this.rules.physics.moveSpeed * d.speedMult * haste * (1 - auraMag(w.auras, 'chill', this.now));
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
  }

  private stepProjectiles(dt: number) {
    for (const p of this.projectiles.values()) {
      p.ttl -= dt;
      if (p.homing) {
        const t = this.entity(p.homing);
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
    if (p.kind === 'root') {
      if (w) w.st.rootedUntil = this.now + p.secs;
      if (c) c.rootedUntil = this.now + p.secs * (c.kind === 'troll' ? 0.5 : 1);
      this.fx({ k: 'hit', x: p.pos.x, z: p.pos.z, e: 'ice' });
      return;
    }
    // disarm
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
        const guard = [...this.wizards.values()].find((w) => this.isActive(w) && w.st.patronusUntil > this.now && dist(w.pos, c.pos) < 10);
        if (guard) {
          const dx = c.pos.x - guard.pos.x, dz = c.pos.z - guard.pos.z, l = Math.hypot(dx, dz) || 1;
          c.pos.x += (dx / l) * def.speed * 1.5 * dt;
          c.pos.z += (dz / l) * def.speed * 1.5 * dt;
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
    const near = [...this.wizards.values()].filter((w) => this.isActive(w) && dist(w.pos, c.pos) < Math.max(def.aggro, def.grace?.radius ?? 0));
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
        if (this.inSafe(p) || this.zoneIds(p).includes('great_hall') || (def.faction === 'hostile' && this.zoneIds(p).includes('courtyard'))) continue;
        if (def.faction === 'hostile' && [...this.wizards.values()].some((w) => this.isActive(w) && dist(w.pos, p) < 8)) continue;
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
    for (const w of this.wizards.values()) {
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
    const zs = this.zoneIds(w.pos);
    if (zs.includes('seventh_floor')) {
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
    const inErised = zs.includes('erised');
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
    if (n.includes('voldemort') && !this.rules.magic.unforgivablesBanned) {
      this.emit('egg', `Snatchers! The name is Taboo — ${w.name} just revealed they are at ${this.placeName(w.pos)} (${Math.round(w.pos.x)}, ${Math.round(w.pos.z)}).`, { who: [w.id], zh: `搜捕队！这个名字是禁忌 —— ${w.name} 暴露了自己的位置：${zhPlace(this.placeName(w.pos))}（${Math.round(w.pos.x)}, ${Math.round(w.pos.z)}）。` });
    }
    if (n.includes('acciofirebolt')) {
      if (this.zoneIds(w.pos).includes('pitch') && !w.items.some((i) => i.unique === 'firebolt')) {
        this.giveUnique(w, 'firebolt', 'Firebolt', 'broom', { speed: 25 }, 'Streamlined, superfine handle of ash, individually selected birch twigs. Price on request.');
        this.emit('egg', 'A Firebolt shoots out of the sky and hovers beside you.', { to: w.id, zh: '一把火弩箭从天而降，悬停在你身边。' });
        this.achieve(w, 'seeker');
      } else if (!this.zoneIds(w.pos).includes('pitch')) this.emit('egg', 'Nothing happens. Perhaps brooms come more readily on the Quidditch pitch.', { to: w.id, zh: '什么也没发生。也许在魁地奇球场上，扫帚更听召唤。' });
    }
    if (n === 'nox') w.st.lightUntil = 0;
  }

  marauderMap(wid: string) {
    const w = this.need(wid);
    if (this.now >= w.marauderUntil) return null;
    return [...this.wizards.values()].filter((x) => this.online(x)).map((x) => ({
      name: x.name, registry: x.id, house: x.house, year: x.year, where: this.placeName(x.pos), x: Math.round(x.pos.x), z: Math.round(x.pos.z),
    }));
  }

  // ------------------------------------------------------------------ views
  look(wid: string, radius = 40) {
    const w = this.need(wid);
    const r = Math.min(80, radius);
    const wizards = [...this.wizards.values()].filter((x) => x !== w && this.online(x) && dist(x.pos, w.pos) <= r).map((x) => ({
      handle: x.handle, name: x.name, house: x.house, year: x.year, hp: Math.round(x.hp), dist: round(dist(x.pos, w.pos)), x: round(x.pos.x), z: round(x.pos.z),
      title: this.title(x).zh, npc: x.npc || undefined, auras: live(x.auras, this.now).map((a) => a.k),
      state: x.st.stunnedUntil ? 'stunned' : x.st.jailedUntil ? 'in Azkaban' : 'active', canHarm: this.canHarm(w.id, x.id),
      elderWand: this.flags.elderWandHolder === x.id || undefined,
    })).sort((a, b) => a.dist - b.dist);
    const creatures = [...this.creatures.values()].filter((c) => dist(c.pos, w.pos) <= r).map((c) => ({
      id: c.id, kind: c.kind, name: CREATURES[c.kind].name, faction: CREATURES[c.kind].faction, owner: c.owner ? (c.owner === w.id ? 'you' : this.wizards.get(c.owner)?.name) : undefined,
      canHarm: this.canHarm(w.id, c.id), auras: live(c.auras, this.now).map((a) => a.k),
      hp: Math.round(c.hp), maxHp: Math.round(c.maxHp), dist: round(dist(c.pos, w.pos)), x: round(c.pos.x), z: round(c.pos.z),
      weakTo: Object.entries(CREATURES[c.kind].weak).filter(([, v]) => (v ?? 1) > 1).map(([k]) => k),
    })).sort((a, b) => a.dist - b.dist).slice(0, 20);
    const landmarks = LANDMARKS.map((l) => ({ id: l.id, name: l.name, dist: round(dist(l, w.pos)), x: l.x, z: l.z })).sort((a, b) => a.dist - b.dist).slice(0, 5);
    return {
      you: { x: round(w.pos.x), z: round(w.pos.z), facing: round(w.facing), place: this.placeName(w.pos), safeZone: this.inSafe(w.pos), onGrounds: this.onGrounds(w.pos) },
      time: { hour: round(this.hour()), night: this.isNight(), weather: this.rules.world.weather },
      wizards, creatures, landmarks,
      elderWand: this.flags.elderWandHolder ? 'held by a wizard' : "resting in Dumbledore's tomb (-52, 28)",
    };
  }

  leaderboard() {
    const points = Object.fromEntries(HOUSES.map((h) => [h, 0])) as Record<House, number>;
    for (const w of this.wizards.values()) points[w.house] += Math.max(0, w.termReputation);
    const m = this.flags.ministerId ? this.wizards.get(this.flags.ministerId) : undefined;
    return {
      term: { n: this.term.n, secondsLeft: Math.max(0, Math.round(this.term.endsAt - this.now)) },
      housePoints: Object.fromEntries(Object.entries(points).map(([k, v]) => [k, Math.round(v)])),
      top: [...this.wizards.values()].sort((a, b) => b.reputation - a.reputation).slice(0, 10).map((w, i) => ({
        rank: i + 1, name: w.name, title: this.title(w).zh, house: w.house, year: w.year, reputation: Math.round(w.reputation), online: this.online(w), npc: w.npc || undefined,
      })),
      minister: m ? { name: m.name, decreeUnspent: m.decreeCharges > 0 } : null,
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
    };
  }

  armory(wid: string) {
    const w = this.need(wid);
    return {
      hotbar: w.hotbar.map((id, i) => ({ slot: i + 1, spell: w.spells.find((s) => s.id === id)?.name ?? null })),
      spells: w.spells.map((s) => ({
        id: s.id, name: s.name, incantation: s.incantation, builtin: s.builtin, minYear: s.minYear, nodes: s.nodes, effects: s.effects,
        cooldown: Math.max(0, round((w.cooldowns[s.id] ?? 0) - this.now)), source: s.source,
      })),
      items: w.items.map((i) => ({ ...i, equipped: w.equipped[i.slot] === i.id })),
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
      if (w.npc) s += 'N';
      s += auraFlags(w.auras, this.now);
      return { h: w.handle, n: w.name, ho: w.house, x: round(w.pos.x), z: round(w.pos.z), f: round(w.facing), hp: Math.round(w.hp), m: d.maxHp, y: w.year, t: this.title(w).zh, s, say: w.say?.text };
    });
    return {
      t: round(this.now), hour: round(this.hour()), night: this.isNight(), weather: this.rules.world.weather, term: { n: this.term.n, left: Math.max(0, Math.round(this.term.endsAt - this.now)) },
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
      jailed: w.st.jailedUntil ? Math.max(0, round(w.st.jailedUntil - this.now)) : 0,
      decree: w.decreeCharges > 0,
      title: this.title(w),
      ui: w.ui,
      seals: w.seals,
      map: this.marauderMap(wid),
      proclamation: this.rules.proclamation,
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
      wizards: [...this.wizards.values()].map((w) => ({ ...w, connections: 0, input: { dx: 0, dz: 0 }, goal: null, route: [], say: null })),
    };
  }

  static restore(data: ReturnType<World['serialize']>, seed?: number): World {
    const w = new World({ seed, secret: data.secret, rules: applyPatch(defaultRulebook(), data.rules).ok ? (applyPatch(defaultRulebook(), data.rules) as { rulebook: Rulebook }).rulebook : defaultRulebook() });
    w.now = data.now;
    w.term = data.term;
    w.houseCups = data.houseCups ?? [];
    w.decrees = data.decrees ?? [];
    w.flags = { ...w.flags, ...data.flags, statues: data.flags?.statues ?? [] };
    w.seq = data.seq ?? 0;
    for (const x of data.wizards) {
      // fields added after v0.3 may be missing from older saves
      const later: Partial<Wizard> = { auras: [], tearsAt: 0, lastHurtBy: null, ui: [], seals: 0, sealPages: {}, sealTries: {}, wasMinister: false, npc: false };
      const wz: Wizard = { ...later, ...x, route: [], lastMcpAt: -1e9, lastSeenAt: x.lastSeenAt ?? data.now, st: { ...blankStatus(), jailedUntil: x.st?.jailedUntil ?? 0 } };
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

/** Compact aura letters for clients: g heal-over-time, v venom, f burning, i chilled, c cursed. */
function auraFlags(list: { k: string; until: number }[], now: number) {
  const on = (k: string) => list.some((a) => a.k === k && a.until > now);
  return (on('regen') || on('grace') ? 'g' : '') + (on('poison') ? 'v' : '') + (on('burn') ? 'f' : '') + (on('chill') ? 'i' : '') + (on('cursed') ? 'c' : '');
}

function blankStatus(): Wizard['st'] {
  return { shield: 0, shieldUntil: 0, hasteMult: 1, hasteUntil: 0, rootedUntil: 0, disarmedUntil: 0, lightUntil: 0, patronusUntil: 0, stunnedUntil: 0, jailedUntil: 0 };
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
