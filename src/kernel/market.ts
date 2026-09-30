/**
 * 咒语集市 — the spell market: spells as social objects.
 *
 * A wizard publishes one of their own spells (immutable versions v1, v2, … when they republish); anyone may copy
 * a market spell into their own book (their own year, seals, banned primitives and spellbook size apply, as for
 * any forge; a failed copy spends nothing) or fork it (copy + edit + publish as their own, with the parent kept
 * in its lineage). Unpublishing hides a listing but every copy keeps its attribution (`Spell.origin`, `Spell.market`).
 *
 * Royalties: when another wizard casts a market spell successfully, its author gains MARKET_AUTHOR_TENTHS/10
 * reputation — once per caster per spell per day — and a fork's parent author MARKET_PARENT_TENTHS/10; never from
 * NPCs or wizards enrolled less than FRESH_SECONDS ago, never to the caster themselves, and never more than
 * rules.market.dailyCap reputation a day per author. `royaltyStep` is the pure ledger step that Lean proves
 * bounded (formal/lean/Hogwarts.lean `royalty_*`) and prints vectors for (test/formal.test.ts).
 *
 * Politics: rules.market is part of the Rulebook, so the Minister's decree can ban a listing (every copy of it,
 * and any custom spell with the same words, fizzles for everyone; it can still be read) or promote it (the 推荐
 * shelf); Dumbledore's Army can veto that decree like any other. `sanitizeMarket` keeps promoted ⊆ published and
 * promoted ∩ banned = ∅ after every change (formal/tla/Market.tla).
 *
 * State (world.market) is persisted by serialize/restore; `restoreMarket` fills defaults for old saves.
 */
import {
  ELEMENTS, MARKET_ANNOUNCE_S, MARKET_ID_RE, MARKET_AUTHOR_TENTHS, MARKET_DAY_S, MARKET_DESC_MAX, MARKET_LEDGER_MAX, MARKET_MAX_LISTINGS, MARKET_MAX_PER_AUTHOR,
  MARKET_MAX_VERSIONS, MARKET_PARENT_TENTHS, type House,
} from '../shared/constants.js';
import {
  MARKET_BAN_NEWS, MARKET_BANNED_CAST, MARKET_COPIED_YOU, MARKET_DAILY, MARKET_FORKED_YOU, MARKET_PROMOTE_NEWS, MARKET_PUBLISHED, MARKET_REPUBLISHED,
  MARKET_UNBAN_NEWS, fill, type Line,
} from '../lore/memes.js';
import { z } from 'zod';
import type { Feature } from './feature.js';
import type { Rulebook } from './rulebook.js';
import type { Spell, Wizard } from './types.js';
import { FRESH_SECONDS } from '../shared/constants.js';
import type { World } from './world.js';

declare module './world.js' {
  interface World {
    /** 咒语集市 (this module's Feature): listings, their versions and lineage, the day's royalty ledger. Persisted. */
    market: MarketBook;
  }
}

// ------------------------------------------------------------------ state

/** One immutable version of a listing. */
export interface MarketVersion {
  v: number; name: string; incantation: string; source: string; nodes: number; minYear: number; effects: string[];
  /** effects, elements named in the source, and "delayed" for (after …) */
  tags: string[];
  desc: { zh: string; en: string } | null;
  at: number;
}
export interface MarketListing {
  id: string;
  /** Registry id of the author: server-side only (views show the name and handle). */
  author: string; authorName: string; authorHandle: string; house: House;
  /** The author's spell this listing was published from (republishing it adds a version). */
  spellId: string;
  versions: MarketVersion[];
  /** For a fork: the listing and version it was forked from (authorId server-side only). */
  parent: { id: string; v: number; authorId: string; author: string; handle: string; name: string } | null;
  hidden: boolean;
  publishedAt: number; updatedAt: number;
  /** Registry ids of the wizards who copied it (distinct, server-side only), and the ids of its forks. */
  copiers: string[]; forks: string[];
  /** Successful casts by other (eligible) wizards, and distinct (caster, day) pairs among them. */
  casts: number; casters: number;
  /** Galleons a copy or a fork costs (the author's price, 0..MARKET_PRICE_MAX); each wizard pays once per listing. */
  price?: number;
}
/** The day's royalty ledger: `${listing}|${caster}` -> tenths paid to the listing's author; author -> tenths earned. */
export interface RoyaltyLedger { paid: Record<string, number>; earned: Record<string, number> }
export interface RoyaltyDay extends RoyaltyLedger {
  day: number;
  size: number;
  /** author -> the distinct casters of their spells today (for the daily summary; ≤ 200 kept). */
  who: Record<string, string[]>;
}
export interface MarketBook {
  seq: number;
  listings: Record<string, MarketListing>;
  day: RoyaltyDay;
  /** author -> world time of their last public "new in the market" line. */
  announced: Record<string, number>;
}
const blankDay = (day: number): RoyaltyDay => ({ day, size: 0, paid: {}, earned: {}, who: {} });
export const blankMarket = (): MarketBook => ({ seq: 0, listings: {}, day: blankDay(0), announced: {} });

/** A saved market (or none, from a save older than the market): every field defaulted, nothing trusted blindly. */
export function restoreMarket(data: unknown): MarketBook {
  const m = blankMarket();
  if (!data || typeof data !== 'object') return m;
  const d = data as Partial<MarketBook>;
  m.seq = Number.isFinite(d.seq) ? Number(d.seq) : 0;
  for (const [id, l] of Object.entries(d.listings ?? {})) {
    if (!MARKET_ID_RE.test(id) || !l || !Array.isArray(l.versions) || !l.versions.length) continue;
    m.listings[id] = {
      ...l, id, parent: l.parent ?? null, hidden: !!l.hidden, copiers: Array.isArray(l.copiers) ? l.copiers : [], forks: Array.isArray(l.forks) ? l.forks : [],
      casts: l.casts ?? 0, casters: l.casters ?? 0,
    };
  }
  const day = d.day;
  if (day && typeof day === 'object') m.day = { ...blankDay(Number(day.day) || 0), ...day, paid: day.paid ?? {}, earned: day.earned ?? {}, who: day.who ?? {} };
  m.announced = d.announced ?? {};
  return m;
}

