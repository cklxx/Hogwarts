import type * as THREE from 'three';

/**
 * Opt-in hooks for the offline promo renderer (scripts/promo/render.ts). Inert unless the page is opened
 * with `?capture=1`: then a script may set `window.__capture = { pos, look, fov, skip }` before each frame
 * to fly the camera along a scripted shot (instead of following your wizard), centre the sun's shadows on
 * what the camera looks at, and skip drawing frames it does not keep. Normal play never reads it.
 */
interface Shot { pos?: [number, number, number]; look?: [number, number, number]; fov?: number; skip?: boolean }
const ON = typeof location !== 'undefined' && new URLSearchParams(location.search).get('capture') === '1';
const shot = (): Shot | null => (ON ? ((globalThis as { __capture?: Shot }).__capture ?? null) : null);

/** A scripted shot is driving the camera (view.ts then leaves it alone: no spring arm, fades or x-rays). */
export function captureActive(): boolean {
  const s = shot();
  return !!(s?.pos && s.look);
}

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
