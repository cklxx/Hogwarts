import { colliderBounds } from '../shared/layout.js';
import { WORLD_HALF } from '../shared/map.js';
import { STATIC_SOLIDS, type Solids } from './physics.js';
import type { Vec2 } from './types.js';

/**
 * A* over a coarse walkability grid baked from the static colliders (src/shared/layout.ts) once at
 * startup, so click-to-move and agents' move_to route around the castle, the lake and the forest. Each
 * World adds its own dynamic colliders (Ministers' statues) as an overlay of blocked cells, re-derived
 * whenever they change (Solids.version).
 */
const CELL = 2;
const N = Math.ceil((WORLD_HALF * 2) / CELL);
/** A cell is walkable when a circle this wide at its centre touches nothing (a wizard is 0.5). */
const CLEARANCE = 0.7;
/** A step between neighbouring cells, or a string-pulled leg, must keep this far from everything. */
const EDGE_CLEAR = 0.3, LEG_CLEAR = 0.45;
/** The four forward neighbour steps; bit k of `edges[cell]` says the step DIRS[k] from it is clear. */
const DIRS = [[1, 0], [0, 1], [1, 1], [-1, 1]] as const;

let walk: Uint8Array | null = null;
let edges: Uint8Array | null = null;
function grid(): Uint8Array {
  if (walk) return walk;
  walk = new Uint8Array(N * N);
  const p = { x: 0, z: 0 };
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      p.x = -WORLD_HALF + (i + 0.5) * CELL; p.z = -WORLD_HALF + (j + 0.5) * CELL;
      walk[j * N + i] = STATIC_SOLIDS.blocked(p, CLEARANCE) ? 0 : 1;
    }
  // Two open cells can still have something thin between them (a torch post between four cell centres, a
  // corner): each step is swept once here, so no route ever cuts through anything.
  edges = new Uint8Array(N * N);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      if (!walk[j * N + i]) continue;
      const ax = -WORLD_HALF + (i + 0.5) * CELL, az = -WORLD_HALF + (j + 0.5) * CELL;
      let bits = 0;
      DIRS.forEach(([di, dj], k) => {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N || !walk![nj * N + ni]) return;
        if (!STATIC_SOLIDS.hitSegment(ax, az, ax + di * CELL, az + dj * CELL, -1, EDGE_CLEAR)) bits |= 1 << k;
      });
      edges[j * N + i] = bits;
    }
  return walk;
}
/** May a walker step from cell (i, j) to its neighbour (i + di, j + dj)? (Both cells are known open.) */
function stepOk(i: number, j: number, di: number, dj: number): boolean {
  grid();
  // each step is stored once, on the cell it leaves in a forward direction
  if (dj < 0 || (dj === 0 && di < 0)) { i += di; j += dj; di = -di; dj = -dj; }
  const k = dj === 0 ? 0 : di === 0 ? 1 : di > 0 ? 2 : 3;
  if (!(edges![j * N + i] & (1 << k))) return false;
  // near a dynamic collider, sweep it too
  if (!dyn) return true;
  const ax = -WORLD_HALF + (i + 0.5) * CELL, az = -WORLD_HALF + (j + 0.5) * CELL;
  return !(dyn[j * N + i] & 2 || dyn[(j + dj) * N + i + di] & 2) || !cur!.hitSegment(ax, az, ax + di * CELL, az + dj * CELL, -1, EDGE_CLEAR);
}

/** Per-Solids overlay: cells blocked by its dynamic colliders (null when it has none). */
const overlays = new WeakMap<Solids, { version: number; mask: Uint8Array | null }>();
function overlay(s: Solids): Uint8Array | null {
  const o = overlays.get(s);
  if (o && o.version === s.version) return o.mask;
  let mask: Uint8Array | null = null;
  if (s.dynamic.length) {
    mask = new Uint8Array(N * N);
    const g = grid(), p = { x: 0, z: 0 };
    for (const c of s.dynamic) {
      const [x0, z0, x1, z1] = colliderBounds(c);
      const m = CLEARANCE + CELL; // (bit 2: near enough that steps from here get swept against it)
      const [i0, j0] = cellOf({ x: x0 - m, z: z0 - m }), [i1, j1] = cellOf({ x: x1 + m, z: z1 + m });
      for (let i = i0; i <= i1; i++)
        for (let j = j0; j <= j1; j++) {
          if (!g[j * N + i]) continue;
          p.x = -WORLD_HALF + (i + 0.5) * CELL; p.z = -WORLD_HALF + (j + 0.5) * CELL;
          mask[j * N + i] |= s.blocked(p, CLEARANCE) ? 3 : 2;
        }
    }
  }
  overlays.set(s, { version: s.version, mask });
  return mask;
}

const center = (i: number, j: number): Vec2 => ({ x: -WORLD_HALF + (i + 0.5) * CELL, z: -WORLD_HALF + (j + 0.5) * CELL });
const cellOf = (p: Vec2) => [
  Math.max(0, Math.min(N - 1, Math.floor((p.x + WORLD_HALF) / CELL))),
  Math.max(0, Math.min(N - 1, Math.floor((p.z + WORLD_HALF) / CELL))),
] as const;

/** The solids and overlay findPath/clearLine are working against (single-threaded; set on entry). */
let dyn: Uint8Array | null = null;
let cur: Solids | null = null;
const use = (s: Solids) => { cur = s; dyn = overlay(s); };
const ok = (i: number, j: number) => i >= 0 && j >= 0 && i < N && j < N && grid()[j * N + i] === 1 && !(dyn && dyn[j * N + i] & 1);

