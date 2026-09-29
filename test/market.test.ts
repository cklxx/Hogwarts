/**
 * 咒语集市 — the spell market (src/kernel/market.ts): publish / versions / unpublish, copy under your own caps,
 * fork lineage, bounded royalties (distinct caster per spell per day, the author's daily cap, never yourself,
 * never an NPC or a fresh enrolee), the Minister's ban and promotion and the DA veto that reverts them,
 * persistence (with old saves), the MCP tools and the browser's WebSocket messages.
 */
import { FEATURE_TOOL_COST } from '../src/kernel/features.js';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { World } from '../src/kernel/world.js';
import { createMcpServer } from '../src/mcp/server.js';
import { XP_FOR_YEAR, derived, spellbookSize } from '../src/kernel/progression.js';
import { applyPatch, defaultRulebook } from '../src/kernel/rulebook.js';
import { AGENT_TOOL_COST } from '../src/kernel/unfair.js';
import {
  browseMarket, copySpell, forkSpell, marketMessage, marketSpell, publishSpell, royaltyStep, royaltyGrant, tagsOf, unpublishSpell, type RoyaltyLedger,
} from '../src/kernel/market.js';
import { LIMITS } from '../src/server/net.js';
import { MARKET_ANNOUNCE_S, MARKET_AUTHOR_TENTHS, MARKET_CAP_MAX, MARKET_DAY_S, MARKET_MAX_PER_AUTHOR, MARKET_MAX_VERSIONS, MARKET_PARENT_TENTHS } from '../src/shared/constants.js';
import type { Wizard } from '../src/kernel/types.js';

function mk(seed = 11) {
  const w = new World({ seed, secret: 'market' });
  w.rules.creatures.spawnMultiplier = 0;
  w.term.endsAt = 1e12; // no end of term (and its reputation decay) in these tests
  return w;
}
/** An online wizard enrolled long ago (royalties count), at year `year`. */
function wiz(w: World, name: string, house = 'gryffindor', year = 3): Wizard {
  const a = w.enroll(name, house).wizard;
  a.connections = 1;
  if (a.year < year) w.gainXp(a, XP_FOR_YEAR[year] - a.xp);
  a.createdAt = -10_000;
  a.pos = { x: 60 + w.wizards.size * 3, z: 60 };
  a.hp = derived(a, w.rules).maxHp;
  a.mana = 1e4;
  return a;
}
/** Cast `key` for real (cooldowns cleared, plenty of mana) at a point in front of the caster. */
const cast = (w: World, x: Wizard, key: string) => {
  x.globalCd = 0; x.cooldowns = {}; x.mana = 1e4;
  return w.cast(x.id, key, { aim: { x: x.pos.x, z: x.pos.z - 10 } });
};
const SPARK = '(bolt aim 6 :fire)';
function market() {
  const w = mk();
  const a = wiz(w, 'Fred Weasley', 'gryffindor', 3);
  const b = wiz(w, 'Luna Lovegood', 'ravenclaw', 3);
  const c = wiz(w, 'Neville Longbottom', 'gryffindor', 3);
  w.forgeSpell(a.id, { name: 'Wildfire Spark', incantation: 'Scintilla!', source: SPARK });
  const p = publishSpell(w, a.id, 'Wildfire Spark', { desc: { zh: '一小团韦斯莱烟火', en: 'A small Weasley firework' } });
  return { w, a, b, c, id: p.published };
}
const rep = (x: Wizard) => Math.round(x.reputation * 10) / 10;
const mine = (w: World, x: Wizard) => w.events.filter((e) => e.to === x.id);

