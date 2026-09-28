import * as THREE from 'three';
import { mulberry32 } from '../src/shared/map';
import { LAKE, flatness, surfaceAt } from './terrain';

/**
 * A field of GPU-instanced grass around the player. The field is a G x G grid of square chunks;
 * each world chunk maps to a fixed slot of the instance buffer (toroidally), so walking only
 * regenerates the row of chunks that scrolled into view, a few per frame. Blade placement is seeded
 * by the chunk coordinates, so a chunk always grows the same grass. Blades sit on the rendered
 * terrain (surfaceAt), skip built/flat ground (the flatness mask), the lake and its shore, and
 * sway in the vertex shader (rolling gusts + flutter), bending away from the player's feet.
 */

interface Level { grid: number; chunk: number; perChunk: number }
const LEVELS: Record<'low' | 'high', Level> = {
  high: { grid: 7, chunk: 14, perChunk: 900 }, // 44,100 clumps x 4 blades
  low: { grid: 5, chunk: 10, perChunk: 150 },  //  3,750 clumps x 4 blades
};

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
/** 0..1: how much grass grows here. */
export function grassDensity(x: number, z: number, y: number) {
  const lake = ss(LAKE.r + 7, LAKE.r + 13, Math.hypot(x - LAKE.x, z - LAKE.z));
  return ss(0.3, 0.75, flatness(x, z)) * lake * (1 - ss(10, 22, y));
}

