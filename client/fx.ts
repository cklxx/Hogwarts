import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { facingCorner } from './billboards';
import { COMPUTE, onBeforeFrame } from './gpu';
import { WIND, gpuGround } from './grass';
import { STORYBOOK } from './textures';

/** Chimney smoke and dust: warm grey, or (storybook) a soft painted lilac-grey that sits in the palette. */
const SMOKE = STORYBOOK ? 0xb0a6b6 : 0x9a948c, DUST = STORYBOOK ? 0xa08c78 : 0x8a8070;

const T = TSL as unknown as Record<string, any>;
const { Fn, vec2, vec3, vec4, float, uint, uniform, attribute, varying, If, Return, exp, max, min, mix, pow, smoothstep, length, abs,
  uv, instanceIndex, instancedArray, storage, reference, positionView, modelViewMatrix, Discard } = T;

/**
 * GPU particles. Each pool is ONE draw call over a ring buffer of camera-facing quads: a particle is
 * written once, when it is emitted (spawn position, velocity, colour, birth time, life, size, growth,
 * gravity, drag), and the GPU does everything after that; the CPU never touches a live particle again.
 * Only the ring-buffer slots written this frame are uploaded.
 *
 * - **WebGPU**: a compute shader simulates every particle that can still be alive (storage buffers of
 *   position and velocity: drag, gravity, and sparks that bounce off the ground, read from the terrain's
 *   height texture), and only that window of the ring is drawn. Budget: 98 304 glow + 32 768 smoke
 *   particles at 'high' (a quarter at 'low').
 * - **WebGL 2**: the vertex shader integrates the motion analytically from the particle's age (the same
 *   drag and gravity; no ground contact), over the whole ring: 16 384 glow + 4 096 smoke.
 *
 * Two pools: `glow` (additive, HDR colours so the bloom pass picks them up: sparks, trails, motes)
 * and `smoke` (alpha-blended, lit by the time of day: chimney smoke, dust, apparition puffs).
 */

/** Floats per particle: pos3 birth | vel3 life | col3 size | grow gravity drag - (four vec4). */
const STRIDE = 16;

export interface EmitOpts {
  count?: number;
  color: THREE.ColorRepresentation;
  /** HDR multiplier (> 1 blooms). */
  intensity?: number;
  /** Mix each particle's colour toward white by up to this much. */
  whiten?: number;
  speed?: number;
  speedJitter?: number;
  /** Preferred direction (normalised). Without it particles fly out in every direction. */
  dir?: THREE.Vector3;
  /** 0 = exactly along dir, 1 = a full hemisphere around it. */
  cone?: number;
  /** Extra vertical velocity added to every particle. */
  up?: number;
  /** Spawn position jitter (a sphere of this radius). */
  radius?: number;
  /** Flatten the spawn sphere to a horizontal disc. */
  flat?: boolean;
  size?: number;
  sizeJitter?: number;
  life?: number;
  lifeJitter?: number;
  /** m/s² downward (negative rises). */
  gravity?: number;
  /** 1/s linear drag. */
  drag?: number;
  /** Size multiplier reached at the end of life (1 = constant, 0 = shrink away, > 1 grows). */
  grow?: number;
  /** Constant horizontal drift [x, z] added to the velocity (wind). */
  wind?: [number, number];
}

const tmpC = new THREE.Color();
const white = new THREE.Color(1, 1, 1);
const tmpV = new THREE.Vector3();
const tmpD = new THREE.Vector3();

/** Particle budgets: [glow, smoke] per backend and quality. */
export const BUDGET = { webgpu: { high: [98304, 32768], low: [24576, 8192] }, webgl: { high: [16384, 4096], low: [16384, 4096] } } as const;

/** Where a frame's particles went in the ring, and when the last of them dies. */
interface Span { start: number; n: number; death: number }

