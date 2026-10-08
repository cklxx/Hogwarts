/** Visible rendered-frame intervals, including slow frames. Background transitions start a fresh window. */
export class FrameMetrics {
  private intervals: number[] = [];
  private last: number | undefined;
  reset() { this.intervals.length = 0; this.last = undefined; }
  frame(now: number, visible: boolean) {
    if (!visible) { this.reset(); return; }
    if (this.last !== undefined && now > this.last && this.intervals.length < 4000) this.intervals.push(now - this.last);
    this.last = now;
  }
  take() {
    const values = this.intervals.splice(0);
    if (values.length < 2) return null;
    const seconds = values.reduce((a, b) => a + b, 0) / 1000;
    values.sort((a, b) => a - b);
    const at = (p: number) => values[Math.min(values.length - 1, Math.floor(p * values.length))];
    return { p50: at(.5), p95: at(.95), samples: values.length, seconds };
  }
}

/** Browsers can hide this extension. A generic renderer name is not evidence of a hardware GPU. */
export function rendererName(gl: WebGLRenderingContext | WebGL2RenderingContext) {
  try {
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) ?? '');
  } catch { return ''; }
}
