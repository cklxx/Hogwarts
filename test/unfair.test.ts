/**
 * 不公平，但好玩 — "unfair, but fun" (README): the Dark Lord, the asymmetric steal curve, Dumbledore's Army
 * (join / veto / joint spell), learning a spell that hit you (偷师), the lawless deep forest, and agent
 * concentration as a political knob. Plus: Expelliarmus ignores level, and none of it touches canHarm.
 */
import { sceneAt, sceneById } from '../src/shared/scenes.js';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { FORGE_REFUSAL, World } from '../src/kernel/world.js';
import { createMcpServer } from '../src/mcp/server.js';
import { XP_FOR_YEAR, derived, duelSteal, hexHpFloor, jointPct, spellbookSize, stealPct } from '../src/kernel/progression.js';
import { applyPatch, defaultRulebook } from '../src/kernel/rulebook.js';
import { AGENT_TOOL_COST } from '../src/kernel/features.js';
import {
  DA_JOINT_PCT, DA_JOINT_WINDOW_S, DA_QUORUM, DA_VETO_WINDOW_S, DARK_LORD_BROADCAST_S, DARK_LORD_MIN_REP, DARK_LORD_POWER_PCT, DARK_LORD_SEEN_S, LAWLESS_MULT,
  SILENCE_COOLDOWN_S, STEAL_CAP_PCT, STUDY_DELAY_S, STUDY_MEMORY_S, VICTIM_HEX_PER_10MIN,
} from '../src/shared/constants.js';
import { LAWLESS_ZONE, ZONES, inZone, mulberry32 } from '../src/shared/map.js';
import type { Creature, Wizard } from '../src/kernel/types.js';
import { daState, isDaMember, joinDA, leaveDA, reputationMedian, studySpell, studyable, updateDarkLord, vetoDecree } from '../src/kernel/unfair.js';

const DEEP = { x: 143, z: 38 }; // the heart of the lawless zone
function mk(seed = 5) {
  const w = new World({ seed, secret: 'x' });
  w.rules.creatures.spawnMultiplier = 0;
  return w;
}
const run = (w: World, s: number) => { for (let t = 0; t < s; t += 0.05) w.tick(0.05); };
/** An online wizard enrolled long ago (so duels pay and hexes may be sent), at (x, z). */
function wiz(w: World, name: string, house: string, rep = 0, x = 60, z = 60, year = 1): Wizard {
  const a = w.enroll(name, house).wizard;
  a.connections = 1;
  if (a.year < year) w.gainXp(a, XP_FOR_YEAR[year] - a.xp);
  a.createdAt = -10_000;
  a.galleons = 1000;
  a.reputation = rep;
  a.wand = { ...a.wand, core: 'Unicorn hair' }; // no wand-core damage bonus: comparisons stay exact
  a.pos = { x, z };
  a.hp = derived(a, w.rules).maxHp;
  return a;
}
function creature(w: World, x: number, z: number, hp = 10_000): Creature {
  const c: Creature = { id: `c_${x}_${z}_${hp}`, kind: 'troll', pos: { x, z }, home: { x, z }, hp, maxHp: hp, facing: 0, target: null, attackCd: 99, rootedUntil: 0, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
  w.creatures.set(c.id, c);
  return c;
}
const knockOut = (w: World, by: Wizard, v: Wizard) => w.damage(by.id, v.id, 1e6, 'arcane');
/** The features' fields of your own state and of whoami (kernel/feature.ts view), and the snapshot's `dl`. */
type Mine = { darkLord: boolean; da: { jointBadge: number; member: boolean }; studyable: unknown[] };
const me = (w: World, id: string) => w.privateState(id) as ReturnType<World['privateState']> & Mine;
const dlOf = (w: World) => (w.snapshot() as { dl?: unknown }).dl;
const events = (w: World, type: string) => w.events.filter((e) => e.type === type);

// ------------------------------------------------------------------ 输赢代价不对称
describe('the steal curve (输赢代价不对称)', () => {
  it('newcomers 5%, normal 10%, the rich more, the Dark Lord 30% — bounded, monotone, doubled only in the lawless zone', () => {
    expect(stealPct(10, false, 10)).toBe(5);
    expect(stealPct(49, false, 10)).toBe(5);
    expect(stealPct(50, false, 10)).toBe(10);
    expect(stealPct(199, false, 10)).toBe(10);
    expect(stealPct(200, false, 10)).toBe(15);
    expect(stealPct(500, false, 10)).toBe(20);
    expect(stealPct(0, true, 10)).toBe(30);
    expect(stealPct(1000, false, 10, LAWLESS_MULT)).toBe(30); // 20% doubled, capped at 30%
    expect(stealPct(1000, true, 50, 2)).toBe(STEAL_CAP_PCT); // whatever the Minister decrees
    expect(stealPct(1000, true, 0)).toBe(0);
    let prev = 0;
    for (let r = 0; r <= 5000; r += 7) {
      for (const d of [false, true]) for (const b of [0, 5, 10, 25, 50]) for (const m of [1, 2]) {
        const s = duelSteal(r, d, b, m);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s * 100).toBeLessThanOrEqual(r * STEAL_CAP_PCT);
        expect(duelSteal(r, true, b, m)).toBeGreaterThanOrEqual(duelSteal(r, false, b, m));
      }
      const s = duelSteal(r, false, 10);
      expect(s).toBeGreaterThanOrEqual(prev); // monotone in the victim's reputation
      prev = s;
    }
  });

  it('a real duel moves exactly the stolen share and creates only the base (conservation)', () => {
    for (const [rep, pct] of [[30, 5], [100, 10], [300, 15], [800, 20]] as const) {
      const w = mk();
      const a = wiz(w, 'Victor', 'gryffindor', 7);
      const b = wiz(w, 'Victim', 'slytherin', rep);
      const total = a.reputation + b.reputation;
      knockOut(w, a, b);
      const steal = Math.floor((rep * pct) / 100);
      expect(b.reputation).toBe(rep - steal);
      expect(a.reputation).toBe(7 + 10 + steal);
      expect(a.reputation + b.reputation).toBe(total + w.rules.progression.duelRepBase);
    }
  });

  it('stunning the Dark Lord steals 30%, and the lawless forest doubles the duel', () => {
    const w = mk();
    const a = wiz(w, 'Harry', 'gryffindor', 0);
    const v = wiz(w, 'Tom Riddle', 'slytherin', 1000);
    updateDarkLord(w);
    expect(w.darkMark.id).toBe(v.id);
    knockOut(w, a, v);
    expect(v.reputation).toBe(700);
    expect(a.reputation).toBe(310);
    expect(events(w, 'dark').at(-1)!.zh).toMatch(/黑魔王/);
    expect(events(w, 'combat').at(-1)!.text).toMatch(/30% of theirs/);

    const w2 = mk();
    const k = wiz(w2, 'Hunter', 'gryffindor', 0, DEEP.x, DEEP.z);
    const q = wiz(w2, 'Prey', 'slytherin', 100, DEEP.x + 2, DEEP.z);
    expect(w2.inLawless(q.pos)).toBe(true);
    knockOut(w2, k, q);
    expect(q.reputation).toBe(80); // 10% doubled
    expect(k.reputation).toBe(2 * 10 + 20); // base doubled + the share
    expect(events(w2, 'combat').at(-1)!.zh).toMatch(/无规则区翻倍/);
  });
});

