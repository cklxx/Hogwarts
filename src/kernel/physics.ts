import { BOLT_HEIGHT, STATIC_COLLIDERS, WORLD_EDGE, colliderBounds, type Collider } from '../shared/layout.js';
import { WORLD_HALF } from '../shared/map.js';
import type { Vec2 } from './types.js';

export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Static collision against the layout in src/shared/layout.ts (the same data the client draws from).
 *
 * Colliders are packed into typed arrays: kind (disc / axis-aligned box / oriented box), centre, half
 * extents or radius, and cos/sin of the yaw. Static ones are filed in a uniform grid (CELL metres) under
 * every cell their bounds, grown by PAD, touch; so a circle of radius <= PAD needs only the one cell under
 * its centre, with no duplicates and no allocation. Dynamic colliders (Ministers' statues: a handful, per
 * world) are a short list checked after the grid.
 */
const CELL = 8;
/** The largest radius a single-cell query covers (the troll is 1.4 m). */
const PAD = 1.6;
const DISC = 0, BOX = 1, OBOX = 2;
const STRIDE = 6;

/** Packed colliders: K kind, F [cx, cz, r|hx, hz, cos, sin], H height. */
class Packed {
  K: Uint8Array; F: Float64Array; H: Float64Array; list: Collider[] = [];
  constructor(cap: number) { this.K = new Uint8Array(cap); this.F = new Float64Array(cap * STRIDE); this.H = new Float64Array(cap); }
  get n() { return this.list.length; }
  set(cs: readonly Collider[]) {
    if (cs.length > this.K.length) { this.K = new Uint8Array(cs.length); this.F = new Float64Array(cs.length * STRIDE); this.H = new Float64Array(cs.length); }
    this.list = [...cs];
    cs.forEach((c, i) => {
      const o = i * STRIDE, F = this.F;
      this.H[i] = c.h;
      if (c.kind === 'disc') { this.K[i] = DISC; F[o] = c.x; F[o + 1] = c.z; F[o + 2] = c.r; }
      else if (c.kind === 'box') { this.K[i] = BOX; F[o] = (c.x0 + c.x1) / 2; F[o + 1] = (c.z0 + c.z1) / 2; F[o + 2] = (c.x1 - c.x0) / 2; F[o + 3] = (c.z1 - c.z0) / 2; }
      else { this.K[i] = OBOX; F[o] = c.x; F[o + 1] = c.z; F[o + 2] = c.hx; F[o + 3] = c.hz; F[o + 4] = Math.cos(c.yaw); F[o + 5] = Math.sin(c.yaw); }
    });
  }
}

/** Push the circle (p, r) out of collider i. Returns true when it moved p. */
function pushOut(P: Packed, i: number, p: Vec2, r: number): boolean {
  const F = P.F, o = i * STRIDE, k = P.K[i];
  const dx = p.x - F[o], dz = p.z - F[o + 1];
  if (k === DISC) {
    const min = F[o + 2] + r, d2 = dx * dx + dz * dz;
    if (d2 >= min * min) return false;
    const d = Math.sqrt(d2);
    if (d > 1e-6) { p.x = F[o] + (dx / d) * min; p.z = F[o + 1] + (dz / d) * min; }
    else p.x = F[o] + min;
    return true;
  }
  const hx = F[o + 2], hz = F[o + 3];
  // quick reject on the (rotation-proof) bounding circle
  const reach = hx + hz + r;
  if (dx > reach || dx < -reach || dz > reach || dz < -reach) return false;
  let cs = 1, sn = 0, lx = dx, lz = dz;
  if (k === OBOX) { cs = F[o + 4]; sn = F[o + 5]; lx = dx * cs - dz * sn; lz = dx * sn + dz * cs; }
  const qx = lx < -hx ? -hx : lx > hx ? hx : lx, qz = lz < -hz ? -hz : lz > hz ? hz : lz;
  const ex = lx - qx, ez = lz - qz, d2 = ex * ex + ez * ez;
  if (d2 >= r * r) return false;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    lx = qx + (ex / d) * r; lz = qz + (ez / d) * r;
  } else if (hx - Math.abs(lx) <= hz - Math.abs(lz)) lx = (lx < 0 ? -1 : 1) * (hx + r); // centre inside: leave by the shallowest side
  else lz = (lz < 0 ? -1 : 1) * (hz + r);
  p.x = F[o] + lx * cs + lz * sn;
  p.z = F[o + 1] - lx * sn + lz * cs;
  return true;
}

/**
 * Where along a→a+d (t in [0, 1]) the segment first touches collider i grown by `g` (a disc's radius + g; a box's
 * half extents + g, square corners: conservative); Infinity if it misses.
 */
