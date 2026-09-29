import type * as THREE from 'three';

/**
 * Opt-in hooks for the offline promo renderer (scripts/promo/render.ts). Inert unless the page is opened
 * with `?capture=1`: then a script may set `window.__capture = { pos, look, fov, skip, hour, weather }` before
 * each frame to fly the camera along a scripted shot (instead of following your wizard), centre the sun's
 * shadows on what the camera looks at, pin the hour of the day and the weather (screenshot comparisons,
 * scripts/gpu-shots.ts), and skip drawing frames it does not keep. Normal play never reads it.
 */
interface Shot { pos?: [number, number, number]; look?: [number, number, number]; fov?: number; skip?: boolean; hour?: number; weather?: string }
const ON = typeof location !== 'undefined' && new URLSearchParams(location.search).get('capture') === '1';
const shot = (): Shot | null => (ON ? ((globalThis as { __capture?: Shot }).__capture ?? null) : null);

/** Points `camera` along the scripted shot, if any. Returns true when this frame is not to be drawn. */
export function captureCamera(camera: THREE.PerspectiveCamera): boolean {
  const s = shot();
  if (!s) return false;
  if (s.pos && s.look) {
    camera.position.set(...s.pos);
    camera.lookAt(...s.look);
    if (s.fov && s.fov !== camera.fov) { camera.fov = s.fov; camera.updateProjectionMatrix(); }
  }
  return !!s.skip;
}

/** Where the sun's shadow frustum centres: the shot's look-at point while capturing, else `focus` (your wizard). */
export function captureFocus<V extends THREE.Vector3>(focus: V): V {
  const s = shot();
  return s?.look ? (focus.clone().set(...s.look) as V) : focus;
}

/** The hour and weather the sky and lights use: the shot's, while capturing one that pins them, else the world's. */
export function captureEnv(hour: number, weather: string): [number, string] {
  const s = shot();
  return [s?.hour ?? hour, s?.weather ?? weather];
}
