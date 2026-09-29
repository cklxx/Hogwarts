import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CreatureKind } from '../src/shared/constants';
import { makeCreature } from './models';
import { rimLit } from './textures';

/**
 * Far creatures as statues: one instanced mesh per kind, baked from the kind's own model in a resting
 * pose (every part merged, painted with its material's colour). Beyond the animation distance a creature's
 * parts no longer move anyway, so this looks the same from there and costs one draw call per kind for all
 * of them, instead of 3-10 per creature. Fill between begin() and end() every frame.
 */
export function createHerd(scene: THREE.Scene, max = 512) {
  const kinds = new Map<CreatureKind, { mesh: THREE.InstancedMesh; n: number }>();
  const mat = rimLit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide }) /* (mirrored parts, open cones) */);
  const c = new THREE.Color();

  function bake(kind: CreatureKind) {
    const sample = makeCreature(kind);
    sample.anim(0);
    sample.root.updateMatrixWorld(true);
    const parts: THREE.BufferGeometry[] = [];
    sample.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !o.visible || Array.isArray(m.material)) return;
      const src = m.material as THREE.MeshStandardMaterial;
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      g.applyMatrix4(m.matrixWorld);
      // its colour, lifted by any glow it had (a phoenix still reads as fire from afar)
      c.copy(src.color ?? c.set(0xffffff));
      if (src.emissive) c.add(src.emissive.clone().multiplyScalar(Math.min(1, (src.emissiveIntensity ?? 1) * 0.3)));
      const n = g.getAttribute('position').count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = Math.min(1, c.r); a[i * 3 + 1] = Math.min(1, c.g); a[i * 3 + 2] = Math.min(1, c.b); }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      parts.push(g);
    });
    const geo = parts.length ? mergeGeometries(parts) : null;
    for (const p of parts) p.dispose();
    const mesh = new THREE.InstancedMesh(geo ?? new THREE.BufferGeometry(), mat, max);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.count = 0;
    mesh.name = `herd:${kind}`;
    scene.add(mesh);
    const e = { mesh, n: 0 };
    kinds.set(kind, e);
    return e;
  }

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  return {
    begin() { for (const e of kinds.values()) e.n = 0; },
    put(kind: CreatureKind, pos: THREE.Vector3, yaw: number) {
      const e = kinds.get(kind) ?? bake(kind);
      if (e.n >= max) return;
      e.mesh.setMatrixAt(e.n++, m.compose(p.copy(pos), q.setFromAxisAngle(up, yaw), one));
    },
    end() {
      for (const e of kinds.values()) {
        e.mesh.count = e.n;
        e.mesh.visible = e.n > 0;
        if (!e.n) continue;
        e.mesh.instanceMatrix.clearUpdateRanges();
        e.mesh.instanceMatrix.addUpdateRange(0, e.n * 16);
        e.mesh.instanceMatrix.needsUpdate = true;
      }
    },
  };
}
