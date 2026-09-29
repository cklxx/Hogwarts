import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { mulberry32 } from '../src/shared/map';
import { COMPUTE, onBeforeFrame } from './gpu';
import { StoryStandardMaterial } from './storybook';
import { INNER_GRID, LAKE, SEA_LEVEL, flatness, surfaceAt } from './terrain';
import { STORYBOOK } from './textures';

/**
 * A field of wind-blown grass around the player, in one of two ways that look the same:
 *
 * - **WebGPU: generated, culled and counted on the GPU.** Every frame a compute shader walks a jittered
 *   lattice of clump sites around the player (~24 000 at 'high'), reads the ground's height and how much grass
 *   grows there from a texture of the terrain's own grid, drops what does not grow, what is off screen and a
 *   share of the far ones, and appends the rest to a storage buffer with an atomic counter, which is also the
 *   instance count of one indirect draw. The CPU does nothing per frame but set four uniforms, and only the
 *   clumps in view are drawn (culled one by one, not per chunk).
 * - **WebGL 2** (no compute atomics or indirect draws): a G x G grid of square chunks, one small instanced
 *   mesh each, filled on the CPU. Every world chunk maps to a fixed chunk mesh (toroidally), so walking only
 *   regenerates the row of chunks that scrolled into view, a few per frame; placement is seeded by the chunk
 *   coordinates, so a chunk always grows the same grass. Only the clumps that grow are uploaded, each chunk
 *   is frustum-culled as a whole, and a far chunk draws a prefix of its (randomly placed) clumps.
 *
 * Either way the blades sit on the rendered terrain (surfaceAt) and sway in the vertex shader (rolling gusts
 * plus flutter), bending away from the player's feet, from the same TSL code.
 */

/** Everything that sways (grass, tree crowns, pennants, chimney smoke) leans with the same wind. */
export const WIND = new THREE.Vector2(0.8, 0.35);

const T = TSL as unknown as Record<string, any>;
const { Fn, vec2, vec3, vec4, float, int, uint, uniform, attribute, varying, select, If, Return, sin, cos, dot, fract, floor, abs, max, min, clamp, mix,
  smoothstep, distance, length, hash, textureLoad, ivec2, instanceIndex, instancedArray, storage, atomicAdd, atomicStore,
  positionGeometry, normalGeometry, transformNormalToView } = T;

interface Level { grid: number; chunk: number; perChunk: number }
const LEVELS: Record<'low' | 'high', Level> = {
  // up to ~18k clumps (~72k blades) drawn in an unbroken meadow, before frustum culling
  high: { grid: 7, chunk: 14, perChunk: 640 },
  // up to ~2.6k clumps (~10k blades)
  low: { grid: 5, chunk: 10, perChunk: 150 },
};
/** The field's radius at a level (blades shrink into the ground toward it). */
const radiusOf = (l: Level) => (l.grid / 2 - 0.5) * l.chunk;

/**
 * Four blades fanned around a common root (one instance). Widths and offsets are in metres, the
 * height is 1 (scaled per instance).
 */
