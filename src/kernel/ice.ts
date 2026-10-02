/**
 * 冰路 + 夜冻 (a Feature; the numbers are src/shared/ice.ts): ice over the Black Lake.
 *
 * Two ways the lake freezes:
 * - 冰路 (spell ice): an ice bolt freezes the water it flies over (the `bolt` hook, every tick),
 *   an ice nova the water under it (`blast`); each square stays ICE_S. While it holds, the water does
 *   not push a walker out of it (Solids.walkOn), and a walk ordered onto it goes straight on from where
 *   the ice meets the shore nearest you, square by square (iceWay; World.setGoal). When it melts under
 *   you, you are in the water: soaked (kernel/chem.ts) and put back on the nearest shore.
 * - 夜冻 (night freeze): at night the whole lake freezes over and thaws at dawn (the `sweep` flips
 *   `iceNight` with `isNight()`). On any ice a wizard skates 25% faster (`moveMult`) and glides: let go
 *   of the keys and the last tick's velocity carries on, decaying (`stepLate`).
 *
 * The browser draws the frozen squares as an instanced mesh and the night sheet as one painted disc
 * (client/ice3d.ts); agents see it in `look`'s `here`.
 */
import { WET_S } from '../shared/chem.js';
import { ICE_CELL, ICE_FREEZE_R, ICE_S, iceKey, LAKE_WATER, overWater } from '../shared/ice.js';
import type { Feature } from './feature.js';
import type { Vec2, Wizard } from './types.js';
import type { World } from './world.js';

declare module './world.js' {
  interface World {
    /** 冰路 (this module's Feature): until when each frozen square of the lake holds ("i,j" keys). */
    ice: Map<string, number>;
    /** 夜冻: the whole lake is ice while true (flipped with the night by `sweep`). */
    iceNight: boolean;
  }
}

/** On ice: the night froze the whole lake, or this square was spell-frozen and still holds. */
export const onIce = (world: World, x: number, z: number) =>
  (world.iceNight && overWater(x, z)) || (world.ice.get(iceKey(x, z)) ?? 0) > world.now;

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

// ------------------------------------------------------------------ skating (night ice and spell ice alike)

/** 25% faster on the sheet. */
const ICE_SPEED_MULT = 1.25;
/** Glide friction: velocity decays by this per second after letting go. */
const ICE_FRICTION = 0.45;
/** Below this speed the glide stops. */
const GLIDE_STOP = 0.2;

interface Skater { px: number; pz: number; vx: number; vz: number; hadGoal: boolean }
const skaters = new WeakMap<World, Map<string, Skater>>();
const skatersOf = (world: World) => {
  let m = skaters.get(world);
  if (!m) { m = new Map(); skaters.set(world, m); }
  return m;
};

/** The glide: a wizard on ice who lets go keeps their last velocity, decaying. */
function glide(world: World, dt: number) {
  const st = skatersOf(world);
  for (const w of world.wizards.values()) {
    let s = st.get(w.id);
    const icy = onIce(world, w.pos.x, w.pos.z) && world.isActive(w);
    if (!icy) { if (s) st.delete(w.id); continue; }
    if (!s) { s = { px: w.pos.x, pz: w.pos.z, vx: 0, vz: 0, hadGoal: false }; st.set(w.id, s); }
    const driving = Math.hypot(w.input.dx, w.input.dz) >= 0.01 || !!w.goal;
    if (driving) {
      s.vx = (w.pos.x - s.px) / dt; s.vz = (w.pos.z - s.pz) / dt;
      s.hadGoal = !!w.goal;
    } else {
      // the goal just completed: dig the skates in, don't glide past it
      if (s.hadGoal) { s.vx = s.vz = 0; s.hadGoal = false; }
      else if (Math.hypot(s.vx, s.vz) >= GLIDE_STOP) {
        const f = Math.pow(ICE_FRICTION, dt);
        s.vx *= f; s.vz *= f;
        if (Math.hypot(s.vx, s.vz) < GLIDE_STOP) s.vx = s.vz = 0;
        else {
          w.pos.x += s.vx * dt; w.pos.z += s.vz * dt;
          world.solids.resolve(w.pos, 0.5, true);
          world.moved(w);
        }
      }
    }
    // the daily quest counts metres skated on the sheet
    const skated = Math.hypot(w.pos.x - s.px, w.pos.z - s.pz);
    if (skated > 1e-6) w.stats.skate = (w.stats.skate ?? 0) + skated;
    s.px = w.pos.x; s.pz = w.pos.z;
  }
}