// ------------------------------------------------------------------ 黑魔王
describe('the Dark Lord (黑魔王)', () => {
  it('is the reputation #1 (≥ the minimum, a player, seen recently), with hysteresis so it does not flap', () => {
    const w = mk();
    const a = wiz(w, 'Alpha', 'gryffindor', DARK_LORD_MIN_REP - 1);
    const b = wiz(w, 'Beta', 'slytherin', 120);
    expect(updateDarkLord(w)).toBe(null);
    a.reputation = 200;
    expect(updateDarkLord(w)).toBe(a.id);
    expect(events(w, 'dark').at(-1)!.text).toContain('Alpha');
    b.reputation = 215; // #1, but only 107.5% of the holder
    expect(updateDarkLord(w)).toBe(a.id);
    b.reputation = 220; // 110%: takes the mark
    expect(updateDarkLord(w)).toBe(b.id);
    a.reputation = 225; // #1 again but short of 110% of 220: no flapping back
    expect(updateDarkLord(w)).toBe(b.id);
    a.reputation = 242;
    expect(updateDarkLord(w)).toBe(a.id);
    // an NPC never holds it
    const npc = wiz(w, 'Goyle', 'slytherin', 9999);
    npc.npc = true;
    expect(updateDarkLord(w)).toBe(a.id);
    // gone offline for longer than DARK_LORD_SEEN_S: the next in line takes it at once
    a.connections = 0; a.lastMcpAt = -1e9; a.lastSeenAt = w.now;
    w.now += DARK_LORD_SEEN_S - 1;
    expect(updateDarkLord(w)).toBe(a.id);
    w.now += 2;
    expect(updateDarkLord(w)).toBe(b.id);
    // below the minimum: nobody
    b.reputation = 10;
    expect(updateDarkLord(w)).toBe(null);
    expect(events(w, 'dark').at(-1)!.zh).toMatch(/消散/);
  });

  it('is visible: a global `dl` entry in the snapshot, and a bilingual broadcast of the place every minute', () => {
    const w = mk();
    const d = wiz(w, 'Voldy', 'slytherin', 500, 165, 15); // the Forbidden Forest
    run(w, 1.1);
    expect(w.darkMark.id).toBe(d.id);
    expect(dlOf(w)).toEqual({ h: d.handle, n: 'Voldy', x: 165, z: 15, p: 'The Forbidden Forest' });
    const seen = events(w, 'dark').filter((e) => /Forbidden Forest/.test(e.text));
    expect(seen.length).toBe(1);
    expect(seen[0].zh).toMatch(/禁林/);
    expect(seen[0].to).toBeUndefined(); // public
    run(w, DARK_LORD_BROADCAST_S - 2);
    expect(events(w, 'dark').filter((e) => /Forbidden Forest/.test(e.text)).length).toBe(1);
    run(w, 3);
    expect(events(w, 'dark').filter((e) => /Forbidden Forest/.test(e.text)).length).toBe(2);
    expect(w.leaderboard().darkLord).toMatchObject({ name: 'Voldy', place: 'The Forbidden Forest', placeZh: '禁林' });
    expect(me(w, d.id).darkLord).toBe(true);
    expect((w.whoami(d.id) as unknown as Mine).darkLord).toBe(true);
    expect(w.look(wiz(w, 'Onlooker', 'gryffindor', 0, 166, 15).id).wizards.find((x) => x.handle === d.handle)).toMatchObject({ darkLord: true });
  });

  it('hits 15% harder (a bounded bonus) — and Expelliarmus still disarms them from a first… second-year', () => {
    const w = mk();
    const d = wiz(w, 'Dark', 'slytherin', 500, 60, 60, 7);
    const n = wiz(w, 'Plain', 'hufflepuff', 0, 60, 70, 7);
    const c1 = creature(w, 62, 60), c2 = creature(w, 62, 70);
    updateDarkLord(w);
    const hd = w.damage(d.id, c1.id, 10, 'arcane');
    const hn = w.damage(n.id, c2.id, 10, 'arcane');
    expect(hd / hn).toBeCloseTo(DARK_LORD_POWER_PCT / 100, 9);
    // the underdog's answer: a year-2 disarms a year-7 Dark Lord (nothing about disarm scales with level)
    const kid = wiz(w, 'Neville', 'gryffindor', 0, 55, 60, 2); // (west: nothing in between)
    const r = w.cast(kid.id, 'Expelliarmus', { target: d.handle });
    expect(r.ok).toBe(true);
    run(w, 0.5);
    expect(d.st.disarmedUntil).toBeGreaterThan(w.now);
    expect(w.cast(d.id, 'Stupefy', { target: kid.handle }).error).toMatch(/disarmed/);
  });
});

