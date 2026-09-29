import * as THREE from 'three';
import { glowTexture } from './models';

/**
 * Every spell in flight in three draw calls: the white-hot cores as one instanced mesh, and both
 * element-coloured glows of every bolt as instanced camera-facing quads (they were two sprites and a
 * sphere per bolt: a duel of 40 bolts was 120 draw calls). Same sizes, colours and additive blending as
 * the sprites they replace (models.ts makeBolt). The per-bolt Object3D (position, colour, the Rooting
 * ring) stays in main.ts; `update` copies them in every frame.
 */
export function createBoltBatch(scene: THREE.Scene, max = 1024) {
  const cores = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(8) }), max);
  cores.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  cores.frustumCulled = false;
  cores.count = 0;
  cores.name = 'bolt-cores';
  scene.add(cores);

  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  geo.setAttribute('uv', quad.getAttribute('uv'));
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const iCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 2 * 4), 4).setUsage(THREE.DynamicDrawUsage); // rgb, alpha
  const iSize = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', iPos);
  geo.setAttribute('iCol', iCol);
  geo.setAttribute('iSize', iSize);
  geo.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: glowTexture() } }]),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
    vertexShader: `attribute vec3 iPos; attribute vec4 iCol; attribute float iSize; varying vec2 vUv; varying vec4 vCol;
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
  const glows = new THREE.Mesh(geo, mat);
  glows.frustumCulled = false;
  glows.name = 'bolt-glows';
  scene.add(glows);

  const m = new THREE.Matrix4(), c = new THREE.Color(), white = new THREE.Color(0xffffff);
  const put = (i: number, p: THREE.Vector3, col: THREE.Color, a: number, size: number) => {
    iPos.setXYZ(i, p.x, p.y, p.z);
    iCol.setXYZW(i, col.r, col.g, col.b, a);
    iSize.setX(i, size);
  };
  return {
    update(bolts: Iterable<THREE.Object3D>) {
      let n = 0;
      for (const b of bolts) {
        if (n >= max) break;
        cores.setMatrixAt(n, m.makeTranslation(b.position.x, b.position.y, b.position.z));
        const hex = (b.userData.color as number) ?? 0xffffff;
        put(n * 2, b.position, c.setHex(hex).lerp(white, 0.3).multiplyScalar(5), 1, 1.0);
        put(n * 2 + 1, b.position, c.setHex(hex).multiplyScalar(1.6), 0.45, 2.4);
        n++;
      }
      cores.count = n;
      cores.visible = glows.visible = n > 0;
      geo.instanceCount = n * 2;
      if (!n) return;
      cores.instanceMatrix.clearUpdateRanges();
      cores.instanceMatrix.addUpdateRange(0, n * 16);
      cores.instanceMatrix.needsUpdate = true;
      for (const [a, k] of [[iPos, 6], [iCol, 8], [iSize, 2]] as const) { a.clearUpdateRanges(); a.addUpdateRange(0, n * k); a.needsUpdate = true; }
    },
  };
}