// ------------------------------------------------------------------ royalties (pure; Lean royaltyStep)

/** One successful cast of a market spell, as the ledger sees it. `npc`: the caster pays no royalty (an NPC, or freshly enrolled). */
export interface RoyaltyCast { spell: string; caster: string; author: string; parent: string | null; npc: boolean }
/** What may still be paid: `share`, or what is left under the cap (all in tenths). Lean `royaltyGrant`. */
export const royaltyGrant = (earned: number, share: number, capT: number) => Math.max(0, Math.min(share, capT - earned));

/**
 * The ledger step (Lean `royaltyStep`, mutating `d`): a cast pays nothing if the caster is not eligible, if nobody
 * but the caster could be paid, or if this (spell, caster) was already paid today; otherwise the pair is spent, the
 * author (unless it is the caster) gets up to MARKET_AUTHOR_TENTHS and a fork's parent author (unless it is the
 * caster or the author) up to MARKET_PARENT_TENTHS, each within `capT` tenths a day. Returns what was paid.
 */
export function royaltyStep(d: RoyaltyLedger, e: RoyaltyCast, capT: number): { author: number; parent: number; fresh: boolean } {
  const key = `${e.spell}|${e.caster}`;
  const toAuthor = e.caster !== e.author;
  const toParent = e.parent !== null && e.parent !== e.caster && e.parent !== e.author;
  if (e.npc || (!toAuthor && !toParent) || Object.hasOwn(d.paid, key)) return { author: 0, parent: 0, fresh: false };
  const g1 = toAuthor ? royaltyGrant(d.earned[e.author] ?? 0, MARKET_AUTHOR_TENTHS, capT) : 0;
  d.paid[key] = g1;
  if (g1) d.earned[e.author] = (d.earned[e.author] ?? 0) + g1;
  const p = e.parent;
  const g2 = toParent && p ? royaltyGrant(d.earned[p] ?? 0, MARKET_PARENT_TENTHS, capT) : 0;
  if (g2 && p) d.earned[p] = (d.earned[p] ?? 0) + g2;
  return { author: g1, parent: g2, fresh: true };
}

// ------------------------------------------------------------------ helpers

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const clean = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const round1 = (n: number) => Math.round(n * 10) / 10;
const latest = (l: MarketListing) => l.versions[l.versions.length - 1];
const liveOf = (m: MarketBook, author: string) => Object.values(m.listings).filter((l) => l.author === author && !l.hidden).length;

