import * as THREE from 'three/webgpu';

/**
 * The renderer: three.js's WebGPURenderer, on WebGPU where the browser has a working adapter and on
 * WebGL 2 otherwise (or with `?gpu=webgl`). Every material in the game is a node material (TSL), so the
 * same shaders compile to WGSL on one backend and GLSL on the other; a few features have a faster path
 * that only WebGPU can take (compute shaders with storage buffers, atomics and indirect draws: see
 * `COMPUTE`), each with a WebGL 2 path that looks the same.
 */
export type Backend = 'webgpu' | 'webgl';

const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
/** `?gpu=webgl` forces the WebGL 2 backend (comparisons, or a browser whose WebGPU misbehaves). */
export const FORCE_WEBGL = params.get('gpu') === 'webgl';

let backend: Backend = 'webgl';
/** Which backend the renderer runs on (valid once createGpuRenderer resolved). */
export const gpuBackend = () => backend;
/**
 * Compute passes (storage buffers written by compute shaders, atomics, indirect draws) are used on the
 * WebGPU backend only. three.js emulates compute on WebGL 2 with transform feedback, but without atomics,
 * indirect draws or scattered writes, so the WebGL 2 paths keep the vertex-shader / CPU versions.
 * `?compute=0` takes those paths on WebGPU too (comparisons).
 */
export const COMPUTE = () => backend === 'webgpu' && params.get('compute') !== '0';

/** Why WebGPU was not used (for the ?perf=1 overlay), or ''. */
export let fallbackReason = '';

/**
 * three.js r186 passes `swizzle: 'rgba'` (the identity, a string as the WebGPU spec now has it) in every texture
 * view descriptor; Chromium builds that shipped the earlier dictionary form of `texture-component-swizzle`
 * (e.g. 141) reject the string and fail every createView. The identity is the default anyway: drop it.
 */
function tolerateOldSwizzle() {
  const proto = (globalThis as { GPUTexture?: { prototype: { createView(d?: { swizzle?: unknown }): unknown; __swz?: boolean } } }).GPUTexture?.prototype;
  if (!proto || proto.__swz) return;
  proto.__swz = true;
  const createView = proto.createView;
  proto.createView = function (this: unknown, d?: { swizzle?: unknown }) {
    if (d && d.swizzle === 'rgba') d.swizzle = undefined;
    return createView.call(this, d);
  };
}

export async function createGpuRenderer(canvas: HTMLCanvasElement): Promise<THREE.WebGPURenderer> {
  tolerateOldSwizzle();
  let forceWebGL = FORCE_WEBGL;
  if (FORCE_WEBGL) fallbackReason = '?gpu=webgl';
  else {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(o?: object): Promise<unknown> } }).gpu;
    try {
      if (!gpu) { forceWebGL = true; fallbackReason = 'no navigator.gpu'; }
      else if (!(await gpu.requestAdapter({ powerPreference: 'high-performance' }))) { forceWebGL = true; fallbackReason = 'no WebGPU adapter'; }
    } catch (e) { forceWebGL = true; fallbackReason = `WebGPU adapter failed: ${(e as Error).message}`; }
  }
  // (antialias off: the scene is drawn into the post-processing pass's own multisampled target)
  let renderer = new THREE.WebGPURenderer({ canvas, antialias: false, powerPreference: 'high-performance', forceWebGL });
  try {
    await renderer.init();
  } catch (e) {
    if (forceWebGL) throw e;
    // an adapter that then fails to give a device: try again on WebGL 2
    fallbackReason = `WebGPU init failed: ${(e as Error).message}`;
    renderer.dispose();
    renderer = new THREE.WebGPURenderer({ canvas, antialias: false, powerPreference: 'high-performance', forceWebGL: true });
    await renderer.init();
  }
  backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl';
  console.info(`[gpu] ${backend === 'webgpu' ? 'WebGPU' : 'WebGL 2'} backend${fallbackReason ? ` (${fallbackReason})` : ''}`);
  return renderer;
}

// ------------------------------------------------------------------ per-frame GPU work
/**
 * Compute passes that must run before the frame is drawn (grass culling, particle simulation). Modules that
 * build their meshes without the renderer register a job here; render.ts runs them each frame, before the
 * scene is rendered.
 */
type Job = (renderer: THREE.WebGPURenderer, camera: THREE.Camera) => void;
const jobs = new Set<Job>();
export function onBeforeFrame(job: Job): () => void {
  jobs.add(job);
  return () => { jobs.delete(job); };
}
export function runFrameJobs(renderer: THREE.WebGPURenderer, camera: THREE.Camera) {
  for (const j of jobs) j(renderer, camera);
}

/**
 * Around the lake's mirror render (a second render of the scene from under the water): render.ts keeps the
 * sun's shadow map from being redrawn for the mirror's camera; main.ts leaves the actors out.
 */
export const mirrorGuards: { before: (() => void)[]; after: (() => void)[] } = { before: [], after: [] };