describe('咒语集市: publish, versions, unpublish', () => {
  it('publishes a custom spell with tags, min year and a description; republishing makes immutable versions', () => {
    const { w, a, id } = market();
    expect(id).toMatch(/^m_[a-z0-9]+$/);
    const d = marketSpell(w, null, id);
    expect(d).toMatchObject({ id, v: 1, name: 'Wildfire Spark', author: 'Fred Weasley', handle: a.handle, minYear: 1, source: SPARK, desc: { zh: '一小团韦斯莱烟火', en: 'A small Weasley firework' } });
    expect(d.tags).toEqual(expect.arrayContaining(['bolt', 'fire']));
    expect(JSON.stringify(d)).not.toContain(a.id); // never the registry id
    // unchanged: nothing happens
    expect(publishSpell(w, a.id, 'Wildfire Spark')).toMatchObject({ unchanged: true, v: 1 });
    // rework and republish: v2, v1 still readable as it was
    w.forgeSpell(a.id, { name: 'Wildfire Spark', incantation: 'Scintilla!', source: '(bolt aim 7 :fire)' });
    expect(publishSpell(w, a.id, 'Wildfire Spark')).toMatchObject({ published: id, v: 2 });
    expect(marketSpell(w, null, id, 1).source).toBe(SPARK);
    expect(marketSpell(w, null, id).source).toBe('(bolt aim 7 :fire)');
    expect(marketSpell(w, null, id).versionList.map((x) => x.v)).toEqual([1, 2]);
    expect(a.spells.find((s) => s.name === 'Wildfire Spark')!.market).toEqual({ id, v: 2 });
    // the description survives a republish without one
    expect(marketSpell(w, null, id).desc?.en).toBe('A small Weasley firework');
    expect(tagsOf(['bolt', 'root'], '(after 1 (bolt aim 3 :ice)) (root target 1)')).toEqual(['bolt', 'root', 'ice', 'delayed']);
  });

  it('refuses the curriculum, copies of other people\'s spells, and too many listings or versions', () => {
    const { w, a, b, id } = market();
    expect(() => publishSpell(w, a.id, 'Stupefy')).toThrow(/curriculum/);
    expect(() => publishSpell(w, a.id, 'Nope')).toThrow(/No spell/);
    copySpell(w, b.id, id);
    expect(() => publishSpell(w, b.id, 'Wildfire Spark')).toThrow(/fork_spell/);
    // a spell studied from someone (偷师) is theirs to publish
    w.forgeSpell(b.id, { name: 'Borrowed', source: '(light 5)', origin: { author: 'Fred Weasley', handle: a.handle, spell: 'x', at: 0 } });
    expect(() => publishSpell(w, b.id, 'Borrowed')).toThrow(/studied/);
    // versions are capped
    for (let i = 2; i <= MARKET_MAX_VERSIONS; i++) { w.forgeSpell(a.id, { name: 'Wildfire Spark', source: `(bolt aim ${i % 9 + 1} :fire) (say "v${i}")` }); publishSpell(w, a.id, 'Wildfire Spark'); }
    w.forgeSpell(a.id, { name: 'Wildfire Spark', source: '(bolt aim 2 :ice)' });
    expect(() => publishSpell(w, a.id, 'Wildfire Spark')).toThrow(/versions/);
    // live listings per author are capped
    a.xp = XP_FOR_YEAR[7]; a.year = 7;
    // (a listing outlives its spell: publish, then unlearn to make room in the book)
    for (let i = 0; i < MARKET_MAX_PER_AUTHOR - 1; i++) { w.forgeSpell(a.id, { name: `Spell ${i}`, source: `(light ${i + 1})` }); publishSpell(w, a.id, `Spell ${i}`); w.unlearn(a.id, `Spell ${i}`); }
    w.forgeSpell(a.id, { name: 'One Too Many', source: '(light 20)' });
    expect(() => publishSpell(w, a.id, 'One Too Many')).toThrow(/already have 12/);
  });

  it('announces a publish at most once per author per 10 minutes', () => {
    const { w, a } = market();
    const news = () => w.events.filter((e) => e.type === 'market' && !e.to).length;
    expect(news()).toBe(1);
    w.forgeSpell(a.id, { name: 'Second', source: '(light 4)' });
    expect(publishSpell(w, a.id, 'Second').announced).toBe(false);
    expect(news()).toBe(1);
    w.now += MARKET_ANNOUNCE_S;
    w.forgeSpell(a.id, { name: 'Third', source: '(light 5)' });
    expect(publishSpell(w, a.id, 'Third').announced).toBe(true);
    expect(news()).toBe(2);
    const e = w.events.filter((x) => x.type === 'market' && !x.to).at(-1)!;
    expect(e.zh).toMatch(/集市/);
    expect(e.text).toMatch(/market/);
  });

  it('unpublish hides the listing but copies keep their attribution (and keep working)', () => {
    const { w, a, b, id } = market();
    copySpell(w, b.id, id);
    expect(unpublishSpell(w, a.id, id)).toMatchObject({ unpublished: id });
    expect(browseMarket(w, b.id).listings.map((l) => l.id)).not.toContain(id);
    expect(() => copySpell(w, b.id, id)).toThrow(/No spell/);
    const copy = b.spells.find((s) => s.name === 'Wildfire Spark')!;
    expect(copy.origin).toMatchObject({ author: 'Fred Weasley', handle: a.handle });
    expect(cast(w, b, 'Wildfire Spark').ok).toBe(true);
    const d = marketSpell(w, b.id, id);
    expect(d.unpublished).toBe(true);
    expect(d.source).toBeNull(); // only its author reads it now
    expect(marketSpell(w, a.id, id).source).toBe(SPARK);
    expect(browseMarket(w, a.id, { mine: true }).listings.map((l) => l.id)).toContain(id);
    // someone else cannot unpublish it; publishing brings it back
    expect(() => unpublishSpell(w, b.id, id)).toThrow(/not your/);
    expect(publishSpell(w, a.id, 'Wildfire Spark')).toMatchObject({ published: id, v: 1 });
    expect(browseMarket(w, b.id).listings.map((l) => l.id)).toContain(id);
  });
});

