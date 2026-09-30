import * as THREE from 'three';
import { AZKABAN } from '../src/shared/map';
import { STORYBOOK } from './textures';

/**
 * Visual terrain. The kernel simulates a flat 2D world; the client lifts everything onto a
 * heightfield h(x, z) that is exactly flat wherever something is built (castle, paths, pitch,
 * Hogsmeade, hut, tomb) and rolls gently elsewhere — so the simulation and the picture always agree.
 * Beyond the grounds, a ring of Highland mountains, open to a sea inlet in the south (Azkaban).
 */

// ---- value noise + fBm (deterministic, no dependencies)
const hash = (x: number, z: number) => {
  let h = (x * 374761393 + z * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const smooth = (t: number) => t * t * (3 - 2 * t);
function noise(x: number, z: number) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  const u = smooth(xf), v = smooth(zf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/**
 * Where fbmTo and freedomTo leave their result. (Not returned: V8 boxes a double returned from a call it does not
 * inline, and heightAt, which calls them, runs hundreds of times a frame: every entity, the camera, the rings.)
 */
const OUT = new Float64Array(1);
function fbmTo(x: number, z: number, oct: number) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += amp * noise(x * f, z * f); f *= 2.03; amp *= 0.5; }
  OUT[0] = s;
}
export function fbm(x: number, z: number, oct = 5) { fbmTo(x, z, oct); return OUT[0]; }
const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---- where the ground must be flat (built places); 0 = flat, 1 = free to roll
const FLAT_BOXES: [number, number, number, number][] = [
  [-80, -130, 80, 0], // the castle, courtyard and its approach
  [-6, -5, 6, 160],   // the main road to Hogsmeade
];
const FLAT_DISCS: [number, number, number][] = [
  [40, -150, 45], [0, 172, 55], [64, 202, 14], [95, 30, 14], [-52, 28, 10], [45, 0, 12], [41, -30, 18],
];
/** Paths from the courtyard to Hagrid, the tomb and the pitch: [ax, az, bx, bz]. */
const FLAT_PATHS: [number, number, number, number][] = [[0, -10, 90, 36], [-10, -5, -52, 26], [20, -60, 40, -122]];
/** sqrt(x² + z²): Math.hypot allocates in V8, and heightAt runs hundreds of times a frame (every entity, the camera, the grass). */
const len = (x: number, z: number) => Math.sqrt(x * x + z * z);
// (indexed loops, no destructuring: nothing here allocates)
function freedomTo(x: number, z: number) {
  let f = 1;
  for (let i = 0; i < FLAT_BOXES.length; i++) {
    const b = FLAT_BOXES[i];
    f = Math.min(f, ss(0, 18, len(Math.max(b[0] - x, 0, x - b[2]), Math.max(b[1] - z, 0, z - b[3]))));
  }
  for (let i = 0; i < FLAT_DISCS.length; i++) { const c = FLAT_DISCS[i]; f = Math.min(f, ss(c[2], c[2] + 16, len(x - c[0], z - c[1]))); }
  for (let i = 0; i < FLAT_PATHS.length; i++) {
    const q = FLAT_PATHS[i], ax = q[0], az = q[1], vx = q[2] - ax, vz = q[3] - az, l2 = vx * vx + vz * vz;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
    f = Math.min(f, ss(3, 12, len(x - (ax + vx * t), z - (az + vz * t))));
  }
  OUT[0] = f;
}
const freedom = (x: number, z: number) => { freedomTo(x, z); return OUT[0]; };

/**
 * The flatness mask: 0 where the ground is held flat because something is built on it (castle,
 * courtyard, roads and paths, Hogsmeade, the pitch, the hut, the tomb), 1 where it rolls freely.
 * Grass and other ground cover only grow where this is high.
 */
export const flatness = freedom;

export const LAKE = { x: -118, z: 40, r: 30 }; // = the water obstacle in src/shared/map.ts
/** The inner (fine) terrain mesh is a disc this wide round the origin; the Highlands' ring mesh lies beyond. */
const RIM = 300;
/** The sea plane's height: below the lowest rolling ground (about -6 m); only the southern inlet dips under it. */
export const SEA_LEVEL = -9;

/** Ground height at (x, z). */
export function heightAt(x: number, z: number): number {
  const r = len(x, z + 20);
  // rolling grounds (±3 m), stronger in the forest
  const forest = 1 - ss(70, 110, len(x - 165, z - 15));
  fbmTo(x * 0.012, z * 0.012, 5);
  const roll = OUT[0] - 0.5;
  freedomTo(x, z);
  let h = roll * (6 + 6 * forest) * OUT[0];
  // the Black Lake basin
  const dl = len(x - LAKE.x, z - LAKE.z);
  h = h * ss(LAKE.r - 2, LAKE.r + 14, dl) - 5 * (1 - ss(LAKE.r * 0.2, LAKE.r + 2, dl));
  // the Highlands: mountains beyond ~280 m, open to the sea in the south
  const south = Math.atan2(x, z);             // 0 = due south (+z)
  const sea = 1 - ss(0.35, 0.75, Math.abs(south));
  const ring = ss(270, 420, r) * (1 - sea);
  if (ring > 0) {
    fbmTo(x * 0.004 + 7, z * 0.004 - 3, 6);
    const peaks = Math.pow(OUT[0], 1.6);
    fbmTo(x * 0.01, z * 0.01, 5);
    h += ring * (25 + 140 * peaks * ss(300, 700, r) + 40 * OUT[0]);
  }
  // the land dips under the sea toward Azkaban
  h -= sea * ss(260, 330, r) * 26;
  // Azkaban: a rock plateau rising sheer out of the sea
  const isl = 1 - ss(16, 36, len(x - AZKABAN.x, z - AZKABAN.z));
  h = h * (1 - isl) + 0.3 * isl;
  return h;
}

/** Vertex-coloured terrain: grass below, rock on slopes and heights, snow on the peaks. */
export function makeTerrain(grassMat: THREE.MeshStandardMaterial, rockMat: THREE.MeshStandardMaterial) {
  const group = new THREE.Group();
  // inner grounds: fine mesh, grass texture with macro colour variation, cut to a disc of RIM metres: past it the
  // Highlands' ring takes over. (The square's corners used to run on under the ring's slopes, and from afar the
  // two surfaces crossed each other in grass-green blotches all over the mountains.)
  const inner = new THREE.PlaneGeometry(640, 640, 256, 256);
  inner.rotateX(-Math.PI / 2);
  const p = inner.getAttribute('position');
  const col: number[] = [];
  const grid = new Float32Array(p.count);
  const past = new Uint8Array(p.count);
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), z = p.getZ(i);
    grid[i] = heightAt(x, z);
    // a vertex past the rim moves in onto it (triangles wholly past it are dropped below)
    const d = Math.hypot(x, z);
    if (d > RIM) { past[i] = 1; x *= RIM / d; z *= RIM / d; p.setX(i, x); p.setZ(i, z); }
    const y = past[i] ? heightAt(x, z) : grid[i];
    p.setY(i, y);
    const v = fbm(x * 0.02, z * 0.02) - 0.5;
    const dry = Math.max(0, v) * 0.35;
    const wet = y < -0.6 ? Math.min(1, -y / 4) : 0; // muddy shore
    if (STORYBOOK) {
      // painted meadow: broad warm (yellow-green) and cool (blue-green) washes over the grass texture
      const w = fbm(x * 0.006 + 11, z * 0.006 - 4) - 0.5;
      col.push(0.82 + v * 0.3 + w * 0.5 + dry * 0.8 - wet * 0.3, 0.8 + v * 0.2 + w * 0.12 + dry * 0.3 - wet * 0.3, 0.8 + v * 0.1 - w * 0.4 - dry * 0.4 - wet * 0.15);
    } else col.push(0.85 + v * 0.18 + dry - wet * 0.35, 0.9 + v * 0.12 - wet * 0.3, 0.78 + v * 0.06 - dry * 0.5 - wet * 0.2);
  }
  inner.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const tri = inner.index!, keep: number[] = [];
  for (let t = 0; t < tri.count; t += 3) {
    const a = tri.getX(t), b = tri.getX(t + 1), c = tri.getX(t + 2);
    if (!(past[a] && past[b] && past[c])) keep.push(a, b, c);
  }
  inner.setIndex(keep);
  innerGrid = grid;
  inner.computeVertexNormals();
  const innerMesh = new THREE.Mesh(inner, grassMat);
  innerMesh.receiveShadow = true;
  innerMesh.name = 'ground';
  group.add(innerMesh);

  // the Highlands: a coarse ring out to 1.6 km, from just inside the inner disc's rim (its first row dips under
  // the rim: no crack between the two)
  const ring = new THREE.RingGeometry(RIM - 2, 1600, 180, 48);
  ring.rotateX(-Math.PI / 2);
  const rp = ring.getAttribute('position');
  const rc: number[] = [];
  for (let i = 0; i < rp.count; i++) {
    const x = rp.getX(i), z = rp.getZ(i);
    const y = heightAt(x, z);
    rp.setY(i, Math.hypot(x, z) < RIM ? y - 0.5 : y);
    // (the snow line wanders on a scale the ring's ~27 m vertices can draw: finer noise came out as blotches)
    const snow = ss(95, 140, y + fbm(x * 0.007 + 3, z * 0.007 - 5, 3) * 25);
    const rock = STORYBOOK ? ss(8, 110, y) : ss(20, 60, y);
    // storybook: flat painted colour (no texture): moss green, violet-grey rock, blue-white snow
    const g = STORYBOOK ? [0.26, 0.29, 0.21] : [0.34, 0.45, 0.25], r = STORYBOOK ? [0.31, 0.29, 0.34] : [0.42, 0.4, 0.38], s = STORYBOOK ? [0.86, 0.89, 0.98] : [0.95, 0.96, 1];
    const c = g.map((gv, k) => gv * (1 - rock) + r[k] * rock).map((v, k) => v * (1 - snow) + s[k] * snow);
    rc.push(...c);
  }
  ring.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3));
  ring.computeVertexNormals();
  const mat = rockMat.clone();
  mat.vertexColors = true;
  mat.map = STORYBOOK ? null : rockMat.map;
  mat.color.set(0xffffff);
  if (mat.map) { mat.map = mat.map.clone(); mat.map.repeat.set(60, 60); mat.map.needsUpdate = true; }
  const ringMesh = new THREE.Mesh(ring, mat);
  ringMesh.receiveShadow = true;
  group.add(ringMesh);
  return { group, ground: innerMesh };
}

