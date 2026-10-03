import * as THREE from 'three';
import type { ClientFeatureFactory } from './feature';
import { encounterById } from '../src/shared/encounters';
import { ICE_CELL, ICE_Y, overWater } from '../src/shared/ice';

/**
 * 冰路 in the browser (src/shared/ice.ts; the kernel's src/kernel/ice.ts): the frozen squares of the Black Lake as one
 * instanced mesh (one draw call however long the road), rewritten only when the snapshot's `ice` changes; a square
 * with under ICE_FADE s left thins as it melts. And the lake encounter's float out in the middle (a raft, a gold ring).
 * Whoever stands over the water stands on the ice (`ground`: the lake bed is 5 m down, and nobody walks there else).
 */
const MAX = 600, ICE_FADE = 4;

export const iceFeature: ClientFeatureFactory = (d) => {
  const group = new THREE.Group();
  group.name = 'ice';
  const tiles = new THREE.InstancedMesh(
    new THREE.BoxGeometry(ICE_CELL * 0.98, 0.16, ICE_CELL * 0.98),
    new THREE.MeshStandardMaterial({ color: 0xe4f6ff, roughness: 0.2, emissive: 0x9fd8ff, emissiveIntensity: 0.18, transparent: true, opacity: 0.9 }),
    MAX,
  );
  tiles.name = 'ice:tiles'; tiles.count = 0; tiles.frustumCulled = false; tiles.receiveShadow = true;
  group.add(tiles);
  // the float
  const lake = encounterById('lake')!;
  const float = new THREE.Group();
  float.name = 'ice:float';
  const raft = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.25, 10), new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.9 }));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.07, 6, 28).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  const flag = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.9, 6), new THREE.MeshStandardMaterial({ color: 0x2f8f6a, emissive: 0x1a5a40, emissiveIntensity: 0.4 }));
  raft.position.y = 0.1; ring.position.y = 0.25; flag.position.y = 0.8;
  float.add(raft, ring, flag);
  float.position.set(lake.x, 0.05, lake.z);
  group.add(float);

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
  let sig: unknown = null, t = 0;
  return {
    id: 'ice',
    group,
    ground: (x, z, h) => (h < ICE_Y && overWater(x, z) ? ICE_Y : h),
    frame(dt) {
      t += dt;
      float.position.y = 0.05 + Math.sin(t * 1.6) * 0.06;
      ring.scale.setScalar(1 + 0.06 * Math.sin(t * 3));
      const w = d.wire<number[]>('ice');
      if (w === sig) return;
      sig = w;
      const n = Math.min(MAX, Math.floor((w?.length ?? 0) / 3));
      for (let k = 0; k < n; k++) {
        const i = w![k * 3], j = w![k * 3 + 1], left = w![k * 3 + 2];
        const f = Math.min(1, left / ICE_FADE);
        v.set((i + 0.5) * ICE_CELL, ICE_Y - 0.08, (j + 0.5) * ICE_CELL);
        s.set(0.55 + 0.45 * f, 1, 0.55 + 0.45 * f);
        tiles.setMatrixAt(k, m4.compose(v, q, s));
      }
      tiles.count = n;
      tiles.instanceMatrix.needsUpdate = true;
    },
  };
};
