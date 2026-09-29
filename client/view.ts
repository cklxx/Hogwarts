import * as THREE from 'three';
import { HOUSE_COLORS, type House } from '../src/shared/constants';
import { HALL_ROOF, INTERIORS, STATIC_COLLIDERS, STATUE_SPOTS, interiorAt, signedDistance, statueViewSolid, viewSolids, type ViewSolid } from '../src/shared/layout';
import { captureActive } from './capture';
import { heightAt } from './terrain';

/**
 * The third-person view, kept clear of the world (docs/COLLISION.md, "The camera"):
 *
 *  1. Spring arm. Each frame the arm from the player's shoulders to where the camera wants to be is swept (a
 *     sphere of MARGIN) through the camera's picture of the world: the layout's footprints stood up to their drawn
 *     heights, roofs, turrets and tree crowns included (src/shared/layout.ts viewSolids), as flat typed arrays.
 *     The camera snaps in front of the first wall (or trunk, or hillside) and eases back out; it passes behind
 *     posts and poles and lets them fade; pressed short it climbs over low things, and the closer it is pressed,
 *     the more it takes an over-the-shoulder framing (fully under MIN_ARM), rising up a wall right behind you.
 *  2. Occluders fade. Whatever still stands between the camera and the player (or the locked target) is cut away
 *     around them on screen with a screen-door dither (installViewFade: a small patch of three.js's own shader
 *     chunks, opted into per material with the VIEW_FADE define), fading in over ~0.2 s.
 *  3. X-ray. The player, the locked target and allies within a few metres who are still hidden get a house-
 *     coloured rim drawn through the walls (a second pass: depth Greater, and stencil so a body never rims itself).
 *  4. Indoors (INTERIORS: the Great Hall) the camera rises and shortens its arm; the roof dissolves on the same
 *     dither over ~0.3 s (scene.ts, `dissolvable`). The hall's floating candles are soft solids: they never stop the
 *     arm, but one between you and the camera turns the cut-out on, and their glows fade in it (`fadeGlow`).
 *
 * Pure parts (ViewWorld, CameraRig) have no DOM and are unit-tested (test/view.test.ts); `?debug=view` adds
 * window.__view with an audit that ray-casts the real scene (scripts/view-audit.ts runs it headless).
 */

// ------------------------------------------------------------------ the world as the camera sees it
const SOFT = 1, THIN = 2;
/** Footprint shapes (ViewWorld.disc): a box (or turned box), a disc, a rhombus (a pyramid roof's foot). */
const DISC = 1, DIAMOND = 2; // (0: a box)
/** Thin things (torch posts, hoop poles): the arm passes behind them (they fade), it only stops for one when the
 *  camera itself would stand in it. A disc this narrow, a box this small. Tree trunks and pillars stop it. */
const THIN_R = 0.3, THIN_HALF = 0.3;
/** Grid cell size (m) for ViewWorld's broad phase. */
const CELL = 12;
/** Solid flags for ViewWorld.cast: hard things only (the spring arm), or soft ones too (what hides the player). */
export const HARD_ONLY = 0, WITH_SOFT = 1, SKIP_THIN = 2;

/** Every ViewSolid flattened into typed arrays, and a segment sweep over them that allocates nothing. */
export class ViewWorld {
  readonly n: number;
  private readonly disc: Uint8Array;
  private readonly flags: Uint8Array;
  private readonly roof: Int8Array;
  private readonly on: Uint8Array;
  private readonly cx: Float64Array; private readonly cz: Float64Array;
  private readonly hx: Float64Array; private readonly hz: Float64Array;
  private readonly cs: Float64Array; private readonly sn: Float64Array;
  private readonly y0: Float64Array; private readonly y1: Float64Array;
  private readonly bx0: Float64Array; private readonly bz0: Float64Array;
  private readonly bx1: Float64Array; private readonly bz1: Float64Array;
  /** The first solid (index into the list given) the last cast() stopped at, or -1. */
  hit = -1;
  /** Where the Ministers' statue slots start (setStatues switches them on and off). */
  private readonly statue0: number;
  /** A uniform grid of CELL-metre cells over the solids' bounds: cell -> the solids touching it (CSR arrays). */
  private readonly gx0: number; private readonly gz0: number; private readonly gw: number; private readonly gh: number;
  private readonly cellStart: Int32Array; private readonly cellItems: Int32Array;
  /** Solid i was already tried by cast number stamp[i] (a solid spans several cells). */
  private readonly stamp: Uint32Array; private casts = 0;

