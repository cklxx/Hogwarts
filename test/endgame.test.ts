/** 终局 (src/kernel/endgame.ts): N.E.W.T., graduation (prestige), overflow-XP conversion, the Bounty Board. */
import { describe, expect, it } from 'vitest';
import { ENDGAME_FEATURE, homeZone, pickBounties, type Bounty } from '../src/kernel/endgame.js';
import { ECOLOGY_HUNT_COST, ECOLOGY_RESOURCE_MIN, ecologyAfterHunt, ecologyAfterRecovery, ecologyYieldPct } from '../src/kernel/ecology.js';
import type { Wizard } from '../src/kernel/types.js';
import { World } from '../src/kernel/world.js';

function mk() {
  const w = new World({ seed: 5, secret: 'endgame' });
  w.rules.creatures.spawnMultiplier = 0;
  return w;
}
const run = (w: World, s: number) => { for (let i = 0; i < Math.round(s * 20); i++) w.tick(); };
const tool = (name: string) => ENDGAME_FEATURE.tools!.find((t) => t.name === name)!;
const call = (w: World, id: string, name: string, args: Record<string, unknown> = {}) => tool(name).run(w, id, args);

describe('the Bounty Board', () => {
  it('picks three distinct zones a day, stable within the day, and handles shard across zones', () => {
    for (let d = 0; d < 30; d++) {
      const b = pickBounties(d);
      expect(b).toHaveLength(3);
      expect(new Set(b.map((x) => x.zone)).size).toBe(3);
      expect(pickBounties(d)).toEqual(b);
    }
    const zones = new Set(Array.from({ length: 24 }, (_, n) => homeZone(`p${n}`)));
    expect(zones.size).toBeGreaterThan(1);
  });

  it('pays a bounty when the target is slain inside its zone, once', () => {
    const w = mk();
    const a = w.enroll('Seamus').wizard;
    a.connections = 1;
    run(w, 1.1); // baseline before the kills
    const board = call(w, a.id, 'bounty_board') as { bounties: (Bounty & { x: number; z: number; needed: number; claimed: boolean; reward: { reputation: number; galleons: number } })[] };
    const b = board.bounties[0];
    a.pos = { x: b.x, z: b.z };
    const rep0 = a.reputation, gal0 = a.galleons;
    const before = (call(w, a.id, 'bounty_board') as { bounties: { reward: { reputation: number; galleons: number } }[] }).bounties[0].reward;
    a.stats.creatures += b.needed;
    run(w, 1.1);
    const after = call(w, a.id, 'bounty_board') as { bounties: { claimed: boolean }[] };
    expect(after.bounties[0].claimed).toBe(true);
    expect(a.reputation - rep0).toBe(before.reputation);
    expect(a.galleons - gal0).toBeGreaterThanOrEqual(before.galleons);
    expect(a.galleons - gal0).toBeLessThanOrEqual(Math.ceil(before.galleons * 1.4));
    const paid = a.galleons - gal0;
    // nothing twice
    a.stats.creatures += b.needed;
    run(w, 1.1);
    expect(a.galleons - gal0).toBe(paid);
  });
});

describe('regional ecology', () => {
  it('keeps yield bounded while hunting depletes and quiet time recovers', () => {
    expect(ecologyYieldPct(-100)).toBe(60);
    expect(ecologyYieldPct(1000)).toBe(140);
    expect(ecologyAfterHunt(ECOLOGY_RESOURCE_MIN)).toBe(ECOLOGY_RESOURCE_MIN);
    expect(ecologyAfterHunt(70)).toBe(70 - ECOLOGY_HUNT_COST);
    expect(ecologyAfterRecovery(99, 60)).toBe(100);
  });

  it('persists regional resources across restart', () => {
    const w = mk();
    w.ecology.zones.forest.resources = 33;
    w.ecology.zones.forest.pressure.Gryffindor = 29;
    const w2 = World.restore(JSON.parse(JSON.stringify(w.serialize())), 8);
    expect(w2.ecology.zones.forest.resources).toBe(33);
    expect(w2.ecology.zones.forest.pressure.Gryffindor).toBe(29);
  });
});