function segHit(P: Packed, i: number, ax: number, az: number, dx: number, dz: number, g: number): number {
  const F = P.F, o = i * STRIDE, k = P.K[i];
  const fx = ax - F[o], fz = az - F[o + 1];
  if (k === DISC) {
    const r = F[o + 2] + g, c = fx * fx + fz * fz - r * r;
    if (c <= 0) return 0;
    const a = dx * dx + dz * dz, b = 2 * (fx * dx + fz * dz);
    if (a < 1e-12 || b >= 0) return Infinity;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return Infinity;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    return t <= 1 ? t : Infinity;
  }
  let lx = fx, lz = fz, ux = dx, uz = dz;
  if (k === OBOX) {
    const cs = F[o + 4], sn = F[o + 5];
    lx = fx * cs - fz * sn; lz = fx * sn + fz * cs;
    ux = dx * cs - dz * sn; uz = dx * sn + dz * cs;
  }
  const hx = F[o + 2] + g, hz = F[o + 3] + g;
  let t0 = 0, t1 = 1;
  if (Math.abs(ux) < 1e-12) { if (lx < -hx || lx > hx) return Infinity; }
  else {
    let a = (-hx - lx) / ux, b = (hx - lx) / ux;
    if (a > b) { const s = a; a = b; b = s; }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return Infinity;
  }
  if (Math.abs(uz) < 1e-12) { if (lz < -hz || lz > hz) return Infinity; }
  else {
    let a = (-hz - lz) / uz, b = (hz - lz) / uz;
    if (a > b) { const s = a; a = b; b = s; }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return Infinity;
  }
  return t0;
}

// ---- the static grid (CSR: cellStart[c]..cellStart[c+1] index into cellItems)
const S = new Packed(STATIC_COLLIDERS.length);
S.set(STATIC_COLLIDERS);
let gx0 = -WORLD_HALF - CELL, gz0 = -WORLD_HALF - CELL, gx1 = WORLD_HALF + CELL, gz1 = WORLD_HALF + CELL;
for (const c of STATIC_COLLIDERS) {
  const [x0, z0, x1, z1] = colliderBounds(c);
  gx0 = Math.min(gx0, x0 - PAD - CELL); gz0 = Math.min(gz0, z0 - PAD - CELL); gx1 = Math.max(gx1, x1 + PAD + CELL); gz1 = Math.max(gz1, z1 + PAD + CELL);
}
gx0 = Math.floor(gx0 / CELL) * CELL; gz0 = Math.floor(gz0 / CELL) * CELL;
const GW = Math.ceil((gx1 - gx0) / CELL), GH = Math.ceil((gz1 - gz0) / CELL);
const cellStart = new Int32Array(GW * GH + 1);
const cellItems: Int32Array = (() => {
  const spans = STATIC_COLLIDERS.map((c) => {
    const [x0, z0, x1, z1] = colliderBounds(c);
    return [colX(x0 - PAD), colZ(z0 - PAD), colX(x1 + PAD), colZ(z1 + PAD)];
  });
  const count = new Int32Array(GW * GH);
  for (const [a, b, c, d] of spans) for (let i = a; i <= c; i++) for (let j = b; j <= d; j++) count[j * GW + i]++;
  for (let k = 0; k < GW * GH; k++) cellStart[k + 1] = cellStart[k] + count[k];
  const items = new Int32Array(cellStart[GW * GH]);
  const fill = cellStart.slice(0, GW * GH);
  spans.forEach(([a, b, c, d], n) => { for (let i = a; i <= c; i++) for (let j = b; j <= d; j++) items[fill[j * GW + i]++] = n; });
  return items;
})();
function colX(x: number) { const c = Math.floor((x - gx0) / CELL); return c < 0 ? 0 : c >= GW ? GW - 1 : c; }
function colZ(z: number) { const c = Math.floor((z - gz0) / CELL); return c < 0 ? 0 : c >= GH ? GH - 1 : c; }
const inGrid = (x: number, z: number) => x >= gx0 && z >= gz0 && x < gx0 + GW * CELL && z < gz0 + GH * CELL;

/** Keep p inside the walkable world: the WORLD_HALF square and the WORLD_EDGE circle. True if it moved p. */
function bound(p: Vec2): boolean {
  let moved = false;
  if (p.x < -WORLD_HALF) { p.x = -WORLD_HALF; moved = true; } else if (p.x > WORLD_HALF) { p.x = WORLD_HALF; moved = true; }
  if (p.z < -WORLD_HALF) { p.z = -WORLD_HALF; moved = true; } else if (p.z > WORLD_HALF) { p.z = WORLD_HALF; moved = true; }
  const ex = p.x - WORLD_EDGE.x, ez = p.z - WORLD_EDGE.z, d2 = ex * ex + ez * ez, R = WORLD_EDGE.r;
  if (d2 > R * R) { const d = Math.sqrt(d2); p.x = WORLD_EDGE.x + (ex / d) * R; p.z = WORLD_EDGE.z + (ez / d) * R; moved = true; }
  return moved;
}

