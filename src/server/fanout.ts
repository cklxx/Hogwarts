import type { World } from '../kernel/world.js';

/**
 * Area-of-interest snapshot fan-out.
 *
 * The world snapshot is built once per broadcast. Every entity entry (wizard, creature, projectile, fx)
 * is serialised and UTF-8 encoded ONCE, filed under the grid cell (`cell` metres) of its position.
 * A client receives the entries of every cell whose square comes within `radius` metres of its own
 * cell's square: everything within `radius` of it (and nothing further than radius + 2·cell·√2) —
 * always including itself, since its own entry sits in its own cell.
 *
 * Payloads are per client CELL, so every client standing in the same cell shares one Buffer. To make
 * building a payload cheap, each grid row is encoded once per broadcast as one buffer (cells in column
 * order, comma separated) with byte offsets per cell; the cells in reach of a client form one column
 * interval per row, i.e. one contiguous byte range, so a payload is ~4 x (2·radius/cell + 1) memcpys.
 *
 * The JSON is exactly `{ t: 'snap', s: world.snapshot() }` — same keys in the same order, same values;
 * only the four arrays are filtered — so browsers need no change. radius <= 0 disables AOI: every
 * client gets the full snapshot (still serialised and encoded once per broadcast).
 */
export type Snapshot = ReturnType<World['snapshot']>;

interface Row { cols: number[]; start: number[]; end: number[]; buf: Buffer }

const OFF = 1 << 14;
const clampCell = (v: number) => (v < -OFF + 1 ? -OFF + 1 : v > OFF - 2 ? OFF - 2 : v);
const OPEN = ['"w":[', '],"c":[', '],"p":[', '],"fx":['].map((s) => Buffer.from(s));
const CLOSE = Buffer.from(']');

export class SnapshotFanout {
  /** rows[k]: category k (w, c, p, fx) → row z → encoded row. */
  private rows: Map<number, Row>[] = [new Map(), new Map(), new Map(), new Map()];
  private payloads = new Map<number, Buffer>();
  private head = Buffer.alloc(0);
  private tail = Buffer.alloc(0);
  private full: Buffer | null = null;
  private snap: Snapshot | null = null;
  /** span[i] = how many columns either side are in reach in the row dz = i - lim (-1: none). */
  private span: number[] = [];
  private lim: number;
  /** Distinct payloads built since the last load (for stats and tests). */
  built = 0;

  constructor(readonly radius: number, readonly cell = 16) {
    this.lim = radius > 0 ? Math.ceil(radius / cell) + 1 : 0;
    for (let dz = -this.lim; dz <= this.lim; dz++) {
      let s = -1;
      for (let dx = 0; dx <= this.lim; dx++) if (this.inReach(dx, dz)) s = dx;
      this.span.push(s);
    }
  }

  get enabled() { return this.radius > 0; }

  /** Do two cells dx, dz apart come within `radius` of each other (nearest points of the two squares)? */
  inReach(dx: number, dz: number) {
    const gx = Math.max(0, Math.abs(dx) - 1) * this.cell, gz = Math.max(0, Math.abs(dz) - 1) * this.cell;
    return gx * gx + gz * gz <= this.radius * this.radius;
  }
  cellOf(v: number) { return clampCell(Number.isFinite(v) ? Math.floor(v / this.cell) : 0); }