/** Tags of a version: its effect primitives, the elements its source names, and "delayed" for (after …). */
export function tagsOf(effects: readonly string[], source: string): string[] {
  const tags = new Set(effects);
  for (const e of ELEMENTS) if (new RegExp(`:${e}\\b`).test(source)) tags.add(e);
  if (/\(\s*after\b/.test(source)) tags.add('delayed');
  return [...tags];
}

function descOf(d: { zh?: unknown; en?: unknown } | null | undefined): { zh: string; en: string } | null {
  if (!d) return null;
  const zh = clean(d.zh, MARKET_DESC_MAX), en = clean(d.en, MARKET_DESC_MAX);
  return zh || en ? { zh, en } : null;
}

/** A listing by id (only well-formed ids, only the book's own keys). */
const listingOf = (world: World, id: unknown): MarketListing | null => {
  const k = String(id ?? '').trim().toLowerCase();
  return MARKET_ID_RE.test(k) && Object.hasOwn(world.market.listings, k) ? world.market.listings[k] : null;
};
const notFound = (id: string) => new Error(`No spell "${id}" in the market. 集市里没有「${id}」。`);

/** Normalised sources of every version of every banned listing (cached per banned list). */
const bannedWords = new WeakMap<readonly string[], Set<string>>();
function bannedSources(world: World): Set<string> {
  const ids = world.rules.market.banned;
  let s = bannedWords.get(ids);
  if (!s) {
    s = new Set();
    for (const id of ids) for (const v of world.market.listings[id]?.versions ?? []) s.add(norm(v.source));
    bannedWords.set(ids, s);
  }
  return s;
}

/**
 * The banned listing a spell belongs to, or null: a spell linked to a banned listing (the author's own, a copy,
 * a fork's own spell), or any custom spell with exactly the words (whitespace aside) of a banned version.
 */
export function bannedListing(world: World, spell: Spell): MarketListing | null {
  const banned = world.rules.market.banned;
  if (!banned.length || spell.builtin) return null;
  if (spell.market && banned.includes(spell.market.id)) { const l = listingOf(world, spell.market.id); if (l) return l; }
  if (!bannedSources(world).has(norm(spell.source))) return null;
  for (const id of banned) { const l = world.market.listings[id]; if (l?.versions.some((v) => norm(v.source) === norm(spell.source))) return l; }
  return null;
}

/** The refusal for casting a banned market spell (bilingual, English first so the client can split it). */
export function bannedCastText(world: World, spell: Spell, seed: string): string {
  const l = world.quip(MARKET_BANNED_CAST, seed, spell.id);
  const f = fill(l, { item: spell.name });
  return `${f.en} ${f.zh}`;
}

// ------------------------------------------------------------------ the day and its summary

/** Turn the day over when it has changed: each author whose spells were cast gets a private summary. */
export function rollDay(world: World) {
  const day = Math.floor(world.now / MARKET_DAY_S);
  const d = world.market.day;
  if (d.day === day) return;
  for (const [author, casters] of Object.entries(d.who)) {
    const w = world.wizards.get(author);
    if (!w || !casters.length) continue;
    const l = fill(MARKET_DAILY, { n: casters.length, g: round1((d.earned[author] ?? 0) / 10) });
    world.emit('market', l.en, { to: w.id, zh: l.zh });
  }
  world.market.day = blankDay(day);
}

/**
 * World.cast calls this after a successful cast of `spell` by `caster`: count the cast and pay the royalty
 * (rules.market.royalties, dailyCap). NPCs, fresh enrolees and the author themselves pay nothing.
 */
export function payRoyalty(world: World, caster: Wizard, spell: Spell) {
  if (!spell.market || spell.builtin) return;
  const l = listingOf(world, spell.market.id);
  if (!l) return;
  const npc = caster.npc || world.now - caster.createdAt < FRESH_SECONDS;
  // every player's cast counts (playtest round 4: a first-term market showed 0 casts); only the royalty skips the fresh
  if (!caster.npc && caster.id !== l.author) l.casts++;
  const rules = world.rules.market;
  if (!rules.royalties) return;
  rollDay(world);
  const d = world.market.day;
  if (d.size >= MARKET_LEDGER_MAX) return;
  const r = royaltyStep(d, { spell: l.id, caster: caster.id, author: l.author, parent: l.parent?.authorId ?? null, npc }, rules.dailyCap * 10);
  if (!r.fresh) return;
  d.size++;
  if (caster.id !== l.author) {
    l.casters++;
    const who = (d.who[l.author] ??= []);
    if (!who.includes(caster.id) && who.length < 200) who.push(caster.id);
  }
  const author = world.wizards.get(l.author);
  // an NPC's stall (npcStock) earns nothing: NPCs already top the leaderboard, royalties would only push them further
  if (author && !author.npc && r.author) world.addRep(author, r.author / 10);
  const parent = l.parent ? world.wizards.get(l.parent.authorId) : undefined;
  if (parent && r.parent) world.addRep(parent, r.parent / 10);
}

/** Your royalties today (for browse and the browser's market page). */
export function royaltiesToday(world: World, wid: string) {
  rollDay(world);
  const d = world.market.day;
  return {
    earnedToday: round1((d.earned[wid] ?? 0) / 10), cap: world.rules.market.dailyCap, on: world.rules.market.royalties,
    castersToday: d.who[wid]?.length ?? 0, perCaster: MARKET_AUTHOR_TENTHS / 10, parentShare: MARKET_PARENT_TENTHS / 10,
  };
}

// ------------------------------------------------------------------ politics (rules.market)

/** promoted ⊆ published \ banned (Market.tla PromotedPublished): run after every change of rules or listings. */
export function sanitizeMarket(world: World) {
  const m = world.rules.market;
  const ok = m.promoted.filter((id, i) => { const l = world.market.listings[id]; return !!l && !l.hidden && !m.banned.includes(id) && m.promoted.indexOf(id) === i; });
  if (ok.length !== m.promoted.length) world.rules = { ...world.rules, market: { ...m, promoted: ok } };
}

/** What a decree's new rules.market may say: every id a known listing; promoted published and not banned. */
export function marketDecreeErrors(world: World, next: Rulebook): string[] {
  const errors: string[] = [];
  const m = next.market;
  for (const id of m.banned) if (!world.market.listings[id]) errors.push(`market.banned: no market spell "${id}"`);
  for (const id of m.promoted) {
    const l = world.market.listings[id];
    if (!l) errors.push(`market.promoted: no market spell "${id}"`);
    else if (l.hidden) errors.push(`market.promoted: "${id}" is not published`);
    if (m.banned.includes(id)) errors.push(`market.promoted: "${id}" cannot be both banned and promoted`);
  }
  return errors;
}

/** Public lines for what a decree (or a veto) changed in the market: new bans, lifted bans, new promotions. */
export function marketDecreeNews(world: World, before: Rulebook, after: Rulebook, who?: string[]) {
  const say = (line: Line, id: string) => {
    const l = world.market.listings[id];
    if (!l) return;
    const f = fill(line, { item: latest(l).name, k: l.authorName });
    world.emit('market', f.en, { zh: f.zh, ...(who ? { who } : {}) });
  };
  for (const id of after.market.banned) if (!before.market.banned.includes(id)) say(MARKET_BAN_NEWS, id);
  for (const id of before.market.banned) if (!after.market.banned.includes(id)) say(MARKET_UNBAN_NEWS, id);
  for (const id of after.market.promoted) if (!before.market.promoted.includes(id)) say(MARKET_PROMOTE_NEWS, id);
}

// ------------------------------------------------------------------ views

function card(world: World, l: MarketListing, wid: string | null) {
  const v = latest(l);
  const m = world.rules.market;
  return {
    id: l.id, v: v.v, name: v.name, incantation: v.incantation, author: l.authorName, handle: l.authorHandle, house: l.house,
    npc: world.wizards.get(l.author)?.npc || undefined,
    tags: v.tags, effects: v.effects, minYear: v.minYear, nodes: v.nodes, desc: v.desc,
    publishedAt: round1(l.publishedAt), updatedAt: round1(l.updatedAt), versions: l.versions.length,
    copies: l.copiers.length, forks: l.forks.length, casts: l.casts, casters: l.casters, popularity: popularity(l), price: l.price ?? 0,
    ...(l.parent ? { parent: { id: l.parent.id, v: l.parent.v, name: l.parent.name, author: l.parent.author } } : {}),
    banned: m.banned.includes(l.id), promoted: m.promoted.includes(l.id), yours: l.author === wid, ...(l.hidden ? { unpublished: true } : {}),
  };
}
const popularity = (l: MarketListing) => l.copiers.length + 2 * l.forks.length + l.casters;

export interface BrowseFilter { tag?: string; element?: string; year?: number; author?: string; q?: string; sort?: 'popular' | 'new' | 'promoted'; limit?: number; offset?: number; mine?: boolean }

/** market_browse: published listings (yours, unpublished ones too, with mine), filtered and sorted; the 推荐 shelf; your royalties. */
export function browseMarket(world: World, wid: string | null, f: BrowseFilter = {}) {
  const m = world.rules.market;
  const tag = f.tag?.trim().toLowerCase(), el = f.element?.trim().toLowerCase(), au = f.author?.trim().toLowerCase(), q = f.q?.trim().toLowerCase();
  let rows = Object.values(world.market.listings).filter((l) => (f.mine ? l.author === wid : !l.hidden));
  if (tag) rows = rows.filter((l) => latest(l).tags.includes(tag));
  if (el) rows = rows.filter((l) => latest(l).tags.includes(el));
  if (typeof f.year === 'number' && Number.isFinite(f.year)) rows = rows.filter((l) => latest(l).minYear <= (f.year as number));
  if (au) rows = rows.filter((l) => l.authorName.toLowerCase().includes(au) || l.authorHandle.toLowerCase() === au);
  if (q) rows = rows.filter((l) => { const v = latest(l); return [v.name, v.incantation, v.desc?.zh, v.desc?.en, l.authorName, l.id].some((s) => s?.toLowerCase().includes(q)); });
  const promo = (l: MarketListing) => (m.promoted.includes(l.id) ? 1 : 0);
  const sort = f.sort ?? 'popular';
  rows.sort((a, b) => sort === 'new' ? b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : -1)
    : sort === 'promoted' ? promo(b) - promo(a) || popularity(b) - popularity(a) || b.updatedAt - a.updatedAt
    : popularity(b) - popularity(a) || b.updatedAt - a.updatedAt);
  const limit = Math.max(1, Math.min(50, Math.floor(f.limit ?? 20))), offset = Math.max(0, Math.floor(f.offset ?? 0));
  const shelf = m.promoted.map((id) => world.market.listings[id]).filter((l): l is MarketListing => !!l && !l.hidden);
  return {
    total: rows.length, offset, sort,
    listings: rows.slice(offset, offset + limit).map((l) => card(world, l, wid)),
    promoted: shelf.map((l) => card(world, l, wid)),
    banned: m.banned.map((id) => { const l = world.market.listings[id]; return { id, name: l ? latest(l).name : id, author: l?.authorName ?? '?' }; }),
    rules: { royalties: m.royalties, dailyCap: m.dailyCap, perCasterPerDay: MARKET_AUTHOR_TENTHS / 10, parentShare: MARKET_PARENT_TENTHS / 10 },
    ...(wid && world.wizards.has(wid) ? { you: { ...royaltiesToday(world, wid), listings: liveOf(world.market, wid), maxListings: MARKET_MAX_PER_AUTHOR } } : {}),
  };
}

