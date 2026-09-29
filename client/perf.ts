import type * as THREE from 'three/webgpu';

/**
 * Client performance probe, inert unless the page is opened with `?perf=1`.
 *
 * - An overlay (top right, under the clock): the GPU backend (WebGPU, or WebGL 2 and why), fps, frame ms
 *   (mean / worst of the last second), JS ms per frame, draw calls, triangles, shader programs and render
 *   pipelines, and what the compute passes hold (particles alive / budget, grass clumps).
 * - `window.__perf` for scripts/perf-client.ts: per-frame samples (frame interval, JS time per section,
 *   draw calls, triangles), counters (WebSocket bytes and messages, JSON.parse time) and load marks.
 *
 * Every hook is a no-op (one boolean test) when the probe is off.
 */
export const PERF = typeof location !== 'undefined' && new URLSearchParams(location.search).get('perf') === '1';

/** The sections a frame's JS time is split into (main.ts marks them). */
export type Section = 'msg' | 'parse' | 'apply' | 'hud' | 'ctl' | 'anim' | 'world' | 'fx' | 'render';
const SECTIONS: Section[] = ['msg', 'parse', 'apply', 'hud', 'ctl', 'anim', 'world', 'fx', 'render'];

interface Frame { t: number; dt: number; js: number; calls: number; tris: number; s: Record<string, number> }
const MAX = 20000;
const state = {
  frames: [] as Frame[],
  /** JS ms per section accumulated since the last frame ended (messages and the 10 Hz HUD land between frames). */
  acc: Object.fromEntries(SECTIONS.map((k) => [k, 0])) as Record<Section, number>,
  counters: { wsBytes: 0, wsMsgs: 0, snaps: 0, snapBytes: 0 },
  marks: {} as Record<string, number>,
  renderer: null as THREE.WebGPURenderer | null,
  extra: null as Extra | null,
  last: 0,
  scene: null as THREE.Scene | null,
  passes: {} as Record<string, number>,
  frameStart: 0,
};

/** performance.now() when the probe is on, else 0 (pass it to `end`). */
export const begin = (): number => (PERF ? performance.now() : 0);
export function end(section: Section, t0: number) {
  if (PERF) state.acc[section] += performance.now() - t0;
}
/** Count a WebSocket message (its length in UTF-16 units ≈ bytes for this ASCII protocol). */
export function wsMessage(len: number, snap: boolean) {
  if (!PERF) return;
  const c = state.counters;
  c.wsBytes += len; c.wsMsgs++;
  if (snap) { c.snaps++; c.snapBytes += len; }
}
/** A one-off load milestone (first snapshot, first frame drawn, …): kept at its first occurrence. */
export function mark(name: string) {
  if (PERF && !(name in state.marks)) state.marks[name] = performance.now();
}

/** What the probe reports besides renderer.info: the backend and the compute passes' contents. */
interface Extra {
  backend: string;
  fallback?: string;
  particles?: () => { glow: { drawn: number; capacity: number }; smoke: { drawn: number; capacity: number } } | undefined;
  grass?: () => { kind: string; budget: number } | undefined;
}
/**
 * Call once with the renderer: the probe then sums renderer.info over every pass of a frame (three.js's
 * node renderer counts draw calls per frame in info.render.drawCalls; every pass, the shadow map and the
 * lake's mirror included, is a renderer.render() call, counted here by what it draws into).
 */
export function attach(renderer: THREE.WebGPURenderer, scene?: THREE.Scene, extra?: Extra) {
  if (!PERF) return;
  state.renderer = renderer;
  state.scene = scene ?? null;
  state.extra = extra ?? null;
  renderer.info.autoReset = false;
  const render = renderer.render.bind(renderer);
  renderer.render = ((sc: THREE.Object3D, cam: THREE.Camera) => {
    const c0 = renderer.info.render.drawCalls;
    const rt = renderer.getRenderTarget();
    const out = render(sc, cam);
    const key = (cam as THREE.Camera & { isShadowCamera?: boolean }).type === 'OrthographicCamera' && rt && rt.depthTexture && !(sc as THREE.Mesh).isMesh
      ? 'shadow-map'
      : `${sc.type}:${rt ? `${rt.width}x${rt.height}` : 'screen'}:${cam.type}`;
    state.passes[key] = (state.passes[key] ?? 0) + renderer.info.render.drawCalls - c0;
    return out;
  }) as typeof renderer.render;
  (globalThis as unknown as { __perf: unknown }).__perf = api;
  overlay();
}

export function frameBegin() {
  if (!PERF) return;
  state.frameStart = performance.now();
  state.renderer?.info.reset();
}
export function frameEnd() {
  if (!PERF) return;
  const now = performance.now();
  const info = state.renderer?.info;
  let js = 0;
  const s: Record<string, number> = {};
  for (const k of SECTIONS) { const v = state.acc[k]; s[k] = v; js += k === 'parse' || k === 'apply' ? 0 : v; state.acc[k] = 0; } // parse/apply are inside msg
  const f: Frame = { t: now, dt: state.last ? now - state.last : 0, js, calls: info?.render.drawCalls ?? 0, tris: info?.render.triangles ?? 0, s };
  // the rAF callback's own time outside the marked sections
  s.frame = now - state.frameStart;
  state.last = now;
  if (state.frames.length >= MAX) state.frames.splice(0, MAX / 2);
  state.frames.push(f);
}

