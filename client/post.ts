import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * One full-screen pass instead of two: the colour grade (a ShaderPass reading tDiffuse into gl_FragColor)
 * run inside the OutputPass, just before its tone mapping and sRGB conversion — the same order as a grade
 * pass followed by the output pass, minus a read and a write of the whole HDR frame. The grade keeps its
 * uniform objects, so code that sets `grade.uniforms.x.value` still drives it.
 */
export function gradedOutputPass(grade: ShaderPass): OutputPass {
  const out = new OutputPass();
  const src = grade.material.fragmentShader
    .replace(/uniform\s+sampler2D\s+tDiffuse\s*;/, '')
    .replace(/varying\s+vec2\s+vUv\s*;/, '')
    .replace(/\bvoid\s+main\s*\(\s*\)/, 'void gradeMain()')
    .replace(/\bgl_FragColor\b/g, 'gradeOut');
  const m = out.material;
  const at = 'void main() {';
  if (!m.fragmentShader.includes(at) || !m.fragmentShader.includes('gl_FragColor = texture2D( tDiffuse, vUv );')) return out; // three changed: grade stays its own pass (caller checks)
  m.fragmentShader = m.fragmentShader
    .replace(at, `vec4 gradeOut;\n${src}\n${at}`)
    .replace('gl_FragColor = texture2D( tDiffuse, vUv );', 'gradeMain();\n\t\t\tgl_FragColor = gradeOut;');
  for (const [k, v] of Object.entries(grade.uniforms)) if (k !== 'tDiffuse') out.uniforms[k] = v;
  (out as OutputPass & { graded?: boolean }).graded = true;
  return out;
}
