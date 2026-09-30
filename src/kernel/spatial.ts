import type { Vec2 } from './types.js';

/**
 * Spatial index for the world's wizards and creatures.
 *
 * A uniform grid (cell = `size` metres) over a dense 128 x 128 window centred on the origin; anything
 * outside the window is clamped into the border cells, anything with a non-finite position sits in a
 * "loose" list that every query returns. Queries return a SUPERSET of the entities within the radius
 * (every entity whose cell overlaps the query square); callers keep their exact distance test, so the
 * index only removes work and never changes an answer.
 *
 * Determinism: each entity carries the ordinal of its insertion into the owning EntityMap, and
 * queries return candidates in that order, i.e. exactly the order `map.values()` would visit them.
 * Code that used to scan the whole Map and filter therefore sees the same entities in the same order.
 */
export interface Located { id: string; pos: Vec2 }

interface Rec<T> { e: T; ord: number; cell: number; idx: number }

const DIM = 128; // cells per side of the dense window
/** A packed (not holey) array of empty cells: reading a cell stays a plain load. */
const noCells = <T>(): (Rec<T>[] | undefined)[] => Array.from({ length: DIM * DIM }, () => undefined);
const HALF = DIM / 2;
const LOOSE = -1;

export class SpatialHash<T extends Located> {
  private cells = noCells<T>();
  private recs = new Map<T, Rec<T>>();
  private loose: Rec<T>[] = [];
  /** Bumped whenever a record is filed or unfiled: near(…, out) reuses its last answer while nothing changed. */
  private version = 0;
  private memo = { out: null as T[] | null, version: -1, x0: 0, x1: 0, z0: 0, z1: 0 };
  /** 1 / size: a product instead of a quotient per column (the same number for a power-of-two size). */
  private inv: number;
  constructor(readonly size: number) { this.inv = 1 / size; }

  get count() { return this.recs.size; }

  private cellOf(p: Vec2): number {
    const x = p.x, z = p.z;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return LOOSE;
    return this.col(x) * DIM + this.col(z);
  }
  private col(v: number) {
    const c = Math.floor(v * this.inv) + HALF;
    return c < 0 ? 0 : c >= DIM ? DIM - 1 : c;
  }
  private bucket(cell: number): Rec<T>[] {
    if (cell === LOOSE) return this.loose;
    return (this.cells[cell] ??= []);
  }
  private put(r: Rec<T>) {
    this.version++;
    const b = this.bucket(r.cell);
    r.idx = b.length;
    b.push(r);
  }
  private take(r: Rec<T>) {
    this.version++;
    const b = r.cell === LOOSE ? this.loose : this.cells[r.cell]!;
    const last = b.pop()!;
    if (last !== r) { b[r.idx] = last; last.idx = r.idx; }
  }

  insert(e: T, ord: number) {
    if (this.recs.has(e)) this.remove(e);
    const r: Rec<T> = { e, ord, cell: this.cellOf(e.pos), idx: 0 };
    this.recs.set(e, r);
    this.put(r);
  }
  remove(e: T) {
    const r = this.recs.get(e);
    if (!r) return;
    this.take(r);
    this.recs.delete(e);
  }
  ordOf(e: T) { return this.recs.get(e)?.ord; }
  clear() { this.version++; this.cells = noCells<T>(); this.recs.clear(); this.loose = []; }

  /** Re-file one entity after its position changed. O(1). */
  update(e: T) {
    const r = this.recs.get(e);
    if (!r) return;
    const cell = this.cellOf(e.pos);
    if (cell === r.cell) return;
    this.take(r);
    r.cell = cell;
    this.put(r);
  }

  /** Re-file every entity (positions may have been changed by code that does not report moves). O(n). */
  syncAll() {
    for (const r of this.recs.values()) {
      const cell = this.cellOf(r.e.pos);
      if (cell === r.cell) continue;
      this.take(r);
      r.cell = cell;
      this.put(r);
    }
  }