  constructor(readonly solids: ViewSolid[], statueSlots = STATUE_SPOTS.length) {
    const all = [...solids, ...Array.from({ length: statueSlots }, (_, i) => statueViewSolid(i))];
    const n = (this.n = all.length);
    this.statue0 = solids.length;
    const f = () => new Float64Array(n);
    this.disc = new Uint8Array(n); this.flags = new Uint8Array(n); this.roof = new Int8Array(n); this.on = new Uint8Array(n);
    this.cx = f(); this.cz = f(); this.hx = f(); this.hz = f(); this.cs = f(); this.sn = f(); this.y0 = f(); this.y1 = f();
    this.bx0 = f(); this.bz0 = f(); this.bx1 = f(); this.bz1 = f();
    all.forEach((s, i) => {
      const c = s.c;
      const thin = c.kind === 'disc' ? c.r <= THIN_R : c.kind === 'box' ? Math.max(c.x1 - c.x0, c.z1 - c.z0) / 2 <= THIN_HALF : c.kind === 'obox' ? Math.max(c.hx, c.hz) <= THIN_HALF : false;
      this.flags[i] = (s.soft ? SOFT : 0) | (thin ? THIN : 0);
      this.roof[i] = s.roof ?? -1;
      this.on[i] = i < this.statue0 ? 1 : 0;
      this.y0[i] = s.y0; this.y1[i] = s.y1;
      if (c.kind === 'disc') { this.disc[i] = DISC; this.cx[i] = c.x; this.cz[i] = c.z; this.hx[i] = this.hz[i] = c.r; }
      else if (c.kind === 'box') { this.cx[i] = (c.x0 + c.x1) / 2; this.cz[i] = (c.z0 + c.z1) / 2; this.hx[i] = (c.x1 - c.x0) / 2; this.hz[i] = (c.z1 - c.z0) / 2; this.cs[i] = 1; }
      else if (c.kind === 'obox') { this.cx[i] = c.x; this.cz[i] = c.z; this.hx[i] = c.hx; this.hz[i] = c.hz; this.cs[i] = Math.cos(c.yaw); this.sn[i] = Math.sin(c.yaw); }
      else { this.disc[i] = DIAMOND; this.cx[i] = c.x; this.cz[i] = c.z; this.hx[i] = c.hu; this.hz[i] = c.hv; this.cs[i] = Math.cos(c.yaw); this.sn[i] = Math.sin(c.yaw); }
      const ac = Math.abs(this.cs[i]), as = Math.abs(this.sn[i]);
      const dia = this.disc[i] === DIAMOND;
      const ex = this.disc[i] === DISC ? this.hx[i] : dia ? Math.max(this.hx[i] * ac, this.hz[i] * as) : this.hx[i] * ac + this.hz[i] * as;
      const ez = this.disc[i] === DISC ? this.hx[i] : dia ? Math.max(this.hx[i] * as, this.hz[i] * ac) : this.hx[i] * as + this.hz[i] * ac;
      this.bx0[i] = this.cx[i] - ex; this.bx1[i] = this.cx[i] + ex; this.bz0[i] = this.cz[i] - ez; this.bz1[i] = this.cz[i] + ez;
    });
    // the grid
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) { x0 = Math.min(x0, this.bx0[i]); z0 = Math.min(z0, this.bz0[i]); x1 = Math.max(x1, this.bx1[i]); z1 = Math.max(z1, this.bz1[i]); }
    if (!n) { x0 = z0 = 0; x1 = z1 = 1; }
    this.gx0 = x0; this.gz0 = z0;
    this.gw = Math.max(1, Math.ceil((x1 - x0) / CELL)); this.gh = Math.max(1, Math.ceil((z1 - z0) / CELL));
    const counts = new Int32Array(this.gw * this.gh + 1);
    const each = (i: number, f: (c: number) => void) => {
      const [a, b, c, d] = this.cellRange(this.bx0[i], this.bz0[i], this.bx1[i], this.bz1[i]);
      for (let gz = b; gz <= d; gz++) for (let gx = a; gx <= c; gx++) f(gz * this.gw + gx);
    };
    for (let i = 0; i < n; i++) each(i, (c) => counts[c + 1]++);
    for (let c = 0; c < this.gw * this.gh; c++) counts[c + 1] += counts[c];
    this.cellStart = counts;
    this.cellItems = new Int32Array(counts[this.gw * this.gh]);
    const fill = counts.slice();
    for (let i = 0; i < n; i++) each(i, (c) => { this.cellItems[fill[c]++] = i; });
    this.stamp = new Uint32Array(n);
  }

  /** The (clamped) cell range [gx0, gz0, gx1, gz1] a rectangle covers. */
  private cellRange(x0: number, z0: number, x1: number, z1: number): [number, number, number, number] {
    const cl = (v: number, hi: number) => Math.max(0, Math.min(hi - 1, Math.floor(v)));
    return [cl((x0 - this.gx0) / CELL, this.gw), cl((z0 - this.gz0) / CELL, this.gh), cl((x1 - this.gx0) / CELL, this.gw), cl((z1 - this.gz0) / CELL, this.gh)];
  }

  /** The first `n` Ministers' statues stand (World flags.statues). */
  setStatues(n: number) { for (let i = this.statue0; i < this.n; i++) this.on[i] = i - this.statue0 < n ? 1 : 0; }

  /**
   * Where along a→b (t in [0, 1]) a sphere of radius m first touches a solid; 1 if it touches nothing. `mask`:
   * HARD_ONLY or WITH_SOFT, plus SKIP_THIN. `skipRoof`: the interior whose roof is hidden (-1: none). A hard solid
   * the segment starts inside is ignored; a soft one (tree crowns) stops it at once (from inside the leaves they
   * are in the way); one it starts inside only because of the margin (a wall your shoulder brushes) counts from
   * where the bare solid is entered, less the margin (so, often, at once).
   */
  cast(ax: number, ay: number, az: number, bx: number, by: number, bz: number, m: number, mask = HARD_ONLY, skipRoof = -1): number {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    this.hit = -1;
    if (len < 1e-6) return 1;
    const lx0 = Math.min(ax, bx) - m, lx1 = Math.max(ax, bx) + m, lz0 = Math.min(az, bz) - m, lz1 = Math.max(az, bz) + m;
    const ly0 = Math.min(ay, by) - m, ly1 = Math.max(ay, by) + m;
    if (lx1 < this.gx0 || lz1 < this.gz0 || lx0 > this.gx0 + this.gw * CELL || lz0 > this.gz0 + this.gh * CELL) return 1;
    if (++this.casts >= 0xffffffff) { this.stamp.fill(0); this.casts = 1; }
    const stamp = this.casts;
    const w = this.gw, h = this.gh;
    const cx0 = Math.max(0, Math.min(w - 1, Math.floor((lx0 - this.gx0) / CELL))), cx1 = Math.max(0, Math.min(w - 1, Math.floor((lx1 - this.gx0) / CELL)));
    const cz0 = Math.max(0, Math.min(h - 1, Math.floor((lz0 - this.gz0) / CELL))), cz1 = Math.max(0, Math.min(h - 1, Math.floor((lz1 - this.gz0) / CELL)));
    let best = 1;
    for (let gz = cz0; gz <= cz1; gz++) {
      for (let gx = cx0; gx <= cx1; gx++) {
        const c = gz * w + gx;
        for (let k = this.cellStart[c], e = this.cellStart[c + 1]; k < e; k++) {
          const i = this.cellItems[k];
          if (this.stamp[i] === stamp) continue;
          this.stamp[i] = stamp;
          const f = this.flags[i];
          if (!this.on[i] || (f & SOFT && !(mask & WITH_SOFT)) || (f & THIN && mask & SKIP_THIN) || (skipRoof >= 0 && this.roof[i] === skipRoof)) continue;
          if (this.bx0[i] > lx1 || this.bx1[i] < lx0 || this.bz0[i] > lz1 || this.bz1[i] < lz0 || this.y0[i] > ly1 || this.y1[i] < ly0) continue;
          let t = this.enter(i, ax, ay, az, dx, dy, dz, m);
          if (t < 0) {
            // inside the grown solid at the start: count from where the bare one is entered, less the margin
            const t0 = m > 0 ? this.enter(i, ax, ay, az, dx, dy, dz, 0) : t;
            if (t0 < 0) { if (f & SOFT) t = 0; else continue; } // inside the bare solid too: in the leaves they hide you; in a wall, ignore it
            else t = Math.max(0, t0 - m / len);
          }
          if (t < best) { best = t; this.hit = i; }
        }
      }
    }
    return best;
  }

  /** Entry t of a + t·d into solid i grown by g (a box stays square-cornered: conservative); Infinity if none, < 0 if a is inside. */
  private enter(i: number, ax: number, ay: number, az: number, dx: number, dy: number, dz: number, g: number): number {
    let t0 = -Infinity, t1 = Infinity;
    // the vertical slab
    const ya = this.y0[i] - g, yb = this.y1[i] + g;
    if (Math.abs(dy) < 1e-12) { if (ay < ya || ay > yb) return Infinity; }
    else {
      let u = (ya - ay) / dy, v = (yb - ay) / dy;
      if (u > v) { const w = u; u = v; v = w; }
      t0 = u; t1 = v;
    }
    const fx = ax - this.cx[i], fz = az - this.cz[i];
    if (this.disc[i] === DISC) {
      const r = this.hx[i] + g, A = dx * dx + dz * dz, C = fx * fx + fz * fz - r * r;
      if (A < 1e-12) { if (C > 0) return Infinity; }
      else {
        const B = fx * dx + fz * dz, disc = B * B - A * C;
        if (disc < 0) return Infinity;
        const q = Math.sqrt(disc);
        t0 = Math.max(t0, (-B - q) / A); t1 = Math.min(t1, (-B + q) / A);
      }
    } else if (this.disc[i] === DIAMOND) {
      // the rhombus |x/hu + z/hv| <= 1 and |x/hu - z/hv| <= 1 in its own frame: two slabs (grown by g along their normals)
      const c = this.cs[i], s = this.sn[i], iu = 1 / this.hx[i], iv = 1 / this.hz[i], grow = 1 + g * Math.sqrt(iu * iu + iv * iv);
      const px = fx * c - fz * s, pz = fx * s + fz * c, qx = dx * c - dz * s, qz = dx * s + dz * c;
      for (let k = -1; k <= 1; k += 2) {
        const p = px * iu + k * pz * iv, q = qx * iu + k * qz * iv;
        if (Math.abs(q) < 1e-12) { if (p < -grow || p > grow) return Infinity; }
        else { let u = (-grow - p) / q, v = (grow - p) / q; if (u > v) { const w = u; u = v; v = w; } t0 = Math.max(t0, u); t1 = Math.min(t1, v); }
      }
    } else {
      // the box's own frame (three.js rotation.y = yaw: local = (x cos - z sin, x sin + z cos))
      const c = this.cs[i], s = this.sn[i];
      const px = fx * c - fz * s, pz = fx * s + fz * c, qx = dx * c - dz * s, qz = dx * s + dz * c;
      const hx = this.hx[i] + g, hz = this.hz[i] + g;
      if (Math.abs(qx) < 1e-12) { if (px < -hx || px > hx) return Infinity; }
      else { let u = (-hx - px) / qx, v = (hx - px) / qx; if (u > v) { const w = u; u = v; v = w; } t0 = Math.max(t0, u); t1 = Math.min(t1, v); }
      if (Math.abs(qz) < 1e-12) { if (pz < -hz || pz > hz) return Infinity; }
      else { let u = (-hz - pz) / qz, v = (hz - pz) / qz; if (u > v) { const w = u; u = v; v = w; } t0 = Math.max(t0, u); t1 = Math.min(t1, v); }
    }
    if (t0 > t1 || t1 < 0 || t0 > 1) return Infinity;
    return t0;
  }

  /** Is the point inside a hard thin solid grown by g? */
  inThin(x: number, y: number, z: number, g: number): boolean {
    const gx = Math.floor((x - this.gx0) / CELL), gz = Math.floor((z - this.gz0) / CELL);
    if (gx < 0 || gz < 0 || gx >= this.gw || gz >= this.gh) return false;
    const c = gz * this.gw + gx;
    for (let k = this.cellStart[c], e = this.cellStart[c + 1]; k < e; k++) {
      const i = this.cellItems[k];
      if (this.on[i] && (this.flags[i] & (THIN | SOFT)) === THIN && this.enter(i, x, y, z, 0, 1e-9, 0, g) < 0) return true;
    }
    return false;
  }

  /** Is the point inside solid i (bare)? For tests and the debug readout. */
  inside(i: number, x: number, y: number, z: number): boolean {
    return this.enter(i, x, y, z, 0, 1e-9, 0, 0) < 0;
  }
  isSoft(i: number) { return (this.flags[i] & SOFT) !== 0; }
  isThin(i: number) { return (this.flags[i] & THIN) !== 0; }
  roofOf(i: number) { return this.roof[i]; }
  isOn(i: number) { return this.on[i] === 1; }
}