/** Bake the grid up front instead of on the first move_to. */
export function warmPathfinding() { grid(); }

/** Is the cell under p walkable (for tests and tools)? */
export function walkableAt(p: Vec2, solids: Solids = STATIC_SOLIDS): boolean {
  use(solids);
  return ok(...cellOf(p));
}

/** Nearest walkable cell to the point p (from its cell (i, j) outward), by distance to p itself. */
function nearestOpen(p: Vec2, i: number, j: number, reachable = false): [number, number] | null {
  // The body can stand in a coarse blocked cell (beside the mirror, for example). Its connection to
  // the grid must be swept against actual solids, without requiring the origin's coarse cell open.
  const accepts = (a: number, b: number) => {
    if (!ok(a, b)) return false;
    const c = center(a, b);
    return !reachable || !cur!.hitSegment(p.x, p.z, c.x, c.z, -1, LEG_CLEAR);
  };
  if (accepts(i, j)) return [i, j];
  let best: [number, number] | null = null, bestD = Infinity;
  for (let r = 1; r < 40; r++) {
    for (let di = -r; di <= r; di++)
      for (const dj of [-r, r])
        for (const [a, b] of [[i + di, j + dj], [i + dj, j + di]] as const) {
          if (!accepts(a, b)) continue;
          const c = center(a, b), d = Math.hypot(c.x - p.x, c.z - p.z);
          if (d < bestD) { bestD = d; best = [a, b]; }
        }
    // a ring further out can still hold a nearer cell (by at most one ring): look one more, then stop
    if (best && bestD <= (r + 0.5) * CELL) return best;
  }
  return best;
}

/** Can a walker go straight from a to b? Open cells all along (sampled every half cell) and nothing within LEG_CLEAR of the line. */
export function clearLine(a: Vec2, b: Vec2, solids: Solids = STATIC_SOLIDS): boolean {
  use(solids);
  return lineOk(a, b);
}
function lineOk(a: Vec2, b: Vec2): boolean {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.ceil(d / (CELL / 2));
  for (let s = 1; s < steps; s++) {
    const [i, j] = cellOf({ x: a.x + ((b.x - a.x) * s) / steps, z: a.z + ((b.z - a.z) * s) / steps });
    if (!ok(i, j)) return false;
  }
  return !cur!.hitSegment(a.x, a.z, b.x, b.z, -1, LEG_CLEAR);
}

/** Returns waypoints from `from` to (a walkable point near) `to`, excluding `from`. Null if unreachable. */
export function findPath(from: Vec2, to: Vec2, solids: Solids = STATIC_SOLIDS): Vec2[] | null {
  use(solids);
  const s = nearestOpen(from, ...cellOf(from), true);
  const g = nearestOpen(to, ...cellOf(to));
  if (!s || !g) return null;
  const goalPt = ok(...cellOf(to)) ? { ...to } : center(g[0], g[1]);
  if (ok(...cellOf(from)) && lineOk(from, goalPt)) return [goalPt];
  const start = s[1] * N + s[0], goal = g[1] * N + g[0];
  const gs = new Float32Array(N * N).fill(Infinity);
  const came = new Int32Array(N * N).fill(-1);
  const closed = new Uint8Array(N * N);
  // binary heap of [f, idx]
  const heap: number[][] = [];
  const push = (f: number, i: number) => {
    heap.push([f, i]);
    let k = heap.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top[1];
  };
  const h = (i: number) => {
    const dx = Math.abs((i % N) - g[0]), dz = Math.abs(Math.floor(i / N) - g[1]);
    return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
  };
  gs[start] = 0;
  push(h(start), start);
  let expanded = 0;
  while (heap.length && expanded < 60000) {
    const cur = pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    expanded++;
    if (cur === goal) break;
    const ci = cur % N, cj = Math.floor(cur / N);
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (!ok(ni, nj) || (di && dj && (!ok(ci + di, cj) || !ok(ci, cj + dj))) || !stepOk(ci, cj, di, dj)) continue;
        const n = nj * N + ni;
        const cost = gs[cur] + (di && dj ? 1.414 : 1);
        if (cost < gs[n]) { gs[n] = cost; came[n] = cur; push(cost + h(n), n); }
      }
  }
  if (came[goal] === -1 && goal !== start) return null;
  const cells: Vec2[] = [];
  for (let c = goal; c !== start && c !== -1; c = came[c]) cells.push(center(c % N, Math.floor(c / N)));
  cells.reverse();
  // Anchor the first leg at the collision-reachable start cell. This also covers an open origin cell
  // whose centre is separated from the actual origin by a thin collider.
  const startPt = center(s[0], s[1]);
  if (!cells.length) {
    // Same grid cell does not imply a clear direct leg (a thin column or tomb corner can intervene).
    // The origin's connection to startPt was swept by nearestOpen; also verify the remaining leg.
    if (!lineOk(startPt, goalPt)) return null;
    cells.push(startPt);
    if (Math.hypot(startPt.x - goalPt.x, startPt.z - goalPt.z) > 1e-9) cells.push(goalPt);
  } else {
    cells.unshift(startPt);
    cells[cells.length - 1] = goalPt;
  }
  // string-pull: keep only waypoints needed for line of sight
  const out: Vec2[] = [];
  let anchor = from;
  for (let k = 0; k < cells.length; k++) {
    const next = cells[k + 1];
    if (!next || (k === 0 && !ok(...cellOf(from))) || !lineOk(anchor, next)) { out.push(cells[k]); anchor = cells[k]; }
  }
  return out;
}
