/**
 * 冰路 (src/shared/ice.ts, src/kernel/ice.ts) and the Black Lake's encounter: Glacius over the water freezes a road;
 * you walk out on it (keys or a walk ordered onto it); it melts and the water puts you back ashore. Every shore spot
 * the float can be reached from is walked.
 */
import { describe, expect, it, vi } from 'vitest';
import { XP_FOR_YEAR } from '../src/kernel/progression.js';
import { freeze, ICE_FEATURE, onIce } from '../src/kernel/ice.js';
import { DUEL_FEATURE } from '../src/kernel/duelclub.js';
import { World } from '../src/kernel/world.js';
import type { Wizard } from '../src/kernel/types.js';
import { STATIC_COLLIDERS } from '../src/shared/layout.js';
import { encounterById, REACH_R } from '../src/shared/encounters.js';
import { ICE_S, LAKE_WATER, overWater } from '../src/shared/ice.js';

function mk() {
  const w = new World({ seed: 61, secret: 'ice' });
  w.rules.creatures.spawnMultiplier = 0;
  w.rules.events.pool = [];
  w.term.endsAt = 1e12;
  return w;
}
function wiz(w: World, name: string, at: { x: number; z: number }, year = 2): Wizard {
  const a = w.enroll(`${name} Ice`.slice(0, 24), 'Ravenclaw' as never).wizard;
  a.connections = 1; a.createdAt = -1e6; a.pos = { ...at };
  if (year > 1) w.gainXp(a, XP_FOR_YEAR[year] - a.xp);
  a.mana = 1e6;
  return a;
}
const run = (w: World, s: number) => { for (let i = 0; i < Math.round(s * 20); i++) w.tick(); };
const FLOAT = encounterById('lake')!;
/** The east shore, facing the float: every spot from 35° north to 35° south of it, just off the water. */
const SHORE = [-35, -20, 0, 20, 35].map((deg) => { const a = (deg * Math.PI) / 180; return { deg, x: LAKE_WATER.x + 31.5 * Math.cos(a), z: LAKE_WATER.z + 31.5 * Math.sin(a) }; });

describe('ice: the lake', () => {
  it('LAKE_WATER is the lake’s water collider; the float is out on the water', () => {
    const c = STATIC_COLLIDERS.find((x) => x.style === 'water' && x.kind === 'disc') as { x: number; z: number; r: number } | undefined;
    expect(c && { x: c.x, z: c.z, r: c.r }).toEqual(LAKE_WATER);
    expect(overWater(FLOAT.x, FLOAT.z)).toBe(true);
  });
  it('without ice the water stops you: a walk to the float ends on the shore', () => {
    const w = mk();
    const a = wiz(w, 'Dry', SHORE[2]);
    w.setGoal(a.id, { x: FLOAT.x, z: FLOAT.z }, 'player');
    run(w, 6);
    expect(overWater(a.pos.x, a.pos.z)).toBe(false);
  });
});

describe('ice: the road (every shore spot facing the float)', () => {
  it('Glacius at the float freezes a road along its way; a walk ordered there gets you out and clears the encounter', () => {
    for (const s of SHORE) {
      const w = mk();
      const a = wiz(w, `Road ${s.deg}`, s);
      expect(w.cast(a.id, 'Glacius', { aim: { x: FLOAT.x, z: FLOAT.z } }).ok, `${s.deg}°`).toBe(true);
      run(w, 1.5);
      // the road: every point on the line from the water's edge to the float is ice
      for (let t = 0; t <= 1; t += 0.02) {
        const x = s.x + (FLOAT.x - s.x) * t, z = s.z + (FLOAT.z - s.z) * t;
        if (overWater(x, z)) expect(onIce(w, x, z), `${s.deg}° at ${t.toFixed(2)}`).toBe(true);
      }
      w.setGoal(a.id, { x: FLOAT.x, z: FLOAT.z }, 'player');
      run(w, 6);
      expect(Math.hypot(a.pos.x - FLOAT.x, a.pos.z - FLOAT.z), `${s.deg}°`).toBeLessThan(REACH_R);
      run(w, 1.1);
      expect(w.enc.done.get(a.id)?.has('lake'), `${s.deg}°`).toBe(true);
    }
  });
  it('the keys work as well; when it melts the water puts you back ashore', () => {
    const w = mk();
    const a = wiz(w, 'Keys', SHORE[2]);
    w.cast(a.id, 'Glacius', { aim: { x: FLOAT.x, z: FLOAT.z } });
    run(w, 1.5);
    a.input = { dx: -1, dz: 0 };
    run(w, 1.5);
    a.input = { dx: 0, dz: 0 };
    expect(overWater(a.pos.x, a.pos.z)).toBe(true);
    run(w, ICE_S);
    expect(overWater(a.pos.x, a.pos.z)).toBe(false);
  });
  it('an ice nova over the water freezes the water under it; fire does nothing to it', () => {
    const w = mk();
    freeze(w, { x: FLOAT.x, z: FLOAT.z }, 3);
    expect(onIce(w, FLOAT.x + 2, FLOAT.z)).toBe(true);
    expect(onIce(w, FLOAT.x + 5, FLOAT.z)).toBe(false);
    run(w, ICE_S + 1.5);
    expect(w.ice.size).toBe(0);
  });
});

