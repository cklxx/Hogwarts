import type { PlayerMetrics } from '../../src/kernel/metrics.js';

/** Frame pacing includes browser/CPU/GPU work; it is not a GPU timer or a sustained average FPS. */
export function frameLabel(f: NonNullable<PlayerMetrics['fps']>) {
  const renderer = /swiftshader|llvmpipe|softpipe|software/i.test(f.gpu) ? '软件渲染'
    : !f.gpu || /^(WebKit WebGL|WebGL|ANGLE)$/i.test(f.gpu) ? '硬件信息不可用' : '渲染器';
  const sample = f.samples === undefined || f.seconds === undefined ? '样本数/时长未记录'
    : `${f.samples} 个间隔 / ${f.seconds}s`;
  return `帧间隔 p50 ${f.p50} / p95 ${f.p95} ms（${sample}，3D ${f.scale}x ${f.q}，DPR ${f.dpr}，${renderer}${f.gpu ? `：${f.gpu.replace(/\|/g, '\\|')}` : ''}）`;
}