export const ICE_FEATURE: Feature = {
  id: 'ice',
  init(world) {
    world.ice = new Map();
    world.iceNight = false;
    world.solids.walkOn = (x, z) => onIce(world, x, z);
    world.solids.bridge = (from, to) => iceWay(world, from, to);
  },
  bolt(world, p) {
    if (p.element === 'ice' && p.ttl > 0 && overWater(p.pos.x, p.pos.z)) freeze(world, p.pos, ICE_FREEZE_R);
  },
  blast(world, _by, at, r, element) {
    if (element === 'ice' && overWater(at.x, at.z)) freeze(world, at, r);
  },
  stepLate(world, dt) {
    if (world.iceNight || world.ice.size > 0) glide(world, dt);
  },
  moveMult(world, w: Wizard) {
    return onIce(world, w.pos.x, w.pos.z) ? ICE_SPEED_MULT : 1;
  },
  sweep(world) {
    // the night freeze: the whole lake holds while it is night
    const night = world.isNight();
    if (night !== world.iceNight) {
      world.iceNight = night;
      if (night) {
        world.emit('system', '❄ The Black Lake freezes over — the ice will hold you. Skate across, but mind the glide.',
          { zh: '❄ 黑湖结冰了——冰面载得动你。滑过去吧，小心刹不住。' });
      } else {
        world.emit('system', 'The ice on the Black Lake melts away with the dawn.',
          { zh: '天亮了，黑湖上的冰化开了。' });
      }
      world.fx({ k: 'freeze', x: LAKE_WATER.x, z: LAKE_WATER.z });
    }
    // spell ice melting underfoot
    if (!world.ice.size) return;
    let melted = false;
    for (const [k, t] of world.ice) if (t <= world.now) { world.ice.delete(k); melted = true; }
    if (!melted) return;
    // whoever stood on what melted: in the water — soaked, and out on the nearest shore
    // (at dawn the night ice is gone too: onIce is false, so this catches them as well)
    for (const w of world.nearWizards(LAKE_WATER, LAKE_WATER.r)) {
      if (!overWater(w.pos.x, w.pos.z) || onIce(world, w.pos.x, w.pos.z)) continue;
      world.fx({ k: 'react', x: w.pos.x, z: w.pos.z, h: 'soak' });
      world.chem?.wet.set(w.id, world.now + WET_S);
      w.goal = null; w.route = []; w.goalBy = null;
      world.solids.resolve(w.pos, 0.5);
      world.moved(w);
    }
  },
  // the browser: the night flag and the frozen squares as [i, j, seconds left, …]
  wire: {
    key: 'ice',
    get(world) {
      if (!world.iceNight && !world.ice.size) return undefined;
      const cells: number[] = [];
      for (const [k, t] of world.ice) { const [i, j] = k.split(',').map(Number); cells.push(i, j, Math.ceil(t - world.now)); }
      return { night: world.iceNight, cells };
    },
  },
  view: {
    key: 'ice',
    here(world, x: Wizard) {
      const dx = x.pos.x - LAKE_WATER.x, dz = x.pos.z - LAKE_WATER.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= (LAKE_WATER.r + 15) * (LAKE_WATER.r + 15)) return undefined;
      const icy = onIce(world, x.pos.x, x.pos.z);
      if (d2 < LAKE_WATER.r * LAKE_WATER.r) {
        return icy
          ? { ice: 'frozen', zh: '湖面结冰了，可以走上去，比走路快 25%，松开按键会滑行一段', en: 'The lake is frozen: walkable, 25% faster, and you glide when you let go' }
          : { ice: 'water', zh: '黑湖的湖水（夜里会结冰，冰咒也能冻出路）', en: 'The Black Lake (freezes at night; ice spells freeze a path)' };
      }
      return icy
        ? { ice: 'shore-frozen', zh: '湖面冻上了，去滑两圈吧（小心摄魂怪）', en: 'The lake is frozen over — go skate (mind the Dementors)' }
        : { ice: 'shore', zh: '黑湖。夜里湖面会结冰，冰咒也能冻出一条路', en: 'The Black Lake. It freezes at night, and ice spells freeze a path' };
    },
  },
  save(world) { return { night: world.iceNight, cells: [...world.ice] }; },
  load(world, data) {
    const d = (data ?? {}) as { night?: unknown; cells?: unknown };
    world.iceNight = !!d.night;
    world.ice = new Map(Array.isArray(d.cells) ? d.cells as [string, number][] : []);
  },
};
