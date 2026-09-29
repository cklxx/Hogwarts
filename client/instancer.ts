import * as THREE from 'three';
import { createBillboards } from './billboards';

/**
 * Draw many alike objects that something else animates (the Great Hall's floating candles: a candle and its
 * glow each, bobbed by scene.ts) instanced: one draw call per shared geometry and material, one for all
 * their sprites. The originals stay in the scene, hidden, and keep being moved by whoever moves them; each
 * frame `update` copies their world transforms into the instances. Nothing about how they look changes.
 */
export function instanceAlike(scene: THREE.Scene, roots: THREE.Object3D[]) {
  const meshes = new Map<string, THREE.Mesh[]>();
  const sprites = new Map<THREE.SpriteMaterial, THREE.Sprite[]>();
  for (const r of roots) r.traverse((o) => {
    const m = o as THREE.Mesh;
    if ((o as THREE.Sprite).isSprite) {
      const mat = (o as THREE.Sprite).material;
      if (!sprites.has(mat)) sprites.set(mat, []);
      sprites.get(mat)!.push(o as THREE.Sprite);
    } else if (m.isMesh && !Array.isArray(m.material) && !(m as THREE.InstancedMesh).isInstancedMesh) {
      const k = `${m.geometry.uuid}|${(m.material as THREE.Material).uuid}|${m.castShadow}|${m.receiveShadow}`;
      if (!meshes.has(k)) meshes.set(k, []);
      meshes.get(k)!.push(m);
    }
  });
  const batches: { list: THREE.Mesh[]; inst: THREE.InstancedMesh }[] = [];
  for (const list of meshes.values()) {
    if (list.length < 2) continue;
    const src = list[0];
    const inst = new THREE.InstancedMesh(src.geometry, src.material, list.length);
    inst.castShadow = src.castShadow;
    inst.receiveShadow = src.receiveShadow;
    inst.name = `inst:${roots[0]?.name ?? ''}`;
    scene.add(inst);
    for (const m of list) m.visible = false;
    batches.push({ list, inst });
  }
  const glows: { list: THREE.Sprite[]; bb: ReturnType<typeof createBillboards>; mat: THREE.SpriteMaterial }[] = [];
  for (const [mat, list] of sprites) {
    if (list.length < 2 || !mat.map) continue;
    glows.push({ list, mat, bb: createBillboards(scene, mat.map, { max: list.length, blending: mat.blending, name: `glow:${roots[0]?.name ?? ''}` }) });
    for (const s of list) s.visible = false;
  }
  const p = new THREE.Vector3(), c = new THREE.Color();
  const shown = (o: THREE.Object3D) => { for (let x = o.parent; x; x = x.parent) if (!x.visible) return false; return true; };
  return {
    update() {
      for (const r of roots) r.updateMatrixWorld();
      for (const { list, inst } of batches) {
        let n = 0;
        for (const m of list) if (shown(m)) inst.setMatrixAt(n++, m.matrixWorld);
        inst.count = n;
        inst.instanceMatrix.needsUpdate = true;
        if (!inst.boundingSphere) inst.computeBoundingSphere(); // (they bob by centimetres: the first bounds hold)
      }
      for (const { list, bb, mat } of glows) {
        bb.begin();
        c.copy(mat.color);
        for (const s of list) {
          if (!shown(s)) continue;
          s.getWorldPosition(p);
          bb.put(p, c, mat.opacity, s.scale.x, s.scale.y);
        }
        bb.end();
      }
    },
  };
}
