/**
 * Snapshot wire format v2 (binary, delta): the same snapshot the JSON `{t:'snap', s}` message carries,
 * in about a tenth of the bytes. Shared by the server encoder (src/server/binfanout.ts) and the browser
 * decoder (client/main.ts), so both sides read one definition.
 *
 * An entity entry is split three ways:
 *  - dyn:    the numbers that change every tick (position, facing, health), as zigzag varints of the
 *            values the JSON carries (positions and facing are already rounded to 0.1, health to 1);
 *  - live:   small fields that change now and then (status flags, the speech bubble), JSON;
 *  - static: everything else (name, house, title, kind, …), JSON.
 * Every entity in the client's area gets its dyn part in every frame. live / static are sent only when
 * the client may not have them: the entity is new to its grid cell, the part changed, the cell is new to
 * the client's area, or the client missed a frame (resync). The client keeps them per wire id and forgets
 * an id when a frame no longer carries it. Presence is therefore exactly as in the JSON snapshot: an
 * entity is in the frame or it is not.
 *
 * Frame: u8 FRAME | u8 flags (1 = head present) | zz t×10 | zz hour×10 | vu bytes(w) | vu bytes(c) |
 *        vu bytes(p) | vu bytes(fx) | [vu len, head JSON] | w records | c records | p records | fx records
 * Record (w, c, p): vu wire id | u8 mask (1 = static, 2 = live) | zz dyn… | [vu len, static JSON] | [vu len, live JSON]
 * Record (fx):      vu len, fx JSON (one-shot, no identity)
 * The head is every snapshot field except t, hour, w, c, p and fx; it is sent when it changed.
 */

export const FRAME = 2;
export const HAS_HEAD = 1;
export const M_STATIC = 1;
export const M_LIVE = 2;

export interface Cat { key: 'w' | 'c' | 'p'; id: string; dyn: readonly string[]; scale: readonly number[]; live: readonly string[] }
/** The three entity categories, in frame order. `id` is the entry's identity key; it travels in static. */
export const CATS: readonly Cat[] = [
  { key: 'w', id: 'h', dyn: ['x', 'z', 'f', 'hp'], scale: [10, 10, 10, 1], live: ['s', 'say'] },
  { key: 'c', id: 'i', dyn: ['x', 'z', 'f', 'hp'], scale: [10, 10, 10, 1], live: ['s'] },
  { key: 'p', id: 'i', dyn: ['x', 'z'], scale: [10, 10], live: [] },
];

const enc = new TextEncoder();
const dec = new TextDecoder();

/** A growable byte buffer with varint writers. */
export class Writer {
  buf: Uint8Array;
  n = 0;
  constructor(size = 256) { this.buf = new Uint8Array(size); }
  private room(k: number) {
    if (this.n + k <= this.buf.length) return;
    let s = this.buf.length * 2;
    while (s < this.n + k) s *= 2;
    const b = new Uint8Array(s);
    b.set(this.buf.subarray(0, this.n));
    this.buf = b;
  }
  u8(v: number) { this.room(1); this.buf[this.n++] = v; }
  /** Unsigned varint (7 bits per byte), for 0 ≤ v < 2^53. */
  vu(v: number) {
    this.room(8);
    while (v >= 0x80) { this.buf[this.n++] = (v % 0x80) | 0x80; v = Math.floor(v / 0x80); }
    this.buf[this.n++] = v;
  }
  /** Signed integer as a zigzag varint. */
  zz(v: number) { this.vu(v < 0 ? -2 * v - 1 : 2 * v); }
  bytes(b: Uint8Array) { this.room(b.length); this.buf.set(b, this.n); this.n += b.length; }
  /** Length-prefixed UTF-8. */
  str(s: string) { const b = enc.encode(s); this.vu(b.length); this.bytes(b); }
  reset() { this.n = 0; }
  take() { return this.buf.slice(0, this.n); }
}

/** An entry's dyn number as the integer that travels (non-finite → 0, like nothing sensible). */
export const scaled = (v: unknown, k: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * k) : 0);

/** fx are one-shot visuals: their numbers need no more than centimetres. */
export const fxJson = (fx: unknown) => JSON.stringify(fx, (_k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v));

class Reader {
  i = 0;
  constructor(readonly b: Uint8Array, readonly end = b.length) {}
  u8() { return this.b[this.i++]; }
  vu() {
    let v = 0, m = 1, x: number;
    do { x = this.b[this.i++]; v += (x & 0x7f) * m; m *= 0x80; } while (x & 0x80);
    return v;
  }
  zz() { const u = this.vu(); return u % 2 ? -(u + 1) / 2 : u / 2; }
  str() { const n = this.vu(); const s = dec.decode(this.b.subarray(this.i, this.i + n)); this.i += n; return s; }
}

type Obj = Record<string, unknown>;
interface Meta { st: Obj; lv: Obj }

/**
 * The client side: turns frames back into the snapshot object the JSON message carried. Returns null
 * when a record refers to meta it never received (it then needs a resync; see the server's 'resync').
 */
export class SnapDecoder {
  private meta: Map<number, Meta>[] = CATS.map(() => new Map());
  private head: Obj = {};

  decode(data: Uint8Array): Obj | null {
    const r = new Reader(data);
    if (r.u8() !== FRAME) return null;
    const flags = r.u8();
    const t = r.zz() / 10, hour = r.zz() / 10;
    const lens = [r.vu(), r.vu(), r.vu(), r.vu()];
    if (flags & HAS_HEAD) this.head = JSON.parse(r.str());
    const out: Obj = { t, hour, ...this.head };
    let ok = true;
    for (let k = 0; k < CATS.length; k++) {
      const cat = CATS[k], meta = this.meta[k], seen = new Set<number>(), list: Obj[] = [];
      const end = r.i + lens[k];
      while (r.i < end) {
        const id = r.vu(), mask = r.u8();
        const dyn: number[] = [];
        for (let j = 0; j < cat.dyn.length; j++) dyn.push(r.zz() / cat.scale[j]);
        let m = meta.get(id);
        if (mask & M_STATIC) { const st = JSON.parse(r.str()); m = { st, lv: m && !(mask & M_LIVE) ? m.lv : {} }; meta.set(id, m); }
        if (mask & M_LIVE) { const lv = JSON.parse(r.str()); if (m) m.lv = lv; }
        if (!m) { ok = false; continue; }
        seen.add(id);
        const e: Obj = { ...m.st, ...m.lv };
        for (let j = 0; j < cat.dyn.length; j++) e[cat.dyn[j]] = dyn[j];
        list.push(e);
      }
      for (const id of meta.keys()) if (!seen.has(id)) meta.delete(id);
      out[cat.key] = list;
    }
    const fx: Obj[] = [];
    const end = r.i + lens[3];
    while (r.i < end) fx.push(JSON.parse(r.str()));
    out.fx = fx;
    return ok ? out : null;
  }

  /** Forget everything (the server is asked for a resync). */
  clear() { for (const m of this.meta) m.clear(); this.head = {}; }
}

