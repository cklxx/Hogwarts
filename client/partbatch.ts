import * as THREE from 'three';

/**
 * Parts that many animated models share (the same geometry and material: a wizard's legs, jumper, arms, head,
 * hat, wand, their ink outlines — models.ts marks them `userData.batch`) drawn instanced across every model
 * added this frame: one draw call per kind of part instead of one per part per model, in the main pass and
 * the shadow map. In a crowd of 30 wizards that is ~15 draw calls instead of ~300.
 *
 * The parts stay where they are and keep being animated by their model; they only move to a layer the
 * cameras do not draw (`LAYER`), and each frame `add(root)` copies the world matrix of every one of them
 * that is visible into its group's InstancedMesh. `add` wants the root's world matrices current (call
 * root.updateMatrixWorld() after animating it).
 */
export const LAYER = 7;

export function createPartBatcher(scene: THREE.Scene) {
  type Group = { mesh: THREE.InstancedMesh; n: number; idle: number };
  const groups = new Map<string, Group>();
  /** A model's batchable parts, found once. */
  const partsOf = new WeakMap<THREE.Object3D, THREE.Mesh[]>();
  const shown = (o: THREE.Object3D, root: THREE.Object3D) => { for (let x: THREE.Object3D | null = o; x && x !== root.parent; x = x.parent) if (!x.visible) return false; return true; };

  /** Each part's group key, made once (not a new string per part per frame) and again only if the part changes. */
  const keys = new WeakMap<THREE.Mesh, { geo: THREE.BufferGeometry; mat: THREE.Material; flags: number; key: string }>();
  function keyOf(m: THREE.Mesh) {
    const mat = m.material as THREE.Material, flags = (m.castShadow ? 2 : 0) | (m.receiveShadow ? 1 : 0);
    let k = keys.get(m);
    if (!k || k.geo !== m.geometry || k.mat !== mat || k.flags !== flags) keys.set(m, (k = { geo: m.geometry, mat, flags, key: `${m.geometry.uuid}|${mat.uuid}|${flags}` }));
    return k.key;
  }
  function group(m: THREE.Mesh): Group {
    const key = keyOf(m);
    let g = groups.get(key);
    if (!g) {
      g = { mesh: make(m, 16), n: 0, idle: 0 };
      groups.set(key, g);
    }
    if (g.n >= g.mesh.instanceMatrix.count) { // grow
      const bigger = make(m, g.mesh.instanceMatrix.count * 2);
      (bigger.instanceMatrix.array as Float32Array).set(g.mesh.instanceMatrix.array as Float32Array);
      scene.remove(g.mesh);
      g.mesh.dispose();
      g.mesh = bigger;
    }
    return g;
  }
  function make(m: THREE.Mesh, cap: number) {
    const im = new THREE.InstancedMesh(m.geometry, m.material, cap);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.castShadow = m.castShadow;
    im.receiveShadow = m.receiveShadow;
    im.frustumCulled = false; // (near models only, around the camera)
    im.count = 0;
    im.name = 'parts';
    scene.add(im);
    return im;
  }

  return {
    begin() { groups.forEach((g) => { g.n = 0; }); },
    /** Draw this model's shared parts instanced this frame (instead of one by one). */
    add(root: THREE.Object3D) {
      let parts = partsOf.get(root);
      if (!parts) {
        parts = [];
        root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.userData.batch) { o.layers.set(LAYER); parts!.push(o as THREE.Mesh); } });
        partsOf.set(root, parts);
      }
      for (let i = 0; i < parts.length; i++) {
        const m = parts[i];
        if (!shown(m, root)) continue;
        const g = group(m);
        g.mesh.setMatrixAt(g.n++, m.matrixWorld);
      }
    },
    end() {
      groups.forEach((g, k) => {
        const im = g.mesh;
        im.count = g.n;
        im.visible = g.n > 0;
        if (g.n) {
          g.idle = 0;
          // the whole (small: at most twice what is used) buffer, not a range: addUpdateRange allocates per call
          im.instanceMatrix.needsUpdate = true;
        } else if (++g.idle > 600) { scene.remove(im); im.dispose(); groups.delete(k); } // (a look nobody wears any more)
      });
    },
  };
}