const BLADES = 4;
function clumpGeometry() {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  const SEG = 3;
  for (let b = 0; b < BLADES; b++) {
    const a = (b / BLADES) * Math.PI + Math.sin(b * 2.3) * 0.25;
    const ca = Math.cos(a), sa = Math.sin(a);
    const ox = Math.sin(b * 4.1) * 0.07, oz = Math.cos(b * 3.7) * 0.07;
    const lean = 0.08 + 0.07 * (b % 3);
    const base = pos.length / 3;
    for (let i = 0; i <= SEG; i++) {
      const y = i / SEG;
      const hw = i === SEG ? 0 : 0.028 * (1 - y * 0.75);
      const bend = lean * y * y;
      for (const side of i === SEG ? [0] : [-1, 1]) {
        const lx = side * hw;
        // blade plane rotated by a around y, leaning along its normal
        pos.push(ox + lx * ca + bend * sa, y, oz - lx * sa + bend * ca);
        nrm.push(sa * 0.35, 1, ca * 0.35);
        uv.push(side * 0.5 + 0.5, y);
      }
    }
    for (let i = 0; i < SEG - 1; i++) {
      const r0 = base + i * 2, r1 = r0 + 2;
      idx.push(r0, r0 + 1, r1, r0 + 1, r1 + 1, r1);
    }
    const last = base + (SEG - 1) * 2;
    idx.push(last, last + 1, last + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/**
 * surfaceAt() matches what is drawn only on the inner terrain mesh, and only inside r = 300 m is that
 * mesh alone: the coarse Highlands ring (and, far beyond it, Azkaban's rock) starts there.
 */
const INNER_R = 300;
/** 0..1: how much grass grows here. */
export function grassDensity(x: number, z: number, y: number) {
  const lake = ss(LAKE.r + 7, LAKE.r + 13, Math.hypot(x - LAKE.x, z - LAKE.z));
  // none out on the Highlands ring or Azkaban (it would float over the coarse mesh), none under the sea
  const inner = 1 - ss(INNER_R - 18, INNER_R - 4, Math.hypot(x, z));
  const dry = ss(SEA_LEVEL + 0.2, SEA_LEVEL + 1, y);
  // the mask is 0 on built ground and rises over ~18 m around it: let the lawn come close to the paths
  return ss(0.03, 0.3, flatness(x, z)) * lake * inner * dry * (1 - ss(10, 22, y));
}

// ------------------------------------------------------------------ the blades (both paths)
interface Field { time: any; focus: any; radius: any; wind: any }
/**
 * The blade material. `off` = (x, y, z, yaw) of the clump's root, `shp` = (height, width, hue, phase); a hue
 * of 2 or more is a wildflower (2: white, 3: gold, 4: violet).
 */
function bladeMaterial(u: Field, off: any, shp: any) {
  const m = new StoryStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  const cr = cos(off.w), sr = sin(off.w);
  const rot = (v: any) => vec2(cr.mul(v.x).add(sr.mul(v.y)), sr.negate().mul(v.x).add(cr.mul(v.y)));
  const p = positionGeometry;
  m.positionNode = Fn(() => {
    // blades shrink into the ground toward the edge of the field, so it has no visible border
    const bh = shp.x.mul(float(1).sub(smoothstep(u.radius.mul(0.45), u.radius, distance(off.xz, u.focus.xz))));
    const t = vec3(p.x.mul(shp.y), p.y.mul(bh), p.z.mul(shp.y)).toVar();
    t.xz.assign(rot(t.xz));
    // wind: slow gusts rolling across the grounds plus a quick per-blade flutter
    const gust = sin(dot(off.xz, vec2(0.061, 0.043)).sub(u.time.mul(1.25))).mul(0.5).add(0.5)
      .mul(sin(dot(off.xz, vec2(-0.017, 0.029)).add(u.time.mul(0.37))).mul(0.4).add(0.6));
    const flutter = sin(u.time.mul(3.7).add(shp.w.mul(6.2831)).add(off.x.mul(0.8))).mul(0.22);
    const bend = float(0.12).add(gust.mul(0.55)).add(flutter.mul(0.6)).mul(p.y).mul(p.y).mul(bh);
    t.xz.addAssign(u.wind.mul(bend));
    t.y.subAssign(bend.mul(bend).mul(0.35).div(max(bh, 0.05)));
    // blades part around the player's feet
    const away = off.xz.sub(u.focus.xz);
    const dp = length(away);
    t.xz.addAssign(away.div(max(dp, 0.01)).mul(smoothstep(1.4, 0.2, dp)).mul(p.y).mul(bh).mul(0.45));
    return t.add(off.xyz);
  })();
  // the blade's normal turned with the clump; lit from above on both faces (blades are thin: no dark backsides)
  const n = normalGeometry;
  m.normalNode = transformNormalToView(varying(vec3(rot(n.xz).x, n.y, rot(n.xz).y))).normalize();
  const tip = varying(p.y), hueV = varying(shp.z);
  m.colorNode = Fn(() => {
    const hue = fract(hueV);
    const root = STORYBOOK ? vec3(0.022, 0.055, 0.018) : vec3(0.035, 0.085, 0.018);
    const tipC = STORYBOOK ? mix(vec3(0.06, 0.15, 0.035), vec3(0.16, 0.23, 0.055), hue.mul(hue)) : mix(vec3(0.1, 0.25, 0.04), vec3(0.27, 0.32, 0.08), hue.mul(hue).mul(hue));
    const c = mix(root, tipC, smoothstep(0, 1, tip)).toVar();
    // wildflowers: a coloured head on the tips of the clump
    const petal = select(hueV.lessThan(3), vec3(0.85, 0.82, 0.7), select(hueV.lessThan(4), vec3(0.9, 0.62, 0.06), vec3(0.42, 0.2, 0.75)));
    If(hueV.greaterThan(1.5), () => { c.assign(mix(c, petal, smoothstep(0.72, 0.9, tip))); });
    return vec4(c, 1);
  })();
  return m;
}

// ------------------------------------------------------------------ WebGL 2: CPU chunks
interface Chunk {
  mesh: THREE.Mesh;
  geo: THREE.InstancedBufferGeometry;
  offs: THREE.InstancedBufferAttribute;
  shape: THREE.InstancedBufferAttribute;
  /** The world chunk "cx,cz" it holds (null: not filled yet). */
  key: string | null;
  /** Clumps that grow there (the first `kept` instances). */
  kept: number;
  x0: number;
  z0: number;
}

export function createGrass(scene: THREE.Scene) {
  const u: Field = { time: uniform(0), focus: uniform(new THREE.Vector3()), radius: uniform(40), wind: uniform(WIND) };
  const group = new THREE.Group();
  group.name = 'grass';
  scene.add(group);
  let visible = true;
  const field = COMPUTE() ? gpuField(group, u) : cpuField(group, u);
  field.build(LEVELS.high);
  return {
    group,
    /** 'gpu' (compute-generated, one indirect draw) or 'cpu' (instanced chunks). */
    kind: field.kind,
    /** Clumps the last frame could draw at most (GPU: every lattice site; CPU: what the chunks hold). */
    get budget() { return field.budget(); },
    setQuality(q: 'low' | 'high') { field.build(LEVELS[q]); },
    setVisible(v: boolean) { visible = v; group.visible = v; },
    /** Re-centre on `focus`, thin the far clumps and advance the wind. */
    update(t: number, focus: THREE.Vector3, budget = 3) {
      u.time.value = t;
      u.focus.value.copy(focus);
      if (visible) field.update(focus, budget);
    },
  };
}

function cpuField(group: THREE.Group, u: Field) {
  const mat = bladeMaterial(u, attribute('aOffset', 'vec4'), attribute('aShape', 'vec4'));
  let level: Level | null = null;
  let base: THREE.BufferGeometry | null = null;
  let chunks: Chunk[] = [];
  /** Chunk offsets around the player's chunk, nearest first (after a teleport the grass regrows from the feet out). */
  let order: [number, number][] = [];

  function build(l: Level) {
    if (l === level) return;
    level = l;
    for (const c of chunks) { group.remove(c.mesh); c.geo.dispose(); }
    base?.dispose();
    base = clumpGeometry();
    chunks = [];
    for (let i = 0; i < l.grid * l.grid; i++) {
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = base.index;
      for (const k of ['position', 'normal', 'uv']) geo.setAttribute(k, base.getAttribute(k));
      const offs = new THREE.InstancedBufferAttribute(new Float32Array(l.perChunk * 4), 4);
      const shape = new THREE.InstancedBufferAttribute(new Float32Array(l.perChunk * 4), 4);
      geo.setAttribute('aOffset', offs);
      geo.setAttribute('aShape', shape);
      geo.instanceCount = 0;
      geo.boundingSphere = new THREE.Sphere(); // set by fill(): the blades live in world space
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.visible = false;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      chunks.push({ mesh, geo, offs, shape, key: null, kept: 0, x0: 0, z0: 0 });
    }
    u.radius.value = radiusOf(l);
    const h = Math.floor(l.grid / 2);
    order = [];
    for (let dz = -h; dz <= h; dz++) for (let dx = -h; dx <= h; dx++) order.push([dx, dz]);
    order.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
  }

  /** Grow world chunk (cx, cz) into `c`: only the clumps that grow are written, packed at the front. */
  function fill(c: Chunk, cx: number, cz: number) {
    const { chunk, perChunk } = level!;
    const rnd = mulberry32(((cx * 73856093) ^ (cz * 19349663)) >>> 0);
    const o = c.offs.array as Float32Array, s = c.shape.array as Float32Array;
    let n = 0, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < perChunk; i++) {
      const x = (cx + rnd()) * chunk, z = (cz + rnd()) * chunk;
      const y = surfaceAt(x, z);
      const d = grassDensity(x, z, y);
      if (!(rnd() < d)) continue;
      const k = n++ * 4;
      o[k] = x; o[k + 1] = y - 0.03; o[k + 2] = z; o[k + 3] = rnd() * Math.PI * 2;
      s[k] = (0.28 + rnd() * 0.42) * (0.55 + 0.45 * d);
      s[k + 1] = 0.8 + rnd() * 0.7;
      s[k + 2] = rnd() < 0.04 ? 2 + Math.floor(rnd() * 3) + rnd() * 0.9 : rnd(); // a few wildflowers (hue >= 2)
      s[k + 3] = rnd();
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    c.key = `${cx},${cz}`;
    c.kept = n;
    c.x0 = cx * chunk;
    c.z0 = cz * chunk;
    if (!n) return;
    c.offs.addUpdateRange(0, n * 4);
    c.shape.addUpdateRange(0, n * 4);
    c.offs.needsUpdate = c.shape.needsUpdate = true;
    // the chunk's box (blades up to 0.7 m tall, bent up to ~1 m by the wind and the player's feet)
    const half = chunk / 2;
    c.geo.boundingSphere!.center.set(c.x0 + half, (y0 + y1) / 2 + 0.35, c.z0 + half);
    c.geo.boundingSphere!.radius = Math.hypot(half * Math.SQRT2 + 1, (y1 - y0) / 2 + 0.8);
  }

  return {
    kind: 'cpu' as const,
    build,
    budget: () => chunks.reduce((a, c) => a + c.kept, 0),
    update(focus: THREE.Vector3, budget: number) {
      const { grid, chunk } = level!;
      const ccx = Math.floor(focus.x / chunk), ccz = Math.floor(focus.z / chunk);
      let done = 0;
      const first = chunks.every((c) => c.key === null);
      for (const [dx, dz] of order) {
        const cx = ccx + dx, cz = ccz + dz;
        const c = chunks[(((cx % grid) + grid) % grid) + grid * (((cz % grid) + grid) % grid)];
        if (c.key === `${cx},${cz}`) continue;
        if (!first && done >= budget) break;
        fill(c, cx, cz);
        done++;
      }
      // draw a prefix of each chunk's clumps: all of them near the player, fewer where the blades
      // shrink toward the edge of the field, none beyond it (this also hides a chunk that scrolled
      // out of the field and has not been regrown yet)
      const R = u.radius.value as number;
      for (const c of chunks) {
        let n = 0;
        if (c.kept) {
          const ex = Math.max(c.x0 - focus.x, 0, focus.x - c.x0 - chunk);
          const ez = Math.max(c.z0 - focus.z, 0, focus.z - c.z0 - chunk);
          const d = Math.hypot(ex, ez);
          if (d < R) n = Math.ceil(c.kept * (1 - 0.75 * ss(0.35 * R, R, d)));
        }
        c.geo.instanceCount = n;
        c.mesh.visible = n > 0;
      }
    },
  };
}

// ------------------------------------------------------------------ WebGPU: compute
/**
 * The ground for the compute shader: the inner terrain mesh's own vertex heights (257 x 257 over ±320 m, so
 * blades sit on the drawn triangles exactly, as surfaceAt does) and grassDensity at each vertex (smooth over
 * tens of metres: interpolated between vertices).
 */
function groundTexture() {
  const { size, step, heights } = INNER_GRID();
  const W = size + 1;
  const data = new Float32Array(W * W * 4);
  for (let iz = 0; iz < W; iz++) for (let ix = 0; ix < W; ix++) {
    const i = iz * W + ix, x = -320 + ix * step, z = -320 + iz * step, y = heights[i];
    data[i * 4] = y;
    data[i * 4 + 1] = grassDensity(x, z, y);
  }
  const t = new THREE.DataTexture(data, W, W, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter; // (read with textureLoad, interpolated in the shader)
  t.needsUpdate = true;
  return { tex: t, W, step };
}

let ground: { groundAt: any } | null = null;
/** The ground for compute shaders (grass here, particles in fx.ts): groundAt(x, z) = vec2(height, grass density). */
export function gpuGround() {
  if (ground) return ground;
  const g = groundTexture();
  const texel = (ix: any, iz: any) => textureLoad(g.tex, ivec2(clamp(ix, 0, g.W - 1), clamp(iz, 0, g.W - 1)));
  /** Height of the drawn triangles and the grass density at (x, z): surfaceAt and grassDensity, on the GPU. */
  const groundAt = Fn(([x, z]: any[]) => {
    const fx = x.add(320).div(g.step), fz = z.add(320).div(g.step);
    const ix = int(floor(fx)), iz = int(floor(fz));
    const a = fx.sub(floor(fx)), b = fz.sub(floor(fz));
    const ha = texel(ix, iz), hb = texel(ix, iz.add(1)), hc = texel(ix.add(1), iz.add(1)), hd = texel(ix.add(1), iz);
    // PlaneGeometry splits each cell along the (x0, z1)-(x1, z0) diagonal
    const y = select(a.add(b).lessThanEqual(1), ha.x.add(hd.x.sub(ha.x).mul(a)).add(hb.x.sub(ha.x).mul(b)), hc.x.add(hb.x.sub(hc.x).mul(float(1).sub(a))).add(hd.x.sub(hc.x).mul(float(1).sub(b))));
    const d = mix(mix(ha.y, hd.y, a), mix(hb.y, hc.y, a), b);
    return vec2(y, d);
  });
  return (ground = { groundAt });
}

function gpuField(group: THREE.Group, u: Field) {
  const { groundAt } = gpuGround();
  /** The camera's projection x view (a compute pass has no camera of its own). */
  const viewProj = uniform(new THREE.Matrix4());
  // per level: lattice spacing (the CPU field's mean clump density), sites per side, buffers, kernels
  let cur: { level: Level; cell: number; side: number; mesh: THREE.Mesh; cull: any; reset: any; origin: any; dispose(): void } | null = null;

  function build(l: Level) {
    if (cur?.level === l) return;
    cur?.dispose();
    const R = radiusOf(l);
    u.radius.value = R;
    const cell = l.chunk / Math.sqrt(l.perChunk);
    const side = Math.ceil((2 * R) / cell) + 2;
    const max = side * side;
    const instances = instancedArray(max * 2, 'vec4');
    const base = clumpGeometry();
    const draw = new THREE.IndirectStorageBufferAttribute(new Uint32Array([base.index!.count, 0, 0, 0, 0]), 5);
    base.setIndirect(draw);
    const counter = storage(draw, 'uint', 5).toAtomic();
    const origin = uniform(new THREE.Vector2());
    const reset = Fn(() => { atomicStore(counter.element(1), uint(0)); })().compute(1);
    const cull = Fn(() => {
      If(instanceIndex.greaterThanEqual(uint(max)), () => { Return(); });
      const gx = int(instanceIndex.mod(uint(side))).add(int(origin.x)), gz = int(instanceIndex.div(uint(side))).add(int(origin.y));
      const seed = uint(gx.add(8192)).mul(uint(16384)).add(uint(gz.add(8192))).mul(uint(16));
      const r = (k: number) => hash(seed.add(uint(k)));
      const x = float(gx).add(r(0)).mul(cell), z = float(gz).add(r(1)).mul(cell);
      // beyond the field, or thinned out toward its edge (the CPU field draws a shrinking share of each chunk)
      const dist = length(vec2(x, z).sub(u.focus.xz));
      If(dist.greaterThan(R).or(r(8).greaterThan(float(1).sub(smoothstep(0.35 * R, R, dist).mul(0.75)))), () => { Return(); });
      const g = groundAt(x, z), y = g.x, d = g.y;
      If(r(2).greaterThanEqual(d), () => { Return(); });
      // in view? (the clump's centre, with a metre of margin for blades bent by the wind)
      const clip = viewProj.mul(vec4(x, y.add(0.35), z, 1));
      If(clip.w.lessThan(-1).or(abs(clip.x).greaterThan(clip.w.add(2))).or(abs(clip.y).greaterThan(clip.w.add(2))), () => { Return(); });
      const i = atomicAdd(counter.element(1), uint(1)).toVar();
      const flower = r(6).lessThan(0.04);
      const hue = select(flower, float(2).add(floor(r(9).mul(3))).add(r(10).mul(0.9)), r(6).sub(0.04).div(0.96));
      instances.element(i.mul(2)).assign(vec4(x, y.sub(0.03), z, r(3).mul(Math.PI * 2)));
      instances.element(i.mul(2).add(1)).assign(vec4(r(4).mul(0.42).add(0.28).mul(d.mul(0.45).add(0.55)), r(5).mul(0.7).add(0.8), hue, r(7)));
    })().compute(max, [64]);
    const mat = bladeMaterial(u, instances.element(instanceIndex.mul(2)), instances.element(instanceIndex.mul(2).add(1)));
    const mesh = new THREE.Mesh(base, mat);
    mesh.frustumCulled = false; // (culled clump by clump in the compute pass)
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.name = 'grass-gpu';
    group.add(mesh);
    cur = {
      level: l, cell, side, mesh, cull, reset, origin,
      dispose() { group.remove(mesh); base.dispose(); mat.dispose(); },
    };
  }

  let pending = false;
  onBeforeFrame((renderer, camera) => {
    if (!pending || !cur || !group.visible) return;
    pending = false;
    camera.updateMatrixWorld();
    viewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    renderer.compute([cur.reset, cur.cull]);
  });
  return {
    kind: 'gpu' as const,
    build,
    budget: () => (cur ? cur.side * cur.side : 0),
    update(focus: THREE.Vector3) {
      if (!cur) return;
      cur.origin.value.set(Math.floor(focus.x / cur.cell) - (cur.side >> 1), Math.floor(focus.z / cur.cell) - (cur.side >> 1));
      pending = true; // (the compute pass runs just before the frame is drawn, with this frame's camera)
    },
  };
}