// ------------------------------------------------------------------ the spring arm
/** The orbit centre (as before: 1.5 m over the feet), and the point the camera looks at. */
export const PIVOT_Y = 1.5, LOOK_Y = 1.25; // (main.ts: a little below the head, so the wizard sits above the dock)
/** The sphere swept along the arm: how close the camera comes to a wall (the near plane's corners are 0.12 m out). */
export const MARGIN = 0.3;
/**
 * When the arm is pressed short, the camera first tries to climb (at most MAX_CLIMB more pitch) until CLIMB_CLEAR
 * of arm is free (it clears low things); what arm is left then decides the framing: from SHOULDER_FROM down to
 * MIN_ARM it moves over your right shoulder (fully at MIN_ARM and closer), so it never sits in your head.
 */
export const MIN_ARM = 2.5, SHOULDER_FROM = 4.5, CLIMB_CLEAR = 6, MAX_CLIMB = 0.55;
/** Over the shoulder: the pivot moves `side` m right and `up` m up; the camera looks `ahead` m past you. */
export const SHOULDER = { side: 0.75, up: 0.45, ahead: 7 };
/**
 * With a wall right behind you (under RISE_FROM of arm) there is no room behind even the shoulder: the camera
 * rises up the wall instead (the pivot `up` m higher at the most, less far to the side) and looks down at you.
 */
export const RISE_FROM = 1.6, RISE = { up: 1.5, ahead: 0.8 };
/** The most the view's centre strays from your head (rad; the view is 60° tall). */
const HEAD_ANGLE = (14 * Math.PI) / 180;
/** Indoors: the arm is at most this long and the pitch range moves up to [INDOOR_PITCH[0], INDOOR_PITCH[1]]. */
export const INDOOR_DIST = 11, INDOOR_PITCH = [0.62, 1.42] as const;
const MAX_PITCH = 1.45;
/** Easing rates (1/s): the arm eases back out slowly after a wall let go of it; everything else is quick. */
const OUT_RATE = 2.2, FOLLOW_RATE = 40, LIFT_UP = 5, LIFT_DOWN = 1.4, INDOOR_RATE = 2.5;

export interface RigInput {
  /** The player's feet. */
  x: number; y: number; z: number;
  /** The orbit as the controls hold it (controls.ts: yaw, pitch in [0.1, 1.3], dist in [3.5, 40]). */
  yaw: number; pitch: number; dist: number;
  dt: number;
  ground: (x: number, z: number) => number;
}

const ease = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);
/** The arm is checked against the ground at this many points, and keeps this far above it. */
const GROUND_STEPS = 8, GROUND_CLEAR = 0.35;

/** The camera's state from frame to frame: where it is, what it looks at, and how it got there. Allocation-free. */
export class CameraRig {
  readonly pos = { x: 0, y: 0, z: 0 };
  readonly look = { x: 0, y: 0, z: 0 };
  /** Current arm length (from the pivot), -1 before the first frame. */
  arm = -1;
  /** Extra pitch climbed because the arm was pressed short, and its target. */
  lift = 0; private liftT = 0;
  /** Over-the-shoulder weight (0..1), and its target. */
  shoulder = 0; private shoulderT = 0;
  /** Rise-up-the-wall weight (0..1), and its target. */
  rise = 0; private riseT = 0;
  /** Indoor weight (0..1) and the interior the player is in (-1: outdoors). */
  indoor = 0; room = -1;
  /** Seconds since a wall last shortened the arm. */
  private freeFor = 99;
  /** The arm's direction and length as wanted this frame (after the indoor adjustments). */
  private dx = 0; private dy = 0; private dz = 0; private len = 0;

  constructor(private readonly w: ViewWorld) {}