export class Pool {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicNodeMaterial;
  readonly gpu: boolean;
  capacity: number;
  private data!: Float32Array;
  private spawn!: THREE.BufferAttribute;
  private geo: THREE.InstancedBufferGeometry;
  private head = 0;
  private frameStart = 0;
  private written = 0;
  private frameDeath = 0;
  /** When the last particle written so far dies (nothing is drawn after that). */
  private lastDeath = 0;
  private primed = false;
  private spans: Span[] = [];
  private u = { time: uniform(0), prev: uniform(0), dt: uniform(0), light: uniform(1), start: uniform(0, 'uint'), cap: uniform(1, 'uint'), count: uniform(0, 'uint'), px: uniform(0.001) };
  private sim: any = null;
  private scene: THREE.Scene;
  time = 0;
  /** Particles drawn (and, on WebGPU, simulated) in the last frame: the live window of the ring. */
  drawn = 0;
  constructor(scene: THREE.Scene, capacity: number, readonly additive: boolean) {
    this.scene = scene;
    this.gpu = COMPUTE();
    this.capacity = capacity;
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.geo.setAttribute('uv', quad.getAttribute('uv'));
    this.material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false });
    this.material.userData.noFade = true;
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false; // positions live on the GPU
    this.mesh.renderOrder = additive ? 5 : 4;
    this.mesh.name = additive ? 'fx-glow' : 'fx-smoke';
    this.allocate(capacity);
    scene.add(this.mesh);
    // (hidden while nothing lives, but compiled with the rest by render.ts's warm-up)
    this.mesh.userData.warmVisible = true;
    if (this.gpu) onBeforeFrame((renderer) => {
      if (!this.sim) return;
      // the first frame after (re)allocation runs the simulation once over one long-dead particle: its compute
      // pipeline is built then (the warm-up frame), not on the frame the first spark flies
      if (!this.primed) { this.primed = true; renderer.compute(this.sim, 1); }
      if (!this.drawn || !this.mesh.visible) return;
      renderer.compute(this.sim, this.drawn); // (one thread per particle in the live window)
    });
  }

  /** (Re)build the buffers and shaders for `capacity` particles (a quality change: live particles are dropped). */
  allocate(capacity: number) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity * STRIDE);
    // everything starts long dead
    for (let i = 0; i < capacity; i++) { this.data[i * STRIDE + 3] = -1e6; this.data[i * STRIDE + 7] = 0.001; }
    this.head = this.frameStart = this.written = 0;
    this.lastDeath = 0;
    this.spans = [];
    this.primed = false;
    this.u.cap.value = capacity;
    const u = this.u;
    let slot: any, p0: any, v0: any, cs: any, gp: any, centre: any;
    if (this.gpu) {
      this.spawn = new THREE.StorageBufferAttribute(this.data, 4);
      const spawn = storage(this.spawn, 'vec4', capacity * 4).toReadOnly();
      const state = instancedArray(capacity * 2, 'vec4');
      const { groundAt } = gpuGround();
      // simulate the window [start, start + count) of the ring
      this.sim = Fn(() => {
        If(instanceIndex.greaterThanEqual(u.count), () => { Return(); });
        const i = instanceIndex.add(u.start).mod(u.cap);
        const a = spawn.element(i.mul(4)), b = spawn.element(i.mul(4).add(1)), d = spawn.element(i.mul(4).add(3));
        const age = u.time.sub(a.w);
        If(age.lessThan(0).or(age.greaterThan(b.w)), () => { Return(); });
        const k = max(d.z, 0.001), g = d.y;
        const pos = state.element(i.mul(2)), vel = state.element(i.mul(2).add(1));
        If(a.w.greaterThan(u.prev), () => {
          // born since the last step: exactly where the analytic motion has it now
          const f = float(1).sub(exp(k.negate().mul(age))).div(k);
          const p = a.xyz.add(b.xyz.mul(f)).toVar();
          p.y.subAssign(g.mul(age.sub(f)).div(k));
          pos.assign(vec4(p, 0));
          vel.assign(vec4(b.xyz.mul(exp(k.negate().mul(age))).sub(vec3(0, g.mul(float(1).sub(exp(k.negate().mul(age)))).div(k), 0)), 0));
        }).Else(() => {
          const e = exp(k.negate().mul(u.dt));
          const v1 = vel.xyz.mul(e).sub(vec3(0, g.mul(float(1).sub(e)).div(k), 0)).toVar();
          const p1 = pos.xyz.add(vel.xyz.add(v1).mul(u.dt.mul(0.5))).toVar();
          // falling sparks and embers land and bounce on the ground (inside the terrain's fine grid)
          If(g.greaterThan(0.5).and(abs(p1.x).lessThan(318)).and(abs(p1.z).lessThan(318)), () => {
            const h = groundAt(p1.x, p1.z).x.add(0.03);
            If(p1.y.lessThan(h).and(v1.y.lessThan(0)), () => {
              p1.y.assign(h);
              v1.assign(vec3(v1.x.mul(0.6), v1.y.mul(-0.35), v1.z.mul(0.6)));
            });
          });
          pos.assign(vec4(p1, 0));
          vel.assign(vec4(v1, 0));
        });
      })().compute(capacity, [64]);
      slot = instanceIndex.add(u.start).mod(u.cap);
      p0 = spawn.element(slot.mul(4));
      v0 = spawn.element(slot.mul(4).add(1));
      cs = spawn.element(slot.mul(4).add(2));
      gp = spawn.element(slot.mul(4).add(3));
      centre = state.element(slot.mul(2)).xyz;
    } else {
      const buf = new THREE.InstancedInterleavedBuffer(this.data, STRIDE);
      buf.setUsage(THREE.DynamicDrawUsage);
      this.spawn = buf as unknown as THREE.BufferAttribute;
      for (const [name, off] of [['aP', 0], ['aV', 4], ['aC', 8], ['aG', 12]] as const) this.geo.setAttribute(name, new THREE.InterleavedBufferAttribute(buf, 4, off));
      p0 = attribute('aP', 'vec4'); v0 = attribute('aV', 'vec4'); cs = attribute('aC', 'vec4'); gp = attribute('aG', 'vec4');
      // the motion from the particle's age: ∫ e^{-kt} for the launch velocity under drag, gravity against the same drag
      centre = Fn(() => {
        const age = u.time.sub(p0.w), k = max(gp.z, 0.001);
        const f = float(1).sub(exp(k.negate().mul(age))).div(k);
        const p = p0.xyz.add(v0.xyz.mul(f)).toVar();
        p.y.subAssign(gp.y.mul(age.sub(f)).div(k));
        return p;
      })();
    }
    const age = u.time.sub(p0.w), life = v0.w;
    const t = age.div(life);
    const alive = age.greaterThanEqual(0).and(age.lessThanEqual(life));
    // size in metres (a point of `size` world units, as the old gl_PointSize rule), at most 512 pixels
    const depth = max(modelViewMatrix.mul(vec4(centre, 1)).z.negate(), 0.2);
    const size = min(cs.w.mul(mix(float(1), gp.x, t)), u.px.mul(512).mul(depth));
    const s = alive.select(size, 0);
    this.material.positionNode = facingCorner(centre, s, s);
    const vAlpha = varying(alive.select(this.additive ? smoothstep(0, 0.06, t).mul(float(1).sub(t)).mul(float(1).sub(t)) : smoothstep(0, 0.15, t).mul(float(1).sub(smoothstep(0.4, 1, t))), 0));
    const vColor = varying(cs.xyz);
    const fog = this.scene.fog as THREE.FogExp2;
    this.material.colorNode = Fn(() => {
      const r = length(uv().sub(0.5)).mul(2);
      If(r.greaterThan(1).or(vAlpha.lessThanEqual(0)), () => { Discard(); });
      // exp² fog on the particle's own depth
      const density = reference('density', 'float', fog);
      const z = positionView.z.negate();
      const fogF = float(1).sub(exp(density.mul(density).mul(z).mul(z).negate()));
      if (this.additive) {
        const a = pow(float(1).sub(r), 1.8).add(pow(max(0, float(1).sub(r.mul(2.5))), 2).mul(0.6)); // soft halo + hot core
        return vec4(vColor.mul(float(1).sub(fogF)), a.mul(vAlpha));
      }
      const a = pow(float(1).sub(r), 1.3).mul(0.55);
      return vec4(mix(vColor.mul(u.light), reference('color', 'color', fog), fogF), a.mul(vAlpha));
    })();
    this.material.needsUpdate = true;
    this.geo.instanceCount = this.gpu ? 0 : capacity;
  }

  /** Write one particle. */
  put(x: number, y: number, z: number, vx: number, vy: number, vz: number, c: THREE.Color, life: number, size: number, grow: number, gravity: number, drag: number) {
    const o = this.head * STRIDE, d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = this.time;
    d[o + 4] = vx; d[o + 5] = vy; d[o + 6] = vz; d[o + 7] = life;
    d[o + 8] = c.r; d[o + 9] = c.g; d[o + 10] = c.b; d[o + 11] = size;
    d[o + 12] = grow; d[o + 13] = gravity; d[o + 14] = drag;
    this.head = (this.head + 1) % this.capacity;
    this.written++;
    if (this.time + life > this.frameDeath) this.frameDeath = this.time + life;
    if (this.frameDeath > this.lastDeath) this.lastDeath = this.frameDeath;
  }
  emit(x: number, y: number, z: number, o: EmitOpts, n: number) {
    const base = tmpC.set(o.color).multiplyScalar(o.intensity ?? 1);
    const br = base.r, bg = base.g, bb = base.b;
    const c = new THREE.Color();
    const hot = new THREE.Color(1, 1, 1).multiplyScalar(o.intensity ?? 1);
    const wx = o.wind?.[0] ?? 0, wz = o.wind?.[1] ?? 0;
    for (let i = 0; i < n; i++) {
      // spawn offset
      let px = x, py = y, pz = z;
      if (o.radius) {
        randomUnit(tmpV).multiplyScalar(o.radius * Math.cbrt(Math.random()));
        if (o.flat) tmpV.y *= 0.1;
        px += tmpV.x; py += tmpV.y; pz += tmpV.z;
      }
      // velocity
      const sp = (o.speed ?? 0) * (1 + (Math.random() * 2 - 1) * (o.speedJitter ?? 0.4));
      if (o.dir) {
        randomUnit(tmpD).multiplyScalar(o.cone ?? 0.3).add(o.dir).normalize();
      } else randomUnit(tmpD);
      const vx = tmpD.x * sp + wx, vy = tmpD.y * sp + (o.up ?? 0), vz = tmpD.z * sp + wz;
      c.setRGB(br, bg, bb);
      if (o.whiten) c.lerp(hot, Math.random() * o.whiten);
      const life = (o.life ?? 0.8) * (1 + (Math.random() * 2 - 1) * (o.lifeJitter ?? 0.3));
      const size = (o.size ?? 0.3) * (1 + (Math.random() * 2 - 1) * (o.sizeJitter ?? 0.3));
      this.put(px, py, pz, vx, vy, vz, c, Math.max(0.05, life), size, o.grow ?? 0.3, o.gravity ?? 0, o.drag ?? 0.5);
    }
  }
  /**
   * Advance time, upload only the ring-buffer slots written since the last frame, and (WebGPU) work out the
   * window of the ring that can still be alive: that much is simulated and drawn. `px` is the size of a
   * pixel one metre from the camera (for the 512-pixel cap).
   */
  flush(dt: number, px: number, light: number) {
    this.u.prev.value = this.time;
    this.time += dt;
    const u = this.u;
    u.time.value = this.time;
    u.dt.value = dt;
    u.px.value = px;
    u.light.value = light;
    const n = this.written, cap = this.capacity;
    if (n) {
      const buf = this.spawn as unknown as { addUpdateRange(a: number, b: number): void; clearUpdateRanges(): void; needsUpdate: boolean };
      buf.clearUpdateRanges();
      if (n >= cap) buf.addUpdateRange(0, cap * STRIDE);
      else if (this.frameStart + n <= cap) buf.addUpdateRange(this.frameStart * STRIDE, n * STRIDE);
      else {
        buf.addUpdateRange(this.frameStart * STRIDE, (cap - this.frameStart) * STRIDE);
        buf.addUpdateRange(0, (this.frameStart + n - cap) * STRIDE);
      }
      buf.needsUpdate = true;
      this.spans.push({ start: this.frameStart, n: Math.min(n, cap), death: this.frameDeath });
    }
    this.written = 0;
    this.frameDeath = 0;
    this.frameStart = this.head;
    this.mesh.visible = this.time < this.lastDeath;
    if (!this.gpu) { this.drawn = this.mesh.visible ? cap : 0; return; }
    // frames whose particles are all dead leave the window from the old end
    while (this.spans.length && this.spans[0].death < this.time) this.spans.shift();
    let count = 0;
    for (const s of this.spans) count += s.n;
    count = Math.min(count, cap);
    const start = this.spans.length ? this.spans[0].start : this.head;
    // (a window that wrapped all the way round is the whole ring, starting anywhere)
    u.start.value = count >= cap ? 0 : start;
    u.count.value = count;
    this.geo.instanceCount = count;
    this.drawn = count;
  }
}

