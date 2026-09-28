import { WORLD_HALF } from '../shared/map.js';
import { blocked } from './physics.js';
import type { Vec2 } from './types.js';

/**
 * A* over a coarse walkability grid baked from the static obstacles once at startup,
 * so agents' move_to can route around the castle, the lake and the forest.
 */
const CELL = 2;
const N = Math.ceil((WORLD_HALF * 2) / CELL);
const CLEARANCE = 0.7;

let walk: Uint8Array | null = null;
function grid(): Uint8Array {
  if (walk) return walk;
  walk = new Uint8Array(N * N);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) walk[j * N + i] = blocked(center(i, j), CLEARANCE) ? 0 : 1;
  return walk;
}
const center = (i: number, j: number): Vec2 => ({ x: -WORLD_HALF + (i + 0.5) * CELL, z: -WORLD_HALF + (j + 0.5) * CELL });
const cellOf = (p: Vec2) => [
  Math.max(0, Math.min(N - 1, Math.floor((p.x + WORLD_HALF) / CELL))),
  Math.max(0, Math.min(N - 1, Math.floor((p.z + WORLD_HALF) / CELL))),
] as const;
const ok = (i: number, j: number) => i >= 0 && j >= 0 && i < N && j < N && grid()[j * N + i] === 1;

/** Bake the grid up front (~150ms) instead of on the first move_to. */
export function warmPathfinding() { grid(); }

/** Nearest walkable cell to (i, j) by growing rings. */
function nearestOpen(i: number, j: number): [number, number] | null {
  if (ok(i, j)) return [i, j];
  for (let r = 1; r < 40; r++)
    for (let di = -r; di <= r; di++)
      for (const dj of [-r, r]) {
        if (ok(i + di, j + dj)) return [i + di, j + dj];
        if (ok(i + dj, j + di)) return [i + dj, j + di];
      }
  return null;
}

/** Straight-line walkability between two points, sampled every half cell. */
export function clearLine(a: Vec2, b: Vec2): boolean {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.ceil(d / (CELL / 2));
  for (let s = 1; s < steps; s++) {
    const [i, j] = cellOf({ x: a.x + ((b.x - a.x) * s) / steps, z: a.z + ((b.z - a.z) * s) / steps });
    if (!ok(i, j)) return false;
  }
  return true;
}

/** Returns waypoints from `from` to (a walkable point near) `to`, excluding `from`. Null if unreachable. */
export function findPath(from: Vec2, to: Vec2): Vec2[] | null {
  const s = nearestOpen(...cellOf(from));
  const g = nearestOpen(...cellOf(to));
  if (!s || !g) return null;
  const goalPt = ok(...cellOf(to)) ? { ...to } : center(g[0], g[1]);
  if (clearLine(from, goalPt)) return [goalPt];
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
  while (heap.length && expanded < 40000) {
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
        if (!ok(ni, nj) || (di && dj && (!ok(ci + di, cj) || !ok(ci, cj + dj)))) continue;
        const n = nj * N + ni;
        const cost = gs[cur] + (di && dj ? 1.414 : 1);
        if (cost < gs[n]) { gs[n] = cost; came[n] = cur; push(cost + h(n), n); }
      }
  }
  if (came[goal] === -1 && goal !== start) return null;
  const cells: Vec2[] = [];
  for (let c = goal; c !== start && c !== -1; c = came[c]) cells.push(center(c % N, Math.floor(c / N)));
  cells.reverse();
  cells[cells.length - 1] = goalPt;
  // string-pull: keep only waypoints needed for line of sight
  const out: Vec2[] = [];
  let anchor = from;
  for (let k = 0; k < cells.length; k++) {
    const next = cells[k + 1];
    if (!next || !clearLine(anchor, next)) { out.push(cells[k]); anchor = cells[k]; }
  }
  return out;
}
