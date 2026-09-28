import { OBSTACLES, WORLD_HALF, type Obstacle } from '../shared/map.js';
import type { Vec2 } from './types.js';

export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

// Coarse spatial hash over static obstacles.
const CELL = 16;
const grid = new Map<string, Obstacle[]>();
const key = (cx: number, cz: number) => `${cx},${cz}`;
for (const o of OBSTACLES) {
  const [x0, z0, x1, z1] = o.kind === 'box' ? [o.x0, o.z0, o.x1, o.z1] : [o.x - o.r, o.z - o.r, o.x + o.r, o.z + o.r];
  for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
    for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
      const k = key(cx, cz);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k)!.push(o);
    }
}

function nearby(p: Vec2): Obstacle[] {
  const cx = Math.floor(p.x / CELL), cz = Math.floor(p.z / CELL);
  const out = new Set<Obstacle>();
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const o of grid.get(key(cx + dx, cz + dz)) ?? []) out.add(o);
  return [...out];
}

/** Push a circle of radius r out of every static obstacle. Mutates p. */
export function resolve(p: Vec2, r: number, bounded = true) {
  for (let iter = 0; iter < 2; iter++) {
    for (const o of nearby(p)) {
      if (o.kind === 'disc') {
        const d = Math.hypot(p.x - o.x, p.z - o.z);
        const min = o.r + r;
        if (d < min) {
          const nx = d > 1e-6 ? (p.x - o.x) / d : 1, nz = d > 1e-6 ? (p.z - o.z) / d : 0;
          p.x = o.x + nx * min;
          p.z = o.z + nz * min;
        }
      } else {
        const cx = Math.max(o.x0, Math.min(p.x, o.x1));
        const cz = Math.max(o.z0, Math.min(p.z, o.z1));
        const dx = p.x - cx, dz = p.z - cz;
        const d = Math.hypot(dx, dz);
        if (d < r) {
          if (d > 1e-6) {
            p.x = cx + (dx / d) * r;
            p.z = cz + (dz / d) * r;
          } else {
            // centre inside the box: leave by the shallowest side
            const opts = [
              [p.x - o.x0 + r, -1, 0], [o.x1 - p.x + r, 1, 0], [p.z - o.z0 + r, 0, -1], [o.z1 - p.z + r, 0, 1],
            ].sort((a, b) => a[0] - b[0])[0];
            p.x += opts[1] * opts[0];
            p.z += opts[2] * opts[0];
          }
        }
      }
    }
  }
  if (bounded) {
    p.x = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, p.x));
    p.z = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, p.z));
  }
}

/** Does a point hit something tall enough to stop a bolt? Returns the obstacle. */
export function solidAt(p: Vec2): Obstacle | null {
  for (const o of nearby(p)) {
    if (o.h <= 0.5) continue; // water: bolts skim over it
    if (o.kind === 'disc' ? Math.hypot(p.x - o.x, p.z - o.z) < o.r : p.x >= o.x0 && p.x <= o.x1 && p.z >= o.z0 && p.z <= o.z1) return o;
  }
  return null;
}

export function blocked(p: Vec2, r: number): boolean {
  const q = { ...p };
  resolve(q, r);
  return Math.hypot(q.x - p.x, q.z - p.z) > 0.01;
}