export function createGrass(scene: THREE.Scene) {
  const uniforms = {
    uTime: { value: 0 },
    uFocus: { value: new THREE.Vector3() },
    uRadius: { value: 40 },
    uWind: { value: new THREE.Vector2(0.8, 0.35) },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = `attribute vec4 aOffset; attribute vec4 aShape;
      uniform float uTime; uniform vec3 uFocus; uniform float uRadius; uniform vec2 uWind;
      varying float vTip; varying float vHue;
      ` + sh.vertexShader
      .replace('#include <beginnormal_vertex>', `
        float gc = cos(aOffset.w), gs = sin(aOffset.w);
        mat2 gRot = mat2(gc, -gs, gs, gc);
        vec3 objectNormal = normal;
        objectNormal.xz = gRot * objectNormal.xz;`)
      .replace('#include <begin_vertex>', `
        float bh = aShape.x * (1.0 - smoothstep(uRadius * 0.7, uRadius, distance(aOffset.xz, uFocus.xz)));
        vec3 transformed = vec3(position.x * aShape.y, position.y * bh, position.z * aShape.y);
        transformed.xz = gRot * transformed.xz;
        // wind: slow gusts rolling across the grounds plus a quick per-blade flutter
        float gust = 0.5 + 0.5 * sin(dot(aOffset.xz, vec2(0.061, 0.043)) - uTime * 1.25);
        gust *= 0.6 + 0.4 * sin(dot(aOffset.xz, vec2(-0.017, 0.029)) + uTime * 0.37);
        float flutter = sin(uTime * 3.7 + aShape.w * 6.2831 + aOffset.x * 0.8) * 0.22;
        float bend = (0.12 + gust * 0.55 + flutter * 0.6) * position.y * position.y * bh;
        transformed.xz += uWind * bend;
        transformed.y -= 0.35 * bend * bend / max(bh, 0.05);
        // blades part around the player's feet
        vec2 away = aOffset.xz - uFocus.xz;
        float dp = length(away);
        transformed.xz += away / max(dp, 0.01) * smoothstep(1.4, 0.2, dp) * 0.45 * position.y * bh;
        transformed += aOffset.xyz;
        vTip = position.y; vHue = aShape.z;`);
    sh.fragmentShader = `varying float vTip; varying float vHue;
      ` + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float hue = fract(vHue);
        vec3 gRoot = vec3(0.035, 0.085, 0.018);
        vec3 gTip = mix(vec3(0.12, 0.29, 0.045), vec3(0.3, 0.36, 0.09), hue * hue * hue);
        diffuseColor.rgb = mix(gRoot, gTip, smoothstep(0.0, 1.0, vTip));
        if (vHue > 1.5) {
          // wildflowers: a coloured head on the tips of the clump
          vec3 petal = vHue < 3.0 ? vec3(0.85, 0.82, 0.7) : vHue < 4.0 ? vec3(0.9, 0.62, 0.06) : vec3(0.42, 0.2, 0.75);
          diffuseColor.rgb = mix(diffuseColor.rgb, petal, smoothstep(0.72, 0.9, vTip));
        }`)
      // lit from above on both faces (blades are thin; no dark backsides)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        #ifdef DOUBLE_SIDED
          normal *= faceDirection;
        #endif`);
  };
  mat.customProgramCacheKey = () => 'grass-field';

  const base = clumpGeometry();
  let level = LEVELS.high;
  let geo: THREE.InstancedBufferGeometry | null = null;
  let offs: THREE.InstancedBufferAttribute, shape: THREE.InstancedBufferAttribute;
  let slots: (string | null)[] = [];
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  scene.add(mesh);
  let visible = true;

  function build(l: Level) {
    level = l;
    geo?.dispose();
    geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    for (const k of ['position', 'normal', 'uv']) geo.setAttribute(k, base.getAttribute(k));
    const n = l.grid * l.grid * l.perChunk;
    offs = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    shape = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aOffset', offs);
    geo.setAttribute('aShape', shape);
    geo.instanceCount = n;
    mesh.geometry = geo;
    slots = new Array(l.grid * l.grid).fill(null);
    uniforms.uRadius.value = (l.grid / 2 - 0.5) * l.chunk;
  }

  function fill(slot: number, cx: number, cz: number) {
    const { chunk, perChunk } = level;
    const rnd = mulberry32(((cx * 73856093) ^ (cz * 19349663)) >>> 0);
    const o = offs.array as Float32Array, s = shape.array as Float32Array;
    const start = slot * perChunk;
    for (let i = 0; i < perChunk; i++) {
      const x = (cx + rnd()) * chunk, z = (cz + rnd()) * chunk;
      const y = surfaceAt(x, z);
      const d = grassDensity(x, z, y);
      const keep = rnd() < d;
      const k = (start + i) * 4;
      o[k] = x; o[k + 1] = y - 0.03; o[k + 2] = z; o[k + 3] = rnd() * Math.PI * 2;
      s[k] = keep ? (0.28 + rnd() * 0.42) * (0.55 + 0.45 * d) : 0;
      s[k + 1] = 0.8 + rnd() * 0.7;
      s[k + 2] = rnd() < 0.04 ? 2 + Math.floor(rnd() * 3) + rnd() * 0.9 : rnd(); // a few wildflowers (hue >= 2)
      s[k + 3] = rnd();
    }
    offs.addUpdateRange(start * 4, perChunk * 4);
    shape.addUpdateRange(start * 4, perChunk * 4);
    offs.needsUpdate = shape.needsUpdate = true;
  }

  build(level);
  return {
    mesh,
    setQuality(q: 'low' | 'high') { if (LEVELS[q] !== level) build(LEVELS[q]); },
    setVisible(v: boolean) { visible = v; mesh.visible = v; },
    /** Re-centre on `focus` (a few chunks per call) and advance the wind. */
    update(t: number, focus: THREE.Vector3, budget = 3) {
      uniforms.uTime.value = t;
      uniforms.uFocus.value.copy(focus);
      if (!visible) return;
      const { grid, chunk } = level;
      const h = Math.floor(grid / 2);
      const ccx = Math.floor(focus.x / chunk), ccz = Math.floor(focus.z / chunk);
      let done = 0;
      const first = slots.every((x) => x === null);
      for (let dz = -h; dz <= h; dz++)
        for (let dx = -h; dx <= h; dx++) {
          const cx = ccx + dx, cz = ccz + dz;
          const slot = (((cx % grid) + grid) % grid) + grid * (((cz % grid) + grid) % grid);
          const key = `${cx},${cz}`;
          if (slots[slot] === key) continue;
          if (!first && done >= budget) continue;
          fill(slot, cx, cz);
          slots[slot] = key;
          done++;
        }
    },
  };
}
