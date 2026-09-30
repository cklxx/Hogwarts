/**
 * Render layers. The scene (layer 0) is drawn through the composer at the render scale (dynres.ts); text that must
 * stay sharp — name tags, damage numbers, the veil's signs — is on OVERLAY and drawn afterwards straight onto the
 * canvas at the screen's own resolution (render.ts `render`). Those sprites already ignored depth, so they look the
 * same, only never blurred by a low render scale.
 */
export const OVERLAY = 1;