// The inner mesh's vertex heights (257 x 257 over ±320 m): things planted on the ground (grass)
// follow the rendered triangles exactly instead of the smooth function between them.
const INNER = 640, SEGS = 256, STEP = INNER / SEGS;
let innerGrid: Float32Array | null = null;
/** Height of the rendered terrain surface at (x, z): the inner mesh's triangles, or heightAt() outside it. */
export function surfaceAt(x: number, z: number): number {
  const fx = (x + INNER / 2) / STEP, fz = (z + INNER / 2) / STEP;
  if (!innerGrid || fx < 0 || fz < 0 || fx >= SEGS || fz >= SEGS) return heightAt(x, z);
  const ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, v = fz - iz;
  const W = SEGS + 1;
  const ha = innerGrid[iz * W + ix], hb = innerGrid[(iz + 1) * W + ix], hc = innerGrid[(iz + 1) * W + ix + 1], hd = innerGrid[iz * W + ix + 1];
  // PlaneGeometry splits each cell along the (x0, z1)-(x1, z0) diagonal
  return u + v <= 1 ? ha + (hd - ha) * u + (hb - ha) * v : hc + (hb - hc) * (1 - u) + (hd - hc) * (1 - v);
}

/** Lay a flat strip of geometry (paths) onto the terrain. */
export function drape(geo: THREE.BufferGeometry, lift = 0.04) {
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i)) + lift);
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Where a ray first meets the inner terrain mesh (±320 m), or false: marched along the height grid the
 * mesh is built from (surfaceAt: the rendered triangles exactly) instead of testing the mesh's 131 000
 * triangles — ~0.02 ms instead of several, and controls.ts asks every frame the pointer is over the view.
 */
export function rayGround(ray: THREE.Ray, out: THREE.Vector3): boolean {
  const o = ray.origin, dir = ray.direction, H = INNER / 2;
  const gap = (t: number) => o.y + dir.y * t - surfaceAt(o.x + dir.x * t, o.z + dir.z * t);
  const inside = (t: number) => Math.abs(o.x + dir.x * t) <= H && Math.abs(o.z + dir.z * t) <= H;
  let t = 0, g = gap(0);
  if (g < 0) return false;
  for (let i = 0; i < 1000 && t < 3000; i++) {
    if (dir.y >= 0 && g > 60) return false; // climbing away from the ground
    const prev = t;
    t += Math.max(0.2, g * 0.5); // (half the height gap: no step jumps over a slope under ~60°)
    g = gap(t);
    if (g <= 0) {
      let a = prev, b = t;
      for (let k = 0; k < 20; k++) { const m = (a + b) / 2; if (gap(m) > 0) a = m; else b = m; }
      if (!inside(b)) return false;
      out.set(o.x + dir.x * b, o.y + dir.y * b, o.z + dir.z * b);
      return true;
    }
  }
  return false;
}