  /** The arm's free length at pitch p (sets dx/dy/dz/len to that arm). */
  private free(px: number, py: number, pz: number, yaw: number, p: number, want: number, ground: RigInput['ground']): number {
    const cp = Math.cos(p);
    const ex = px + Math.sin(yaw) * cp * want, ez = pz + Math.cos(yaw) * cp * want;
    const ey = Math.max(py + Math.sin(p) * want, ground(ex, ez) + 1.5); // never under the hillside (as before)
    const dx = ex - px, dy = ey - py, dz = ez - pz, len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    this.dx = dx / len; this.dy = dy / len; this.dz = dz / len; this.len = len;
    // past thin things (they fade), unless the camera would end up in one
    let t = this.w.cast(px, py, pz, ex, ey, ez, MARGIN, SKIP_THIN, this.room);
    if (this.w.inThin(px + dx * t, py + dy * t, pz + dz * t, 0.15)) t = this.w.cast(px, py, pz, ex, ey, ez, MARGIN, HARD_ONLY, this.room);
    // and a hillside is a wall too: stop where the arm would dip into the ground (an arm steeper than any slope
    // of the grounds, 0.45, cannot)
    if (dy / len < 0.5) for (let k = 1; k <= GROUND_STEPS; k++) {
      const u = (t * k) / GROUND_STEPS, qx = px + dx * u, qz = pz + dz * u;
      if (py + dy * u < ground(qx, qz) + GROUND_CLEAR) { t = (t * (k - 1)) / GROUND_STEPS; break; }
    }
    return t * len;
  }

  update(i: RigInput) {
    const { x, y, z, yaw, dt } = i;
    // indoors: higher and closer
    this.room = interiorAt(x, z);
    this.indoor += ((this.room >= 0 ? 1 : 0) - this.indoor) * ease(dt, INDOOR_RATE);
    const pIn = INDOOR_PITCH[0] + ((Math.min(1.3, Math.max(0.1, i.pitch)) - 0.1) / 1.2) * (INDOOR_PITCH[1] - INDOOR_PITCH[0]);
    const pitch = i.pitch + (pIn - i.pitch) * this.indoor;
    const want = i.dist + (Math.min(i.dist, INDOOR_DIST) - i.dist) * this.indoor;
    const px = x, py = y + PIVOT_Y, pz = z;

    // pressed short? climb a little if that clears whatever is behind (a low wall, a plinth, a roof's edge);
    // and the shorter the arm still is, the more the camera moves over your shoulder and looks on past you
    const clear = Math.min(want, CLIMB_CLEAR);
    let la = this.free(px, py, pz, yaw, pitch, want, i.ground);
    this.liftT = 0;
    if (la < clear - 1e-6) {
      const top = Math.min(MAX_PITCH, pitch + MAX_CLIMB);
      for (let s = 1; s <= 5; s++) {
        const p = pitch + ((top - pitch) * s) / 5;
        const l = this.free(px, py, pz, yaw, p, want, i.ground);
        if (l >= clear - 1e-6) { this.liftT = p - pitch; la = l; break; }
      }
    }
    // (only when pressed: zoomed right in on open ground stays as it is)
    const from = Math.min(SHOULDER_FROM, want), to = Math.min(MIN_ARM, want * 0.6);
    this.shoulderT = la >= from - 1e-6 ? 0 : Math.min(1, Math.max(0, (from - la) / (from - to)));
    this.lift += (this.liftT - this.lift) * ease(dt, this.liftT > this.lift ? LIFT_UP : LIFT_DOWN);
    this.riseT = Math.min(1, Math.max(0, (RISE_FROM - la) / (RISE_FROM - 0.4)));
    this.shoulder += (this.shoulderT - this.shoulder) * ease(dt, this.shoulderT > this.shoulder ? LIFT_UP : LIFT_DOWN);
    this.rise += (this.riseT - this.rise) * ease(dt, this.riseT > this.rise ? LIFT_UP : LIFT_DOWN);

    // the pivot moves out over the right shoulder (as far as it is free), then the arm is swept from there
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    let qx = px, qy = py, qz = pz;
    const s = this.shoulder, r = this.rise;
    const side = SHOULDER.side * s * (1 - 0.6 * r), ahead = SHOULDER.ahead * s * (1 - r) + RISE.ahead * r;
    if (s > 1e-3 || r > 1e-3) {
      const ox = px + rx * side, oy = py + SHOULDER.up * s + RISE.up * r, oz = pz + rz * side;
      const t = this.w.cast(px, py, pz, ox, oy, oz, MARGIN, HARD_ONLY, this.room);
      qx = px + (ox - px) * t; qy = py + (oy - py) * t; qz = pz + (oz - pz) * t;
    }
    const pe = Math.min(MAX_PITCH, pitch + this.lift);
    const l = this.free(qx, qy, qz, yaw, pe, want, i.ground);
    // snap in at once, ease back out (slowly just after a wall let go, else follow the zoom)
    if (this.arm < 0 || l < this.arm) this.arm = l;
    else this.arm += (l - this.arm) * ease(dt, this.freeFor < 1.2 ? OUT_RATE : FOLLOW_RATE);
    this.freeFor = l < this.len - 0.05 ? 0 : this.freeFor + dt;
    const p = this.pos;
    p.x = qx + this.dx * this.arm; p.y = qy + this.dy * this.arm; p.z = qz + this.dz * this.arm;
    p.y = Math.max(p.y, i.ground(p.x, p.z) + 0.5);
    // look at the head; over the shoulder, past it along the way the camera faces
    this.look.x = x + rx * side * 0.5 - Math.sin(yaw) * ahead;
    this.look.y = y + LOOK_Y;
    this.look.z = z + rz * side * 0.5 - Math.cos(yaw) * ahead;
    // and never so far past you that you drop out of the picture: at most HEAD_ANGLE off the view's centre
    const L = this.look;
    let fx = L.x - p.x, fy = L.y - p.y, fz = L.z - p.z;
    const fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1e-6;
    let hx = x - p.x, hy = y + 1.7 - p.y, hz = z - p.z;
    const hl = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1e-6;
    fx /= fl; fy /= fl; fz /= fl; hx /= hl; hy /= hl; hz /= hl;
    const th = Math.acos(Math.max(-1, Math.min(1, fx * hx + fy * hy + fz * hz)));
    if (th > HEAD_ANGLE && hl > 0.3) {
      // slerp from the head's direction toward the look's, stopping HEAD_ANGLE away from the head
      const sn = Math.sin(th), u = HEAD_ANGLE / th, a = Math.sin((1 - u) * th) / sn, b = Math.sin(u * th) / sn;
      L.x = p.x + (hx * a + fx * b) * fl; L.y = p.y + (hy * a + fy * b) * fl; L.z = p.z + (hz * a + fz * b) * fl;
    }
  }

  /** Does anything (walls, roofs, crowns) stand between the camera and (x, y, z), more than `before` metres short of it? */
  hides(x: number, y: number, z: number, before = 0.5): boolean {
    const p = this.pos, dx = x - p.x, dy = y - p.y, dz = z - p.z, len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len <= before) return false;
    return this.w.cast(p.x, p.y, p.z, x, y, z, 0, WITH_SOFT, this.room) * len < len - before;
  }
}