// ------------------------------------------------------------------ 邓布利多军
describe("Dumbledore's Army (邓布利多军)", () => {
  function army(w: World, n: number) {
    return Array.from({ length: n }, (_, i) => wiz(w, `Member ${String.fromCharCode(65 + i)}`, 'gryffindor', 10, 60 + i, 60));
  }
  function minister(w: World, name = 'Umbridge') {
    const m = wiz(w, name, 'slytherin', 90, 80, 80);
    m.decreeCharges = 1;
    w.flags.ministerId = m.id;
    return m;
  }

  it('admits the underdogs (below 100, or below the median), never the Minister or the Dark Lord; members are secret', () => {
    const w = mk();
    const low = wiz(w, 'Low', 'gryffindor', 20);
    const rich = wiz(w, 'Rich', 'slytherin', 400);
    expect(daState(w, low.id).eligible).toBe(true);
    expect(() => joinDA(w, rich.id)).toThrow(/underdogs.*弱者/s);
    joinDA(w, low.id);
    expect(daState(w, low.id).members).toEqual([{ handle: low.handle, name: 'Low', online: true }]);
    expect(daState(w, rich.id).members).toBeUndefined();
    expect(() => joinDA(w, low.id)).toThrow(/already/);
    // below the median qualifies even above the ceiling
    wiz(w, 'Richer', 'ravenclaw', 900); wiz(w, 'Richest', 'hufflepuff', 1000);
    expect(reputationMedian(w)).toBe(650);
    const mid = wiz(w, 'Mid', 'ravenclaw', 300);
    expect(daState(w, mid.id).eligible).toBe(true);
    // a member who becomes the Dark Lord leaves
    joinDA(w, mid.id);
    mid.reputation = 5000;
    updateDarkLord(w);
    expect(isDaMember(w, mid.id)).toBe(false);
    expect(leaveDA(w, low.id).member).toBe(false);
  });

  it('vetoes the Minister\'s decree: quorum of 3 online, strict majority, within the window, once per term', () => {
    const w = mk();
    const [a, b, c, d] = army(w, 4);
    for (const x of [a, b, c, d]) joinDA(w, x.id);
    const m = minister(w);
    const before = JSON.parse(JSON.stringify(w.rules));
    expect(() => vetoDecree(w, a.id)).toThrow(/no decree/);
    expect(w.decree(m.id, { combat: { damageMultiplier: 2 } }, 'Order!', false).ok).toBe(true);
    expect(w.flags.statues.length).toBe(1);
    // c and d are offline: 2 online < quorum 3, however they vote
    for (const x of [c, d]) { x.connections = 0; x.lastMcpAt = -1e9; }
    expect(vetoDecree(w, a.id)).toMatchObject({ vetoed: false, online: 2 });
    expect(vetoDecree(w, b.id)).toMatchObject({ vetoed: false, votes: 2, online: 2 });
    expect(w.rules.combat.damageMultiplier).toBe(2);
    // all four online: a majority of 4 is 3
    c.connections = 1; d.connections = 1;
    const r = vetoDecree(w, c.id);
    expect(r).toMatchObject({ vetoed: true, votes: 3, needed: 3, online: 4, quorum: DA_QUORUM });
    expect(w.rules).toEqual(before);
    expect(w.flags.statues.length).toBe(0);
    expect(w.decrees.at(-1)!.vetoed).toBe(true);
    expect(events(w, 'decree').at(-1)!.zh).toMatch(/邓布利多军否决/);
    // the budget: one veto per term, even if the Minister somehow decreed again
    m.decreeCharges = 1;
    w.decree(m.id, { combat: { damageMultiplier: 3 } }, undefined, false);
    expect(() => vetoDecree(w, a.id)).toThrow(/already used/);
    expect(w.rules.combat.damageMultiplier).toBe(3);
    // a new term, a new budget — but a decree is vetoable only for DA_VETO_WINDOW_S
    w.forceEndTerm();
    const m2 = minister(w, 'Fudge');
    m2.decreeCharges = 1;
    w.decree(m2.id, { combat: { damageMultiplier: 1.5 } }, undefined, false);
    w.now += DA_VETO_WINDOW_S + 1;
    expect(() => vetoDecree(w, a.id)).toThrow(/Too late/);
    run(w, 1.1);
    expect(w.da.veto).toBe(null);
  });

  it('a majority of 3 needs 2 votes, and non-members cannot vote', () => {
    const w = mk();
    const ms = army(w, 3);
    for (const x of ms) joinDA(w, x.id);
    const out = wiz(w, 'Outsider', 'ravenclaw', 10);
    const m = minister(w);
    w.decree(m.id, { magic: { manaRegen: 20 } }, undefined, false);
    expect(() => vetoDecree(w, out.id)).toThrow(/Only members/);
    expect(vetoDecree(w, ms[0].id).vetoed).toBe(false);
    expect(daState(w, ms[1].id).veto).toMatchObject({ votes: 1, needed: 2 });
    expect(vetoDecree(w, ms[1].id).vetoed).toBe(true);
    expect(w.rules.magic.manaRegen).toBe(defaultRulebook().magic.manaRegen);
  });

  it('joint spell: 3 members on one target within DA_JOINT_WINDOW_S deal ×1.25 — never more, and never for outsiders or stragglers', () => {
    const w = mk();
    const ms = army(w, 4);
    for (const x of ms) joinDA(w, x.id);
    const out = wiz(w, 'Outsider', 'ravenclaw', 10);
    const c = creature(w, 70, 60);
    const hit = (x: Wizard) => w.damage(x.id, c.id, 10, 'arcane');
    const base = hit(out);
    expect(hit(ms[0])).toBeCloseTo(base, 9);
    expect(hit(ms[1])).toBeCloseTo(base, 9);
    expect(hit(ms[2]) / base).toBeCloseTo(DA_JOINT_PCT / 100, 9); // the third: Expecto Patronum
    expect(hit(ms[3]) / base).toBeCloseTo(DA_JOINT_PCT / 100, 9); // the fourth: still ×1.25, not more
    expect(hit(ms[0]) / base).toBeCloseTo(DA_JOINT_PCT / 100, 9);
    expect(hit(out)).toBeCloseTo(base, 9);
    expect(events(w, 'da').some((e) => /Expecto Patronum/.test(e.text) && !e.to)).toBe(true);
    // the badge: every joint hitter sees it in their own state, however rate-limited the public line is
    for (const x of ms) expect(me(w, x.id).da.jointBadge).toBeGreaterThan(0);
    expect(me(w, out.id).da.jointBadge).toBe(0);
    for (let n = 0; n < 50; n++) expect(jointPct(n)).toBeLessThanOrEqual(DA_JOINT_PCT);
    // spread out over more than the window: no bonus
    const w2 = mk();
    const m2 = army(w2, 3);
    for (const x of m2) joinDA(w2, x.id);
    const c2 = creature(w2, 70, 60);
    const b2 = w2.damage(m2[0].id, c2.id, 10, 'arcane');
    w2.now += DA_JOINT_WINDOW_S * 0.6; w2.damage(m2[1].id, c2.id, 10, 'arcane');
    w2.now += DA_JOINT_WINDOW_S * 0.6;
    expect(w2.damage(m2[2].id, c2.id, 10, 'arcane')).toBeCloseTo(b2, 9);
  });
});

