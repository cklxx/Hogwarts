import * as THREE from 'three';
import { WIND } from './grass';

/**
 * GPU particles. Each pool is ONE THREE.Points draw call over a ring buffer: a particle is written
 * once when it is emitted (spawn position, velocity, colour, birth time, life, size, gravity, drag)
 * and the vertex shader integrates its motion analytically from its age, so the CPU never touches
 * a live particle again. Only the slots written this frame are uploaded (addUpdateRange).
 *
 * Two pools: `glow` (additive, HDR colours so the bloom pass picks them up: sparks, trails, motes)
 * and `smoke` (alpha-blended, lit by the time of day: chimney smoke, dust, apparition puffs).
 */

const STRIDE = 15; // pos3 vel3 col3 time4(birth, life, size, grow) phys2(gravity, drag)

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

class Pool {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  private data: Float32Array;
  private buf: THREE.InterleavedBuffer;
  private head = 0;
  private frameStart = 0;
  private written = 0;
  time = 0;
  constructor(scene: THREE.Scene, readonly capacity: number, additive: boolean) {
    this.data = new Float32Array(capacity * STRIDE);
    // everything starts long dead
    for (let i = 0; i < capacity; i++) { this.data[i * STRIDE + 9] = -1e6; this.data[i * STRIDE + 10] = 0.001; }
    this.buf = new THREE.InterleavedBuffer(this.data, STRIDE);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.InterleavedBufferAttribute(this.buf, 3, 0));
    geo.setAttribute('aVel', new THREE.InterleavedBufferAttribute(this.buf, 3, 3));
    geo.setAttribute('aColor', new THREE.InterleavedBufferAttribute(this.buf, 3, 6));
    geo.setAttribute('aTime', new THREE.InterleavedBufferAttribute(this.buf, 4, 9));
    geo.setAttribute('aPhys', new THREE.InterleavedBufferAttribute(this.buf, 2, 13));
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uScale: { value: 500 }, uLight: { value: 1 } }]),
      defines: additive ? { ADDITIVE: '' } : {},
      vertexShader: /* glsl */ `
        uniform float uTime; uniform float uScale;
        attribute vec3 aVel; attribute vec3 aColor; attribute vec4 aTime; attribute vec2 aPhys;
        varying vec3 vColor; varying float vAlpha;
        #include <fog_pars_vertex>
        void main() {
          float age = uTime - aTime.x;
          float life = aTime.y;
          if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vColor = vec3(0.0); vAlpha = 0.0; return; }
          float k = max(aPhys.y, 0.001);
          float f = (1.0 - exp(-k * age)) / k;            // ∫ e^{-kt}: drag slows the launch velocity
          vec3 p = position + aVel * f;
          p.y -= aPhys.x * (age - f) / k;                 // gravity against the same drag
          float t = age / life;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = min(512.0, aTime.z * mix(1.0, aTime.w, t) * uScale / max(0.2, -mvPosition.z));
          #ifdef ADDITIVE
            vAlpha = smoothstep(0.0, 0.06, t) * (1.0 - t) * (1.0 - t);
          #else
            vAlpha = smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.4, 1.0, t));
          #endif
          vColor = aColor;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uLight;
        varying vec3 vColor; varying float vAlpha;
        #include <fog_pars_fragment>
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0 || vAlpha <= 0.0) discard;
          #ifdef ADDITIVE
            float a = pow(1.0 - d, 1.8) + 0.6 * pow(max(0.0, 1.0 - d * 2.5), 2.0); // soft halo + hot core
            vec3 col = vColor;
          #else
            float a = pow(1.0 - d, 1.3) * 0.55;
            vec3 col = vColor * uLight;
          #endif
          float fogF = 0.0;
          #ifdef USE_FOG
            #ifdef FOG_EXP2
              fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
            #else
              fogF = smoothstep(fogNear, fogFar, vFogDepth);
            #endif
          #endif
          #ifdef ADDITIVE
            gl_FragColor = vec4(col * (1.0 - fogF), a * vAlpha);
          #else
            gl_FragColor = vec4(mix(col, fogColor, fogF), a * vAlpha);
          #endif
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: true,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false; // positions live in the shader
    this.points.renderOrder = additive ? 5 : 4;
    scene.add(this.points);
  }
  /** Write one particle. */
  put(x: number, y: number, z: number, vx: number, vy: number, vz: number, c: THREE.Color, life: number, size: number, grow: number, gravity: number, drag: number) {
    const o = this.head * STRIDE, d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z;
    d[o + 3] = vx; d[o + 4] = vy; d[o + 5] = vz;
    d[o + 6] = c.r; d[o + 7] = c.g; d[o + 8] = c.b;
    d[o + 9] = this.time; d[o + 10] = life; d[o + 11] = size; d[o + 12] = grow;
    d[o + 13] = gravity; d[o + 14] = drag;
    this.head = (this.head + 1) % this.capacity;
    this.written++;
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
  /** Advance time and upload only the ring-buffer slots written since the last frame. */
  flush(dt: number, scale: number, light: number) {
    this.time += dt;
    const u = this.material.uniforms;
    u.uTime.value = this.time;
    u.uScale.value = scale;
    u.uLight.value = light;
    const n = this.written;
    if (!n) return;
    const cap = this.capacity;
    if (n >= cap) this.buf.addUpdateRange(0, cap * STRIDE);
    else if (this.frameStart + n <= cap) this.buf.addUpdateRange(this.frameStart * STRIDE, n * STRIDE);
    else {
      this.buf.addUpdateRange(this.frameStart * STRIDE, (cap - this.frameStart) * STRIDE);
      this.buf.addUpdateRange(0, (this.frameStart + n - cap) * STRIDE);
    }
    this.buf.needsUpdate = true;
    this.written = 0;
    this.frameStart = this.head;
  }
}

function randomUnit(v: THREE.Vector3) {
  const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
  return v.set(s * Math.cos(a), u, s * Math.sin(a));
}

export type Particles = ReturnType<typeof createFx>;

/**
 * The game's particle effects. At 'low' quality every effect emits 40% of its particles (trails are
 * laid down more sparsely, chimney smoke puffs are fewer and bigger).
 */
export function createFx(scene: THREE.Scene, chimneys: THREE.Vector3[] = []) {
  const glow = new Pool(scene, 14000, true);
  const smoke = new Pool(scene, 2400, false);
  let density = 1;
  const N = (n: number) => Math.max(1, Math.round(n * density));
  const trails = new WeakMap<object, { x: number; y: number; z: number; acc: number; frame: number }>();
  let frameNo = 0;
  const up = new THREE.Vector3(0, 1, 0);
  const smokeAcc = chimneys.map(() => Math.random());
  const cam = new THREE.Vector3();

  const api = {
    glow, smoke,
    setQuality(q: 'low' | 'high') { density = q === 'low' ? 0.4 : 1; },
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
      smoke.emit(x, y + 0.2, z, { color: 0x8a8070, speed: r * 2.2, dir: up, cone: 3, up: 0.3, size: 1.2, life: 1.1, drag: 2.8, grow: 3, radius: 0.6, flat: true }, N(Math.min(40, r * 4)));
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
          smoke.emit(c.x, c.y, c.z, { color: 0x9a948c, radius: 0.25, speed: 0.25, up: 1.3, size: 1.1 / Math.sqrt(density), sizeJitter: 0.25, life: 7, lifeJitter: 0.2, gravity: -0.05, drag: 0.25, grow: 4.5, wind: [WIND.x * 0.9, WIND.y * 0.9] }, 1);
        }
      });
    },
    update(dt: number, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer, day: number) {
      frameNo++;
      api.tickSmoke(dt, camera);
      const scale = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      glow.flush(dt, scale, 1);
      smoke.flush(dt, scale, 0.18 + 0.82 * day);
    },
  };
  return api;
}
