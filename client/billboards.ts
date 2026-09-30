import * as THREE from 'three';

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
  const ATTRS = [iPos, iCol, iSize];
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: map } }]),
    transparent: true, depthWrite: false, blending: o.blending ?? THREE.AdditiveBlending, fog: true,
    vertexShader: `attribute vec3 iPos; attribute vec4 iCol; attribute vec2 iSize; varying vec2 vUv; varying vec4 vCol;
      #include <fog_pars_vertex>
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4( iPos, 1.0 );
        mvPosition.xy += position.xy * iSize;
        vUv = uv; vCol = iCol;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform sampler2D map; varying vec2 vUv; varying vec4 vCol;
      #include <fog_pars_fragment>
      void main() {
        vec4 t = texture2D( map, vUv );
        gl_FragColor = vec4( vCol.rgb * t.rgb, vCol.a * t.a );
        #include <fog_fragment>
      }`,
  });
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
      for (let i = 0; i < ATTRS.length; i++) { const a = ATTRS[i]; a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); a.needsUpdate = true; }
    },
  };
}