// ------------------------------------------------------------------ 偷师
describe('learning from the strong (偷师)', () => {
  function duel(year = 3) {
    const w = mk();
    const a = wiz(w, 'Master', 'slytherin', 0, 60, 60, year);
    const b = wiz(w, 'Student', 'gryffindor', 0, 66, 60, 1);
    b.hp = 1e5; // stays up
    w.forgeSpell(a.id, { name: 'Viper Strike', incantation: 'Viperia!', source: '(bolt target 9 :fire)' });
    return { w, a, b };
  }
  const hitWith = (w: World, a: Wizard, b: Wizard, spell: string) => {
    a.globalCd = 0; a.cooldowns = {}; a.mana = 1e4;
    const r = w.cast(a.id, spell, { target: b.handle });
    expect(r.ok, r.error).toBe(true);
    run(w, 0.6);
  };

  it('a custom spell that hit you is readable after 120 s, once, and copies into your book credited to its author', () => {
    const { w, a, b } = duel();
    hitWith(w, a, b, 'Viper Strike');
    expect(studyable(w, b)).toEqual([expect.objectContaining({ spell: 'Viper Strike', from: 'Master', handle: a.handle, readyIn: STUDY_DELAY_S })]);
    expect(() => studySpell(w, b.id, 'Viper Strike')).toThrow(/120s more|偷师要有耐心/);
    w.now += STUDY_DELAY_S;
    // Revelio shows it is ready
    w.cast(b.id, 'Revelio');
    expect(w.events.filter((e) => e.to === b.id).some((e) => /Viper Strike/.test(e.text) && /study_spell/.test(e.text))).toBe(true);
    const r = studySpell(w, b.id, 'viper strike', { copy: true });
    expect(r).toMatchObject({ studied: 'Viper Strike', author: 'Master', source: '(bolt target 9 :fire)', copied: { name: 'Viper Strike' } });
    const copy = b.spells.find((s) => s.name === 'Viper Strike')!;
    expect(copy.origin).toMatchObject({ author: 'Master', handle: a.handle, spell: 'Viper Strike' });
    expect(w.armory(b.id).spells.find((s) => s.name === 'Viper Strike')!.origin!.author).toBe('Master');
    expect(w.events.some((e) => e.to === a.id && /Student studied your spell/.test(e.text))).toBe(true);
    // once per spell: hit again, it is not remembered, and studying again is refused
    hitWith(w, a, b, 'Viper Strike');
    expect(studyable(w, b)).toEqual([]);
    expect(() => studySpell(w, b.id, 'Viper Strike')).toThrow(/No spell called/);
    // the registry id of the author never shows
    expect(JSON.stringify(w.privateState(b.id))).not.toContain(a.id);
  });

  it('respects your own year caps and spellbook size (a failed copy spends nothing), and forgets after 10 minutes', () => {
    const { w, a, b } = duel(3);
    w.forgeSpell(a.id, { name: 'Ring of Fire', source: '(nova 4 8 :fire)' }); // nova: year 3
    // a nova is not aimed: stand the student next to the master
    b.pos = { x: 61, z: 60 };
    a.mana = 1e4; a.globalCd = 0;
    expect(w.cast(a.id, 'Ring of Fire').ok).toBe(true);
    w.now += STUDY_DELAY_S;
    expect(() => studySpell(w, b.id, 'Ring of Fire', { copy: true })).toThrow(/year|nova/i);
    expect(studyable(w, b).map((s) => s.spell)).toContain('Ring of Fire'); // not spent
    w.gainXp(b, XP_FOR_YEAR[3] - b.xp);
    expect(studySpell(w, b.id, 'Ring of Fire', { copy: true, name: 'My Ring' }).copied!.name).toBe('My Ring');
    // spellbook full
    const { w: w2, a: a2, b: b2 } = duel();
    for (let i = 0; i < spellbookSize(b2.year); i++) w2.forgeSpell(b2.id, { name: `Own ${i}`, source: '(light 5)' });
    hitWith(w2, a2, b2, 'Viper Strike');
    w2.now += STUDY_DELAY_S;
    expect(() => studySpell(w2, b2.id, 'Viper Strike', { copy: true })).toThrow(/spellbook holds/);
    // only spells that hit you in the last STUDY_MEMORY_S
    w2.now += STUDY_MEMORY_S;
    expect(studyable(w2, b2)).toEqual([]);
    expect(() => studySpell(w2, b2.id, 'Viper Strike')).toThrow(/No spell called/);
  });

  it('never the curriculum, never an NPC, and a bounded memory', () => {
    const { w, a, b } = duel();
    hitWith(w, a, b, 'Stupefy');
    expect(studyable(w, b)).toEqual([]);
    for (let i = 0; i < 12; i++) {
      w.forgeSpell(a.id, { name: `Spell ${i}`, source: '(bolt target 1)' });
      hitWith(w, a, b, `Spell ${i}`);
      if (a.spells.filter((s) => !s.builtin).length >= spellbookSize(a.year)) w.unlearn(a.id, `Spell ${i}`);
    }
    expect((b.studyHits ?? []).length).toBeLessThanOrEqual(8);
  });
});