/** market_spell: one listing with the source of a version, every version, its lineage (parents up) and its forks. */
export function marketSpell(world: World, wid: string | null, id: string, v?: number) {
  const l = listingOf(world, id);
  if (!l) throw notFound(id);
  const yours = l.author === wid;
  const ver = v ? l.versions.find((x) => x.v === v) : latest(l);
  if (!ver) throw new Error(`"${latest(l).name}" has versions v1–v${l.versions.length}. 这个咒语只有 v1–v${l.versions.length}。`);
  const lineage: { id: string; v: number; name: string; author: string; unpublished?: boolean }[] = [];
  const seen = new Set([l.id]);
  for (let p = l.parent; p && lineage.length < 16; ) {
    const pl = world.market.listings[p.id];
    lineage.push({ id: p.id, v: p.v, name: p.name, author: p.author, ...(pl && !pl.hidden ? {} : { unpublished: true }) });
    if (!pl || seen.has(pl.id)) break;
    seen.add(pl.id);
    p = pl.parent;
  }
  const w = wid ? world.wizards.get(wid) : undefined;
  const banned = world.rules.market.banned.includes(l.id);
  const canFork = !w ? { ok: false, why: 'Not bound to a wizard.' }
    : yours ? { ok: false, why: 'It is yours already. 这是你自己的咒语。' }
    : l.hidden ? { ok: false, why: 'Unpublished by its author. 作者已下架。' }
    : banned ? { ok: false, why: 'Banned by Ministry decree: you may read it, not copy it. 已被法令禁用：可以读，不能抄。' }
    : { ok: true };
  const have = w?.spells.find((s) => s.market?.id === l.id);
  const canCopy = !canFork.ok || !w ? canFork
    : ver.minYear > w.year ? { ok: false, why: `Needs year ${ver.minYear} (you are year ${w.year}). 需要 ${ver.minYear} 年级。` }
    : have ? { ok: false, why: `Already in your book as "${have.name}" (v${have.market!.v}). 你的咒语书里已经有它了。`, have: { name: have.name, v: have.market!.v } }
    : { ok: true };
  const showSource = !l.hidden || yours;
  return {
    ...card(world, l, wid), version: ver.v, versionName: ver.name, incantationOf: ver.incantation,
    ...(showSource ? { source: ver.source } : { source: null, note: 'Unpublished: only its author can read the source now; copies keep their attribution.' }),
    versionList: l.versions.map((x) => ({ v: x.v, name: x.name, at: round1(x.at), nodes: x.nodes, minYear: x.minYear, tags: x.tags })),
    lineage,
    forkList: l.forks.slice(-20).map((fid) => world.market.listings[fid]).filter((x): x is MarketListing => !!x && !x.hidden).map((x) => ({ id: x.id, name: latest(x).name, author: x.authorName })),
    canCopy, canFork,
    ...(banned ? { bannedNote: 'Banned by decree: casting it (or any copy, or the same words) fizzles for everyone. A Dumbledore\'s Army veto of that decree lifts the ban.' } : {}),
  };
}

// ------------------------------------------------------------------ publish / unpublish / copy / fork

/** Refuse words that are banned: a new listing (or version) must not be a banned spell under another name. */
function refuseBannedWords(world: World, source: string) {
  if (bannedSources(world).has(norm(source))) throw new Error('These words are banned by Ministry decree; the market will not take them. 这段咒语被魔法部法令禁用了，集市不收。');
}

function newListingRoom(world: World, wid: string) {
  if (liveOf(world.market, wid) >= MARKET_MAX_PER_AUTHOR) throw new Error(`You already have ${MARKET_MAX_PER_AUTHOR} spells in the market. Unpublish one first. 你在集市里已经有 ${MARKET_MAX_PER_AUTHOR} 个咒语了，先下架一个。`);
  if (Object.keys(world.market.listings).length >= MARKET_MAX_LISTINGS) throw new Error('The market is full. 集市摆满了。');
}

function versionOf(world: World, s: Spell, v: number, desc: MarketVersion['desc']): MarketVersion {
  return { v, name: s.name, incantation: s.incantation, source: s.source, nodes: s.nodes, minYear: s.minYear, effects: [...s.effects], tags: tagsOf(s.effects, s.source), desc, at: world.now };
}

