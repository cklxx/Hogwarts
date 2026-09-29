import * as THREE from 'three';
import { createBillboards } from './billboards';
import { glowTexture } from './models';

/**
 * Every spell in flight in two draw calls: the white-hot cores as one instanced mesh, and both
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
  const glows = createBillboards(scene, glowTexture(), { max: max * 2, name: 'bolt-glows' });

  const m = new THREE.Matrix4(), c = new THREE.Color(), white = new THREE.Color(0xffffff);
  return {
    update(bolts: Iterable<THREE.Object3D>) {
      let n = 0;
      glows.begin();
      for (const b of bolts) {
        if (n >= max) break;
        cores.setMatrixAt(n++, m.makeTranslation(b.position.x, b.position.y, b.position.z));
        const hex = (b.userData.color as number) ?? 0xffffff;
        glows.put(b.position, c.setHex(hex).lerp(white, 0.3).multiplyScalar(5), 1, 1.0);
        glows.put(b.position, c.setHex(hex).multiplyScalar(1.6), 0.45, 2.4);
      }
      glows.end();
      cores.count = n;
      cores.visible = n > 0;
      if (!n) return;
      cores.instanceMatrix.clearUpdateRanges();
      cores.instanceMatrix.addUpdateRange(0, n * 16);
      cores.instanceMatrix.needsUpdate = true;
    },
  };
}
