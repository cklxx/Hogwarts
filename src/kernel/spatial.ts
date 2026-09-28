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
const HALF = DIM / 2;
const LOOSE = -1;

export class SpatialHash<T extends Located> {
  private cells: (Rec<T>[] | undefined)[] = new Array(DIM * DIM);
  private recs = new Map<T, Rec<T>>();
  private loose: Rec<T>[] = [];
  constructor(readonly size: number) {}

  get count() { return this.recs.size; }

  private cellOf(p: Vec2): number {
    const x = p.x, z = p.z;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return LOOSE;
    return this.col(x) * DIM + this.col(z);
  }
  private col(v: number) {
    const c = Math.floor(v / this.size) + HALF;
    return c < 0 ? 0 : c >= DIM ? DIM - 1 : c;
  }
  private bucket(cell: number): Rec<T>[] {
    if (cell === LOOSE) return this.loose;
    return (this.cells[cell] ??= []);
  }
  private put(r: Rec<T>) {
    const b = this.bucket(r.cell);
    r.idx = b.length;
    b.push(r);
  }
  private take(r: Rec<T>) {
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
  clear() { this.cells = new Array(DIM * DIM); this.recs.clear(); this.loose = []; }

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
   * fall back to a full scan to stay exact).
   */
  near(x: number, z: number, r: number): T[] | null {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !(r >= 0) || r === Infinity) return null;
    const x0 = this.col(x - r), x1 = this.col(x + r), z0 = this.col(z - r), z1 = this.col(z + r);
    const found: Rec<T>[] = [];
    for (let cx = x0; cx <= x1; cx++) {
      const row = cx * DIM;
      for (let cz = z0; cz <= z1; cz++) {
        const b = this.cells[row + cz];
        if (b) for (let i = 0; i < b.length; i++) found.push(b[i]);
      }
    }
    for (const l of this.loose) found.push(l);
    if (found.length > 1) found.sort(byOrd);
    const out: T[] = new Array(found.length);
    for (let i = 0; i < found.length; i++) out[i] = found[i].e;
    return out;
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