describe('咒语集市: copy and fork', () => {
  it('a copy is forged under the copier\'s own caps and spellbook size; a failed copy spends nothing', () => {
    const w = mk();
    const a = wiz(w, 'Hermione Granger', 'gryffindor', 3);
    const low = wiz(w, 'Colin Creevey', 'gryffindor', 1);
    w.forgeSpell(a.id, { name: 'Ring of Fire', source: '(nova 4 8 :fire)' }); // nova: year 3
    const { published: id } = publishSpell(w, a.id, 'Ring of Fire');
    const book = JSON.stringify(low.spells);
    expect(() => copySpell(w, low.id, id)).toThrow(/year|nova/i);
    expect(JSON.stringify(low.spells)).toBe(book);
    expect(marketSpell(w, low.id, id).canCopy).toMatchObject({ ok: false });
    expect(marketSpell(w, low.id, id).copies).toBe(0);
    // a full spellbook
    const full = wiz(w, 'Dean Thomas', 'gryffindor', 3);
    for (let i = 0; i < spellbookSize(full.year); i++) w.forgeSpell(full.id, { name: `Own ${i}`, source: '(light 5)' });
    expect(() => copySpell(w, full.id, id)).toThrow(/spellbook holds/);
    // an able copier gets it, credited, linked, on a hotbar slot
    w.gainXp(low, XP_FOR_YEAR[3] - low.xp);
    const r = copySpell(w, low.id, id, { name: 'Colin\'s Ring', slot: 4 });
    expect(r.copied.name).toBe("Colin's Ring");
    const s = low.spells.find((x) => x.name === "Colin's Ring")!;
    expect(s).toMatchObject({ source: '(nova 4 8 :fire)', origin: { author: 'Hermione Granger', spell: 'Ring of Fire' }, market: { id, v: 1 } });
    expect(low.hotbar[3]).toBe(s.id);
    expect(w.armory(low.id).spells.find((x) => x.name === "Colin's Ring")).toMatchObject({ market: { id, v: 1, own: false }, origin: { author: 'Hermione Granger' } });
    expect(w.armory(a.id).spells.find((x) => x.name === 'Ring of Fire')).toMatchObject({ market: { id, v: 1, own: true } });
    expect(marketSpell(w, low.id, id)).toMatchObject({ canCopy: { ok: false, have: { name: "Colin's Ring", v: 1 } }, canFork: { ok: true } });
    // same name twice is refused; the author hears about it once per copier
    expect(() => copySpell(w, low.id, id, { name: "Colin's Ring" })).toThrow(/already have/);
    expect(mine(w, a).filter((e) => /copied your/.test(e.text))).toHaveLength(1);
    expect(marketSpell(w, a.id, id).copies).toBe(1);
    // your own spell: nothing to copy
    expect(() => copySpell(w, a.id, id)).toThrow(/yours/);
    // a chosen old version
    w.forgeSpell(a.id, { name: 'Ring of Fire', source: '(nova 5 9 :fire)' });
    publishSpell(w, a.id, 'Ring of Fire');
    const b = wiz(w, 'Ginny Weasley', 'gryffindor', 3);
    copySpell(w, b.id, id, { v: 1 });
    expect(b.spells.find((x) => x.name === 'Ring of Fire')).toMatchObject({ source: '(nova 4 8 :fire)', market: { id, v: 1 } });
  });

  it('a fork must change the source, becomes a listing of its own, and keeps a lineage chain', () => {
    const { w, a, b, c, id } = market();
    expect(() => forkSpell(w, b.id, id, { source: `  ${SPARK} ` })).toThrow(/must change/);
    expect(() => forkSpell(w, a.id, id, { source: '(bolt aim 3)' })).toThrow(/yours/);
    const f1 = forkSpell(w, b.id, id, { source: '(bolt aim 6 :ice)', name: 'Frost Spark', desc: { en: 'colder' } });
    expect(f1.parent).toEqual({ id, v: 1, name: 'Wildfire Spark', author: 'Fred Weasley' });
    const s = b.spells.find((x) => x.name === 'Frost Spark')!;
    expect(s.market).toEqual({ id: f1.forked.id, v: 1 });
    expect(s.origin?.author).toBe('Fred Weasley');
    expect(mine(w, a).some((e) => /forked your "Wildfire Spark" into "Frost Spark"/.test(e.text))).toBe(true);
    const f2 = forkSpell(w, c.id, f1.forked.id, { source: '(bolt aim 7 :ice)' });
    const d = marketSpell(w, null, f2.forked.id);
    expect(d.name).toBe('Frost Spark II');
    expect(d.lineage.map((x) => [x.id, x.author])).toEqual([[f1.forked.id, 'Luna Lovegood'], [id, 'Fred Weasley']]);
    expect(marketSpell(w, null, id).forkList.map((x) => x.id)).toEqual([f1.forked.id]);
    expect(marketSpell(w, null, id).forks).toBe(1);
    // the fork's author may publish its next version (it is theirs)
    w.forgeSpell(b.id, { name: 'Frost Spark', source: '(bolt aim 8 :ice)' });
    expect(publishSpell(w, b.id, 'Frost Spark')).toMatchObject({ published: f1.forked.id, v: 2 });
    expect(marketSpell(w, null, f1.forked.id).parent).toMatchObject({ id });
    // an unpublished parent stays in the lineage, marked
    unpublishSpell(w, a.id, id);
    expect(marketSpell(w, null, f2.forked.id).lineage[1]).toMatchObject({ id, unpublished: true, author: 'Fred Weasley' });
    // a failed fork lists nothing
    const n = Object.keys(w.market.listings).length;
    expect(() => forkSpell(w, a.id, f1.forked.id, { source: '(nova 3 99 :ice) (apparate aim)' })).toThrow();
    expect(Object.keys(w.market.listings).length).toBe(n);
  });

  it('browse filters by tag, element, year, author and text, sorts, and shows your royalties', () => {
    const { w, a, b, id } = market();
    w.forgeSpell(b.id, { name: 'Moon Mend', source: '(heal self 8)' });
    const m2 = publishSpell(w, b.id, 'Moon Mend').published;
    w.forgeSpell(b.id, { name: 'Nargle Net', source: '(root target 2)' });
    const m3 = publishSpell(w, b.id, 'Nargle Net').published;
    copySpell(w, a.id, m3);
    const ids = (f: Parameters<typeof browseMarket>[2]) => browseMarket(w, a.id, f).listings.map((l) => l.id);
    expect(ids({ tag: 'heal' })).toEqual([m2]);
    expect(ids({ element: 'fire' })).toEqual([id]);
    expect(ids({ year: 1 })).toEqual(expect.arrayContaining([id, m2]));
    expect(ids({ year: 1 })).not.toContain(m3); // root: year 3
    expect(ids({ author: 'luna' }).sort()).toEqual([m2, m3].sort());
    expect(ids({ q: 'weasley firework' })).toEqual([id]);
    expect(ids({ sort: 'popular' })[0]).toBe(m3); // it has a copy
    expect(ids({ sort: 'new' })[0]).toBe(m3);
    const r = browseMarket(w, a.id);
    expect(r.total).toBe(3);
    expect(r.you).toMatchObject({ earnedToday: 0, cap: 20, listings: 1, maxListings: MARKET_MAX_PER_AUTHOR });
    expect(r.rules).toEqual({ royalties: true, dailyCap: 20, perCasterPerDay: 1, parentShare: 0.3 });
    expect(r.listings.find((l) => l.id === m3)!.yours).toBe(false);
  });
});

