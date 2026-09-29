import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Static batching: merge the world's meshes that never move, never hide and never change geometry into one
 * mesh per material (per shadow flags, per 64 m cell so frustum culling still works), baked in world space.
 * Hundreds of castle walls, towers, roofs, huts, fences and props become a few dozen draw calls, in the main
 * pass and in the shadow map alike.
 *
 * What is static is *measured*, not listed: `exercise` runs the world's own animation (its tick at several
 * times, hours and player positions, a quality switch) and every mesh whose world matrix, visibility,
 * geometry or material changed stays as it is. So a clock hand, the squid, the Willow's arms, the Great
 * Hall's roof (hidden from inside), bobbing candles or a quality-dependent frame are never frozen, and a
 * new animated prop added later is left alone without anyone having to tell this code about it. Materials
 * are kept (the merged mesh uses the very same material object), so anything animated through a material —
 * night glow, banners' colours, wind in a vertex shader — keeps working.
 */
export function mergeStatic(scene: THREE.Scene, roots: Iterable<THREE.Object3D>, exercise: (step: () => void) => void, opts: { exclude?: Iterable<THREE.Object3D>; cell?: number } = {}) {
  const cell = opts.cell ?? 64;
  const excluded = new Set(opts.exclude ?? []);
  const plainBefore = THREE.Object3D.prototype.onBeforeRender;
  const cands: THREE.Mesh[] = [];
  const skip = (o: THREE.Object3D) => {
    for (let x: THREE.Object3D | null = o; x; x = x.parent) if (excluded.has(x)) return true;
    return false;
  };
  for (const r of roots) r.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || (m as unknown as { isBatchedMesh?: boolean }).isBatchedMesh) return;
    if (Array.isArray(m.material) || m.children.length || m.onBeforeRender !== plainBefore || m.customDepthMaterial || m.customDistanceMaterial) return;
    const g = m.geometry;
    // (groups only matter with an array of materials, excluded above: a Box's six are drawn as one anyway)
    if (!g || Object.keys(g.morphAttributes).length || !g.getAttribute('position')) return;
    if (Object.values(g.attributes).some((a) => (a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute)) return;
    if ((m.material as THREE.Material).transparent) return; // (merging would change how they sort)
    if (skip(m)) return;
    cands.push(m);
  });

  // what every candidate looks like now, and whether the world's own animation ever changes it
  const shown = (o: THREE.Object3D) => { for (let x: THREE.Object3D | null = o; x; x = x.parent) if (!x.visible) return false; return true; };
  const state = (m: THREE.Mesh) => ({ mw: m.matrixWorld.clone(), vis: shown(m), g: m.geometry, mat: m.material });
  scene.updateMatrixWorld(true);
  const first = new Map(cands.map((m) => [m, state(m)]));
  const moving = new Set<THREE.Mesh>();
  exercise(() => {
    scene.updateMatrixWorld(true);
    for (const [m, s] of first) {
      if (moving.has(m)) continue;
      if (shown(m) !== s.vis || m.geometry !== s.g || m.material !== s.mat || !m.matrixWorld.equals(s.mw)) moving.add(m);
    }
  });
  scene.updateMatrixWorld(true);

  // group what stayed put (and is visible) by everything a draw call depends on
  const groups = new Map<string, THREE.Mesh[]>();
  const box = new THREE.Box3(), c = new THREE.Vector3();
  for (const m of cands) {
    if (moving.has(m) || !shown(m)) continue;
    const g = m.geometry;
    const attrs = Object.keys(g.attributes).sort().map((k) => { const a = g.getAttribute(k); return `${k}${a.itemSize}${a.normalized ? 'n' : ''}${(a.array as ArrayLike<number>).constructor.name}`; }).join(',') + (g.index ? `|i${(g.index.array as ArrayLike<number>).constructor.name}` : '');
    box.setFromObject(m).getCenter(c);
    const key = [(m.material as THREE.Material).uuid, attrs, m.castShadow, m.receiveShadow, m.renderOrder, m.frustumCulled, m.layers.mask, Math.floor(c.x / cell), Math.floor(c.z / cell)].join('|');
    let l = groups.get(key);
    if (!l) groups.set(key, (l = []));
    l.push(m);
  }

  let merged = 0, meshes = 0;
  const out = new THREE.Group();
  out.name = 'static-batches';
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const indexed = list.every((m) => m.geometry.index);
    const geos = list.map((m) => {
      let g = m.geometry.clone();
      g.clearGroups();
      if (!indexed && g.index) g = g.toNonIndexed();
      g.applyMatrix4(m.matrixWorld);
      // a mirrored transform flips the winding: flip it back so the faces keep facing out
      if (m.matrixWorld.determinant() < 0) flipWinding(g);
      return g;
    });
    const geo = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!geo) continue;
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    const src = list[0];
    const mesh = new THREE.Mesh(geo, src.material);
    mesh.castShadow = src.castShadow;
    mesh.receiveShadow = src.receiveShadow;
    mesh.renderOrder = src.renderOrder;
    mesh.layers.mask = src.layers.mask;
    mesh.matrixAutoUpdate = false;
    mesh.name = 'batch';
    out.add(mesh);
    for (const m of list) m.removeFromParent();
    merged += list.length;
    meshes++;
  }
  scene.add(out);
  return { candidates: cands.length, moving: moving.size, merged, meshes, group: out };
}

function flipWinding(g: THREE.BufferGeometry) {
  if (g.index) {
    const a = g.index.array as Uint16Array | Uint32Array;
    for (let i = 0; i + 2 < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
    g.index.needsUpdate = true;
    return;
  }
  for (const k of Object.keys(g.attributes)) {
    const at = g.getAttribute(k) as THREE.BufferAttribute;
    const n = at.itemSize, arr = at.array as Float32Array;
    for (let i = 0; i + 2 < at.count; i += 3) for (let j = 0; j < n; j++) {
      const t = arr[(i + 1) * n + j]; arr[(i + 1) * n + j] = arr[(i + 2) * n + j]; arr[(i + 2) * n + j] = t;
    }
    at.needsUpdate = true;
  }
}
