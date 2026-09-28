import * as THREE from 'three';
import { AZKABAN, LANDMARKS } from '../src/shared/map';

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
export function fbm(x: number, z: number, oct = 5) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += amp * noise(x * f, z * f); f *= 2.03; amp *= 0.5; }
  return s;
}
const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---- where the ground must be flat (built places); 0 = flat, 1 = free to roll
const FLAT_BOXES: [number, number, number, number][] = [
  [-80, -130, 80, 0], // the castle, courtyard and its approach
  [-6, -5, 6, 160],   // the main road to Hogsmeade
];
const FLAT_DISCS: [number, number, number][] = [
  [40, -150, 45], [0, 172, 55], [64, 202, 14], [95, 30, 14], [-52, 28, 10], [45, 0, 12], [41, -30, 18],
];
function freedom(x: number, z: number) {
  let f = 1;
  for (const [x0, z0, x1, z1] of FLAT_BOXES) {
    const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
    f = Math.min(f, ss(0, 18, Math.hypot(dx, dz)));
  }
  for (const [cx, cz, r] of FLAT_DISCS) f = Math.min(f, ss(r, r + 16, Math.hypot(x - cx, z - cz)));
  // paths from the courtyard to Hagrid, the tomb and the pitch
  for (const [ax, az, bx, bz] of [[0, -10, 90, 36], [-10, -5, -52, 26], [20, -60, 40, -122]]) {
    const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
    f = Math.min(f, ss(3, 12, Math.hypot(x - (ax + vx * t), z - (az + vz * t))));
  }
  return f;
}

/**
 * The flatness mask: 0 where the ground is held flat because something is built on it (castle,
 * courtyard, roads and paths, Hogsmeade, the pitch, the hut, the tomb), 1 where it rolls freely.
 * Grass and other ground cover only grow where this is high.
 */
export const flatness = freedom;

export const LAKE = { x: -110, z: 40, r: 55 };
/** The sea plane's height: below the lowest rolling ground (about -6 m); only the southern inlet dips under it. */
export const SEA_LEVEL = -9;

/** Ground height at (x, z). */
export function heightAt(x: number, z: number): number {
  const r = Math.hypot(x, z + 20);
  // rolling grounds (±3 m), stronger in the forest
  const forest = 1 - ss(70, 110, Math.hypot(x - 165, z - 15));
  let h = (fbm(x * 0.012, z * 0.012) - 0.5) * (6 + 6 * forest) * freedom(x, z);
  // the Black Lake basin
  const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
  h = h * ss(LAKE.r - 2, LAKE.r + 14, dl) - 5 * (1 - ss(LAKE.r * 0.2, LAKE.r + 2, dl));
  // the Highlands: mountains beyond ~280 m, open to the sea in the south
  const south = Math.atan2(x, z);             // 0 = due south (+z)
  const sea = 1 - ss(0.35, 0.75, Math.abs(south));
  const ring = ss(270, 420, r) * (1 - sea);
  h += ring * (25 + 140 * Math.pow(fbm(x * 0.004 + 7, z * 0.004 - 3, 6), 1.6) * ss(300, 700, r) + 40 * fbm(x * 0.01, z * 0.01));
  // the land dips under the sea toward Azkaban
  h -= sea * ss(260, 330, r) * 26;
  // Azkaban: a rock plateau rising sheer out of the sea
  const isl = 1 - ss(16, 36, Math.hypot(x - AZKABAN.x, z - AZKABAN.z));
  h = h * (1 - isl) + 0.3 * isl;
  return h;
}

/** Vertex-coloured terrain: grass below, rock on slopes and heights, snow on the peaks. */
export function makeTerrain(grassMat: THREE.MeshStandardMaterial, rockMat: THREE.MeshStandardMaterial) {
  const group = new THREE.Group();
  // inner grounds: fine mesh, grass texture with macro colour variation
  const inner = new THREE.PlaneGeometry(640, 640, 256, 256);
  inner.rotateX(-Math.PI / 2);
  const p = inner.getAttribute('position');
  const col: number[] = [];
  const grid = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const y = heightAt(x, z);
    p.setY(i, y);
    grid[i] = y;
    const v = fbm(x * 0.02, z * 0.02) - 0.5;
    const dry = Math.max(0, v) * 0.35;
    const wet = y < -0.6 ? Math.min(1, -y / 4) : 0; // muddy shore
    col.push(0.85 + v * 0.18 + dry - wet * 0.35, 0.9 + v * 0.12 - wet * 0.3, 0.78 + v * 0.06 - dry * 0.5 - wet * 0.2);
  }
  inner.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  innerGrid = grid;
  inner.computeVertexNormals();
  const innerMesh = new THREE.Mesh(inner, grassMat);
  innerMesh.receiveShadow = true;
  innerMesh.name = 'ground';
  group.add(innerMesh);

  // the Highlands: a coarse ring out to 1.6 km
  const ring = new THREE.RingGeometry(300, 1600, 180, 48);
  ring.rotateX(-Math.PI / 2);
  const rp = ring.getAttribute('position');
  const rc: number[] = [];
  for (let i = 0; i < rp.count; i++) {
    const x = rp.getX(i), z = rp.getZ(i);
    const y = heightAt(x, z);
    rp.setY(i, y);
    const snow = ss(95, 140, y + fbm(x * 0.03, z * 0.03) * 25);
    const rock = ss(20, 60, y);
    const g = [0.34, 0.45, 0.25], r = [0.42, 0.4, 0.38], s = [0.95, 0.96, 1];
    const c = g.map((gv, k) => gv * (1 - rock) + r[k] * rock).map((v, k) => v * (1 - snow) + s[k] * snow);
    rc.push(...c);
  }
  ring.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3));
  ring.computeVertexNormals();
  const mat = rockMat.clone();
  mat.vertexColors = true;
  mat.map = rockMat.map;
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

export const landmarkHeight = (id: string) => { const l = LANDMARKS.find((x) => x.id === id); return l ? heightAt(l.x, l.z) : 0; };
