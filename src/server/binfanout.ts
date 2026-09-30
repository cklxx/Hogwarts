import { CATS, FRAME, HAS_HEAD, M_LIVE, M_STATIC, Writer, fxJson, scaled } from '../shared/snapwire.js';
import { OFF, lowerBound, type AoiGrid, type Snapshot } from './fanout.js';

/**
 * The snapshots every browser gets: binary deltas (wire format: src/shared/snapwire.ts) of its area of interest
 * (the geometry and hysteresis: fanout.ts AoiGrid). Every record is encoded ONCE per broadcast, filed
 * under its grid cell, and each grid row is one buffer, so a client's payload is a handful of memcpys.
 * Each cell is encoded twice: `delta` (live / static only where they changed or the entity is new to the
 * cell) and `full` (live and static for everyone). A client whose area did not move gets the delta of
 * every cell; after it moves, the cells new to its area come from `full`; after a missed frame
 * (`resync`) everything does. Payloads are shared by every client with the same (previous, current)
 * anchor, which in steady state is just the anchor, as before.
 */

/** Per socket: the anchor of the last frame it was sent, and whether it may have missed one. */
export interface BinState { anchor: number; resync: boolean }
export const binState = (): BinState => ({ anchor: -1, resync: true });

interface Row { cols: number[]; fs: number[]; fe: number[]; full: Buffer; ds: number[]; de: number[]; delta: Buffer }
interface Filed { cell: number; st: string; lv: string }
/** One cell's records while encoding. */
interface Cell { full: Uint8Array[]; delta: Uint8Array[] }

const round1 = (v: number) => Math.round(v * 10) / 10;

export class BinFanout {
  /** rows[k]: category k (w, c, p, fx) → row z → encoded row. */
  private rows: Map<number, Row>[] = [new Map(), new Map(), new Map(), new Map()];
  /** filed[k]: identity → where the entity was filed last encode and the live/static JSON it had. */
  private filed: Map<string, Filed>[] = CATS.map(() => new Map());
  /** Wire ids per category: identity → id, and the ids free for reuse. */
  private ids: Map<string, number>[] = CATS.map(() => new Map());
  private free: number[][] = CATS.map(() => []);
  private next: number[] = CATS.map(() => 0);
  private payloads = new Map<string, Buffer>();
  private snap: Snapshot | null = null;
  private encoded = false;
  private headJson = '';
  private headBytes = Buffer.alloc(0);
  private headChanged = false;
  private w = new Writer(1 << 16);
  private rec = new Writer(256);
  /** Distinct payloads built since the last load (for stats and tests). */
  built = 0;

  constructor(readonly geo: AoiGrid) {}

  load(snap: Snapshot) {
    this.snap = snap;
    this.payloads.clear();
    this.encoded = false;
    this.built = 0;
  }


  private wid(k: number, key: string) {
    let id = this.ids[k].get(key);
    if (id === undefined) { id = this.free[k].pop() ?? this.next[k]++; this.ids[k].set(key, id); }
    return id;
  }

  private encode() {
    this.encoded = true;
    const snap = this.snap!;
    const { t: _t, hour: _h, w, c, p, fx, ...head } = snap;
    const hj = JSON.stringify(head);
    this.headChanged = hj !== this.headJson;
    if (this.headChanged) { this.headJson = hj; this.headBytes = Buffer.from(hj); }
    const lists = [w, c, p] as unknown as Record<string, unknown>[][];
    const D = 2 * OFF;
    for (let k = 0; k < 4; k++) {
      const grid = new Map<number, Map<number, Cell>>();
      const put = (key: number, full: Uint8Array, delta: Uint8Array) => {
        const cx = Math.floor(key / D) - OFF, cz = (key % D) - OFF;
        let row = grid.get(cz);
        if (!row) { row = new Map(); grid.set(cz, row); }
        let cell = row.get(cx);
        if (!cell) { cell = { full: [], delta: [] }; row.set(cx, cell); }
        cell.full.push(full); cell.delta.push(delta);
      };
      if (k < 3) {
        const cat = CATS[k], prev = this.filed[k], next = new Map<string, Filed>();
        const skip = new Set([...cat.dyn, ...cat.live]);
        for (const e of lists[k]) {
          const key = String(e[cat.id]);
          const was = prev.get(key);
          const cell = this.geo.stickyCell(was?.cell, e.x as number, e.z as number);
          const st: Record<string, unknown> = {}, lv: Record<string, unknown> = {};
          for (const f in e) { if (!skip.has(f)) st[f] = e[f]; }
          for (const f of cat.live) if (e[f] !== undefined) lv[f] = e[f];
          const sj = JSON.stringify(st), lj = JSON.stringify(lv);
          next.set(key, { cell, st: sj, lv: lj });
          const moved = !was || was.cell !== cell;
          const mask = (moved || was.st !== sj ? M_STATIC : 0) | (moved || was.lv !== lj ? M_LIVE : 0);
          const id = this.wid(k, key);
          const r = this.rec;
          r.reset(); r.vu(id); r.u8(M_STATIC | M_LIVE);
          for (let j = 0; j < cat.dyn.length; j++) r.zz(scaled(e[cat.dyn[j]], cat.scale[j]));
          const dynEnd = r.n;
          r.str(sj); r.str(lj);
          const full = r.take();
          let delta: Uint8Array;
          if (mask === (M_STATIC | M_LIVE)) delta = full;
          else {
            r.n = dynEnd;
            if (mask & M_STATIC) r.str(sj);
            if (mask & M_LIVE) r.str(lj);
            delta = r.take();
            delta[varintLen(id)] = mask;
          }
          put(cell, full, delta);
        }
        // identities gone this broadcast give their wire ids back
        for (const key of prev.keys()) if (!next.has(key)) { const id = this.ids[k].get(key); if (id !== undefined) { this.ids[k].delete(key); this.free[k].push(id); } }
        this.filed[k] = next;
      } else {
        for (const e of fx as unknown as Record<string, unknown>[]) {
          const r = this.rec;
          r.reset(); r.str(fxJson(e));
          const b = r.take();
          put(this.geo.stickyCell(undefined, e.x as number, e.z as number), b, b);
        }
      }
      this.rows[k].clear();
      for (const [cz, row] of grid) {
        const cols = [...row.keys()].sort((a, b) => a - b);
        const fs: number[] = [], fe: number[] = [], ds: number[] = [], de: number[] = [];
        const fullParts: Uint8Array[] = [], deltaParts: Uint8Array[] = [];
        let fa = 0, da = 0;
        for (const cx of cols) {
          const cell = row.get(cx)!;
          fs.push(fa); ds.push(da);
          for (const b of cell.full) { fullParts.push(b); fa += b.length; }
          for (const b of cell.delta) { deltaParts.push(b); da += b.length; }
          fe.push(fa); de.push(da);
        }
        this.rows[k].set(cz, { cols, fs, fe, full: Buffer.concat(fullParts, fa), ds, de, delta: Buffer.concat(deltaParts, da) });
      }
    }
  }

