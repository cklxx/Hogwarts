/**
 * 冰路 (src/shared/ice.ts, src/kernel/ice.ts) and the Black Lake's encounter: Glacius over the water freezes a road;
 * you walk out on it (keys or a walk ordered onto it); it melts and the water puts you back ashore. Every shore spot
 * the float can be reached from is walked.
 */
import { describe, expect, it } from 'vitest';
import { XP_FOR_YEAR } from '../src/kernel/progression.js';
import { freeze, onIce } from '../src/kernel/ice.js';
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