describe('咒语集市: royalties are bounded', () => {
  it('the pure step: once per (spell, caster) per day, never the caster, never an NPC, the cap holds', () => {
    const d: RoyaltyLedger = { paid: {}, earned: {} };
    const cap = 25;
    expect(royaltyStep(d, { spell: 's', caster: 'c1', author: 'a', parent: null, npc: false }, cap)).toEqual({ author: 10, parent: 0, fresh: true });
    expect(royaltyStep(d, { spell: 's', caster: 'c1', author: 'a', parent: null, npc: false }, cap)).toEqual({ author: 0, parent: 0, fresh: false });
    expect(royaltyStep(d, { spell: 's', caster: 'a', author: 'a', parent: null, npc: false }, cap).fresh).toBe(false);
    expect(royaltyStep(d, { spell: 's', caster: 'n', author: 'a', parent: null, npc: true }, cap).fresh).toBe(false);
    expect(royaltyStep(d, { spell: 's', caster: 'c2', author: 'a', parent: null, npc: false }, cap).author).toBe(10);
    expect(royaltyStep(d, { spell: 's', caster: 'c3', author: 'a', parent: null, npc: false }, cap).author).toBe(5); // up to the cap
    expect(royaltyStep(d, { spell: 's', caster: 'c4', author: 'a', parent: null, npc: false }, cap).author).toBe(0);
    expect(d.earned.a).toBe(cap);
    // a fork: the parent's share, never to the caster or the author themselves
    expect(royaltyStep(d, { spell: 'f', caster: 'c1', author: 'b', parent: 'p', npc: false }, cap)).toEqual({ author: 10, parent: 3, fresh: true });
    expect(royaltyStep(d, { spell: 'f', caster: 'p', author: 'b', parent: 'p', npc: false }, cap)).toEqual({ author: 10, parent: 0, fresh: true });
    expect(royaltyStep(d, { spell: 'f', caster: 'b', author: 'b', parent: 'p', npc: false }, cap)).toEqual({ author: 0, parent: 3, fresh: true });
    expect(royaltyStep(d, { spell: 'g', caster: 'c9', author: 'b', parent: 'b', npc: false }, cap)).toEqual({ author: 5, parent: 0, fresh: true });
    expect(royaltyGrant(30, 10, 25)).toBe(0);
    // random: nobody over the cap, nobody paid for their own casts, no pair paid twice
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    for (let trial = 0; trial < 200; trial++) {
      const L: RoyaltyLedger = { paid: {}, earned: {} };
      const capT = rnd(60);
      const byKey = new Map<string, number>();
      for (let i = 0; i < 120; i++) {
        const author = `w${rnd(5)}`, caster = `w${rnd(6)}`, parent = rnd(3) ? null : `w${rnd(5)}`, spell = `s${rnd(8)}`;
        const r = royaltyStep(L, { spell, caster, author, parent, npc: rnd(7) === 0 }, capT);
        if (caster === author) expect(r.author).toBe(0);
        if (parent === caster || parent === author) expect(r.parent).toBe(0);
        const k = `${spell}|${caster}`;
        byKey.set(k, (byKey.get(k) ?? 0) + r.author);
        expect(byKey.get(k)!).toBeLessThanOrEqual(MARKET_AUTHOR_TENTHS);
        expect(r.parent).toBeLessThanOrEqual(MARKET_PARENT_TENTHS);
      }
      for (const v of Object.values(L.earned)) expect(v).toBeLessThanOrEqual(capT);
    }
  });

  it('in the world: +1 per distinct caster per spell per day, capped per author, no self, no NPC, no fresh alt', () => {
    const { w, a, b, c, id } = market();
    copySpell(w, b.id, id);
    copySpell(w, c.id, id);
    const r0 = rep(a);
    expect(cast(w, a, 'Wildfire Spark').ok).toBe(true); // the author's own casts pay nothing
    expect(rep(a)).toBe(r0);
    expect(cast(w, b, 'Wildfire Spark').ok).toBe(true);
    expect(rep(a)).toBe(r0 + 1);
    expect(cast(w, b, 'Wildfire Spark').ok).toBe(true); // the same caster again today: nothing
    expect(rep(a)).toBe(r0 + 1);
    expect(cast(w, c, 'Wildfire Spark').ok).toBe(true);
    expect(rep(a)).toBe(r0 + 2);
    expect(marketSpell(w, null, id)).toMatchObject({ casts: 3, casters: 2 });
    // a fresh enrolee and an NPC pay nothing
    const alt = wiz(w, 'Fresh Alt', 'hufflepuff', 3);
    alt.createdAt = w.now;
    copySpell(w, alt.id, id);
    expect(cast(w, alt, 'Wildfire Spark').ok).toBe(true);
    const npc = wiz(w, 'Seamus Bot', 'gryffindor', 3);
    copySpell(w, npc.id, id);
    npc.npc = true;
    expect(cast(w, npc, 'Wildfire Spark').ok).toBe(true);
    expect(rep(a)).toBe(r0 + 2);
    // a new day: the same caster pays again, and the author gets a private summary of yesterday
    w.now += MARKET_DAY_S;
    w.tick(0.05); w.tick(1); // the sweep turns the day over
    expect(mine(w, a).some((e) => /2 wizards cast your market spells/.test(e.text) && /2 位巫师/.test(e.zh ?? ''))).toBe(true);
    expect(cast(w, b, 'Wildfire Spark').ok).toBe(true);
    expect(rep(a)).toBe(r0 + 3);
    // the daily cap: many distinct casters, never more than rules.market.dailyCap in a day
    w.rules.market.dailyCap = 4;
    const start = rep(a);
    for (let i = 0; i < 9; i++) { const x = wiz(w, `Fan ${i}`, 'hufflepuff', 3); copySpell(w, x.id, id); expect(cast(w, x, 'Wildfire Spark').ok).toBe(true); }
    expect(rep(a) - start).toBe(3); // 1 already earned today (from b): 3 more reach the cap of 4
    expect(Math.round(w.market.day.earned[a.id])).toBe(40);
    expect(browseMarket(w, a.id).you).toMatchObject({ earnedToday: 4, cap: 4 });
    // royalties off by decree: nothing at all
    w.now += MARKET_DAY_S;
    w.rules.market.royalties = false;
    const before = rep(a);
    expect(cast(w, c, 'Wildfire Spark').ok).toBe(true);
    expect(rep(a)).toBe(before);
  });

  it('a fork pays its author and a small share to its parent\'s author', () => {
    const { w, a, b, c, id } = market();
    const f = forkSpell(w, b.id, id, { source: '(bolt aim 6 :ice)', name: 'Frost Spark' });
    copySpell(w, c.id, f.forked.id);
    const [ra, rb] = [rep(a), rep(b)];
    expect(cast(w, c, 'Frost Spark').ok).toBe(true);
    expect([rep(a) - ra, rep(b) - rb].map((x) => Math.round(x * 10) / 10)).toEqual([0.3, 1]);
    // the fork's author casting their own fork: the parent still gets its share, they get nothing
    expect(cast(w, b, 'Frost Spark').ok).toBe(true);
    expect(Math.round((rep(a) - ra) * 10) / 10).toBe(0.6);
    expect(Math.round((rep(b) - rb) * 10) / 10).toBe(1);
  });
});