// ------------------------------------------------------------------ 无规则区
describe('the lawless zone (无规则区)', () => {
  it('is deep in the Forbidden Forest, its far corner from the gate, never safe, never the grounds', () => {
    const z = ZONES.find((x) => x.id === LAWLESS_ZONE)!;
    const forest = ZONES.find((x) => x.id === 'forest')!;
    expect(Math.hypot(z.x - forest.x, z.z - forest.z) + z.r!).toBeLessThan(forest.r!);
    const gate = sceneById('forest')!.gate!;
    expect(Math.hypot(z.x - gate.x, z.z - gate.z) - z.r!).toBeGreaterThan(45);
    expect(sceneAt(z.x, z.z)?.id).toBe('forest');
    const w = mk();
    expect(w.inLawless(DEEP)).toBe(true);
    expect(w.inSafe(DEEP)).toBe(false);
    expect(w.onGrounds(DEEP)).toBe(false);
    expect(w.placeName(DEEP)).toBe('The Deep Forest');
    expect(inZone(forest, DEEP.x, DEEP.z)).toBe(true);
    expect(applyPatch(w.rules, { combat: { safeZones: ['deep_forest'] } }).ok).toBe(false); // can never be made safe
  });

  it('warns you when you walk in (and out)', () => {
    const w = mk();
    const a = wiz(w, 'Walker', 'gryffindor', 0, DEEP.x - 40, DEEP.z);
    run(w, 1.1);
    expect(w.events.some((e) => e.to === a.id && /Deep Forest/.test(e.text))).toBe(false);
    a.pos = { ...DEEP };
    run(w, 1.1);
    const warn = w.events.filter((e) => e.to === a.id && e.type === 'dark');
    expect(warn.length).toBe(1);
    expect(warn[0].zh).toMatch(/禁林深处.*新生、NPC、一年级依然受保护/s);
    run(w, 3);
    expect(w.events.filter((e) => e.to === a.id && e.type === 'dark').length).toBe(1);
    expect(w.look(a.id).you.lawless).toBe(true);
    a.pos = { x: 60, z: 60 };
    run(w, 1.1);
    expect(w.events.some((e) => e.to === a.id && /leave the Deep Forest/.test(e.text))).toBe(true);
  });

  const parcel = (w: World, from: Wizard, to: Wizard) => w.forgeItem(from.id, to.id, { name: 'Itchy Scarf', slot: 'robe', lore: 'Furnunculus' });
  /** Let the jinx lapse and throw the scarf away, so only the cooldown and the window are left to refuse. */
  const tidy = (w: World, v: Wizard) => { v.auras = []; for (const i of [...v.items]) w.destroyItem(v.id, i.id); };

  it('skips the pair cooldown and the 10-minute window there — and only there', () => {
    const w = mk();
    const s = wiz(w, 'Sender', 'slytherin', 0, DEEP.x, DEEP.z, 2);
    const v = wiz(w, 'Victim', 'gryffindor', 0, DEEP.x + 3, DEEP.z, 2);
    for (let i = 0; i < VICTIM_HEX_PER_10MIN + 2; i++) { parcel(w, s, v); tidy(w, v); }
    // outside: the same sender waits, and other senders meet the window
    v.pos = { x: 60, z: 60 };
    expect(() => parcel(w, s, v)).toThrow(/recently/);
    const others = [1, 2, 3, 4].map((i) => wiz(w, `Other ${i}`, 'slytherin', 0, 70, 70, 2));
    for (let i = 0; i < VICTIM_HEX_PER_10MIN; i++) { parcel(w, others[i], v); tidy(w, v); }
    expect(() => parcel(w, others[3], v)).toThrow(FORGE_REFUSAL);
  });

  it('never lifts the newcomer / NPC / first-year gates, the HP floor or the silence caps', () => {
    const w = mk();
    const s = wiz(w, 'Sender', 'slytherin', 0, DEEP.x, DEEP.z, 2);
    const fresh = wiz(w, 'Fresh', 'gryffindor', 0, DEEP.x + 1, DEEP.z, 2);
    fresh.createdAt = w.now - 60;
    const first = wiz(w, 'Firstie', 'gryffindor', 0, DEEP.x + 2, DEEP.z, 1);
    const npc = wiz(w, 'Seamus', 'gryffindor', 0, DEEP.x + 3, DEEP.z, 2);
    npc.npc = true;
    for (const t of [fresh, first, npc]) expect(() => parcel(w, s, t)).toThrow(FORGE_REFUSAL);
    const v = wiz(w, 'Victim', 'gryffindor', 0, DEEP.x + 4, DEEP.z, 2);
    // the HP floor: jinx damage never goes below it
    parcel(w, s, v);
    const max = derived(v, w.rules).maxHp;
    v.hp = hexHpFloor(max) + 1;
    run(w, 12);
    expect(v.hp).toBeGreaterThanOrEqual(hexHpFloor(max));
    expect(v.st.stunnedUntil).toBe(0);
    // the silence caps: a second Langlock inside the cooldown is dropped
    tidy(w, v);
    w.forgeItem(s.id, v.id, { name: 'Tongue Twister', slot: 'trinket', lore: 'Langlock' });
    const until = v.st.silencedUntil;
    expect(until).toBeGreaterThan(w.now);
    tidy(w, v);
    w.forgeItem(s.id, v.id, { name: 'Tongue Twister 2', slot: 'trinket', lore: 'Langlock' });
    expect(v.st.silencedUntil).toBe(until);
    expect(v.st.silenceCdUntil - until).toBe(SILENCE_COOLDOWN_S);
  });

  it('doubles creature loot (Galleons and XP)', () => {
    const w = mk();
    const out = wiz(w, 'Outside', 'gryffindor', 0, 60, 60);
    const ins = wiz(w, 'Inside', 'gryffindor', 0, DEEP.x, DEEP.z);
    const g0 = [out.galleons, ins.galleons], x0 = [out.xp, ins.xp];
    w.damage(out.id, creature(w, 62, 60, 5).id, 1e6, 'arcane');
    w.damage(ins.id, creature(w, DEEP.x + 2, DEEP.z, 5).id, 1e6, 'arcane');
    expect(ins.galleons - g0[1]).toBe(LAWLESS_MULT * (out.galleons - g0[0]));
    expect(ins.xp - x0[1]).toBeCloseTo(LAWLESS_MULT * (out.xp - x0[0]), 9);
  });
});