  private parts: [Buffer, number, number][] = [];
  private lens = [0, 0, 0, 0];
  /** Queue row `row`'s records in columns a..b (category k), from its delta or its full buffer. */
  private take(k: number, row: Row, a: number, b: number, delta: boolean) {
    if (a > b) return;
    const i0 = lowerBound(row.cols, a), i1 = lowerBound(row.cols, b + 1) - 1;
    if (i0 > i1) return;
    const from = delta ? row.ds[i0] : row.fs[i0], to = delta ? row.de[i1] : row.fe[i1];
    if (to > from) { this.parts.push([delta ? row.delta : row.full, from, to]); this.lens[k] += to - from; }
  }

  /**
   * The frame for a client standing at (x, z). `st` is the socket's BinState: its anchor is updated and
   * its resync flag cleared, since the caller sends this frame.
   */
  payloadFor(x: number, z: number, st: BinState): Buffer {
    if (!this.snap) throw new Error('BinFanout.payloadFor before load');
    if (!this.encoded) this.encode();
    const prev = st.resync ? -1 : st.anchor;
    const anchor = this.geo.stickyCell(st.anchor, round1(x), round1(z));
    st.anchor = anchor;
    st.resync = false;
    const key = `${prev}:${anchor}`;
    const hit = this.payloads.get(key);
    if (hit) return hit;
    const D = 2 * OFF;
    const ax = Math.floor(anchor / D) - OFF, az = (anchor % D) - OFF;
    const px = prev < 0 ? 0 : Math.floor(prev / D) - OFF, pz = prev < 0 ? 0 : (prev % D) - OFF;
    const { lim, span } = this.geo;
    // (buffer, from, to) per copied range, per category
    const parts = this.parts, lens = this.lens;
    parts.length = 0;
    for (let k = 0; k < 4; k++) {
      lens[k] = 0;
      const rows = this.rows[k];
      for (let i = 0; i < span.length; i++) {
        const s = span[i];
        if (s < 0) continue;
        const cz = az + i - lim;
        const row = rows.get(cz);
        if (!row) continue;
        const lo = ax - s, hi = ax + s;
        // the columns of this row the client already had (previous anchor's area), if any
        let plo = 1, phi = 0;
        if (prev >= 0) {
          const j = cz - pz + lim;
          if (j >= 0 && j < span.length && span[j] >= 0) { plo = Math.max(lo, px - span[j]); phi = Math.min(hi, px + span[j]); }
        }
        if (plo > phi) this.take(k, row, lo, hi, false);
        else { this.take(k, row, lo, plo - 1, false); this.take(k, row, plo, phi, true); this.take(k, row, phi + 1, hi, false); }
      }
    }
    const hasHead = prev < 0 || this.headChanged;
    const h = this.w;
    h.reset();
    h.u8(FRAME); h.u8(hasHead ? HAS_HEAD : 0);
    h.zz(scaled(this.snap.t, 10)); h.zz(scaled(this.snap.hour, 10));
    for (const n of lens) h.vu(n);
    if (hasHead) { h.vu(this.headBytes.length); h.bytes(this.headBytes); }
    const out = Buffer.allocUnsafe(h.n + lens[0] + lens[1] + lens[2] + lens[3]);
    out.set(h.buf.subarray(0, h.n), 0);
    let at = h.n;
    for (const [b, from, to] of parts) at += b.copy(out, at, from, to);
    this.payloads.set(key, out);
    this.built++;
    return out;
  }
}

function varintLen(v: number) { let n = 1; while (v >= 0x80) { v = Math.floor(v / 0x80); n++; } return n; }