// ------------------------------------------------------------------ occluder fading: a screen-door dither (shader patch)
// GPU side of this module, all of it (for the WebGPU/TSL port): VIEW_FADE_GLSL (the fade, installed into three.js's
// clipping-plane chunks by installViewFade, opted into per material by fadeMaterial's VIEW_FADE define, fed by the
// FADE uniforms), the stencil settings in fadeMaterial / bodyStencil, and xrayMaterial (a rim ShaderMaterial with
// depthFunc Greater + stencil Equal 1). In TSL: a node patch on material.fragmentNode's discard (or an
// outputNode wrapper) reading the same five vec4 uniforms, and a NodeMaterial for the rim; stencil state is
// the same material properties on WebGPU.
/**
 * Uniform values shared by every material that opts in (plain objects: three.js clones Vector uniforms per
 * material but shares plain objects, so one write per frame reaches all; see render.ts `shared`).
 *   A, B:  a cut-out (x, y: centre in drawing-buffer pixels from the bottom left; z: radius in px; w: strength 0..1),
 *          A round the player, B round the locked target.
 *   depth: x, y: A's and B's view depth (m); z, w: A's and B's feet height (world y).
 *   cam:   xyz: the camera the cut-outs were worked out for (other passes, like the lake's mirror, are left alone);
 *          w: tan(fov / 2).
 *   res:   x, y: drawing-buffer size (px); z, w: the camera's near and far.
 */
const vec4 = () => ({ x: 0, y: 0, z: 0, w: 0 });
export const FADE = { A: vec4(), B: vec4(), depth: vec4(), cam: vec4(), res: vec4() };

/**
 * The whole fade, in GLSL, run at the top of the fragment shader of every material with the VIEW_FADE define.
 * A fragment inside a cut-out's circle on screen, nearer the camera than the character by more than ~0.6 m and
 * above its feet, is discarded on a 4x4 ordered-dither pattern whose density is the cut's strength (soft edge,
 * soft in depth). Discarding keeps depth sorting and shadows exactly as they were and costs a few ALU. In TSL:
 * `If( cut.greaterThan( bayer4( screenCoordinate ) ), () => Discard() )` with the same cut() expression.
 */
export const VIEW_FADE_GLSL = {
  pars: /* glsl */ `
#ifdef VIEW_FADE
uniform vec4 viewFadeA;
uniform vec4 viewFadeB;
uniform vec4 viewFadeDepth;
uniform vec4 viewFadeCam;
uniform vec4 viewFadeRes;
uniform float viewFadeSelf;
float viewFadeBayer2( vec2 a ) { a = floor( a ); return fract( a.x / 2.0 + a.y * a.y * 0.75 ); }
float viewFadeCut( vec4 c, float depth, float feet, float d, float y ) {
	float k = 1.0 - smoothstep( c.z * 0.55, c.z, length( gl_FragCoord.xy - c.xy ) );
	k *= 1.0 - smoothstep( depth - 1.6, depth - 0.6, d );
	k *= smoothstep( feet + 0.2, feet + 0.6, y );
	return k * c.w;
}
#endif
`,
  main: /* glsl */ `
#ifdef VIEW_FADE
	float viewFadeK = viewFadeSelf;
	if ( viewFadeA.w + viewFadeB.w > 0.0 && distance( cameraPosition, viewFadeCam.xyz ) < 0.01 ) {
		float vfZ = gl_FragCoord.z * 2.0 - 1.0;
		float vfD = 2.0 * viewFadeRes.z * viewFadeRes.w / ( viewFadeRes.w + viewFadeRes.z - vfZ * ( viewFadeRes.w - viewFadeRes.z ) );
		vec2 vfN = gl_FragCoord.xy / viewFadeRes.xy * 2.0 - 1.0;
		vec3 vfV = vec3( vfN.x * viewFadeCam.w * viewFadeRes.x / viewFadeRes.y, vfN.y * viewFadeCam.w, -1.0 ) * vfD;
		float vfY = cameraPosition.y + ( vec4( vfV, 0.0 ) * viewMatrix ).y;
		float vfCut = max( viewFadeCut( viewFadeA, viewFadeDepth.x, viewFadeDepth.z, vfD, vfY ), viewFadeCut( viewFadeB, viewFadeDepth.y, viewFadeDepth.w, vfD, vfY ) );
		viewFadeK = max( viewFadeK, vfCut * 0.86 );
	}
	#ifndef VIEW_FADE_ALPHA
	if ( viewFadeK > 0.0 && viewFadeK > viewFadeBayer2( 0.5 * gl_FragCoord.xy ) * 0.25 + viewFadeBayer2( gl_FragCoord.xy ) ) discard;
	#endif
#endif
`,
  /** VIEW_FADE_ALPHA (glows, fadeGlow): the fade scales the alpha instead of dithering, after the colour is worked out. */
  alpha: /* glsl */ `
#ifdef VIEW_FADE_ALPHA
	gl_FragColor.a *= 1.0 - viewFadeK;
#endif
`,
};

let fadeInstalled = false;
/**
 * Appends VIEW_FADE_GLSL to three.js's clipping-plane chunks (in every built-in material, at the top of main())
 * and gives every built-in material the uniforms. Inert unless a material defines VIEW_FADE. Before the first compile.
 */
/** VIEW_FADE_GLSL's viewFadeCut in JS (for the ?debug=view audit): the cut at a fragment (px, py) at view depth d, height y. */
export function fadeCut(c: { x: number; y: number; z: number; w: number }, depth: number, feet: number, px: number, py: number, d: number, y: number) {
  const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  let k = 1 - ss(c.z * 0.55, c.z, Math.hypot(px - c.x, py - c.y));
  k *= 1 - ss(depth - 1.6, depth - 0.6, d);
  k *= ss(feet + 0.2, feet + 0.6, y);
  return k * c.w;
}

export function installViewFade() {
  if (fadeInstalled) return;
  fadeInstalled = true;
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  C.clipping_planes_pars_fragment += VIEW_FADE_GLSL.pars;
  C.clipping_planes_fragment += VIEW_FADE_GLSL.main;
  for (const lib of Object.values(THREE.ShaderLib)) Object.assign(lib.uniforms, fadeUniforms());
}
/** The fade's uniforms: the shared cut-outs, and the material's own dissolve (a number: three.js copies it per material). */
const fadeUniforms = () => ({ viewFadeA: { value: FADE.A }, viewFadeB: { value: FADE.B }, viewFadeDepth: { value: FADE.depth }, viewFadeCam: { value: FADE.cam }, viewFadeRes: { value: FADE.res }, viewFadeSelf: { value: 0 } });

/**
 * A copy of `m` that dissolves by itself on the same dither (a Great Hall roof that fades as you step in): set
 * `k.value` from 0 (whole) to 1 (gone). It shares `m`'s shader program (nothing new to compile), with its own
 * viewFadeSelf uniform. Opted into the fade, so the occluder cut-outs apply to it as well.
 */
export function dissolvable<T extends THREE.Material>(m: T): { mat: T; k: { value: number } } {
  const mat = m.clone() as T, k = { value: 0 };
  const base = m.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => { base.call(m, sh, r); sh.uniforms.viewFadeSelf = k; };
  mat.customProgramCacheKey = () => m.customProgramCacheKey();
  fadeMaterial(mat);
  return { mat, k };
}

/**
 * Opt a ShaderMaterial of camera-facing glows (billboards.ts) into the fade: inside a cut-out its alpha fades
 * (a dither would speckle a soft glow). Its fragment shader must set gl_FragColor and end with main's brace.
 */
