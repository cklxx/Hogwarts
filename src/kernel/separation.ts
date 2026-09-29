import { WORLD_HALF } from '../shared/map.js';

/**
 * Soft separation of bodies (wizards and walking creatures), as one pass per tick over flat typed arrays.
 *
 * The World fills slots 0..n-1 (x, z, radius, and mass: radius², or Infinity for what does not budge), then
 * solve() files them in a dense grid (counting sort, CELL >= the largest possible contact distance, so a
 * body only meets bodies in the 3x3 cells round its own) and visits every overlapping pair exactly once,
 * in slot order. Each pair's overlap x RATE is shared by mass (a troll shoves a pixie; nobody shoves the
 * immovable), accumulated for both (Jacobi: the result does not depend on who comes first), and each body's
 * total push is capped at MAX_STEP per tick. O(n), no allocation after the arrays have grown to the crowd.
 */
const CELL = 4;
const SPAN = WORLD_HALF + 2 * CELL;
const DIM = Math.ceil((2 * SPAN) / CELL);
/** The fraction of an overlap undone per tick (the rest next tick: bodies ease apart, they do not pop). */
export const SEP_RATE = 0.8;
/** The most a body is shoved in one tick (a dense pile spreads over several ticks). */
const MAX_STEP = 0.5;

export class Separator {
  n = 0;
  X = new Float64Array(256);
  Z = new Float64Array(256);
  R = new Float64Array(256);
  M = new Float64Array(256);
  /** The push each slot gets this tick (read after solve()). */
  PX = new Float64Array(256);
  PZ = new Float64Array(256);
  private cellOf = new Int32Array(256);
  private order = new Int32Array(256);
  private start = new Int32Array(DIM * DIM + 1);

  /** Make room for n bodies (grows, never shrinks). */
  reserve(n: number) {
    if (n <= this.X.length) return;
    const cap = Math.max(n, this.X.length * 2);
    const grow = (a: Float64Array) => { const b = new Float64Array(cap); b.set(a); return b; };
    this.X = grow(this.X); this.Z = grow(this.Z); this.R = grow(this.R); this.M = grow(this.M);
    this.PX = new Float64Array(cap); this.PZ = new Float64Array(cap);
    this.cellOf = new Int32Array(cap); this.order = new Int32Array(cap);
  }

  /** Fills PX/PZ for slots 0..n-1. Returns how many slots were pushed. */
  solve(): number {
    const { n, X, Z, R, M, PX, PZ, cellOf, order, start } = this;
    start.fill(0);
    for (let i = 0; i < n; i++) {
      let cx = Math.floor((X[i] + SPAN) / CELL), cz = Math.floor((Z[i] + SPAN) / CELL);
      cx = !(cx >= 0) ? 0 : cx >= DIM ? DIM - 1 : cx; // (non-finite positions land in cell 0 and match nothing)
      cz = !(cz >= 0) ? 0 : cz >= DIM ? DIM - 1 : cz;
      const c = cz * DIM + cx;
      cellOf[i] = c;
      start[c + 1]++;
      PX[i] = 0; PZ[i] = 0;
    }
    for (let c = 0; c < DIM * DIM; c++) start[c + 1] += start[c];
    // counting sort, stable: within a cell, slots stay in slot order
    for (let i = 0; i < n; i++) order[start[cellOf[i]]++] = i;
    for (let c = DIM * DIM; c > 0; c--) start[c] = start[c - 1];
    start[0] = 0;
    for (let i = 0; i < n; i++) {
      const c = cellOf[i], cx = c % DIM, cz = (c - cx) / DIM;
      const xi = X[i], zi = Z[i], ri = R[i], mi = M[i];
      for (let dz = -1; dz <= 1; dz++) {
        const z = cz + dz;
        if (z < 0 || z >= DIM) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx;
          if (x < 0 || x >= DIM) continue;
          const cc = z * DIM + x;
          for (let k = start[cc], end = start[cc + 1]; k < end; k++) {
            const j = order[k];
            if (j <= i) continue; // each pair once
            const mj = M[j];
            if (mi === Infinity && mj === Infinity) continue;
            const ex = xi - X[j], ez = zi - Z[j], min = ri + R[j], d2 = ex * ex + ez * ez;
            if (!(d2 < min * min)) continue;
            const d = Math.sqrt(d2), corr = (min - d) * SEP_RATE;
            // i's share and j's share of the correction
            const si = mi === Infinity ? 0 : mj === Infinity ? 1 : mj / (mi + mj), sj = 1 - si;
            let nx: number, nz: number;
            if (d > 1e-6) { nx = ex / d; nz = ez / d; } else { nx = 1; nz = 0; } // on top of each other: split along x
            PX[i] += nx * corr * si; PZ[i] += nz * corr * si;
            PX[j] -= nx * corr * sj; PZ[j] -= nz * corr * sj;
          }
        }
      }
    }
    let pushed = 0;
    for (let i = 0; i < n; i++) {
      const px = PX[i], pz = PZ[i];
      if (px === 0 && pz === 0) continue;
      pushed++;
      const l = Math.sqrt(px * px + pz * pz);
      if (l > MAX_STEP) { PX[i] = (px / l) * MAX_STEP; PZ[i] = (pz / l) * MAX_STEP; }
    }
    return pushed;
  }
}

/** The grid cell: contacts must not reach past the neighbouring cells (two trolls: 2.8 m). */
export const SEP_CELL = CELL;