/** Why a listing went up without a public line (playtest round 2: fork said false, publish true, and nobody knew why). */
const quiet = (announced: boolean) => (announced ? '' : ` (Not announced: the market announces one listing per author every ${Math.round(MARKET_ANNOUNCE_S / 60)} min; this one is listed all the same. 没有播报：集市每位作者每 ${Math.round(MARKET_ANNOUNCE_S / 60)} 分钟只播报一次，这个照样上架了。)`);
/** A public "new in the market" line, at most once per author per MARKET_ANNOUNCE_S; returns whether it went out. */
function announce(world: World, w: Wizard, line: Line) {
  const last = world.market.announced[w.id];
  if (last !== undefined && world.now - last < MARKET_ANNOUNCE_S) return false;
  world.market.announced[w.id] = world.now;
  world.emit('market', line.en, { who: [w.id], zh: line.zh });
  return true;
}

/**
 * publish_spell: one of your own custom spells goes to the market (a new listing), or — when it is already
 * published — becomes its next immutable version (unchanged: nothing happens; unpublished: it comes back).
 * Copies of other wizards' spells (from the market, or studied) are theirs: fork them instead.
 */
/**
 * NPC stalls (试玩: 「集市 0 个上架」): each NPC keeps one spell of their own on the market, so the first player on
 * a server finds something to browse, copy and fork. All are castable in the first year; none is an exam answer (copying one never passes an
 * O.W.L.), and they earn no royalties (payRoyalty). Idempotent: called whenever the NPCs are (re)made.
 */
export const NPC_STALLS: Record<string, { name: string; source: string; desc: { zh: string; en: string } }> = {
  'Seamus Finnigan': { name: 'Sparks Everywhere', source: '(each e (enemies 8) (bolt e 6 :fire))', desc: { zh: '火花四溅：8 米内每个敌人各挨一发小火球。西莫说：「炸了再说。」', en: 'A small fireball at every enemy within 8 m. Seamus: "Blow it up first, ask later."' } },
  'Hannah Abbott': { name: 'First Aid Kit', source: '(heal self 15) (shield self 12 3)', desc: { zh: '急救包：先给自己回血，再套一层三秒的护盾。', en: 'Heal yourself, then a three-second shield.' } },
  'Padma Patil': { name: 'Frost Signpost', source: '(bolt (first (enemies 25)) 9 :ice)', desc: { zh: '冰霜路标：不用选目标，冰锥自动打 25 米内最近的敌人。', en: 'No target needed: an ice bolt at the nearest enemy within 25 m.' } },
  'Gregory Goyle': { name: 'Cosh', source: '(bolt target 14)', desc: { zh: '闷棍：不讲究，一发最大号的魔弹。', en: 'No finesse: the biggest bolt a first-year can throw.' } },
};
export function npcStock(world: World) {
  for (const w of world.wizards.values()) {
    const stall = w.npc ? NPC_STALLS[w.name] : undefined;
    if (!stall || Object.values(world.market.listings).some((l) => l.author === w.id)) continue;
    try {
      const s = world.findSpell(w, stall.name) ?? world.forgeSpell(w.id, { name: stall.name, source: stall.source, quiet: true }).spell;
      makeListing(world, w, s, { zh: stall.desc.zh, en: stall.desc.en }, null);
    } catch { /* a rule change made it unforgeable: no stall this time */ }
  }
}

/** The most Galleons an author may ask for a copy (a first-year starts with 20). */
export const MARKET_PRICE_MAX = 10;
const priceOf = (p: unknown) => (typeof p === 'number' && Number.isFinite(p) ? Math.max(0, Math.min(MARKET_PRICE_MAX, Math.round(p))) : undefined);

/**
 * The price of taking a paid listing (copy or fork; round 5: "copies are free, a trader earns no Galleons"): once per
 * wizard per listing, from the taker to the author — Galleons move, none are made. A wizard in their first
 * FRESH_SECONDS takes it free and the author gets nothing (as with royalties: a fresh alt cannot farm you).
 */
function payPrice(world: World, w: Wizard, l: MarketListing, dry = false) {
  const price = l.price ?? 0;
  if (!price || l.copiers.includes(w.id) || world.now - w.createdAt < FRESH_SECONDS) return 0;
  if (w.galleons < price) throw new Error(`${latest(l).name} costs ${price} Galleons; you have ${w.galleons}. 「${latest(l).name}」要 ${price} 加隆，你只有 ${w.galleons}。`);
  if (dry) return price;
  w.galleons -= price;
  const author = world.wizards.get(l.author);
  if (author) author.galleons += price;
  return price;
}

