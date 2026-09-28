import type { World } from '../kernel/world.js';

/**
 * Snapshot fan-out: the world snapshot is built once per broadcast and encoded once per broadcast —
 * as the full message (fullPayload(), what every client got before) and, for sockets that asked for
 * area-of-interest snapshots, as per-cell payloads (payloadFor()). Both are built lazily, only if some
 * socket needs them this broadcast.
 *
 * Area of interest. Every entity entry (wizard, creature, projectile, fx) is serialised and UTF-8
 * encoded ONCE and filed under a grid cell (`cell` metres). A client receives the entries of every cell
 * whose square comes within `radius` metres of its own (anchor) cell's square. So it always gets
 * everything within `radius − 2·margin` of itself (`guaranteed`; itself included), and nothing further
 * than radius + 2·margin + 2·cell·√2 (≈ 205 m with the defaults 140 / 10 / 16: everything within 120 m).
 *
 * Hysteresis (so nothing flickers in and out at the edge of the area): an entity stays filed under its
 * previous cell while it is within `margin` metres of that cell's square, and a client stays anchored
 * to its previous cell while it is within `margin` of it. An entity or a viewer moving back and forth
 * across a cell boundary (by less than 2·margin) therefore never changes what anyone receives. The
 * margin costs no bytes (the area is the same size); `bench.ts churn` measures what it saves. (A viewer
 * that travels still sweeps its area across the map: what it passes enters ahead of it and what it
 * leaves behind drops out 120-205 m behind it. That churn is inherent to any area of interest.)
 *
 * Payloads are per anchor CELL, so every client anchored to the same cell shares one Buffer. To make
 * building a payload cheap, each grid row is encoded once per broadcast as one buffer (cells in column
 * order, comma separated) with byte offsets per cell; the cells in reach of a client form one column
 * interval per row, i.e. one contiguous byte range, so a payload is ~4 x (2·radius/cell + 1) memcpys.
 *
 * The JSON is exactly `{ t: 'snap', s: world.snapshot() }` — same keys in the same order, same values;
 * only the four arrays are filtered. But a client that gets AOI snapshots sees entities leave (and
 * re-enter) its snapshot all the time as it travels, where before they left only when they died or
 * logged off: it must dispose (or pool) what it removes, and must not treat "left my area" as "died".
 * That is why AOI is opt-in per socket (main.ts). radius <= 0 disables AOI for everyone.
 */
export type Snapshot = ReturnType<World['snapshot']>;

interface Row { cols: number[]; start: number[]; end: number[]; buf: Buffer }

const OFF = 1 << 14;
const clampCell = (v: number) => (v < -OFF + 1 ? -OFF + 1 : v > OFF - 2 ? OFF - 2 : v);
const pack = (cx: number, cz: number) => (cx + OFF) * 2 * OFF + (cz + OFF);
const OPEN = ['"w":[', '],"c":[', '],"p":[', '],"fx":['].map((s) => Buffer.from(s));
const CLOSE = Buffer.from(']');
/** Entry identity per category, for the sticky filing (fx are one-shot: no identity, no stickiness). */
const IDENT: ((e: Record<string, unknown>) => unknown)[] = [(e) => e.h, (e) => e.i, (e) => e.i, () => undefined];

export class SnapshotFanout {
  /** rows[k]: category k (w, c, p, fx) → row z → encoded row. */
  private rows: Map<number, Row>[] = [new Map(), new Map(), new Map(), new Map()];
  /** filed[k]: category k → entity identity → packed cell it is filed under (hysteresis). */
  private filed: Map<unknown, number>[] = [new Map(), new Map(), new Map()];
  private payloads = new Map<number, Buffer>();
  private head = Buffer.alloc(0);
  private tail = Buffer.alloc(0);
  private full: Buffer | null = null;
  private snap: Snapshot | null = null;
  private encoded = false;
  /** span[i] = how many columns either side are in reach in the row dz = i - lim (-1: none). */
  private span: number[] = [];
  private lim: number;
  /** Hysteresis margin in metres (0 .. radius/4). */
  readonly margin: number;
  /** Everything within this distance of a client is always in its payload: radius − 2·margin. */
  readonly guaranteed: number;
  /** Distinct payloads built since the last load (for stats and tests). */
  built = 0;