describe('咒语集市: the Minister bans and promotes, the DA vetoes', () => {
  function minister(w: World, name = 'Dolores Umbridge') {
    const m = wiz(w, name, 'slytherin', 5);
    m.decreeCharges = 1;
    w.flags.ministerId = m.id;
    return m;
  }

  it('a ban makes every copy fizzle with a lore message (it stays readable); a veto lifts it', () => {
    const { w, a, b, c, id } = market();
    copySpell(w, b.id, id);
    // somebody forges the same words under another name: the ban reaches them too
    w.forgeSpell(c.id, { name: 'Totally Different', source: `(bolt   aim 6\n :fire)` });
    const m = minister(w);
    const bad = w.decree(m.id, { market: { banned: ['m_zz'] } }, undefined, true);
    expect(bad.ok).toBe(false);
    expect(w.decree(m.id, { market: { banned: [id], promoted: [id] } }, undefined, true)).toMatchObject({ ok: false });
    const r = w.decree(m.id, { market: { banned: [id] } }, 'No more fireworks in the corridors.', false);
    expect(r.ok).toBe(true);
    expect(w.events.some((e) => e.type === 'market' && /banned the market spell "Wildfire Spark"/.test(e.text))).toBe(true);
    const mana = b.mana;
    for (const x of [a, b, c]) {
      const k = x === c ? 'Totally Different' : 'Wildfire Spark';
      const rr = cast(w, x, k);
      expect(rr.ok, x.name).toBe(false);
      expect(rr.error).toMatch(/banned by Ministry decree|Educational Decree/);
      expect(rr.error).toMatch(/禁用|禁止/);
    }
    void mana;
    expect(marketSpell(w, b.id, id)).toMatchObject({ banned: true, source: SPARK, canCopy: { ok: false } }); // still readable
    expect(() => copySpell(w, wiz(w, 'Late', 'hufflepuff', 3).id, id)).toThrow(/Banned/);
    expect(() => forkSpell(w, c.id, id, { source: '(bolt aim 5 :fire)' })).toThrow(/Banned/);
    w.forgeSpell(c.id, { name: 'Sneaky', source: SPARK });
    expect(() => publishSpell(w, c.id, 'Sneaky')).toThrow(/banned/);
    expect(w.armory(b.id).spells.find((s) => s.name === 'Wildfire Spark')).toMatchObject({ banned: true });
    // the same words as an item's charm fizzle too (it is a cast like any other)
    w.forgeItem(c.id, c.id, { name: 'Ember Amulet', slot: 'amulet', charm: SPARK });
    const worn = w.useItem(c.id, 'Ember Amulet');
    expect(worn.ok).toBe(false);
    expect(worn.error).toMatch(/banned by Ministry decree|Educational Decree/);
    // Dumbledore's Army vetoes the decree: the ban is lifted, the spell works again
    const da = [wiz(w, 'DA One', 'gryffindor'), wiz(w, 'DA Two', 'hufflepuff'), wiz(w, 'DA Three', 'ravenclaw')];
    for (const x of da) { x.reputation = 0; w.joinDA(x.id); }
    for (const x of da) if (w.vetoDecree(x.id).vetoed) break;
    expect(w.rules.market.banned).toEqual([]);
    expect(w.events.some((e) => e.type === 'market' && /ban on "Wildfire Spark" is lifted/.test(e.text))).toBe(true);
    expect(cast(w, b, 'Wildfire Spark').ok).toBe(true);
    expect(cast(w, c, 'Totally Different').ok).toBe(true);
  });

  it('promotion puts a published spell on the 推荐 shelf; unpublished or banned spells never stay there', () => {
    const { w, a, b, id } = market();
    w.forgeSpell(b.id, { name: 'Moon Mend', source: '(heal self 8)' });
    const m2 = publishSpell(w, b.id, 'Moon Mend').published;
    unpublishSpell(w, b.id, m2);
    const m = minister(w);
    expect(w.decree(m.id, { market: { promoted: [m2] } }, undefined, true)).toMatchObject({ ok: false, errors: [expect.stringMatching(/not published/)] });
    expect(w.decree(m.id, { market: { promoted: [id] } }, undefined, false).ok).toBe(true);
    const r = browseMarket(w, b.id, { sort: 'promoted' });
    expect(r.promoted.map((l) => l.id)).toEqual([id]);
    expect(r.listings[0]).toMatchObject({ id, promoted: true });
    expect(w.events.some((e) => e.type === 'market' && /Recommended by the Ministry/.test(e.text))).toBe(true);
    // the author withdraws it: it leaves the shelf (promoted ⊆ published)
    unpublishSpell(w, a.id, id);
    expect(w.rules.market.promoted).toEqual([]);
    expect(browseMarket(w, b.id).promoted).toEqual([]);
  });

  it('a veto restoring an old promotion drops listings unpublished since (Market.tla PromotedPublished)', () => {
    const { w, a, id } = market();
    const m = minister(w, 'Cornelius Fudge');
    w.rules = { ...w.rules, market: { ...w.rules.market, promoted: [id] } };
    expect(w.decree(m.id, { market: { promoted: [] } }, undefined, false).ok).toBe(true);
    unpublishSpell(w, a.id, id);
    const da = [wiz(w, 'DA One', 'gryffindor'), wiz(w, 'DA Two', 'hufflepuff'), wiz(w, 'DA Three', 'ravenclaw')];
    for (const x of da) { x.reputation = 0; w.joinDA(x.id); }
    for (const x of da) if (w.vetoDecree(x.id).vetoed) break;
    expect(w.decrees.at(-1)!.vetoed).toBe(true);
    expect(w.rules.market.promoted).toEqual([]);
  });

  it('the rulebook bounds the market like any other rule', () => {
    const rb = defaultRulebook();
    expect(rb.market).toEqual({ banned: [], promoted: [], royalties: true, dailyCap: 20 });
    expect(applyPatch(rb, { market: { dailyCap: MARKET_CAP_MAX + 1 } }).ok).toBe(false);
    expect(applyPatch(rb, { market: { dailyCap: 2.5 } }).ok).toBe(false);
    expect(applyPatch(rb, { market: { banned: ['not an id'] } }).ok).toBe(false);
    expect(applyPatch(rb, { market: { banned: Array.from({ length: 17 }, (_, i) => `m_${i}`) } }).ok).toBe(false);
    expect(applyPatch(rb, { market: { promoted: Array.from({ length: 9 }, (_, i) => `m_${i}`) } }).ok).toBe(false);
    expect(applyPatch(rb, { market: { royalties: false, dailyCap: 0 } }).ok).toBe(true);
    expect(applyPatch(rb, { market: { typo: 1 } }).ok).toBe(false);
  });
});