describe('N.E.W.T.', () => {
  it('refuses before year 7 and lists the papers', () => {
    const w = mk();
    const a = w.enroll('Seamus').wizard;
    const st = call(w, a.id, 'newt', { action: 'status' }) as { eligible: boolean; papers: unknown[] };
    expect(st.eligible).toBe(false);
    expect(st.papers).toHaveLength(5);
    expect(() => call(w, a.id, 'newt', { action: 'sit' })).toThrow(/year 7/);
  });

  it('passes at grade A with three papers and pays once; a better grade pays the difference', () => {
    const w = mk();
    const a = w.enroll('Seamus').wizard;
    a.year = 7;
    a.stats.casts += 120;
    a.stats.creatures += 60;
    a.stats.spells = 1;
    const r = call(w, a.id, 'newt', { action: 'sit' }) as { passed: string; rep: number; galleons: number };
    expect(r.passed).toBe('A');
    expect(r.rep).toBe(50);
    expect(r.galleons).toBe(80);
    expect(a.newt?.grade).toBe('A');
    expect(a.titles).toContain('N.E.W.T. Auror Candidate');
    // same grade again is refused
    expect(() => call(w, a.id, 'newt', { action: 'sit' })).toThrow(/already/);
    // fourth paper (a seal) lifts A to E and pays the multiplier difference
    a.seals = 1;
    const up = call(w, a.id, 'newt', { action: 'sit' }) as { improved: string; rep: number; galleons: number };
    expect(up.improved).toBe('E');
    expect(up.rep).toBe(10);
    expect(up.galleons).toBe(16);
  });

  it('refuses with fewer than three papers', () => {
    const w = mk();
    const a = w.enroll('Seamus').wizard;
    a.year = 7;
    a.stats.casts += 120; // one paper only
    expect(() => call(w, a.id, 'newt', { action: 'sit' })).toThrow(/needs 3/);
  });
});

describe('graduation (prestige)', () => {
  it('requires a passed N.E.W.T., then resets the year and grants one strategy legacy choice', () => {
    const w = mk();
    const a = w.enroll('Seamus').wizard;
    a.year = 7;
    expect(() => call(w, a.id, 'graduate')).toThrow(/N.E.W.T./);
    a.stats.casts += 120;
    a.stats.creatures += 60;
    a.stats.spells = 1;
    call(w, a.id, 'newt', { action: 'sit' });
    const g = call(w, a.id, 'graduate') as { graduated: number; year: number; maxHp: number; maxMana: number; title: string; legacyChoices: number };
    expect(g.graduated).toBe(1);
    expect(g.year).toBe(1);
    expect(a.xp).toBe(0);
    expect(a.newt).toBeNull();
    expect(g.maxHp).toBe(100);
    expect(g.maxMana).toBe(100);
    expect(g.legacyChoices).toBe(1);
    expect(g.title).toBe('Hogwarts Alumnus ×1');
    const chosen = call(w, a.id, 'choose_legacy', { path: 'ranger' }) as { rank: number; available: number };
    expect(chosen).toMatchObject({ rank: 1, available: 0 });
    expect(() => call(w, a.id, 'choose_legacy', { path: 'steward' })).toThrow(/No alumni/);
  });

  it('caps each path and migrates old graduates to unspent choices', () => {
    const w = mk();
    const a = w.enroll('Seamus').wizard;
    a.graduates = 5;
    a.legacies = undefined;
    expect((w.whoami(a.id) as unknown as { endgame: { legacies: { available: number } } }).endgame.legacies.available).toBe(5);
    call(w, a.id, 'choose_legacy', { path: 'ranger' });
    call(w, a.id, 'choose_legacy', { path: 'ranger' });
    call(w, a.id, 'choose_legacy', { path: 'ranger' });
    expect(() => call(w, a.id, 'choose_legacy', { path: 'ranger' })).toThrow(/cap/);
    const wiz: Wizard = a;
    expect(wiz.legacies?.ranger).toBe(3);
    expect(wiz.legacies?.available).toBe(2);
  });
});

describe('overflow-XP conversion', () => {
  it('converts year-7 overflow XP to Galleons and reputation', () => {
    const w = mk();
    const a = w.enroll('Seamus').wizard;
    a.connections = 1;
    a.year = 7;
    a.xp = 3300;
    run(w, 1.1); // baseline at the floor
    const gal0 = a.galleons, rep0 = a.reputation;
    a.xp += 1500; // +3 Galleon tiers, +1 reputation tier
    run(w, 1.1);
    expect(a.galleons - gal0).toBe(3);
    expect(a.reputation - rep0).toBe(1);
  });
});

describe('reputation paths in whoami', () => {
  it('lists at least three paths with reputation numbers', () => {
    const w = mk();
    const a = w.enroll('Seamus').wizard;
    const me = w.whoami(a.id) as unknown as { endgame: { reputationPaths: { en: string }[]; graduates: number } };
    expect(me.endgame.reputationPaths.length).toBeGreaterThanOrEqual(3);
    expect(me.endgame.graduates).toBe(0);
    expect(me.endgame.reputationPaths.some((p) => /\d+/.test(p.en))).toBe(true);
  });
});