export function publishSpell(world: World, wid: string, key: string, opts: { desc?: { zh?: string; en?: string } | null; price?: number } = {}) {
  const w = world.need(wid);
  if (w.npc) throw new Error('NPCs keep to the curriculum.');
  const s = world.findSpell(w, String(key ?? ''));
  if (!s) throw new Error(`No spell "${key}" in your book. 你的咒语书里没有「${key}」。`);
  if (s.builtin) throw new Error('The standard curriculum belongs to Hogwarts; publish a spell you wrote. 标准课程属于霍格沃茨，发布你自己写的咒语吧。');
  const linked = (s.market && listingOf(world, s.market.id)) || undefined;
  if (linked && linked.author !== w.id) throw new Error(`"${s.name}" is a copy of ${linked.authorName}'s spell: use fork_spell to publish your own version. 这是 ${linked.authorName} 的咒语的抄本，用 fork 发布你自己的版本。`);
  if (!linked && s.origin && s.origin.handle !== w.handle) throw new Error(`"${s.name}" was studied from ${s.origin.author}: it is theirs to publish. 这是从 ${s.origin.author} 那里偷师来的，发布权归原作者。`);
  if (linked && world.rules.market.banned.includes(linked.id)) throw new Error('This spell is banned by Ministry decree; no new versions. 这个咒语已被法令禁用，不能更新。');
  refuseBannedWords(world, s.source);
  const desc = opts.desc !== undefined ? descOf(opts.desc) : linked ? latest(linked).desc : null;
  if (linked) {
    const last = latest(linked);
    const same = last.source === s.source && last.name === s.name && last.incantation === s.incantation && JSON.stringify(last.desc) === JSON.stringify(desc);
    if (same && !linked.hidden) return { published: linked.id, v: last.v, unchanged: true, name: last.name, note: `v${last.v} is already the current version. 已经是最新版本了。` };
    if (linked.hidden) newListingRoom(world, w.id);
    let v = last.v;
    if (!same) {
      if (linked.versions.length >= MARKET_MAX_VERSIONS) throw new Error(`A listing keeps ${MARKET_MAX_VERSIONS} versions; publish it under a new name. 一个咒语最多 ${MARKET_MAX_VERSIONS} 个版本。`);
      v = last.v + 1;
      linked.versions.push(versionOf(world, s, v, desc));
    }
    linked.hidden = false;
    linked.updatedAt = world.now;
    const p = priceOf(opts.price);
    if (p !== undefined) linked.price = p;
    Object.assign(linked, { authorName: w.name, authorHandle: w.handle });
    s.market = { id: linked.id, v };
    const f = fill(MARKET_REPUBLISHED, { v: w.name, item: s.name, n: v });
    const announced = !same && announce(world, w, f);
    return { published: linked.id, v, name: s.name, tags: latest(linked).tags, minYear: s.minYear, announced, note: (same ? 'Back in the market. 重新上架了。' : `Version v${v} published; older versions stay readable. v${v} 已发布，旧版本仍可阅读。`) + quiet(announced) };
  }
  newListingRoom(world, w.id);
  const l = makeListing(world, w, s, desc, null);
  const p = priceOf(opts.price);
  if (p) l.price = p;
  const announced = announce(world, w, fill(world.quip(MARKET_PUBLISHED, w.handle, l.id), { v: w.name, item: s.name }));
  return { published: l.id, v: 1, name: s.name, tags: latest(l).tags, minYear: s.minYear, announced, note: 'Published. Others can copy or fork it; when they cast it you earn a little reputation. 已上架：别人施放它时你会得到少量声望。' + quiet(announced) };
}

function makeListing(world: World, w: Wizard, s: Spell, desc: MarketVersion['desc'], parent: MarketListing['parent']): MarketListing {
  const id = `m_${(++world.market.seq).toString(36)}`;
  const l: MarketListing = {
    id, author: w.id, authorName: w.name, authorHandle: w.handle, house: w.house, spellId: s.id, versions: [versionOf(world, s, 1, desc)], parent,
    hidden: false, publishedAt: world.now, updatedAt: world.now, copiers: [], forks: [], casts: 0, casters: 0,
  };
  world.market.listings[id] = l;
  s.market = { id, v: 1 };
  return l;
}

/** Find one of your listings by id, or by the name of the spell (or of its latest version). */
function ownListing(world: World, w: Wizard, key: string): MarketListing {
  const k = String(key ?? '').trim().toLowerCase();
  const byId = listingOf(world, k);
  if (byId) { if (byId.author !== w.id) throw new Error('That is not your spell. 这不是你的咒语。'); return byId; }
  const s = world.findSpell(w, key);
  const l = (s?.market && listingOf(world, s.market.id)) || Object.values(world.market.listings).find((x) => x.author === w.id && latest(x).name.toLowerCase() === k);
  if (!l || l.author !== w.id) throw notFound(key);
  return l;
}

/** unpublish_spell: hide your listing. Copies keep their attribution (and keep paying royalties); lineage shows it as unpublished. */
export function unpublishSpell(world: World, wid: string, key: string) {
  const w = world.need(wid);
  const l = ownListing(world, w, key);
  if (l.hidden) return { unpublished: l.id, already: true };
  l.hidden = true;
  l.updatedAt = world.now;
  sanitizeMarket(world);
  return { unpublished: l.id, name: latest(l).name, note: 'Hidden from the market. Existing copies keep your name; publish_spell brings it back. 已下架：已有的抄本仍署你的名字。' };
}

/** The listing you may take from (copy or fork): published, not yours, not banned; and the version. */
function takeable(world: World, w: Wizard, id: string, v: number | undefined, what: 'copy' | 'fork') {
  if (w.npc) throw new Error('NPCs keep to the curriculum.');
  const l = listingOf(world, id);
  if (!l || l.hidden) throw notFound(id);
  if (l.author === w.id) throw new Error(what === 'copy' ? 'It is yours already. 这本来就是你的。' : 'It is yours: edit it in your book and publish_spell a new version. 这是你自己的：改好之后发布新版本。');
  if (world.rules.market.banned.includes(l.id)) throw new Error('Banned by Ministry decree: you may read it, not take it. 已被魔法部法令禁用：可以读，不能拿。');
  const ver = v ? l.versions.find((x) => x.v === v) : latest(l);
  if (!ver) throw new Error(`No version v${v}. 没有 v${v} 这个版本。`);
  return { l, ver };
}

function freeName(w: Wizard, name: string) {
  if (w.spells.some((s) => s.name.toLowerCase() === name.toLowerCase())) throw new Error(`You already have a spell called "${name}": give it another name. 你的咒语书里已经有「${name}」了，换个名字。`);
}

/**
 * copy_spell: forge a market spell into your book (your year, seals, banned primitives and spellbook size apply;
 * a failed copy spends nothing). The copy records its author (origin) and its listing (market): casting it pays
 * the author a royalty, and a ban of the listing reaches it.
 */
