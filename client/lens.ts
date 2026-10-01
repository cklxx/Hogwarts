/**
 * 2.5D's lens (the owner, 2026-10-01: 「近小远大的透视效果用来屏幕内能看到更多内容…尽可能少计算」): the ground the
 * screen shows is narrow near you and wide up the screen, so it holds more of the world while you stay the size you
 * were. It costs nothing per frame: the same camera, moved in along its arm to 1/k of the way and its lens widened k
 * times (tan of the half angle), frames the player exactly as before — only what is nearer or further changes size —
 * and the arm is tipped a little lower so the far edge reaches further. The rest (picking, the cut-outs round you,
 * the lake's mirror, culling) sees an ordinary perspective camera, because it is one.
 *
 * Measured on the visible ground (docs/PERF.md 2026-10-01): a 16:9 screen 402 → 571 m² (+42 %), the far edge 10 → 15 m
 * ahead; things at the bottom 1.20 → 1.39 times the player's size, at the top 0.80 → 0.61. A portrait phone's lens
 * is already 64° tall (it widens to show 32° across), so there k stays 1 and the pitch as it was.
 */
/** The camera's vertical field of view; a portrait screen widens it for at least PORTRAIT_H_FOV across (up to PORTRAIT_V_MAX). */
export const BASE_FOV = 55, PORTRAIT_H_FOV = 60, PORTRAIT_V_MAX = 88;
/** The vertical field of view for a screen of this width ÷ height (pure, for tests). */
export function fovFor(aspect: number, base = BASE_FOV, hMin = PORTRAIT_H_FOV): number {
  if (aspect >= 1) return base;
  const need = (2 * Math.atan(Math.tan((hMin * Math.PI) / 360) / aspect) * 180) / Math.PI;
  return Math.min(PORTRAIT_V_MAX, Math.max(base, need));
}
/**
 * 2.5D's framing (controls.ts setView): what a long lens from FLAT_DIST away would show of you — 30° tall on a wide
 * screen, at least 32° across on a portrait one. flatLens below keeps that framing and widens the lens from nearer.
 */
export const FLAT_FOV = 30, FLAT_H_FOV = 32;

/** The widest the lens is made (vertical), the most it is widened, and the arm's pitch range (it tips down to show far). */
export const LENS_V_MAX = 44, LENS_K_MAX = 1.5, LENS_PITCH = [0.8, 0.92] as const;
/** The top of the picture stays this far (rad) below the horizon: the far edge is ground, not sky. */
const TOP_BELOW = 0.42;

/** The lens for a screen of this width ÷ height: vertical fov (deg), k (the camera at dist / k), the arm's pitch. Pure. */
export function flatLens(aspect: number) {
  const t0 = Math.tan((fovFor(aspect, FLAT_FOV, FLAT_H_FOV) * Math.PI) / 360);
  const k = Math.max(1, Math.min(LENS_K_MAX, Math.tan((LENS_V_MAX * Math.PI) / 360) / t0));
  const half = Math.atan(t0 * k);
  return { fov: (2 * half * 180) / Math.PI, k, pitch: Math.max(LENS_PITCH[0], Math.min(LENS_PITCH[1], half + TOP_BELOW)) };
}

/** The lens now (render.ts sets it on a resize, view.ts places the 2.5D camera by it). */
export const LENS = { k: 1, pitch: LENS_PITCH[1] as number };
