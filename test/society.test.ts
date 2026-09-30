/**
 * 社会 — a small society of eight player wizards plays the social loops end to end through the REAL MCP tools, in
 * process (one MCP client per player, the world driven by World.tick at 20 Hz): the Duelling Club, market
 * royalties, the Minister's decree, Dumbledore's Army's veto, the Dark Lord, and the chat channels.
 *
 * Only what a real society would take hours to reach is set up directly (reputation earned over a term, where
 * everyone stands, the end of the term, a day passing); every social ACTION goes through the tool a player's agent
 * would call. When the Minister's human is reachable, the decree tool asks them first: the test answers that ask
 * owl the way the browser does (World.answerAsk), as the human would.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { CONFIRM_YES, createMcpServer } from '../src/mcp/server.js';
import { CHAT_NEAR_M } from '../src/kernel/chat.js';
import { DUEL_BOW_S, DUEL_COUNT_S, DUEL_LOSS_XP, DUEL_WIN_REP, DUEL_WIN_XP } from '../src/kernel/duelclub.js';
import { QUEST_XP } from '../src/kernel/quests.js';
import { World } from '../src/kernel/world.js';
import type { Wizard } from '../src/kernel/types.js';
import {
  DA_QUORUM, DA_VETO_WINDOW_S, DARK_LORD_MIN_REP, MARKET_AUTHOR_TENTHS, MARKET_CAP_DEFAULT, MARKET_DAY_S, STEAL_DARK_LORD_PCT,
} from '../src/shared/constants.js';

// ------------------------------------------------------------------ the society
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Res = { err: boolean; v: any };
type Call = (name: string, args?: Record<string, unknown>) => Promise<Res>;
interface Player { name: string; w: Wizard; call: Call }

/** Eight wizards, two to a house (no canon names: the Sorting Hat takes the preference). */
const CAST = [
  ['Ada Quill', 'Ravenclaw'], ['Bram Oakes', 'Gryffindor'], ['Cora Vane', 'Hufflepuff'], ['Dex Morrow', 'Slytherin'],
  ['Edda Finch', 'Gryffindor'], ['Fenn Rook', 'Ravenclaw'], ['Gwen Pike', 'Hufflepuff'], ['Hal Stroud', 'Slytherin'],
] as const;
/** A clearing in the Highlands (no safe zone, no wall, not the lawless forest). */
const CLEARING = { x: 100, z: 100 };

