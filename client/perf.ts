import type * as THREE from 'three';

/**
 * Client performance probe, inert unless the page is opened with `?perf=1`.
 *
 * - An overlay (top right, under the clock): fps, frame ms (mean / worst of the last second), JS ms per
 *   frame, draw calls, triangles, programs.
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
  renderer: null as THREE.WebGLRenderer | null,
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

/** Call once with the renderer: the probe then sums renderer.info over every pass of a frame. */
export function attach(renderer: THREE.WebGLRenderer, scene?: THREE.Scene) {
  if (!PERF) return;
  state.renderer = renderer;
  state.scene = scene ?? null;
  renderer.info.autoReset = false;
  // draw calls per pass (shadow maps render through renderBufferDirect, not render(): they land in the next pass)
  const render = renderer.render.bind(renderer);
  renderer.render = (sc, cam) => {
    const c0 = renderer.info.render.calls;
    render(sc, cam);
    const rt = renderer.getRenderTarget();
    const key = `${(sc as THREE.Object3D).type}:${rt ? `${rt.width}x${rt.height}` : 'screen'}:${(cam as THREE.Camera).type}`;
    state.passes[key] = (state.passes[key] ?? 0) + renderer.info.render.calls - c0;
  };
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
  const f: Frame = { t: now, dt: state.last ? now - state.last : 0, js, calls: info?.render.calls ?? 0, tris: info?.render.triangles ?? 0, s };
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
    return i ? { programs: i.programs?.length ?? 0, geometries: i.memory.geometries, textures: i.memory.textures } : null;
  },
  /** Draw calls per render() since the last reset, keyed by scene type, target size and camera. */
  get passes() { return state.passes; },
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
    const text = `${(1000 / mean).toFixed(0)} fps  ${mean.toFixed(1)} / ${worst.toFixed(0)} ms\nJS ${js.toFixed(2)} ms/frame\n${last.calls} calls  ${(last.tris / 1000).toFixed(0)}k tris\n${i?.programs ?? 0} programs  ${i?.textures ?? 0} tex`;
    if (el.textContent !== text) el.textContent = text;
  }, 500);
}