function randomUnit(v: THREE.Vector3) {
  const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
  return v.set(s * Math.cos(a), u, s * Math.sin(a));
}

export type Particles = ReturnType<typeof createFx>;

/** The size of one pixel one metre in front of `camera` (metres), on the renderer's drawing buffer. */
const size2 = new THREE.Vector2();
export function pixelSize(camera: THREE.PerspectiveCamera, renderer: THREE.WebGPURenderer) {
  renderer.getDrawingBufferSize(size2);
  return (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, size2.y);
}

/**
 * The game's particle effects. At 'low' quality every effect emits 40% of its particles (trails are
 * laid down more sparsely, chimney smoke puffs are fewer and bigger).
 */
export function createFx(scene: THREE.Scene, chimneys: THREE.Vector3[] = []) {
  // (?particles=N: N glow + N/4 smoke on either backend, e.g. the same budget for a side-by-side measurement)
  const forced = typeof location !== 'undefined' ? Number(new URLSearchParams(location.search).get('particles')) : 0;
  const fixed = forced > 0 ? [Math.round(forced), Math.round(forced / 4)] as const : null;
  const budget = fixed ? { high: fixed, low: fixed } : COMPUTE() ? BUDGET.webgpu : BUDGET.webgl;
  const glow = new Pool(scene, budget.high[0], true);
  const smoke = new Pool(scene, budget.high[1], false);
  let density = 1;
  let quality: 'low' | 'high' = 'high';
  const N = (n: number) => Math.max(1, Math.round(n * density));
  const trails = new WeakMap<object, { x: number; y: number; z: number; acc: number; frame: number }>();
  let frameNo = 0;
  const up = new THREE.Vector3(0, 1, 0);
  const smokeAcc = chimneys.map(() => Math.random());
  const cam = new THREE.Vector3();

  const api = {
    glow, smoke,
    /** Particle capacity: [glow, smoke]. */
    get budget() { return [glow.capacity, smoke.capacity]; },
    setQuality(q: 'low' | 'high') {
      density = q === 'low' ? 0.4 : 1;
      if (q === quality) return;
      quality = q;
      const [g, s] = budget[q];
      if (g !== glow.capacity) glow.allocate(g);
      if (s !== smoke.capacity) smoke.allocate(s);
    },
    burst(x: number, y: number, z: number, o: EmitOpts) { glow.emit(x, y, z, o, N(o.count ?? 20)); },
    puff(x: number, y: number, z: number, o: EmitOpts) { smoke.emit(x, y, z, o, N(o.count ?? 10)); },

    /**
     * A bolt's comet tail: particles laid down along the path it travelled since last frame. Call it
     * every frame while the thing is shown; a key skipped for a frame (hidden, then shown again
     * somewhere else) starts a fresh tail instead of streaking across from where it was last seen.
     */
    trail(key: object, p: THREE.Vector3, color: number, spacing = 0.16) {
      let s = trails.get(key);
      if (!s) { s = { x: p.x, y: p.y, z: p.z, acc: 0, frame: frameNo }; trails.set(key, s); }
      const fresh = s.frame < frameNo - 1;
      s.frame = frameNo;
      const dx = p.x - s.x, dy = p.y - s.y, dz = p.z - s.z;
      const d = Math.hypot(dx, dy, dz);
      if (fresh || d > 30) { s.x = p.x; s.y = p.y; s.z = p.z; s.acc = 0; return; } // teleported or reappeared: restart the tail
      const step = spacing / density;
      s.acc += d;
      const hot = new THREE.Color(color).multiplyScalar(4);
      const core = new THREE.Color(color).lerp(white, 0.3).multiplyScalar(4);
      while (s.acc >= step) {
        s.acc -= step;
        const k = 1 - s.acc / Math.max(d, 1e-6);
        const x = s.x + dx * k, y = s.y + dy * k, z = s.z + dz * k;
        // bright core streak that shrinks fast, and element-coloured embers that drift and fall
        glow.put(x, y, z, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, core, 0.18 + Math.random() * 0.08, 0.55, 0.2, 0, 1);
        glow.put(x + (Math.random() - 0.5) * 0.2, y + (Math.random() - 0.5) * 0.2, z + (Math.random() - 0.5) * 0.2,
          (Math.random() - 0.5) * 1.6, (Math.random() - 0.2) * 1.6, (Math.random() - 0.5) * 1.6, hot, 0.45 + Math.random() * 0.4, 0.28 + Math.random() * 0.14, 0.1, 2.5, 1.5);
      }
      s.x = p.x; s.y = p.y; s.z = p.z;
    },
    forget(key: object) { trails.delete(key); },

    // ---- named effects used by spawnFx
    sparks(x: number, y: number, z: number, color: number, n = 26) {
      api.burst(x, y, z, { count: n, color, intensity: 4, whiten: 0.6, speed: 6, speedJitter: 0.6, up: 1.5, size: 0.22, life: 0.55, gravity: 9, drag: 2.2, grow: 0.2, radius: 0.2 });
      api.burst(x, y, z, { count: 1, color, intensity: 3, whiten: 0.5, size: 1.1, life: 0.16, lifeJitter: 0, sizeJitter: 0, grow: 1.5, drag: 1 });
    },
    flash(p: THREE.Vector3, color: number, size = 0.8) {
      api.burst(p.x, p.y, p.z, { count: 1, color, intensity: 4, whiten: 0.8, size, life: 0.18, lifeJitter: 0, sizeJitter: 0, grow: 1.6 });
      api.burst(p.x, p.y, p.z, { count: 12, color, intensity: 4, whiten: 0.7, speed: 2.5, size: 0.12, life: 0.45, gravity: 1.5, drag: 3 });
    },
    shockwave(x: number, y: number, z: number, r: number, color: number) {
      const n = N(Math.min(260, 40 + r * 22));
      const c = new THREE.Color(color).multiplyScalar(4);
      const drag = 3.5;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.05;
        const v = r * drag * (0.9 + Math.random() * 0.2);
        glow.put(x + Math.cos(a) * 0.4, y + 0.15 + Math.random() * 0.4, z + Math.sin(a) * 0.4, Math.cos(a) * v, Math.random() * 1.2, Math.sin(a) * v, c, 0.55 + Math.random() * 0.25, 0.4, 0.3, 1, drag);
      }
      smoke.emit(x, y + 0.2, z, { color: DUST, speed: r * 2.2, dir: up, cone: 3, up: 0.3, size: 1.2, life: 1.1, drag: 2.8, grow: 3, radius: 0.6, flat: true }, N(Math.min(40, r * 4)));
    },
    motes(x: number, y: number, z: number, color: number, n = 34) {
      api.burst(x, y + 0.9, z, { count: n, color, intensity: 3.5, whiten: 0.4, radius: 0.9, flat: true, speed: 0.4, up: 1.1, size: 0.16, life: 1.5, gravity: -0.6, drag: 0.8, grow: 0.4 });
    },
    fountain(x: number, y: number, z: number, color: number, n = 150) {
      api.burst(x, y + 0.5, z, { count: n, color, intensity: 4, whiten: 0.5, dir: up, cone: 0.28, speed: 11, speedJitter: 0.35, size: 0.2, life: 2.1, gravity: 9.8, drag: 0.35, grow: 0.3, radius: 0.3 });
    },
    zap(pts: THREE.Vector3[], color: number) {
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1];
        const d = a.distanceTo(b);
        const n = N(Math.min(40, d * 3));
        for (let k = 0; k < n; k++) {
          tmpV.copy(a).lerp(b, Math.random());
          api.burst(tmpV.x, tmpV.y, tmpV.z, { count: 1, color, intensity: 5, whiten: 0.6, speed: 2.2, size: 0.16, life: 0.4, gravity: 3, drag: 2 });
        }
        api.sparks(b.x, b.y, b.z, color, 14);
      }
    },
    /** Rising smoke from every chimney within 300 m of the camera, drifting downwind. */
    tickSmoke(dt: number, camera: THREE.Camera) {
      cam.setFromMatrixPosition(camera.matrixWorld);
      const rate = 3.2 * density;
      chimneys.forEach((c, i) => {
        if (c.distanceToSquared(cam) > 300 * 300) return;
        smokeAcc[i] += dt * rate;
        while (smokeAcc[i] >= 1) {
          smokeAcc[i] -= 1;
          smoke.emit(c.x, c.y, c.z, { color: SMOKE, radius: 0.25, speed: 0.25, up: 1.3, size: 1.1 / Math.sqrt(density), sizeJitter: 0.25, life: 7, lifeJitter: 0.2, gravity: -0.05, drag: 0.25, grow: 4.5, wind: [WIND.x * 0.9, WIND.y * 0.9] }, 1);
        }
      });
    },
    update(dt: number, camera: THREE.PerspectiveCamera, renderer: THREE.WebGPURenderer, day: number) {
      frameNo++;
      api.tickSmoke(dt, camera);
      const px = pixelSize(camera, renderer);
      glow.flush(dt, px, 1);
      smoke.flush(dt, px, 0.18 + 0.82 * day);
    },
  };
  return api;
}

