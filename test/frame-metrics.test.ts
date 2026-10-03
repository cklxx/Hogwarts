import { describe, expect, it } from 'vitest';
import { FrameMetrics, rendererName } from '../client/frame-metrics';
import { frameLabel } from '../scripts/playtest/frame-label';

describe('visible frame telemetry', () => {
  it('reports a slow 1fps window rather than dropping it for fewer than 30 samples', () => {
    const m = new FrameMetrics();
    for(let t=0;t<=15000;t+=1000)m.frame(t,true);
    expect(m.take()).toEqual({p50:1000,p95:1000,samples:15,seconds:15});
  });
  it('keeps visible stalls in the tail instead of measuring the clamped animation delta', () => {
    const m = new FrameMetrics();
    for(const t of [0,16,32,48,1048])m.frame(t,true);
    expect(m.take()).toMatchObject({p50:16,p95:1000,samples:4});
  });
  it('excludes time spent hidden, even when no background frames run', () => {
    const m = new FrameMetrics();m.frame(0,true);m.frame(16,true);
    m.reset(); // visibilitychange: browsers may suspend requestAnimationFrame entirely
    m.frame(120000,true);m.frame(120016,true);m.frame(120032,true);
    expect(m.take()).toEqual({p50:16,p95:16,samples:2,seconds:.032});
  });
  it('does not retain background frames or fabricate a report without enough samples', () => {
    const m = new FrameMetrics();m.frame(0,true);m.frame(1000,false);m.frame(2000,false);
    expect(m.take()).toBeNull();m.frame(3000,true);m.frame(3016,true);
    expect(m.take()).toBeNull();
  });
  it('drains each report without counting the report timer as an extra frame', () => {
    const m = new FrameMetrics();for(const t of [0,20,40])m.frame(t,true);
    expect(m.take()?.samples).toBe(2);expect(m.take()).toBeNull();
    for(const t of [60,80])m.frame(t,true);
    expect(m.take()).toEqual({p50:20,p95:20,samples:2,seconds:.04});
  });
});

describe('renderer evidence and report wording', () => {
  const gl = (debug: boolean) => ({RENDERER:1,getExtension:()=>debug?{UNMASKED_RENDERER_WEBGL:2}:null,
    getParameter:(p:number)=>p===2?'ANGLE (SwiftShader Device)':'WebKit WebGL'}) as unknown as WebGLRenderingContext;
  it('uses available renderer evidence and labels software rendering explicitly', () => {
    const gpu=rendererName(gl(true));expect(gpu).toContain('SwiftShader');
    expect(frameLabel({p50:1000,p95:1400,scale:1,q:'low',dpr:1,gpu,samples:15,seconds:15})).toContain('软件渲染');
  });
  it('does not infer a GPU or a sample duration from a masked legacy report', () => {
    const gpu=rendererName(gl(false));
    const label=frameLabel({p50:16,p95:32,scale:1,q:'high',dpr:2,gpu});
    expect(label).toContain('硬件信息不可用');expect(label).toContain('样本数/时长未记录');
    expect(label).toContain('p50 16 / p95 32 ms');expect(label).not.toContain('fps');
  });
});
