import { describe, expect, it } from 'vitest';
import { World } from '../src/kernel/world.js';
import type { Creature, Wizard } from '../src/kernel/types.js';
import { WATER_TAG, WET_S } from '../src/shared/chem.js';
import { CHEM_FEATURE } from '../src/kernel/chem.js';
import { splitWaterAssistXp, WATER_ASSIST_DIVISOR, WATER_ASSIST_MAX, WATER_ASSIST_R, WATER_ASSIST_S } from '../src/kernel/water-assist.js';
import { readFileSync } from 'node:fs';

const at = { x: 40, z: 20 };
function setup() {
  const world = new World({ seed: 31, secret: 'water-assist-test' });
  world.rules.creatures.spawnMultiplier = 0;
  world.rules.events.pool = [];
  world.rules.combat.elementStatuses = false;
  const player = (name: string, house: string) => {
    const p = world.enroll(name, house as never).wizard;
    p.connections = 1; p.createdAt = -1e6; p.pos = { x: at.x, z: at.z - 8 };
    return p;
  };
  const helper = player('Water Helper', 'Slytherin'), attacker = player('Fire Partner', 'Gryffindor');
  const c: Creature = { id: 'water-test-troll', kind: 'troll', pos: { ...at }, home: { ...at }, hp: 1000, maxHp: 1000, facing: 0, target: null, attackCd: 99, rootedUntil: 0, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
  world.creatures.set(c.id, c);
  const water = (p: Wizard = helper) => world.damage(p.id, c.id, 1, 'arcane', [WATER_TAG]);
  const react = (p: Wizard = attacker) => world.damage(p.id, c.id, 10, 'fire');
  const kill = () => world.damage(attacker.id, c.id, 2000, 'arcane');
  return { world, helper, attacker, c, water, react, kill };
}

describe('real water cooperation distributes existing kill XP only', () => {
  it('different houses receive 25%/75% only after a real kill, with no extra rep, money or kill credit', () => {
    const { helper, attacker, water, react, kill } = setup();
    const before = { rep: helper.reputation, gold: helper.galleons, kills: helper.stats.creatures };
    water(); react();
    expect(helper.xp).toBe(0);
    kill();
    expect(helper.xp).toBe(35); expect(attacker.xp).toBe(105);
    expect(helper.xp + attacker.xp).toBe(140);
    expect({ rep: helper.reputation, gold: helper.galleons, kills: helper.stats.creatures }).toEqual(before);
    expect(attacker.stats.creatures).toBe(1);
  });
  it('repeated water and multiple reactions do not multiply the one helper share', () => {
    const { helper, attacker, water, react, kill } = setup();
    for (let i = 0; i < 8; i++) { water(); water(); react(); }
    kill();
    expect([helper.xp, attacker.xp]).toEqual([35, 105]);
  });
  it('two distinct helpers share one bounded pool; a second jet cannot steal live provenance', () => {
    const { world, helper, attacker, c, water, react, kill } = setup();
    const second = world.enroll('Second Helper', 'Hufflepuff').wizard;
    second.connections = 1; second.pos = { ...helper.pos };
    water(); water(second); react();
    expect(world.chem.waterAssists.get(c.id)?.has(second.id)).toBe(false);
    water(second); react(); kill();
    expect([helper.xp, second.xp, attacker.xp]).toEqual([18, 17, 105]);
    expect(world.chem.waterAssists.has(c.id)).toBe(false);
    expect(world.chem.waterSources.has(c.id)).toBe(false);
  });
  it('rain overwrites natural wet provenance, and missing/expired creatures are swept', () => {
    const { world, helper, c, water, react, kill } = setup();
    water(); world.rules.world.weather = 'rain'; CHEM_FEATURE.sweep!(world);
    expect(world.chem.waterSources.has(c.id)).toBe(false);
    react(); kill(); expect(helper.xp).toBe(0);
    const fresh = setup(); fresh.water(); fresh.react();
    fresh.world.creatures.delete(fresh.c.id); CHEM_FEATURE.sweep!(fresh.world);
    expect(fresh.world.chem.waterAssists.size).toBe(0);
    expect(fresh.world.chem.pendingWater.size).toBe(0);
  });
  it('watering an already naturally supplied wet zone does not claim even before the next sweep', () => {
    const { world, helper, attacker, c, water, react, kill } = setup();
    c.pos = { x: 12, z: 10 }; helper.pos = { x: 12, z: 3 }; attacker.pos = { x: 13, z: 3 };
    water(); react(); kill();
    expect(helper.xp).toBe(0); expect(attacker.xp).toBe(140);
    expect(world.chem.waterAssists.size).toBe(0);
  });
  it('helping a wounded shielded wizard yields no wild-creature credit', () => {
    const { world, helper, attacker, water } = setup();
    water();
    world.rules.combat.pvp = true;
    world.shield(attacker, attacker, 1000, 10);
    world.damage(helper.id, attacker.id, 1, 'arcane', [WATER_TAG]);
    const hp = attacker.hp;
    world.damage(helper.id, attacker.id, 10, 'fire');
    expect(attacker.hp).toBe(hp); expect(helper.xp).toBe(0);
    expect(world.chem.waterAssists.has(attacker.id)).toBe(false);
  });
  it('fatigued fractional kill XP is conserved and other qualifying damage XP is untouched', () => {
    const { world, helper, attacker, c, water, react, kill } = setup();
    const third = world.enroll('Damage Partner', 'Ravenclaw').wizard;
    third.connections = 1; third.pos = { ...helper.pos };
    water(); react(); world.damage(third.id, c.id, 500, 'fire'); kill();
    expect([helper.xp, attacker.xp, third.xp]).toEqual([35, 105, 70]);
    // The already-authorized original total is 140 killer + 70 damage partner, still exactly 210.
    expect(helper.xp + attacker.xp + third.xp).toBe(210);
    const xp = 140 * 5 / 17;
    const split = splitWaterAssistXp(xp, 2);
    expect(split.killerXp + split.shares.reduce((s, x) => s + x, 0)).toBe(xp);
    expect(split.shares.reduce((s, x) => s + x, 0)).toBeLessThanOrEqual(xp / 4);
  });
  it.each(['self', 'natural', 'expired wet', 'zero damage', 'no reaction', 'dry run', 'npc helper', 'npc attacker', 'possessing helper', 'possessing attacker', 'possessed target', 'owned target', 'inactive helper', 'far helper', 'expired contribution'])(
    '%s cannot claim an assist', (kind) => {
      const { world, helper, attacker, c, water, react, kill } = setup();
      if (kind === 'npc helper') helper.npc = true;
      if (kind === 'possessing helper') world.possess.of.set(helper.id, { kind: 'creature', id: 'unused-vessel' });
      if (kind === 'natural') world.chem.wet.set(c.id, world.now + WET_S);
      else if (kind === 'dry run') expect(world.simulate(helper.id, '(aguamenti target)', { target: c.id }).ok).toBe(true);
      else if (kind !== 'no reaction') water(kind === 'self' ? attacker : helper);
      if (kind === 'expired wet') world.now += WET_S;
      if (kind === 'npc attacker') attacker.npc = true;
      if (kind === 'possessing attacker') world.possess.of.set(attacker.id, { kind: 'creature', id: 'unused-vessel' });
      if (kind === 'possessed target') c.driver = helper.id;
      if (kind === 'owned target') c.owner = helper.id;
      if (kind === 'zero damage') world.rules.combat.elementMultipliers.fire = 0;
      if (kind !== 'no reaction') react();
      attacker.npc = false; delete c.driver; c.owner = null; world.possess.of.delete(attacker.id);
      if (kind === 'inactive helper') { helper.connections = 0; helper.lastMcpAt = -1e6; }
      if (kind === 'far helper') helper.pos = { x: at.x + 31, z: at.z };
      if (kind === 'expired contribution') world.now += 60;
      kill();
      expect(helper.xp).toBe(0); expect(attacker.xp).toBe(140);
    },
  );
});

describe('water-assist formal conformance and bounded allocation', () => {
  it('matches independent Lean vectors including zero, rounding and helper cap boundaries', () => {
    const v = JSON.parse(readFileSync(new URL('../formal/water-assist-vectors.json', import.meta.url), 'utf8')) as {
      constants: Record<string, number>; split: [number, number, number, number[]][];
    };
    expect(v.constants).toEqual({ WATER_ASSIST_DIVISOR, WATER_ASSIST_MAX, WATER_ASSIST_S, WATER_ASSIST_R });
    expect(v.split.length).toBeGreaterThanOrEqual(40);
    for (const [xp, n, killerXp, shares] of v.split) expect(splitWaterAssistXp(xp, n)).toEqual({ killerXp, shares });
  });
  it('preserves the full existing XP budget across fractional XP and every bounded helper count', () => {
    for (let i = 0; i <= 1000; i++) for (let n = 0; n <= 12; n++) {
      const xp = i / 7, result = splitWaterAssistXp(xp, n), sum = result.shares.reduce((s, x) => s + x, 0);
      expect(result.killerXp + sum).toBeCloseTo(xp, 10);
      expect(sum).toBeLessThanOrEqual(xp / 4); expect(result.killerXp).toBeGreaterThanOrEqual(xp * 0.75);
      expect(result.shares.length).toBeLessThanOrEqual(WATER_ASSIST_MAX);
      expect(result.shares.every((x) => Number.isInteger(x) && x >= 0)).toBe(true);
    }
  });
});