/** Night freeze: the whole lake holds while it is night, with skating. */
function nightWorld() {
  const w = new World({ seed: 7, secret: 'ice-test' });
  w.clock = { at: w.now, hour: 21 }; // night (>= 20)
  for (const k of [...w.creatures.keys()]) w.creatures.delete(k);
  w.rules = { ...w.rules, creatures: { ...w.rules.creatures, spawnMultiplier: 0 } };
  return w;
}
const tick = (w: World, s: number) => { for (let i = 0; i < Math.round(s * 20); i++) w.tick(); };
const ICE_PT = { x: -110, z: 40 };

describe('ice: the night freeze', () => {
  it('walks from the shore to the float at night without a spell bridge', () => {
    for (const start of [...SHORE, { x: -87.5, z: 39.8 }]) {
      const w = nightWorld();
      tick(w, 1.2);
      const a = wiz(w, 'Night Walker', start);
      w.moved(a);
      w.setGoal(a.id, { x: FLOAT.x, z: FLOAT.z }, 'player');
      tick(w, 10);
      expect(Math.hypot(a.pos.x - FLOAT.x, a.pos.z - FLOAT.z)).toBeLessThan(REACH_R);
      expect(a.goal).toBeNull();
    }
  });
  function skater() {
    const w = nightWorld();
    const a = w.enroll('Regression Skater').wizard;
    a.connections = 1;
    tick(w, 1.2);
    a.pos = { ...ICE_PT };
    w.moved(a);
    return { w, a };
  }

  it.each([false, true])('dawn sends a stationary skater ashore even with unrelated spell ice: %s', (spellIce) => {
    const { w, a } = skater();
    if (spellIce) freeze(w, { x: -130, z: 40 }, 2);
    w.clock = { at: w.now, hour: 10 };
    tick(w, 1.2);
    expect(overWater(a.pos.x, a.pos.z)).toBe(false);
    expect(w.chem.wet.get(a.id)).toBeGreaterThan(w.now);
  });

  it('dawn leaves a skater on surviving spell ice, then sends them ashore when it expires', () => {
    const { w, a } = skater();
    freeze(w, a.pos, 2);
    w.clock = { at: w.now, hour: 10 };
    tick(w, 1.2);
    expect(a.pos).toEqual(ICE_PT);
    tick(w, ICE_S);
    expect(overWater(a.pos.x, a.pos.z)).toBe(false);
  });

  it('glides after releasing the keys, but rooting stops it and clears its momentum', () => {
    const { w, a } = skater();
    w.setInput(a.id, 1, 0);
    tick(w, 0.5);
    w.setInput(a.id, 0, 0);
    const x = a.pos.x;
    tick(w, 0.1);
    expect(a.pos.x).toBeGreaterThan(x);
    a.st.rootedUntil = w.now + 10;
    const rootedAt = { ...a.pos };
    tick(w, 0.5);
    expect(a.pos).toEqual(rootedAt);
    a.st.rootedUntil = 0;
    tick(w, 0.5);
    expect(a.pos).toEqual(rootedAt);
  });

  it('a feature holding movement still also stops the glide', () => {
    const { w, a } = skater();
    w.setInput(a.id, 1, 0);
    tick(w, 0.5);
    w.setInput(a.id, 0, 0);
    const at = { ...a.pos };
    const hold = vi.spyOn(DUEL_FEATURE, 'moveMult').mockReturnValue(0);
    try {
      tick(w, 0.5);
      expect(a.pos).toEqual(at);
    } finally { hold.mockRestore(); }
    tick(w, 0.5);
    expect(a.pos).toEqual(at);
  });

  it('a dodge does not add old glide velocity or leave a new glide behind', () => {
    const { w, a } = skater();
    w.setInput(a.id, 1, 0);
    tick(w, 0.5);
    w.setInput(a.id, 0, 0);
    expect(w.dodge(a.id, 0, 1).ok).toBe(true);
    const x = a.pos.x;
    tick(w, 0.5);
    expect(a.pos.x).toBe(x);
    const afterRoll = { ...a.pos };
    tick(w, 0.5);
    expect(a.pos).toEqual(afterRoll);
  });

  it('teleporting across ice grants no skating distance and clears old momentum', () => {
    const { w, a } = skater();
    w.setInput(a.id, 1, 0);
    tick(w, 0.5);
    w.setInput(a.id, 0, 0);
    const skated = a.stats.skate;
    a.pos = { x: -130, z: 40 };
    w.moved(a);
    tick(w, 0.5);
    expect(a.stats.skate).toBe(skated);
    expect(a.pos).toEqual({ x: -130, z: 40 });
  });

  it('a teleport during a tick cannot become momentum or quest progress', () => {
    const { w, a } = skater();
    const skated = a.stats.skate ?? 0;
    ICE_FEATURE.step!(w, 0.05);
    a.pos = { x: -130, z: 40 };
    w.moved(a);
    w.setInput(a.id, 1, 0);
    ICE_FEATURE.stepLate!(w, 0.05);
    expect(a.stats.skate ?? 0).toBe(skated);
    w.setInput(a.id, 0, 0);
    tick(w, 0.5);
    expect(a.pos).toEqual({ x: -130, z: 40 });
  });

  it('freezes at night and thaws at dawn, announcing both', () => {
    const w = nightWorld();
    expect(w.iceNight).toBe(false);
    tick(w, 1.2);
    expect(w.iceNight).toBe(true);
    w.clock = { at: w.now, hour: 10 };
    tick(w, 1.2);
    expect(w.iceNight).toBe(false);
  });

  it('skates 25% faster on night ice', () => {
    const w = nightWorld();
    const a = w.enroll('SkaterOne').wizard, b = w.enroll('SkaterTwo').wizard;
    for (const x of [a, b]) { x.connections = 1; }
    tick(w, 1.2);
    a.pos = { ...ICE_PT }; b.pos = { x: -50, z: 40 };
    w.setInput(a.id, 1, 0); w.setInput(b.id, 1, 0);
    const ax0 = a.pos.x, bx0 = b.pos.x;
    tick(w, 2);
    const iceDist = a.pos.x - ax0, grassDist = b.pos.x - bx0;
    expect(iceDist / grassDist).toBeCloseTo(1.25, 1);
  });

  it('counts metres skated for the daily quest', () => {
    const w = nightWorld();
    const a = w.enroll('SkaterOne').wizard;
    a.connections = 1;
    tick(w, 1.2);
    a.pos = { ...ICE_PT };
    w.setInput(a.id, 1, 0);
    tick(w, 2);
    w.setInput(a.id, 0, 0);
    const skated = a.stats.skate ?? 0;
    expect(skated).toBeGreaterThan(10);
    expect(skated).toBeLessThan(25);
  });

  it('the wire carries the night flag', () => {
    const w = nightWorld();
    const me = w.enroll('Skater').wizard;
    me.connections = 1;
    const snap = (): { ice?: unknown } => w.snapshot() as { ice?: unknown };
    expect(snap().ice).toBeUndefined();
    tick(w, 1.2);
    expect((snap().ice as { night: boolean }).night).toBe(true);
  });
});
