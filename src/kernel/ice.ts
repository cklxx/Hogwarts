/**
 * 冰路 (a Feature; the numbers are src/shared/ice.ts): ice over the Black Lake. An ice bolt freezes the water it
 * flies over (the `bolt` hook, every tick), an ice nova the water under it (`blast`); each square stays ICE_S. While
 * it holds, the water does not push a walker out of it (Solids.walkOn), and a walk ordered onto it goes straight on
 * from where the ice meets the shore nearest you, square by square (iceWay; World.setGoal). When it melts under you, you are in the water: soaked (kernel/chem.ts) and put
 * back on the nearest shore.
 */
import { WET_S } from '../shared/chem.js';
import { ICE_CELL, ICE_FREEZE_R, ICE_S, iceKey, LAKE_WATER, overWater } from '../shared/ice.js';
import type { Feature } from './feature.js';
import type { Vec2 } from './types.js';
import type { World } from './world.js';

declare module './world.js' {
  interface World {
    /** 冰路 (this module's Feature): until when each frozen square of the lake holds ("i,j" keys). */
    ice: Map<string, number>;
  }
}

export const onIce = (world: World, x: number, z: number) => (world.ice.get(iceKey(x, z)) ?? 0) > world.now;
const centre = (i: number, j: number) => ({ x: (i + 0.5) * ICE_CELL, z: (j + 0.5) * ICE_CELL });
/** Four ways only: a step between squares then never cuts the corner of one that is not frozen. */
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const cellOf = (p: Vec2) => [Math.floor(p.x / ICE_CELL), Math.floor(p.z / ICE_CELL)] as const;

/**
 * The way over the ice to `to`: across the frozen squares joined to its own (breadth first, side to side), from the
 * one that touches the shore nearest `from` — or from `from`'s own square when you are on it. Returns the shore
 * point beside that square, then the squares' centres, then `to`; null when `to` is not on ice.
 */
export function iceWay(world: World, from: Vec2, to: Vec2): Vec2[] | null {
  if (!onIce(world, to.x, to.z)) return null;
  const [gi, gj] = cellOf(to), toward = new Map<string, string | null>([[`${gi},${gj}`, null]]), queue = [[gi, gj]];
  const [fi, fj] = cellOf(from), mine = `${fi},${fj}`;
  let best: { k: string; land: Vec2; d: number } | null = null;
  for (let q = 0; q < queue.length; q++) {
    const [i, j] = queue[q], k = `${i},${j}`;
    if (k === mine) { best = { k, land: { ...from }, d: -1 }; break; }
    for (const [di, dj] of STEPS) {
      const n = `${i + di},${j + dj}`, c = centre(i + di, j + dj);
      if (toward.has(n)) continue;
      if (onIce(world, c.x, c.z)) { toward.set(n, k); queue.push([i + di, j + dj]); continue; }
      if (overWater(c.x, c.z)) continue;
      // the shore beside this square
      const d = Math.hypot(c.x - from.x, c.z - from.z);
      if (!best || d < best.d) best = { k, land: c, d };
    }
  }
  if (!best) return null;
  const way: Vec2[] = [best.land];
  for (let k: string | null = best.k; k; k = toward.get(k) ?? null) { const [i, j] = k.split(',').map(Number); way.push(centre(i, j)); }
  way.push({ ...to });
  return way;
}

/** Freeze the lake's squares within r of `at` (only water). */
export function freeze(world: World, at: Vec2, r: number) {
  const until = world.now + ICE_S;
  for (let x = at.x - r; x <= at.x + r + 1e-9; x += ICE_CELL / 2) for (let z = at.z - r; z <= at.z + r + 1e-9; z += ICE_CELL / 2) {
    if (Math.hypot(x - at.x, z - at.z) > r || !overWater(x, z)) continue;
    world.ice.set(iceKey(x, z), until);
  }
}

export const ICE_FEATURE: Feature = {
  id: 'ice',
  init(world) {
    world.ice = new Map();
    world.solids.walkOn = (x, z) => world.ice.size > 0 && onIce(world, x, z);
    world.solids.bridge = (from, to) => iceWay(world, from, to);
  },
  bolt(world, p) {
    if (p.element === 'ice' && p.ttl > 0 && overWater(p.pos.x, p.pos.z)) freeze(world, p.pos, ICE_FREEZE_R);
  },
  blast(world, _by, at, r, element) {
    if (element === 'ice' && overWater(at.x, at.z)) freeze(world, at, r);
  },
  sweep(world) {
    if (!world.ice.size) return;
    let melted = false;
    for (const [k, t] of world.ice) if (t <= world.now) { world.ice.delete(k); melted = true; }
    if (!melted) return;
    // whoever stood on what melted: in the water — soaked, and out on the nearest shore
    for (const w of world.nearWizards(LAKE_WATER, LAKE_WATER.r)) {
      if (!overWater(w.pos.x, w.pos.z) || onIce(world, w.pos.x, w.pos.z)) continue;
      world.fx({ k: 'react', x: w.pos.x, z: w.pos.z, h: 'soak' });
      world.chem?.wet.set(w.id, world.now + WET_S);
      w.goal = null; w.route = []; w.goalBy = null;
      world.solids.resolve(w.pos, 0.5);
      world.moved(w);
    }
  },
  // the browser: the frozen squares as [i, j, seconds left, …]
  wire: {
    key: 'ice',
    get(world) {
      if (!world.ice.size) return undefined;
      const out: number[] = [];
      for (const [k, t] of world.ice) { const [i, j] = k.split(',').map(Number); out.push(i, j, Math.ceil(t - world.now)); }
      return out;
    },
  },
};