  /** Start a broadcast: encode the snapshot's entries row by row. */
  load(snap: Snapshot) {
    this.snap = snap;
    this.payloads.clear();
    this.full = null;
    this.built = 0;
    for (const r of this.rows) r.clear();
    if (!this.enabled) return;
    const { w, c, p, fx, elder, willowCalm, look, ...headFields } = snap;
    // Same key order as JSON.stringify(snapshot): t, hour, night, weather, term, w, c, p, fx, elder, willowCalm, look
    this.head = Buffer.from(`{"t":"snap","s":${JSON.stringify(headFields).slice(0, -1)},`);
    this.tail = Buffer.from(`,${JSON.stringify({ elder, willowCalm, look }).slice(1)}}`);
    const lists = [w, c, p, fx] as { x: number; z: number }[][];
    for (let k = 0; k < 4; k++) {
      // row z → column x → serialised entries (snapshot order within a cell)
      const grid = new Map<number, Map<number, string[]>>();
      for (const e of lists[k]) {
        const cx = this.cellOf(e.x), cz = this.cellOf(e.z);
        let row = grid.get(cz);
        if (!row) { row = new Map(); grid.set(cz, row); }
        let cellList = row.get(cx);
        if (!cellList) { cellList = []; row.set(cx, cellList); }
        cellList.push(JSON.stringify(e));
      }
      for (const [cz, row] of grid) {
        const cols = [...row.keys()].sort((a, b) => a - b);
        const pieces = cols.map((cx) => Buffer.from(row.get(cx)!.join(',')));
        const start: number[] = [], end: number[] = [];
        let at = 0;
        for (let i = 0; i < pieces.length; i++) {
          if (i) at += 1; // the comma between cells
          start.push(at);
          at += pieces[i].length;
          end.push(at);
        }
        const buf = Buffer.allocUnsafe(at);
        for (let i = 0; i < pieces.length; i++) { pieces[i].copy(buf, start[i]); if (i) buf[start[i] - 1] = 0x2c; }
        this.rows[k].set(cz, { cols, start, end, buf });
      }
    }
  }

  /** The payload for a client standing at (x, z) — shared by everyone in the same cell. */
  payloadFor(x: number, z: number): Buffer {
    if (!this.snap) throw new Error('SnapshotFanout.payloadFor before load');
    if (!this.enabled) {
      if (!this.full) { this.full = Buffer.from(JSON.stringify({ t: 'snap', s: this.snap })); this.built = 1; }
      return this.full;
    }
    // The snapshot rounds positions to 0.1 m; use the same value so a client lands in its own entry's cell.
    const cx = this.cellOf(Math.round(x * 10) / 10), cz = this.cellOf(Math.round(z * 10) / 10);
    const key = (cx + OFF) * 2 * OFF + (cz + OFF);
    const hit = this.payloads.get(key);
    if (hit) return hit;
    // Collect one byte range per (category, row), nearest rows first.
    const bufs: Buffer[] = [], from: number[] = [], to: number[] = [], kinds: number[] = [];
    let total = this.head.length + this.tail.length + CLOSE.length;
    for (let k = 0; k < 4; k++) {
      total += OPEN[k].length;
      const rows = this.rows[k];
      let n = 0;
      for (let i = 0; i < this.span.length; i++) {
        const s = this.span[i];
        if (s < 0) continue;
        const row = rows.get(cz + i - this.lim);
        if (!row) continue;
        const a = lowerBound(row.cols, cx - s), b = lowerBound(row.cols, cx + s + 1) - 1;
        if (a > b) continue;
        bufs.push(row.buf); from.push(row.start[a]); to.push(row.end[b]); kinds.push(k);
        total += row.end[b] - row.start[a] + (n++ ? 1 : 0);
      }
    }
    const out = Buffer.allocUnsafe(total);
    let at = this.head.copy(out, 0);
    let j = 0;
    for (let k = 0; k < 4; k++) {
      at += OPEN[k].copy(out, at);
      let first = true;
      for (; j < bufs.length && kinds[j] === k; j++) {
        if (!first) out[at++] = 0x2c;
        at += bufs[j].copy(out, at, from[j], to[j]);
        first = false;
      }
    }
    at += CLOSE.copy(out, at);
    at += this.tail.copy(out, at);
    this.payloads.set(key, out);
    this.built++;
    return out;
  }
}

/** First index i with xs[i] >= v (xs ascending). */
function lowerBound(xs: number[], v: number) {
  let lo = 0, hi = xs.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (xs[mid] < v) lo = mid + 1; else hi = mid; }
  return lo;
}
