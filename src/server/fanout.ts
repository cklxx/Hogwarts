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
 * building a payload cheap, each category is encoded once per broadcast into one buffer, row by row (cells
 * in column order, comma separated), with byte offsets per cell; the cells in reach of a client form one
 * column interval per row, i.e. one contiguous byte range, so a payload is ~4 x (2·radius/cell + 1) memcpys.
 *
 * The JSON is exactly `{ t: 'snap', s: world.snapshot() }` — same keys in the same order, same values;
 * only the four arrays are filtered. But a client that gets AOI snapshots sees entities leave (and
 * re-enter) its snapshot all the time as it travels, where before they left only when they died or
 * logged off: it must dispose (or pool) what it removes, and must not treat "left my area" as "died".
 * That is why AOI is opt-in per socket (main.ts). radius <= 0 disables AOI for everyone.
 */
export type Snapshot = ReturnType<World['snapshot']>;

/** One grid row of a category: its non-empty columns (ascending) and each cell's bytes in the category's buffer. */
interface Row { cols: number[]; start: number[]; end: number[] }
/** A category's encoded entries: `rows[cz - z0]`, all in `buf`. */
interface Encoded { buf: Buffer; z0: number; rows: (Row | undefined)[] }

const OFF = 1 << 14;
const clampCell = (v: number) => (v < -OFF + 1 ? -OFF + 1 : v > OFF - 2 ? OFF - 2 : v);
const pack = (cx: number, cz: number) => (cx + OFF) * 2 * OFF + (cz + OFF);
const OPEN = ['"w":[', '],"c":[', '],"p":[', '],"fx":['].map((s) => Buffer.from(s));
const CLOSE = Buffer.from(']');
/** Entry identity per category, for the sticky filing (fx are one-shot: no identity, no stickiness). */
const IDENT: ((e: Record<string, unknown>) => unknown)[] = [(e) => e.h, (e) => e.i, (e) => e.i, () => undefined];

export class SnapshotFanout {
  /** enc[k]: category k (w, c, p, fx), encoded. */
  private enc: Encoded[] = [];
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
  /** payloadFor's scratch: the byte ranges (and their category) it copies. */
  private from: Int32Array;
  private to: Int32Array;
  private kind: Uint8Array;
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
    this.from = new Int32Array(4 * this.span.length);
    this.to = new Int32Array(4 * this.span.length);
    this.kind = new Uint8Array(4 * this.span.length);
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
    const snap = this.snap!;
    const { w, c, p, fx, elder, willowCalm, look, ...headFields } = snap;
    // Same key order as JSON.stringify(snapshot): t, hour, night, weather, term, w, c, p, fx, elder, willowCalm, look
    this.head = Buffer.from(`{"t":"snap","s":${JSON.stringify(headFields).slice(0, -1)},`);
    this.tail = Buffer.from(`,${JSON.stringify({ elder, willowCalm, look }).slice(1)}}`);
    const lists = [w, c, p, fx] as unknown as ({ x: number; z: number } & Record<string, unknown>)[][];
    const D = 2 * OFF;
    for (let k = 0; k < 4; k++) {
      const list = lists[k], n = list.length;
      const prev = this.filed[k], next = k < 3 ? new Map<unknown, number>() : null;
      // each entry's cell (sticky), as a row-major sort key, and its JSON
      const rk = new Float64Array(n), json: string[] = new Array(n);
      let bytes = 0;
      for (let i = 0; i < n; i++) {
        const e = list[i], id = IDENT[k](e);
        const key = next && id !== undefined ? this.stickyCell(prev.get(id), e.x, e.z) : pack(this.cellOf(e.x), this.cellOf(e.z));
        if (next && id !== undefined) next.set(id, key);
        rk[i] = (key % D) * D + Math.floor(key / D); // (cz, cx), both offset by OFF
        json[i] = JSON.stringify(e);
        bytes += 3 * json[i].length + 1; // UTF-8 needs at most 3 bytes per UTF-16 unit, +1 for the comma
      }
      if (next) this.filed[k] = next;
      // row by row, cells in column order, entries in snapshot order within a cell (the sort is stable)
      const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => rk[a] - rk[b]);
      // one buffer per category, reused from broadcast to broadcast (payloads are copies)
      const old = this.enc[k]?.buf;
      const buf = old && old.length >= bytes ? old : Buffer.allocUnsafe(Math.max(bytes, 2 * (old?.length ?? 0)));
      const z0 = n ? Math.floor(rk[order[0]] / D) - OFF : 0;
      const rows: (Row | undefined)[] = n ? new Array(Math.floor(rk[order[n - 1]] / D) - OFF - z0 + 1) : [];
      let at = 0, row: Row | undefined, rz = 0, rx = 0;
      for (let o = 0; o < n; o++) {
        const i = order[o], cz = Math.floor(rk[i] / D) - OFF, cx = (rk[i] % D) - OFF;
        if (!row || cz !== rz) { // a new row (the previous one ends here: rows are not separated)
          if (row) row.end.push(at);
          row = rows[cz - z0] = { cols: [cx], start: [at], end: [] };
          rz = cz; rx = cx;
        } else if (cx !== rx) { // the next cell of the row
          row.end.push(at);
          buf[at++] = 0x2c;
          row.cols.push(cx); row.start.push(at);
          rx = cx;
        } else buf[at++] = 0x2c; // the next entry of the cell
        at += buf.write(json[i], at);
      }
      if (row) row.end.push(at);
      this.enc[k] = { buf, z0, rows };
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
    const { from, to, kind, span, lim } = this;
    let nr = 0, total = this.head.length + this.tail.length + CLOSE.length;
    for (let k = 0; k < 4; k++) {
      total += OPEN[k].length;
      const { rows, z0 } = this.enc[k];
      for (let i = 0, first = nr; i < span.length; i++) {
        const s = span[i], r = cz + i - lim - z0;
        if (s < 0 || r < 0 || r >= rows.length) continue;
        const row = rows[r];
        if (!row) continue;
        const a = lowerBound(row.cols, cx - s), b = lowerBound(row.cols, cx + s + 1) - 1;
        if (a > b) continue;
        from[nr] = row.start[a]; to[nr] = row.end[b]; kind[nr] = k;
        total += to[nr] - from[nr] + (nr > first ? 1 : 0);
        nr++;
      }
    }
    const out = Buffer.allocUnsafe(total);
    let at = this.head.copy(out, 0);
    for (let k = 0, j = 0; k < 4; k++) {
      at += OPEN[k].copy(out, at);
      const buf = this.enc[k].buf;
      for (let first = j; j < nr && kind[j] === k; j++) {
        if (j > first) out[at++] = 0x2c;
        at += buf.copy(out, at, from[j], to[j]);
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