export function copySpell(world: World, wid: string, id: string, opts: { v?: number; name?: string; slot?: number } = {}) {
  const w = world.need(wid);
  const { l, ver } = takeable(world, w, id, opts.v, 'copy');
  const name = clean(opts.name ?? ver.name, 40);
  freeName(w, name);
  payPrice(world, w, l, true); // too poor: refused before anything is forged
  const r = world.forgeSpell(w.id, {
    name, incantation: ver.incantation, source: ver.source, slot: opts.slot, quiet: true,
    origin: { author: l.authorName, handle: l.authorHandle, spell: ver.name, at: world.now }, market: { id: l.id, v: ver.v },
  });
  const paid = payPrice(world, w, l); // after the forge: a failed copy costs nothing
  if (!l.copiers.includes(w.id)) {
    if (l.copiers.length < 1000) l.copiers.push(w.id);
    const author = world.wizards.get(l.author);
    if (author) { const f = fill(world.quip(MARKET_COPIED_YOU, w.handle, l.id), { v: w.name, item: ver.name }); world.emit('market', f.en, { to: author.id, zh: f.zh }); }
  }
  return { copied: { name: r.spell.name, id: r.spell.id, slot: w.hotbar.indexOf(r.spell.id) + 1 || null }, from: { id: l.id, v: ver.v, name: ver.name, author: l.authorName }, ...(paid ? { paid, galleons: w.galleons } : {}), notes: r.notes };
}

/**
 * fork_spell: copy + edit + publish as your own. The source must differ from the version forked; it is forged into
 * your book (your caps; a failure spends nothing and lists nothing) and published as a new listing whose parent is
 * the forked listing and version — the lineage. When others cast the fork, its parent's author gets a small share.
 */
export function forkSpell(world: World, wid: string, id: string, opts: { v?: number; source: string; name?: string; incantation?: string; desc?: { zh?: string; en?: string } | null; slot?: number }) {
  const w = world.need(wid);
  const { l, ver } = takeable(world, w, id, opts.v, 'fork');
  const source = String(opts.source ?? '');
  if (norm(source) === norm(ver.source)) throw new Error('A fork must change the spell (edit its source); to use it as it is, copy_spell it. fork 要改点什么；原样使用请用 copy。');
  refuseBannedWords(world, source);
  newListingRoom(world, w.id);
  payPrice(world, w, l, true); // too poor: refused before anything is forged
  const name = clean(opts.name ?? `${ver.name} II`, 40);
  freeName(w, name);
  const r = world.forgeSpell(w.id, {
    name, incantation: opts.incantation, source, slot: opts.slot, quiet: true,
    origin: { author: l.authorName, handle: l.authorHandle, spell: ver.name, at: world.now },
  });
  payPrice(world, w, l);
  if (!l.copiers.includes(w.id) && l.copiers.length < 1000) l.copiers.push(w.id); // paid once: a later copy of the parent is free
  const fork = makeListing(world, w, r.spell, descOf(opts.desc), { id: l.id, v: ver.v, authorId: l.author, author: l.authorName, handle: l.authorHandle, name: ver.name });
  if (l.forks.length < 200) l.forks.push(fork.id);
  const parent = world.wizards.get(l.author);
  if (parent) { const f = fill(MARKET_FORKED_YOU, { v: w.name, item: ver.name, k: name }); world.emit('market', f.en, { to: parent.id, zh: f.zh }); }
  const announced = announce(world, w, fill(world.quip(MARKET_PUBLISHED, w.handle, fork.id), { v: w.name, item: name }));
  return {
    forked: { id: fork.id, v: 1, name, spellId: r.spell.id }, parent: { id: l.id, v: ver.v, name: ver.name, author: l.authorName },
    tags: latest(fork).tags, minYear: r.spell.minYear, announced, notes: announced ? r.notes : [...r.notes, quiet(false).trim()],
  };
}

// ------------------------------------------------------------------ the browser (WebSocket; src/server/main.ts)

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : undefined);

/**
 * A browser's market message, untrusted: `{ t: 'market', op: 'browse' | 'spell' }` reads, `{ t: 'marketop', op:
 * 'publish' | 'unpublish' | 'copy' | 'fork' }` acts (net.ts LIMITS `market`, `marketop`). Returns the reply's
 * `r` and whether the spellbook changed (the server then sends a fresh `book`). Throws what the kernel throws.
 */
export function marketMessage(world: World, wid: string, m: Record<string, unknown>): { op: string; r: unknown; book: boolean } {
  const op = String(m.op ?? 'browse');
  const id = str(m.id, 16) ?? '';
  const v = int(m.v);
  const d = m.desc && typeof m.desc === 'object' ? (m.desc as Record<string, unknown>) : null;
  const desc = d ? { zh: str(d.zh, MARKET_DESC_MAX), en: str(d.en, MARKET_DESC_MAX) } : undefined;
  if (m.t === 'market') {
    if (op === 'spell') return { op, r: marketSpell(world, wid, id, v), book: false };
    const sort = m.sort === 'new' || m.sort === 'promoted' ? m.sort : 'popular';
    return {
      op: 'browse', book: false,
      r: browseMarket(world, wid, { tag: str(m.tag, 20), element: str(m.element, 12), year: int(m.year), author: str(m.author, 40), q: str(m.q, 60), sort, mine: m.mine === true, limit: int(m.limit), offset: int(m.offset) }),
    };
  }
  switch (op) {
    case 'publish': return { op, r: publishSpell(world, wid, str(m.spell, 60) ?? '', { desc }), book: true };
    case 'unpublish': return { op, r: unpublishSpell(world, wid, str(m.spell, 60) ?? id), book: false };
    case 'copy': return { op, r: copySpell(world, wid, id, { v, name: str(m.name, 40), slot: int(m.slot) }), book: true };
    case 'fork': return { op, r: forkSpell(world, wid, id, { v, source: str(m.source, 4000) ?? '', name: str(m.name, 40), incantation: str(m.incantation, 60), desc, slot: int(m.slot) }), book: true };
    default: throw new Error(`Unknown market action "${op}".`);
  }
}

// ------------------------------------------------------------------ the plug (kernel/feature.ts)
const desc = (zh?: unknown, en?: unknown) => (zh === undefined && en === undefined ? undefined : { zh: zh as string | undefined, en: en as string | undefined });
const optStr = (x: unknown) => (typeof x === 'string' ? x : undefined);
const optInt = (x: unknown) => (typeof x === 'number' ? x : undefined);

