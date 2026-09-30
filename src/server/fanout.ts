import type { World } from '../kernel/world.js';

/**
 * The area of interest's geometry (the snapshots themselves: binfanout.ts, wire format src/shared/snapwire.ts).
 *
 * The map is cut into square cells of CELL metres. A client receives the entities filed under every cell whose
 * square comes within RADIUS metres of its own (anchor) cell's square: so it always gets everything within
 * RADIUS − 2·MARGIN of itself (`guaranteed`; itself included), and nothing further than
 * RADIUS + 2·MARGIN + 2·CELL·√2 (≈ 205 m: everything within 120 m).
 *
 * Hysteresis (so nothing flickers at the edge): an entity stays filed under its previous cell while it is within
 * MARGIN metres of that cell's square, and a client stays anchored to its previous cell likewise. Moving back and
 * forth across a boundary by less than 2·MARGIN therefore changes nothing anyone receives. (A viewer that travels
 * still sweeps its area across the map: what it passes enters ahead and drops out 120-205 m behind; the client
 * disposes, or pools, what leaves, and never treats "left my area" as "died".)
 */
export type Snapshot = ReturnType<World['snapshot']>;

/** The one configuration (bench.ts churn measured it): 140 m reach, 16 m cells, 10 m of hysteresis. */
export const AOI_RADIUS = 140, AOI_CELL = 16, AOI_MARGIN = 10;

export const OFF = 1 << 14;
const clampCell = (v: number) => (v < -OFF + 1 ? -OFF + 1 : v > OFF - 2 ? OFF - 2 : v);
export const pack = (cx: number, cz: number) => (cx + OFF) * 2 * OFF + (cz + OFF);

export class AoiGrid {
  /** span[i] = how many columns either side are in reach in the row dz = i - lim (-1: none). */
  readonly span: number[] = [];
  readonly lim: number;
  /** Everything within this distance of a client is always in its frame: radius − 2·margin. */
  readonly guaranteed: number;

  constructor(readonly radius = AOI_RADIUS, readonly cell = AOI_CELL, readonly margin = AOI_MARGIN) {
    this.guaranteed = radius - 2 * margin;
    this.lim = Math.ceil(radius / cell) + 1;
    for (let dz = -this.lim; dz <= this.lim; dz++) {
      let s = -1;
      for (let dx = 0; dx <= this.lim; dx++) if (this.inReach(dx, dz)) s = dx;
      this.span.push(s);
    }
  }

  /** Do two cells dx, dz apart come within `radius` of each other (nearest points of the two squares)? */
  inReach(dx: number, dz: number) {
    const gx = Math.max(0, Math.abs(dx) - 1) * this.cell, gz = Math.max(0, Math.abs(dz) - 1) * this.cell;
    return gx * gx + gz * gz <= this.radius * this.radius;
  }
  cellOf(v: number) { return clampCell(Number.isFinite(v) ? Math.floor(v / this.cell) : 0); }
  /** Is (x, z) within `margin` metres of the square of packed cell `key`? */
  private near(key: number, x: number, z: number) {
    const cx = Math.floor(key / (2 * OFF)) - OFF, cz = (key % (2 * OFF)) - OFF;
    const x0 = cx * this.cell, z0 = cz * this.cell;
    const ox = Math.max(0, x0 - x, x - (x0 + this.cell)), oz = Math.max(0, z0 - z, z - (z0 + this.cell));
    return ox * ox + oz * oz <= this.margin * this.margin; // false for NaN
  }
  /** The cell an entity or viewer at (x, z) belongs to, keeping `prev` while within `margin` of it. */
  stickyCell(prev: number | undefined, x: number, z: number) {
    return prev !== undefined && prev >= 0 && this.near(prev, x, z) ? prev : pack(this.cellOf(x), this.cellOf(z));
  }
}

export function lowerBound(xs: number[], v: number) {
  let lo = 0, hi = xs.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (xs[mid] < v) lo = mid + 1; else hi = mid; }
  return lo;
}