describe('咒语集市: persistence', () => {
  it('listings, versions, lineage, copies\' links, bans and the day\'s ledger survive a restart', () => {
    const { w, a, b, c, id } = market();
    copySpell(w, c.id, id);
    const f = forkSpell(w, b.id, id, { source: '(bolt aim 6 :ice)', name: 'Frost Spark' });
    expect(cast(w, c, 'Wildfire Spark').ok).toBe(true);
    w.rules = { ...w.rules, market: { ...w.rules.market, banned: [f.forked.id] } };
    const w2 = World.restore(JSON.parse(JSON.stringify(w.serialize())), 3);
    expect(Object.keys(w2.market.listings).sort()).toEqual(Object.keys(w.market.listings).sort());
    expect(marketSpell(w2, null, f.forked.id).lineage[0]).toMatchObject({ id, author: 'Fred Weasley' });
    expect(w2.rules.market.banned).toEqual([f.forked.id]);
    expect(w2.wizards.get(c.id)!.spells.find((s) => s.name === 'Wildfire Spark')!.market).toEqual({ id, v: 1 });
    expect(w2.market.day.earned[a.id]).toBe(10);
    // the same caster the same day still pays nothing after the restart
    const c2 = w2.wizards.get(c.id)!, a2 = w2.wizards.get(a.id)!;
    c2.connections = 1;
    const r = a2.reputation;
    expect(cast(w2, c2, 'Wildfire Spark').ok).toBe(true);
    expect(a2.reputation).toBe(r);
    const b2 = w2.wizards.get(b.id)!;
    b2.connections = 1;
    expect(cast(w2, b2, 'Frost Spark').ok).toBe(false);
    // new ids never collide with old ones
    w2.forgeSpell(a.id, { name: 'After Restart', source: '(light 3)' });
    expect(Object.keys(w.market.listings)).not.toContain(publishSpell(w2, a.id, 'After Restart').published);
  });

  it('an old save without a market loads with an empty one and the default rules', () => {
    const w = mk();
    wiz(w, 'Old Timer');
    const data = JSON.parse(JSON.stringify(w.serialize()));
    delete data.market;
    delete data.rules.market;
    const w2 = World.restore(data);
    expect(w2.market).toMatchObject({ seq: 0, listings: {} });
    expect(w2.rules.market).toEqual({ banned: [], promoted: [], royalties: true, dailyCap: 20 });
    expect(browseMarket(w2, null).total).toBe(0);
  });
});