/**
 * The solid world as one World sees it: the shared static layout plus its own dynamic colliders
 * (statues). The kernel resolves every walker through one of these.
 */
export class Solids {
  private D = new Packed(8);
  /** Bumped whenever the dynamic colliders change (pathfinding re-derives its overlay). */
  version = 0;
  /** Where along the segment the last hitSegment() hit (0..1). */
  hitT = 0;
  private scratch: Vec2 = { x: 0, z: 0 };

  /** Where water bears a walker (ice: src/kernel/ice.ts): a 'water' collider does not push out a circle centred there. */
  walkOn: ((x: number, z: number) => boolean) | null = null;
  /** The way over it to `to` (on it): a land point to walk to first (A*), then points on it; null if none. */
  bridge: ((from: Vec2, to: Vec2) => Vec2[] | null) | null = null;

  get dynamic(): readonly Collider[] { return this.D.list; }
  setDynamic(cs: readonly Collider[]) { this.D.set(cs); this.version++; }

  private pass(p: Vec2, r: number): boolean {
    let moved = false;
    if (inGrid(p.x, p.z)) {
      const e = r > PAD ? r - PAD : 0;
      const i0 = colX(p.x - e), i1 = colX(p.x + e), j0 = colZ(p.z - e), j1 = colZ(p.z + e);
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const c = j * GW + i;
          for (let k = cellStart[c], end = cellStart[c + 1]; k < end; k++) {
            const n = cellItems[k];
            if (this.walkOn && S.list[n].style === 'water' && this.walkOn(p.x, p.z)) continue;
            if (pushOut(S, n, p, r)) moved = true;
          }
        }
    }
    const D = this.D;
    for (let k = 0, n = D.n; k < n; k++) if (pushOut(D, k, p, r)) moved = true;
    return moved;
  }

  /** Push a circle of radius r out of every collider (two passes), then keep it in the world. Mutates p. */
  resolve(p: Vec2, r: number, bounded = true) {
    if (this.pass(p, r)) this.pass(p, r);
    if (bounded && bound(p)) { this.pass(p, r); bound(p); }
  }

  /** Is a circle of radius r at p inside something (or outside the world)? */
  blocked(p: Vec2, r: number): boolean {
    const q = this.scratch;
    q.x = p.x; q.z = p.z;
    this.resolve(q, r);
    return Math.hypot(q.x - p.x, q.z - p.z) > 0.01;
  }

  /**
   * The first collider at least `minH` tall that the segment a→b touches (not of style `pass`), or null; hitT says where (0..1).
   * Bolts use it so that nothing thin is tunnelled through, whatever their speed. With `grow` > 0 (at most
   * PAD) it sweeps a body that wide instead of a point (pathfinding's line-of-sight checks).
   */
  hitSegment(ax: number, az: number, bx: number, bz: number, minH = BOLT_HEIGHT, grow = 0, pass?: string): Collider | null {
    const dx = bx - ax, dz = bz - az;
    let best = Infinity, hit: Collider | null = null;
    const i0 = colX(Math.min(ax, bx) - grow), i1 = colX(Math.max(ax, bx) + grow), j0 = colZ(Math.min(az, bz) - grow), j1 = colZ(Math.max(az, bz) + grow);
    const touches = inGrid(ax, az) || inGrid(bx, bz);
    if (touches)
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const c = j * GW + i;
          for (let k = cellStart[c], end = cellStart[c + 1]; k < end; k++) {
            const n = cellItems[k];
            if (S.H[n] < minH || (pass && S.list[n].style === pass)) continue;
            const t = segHit(S, n, ax, az, dx, dz, grow);
            if (t < best) { best = t; hit = S.list[n]; }
          }
        }
    const D = this.D;
    for (let n = 0; n < D.n; n++) {
      if (D.H[n] < minH) continue;
      const t = segHit(D, n, ax, az, dx, dz, grow);
      if (t < best) { best = t; hit = D.list[n]; }
    }
    this.hitT = hit ? best : 1;
    return hit;
  }
}

/** The static world alone (no statues): spawn placement, the A* bake, tools. */
export const STATIC_SOLIDS = new Solids();

/** Push a circle of radius r out of every static collider. Mutates p. */
export function resolve(p: Vec2, r: number, bounded = true) { STATIC_SOLIDS.resolve(p, r, bounded); }

export function blocked(p: Vec2, r: number): boolean { return STATIC_SOLIDS.blocked(p, r); }