export function fadeGlow(m: THREE.ShaderMaterial) {
  if (m.defines?.VIEW_FADE !== undefined) return;
  m.defines = { ...m.defines, VIEW_FADE: '', VIEW_FADE_ALPHA: '' };
  Object.assign(m.uniforms, fadeUniforms());
  m.fragmentShader = VIEW_FADE_GLSL.pars + m.fragmentShader.replace(/void main\(\)\s*\{/, (h) => h + VIEW_FADE_GLSL.main).replace(/\}\s*$/, VIEW_FADE_GLSL.alpha + '}');
  m.needsUpdate = true;
}

/** Opt a world material into the fade, and have it mark the stencil (1) so the x-ray pass knows a wall is in front. */
export function fadeMaterial(m: THREE.Material) {
  if (m.defines?.VIEW_FADE !== undefined) return;
  m.defines = { ...m.defines, VIEW_FADE: '' };
  worldStencil(m);
  m.needsUpdate = true;
}
const worldStencil = (m: THREE.Material) => {
  m.stencilWrite = true; m.stencilRef = 1; m.stencilFunc = THREE.AlwaysStencilFunc; m.stencilZPass = THREE.ReplaceStencilOp;
};
/** Characters mark the stencil 0 where they are seen, so their x-ray never draws over their own visible body. */
const bodyStencil = (m: THREE.Material) => {
  if (m.stencilRef === 0 && m.stencilWrite) return;
  m.stencilWrite = true; m.stencilRef = 0; m.stencilFunc = THREE.AlwaysStencilFunc; m.stencilZPass = THREE.ReplaceStencilOp;
};

// ------------------------------------------------------------------ x-ray silhouettes
/**
 * A rim in `color` drawn only where the body is hidden: depth Greater (behind what is drawn) and stencil == 1
 * (what is drawn there is the world, not a body). Discards below the feet (floors the shoes sink into).
 */
function xrayMaterial(color: number) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, feet: { value: 0 } },
    vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vV; varying float vY;
      void main() {
        vec4 wp = modelMatrix * vec4( position, 1.0 );
        vY = wp.y;
        vec4 mv = viewMatrix * wp;
        vN = normalize( normalMatrix * normal );
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `uniform vec3 color; uniform float feet; varying vec3 vN; varying vec3 vV; varying float vY;
      void main() {
        if ( vY < feet ) discard;
        float f = 1.0 - abs( dot( normalize( vN ), normalize( vV ) ) );
        gl_FragColor = vec4( color * ( 0.7 + 0.9 * f ), 0.16 + 0.7 * f * f );
      }`,
    transparent: true, depthWrite: false, depthFunc: THREE.GreaterDepth,
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc,
    stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp,
    fog: false,
  });
}
interface Xray { root: THREE.Object3D; pairs: [THREE.Mesh, THREE.Mesh][]; mat: THREE.ShaderMaterial; color: number; used: number }

// ------------------------------------------------------------------ the integration (main.ts calls createView, then place() each frame)
type Model = { root: THREE.Object3D };
interface SnapLite { w: { h: string; ho: House; x: number; z: number; s: string }[]; look?: { statues: unknown[] } }
export interface ViewDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  /** Meshes under these never fade (the ground the player stands on). */
  ground: THREE.Object3D[];
  wizards: Map<string, Model>;
  creatures: Map<string, Model>;
  myHandle: () => string;
  snap: () => SnapLite | null;
  /** The locked target (controls.ts), or null. */
  target: () => string | null;
  /** The orbit the controls hold (read here; set by the ?debug=view hook). */
  cam: { yaw: number; pitch: number; dist: number };
}

const ALLY_RANGE = 12, MAX_ALLIES = 4;
/** The Great Hall's roof volume [x0, x1, z0, z1, y0] (hidden while you are inside it). */
const HALL_ROOF_BOX = [HALL_ROOF.x0, HALL_ROOF.x1, HALL_ROOF.z0, HALL_ROOF.z1, HALL_ROOF.y - 0.01] as const;
/** Instanced stand-ins for characters and spells (crowd.ts, partbatch.ts, herd.ts, bolts.ts): never faded. */
const CHARACTERS = /^(crowd|parts|herd:|bolt)/;
/** The glows of static things (instancer.ts: the Great Hall's candles): faded by alpha (fadeGlow). */
const GLOWS = /^glow:/;