describe('咒语集市: MCP tools and the browser', () => {
  it('market_browse, market_spell, publish_spell, unpublish_spell, copy_spell, fork_spell', async () => {
    const w = mk();
    const a = wiz(w, 'Fred Weasley');
    const b = wiz(w, 'George Weasley');
    w.forgeSpell(a.id, { name: 'Wildfire Spark', source: SPARK });
    const connect = async (wid: string) => {
      const server = createMcpServer(w, { wizardId: wid, baseUrl: 'http://x' });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await server.connect(st);
      const c = new Client({ name: 'test', version: '0' });
      await c.connect(ct);
      const call = async (name: string, args: Record<string, unknown> = {}) => {
        const r = (await c.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
        return { isError: !!r.isError, text: r.content[0].text, data: (() => { try { return JSON.parse(r.content[0].text); } catch { return null; } })() };
      };
      return { c, call };
    };
    const A = await connect(a.id), B = await connect(b.id);
    const tools = (await A.c.listTools()).tools;
    for (const n of ['market_browse', 'market_spell', 'publish_spell', 'unpublish_spell', 'copy_spell', 'fork_spell']) expect(tools.find((t) => t.name === n)?.description?.length, n).toBeGreaterThan(60);
    expect(FEATURE_TOOL_COST).toMatchObject({ publish_spell: 2, unpublish_spell: 1, copy_spell: 3, fork_spell: 3 });
    expect(AGENT_TOOL_COST.market_browse).toBeUndefined();
    const pub = await A.call('publish_spell', { spell: 'Wildfire Spark', desc_zh: '烟火', desc_en: 'fireworks' });
    expect(pub.isError, pub.text).toBe(false);
    const id = pub.data.published;
    const list = await B.call('market_browse', { element: 'fire' });
    expect(list.data.listings.map((l: { id: string }) => l.id)).toEqual([id]);
    const det = await B.call('market_spell', { id });
    expect(det.data).toMatchObject({ source: SPARK, canCopy: { ok: true }, desc: { zh: '烟火', en: 'fireworks' } });
    const focus = w.focusState(b.id).cur;
    const cp = await B.call('copy_spell', { id, name: 'Spark Copy', slot: 5 });
    expect(cp.isError, cp.text).toBe(false);
    expect(w.focusState(b.id).cur).toBe(focus - 3);
    const fk = await B.call('fork_spell', { id, source: '(bolt aim 6 :lightning)', name: 'Thunder Spark' });
    expect(fk.isError, fk.text).toBe(false);
    expect((await A.call('market_spell', { id: fk.data.forked.id })).data.lineage[0].id).toBe(id);
    const same = await B.call('fork_spell', { id, source: SPARK });
    expect(same.isError).toBe(true);
    expect(same.text).toMatch(/must change/);
    expect((await A.call('unpublish_spell', { spell: id })).data.unpublished).toBe(id);
    expect((await B.call('market_browse')).data.listings.map((l: { id: string }) => l.id)).toEqual([fk.data.forked.id]);
    expect(JSON.stringify((await B.call('market_browse')).data)).not.toContain(a.id);
    await A.c.close(); await B.c.close();
  });

  it('the browser messages go through the same syscalls and have their own budgets', () => {
    const { w, a, b, id } = market();
    expect(LIMITS.market).toBeTruthy();
    expect(LIMITS.marketop).toBeTruthy();
    expect(LIMITS.marketop[0]).toBeLessThan(1);
    const r = marketMessage(w, b.id, { t: 'market', op: 'browse', sort: 'new', q: 'spark', limit: 99 });
    expect(r).toMatchObject({ op: 'browse', book: false });
    expect((r.r as { listings: { id: string }[] }).listings.map((l) => l.id)).toEqual([id]);
    expect(marketMessage(w, b.id, { t: 'market', op: 'spell', id })).toMatchObject({ op: 'spell', r: { source: SPARK } });
    expect(marketMessage(w, b.id, { t: 'marketop', op: 'copy', id, slot: 2 })).toMatchObject({ op: 'copy', book: true });
    expect(marketMessage(w, b.id, { t: 'marketop', op: 'fork', id, source: '(bolt aim 5 :ice)', name: 'Ice Spark', desc: { zh: '冷', en: 42 } })).toMatchObject({ op: 'fork', book: true });
    w.forgeSpell(a.id, { name: 'Other', source: '(light 3)' });
    const p = marketMessage(w, a.id, { t: 'marketop', op: 'publish', spell: 'Other', desc: { zh: '光' } });
    expect(p.r).toMatchObject({ v: 1 });
    expect(marketMessage(w, a.id, { t: 'marketop', op: 'unpublish', id: (p.r as { published: string }).published })).toMatchObject({ op: 'unpublish' });
    expect(() => marketMessage(w, a.id, { t: 'marketop', op: 'rm -rf' })).toThrow(/Unknown market action/);
    expect(() => marketMessage(w, a.id, { t: 'market', op: 'spell', id: { evil: true } })).toThrow(/No spell/);
    for (const evil of ['__proto__', 'constructor', 'hasOwnProperty', 'm_zzz']) {
      expect(() => marketSpell(w, a.id, evil), evil).toThrow(/No spell/);
      expect(() => copySpell(w, b.id, evil), evil).toThrow(/No spell/);
    }
  });
});