export const MARKET_FEATURE: Feature = {
  id: 'market',
  init(world) { world.market = blankMarket(); },
  save: (world) => world.market,
  load(world, data, legacy) { world.market = restoreMarket(data ?? legacy.market); sanitizeMarket(world); },
  sweep: rollDay, // the day's royalty summary
  // a decree (or a veto undoing one): promoted ⊆ published (Market.tla PromotedPublished), and the news of bans and promotions
  rules(world, before, minister) { sanitizeMarket(world); marketDecreeNews(world, before, world.rules, minister ? [minister.id] : undefined); },
  tools: [
    {
      name: 'market_browse', title: 'The spell market (咒语集市)', cost: 0, readOnly: true, anonymous: true,
      description: 'Browse spells other wizards published: name, author, tags (effects and elements), min year, copies/forks/casts, banned and promoted badges; the Ministry\'s 推荐 shelf; your royalties today. Filter by tag, element, year (spells castable at that year), author, free text; sort popular | new | promoted. Read one with market_spell; take one with copy_spell or fork_spell.',
      input: {
        tag: z.string().max(20).optional().describe('an effect primitive (bolt, heal, nova, …), an element, or "delayed"'),
        element: z.enum(['arcane', 'fire', 'ice', 'lightning', 'light']).optional(),
        year: z.number().int().min(1).max(7).optional().describe('only spells whose minimum year is at most this'),
        author: z.string().max(40).optional().describe('author name (part of it) or handle'),
        q: z.string().max(60).optional().describe('search names, incantations and descriptions'),
        sort: z.enum(['popular', 'new', 'promoted']).optional(),
        mine: z.boolean().optional().describe('only your own listings (unpublished ones too)'),
        limit: z.number().int().min(1).max(50).optional(),
        offset: z.number().int().min(0).optional(),
      },
      run: (world, wid, a) => browseMarket(world, wid, a as BrowseFilter),
      runAnon: (world, wid, a) => browseMarket(world, wid, a as BrowseFilter),
    },
    {
      name: 'market_spell', title: 'Read a market spell', cost: 0, readOnly: true, anonymous: true,
      description: 'One market spell in full: its source (any version: v1, v2 …), versions, lineage (the spells it was forked from, up to the original), its forks, stats, whether it is banned or promoted, and whether you can copy it at your year.',
      input: { id: z.string().min(3).max(16).describe('a market id like "m_1a" (from market_browse)'), v: z.number().int().min(1).optional().describe('version (default: the latest)') },
      run: (world, wid, a) => marketSpell(world, wid, String(a.id), optInt(a.v)),
      runAnon: (world, wid, a) => marketSpell(world, wid, String(a.id), optInt(a.v)),
    },
    {
      name: 'publish_spell', title: 'Publish a spell to the market', cost: 2,
      description: `Put one of your own custom spells in the spell market (咒语集市), or publish its current state as the next version if it is already there (versions are immutable). Others can copy or fork it; each distinct wizard who casts it successfully earns you +1 reputation a day (+0.3 when they cast a fork of it), up to the daily cap (rulebook market.dailyCap). NPCs and wizards in their first ${FRESH_SECONDS / 60} minutes pay no royalty (their casts still count): a fresh alt cannot farm you. price (0–${MARKET_PRICE_MAX} Galleons) is what a copy or a fork costs, paid to you once per wizard (fresh wizards take it free, and you get nothing from them). Copies of other wizards' spells cannot be published — fork them.`,
      input: {
        spell: z.string().min(1).max(60).describe('your spell\'s name or id'),
        desc_zh: z.string().max(140).optional().describe('a one-line description in Chinese'),
        desc_en: z.string().max(140).optional().describe('a one-line description in English'),
        price: z.number().int().min(0).max(MARKET_PRICE_MAX).optional().describe('Galleons a copy or fork costs (default 0; republishing keeps it unless given)'),
      },
      run: (world, wid, a) => publishSpell(world, wid, String(a.spell), { desc: desc(a.desc_zh, a.desc_en), price: optInt(a.price) }),
    },
    {
      name: 'unpublish_spell', title: 'Unpublish a market spell', cost: 1,
      description: 'Hide one of your listings from the market (by market id or spell name). Existing copies keep your name and still work; publish_spell brings it back.',
      input: { spell: z.string().min(1).max(60).describe('market id or spell name') },
      run: (world, wid, a) => unpublishSpell(world, wid, String(a.spell)),
    },
    {
      name: 'copy_spell', title: 'Copy a market spell into your book', cost: 3,
      description: 'Forge a market spell into your spellbook, credited to its author. Your own year caps, seals, banned primitives and spellbook size apply (a failed copy spends nothing). Banned spells can be read but not copied. A listing with a price costs that many Galleons, paid to its author once (you are told if you cannot afford it).',
      input: {
        id: z.string().min(3).max(16).describe('market id (from market_browse)'),
        v: z.number().int().min(1).optional().describe('version (default: the latest)'),
        name: z.string().min(1).max(40).optional().describe('name for your copy (default: the original name)'),
        slot: z.number().int().min(1).max(6).optional().describe('hotbar slot'),
      },
      run: (world, wid, a) => copySpell(world, wid, String(a.id), { v: optInt(a.v), name: optStr(a.name), slot: optInt(a.slot) }),
    },
    {
      name: 'fork_spell', title: 'Fork a market spell', cost: 3,
      description: 'Copy a market spell, change its source, and publish the result as your own listing: it is forged into your book (your caps apply; a failure spends and lists nothing) and its lineage records the parent. The source must differ from the parent\'s. When others cast your fork, you get the royalty and the parent\'s author a small share.',
      input: {
        id: z.string().min(3).max(16).describe('market id of the parent'),
        source: z.string().min(1).max(4000).describe('your edited Runes source'),
        v: z.number().int().min(1).optional().describe('parent version (default: the latest)'),
        name: z.string().min(1).max(40).optional().describe('name of the fork (default: "<parent name> II")'),
        incantation: z.string().max(60).optional(),
        desc_zh: z.string().max(140).optional(),
        desc_en: z.string().max(140).optional(),
        slot: z.number().int().min(1).max(6).optional(),
      },
      run: (world, wid, a) => forkSpell(world, wid, String(a.id), { source: String(a.source), v: optInt(a.v), name: optStr(a.name), incantation: optStr(a.incantation), desc: desc(a.desc_zh, a.desc_en), slot: optInt(a.slot) }),
    },
  ],
};