const api = {
  get frames() { return state.frames; },
  get counters() { return state.counters; },
  get marks() { return state.marks; },
  info() {
    const i = state.renderer?.info;
    const pl = pipelines();
    return i ? { programs: i.memory.programs, pipelines: pl?.caches.size ?? 0, geometries: i.memory.geometries, textures: i.memory.textures, compute: i.compute.frameCalls } : null;
  },
  /** 'webgpu' or 'webgl', and why WebGPU was not used. */
  get backend() { return state.extra ? `${state.extra.backend}${state.extra.fallback ? ` (${state.extra.fallback})` : ''}` : 'unknown'; },
  /** Particles drawn (the live window) and budgets, grass clumps. */
  gpuWork() {
    const p = state.extra?.particles?.(), g = state.extra?.grass?.();
    return { glow: p?.glow.drawn ?? 0, glowBudget: p?.glow.capacity ?? 0, smoke: p?.smoke.drawn ?? 0, smokeBudget: p?.smoke.capacity ?? 0, grass: g?.kind ?? '', grassBudget: g?.budget ?? 0 };
  },
  /** Draw calls per render() since the last reset, keyed by scene type, target size and camera. */
  get passes() { return state.passes; },
  /** The shader programs three.js holds (name and cache key head), to see what compiled when. */
  programs() {
    const pl = pipelines();
    if (!pl) return [];
    return (['vertex', 'fragment', 'compute'] as const).flatMap((k) => [...pl.programs[k].values()].map((p) => `${k} ${p.name} #${p.id}`));
  },
  /** What the scene holds: visible drawables grouped by their top-level ancestor, and shadow casters. */
  census() {
    const out: Record<string, { n: number; casters: number; tris: number; instances: number }> = {};
    const top = (o: THREE.Object3D) => { let x = o; while (x.parent && x.parent !== state.scene) x = x.parent; return x; };
    state.scene?.traverseVisible((o) => {
      if ((o as THREE.Light).isLight) { const k = `light:${o.type}`; (out[k] ??= { n: 0, casters: 0, tris: 0, instances: 0 }).n++; return; }
      const m = o as THREE.Mesh;
      if (!(m.isMesh || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite || (o as THREE.Line).isLine)) return;
      const t = top(o);
      const k = `${t.name || t.type}${(o as THREE.InstancedMesh).isInstancedMesh ? ' [inst]' : ''}`;
      const e = (out[k] ??= { n: 0, casters: 0, tris: 0, instances: 0 });
      e.n++;
      if (o.castShadow) e.casters++;
      const g = m.geometry;
      if (g) e.tris += (g.index ? g.index.count : g.getAttribute('position')?.count ?? 0) / 3;
      e.instances += (o as THREE.InstancedMesh).count ?? 1;
    });
    return out;
  },
  /** The drawables under top-level objects called `name` (or unnamed ones of that type), by geometry and material. */
  detail(name: string) {
    const out: Record<string, number> = {};
    for (const t of state.scene?.children ?? []) {
      if ((t.name || t.type) !== name) continue;
      t.traverseVisible((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh && !(o as THREE.Sprite).isSprite) return;
        const mat = m.material as THREE.Material;
        const k = `${m.geometry?.type}/${mat?.type}${mat?.transparent ? '/transp' : ''}${o.parent !== state.scene ? ' (child)' : ''}${o.name ? ` "${o.name}"` : ''}`;
        out[k] = (out[k] ?? 0) + 1;
      });
    }
    return Object.entries(out).sort((a, b) => b[1] - a[1]).slice(0, 30);
  },
  reset() {
    state.passes = {};
    state.frames = [];
    state.counters = { wsBytes: 0, wsMsgs: 0, snaps: 0, snapBytes: 0 };
  },
};

/** three.js's pipeline cache (programs by stage, pipelines by key): internal, read for the probe only. */
function pipelines() {
  return (state.renderer as unknown as { _pipelines?: { caches: Map<string, unknown>; programs: Record<'vertex' | 'fragment' | 'compute', Map<string, { name: string; id: number }>> } } | null)?._pipelines ?? null;
}

function overlay() {
  const el = document.createElement('div');
  el.id = 'perf';
  el.style.cssText = 'position:fixed;right:8px;top:64px;z-index:99;font:11px/1.35 ui-monospace,monospace;color:#cfe;background:rgba(0,0,0,.55);padding:4px 7px;border-radius:4px;pointer-events:none;white-space:pre';
  document.body.append(el);
  setInterval(() => {
    const now = performance.now();
    const fr = state.frames.filter((f) => f.t > now - 1000 && f.dt > 0);
    if (!fr.length) return;
    const mean = fr.reduce((a, f) => a + f.dt, 0) / fr.length;
    const worst = Math.max(...fr.map((f) => f.dt));
    const js = fr.reduce((a, f) => a + f.js, 0) / fr.length;
    const last = fr[fr.length - 1];
    const i = api.info();
    const g = api.gpuWork();
    const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${n}`);
    const text = `${api.backend === 'webgpu' ? 'WebGPU' : api.backend.replace(/^webgl/, 'WebGL 2')}\n${(1000 / mean).toFixed(0)} fps  ${mean.toFixed(1)} / ${worst.toFixed(0)} ms  ${state.renderer?.getPixelRatio().toFixed(2)}x\nJS ${js.toFixed(2)} ms/frame\n${last.calls} calls  ${(last.tris / 1000).toFixed(0)}k tris\n${i?.programs ?? 0} programs  ${i?.pipelines ?? 0} pipelines  ${i?.textures ?? 0} tex\nparticles ${k(g.glow + g.smoke)} / ${k(g.glowBudget + g.smokeBudget)}  grass ${g.grass} ${k(g.grassBudget)}${i?.compute ? `  ${i.compute} compute` : ''}`;
    if (el.textContent !== text) el.textContent = text;
  }, 500);
}