export function createView(d: ViewDeps) {
  installViewFade();
  const world = new ViewWorld(viewSolids(heightAt));
  const rig = new CameraRig(world);

  // opt the static world into the fade: every lit material of something standing up (not the terrain, the grass,
  // roads and floors; a floor that shares a material with a table is spared by the shader's feet test)
  const skip = new Set<THREE.Object3D>();
  for (const g of d.ground) (g.parent && !(g.parent as THREE.Scene).isScene ? g.parent : g).traverse((o) => skip.add(o));
  d.scene.getObjectByName('grass')?.traverse((o) => skip.add(o));
  const bb = new THREE.Box3();
  let marked = 0;
  d.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || skip.has(o) || (m as unknown as THREE.SkinnedMesh).isSkinnedMesh || CHARACTERS.test(o.name)) return;
    bb.setFromObject(m);
    if (bb.max.y - bb.min.y < 0.3) return; // flat: roads, courtyard, floors, water
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if ((mat as THREE.ShaderMaterial).isShaderMaterial) { if (GLOWS.test(o.name)) fadeGlow(mat as THREE.ShaderMaterial); continue; }
      if ((mat as THREE.MeshBasicMaterial).depthTest === false) continue;
      fadeMaterial(mat);
      marked++;
    }
  });

  // one (never seen) mesh with the x-ray material, so main.ts's shader warm-up compiles it too
  const warm = new THREE.Mesh(new THREE.PlaneGeometry(0.01, 0.01), xrayMaterial(0xffffff));
  warm.position.set(0, -5000, 0);
  warm.name = 'xray-warm';
  d.scene.add(warm);

  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), size = new THREE.Vector2();
  let tick = 0;
  const rin: RigInput = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, dist: 0, dt: 0, ground: heightAt };
  const xrays = new Map<string, Xray>();
  const want = new Map<string, number>(); // key -> colour, this frame
  let fadeA = 0, fadeB = 0;
  const stats = { frames: 0, ms: 0, max: 0, marked, solids: world.n, occA: false, occB: false, xray: 0 };

  /** Screen-space cut-out for a character at feet `p` (chest height), strength s, into u / depth slot. */
  function cutout(u: typeof FADE.A, p: { x: number; y: number; z: number }, s: number, r: number, slot: 0 | 1, c = d.camera, depthOut = FADE.depth) {
    tmp.set(p.x, p.y + 1.1, p.z);
    const depth = -tmp2.copy(tmp).applyMatrix4(c.matrixWorldInverse).z;
    tmp.project(c);
    if (depth <= c.near || s <= 0.001) { u.w = 0; return; }
    u.x = (tmp.x * 0.5 + 0.5) * size.x;
    u.y = (tmp.y * 0.5 + 0.5) * size.y;
    u.z = (r * size.y * 0.5) / (Math.tan((c.fov * Math.PI) / 360) * depth);
    u.w = s;
    if (slot === 0) { depthOut.x = depth; depthOut.z = p.y; } else { depthOut.y = depth; depthOut.w = p.y; }
  }

  /** Set up (once) and show the x-ray for a model this frame. */
  function xray(key: string, m: Model, color: number) {
    let x = xrays.get(key);
    if (x && x.root !== m.root) { drop(key, x); x = undefined; }
    if (!x) {
      const mat = xrayMaterial(color);
      const pairs: [THREE.Mesh, THREE.Mesh][] = [];
      m.root.traverse((o) => {
        const src = o as THREE.Mesh;
        if (!src.isMesh || src.name === 'ink' || (src as THREE.InstancedMesh).isInstancedMesh || (src as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
        const sm = src.material as THREE.Material;
        if (!sm || Array.isArray(sm) || sm.transparent || (sm as THREE.MeshBasicMaterial).depthTest === false || !src.geometry.getAttribute('normal')) return;
        const ghost = new THREE.Mesh(src.geometry, mat);
        ghost.renderOrder = 60;
        ghost.frustumCulled = false;
        ghost.raycast = () => {};
        pairs.push([src, ghost]);
      });
      for (const [src, ghost] of pairs) src.add(ghost);
      x = { root: m.root, pairs, mat, color, used: 0 };
      xrays.set(key, x);
    }
    if (x.color !== color) { x.color = color; (x.mat.uniforms.color.value as THREE.Color).setHex(color); }
    x.mat.uniforms.feet.value = m.root.position.y + 0.25;
    for (const [src, ghost] of x.pairs) {
      ghost.visible = true;
      if (ghost.geometry !== src.geometry) ghost.geometry = src.geometry; // a glamour swapped it
      bodyStencil(src.material as THREE.Material);
    }
    x.used = tick;
  }
  function hideXray(x: Xray) { for (const [, g] of x.pairs) g.visible = false; }
  function drop(key: string, x: Xray) {
    for (const [src, g] of x.pairs) src.remove(g);
    x.mat.dispose();
    xrays.delete(key);
  }

  const model = (k: string) => d.wizards.get(k) ?? d.creatures.get(k);
  const HOUSE_RIM = Object.fromEntries(Object.entries(HOUSE_COLORS).map(([h, c]) => [h, new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.35).getHex()])) as Record<House, number>;
  const houseHex = (h: House) => HOUSE_RIM[h] ?? 0xffffff;

  /** Place the camera behind the player at `feet` (main.ts frame). Also works out the fades and the x-rays. */
  function place(feet: THREE.Vector3, dt: number) {
    const t0 = performance.now();
    const c = d.camera;
    stats.frames++;
    tick++;
    const s = d.snap();
    world.setStatues(s?.look?.statues.length ?? 0);
    rin.x = feet.x; rin.y = feet.y; rin.z = feet.z; rin.yaw = d.cam.yaw; rin.pitch = d.cam.pitch; rin.dist = d.cam.dist; rin.dt = dt;
    rig.update(rin);
    c.position.set(rig.pos.x, rig.pos.y, rig.pos.z);
    // your own name plate would fill the screen from close up: it fades out under 5 m
    const plate = (d.wizards.get(d.myHandle()) as { label?: { sprite?: THREE.Sprite } } | undefined)?.label?.sprite;
    if (plate) plate.material.opacity = Math.min(1, Math.max(0, (rig.arm - 2.5) / 2.5));
    c.lookAt(rig.look.x, rig.look.y, rig.look.z);
    c.updateMatrixWorld();

    // a scripted shot (?capture=1) drives the camera after this: no fades, no x-rays
    const capture = captureActive();
    d.renderer.getDrawingBufferSize(size);
    FADE.cam.x = c.position.x; FADE.cam.y = c.position.y; FADE.cam.z = c.position.z; FADE.cam.w = Math.tan((c.fov * Math.PI) / 360);
    FADE.res.x = size.x; FADE.res.y = size.y; FADE.res.z = c.near; FADE.res.w = c.far;

    // what hides the player, and the locked target
    const me = d.myHandle();
    const occA = !capture && (rig.hides(feet.x, feet.y + 1.1, feet.z) || rig.hides(feet.x, feet.y + 1.9, feet.z));
    const tk = d.target();
    const tm = tk ? model(tk) : undefined;
    const tp = tm?.root.position;
    const occB = !capture && !!tp && (rig.hides(tp.x, tp.y + 1.1, tp.z) || rig.hides(tp.x, tp.y + 1.9, tp.z));
    const k = 1 - Math.exp(-dt / 0.07);
    fadeA += ((occA ? 1 : 0) - fadeA) * k;
    fadeB += ((occB ? 1 : 0) - fadeB) * k;
    cutout(FADE.A, feet, fadeA, 1.9, 0);
    if (tp) cutout(FADE.B, tp, fadeB, tm && d.creatures.has(tk!) ? 2.4 : 1.9, 1); else FADE.B.w = 0;
    stats.occA = occA; stats.occB = occB;

    // x-ray: me, the target, allies close by, when something hides them
    want.clear();
    const snapW = s?.w;
    const mine = snapW?.find((w) => w.h === me);
    if (!capture && mine) {
      if (occA) want.set(me, houseHex(mine.ho));
      if (tk && tp && occB) {
        const tw = snapW!.find((w) => w.h === tk);
        want.set(tk, tw ? houseHex(tw.ho) : 0xff6a5a);
      }
      let n = 0, looked = 0;
      for (const w of snapW!) {
        if (n >= MAX_ALLIES || looked >= 2 * MAX_ALLIES) break; // (a crowd: the first few in the snapshot)
        if (w.h === me || w.ho !== mine.ho || want.has(w.h) || Math.hypot(w.x - feet.x, w.z - feet.z) > ALLY_RANGE) continue;
        const m = d.wizards.get(w.h);
        if (!m) continue;
        looked++;
        const q = m.root.position;
        if (rig.hides(q.x, q.y + 1.1, q.z) || rig.hides(q.x, q.y + 1.9, q.z)) { want.set(w.h, houseHex(w.ho)); n++; }
      }
    }
    for (const [key, color] of want) { const m = model(key); if (m) xray(key, m, color); }
    stats.xray = 0;
    for (const [key, x] of xrays) {
      if (x.used === tick) { stats.xray++; continue; }
      if (!model(key) || tick - x.used > 600) drop(key, x); else hideXray(x);
    }

    const ms = performance.now() - t0;
    stats.ms += ms;
    stats.max = Math.max(stats.max, ms);
  }

  if (typeof location !== 'undefined' && /[?&](debug=view|capture=1)\b/.test(location.search)) {
    (globalThis as unknown as { __view: unknown }).__view = {
      cam: d.cam,
      me: () => d.wizards.get(d.myHandle())?.root.position,
      rig,
      stats: () => ({ ...stats, avgMs: stats.ms / Math.max(1, stats.frames), arm: rig.arm, lift: rig.lift, shoulder: rig.shoulder, indoor: rig.indoor, fadeA, fadeB, interiors: INTERIORS.length }),
      reset: () => { stats.frames = 0; stats.ms = 0; stats.max = 0; },
      audit,
    };
  }

  /**
   * ?debug=view: can the player be seen? For n sampled spots (around the castle, in the Great Hall, round
   * Hogsmeade, in the forest) and random yaw / pitch / zoom, run a fresh rig for 1.5 s, then cast rays from the
   * camera to the player's head, chest and knees through the scene's own static meshes (merged batches, instanced
   * trees, the terrain). A hit on a faded material inside the cut-out, dithered to 90 % or more, lets the ray on;
   * anything else stops it. Visible: the head or the chest ray gets through. `old`: the camera as it was before
   * view.ts (no arm, no fading), for comparison.
   */
  function audit(n = 200, seed = 1, old = false) {
    let r = seed >>> 0 || 1;
    const rnd = () => ((r = (Math.imul(r, 48271) >>> 0) % 2147483647) / 2147483647);
    const faded = (m: THREE.Material) => m.defines?.VIEW_FADE !== undefined;
    const terrain = new Set<THREE.Object3D>();
    for (const g of d.ground) (g.parent && !(g.parent as THREE.Scene).isScene ? g.parent : g).traverse((o) => terrain.add(o));
    const targets: THREE.Object3D[] = [];
    const shown = (o: THREE.Object3D) => { for (let x: THREE.Object3D | null = o; x; x = x.parent) if (!x.visible) return false; return true; };
    d.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      // (the storybook ink hull is left out: it lies just outside its own building, and is dropped from view
      // when the camera is inside that building's box, which a ray cannot tell)
      if (!m.isMesh || !shown(m) || CHARACTERS.test(m.name) || m.name === 'ink' || m === warm || ((m as THREE.InstancedMesh).isInstancedMesh && !(m as THREE.InstancedMesh).count)) return;
      const mat = m.material as THREE.Material;
      if (Array.isArray(mat) || mat.transparent || !(faded(mat) || terrain.has(m))) return;
      targets.push(m);
    });
    const cam = new THREE.PerspectiveCamera(d.camera.fov, d.camera.aspect, d.camera.near, d.camera.far);
    const ray = new THREE.Raycaster();
    const R = HALL_ROOF_BOX;
    const u = vec4(), dep = vec4(), hitV = new THREE.Vector3(), dir = new THREE.Vector3(), proj = new THREE.Vector3();
    const out = { n: 0, visible: 0, visibleNoFade: 0, head: 0, chest: 0, knees: 0, fadeOn: 0, byArea: {} as Record<string, [number, number]>, misses: [] as unknown[] };
    const areas: [string, number, (k: number) => [number, number]][] = [
      ['castle', 0.45, () => { const a = rnd() * Math.PI * 2, q = 16 + rnd() * 60; return [Math.cos(a) * q * 1.1, -80 + Math.sin(a) * q * 0.8]; }],
      ['great hall', 0.15, () => [-11 + rnd() * 22, -71 + rnd() * 30]],
      ['hogsmeade', 0.25, () => { const a = rnd() * Math.PI * 2, q = 4 + rnd() * 42; return [Math.cos(a) * q, 172 + Math.sin(a) * q]; }],
      ['forest', 0.15, () => { const a = rnd() * Math.PI * 2, q = rnd() * 60; return [165 + Math.cos(a) * q, 15 + Math.sin(a) * q]; }],
    ];
    const t0 = performance.now();
    while (out.n < n) {
      let pick = rnd(), area = areas[0];
      for (const a of areas) { if (pick < a[1]) { area = a; break; } pick -= a[1]; }
      const [x, z] = area[2](0);
      if (STATIC_COLLIDERS.some((c) => c.h > 0 && signedDistance(c, x, z) < 0.5)) continue;
      const y = heightAt(x, z);
      const yaw = rnd() * Math.PI * 2, pitch = 0.1 + rnd() * 1.0, dist = 3.5 + rnd() * rnd() * 20;
      const rg = new CameraRig(world);
      for (let k = 0; k < 90; k++) rg.update({ x, y, z, yaw, pitch, dist, dt: 1 / 60, ground: heightAt });
      if (old) {
        rg.pos.x = x + Math.sin(yaw) * Math.cos(pitch) * dist; rg.pos.z = z + Math.cos(yaw) * Math.cos(pitch) * dist;
        rg.pos.y = Math.max(y + PIVOT_Y + Math.sin(pitch) * dist, heightAt(rg.pos.x, rg.pos.z) + 1.5);
        rg.look.x = x; rg.look.y = y + LOOK_Y; rg.look.z = z;
      }
      cam.position.set(rg.pos.x, rg.pos.y, rg.pos.z);
      cam.lookAt(rg.look.x, rg.look.y, rg.look.z);
      cam.updateMatrixWorld();
      const gate = !old && (rg.hides(x, y + 1.1, z) || rg.hides(x, y + 1.9, z));
      d.renderer.getDrawingBufferSize(size);
      cutout(u, { x, y, z }, gate ? 1 : 0, 1.9, 0, cam, dep);
      const inside = interiorAt(x, z) === 0;
      const through = (py: number, fade: boolean) => {
        hitV.set(x, y + py, z);
        dir.copy(hitV).sub(cam.position);
        const len = dir.length();
        ray.set(cam.position, dir.normalize());
        ray.far = Math.max(0, len - 0.35);
        for (const h of ray.intersectObjects(targets, false)) {
          const p = h.point;
          if (inside && p.x > R[0] && p.x < R[1] && p.z > R[2] && p.z < R[3] && p.y > R[4]) continue; // the roof is hidden from inside
          const mat = (h.object as THREE.Mesh).material as THREE.Material;
          if (fade && faded(mat)) {
            const fd = -proj.copy(p).applyMatrix4(cam.matrixWorldInverse).z;
            proj.copy(p).project(cam);
            if (fadeCut(u, dep.x, dep.z, (proj.x * 0.5 + 0.5) * size.x, (proj.y * 0.5 + 0.5) * size.y, fd, p.y) * 0.86 >= 0.8) continue;
          }
          const b = new THREE.Box3().setFromObject(h.object);
          return { ok: false, what: `${h.object.name || h.object.type}:${(mat as THREE.Material).name || mat.type}${terrain.has(h.object) ? ' (terrain)' : ''} [${b.min.toArray().map((v) => v.toFixed(0))}..${b.max.toArray().map((v) => v.toFixed(0))}]`, at: [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)] };
        }
        return { ok: true, what: '', at: [] as number[] };
      };
      const head = through(1.7, true), chest = through(1.1, true), knees = through(0.5, true);
      const bare = through(1.7, false).ok || through(1.1, false).ok;
      out.n++;
      const ok = head.ok || chest.ok;
      out.visible += ok ? 1 : 0; out.visibleNoFade += bare ? 1 : 0; out.fadeOn += gate ? 1 : 0;
      out.head += head.ok ? 1 : 0; out.chest += chest.ok ? 1 : 0; out.knees += knees.ok ? 1 : 0;
      const ba = (out.byArea[area[0]] ??= [0, 0]); ba[0]++; ba[1] += ok ? 1 : 0;
      if (!ok && out.misses.length < 20) out.misses.push({ area: area[0], x: +x.toFixed(1), z: +z.toFixed(1), yaw: +yaw.toFixed(2), pitch: +pitch.toFixed(2), dist: +dist.toFixed(1), cam: [+rg.pos.x.toFixed(1), +rg.pos.y.toFixed(1), +rg.pos.z.toFixed(1)], gate, head: head.what, at: head.at });
    }
    return { ...out, pct: +((100 * out.visible) / out.n).toFixed(1), pctNoFade: +((100 * out.visibleNoFade) / out.n).toFixed(1), meshes: targets.length, ms: Math.round(performance.now() - t0) };
  }

  return { place, rig, world, stats };
}