/**
 * Rain and snow round the player: 3 000 streaks placed by the vertex shader (each falls from its own height
 * and wraps round a 40 m column; the CPU used to move every one of them every frame). Put `points` at the
 * player each frame and call update().
 */
export function createWeather(scene: THREE.Scene, n = 3000) {
  const home = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) home.set([(Math.random() - 0.5) * 120, Math.random() * 40, (Math.random() - 0.5) * 120], i * 3);
  const fallen = uniform(0), size = uniform(0.15);
  const m = new THREE.PointsNodeMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, sizeAttenuation: true });
  const h = T.instancedBufferAttribute(new THREE.InstancedBufferAttribute(home, 3));
  m.positionNode = vec3(h.x, T.mod(h.y.sub(fallen), 40), h.z);
  m.sizeNode = size;
  const points = new THREE.Sprite(m as unknown as THREE.SpriteMaterial);
  points.count = n;
  points.frustumCulled = false;
  points.visible = false;
  scene.add(points);
  return {
    points,
    update(weather: string, dt: number) {
      points.visible = weather === 'rain' || weather === 'snow';
      if (!points.visible) return;
      fallen.value = (fallen.value + (weather === 'rain' ? 30 : 3) * dt) % 4000;
      size.value = weather === 'rain' ? 0.08 : 0.2;
    },
  };
}
