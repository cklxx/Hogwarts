import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';

const T = TSL as unknown as Record<string, any>;
const { Fn, vec2, vec3, float, uniform, dot, mix, fract, sin, floor, smoothstep, distance, screenUV, screenCoordinate, pass, renderOutput } = T;

/**
 * Post-processing as one node graph (three.js RenderPipeline), in as few full-screen passes as it can be:
 *
 *   scene pass (HDR, multisampled) ──► bloom (bright parts only: its threshold keeps sunlit and moonlit
 *   surfaces out, so only windows, candles, lanterns and spells glow; half resolution, 5 mips)
 *        └────────────── + ──► grade (the Minister's tint, saturation; storybook: cool shadows, warm lights,
 *                              paper grain; vignette) ──► tone mapping + sRGB ──► screen
 *
 * The grade, the bloom's composite, tone mapping and the colour-space conversion are one output pass (the
 * old pipeline had a composite, a grade pass and an output pass). 'low' drops the bloom, and anti-aliases
 * with FXAA instead of MSAA when `fxaaAtLow` (a fill-bound GPU saves the multisampled target's bandwidth).
 */
export interface Post {
  pipeline: THREE.RenderPipeline;
  scenePass: any;
  bloom: { strength: { value: number }; radius: { value: number }; threshold: { value: number } };
  grade: { tint: { value: THREE.Color }; saturation: { value: number }; vignette: { value: number } };
  setQuality(q: 'low' | 'high'): void;
  /** MSAA samples of the scene pass (0 or 1 = none). */
  setSamples(n: number): void;
  render(): void;
}

export function createPost(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, storybook: boolean, o: { fxaaAtLow?: boolean } = {}): Post {
  const pipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera, { samples: 4 });
  const color = scenePass.getTextureNode('output');
  const bloomPass = bloom(color, 0.6, 0.45, 1.1);
  const grade = { tint: uniform(new THREE.Color(1, 1, 1)), saturation: uniform(1.08), vignette: uniform(0.32) };

  const h21 = Fn(([p]: any[]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));
  /** The colour grade, in linear HDR before tone mapping (the order the old grade pass ran in). */
  const graded = Fn(([c]: any[]) => {
    const l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    let rgb = mix(vec3(l), c.rgb, grade.saturation).mul(grade.tint);
    if (storybook) {
      // illustrated light: cool violet-blue shadows, warm lights, and a faint paper grain
      const lt = l.div(l.add(1));
      rgb = rgb.mul(mix(vec3(0.9, 0.95, 1.12), vec3(1.05, 1.0, 0.93), smoothstep(0.04, 0.55, lt)));
      const n = h21(floor(screenCoordinate.xy.div(2))).mul(0.6).add(h21(floor(screenCoordinate.xy.div(7)).add(17)).mul(0.4));
      rgb = rgb.mul(float(1).add(n.sub(0.5).mul(0.05)));
    }
    const d = distance(screenUV, vec2(0.5));
    rgb = rgb.mul(float(1).sub(grade.vignette.mul(smoothstep(0.35, 0.85, d))));
    return T.vec4(rgb, c.a);
  });

  let quality: 'low' | 'high' = 'high';
  function build() {
    const low = quality === 'low';
    const hdr = low ? color : color.add(bloomPass);
    const out = graded(hdr);
    if (low && o.fxaaAtLow) {
      // FXAA wants display-referred input: tone map and convert first, then anti-alias
      pipeline.outputColorTransform = false;
      pipeline.outputNode = fxaa(renderOutput(out));
    } else {
      pipeline.outputColorTransform = true;
      pipeline.outputNode = out;
    }
    pipeline.needsUpdate = true;
  }
  build();

  const post: Post = {
    pipeline, scenePass, grade,
    bloom: bloomPass as unknown as Post['bloom'],
    setQuality(q) { if (q !== quality) { quality = q; build(); } },
    setSamples(n) {
      if (scenePass.options.samples === n) return;
      scenePass.options.samples = n;
      scenePass.renderTarget.samples = n;
      scenePass.renderTarget.dispose();
      build();
    },
    render() { pipeline.render(); },
  };
  return post;
}
