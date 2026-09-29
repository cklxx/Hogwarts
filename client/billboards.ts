import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

const T = TSL as unknown as Record<string, any>;
const { Fn, vec4, attribute, texture, uv, positionLocal, cameraWorldMatrix } = T;

/** The world-space corner of a camera-facing quad: `centre` plus the quad's own corner along the camera's right and up. */
export const facingCorner = Fn(([centre, sx, sy]: any[]) => {
  const right = cameraWorldMatrix.element(0).xyz, up = cameraWorldMatrix.element(1).xyz;
  return centre.add(right.mul(positionLocal.x.mul(sx))).add(up.mul(positionLocal.y.mul(sy)));
});

/**
 * Many camera-facing textured quads in one draw call: what a Sprite per glow used to cost one draw call
 * each for. Each quad has a centre, a colour (HDR allowed), an alpha and a size in metres, exactly like a
 * SpriteMaterial sprite with that map, colour, opacity and scale (the texture's rgb times the colour, its
 * alpha times the alpha), fogged like one. Fill between begin() and end() every frame.
 */
export function createBillboards(scene: THREE.Scene, map: THREE.Texture, o: { max?: number; blending?: THREE.Blending; name?: string } = {}) {
  const max = o.max ?? 1024;
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  geo.setAttribute('uv', quad.getAttribute('uv'));
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const iCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const iSize = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', iPos);
  geo.setAttribute('iCol', iCol);
  geo.setAttribute('iSize', iSize);
  geo.instanceCount = 0;
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: o.blending ?? THREE.AdditiveBlending, fog: true });
  mat.userData.noFade = true;
  // (turned to the camera in world space, not in view space, so the fog sees where the quad really is)
  const size = attribute('iSize', 'vec2');
  mat.positionNode = facingCorner(attribute('iPos', 'vec3'), size.x, size.y);
  const col = attribute('iCol', 'vec4'), t = texture(map, uv());
  mat.colorNode = vec4(col.rgb.mul(t.rgb), col.a.mul(t.a));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.name = o.name ?? 'billboards';
  scene.add(mesh);
  let n = 0;
  return {
    mesh,
    begin() { n = 0; },
    put(p: THREE.Vector3, c: THREE.Color, alpha: number, sx: number, sy = sx) {
      if (n >= max) return;
      iPos.setXYZ(n, p.x, p.y, p.z);
      iCol.setXYZW(n, c.r, c.g, c.b, alpha);
      iSize.setXY(n, sx, sy);
      n++;
    },
    end() {
      geo.instanceCount = n;
      mesh.visible = n > 0;
      if (!n) return;
      for (const [a, k] of [[iPos, 3], [iCol, 4], [iSize, 2]] as const) { a.clearUpdateRanges(); a.addUpdateRange(0, n * k); a.needsUpdate = true; }
    },
  };
}