  constructor(readonly radius: number, readonly cell = 16, margin = 10) {
    this.margin = radius > 0 && margin > 0 ? Math.min(margin, radius / 4) : 0;
    this.guaranteed = radius > 0 ? radius - 2 * this.margin : Infinity;
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

  /** Start a broadcast. Nothing is encoded until a payload is asked for. */
  load(snap: Snapshot) {
    this.snap = snap;
    this.payloads.clear();
    this.full = null;
    this.encoded = false;
    this.built = 0;
  }

  /** The whole snapshot, for sockets without AOI (serialised once per broadcast, shared by all). */
  fullPayload(): Buffer {
    if (!this.snap) throw new Error('SnapshotFanout.fullPayload before load');
    if (!this.full) { this.full = Buffer.from(JSON.stringify({ t: 'snap', s: this.snap })); this.built++; }
    return this.full;
  }

  /** Encode the snapshot's entries row by row (once per broadcast, on the first AOI payload). */
  private encode() {
    this.encoded = true;
    for (const r of this.rows) r.clear();
    const snap = this.snap!;
    const { w, c, p, fx, elder, willowCalm, look, ...headFields } = snap;
    // Same key order as JSON.stringify(snapshot): t, hour, night, weather, term, w, c, p, fx, elder, willowCalm, look
    this.head = Buffer.from(`{"t":"snap","s":${JSON.stringify(headFields).slice(0, -1)},`);
    this.tail = Buffer.from(`,${JSON.stringify({ elder, willowCalm, look }).slice(1)}}`);
    const lists = [w, c, p, fx] as unknown as ({ x: number; z: number } & Record<string, unknown>)[][];
    const D = 2 * OFF;
    for (let k = 0; k < 4; k++) {
      const prev = this.filed[k], next = k < 3 ? new Map<unknown, number>() : null;
      // row z → column x → serialised entries (snapshot order within a cell)
      const grid = new Map<number, Map<number, string[]>>();
      for (const e of lists[k]) {
        const id = IDENT[k](e);
        const key = next && id !== undefined ? this.stickyCell(prev.get(id), e.x, e.z) : pack(this.cellOf(e.x), this.cellOf(e.z));
        if (next && id !== undefined) next.set(id, key);
        const cx = Math.floor(key / D) - OFF, cz = (key % D) - OFF;
        let row = grid.get(cz);
        if (!row) { row = new Map(); grid.set(cz, row); }
        let cellList = row.get(cx);
        if (!cellList) { cellList = []; row.set(cx, cellList); }
        cellList.push(JSON.stringify(e));
      }
      if (next) this.filed[k] = next;
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

  /**
   * The AOI payload for a client standing at (x, z) — shared by every client anchored to the same cell.
   * `anchor` is the client's anchor (kept between broadcasts for hysteresis; updated here). With AOI
   * disabled this is the full snapshot.
   */
  payloadFor(x: number, z: number, anchor: { cell: number } = { cell: -1 }): Buffer {
    if (!this.snap) throw new Error('SnapshotFanout.payloadFor before load');
    if (!this.enabled) return this.fullPayload();
    if (!this.encoded) this.encode();
    // The snapshot rounds positions to 0.1 m; use the same value so a client is judged where its own entry is.
    const key = (anchor.cell = this.stickyCell(anchor.cell, Math.round(x * 10) / 10, Math.round(z * 10) / 10));
    const hit = this.payloads.get(key);
    if (hit) return hit;
    const cx = Math.floor(key / (2 * OFF)) - OFF, cz = (key % (2 * OFF)) - OFF;
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