// ------------------------------------------------------------------ 专注力
describe('agent concentration (专注力) — a political knob', () => {
  it('action tools spend it, reading is free, it regenerates, and it runs dry with a bilingual retry-after', () => {
    const w = mk();
    const a = wiz(w, 'Agent', 'gryffindor');
    const max = w.rules.agents.maxPerMinute;
    expect(w.spendConcentration(a.id, 'look')).toMatchObject({ ok: true, cost: 0 });
    for (let i = 0; i < max; i++) expect(w.spendConcentration(a.id, 'cast').ok).toBe(true);
    const r = w.spendConcentration(a.id, 'cast');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.retryAfter).toBe(1);
      expect(r.error).toMatch(/wand hand is tired.*持杖手累了.*retry_after=1/s);
    }
    expect(w.spendConcentration(a.id, 'whoami').ok).toBe(true); // reading stays free
    // a restart does not refill it
    expect(World.restore(JSON.parse(JSON.stringify(w.serialize()))).focusState(a.id).cur).toBe(0);
    w.now += 3;
    expect(w.focusState(a.id).cur).toBe(3);
    expect(w.spendConcentration(a.id, 'forge_spell')).toMatchObject({ ok: true, cost: AGENT_TOOL_COST.forge_spell, left: 0 });
    w.now += 1000;
    expect(w.focusState(a.id).cur).toBe(max); // never overfills
    expect(w.privateState(a.id).focus).toEqual({ on: true, cur: max, max, regen: 1 });
  });

  it('the Minister can switch it off by decree; the constitution bounds it', () => {
    const w = mk();
    const a = wiz(w, 'Agent', 'gryffindor');
    const m = wiz(w, 'Minister', 'slytherin', 200);
    m.decreeCharges = 1;
    for (let i = 0; i < 60; i++) w.spendConcentration(a.id, 'cast');
    expect(w.spendConcentration(a.id, 'cast').ok).toBe(false);
    expect(w.decree(m.id, { agents: { concentration: false } }, 'Let the agents run!', false).ok).toBe(true);
    for (let i = 0; i < 500; i++) expect(w.spendConcentration(a.id, 'cast').ok).toBe(true);
    expect(applyPatch(w.rules, { agents: { maxPerMinute: 100000 } }).ok).toBe(false);
    expect(applyPatch(w.rules, { agents: { regen: 0 } }).ok).toBe(false);
    expect(applyPatch(w.rules, { agents: { maxPerMinute: 120, regen: 2 } }).ok).toBe(true);
  });

  it('the MCP layer refuses a tired agent (read-only tools still answer); the browser path never pays', async () => {
    const w = mk();
    const a = wiz(w, 'Agent', 'gryffindor');
    w.rules.agents.maxPerMinute = 10;
    const server = createMcpServer(w, { wizardId: a.id, baseUrl: 'http://x' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const c = new Client({ name: 'test', version: '0' });
    await c.connect(ct);
    const call = async (name: string, args: Record<string, unknown> = {}) => (await c.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    for (let i = 0; i < 10; i++) expect((await call('say', { text: `hi ${i}` })).isError).toBeFalsy();
    const tired = await call('say', { text: 'one more' });
    expect(tired.isError).toBe(true);
    expect(tired.content[0].text).toMatch(/wand hand is tired.*retry_after=/s);
    expect((await call('whoami')).isError).toBeFalsy();
    expect((await call('dumbledores_army')).isError).toBeFalsy();
    // the browser path (World syscalls, as main.ts handleClient uses them) is not charged
    a.globalCd = 0;
    expect(w.cast(a.id, 'Lumos').ok).toBe(true);
    const tools = (await c.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(['dumbledores_army', 'join_dumbledores_army', 'leave_dumbledores_army', 'veto_decree', 'study_spell']));
    await c.close();
  });
});

// ------------------------------------------------------------------ canHarm is untouched
describe('none of it changes who may harm whom', () => {
  it('canHarm is identical with and without the Dark Mark, DA membership and the lawless zone, on 300 random worlds', () => {
    const rnd = mulberry32(77);
    for (let trial = 0; trial < 300; trial++) {
      const w = mk(trial);
      w.rules.combat.pvp = rnd() < 0.7;
      w.rules.combat.friendlyFire = rnd() < 0.5;
      const ws = [0, 1, 2].map((i) => {
        const x = wiz(w, `W${i}`, rnd() < 0.5 ? 'gryffindor' : 'slytherin', Math.floor(rnd() * 400));
        x.pos = rnd() < 0.3 ? { x: 0, z: -56 } : rnd() < 0.5 ? { x: DEEP.x + i, z: DEEP.z } : { x: 60 + i, z: 60 };
        if (rnd() < 0.2) x.st.stunnedUntil = 1;
        return x;
      });
      const c = creature(w, ws[0].pos.x + 1, ws[0].pos.z);
      const ids = [...ws.map((x) => x.id), c.id];
      const matrix = () => ids.flatMap((s) => ids.map((d) => w.canHarm(s, d)));
      const before = matrix();
      updateDarkLord(w);
      for (const x of ws) if (rnd() < 0.5) { try { joinDA(w, x.id); } catch { /* not eligible */ } }
      w.darkMark.id = ws[Math.floor(rnd() * 3)].id;
      expect(matrix()).toEqual(before);
    }
  });
});

// ------------------------------------------------------------------ persistence (the features: kernel/unfair.ts)
describe('saves', () => {
  function world() {
    const w = mk();
    const d = wiz(w, 'Tom Riddle', 'slytherin', 1000);
    const ms = [0, 1, 2].map((i) => wiz(w, `Member ${i}`, 'gryffindor', 10, 60 + i, 60));
    for (const x of ms) joinDA(w, x.id);
    const m = wiz(w, 'Umbridge', 'slytherin', 90, 80, 80);
    m.decreeCharges = 1;
    updateDarkLord(w);
    expect(w.decree(m.id, { combat: { damageMultiplier: 2 } }, 'Order!', false).ok).toBe(true);
    return { w, d, ms };
  }
  const keep = (w: World) => ({ mark: { id: w.darkMark.id, since: w.darkMark.since }, members: w.da.members, vetoTerm: w.da.vetoTerm, veto: w.da.veto });

  it('the Dark Mark and the DA (members, the veto window) survive a restart', () => {
    const { w, ms } = world();
    const back = World.restore(JSON.parse(JSON.stringify(w.serialize())));
    expect(keep(back)).toEqual(keep(w));
    for (const x of ms) back.wizards.get(x.id)!.connections = 1; // (a restart drops every socket)
    expect(vetoDecree(back, ms[0].id).vetoed).toBe(false);
    expect(vetoDecree(back, ms[1].id).vetoed).toBe(true);
    expect(back.rules.combat.damageMultiplier).toBe(1);
  });

  it('a save from before the features (the mark and the DA in flags) loads the same, and the old keys do not linger', () => {
    const { w, d, ms } = world();
    const legacy = JSON.parse(JSON.stringify(w.serialize()));
    const { darkLord, da } = legacy.features;
    delete legacy.features.darkLord; delete legacy.features.da;
    Object.assign(legacy.flags, { darkLordId: darkLord.id, darkLordSince: darkLord.since, da: { members: da.members }, vetoTerm: da.vetoTerm, veto: da.veto });
    const back = World.restore(legacy);
    expect(keep(back)).toEqual(keep(w));
    expect(back.darkMark.id).toBe(d.id);
    expect(back.da.members).toEqual(ms.map((x) => x.id));
    for (const k of ['darkLordId', 'darkLordSince', 'da', 'vetoTerm', 'veto']) expect(back.flags).not.toHaveProperty(k);
    expect(back.serialize().flags).not.toHaveProperty('darkLordId');
    // and one from before any of it: nobody holds the mark, nobody is in the DA
    const older = JSON.parse(JSON.stringify(w.serialize()));
    delete older.features.darkLord; delete older.features.da;
    expect(keep(World.restore(older))).toEqual({ mark: { id: null, since: 0 }, members: [], vetoTerm: 0, veto: null });
  });
});