const run = (w: World, s: number) => { for (let i = 0; i < Math.round(s * 20); i++) w.tick(); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** An unbound MCP session, as an agent connecting for the first time has. */
async function connect(world: World): Promise<Call> {
  const server = createMcpServer(world, { wizardId: null, baseUrl: 'http://society' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const c = new Client({ name: 'society-agent', version: '0' });
  await c.connect(ct);
  return async (name, args = {}) => {
    const r = (await c.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    let v: unknown = r.content[0].text;
    try { v = JSON.parse(r.content[0].text); } catch { /* plain text */ }
    return { err: !!r.isError, v };
  };
}

/**
 * Eight players enrol through `enroll` (the key in the reply is never printed). Setup only: each has a browser tab
 * open (online), enrolled long ago (no newcomer ward, royalties count), and stands in the clearing, 4 m apart.
 */
async function society(seed: number): Promise<{ world: World; p: Player[]; by: (name: string) => Player }> {
  const world = new World({ seed, secret: `society-${seed}` });
  world.rules.creatures.spawnMultiplier = 0; // no trolls wandering into the experiment
  world.rules.events.pool = [];
  world.term.endsAt = 1e12;
  const p: Player[] = [];
  for (const [i, [name, house]] of CAST.entries()) {
    const call = await connect(world);
    const r = await call('enroll', { name, house_preference: house });
    expect(r.err, String(r.v).slice(0, 200)).toBe(false);
    expect(r.v.house).toBe(house);
    const w = world.wizards.get(r.v.registry)!;
    w.connections = 1;
    w.createdAt = -1e6;
    w.pos = { x: CLEARING.x + (i % 4) * 4, z: CLEARING.z + Math.floor(i / 4) * 4 };
    p.push({ name, w, call });
  }
  run(world, 0.1);
  return { world, p, by: (n) => p.find((x) => x.name === n)! };
}

const rep = async (x: Player) => (await x.call('whoami')).v.reputation as number;
/** XP from the day's lessons (今日课表: casting 12 spells is one) since event `since`: not the duel's. */
const lessonXp = (world: World, x: Player, since: number) =>
  world.events.filter((e) => e.id > since && e.to === x.w.id && /^📜 (Today's lesson done|Every lesson today done)/.test(e.text)).length * QUEST_XP;
const eventsOf = async (x: Player) => (await x.call('events', { limit: 100 })).v as { id: number; type: string; text: string; private: boolean }[];
const seesEvent = async (x: Player, re: RegExp) => (await eventsOf(x)).some((e) => re.test(e.text));
/** Set a wizard's reputation (what a term of duels, creatures and events would have earned them). */
const earned = (x: Player, n: number) => { x.w.reputation = n; x.w.termReputation = n; };

/**
 * The Minister enacts a decree through `decree` (dry_run:false). Their human has a browser open, so the tool asks
 * them first with an ask owl; the human approves it (as the browser's owl panel does).
 */
async function enact(world: World, m: Player, patch: Record<string, unknown>, proclamation: string): Promise<Res> {
  const pending = m.call('decree', { patch, proclamation, dry_run: false });
  for (let i = 0; i < 1500; i++) { // up to 30 s of real time (the tool itself waits 45 s for the human)
    await sleep(20);
    const ask = m.w.owlbox.find((o) => o.ask && !o.answered);
    if (ask) { world.answerAsk(m.w.id, ask.id, CONFIRM_YES); break; }
  }
  return pending;
}

/** Cast `spell` at `target` every `every` seconds until `done` (or `max` casts); returns how many were cast. */
async function castUntil(world: World, x: Player, spell: string, target: string, done: () => boolean, every = 0.6, max = 60) {
  let n = 0;
  for (let i = 0; i < max && !done(); i++) {
    const r = await x.call('cast', { spell, target });
    if (!r.err && r.v.ok) n++;
    run(world, every);
  }
  return n;
}

// ------------------------------------------------------------------ 1. the Duelling Club
describe('society: the Duelling Club', () => {
  it('two players join, the match starts, one knocks the other out with casts, the ledger pays as documented; a rematch pays nothing', async () => {
    const { world, by } = await society(101);
    const bram = by('Bram Oakes'), edda = by('Edda Finch'), ada = by('Ada Quill');
    const rep0 = await rep(bram), xpB = bram.w.xp, xpE = edda.w.xp, ev0 = world.events.at(-1)!.id;

    const j1 = await bram.call('duel_club', { op: 'join' });
    expect(j1.err).toBe(false);
    expect(j1.v.you).toEqual({ position: 1, mode: '1v1' });
    expect((await edda.call('duel_club', { op: 'join' })).err).toBe(false);
    run(world, 0.1);
    // a spectator sees the match (housemates duel: the club ignores houses)
    const seen = (await ada.call('duel_club', { op: 'status' })).v;
    expect(seen.match).toMatchObject({ a: 'Bram Oakes', b: 'Edda Finch', mode: '1v1', phase: 'bow' });
    // bowing: no casting yet
    const early = await bram.call('cast', { spell: 'Stupefy', target: 'Edda Finch' });
    expect(early.v.ok).toBe(false);
    expect(early.v.error).toMatch(/countdown/);
    run(world, DUEL_BOW_S + DUEL_COUNT_S + 0.1);
    expect((await bram.call('duel_club', { op: 'status' })).v.match.phase).toBe('fight');
    // nobody from the crowd may interfere
    const meddle = await ada.call('cast', { spell: 'Stupefy', target: 'Bram Oakes' });
    expect(meddle.v.ok).toBe(false);
    expect(meddle.v.error).toMatch(/Duelling Club match/);

    // Bram attacks every 0.6 s; Edda answers now and then
    let round = 0;
    const over = () => !world.duel.match;
    while (!over() && round < 80) {
      await bram.call('cast', { spell: 'Stupefy', target: 'Edda Finch' });
      if (round % 4 === 0) await edda.call('cast', { spell: 'Stupefy', target: 'Bram Oakes' });
      run(world, 0.6);
      round++;
    }
    expect(over()).toBe(true);
    const st = (await ada.call('duel_club', { op: 'status' })).v;
    expect(st.match).toBeNull();
    expect(st.last[0]).toMatchObject({ a: 'Bram Oakes', b: 'Edda Finch', winner: 'Bram Oakes' });
    // documented: +DUEL_WIN_REP reputation and DUEL_WIN_XP to the winner, DUEL_LOSS_XP to the loser
    expect((await rep(bram)) - rep0).toBe(DUEL_WIN_REP);
    expect(bram.w.xp - xpB - lessonXp(world, bram, ev0)).toBe(DUEL_WIN_XP);
    expect(edda.w.xp - xpE - lessonXp(world, edda, ev0)).toBe(DUEL_LOSS_XP);
    expect((await bram.call('duel_club', { op: 'status' })).v.winsThisTerm).toBe(1);
    expect(await seesEvent(ada, /Bram Oakes beat Edda Finch knocked out/)).toBe(true);
    // both healed after the bell
    expect(edda.w.hp).toBe(world.derivedOf(edda.w).maxHp);

    // the same pair again within ten minutes: a real fight, no reward (DUEL_PAIR_GAP_S)
    await bram.call('duel_club', { op: 'join' });
    await edda.call('duel_club', { op: 'join' });
    run(world, 0.1 + DUEL_BOW_S + DUEL_COUNT_S + 0.1);
    expect(world.duel.match?.phase).toBe('fight');
    const rep1 = await rep(bram), xp1 = bram.w.xp, ev1 = world.events.at(-1)!.id;
    await castUntil(world, bram, 'Stupefy', 'Edda Finch', over);
    expect(over()).toBe(true);
    expect(world.duel.last.at(-1)?.winner).toBe(bram.w.id);
    expect(await seesEvent(ada, /Bram Oakes beat Edda Finch knocked out .*a rematch: no reward/)).toBe(true);
    expect(await rep(bram)).toBe(rep1);
    expect(bram.w.xp - xp1 - lessonXp(world, bram, ev1)).toBe(0);
    expect((await bram.call('duel_club', { op: 'status' })).v.winsThisTerm).toBe(1);
  }, 60000);
});

// ------------------------------------------------------------------ 2. the spell market
describe('society: the spell market', () => {
  it('A publishes, B and C copy, B casts: A is paid once per caster per spell per day, never for her own casts, and never above the daily cap', async () => {
    const { world, p, by } = await society(202);
    const ada = by('Ada Quill'), bram = by('Bram Oakes'), cora = by('Cora Vane');
    // three harmless spells (self-only: nobody in the clearing is hit by a stray bolt)
    const SPELLS = [['Quill Mend', '(heal self 5)'], ['Quill Ward', '(shield self 5 2)'], ['Quill Lamp', '(light 10)']] as const;
    const ids: string[] = [];
    for (const [name, source] of SPELLS) {
      const f = await ada.call('forge_spell', { name, source });
      expect(f.err, String(f.v)).toBe(false);
      const pub = await ada.call('publish_spell', { spell: name, desc_en: 'Ada\'s own', desc_zh: '艾达自创' });
      expect(pub.err, String(pub.v)).toBe(false);
      ids.push(pub.v.published);
    }
    const browse = (await bram.call('market_browse', { author: 'Ada' })).v;
    expect(browse.total).toBe(3);

    const r0 = await rep(ada);
    const cp = await bram.call('copy_spell', { id: ids[0] });
    expect(cp.err, String(cp.v)).toBe(false);
    expect(cp.v.from.author).toBe('Ada Quill');
    expect((await cora.call('copy_spell', { id: ids[0] })).err).toBe(false);
    expect(await rep(ada)).toBe(r0); // copying pays nothing: casting does
    expect((await eventsOf(ada)).some((e) => e.private && /Bram Oakes/.test(e.text) && /Quill Mend/.test(e.text))).toBe(true); // she is told who copied it

    // B casts it: +1 to Ada. Casting it again the same day: nothing more.
    const c1 = await bram.call('cast', { spell: 'Quill Mend' });
    expect(c1.v.ok, c1.v.error).toBe(true);
    expect((await rep(ada)) - r0).toBe(MARKET_AUTHOR_TENTHS / 10);
    run(world, 1);
    expect((await bram.call('cast', { spell: 'Quill Mend' })).v.ok).toBe(true);
    expect((await rep(ada)) - r0).toBe(1);
    // her own cast pays her nothing
    expect((await ada.call('cast', { spell: 'Quill Mend' })).v.ok).toBe(true);
    expect((await rep(ada)) - r0).toBe(1);
    // C's first cast: +1
    expect((await cora.call('cast', { spell: 'Quill Mend' })).v.ok).toBe(true);
    expect((await rep(ada)) - r0).toBe(2);

    // the rest of the society copies and casts all three: 7 casters × 3 spells = 21 fresh (caster, spell) pairs,
    // but an author earns at most rules.market.dailyCap (default MARKET_CAP_DEFAULT) a day from royalties
    run(world, 1);
    for (const x of p.filter((y) => y !== ada)) {
      for (const id of ids) {
        if (x.w.spells.some((s) => s.market?.id === id)) continue;
        const r = await x.call('copy_spell', { id });
        expect(r.err, `${x.name}: ${String(r.v)}`).toBe(false);
      }
      for (const [name] of SPELLS) {
        const r = await x.call('cast', { spell: name });
        expect(r.v.ok, `${x.name} ${name}: ${r.v.error}`).toBe(true);
        run(world, 0.4);
      }
    }
    expect(7 * 3).toBeGreaterThan(MARKET_CAP_DEFAULT);
    expect((await rep(ada)) - r0).toBe(MARKET_CAP_DEFAULT);
    const mine = (await ada.call('market_browse', { mine: true })).v;
    expect(mine.you.earnedToday).toBe(MARKET_CAP_DEFAULT);
    expect(mine.you.cap).toBe(MARKET_CAP_DEFAULT);
    expect(mine.you.castersToday).toBe(7);
    const card = mine.listings.find((l: { id: string }) => l.id === ids[0]);
    expect(card).toMatchObject({ copies: 7, casters: 7 });

    // a day later (setup: the clock moves on) the ledger starts over
    world.now += MARKET_DAY_S;
    run(world, 1.1);
    const r1 = await rep(ada);
    expect((await bram.call('cast', { spell: 'Quill Lamp' })).v.ok).toBe(true);
    expect((await rep(ada)) - r1).toBe(1);
    expect((await ada.call('market_browse', { mine: true })).v.you.earnedToday).toBe(1);
  }, 60000);
});

// ------------------------------------------------------------------ 3. the term ends: a Minister and a decree
describe('society: the Minister for Magic', () => {
  it('the top-reputation player (never the NPC above them) becomes Minister, decrees through `decree`, the rulebook changes, and everyone sees it', async () => {
    const { world, p, by } = await society(303);
    const ada = by('Ada Quill'), bram = by('Bram Oakes'), hal = by('Hal Stroud');
    // setup: a term of play. An NPC leads the board by far (NPCs duel all day); Ada is the best player.
    const npc = world.enroll('Old Stallkeeper', 'Hufflepuff').wizard;
    npc.npc = true; npc.connections = 1; npc.createdAt = -1e9; npc.pos = { x: 160, z: 160 };
    npc.reputation = 900;
    p.forEach((x, i) => earned(x, 20 + 5 * i));
    earned(ada, 140);
    const board = (await hal.call('leaderboard')).v;
    expect(board.top[0]).toMatchObject({ name: 'Old Stallkeeper', npc: true });
    expect(board.ministerInLine).toBe('Ada Quill');
    expect(board.minister).toBeNull();
    // before the term ends nobody may decree
    expect((await ada.call('decree', { patch: { combat: { damageMultiplier: 1.5 } } })).err).toBe(true);

    world.term.endsAt = world.now + 0.05; // setup: the term runs out
    run(world, 0.2);
    const after = (await hal.call('leaderboard')).v;
    expect(after.minister).toEqual({ name: 'Ada Quill', decreeUnspent: true });
    expect(world.flags.ministerId).toBe(ada.w.id);
    expect(npc.decreeCharges).toBe(0);
    expect((await ada.call('whoami')).v.decreeCharges).toBe(1);
    for (const x of p) expect(await seesEvent(x, /Ada Quill \(\d+ reputation\) is appointed Minister for Magic/)).toBe(true);

    // only the Minister decrees
    const bramTry = await bram.call('decree', { patch: { combat: { damageMultiplier: 1.5 } }, dry_run: false });
    expect(bramTry.err).toBe(true);
    expect(bramTry.v).toMatch(/Only the Minister for Magic/);
    // out of the constitution's bounds: refused, still unspent
    const bad = (await ada.call('decree', { patch: { combat: { damageMultiplier: 10 } } })).v;
    expect(bad.ok).toBe(false);
    // the dry run changes nothing
    const dry = (await ada.call('decree', { patch: { combat: { damageMultiplier: 1.5 } }, proclamation: 'Wands sharper!' })).v;
    expect(dry).toMatchObject({ ok: true });
    expect(dry.wouldChange.join(' ')).toMatch(/damageMultiplier/);
    expect(world.rules.combat.damageMultiplier).toBe(1);

    const r = await enact(world, ada, { combat: { damageMultiplier: 1.5 } }, 'Wands sharper!');
    expect(r.err, String(r.v)).toBe(false);
    expect(r.v).toMatchObject({ ok: true, approvedBy: 'your human (browser)' });
    const book = (await hal.call('rulebook')).v;
    expect(book.rules.combat.damageMultiplier).toBe(1.5);
    expect(book.decrees).toHaveLength(1);
    expect(book.decrees[0]).toMatchObject({ minister: 'Ada Quill', proclamation: 'Wands sharper!' });
    for (const x of p) {
      expect(await seesEvent(x, /EDUCATIONAL DECREE by Minister Ada Quill: "Wands sharper!"/)).toBe(true);
      expect(await seesEvent(x, /statue of Minister Ada Quill rises/)).toBe(true);
    }
    // once per term
    expect((await ada.call('whoami')).v.decreeCharges).toBe(0);
    expect((await ada.call('decree', { patch: { combat: { damageMultiplier: 2 } }, dry_run: false })).err).toBe(true);
    expect(world.rules.combat.damageMultiplier).toBe(1.5);
  }, 60000);
});

// ------------------------------------------------------------------ 4. Dumbledore's Army
describe("society: Dumbledore's Army", () => {
  /** A society whose best player (Ada) becomes Minister at the end of the term; the others are underdogs. */
  async function withMinister(seed: number) {
    const s = await society(seed);
    s.p.forEach((x, i) => earned(x, 10 + 3 * i));
    earned(s.by('Ada Quill'), 120);
    return s;
  }
  const endTerm = (world: World) => { world.term.endsAt = world.now + 0.05; run(world, 0.2); };

  it('a quorum joins, the Minister decrees, a strict majority vetoes within the window: the rulebook is restored and everyone hears', async () => {
    const { world, p, by } = await withMinister(404);
    const ada = by('Ada Quill');
    const army = ['Bram Oakes', 'Cora Vane', 'Dex Morrow', 'Edda Finch', 'Fenn Rook'].map(by);
    // the favourite is no underdog
    const no = await ada.call('join_dumbledores_army');
    expect(no.err).toBe(true);
    expect(no.v).toMatch(/underdogs/);
    for (const x of army) { const r = await x.call('join_dumbledores_army'); expect(r.err, String(r.v)).toBe(false); }
    const st = (await army[0].call('dumbledores_army')).v;
    expect(st).toMatchObject({ member: true, size: 5, online: 5, quorum: DA_QUORUM });
    expect(st.members.map((m: { name: string }) => m.name).sort()).toEqual(army.map((x) => x.name).sort());
    expect((await by('Gwen Pike').call('dumbledores_army')).v.members).toBeUndefined(); // secret to outsiders
    // no decree yet: nothing to veto
    expect((await army[0].call('veto_decree')).err).toBe(true);

    endTerm(world);
    expect(world.flags.ministerId).toBe(ada.w.id);
    const before = JSON.stringify(world.rules);
    const d = await enact(world, ada, { combat: { pvp: false } }, 'No more duelling in the corridors.');
    expect(d.err, String(d.v)).toBe(false);
    expect(world.rules.combat.pvp).toBe(false);
    expect(world.flags.statues).toHaveLength(1);
    const open = (await army[0].call('dumbledores_army')).v.veto;
    expect(open).toMatchObject({ usedThisTerm: false, votes: 0, needed: 3 });
    expect(open.decree.minister).toBe('Ada Quill');
    expect(open.decree.secondsLeft).toBeLessThanOrEqual(DA_VETO_WINDOW_S);

    // an outsider cannot vote
    const gwen = await by('Gwen Pike').call('veto_decree');
    expect(gwen.err).toBe(true);
    expect(gwen.v).toMatch(/Only members/);
    run(world, 5);
    // 5 online: ⌊5/2⌋ + 1 = 3 votes (a strict majority)
    expect((await army[0].call('veto_decree')).v).toMatchObject({ vetoed: false, votes: 1, needed: 3 });
    expect((await army[1].call('veto_decree')).v).toMatchObject({ vetoed: false, votes: 2, needed: 3 });
    expect((await army[0].call('veto_decree')).v).toMatchObject({ vetoed: false, votes: 2 }); // voting twice counts once
    expect(world.rules.combat.pvp).toBe(false);
    expect((await army[2].call('veto_decree')).v).toMatchObject({ vetoed: true, votes: 3, needed: 3, online: 5 });
    expect(JSON.stringify(world.rules)).toBe(before);
    expect((await by('Hal Stroud').call('rulebook')).v.decrees[0].vetoed).toBe(true);
    expect(world.flags.statues).toHaveLength(0);
    for (const x of p) expect(await seesEvent(x, /Dumbledore's Army has vetoed Minister Ada Quill's decree/)).toBe(true);
    // once per term
    const again = await army[3].call('veto_decree');
    expect(again.err).toBe(true);
    expect(again.v).toMatch(/already used its veto this term/);
  }, 60000);

  it('below the quorum the votes do not veto; once the window closes the decree stands, and a late vote says it came too late', async () => {
    const { world, by } = await withMinister(405);
    const ada = by('Ada Quill');
    const two = ['Bram Oakes', 'Cora Vane'].map(by);
    for (const x of two) expect((await x.call('join_dumbledores_army')).err).toBe(false);
    expect(two.length).toBeLessThan(DA_QUORUM);
    endTerm(world);
    const d = await enact(world, ada, { combat: { damageMultiplier: 0.5 } }, 'Gentler wands.');
    expect(d.err, String(d.v)).toBe(false);
    // both of them vote: 2 of 2 online — unanimous, but below the quorum of 3
    expect((await two[0].call('veto_decree')).v).toMatchObject({ vetoed: false, votes: 1, online: 2, quorum: DA_QUORUM });
    expect((await two[1].call('veto_decree')).v).toMatchObject({ vetoed: false, votes: 2, online: 2, quorum: DA_QUORUM });
    expect(world.rules.combat.damageMultiplier).toBe(0.5);
    // the window closes
    run(world, DA_VETO_WINDOW_S + 2);
    const late = await two[0].call('veto_decree');
    expect(late.err).toBe(true);
    expect(late.v).toMatch(/Too late/);
    expect(world.rules.combat.damageMultiplier).toBe(0.5);
    expect(world.decrees[0].vetoed).toBeFalsy();
    expect((await two[0].call('dumbledores_army')).v.veto.decree).toBeNull();
  }, 60000);
});

// ------------------------------------------------------------------ 5. the Dark Lord
describe('society: the Dark Lord', () => {
  it('the top player above DARK_LORD_MIN_REP takes the mark and is broadcast; another player stuns them and takes the Dark Lord\'s share', async () => {
    const { world, p, by } = await society(505);
    const dex = by('Dex Morrow'), bram = by('Bram Oakes'), cora = by('Cora Vane');
    p.forEach((x, i) => earned(x, 5 + i));
    earned(dex, DARK_LORD_MIN_REP - 1);
    run(world, 1.1); // the 1 Hz sweep: the top player, but below the threshold
    expect(world.darkMark.id).toBeNull();
    earned(dex, 200);
    expect(200).toBeGreaterThanOrEqual(DARK_LORD_MIN_REP);
    run(world, 1.1);
    expect(world.darkMark.id).toBe(dex.w.id);
    const board = (await cora.call('leaderboard')).v;
    expect(board.darkLord).toMatchObject({ name: 'Dex Morrow', reputation: 200 });
    expect((await dex.call('whoami')).v.darkLord).toBe(true);
    for (const x of p) {
      expect((await eventsOf(x)).some((e) => e.type === 'dark' && /Dex Morrow/.test(e.text) && /Dark Lord|He-Who-Must-Not-Be-Named/.test(e.text))).toBe(true);
      expect((await eventsOf(x)).some((e) => e.type === 'dark' && /Dark Mark hangs over|was seen at|Dex Morrow is at/.test(e.text))).toBe(true);
    }
    // a rival close behind does not take it (hysteresis: 110%)
    earned(cora, 215);
    run(world, 1.1);
    expect(world.darkMark.id).toBe(dex.w.id);
    earned(cora, 30);

    // Bram faces the Dark Lord alone in the clearing (setup: where they stand)
    for (const x of p) if (x !== dex && x !== bram) x.w.pos = { x: 160 + p.indexOf(x) * 3, z: 160 };
    bram.w.pos = { x: 100, z: 100 };
    dex.w.pos = { x: 100, z: 112 };
    run(world, 0.1);
    const dex0 = dex.w.reputation, bram0 = bram.w.reputation;
    await castUntil(world, bram, 'Stupefy', 'Dex Morrow', () => dex.w.st.stunnedUntil > 0, 0.6, 80);
    expect(dex.w.st.stunnedUntil).toBeGreaterThan(0);
    const steal = Math.floor((dex0 * STEAL_DARK_LORD_PCT) / 100);
    expect(dex.w.reputation).toBe(dex0 - steal);
    expect(bram.w.reputation).toBe(bram0 + world.rules.progression.duelRepBase + steal);
    for (const x of p) expect(await seesEvent(x, new RegExp(`Bram Oakes stunned the Dark Lord Dex Morrow and took ${steal} reputation|The Dark Lord Dex Morrow falls to Bram Oakes \\(-${steal} reputation\\)`))).toBe(true);
    // below the threshold now, with nobody else eligible: the mark fades
    run(world, 1.1);
    expect(world.darkMark.id).toBeNull();
    expect((await cora.call('leaderboard')).v.darkLord).toBeNull();
  }, 60000);
});

// ------------------------------------------------------------------ 6. chat
describe('society: chat channels', () => {
  it('house reaches the house, near reaches whoever is within reach, a whisper reaches exactly one', async () => {
    const { world, p, by } = await society(606);
    const ada = by('Ada Quill'), fenn = by('Fenn Rook'), bram = by('Bram Oakes'), gwen = by('Gwen Pike'), hal = by('Hal Stroud'), cora = by('Cora Vane');
    const heard = async (x: Player, re: RegExp) => ((await x.call('chat', { op: 'read', limit: 50 })).v.lines as { text: string }[]).some((l) => re.test(l.text));

    // house: Ravenclaw only
    const h = await ada.call('chat', { text: 'Ravenclaw, meet at the lake.', ch: 'house' });
    expect(h.v).toEqual({ sent: 'house', heardBy: 1 });
    for (const x of p) expect(await heard(x, /meet at the lake/)).toBe(x.w.house === 'Ravenclaw');

    // near: Hal walks off beyond CHAT_NEAR_M (setup: where he stands)
    hal.w.pos = { x: CLEARING.x + CHAT_NEAR_M + 40, z: CLEARING.z };
    run(world, 0.1);
    const n = await cora.call('chat', { text: 'Anyone for a duel?', ch: 'near' });
    expect(n.v).toEqual({ sent: 'near', heardBy: 6 });
    for (const x of p) expect(await heard(x, /Anyone for a duel/)).toBe(x !== hal);

    // a whisper: the two of them only; never by a registry number
    const dm = await bram.call('chat', { text: 'I know who the Minister is.', ch: 'dm', to: 'Gwen Pike' });
    expect(dm.v).toEqual({ sent: 'dm', heardBy: 1 });
    for (const x of p) expect(await heard(x, /I know who the Minister is/)).toBe(x === bram || x === gwen);
    const inbox = (await gwen.call('inbox')).v;
    expect(JSON.stringify(inbox)).toMatch(/I know who the Minister is/);
    const byId = await bram.call('chat', { text: 'psst', ch: 'dm', to: gwen.w.id });
    expect(byId.err).toBe(true);

    // all: the whole school
    const all = await fenn.call('chat', { text: 'Good luck in the exams, everyone!', ch: 'all' });
    expect(all.err).toBe(false);
    for (const x of p) expect(await heard(x, /Good luck in the exams/)).toBe(true);
  }, 60000);
});