  /**
   * Candidates that may lie within `r` of (x, z), in insertion order. Returns null when the query
   * itself is not finite (a NaN radius or centre makes every distance test pass, so callers must
   * fall back to a full scan to stay exact). With `out`, the candidates are written into it (and it is
   * returned) instead of a new array — for hot callers that do not nest queries and never write to `out`:
   * asked again with the same `out` for the same cells while nothing was re-filed, it is already the answer.
   */
  near(x: number, z: number, r: number, out?: T[]): readonly T[] | null {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !(r >= 0) || r === Infinity) return null;
    const x0 = this.col(x - r), x1 = this.col(x + r), z0 = this.col(z - r), z1 = this.col(z + r);
    const m = this.memo;
    if (out) {
      if (m.out === out && m.version === this.version && m.x0 === x0 && m.x1 === x1 && m.z0 === z0 && m.z1 === z1) return out;
      m.out = out; m.version = this.version; m.x0 = x0; m.x1 = x1; m.z0 = z0; m.z1 = z1;
    }
    const found = scratch as Rec<T>[];
    let n = 0;
    for (let cx = x0; cx <= x1; cx++) {
      const row = cx * DIM;
      for (let cz = z0; cz <= z1; cz++) {
        const b = this.cells[row + cz];
        if (b) for (let i = 0; i < b.length; i++) found[n++] = b[i];
      }
    }
    for (let i = 0, L = this.loose; i < L.length; i++) found[n++] = L[i];
    if (out && out.length !== n) out.length = n;
    if (!n) return out ?? EMPTY;
    sortByOrd(found, n);
    const res: T[] = out ?? new Array(n);
    for (let i = 0; i < n; i++) { res[i] = found[i].e; found[i] = undefined!; }
    return res;
  }

  /** Internal consistency check for tests: every entity is filed in the cell of its position. */
  check(): string | null {
    let n = this.loose.length;
    for (const b of this.cells) if (b) n += b.length;
    if (n !== this.recs.size) return `filed ${n} records for ${this.recs.size} entities`;
    for (const r of this.recs.values()) {
      const b = r.cell === LOOSE ? this.loose : this.cells[r.cell];
      if (!b || b[r.idx] !== r) return `${r.e.id} is misfiled`;
      if (r.cell !== this.cellOf(r.e.pos)) return `${r.e.id} is filed in a stale cell`;
    }
    return null;
  }
}

const byOrd = (a: { ord: number }, b: { ord: number }) => a.ord - b.ord;
/** Sort the first n records by ordinal (unique): insertion sort for the usual handful, else Array#sort. */
function sortByOrd(a: Rec<Located>[], n: number) {
  if (n > 16) { a.length = n; a.sort(byOrd); return; }
  for (let i = 1; i < n; i++) {
    const r = a[i];
    let j = i - 1;
    while (j >= 0 && a[j].ord > r.ord) { a[j + 1] = a[j]; j--; }
    a[j + 1] = r;
  }
}
/** near() is not re-entrant (it calls nothing), so one scratch buffer serves every query. */
const scratch: Rec<Located>[] = [];
/** Shared result for empty queries; callers only read results. */
const EMPTY: readonly never[] = Object.freeze([]);

/**
 * A Map of entities that keeps a SpatialHash in step with its membership (set/delete/clear), so code
 * that writes `world.creatures.set(id, c)` directly (tests, restore) is indexed too. Positions are
 * re-filed by the World when it moves things, and in bulk at the start of every tick.
 */
export class EntityMap<T extends Located> extends Map<string, T> {
  readonly grid: SpatialHash<T>;
  private seq = 0;
  constructor(cell = 8) {
    super();
    this.grid = new SpatialHash<T>(cell);
  }
  override set(k: string, v: T): this {
    const prev = super.get(k);
    super.set(k, v);
    if (prev === v) this.grid.update(v);
    else {
      const ord = prev ? this.grid.ordOf(prev) ?? ++this.seq : ++this.seq; // Map keeps an existing key's position
      if (prev) this.grid.remove(prev);
      this.grid.insert(v, ord);
    }
    return this;
  }
  override delete(k: string): boolean {
    const prev = super.get(k);
    if (prev) this.grid.remove(prev);
    return super.delete(k);
  }
  override clear() {
    this.grid.clear();
    super.clear();
  }
}

/**
 * The pairs of (finite) points within r of each other along both axes — a superset of those within r, which callers
 * test exactly: for each i, the j > i in ascending order (undefined: none). A sweep along x: O(n log n + pairs).
 */
export function closePairs(X: Float64Array, Z: Float64Array, r: number): (number[] | undefined)[] {
  const n = X.length, out: (number[] | undefined)[] = new Array(n);
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => X[a] - X[b]);
  for (let a = 0; a < n; a++) {
    const i = order[a];
    for (let b = a + 1; b < n && X[order[b]] - X[i] <= r; b++) {
      const j = order[b];
      if (Z[j] - Z[i] > r || Z[j] - Z[i] < -r) continue;
      (out[i < j ? i : j] ??= []).push(i < j ? j : i);
    }
  }
  for (const l of out) if (l && l.length > 1) l.sort((a, b) => a - b);
  return out;
}
