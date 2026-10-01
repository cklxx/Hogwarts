import * as THREE from 'three';
import type { ClientFeatureFactory } from './feature';
import { L } from './i18n';
import { painted } from './models';
import { heightAt } from './terrain';
import { LOOT, type LootKind } from '../src/shared/loot';

/**
 * 掉落 in the browser (src/shared/loot.ts; the kernel's src/kernel/loot.ts): what lies on the ground round you (your
 * `me.loot`: [id, kind index, x, z, …]) as one instanced mesh per kind, bobbing and turning, each with a glint; a
 * pickup (the `loot` fx) floats what it gave. A new one pops up out of the ground over its first half second.
 */
const KINDS = Object.keys(LOOT) as LootKind[];
const MAX = 64;
const at = <T extends THREE.BufferGeometry>(g: T, x: number, y: number, z: number) => g.translate(x, y, z);
function body(k: LootKind): THREE.BufferGeometry {
  switch (k) {
    case 'coin': return painted([[at(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 14).rotateX(Math.PI / 2), 0, 0, 0), 0xf2c230]]);
    case 'mana': return painted([[at(new THREE.OctahedronGeometry(0.2).scale(0.8, 1.3, 0.8), 0, 0, 0), 0x4f8cff]]);
    case 'heart': return painted([[at(new THREE.SphereGeometry(0.13, 8, 6), -0.09, 0.05, 0), 0xe0384a], [at(new THREE.SphereGeometry(0.13, 8, 6), 0.09, 0.05, 0), 0xe0384a], [at(new THREE.ConeGeometry(0.2, 0.26, 8).rotateZ(Math.PI), 0, -0.1, 0), 0xe0384a]]);
    case 'potion': return painted([[at(new THREE.SphereGeometry(0.17, 10, 8), 0, -0.05, 0), 0x52d16a], [at(new THREE.CylinderGeometry(0.05, 0.06, 0.16, 6), 0, 0.15, 0), 0xd8e8f0], [at(new THREE.CylinderGeometry(0.055, 0.055, 0.05, 6), 0, 0.25, 0), 0x7a5230]]);
  }
}
const GLINT: Record<LootKind, number> = { coin: 0xffd36a, mana: 0x7fb0ff, heart: 0xff7a8a, potion: 0x8cff9a };

export const lootFeature: ClientFeatureFactory = (d) => {
  const group = new THREE.Group();
  group.name = 'loot';
  const meshes = new Map<LootKind, THREE.InstancedMesh>(), glints = new Map<LootKind, THREE.InstancedMesh>();
  for (const k of KINDS) {
    const m = new THREE.InstancedMesh(body(k), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: k === 'coin' ? 0.6 : 0, emissive: GLINT[k], emissiveIntensity: 0.35 }), MAX);
    m.count = 0; m.frustumCulled = false; m.castShadow = true; m.name = `loot:${k}`;
    const g = new THREE.InstancedMesh(new THREE.RingGeometry(0.28, 0.42, 18).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: GLINT[k], transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }), MAX);
    g.count = 0; g.frustumCulled = false; g.name = `loot:${k}:glint`;
    group.add(m, g); meshes.set(k, m); glints.set(k, g);
  }
  const born = new Map<number, number>();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
  let t = 0;
  return {
    id: 'loot',
    group,
    frame(dt) {
      t += dt;
      const w = (d.me()?.loot ?? null) as number[] | null;
      const n: Record<string, number> = {};
      for (const k of KINDS) n[k] = 0;
      const seen = new Set<number>();
      for (let i = 0; w && i + 3 < w.length; i += 4) {
        const id = w[i], k = KINDS[w[i + 1]], x = w[i + 2], z = w[i + 3];
        if (!k || n[k] >= MAX) continue;
        seen.add(id);
        if (!born.has(id)) born.set(id, t);
        const age = Math.min(1, (t - born.get(id)!) / 0.5), y = heightAt(x, z);
        const bob = 0.55 + 0.12 * Math.sin(t * 3 + id) + (1 - age) * -0.4;
        v.set(x, y + bob, z); s.setScalar(1.3 * (0.4 + 0.6 * age));
        meshes.get(k)!.setMatrixAt(n[k], m4.compose(v, q.setFromEuler(e.set(0, t * 2.2 + id, 0)), s));
        v.set(x, y + 0.05, z); s.setScalar(1 + 0.15 * Math.sin(t * 4 + id));
        glints.get(k)!.setMatrixAt(n[k], m4.compose(v, q.identity(), s));
        n[k]++;
      }
      for (const k of KINDS) {
        const m = meshes.get(k)!, g = glints.get(k)!;
        if (m.count === 0 && n[k] === 0) continue;
        m.count = g.count = n[k];
        m.instanceMatrix.needsUpdate = g.instanceMatrix.needsUpdate = true;
      }
      for (const id of born.keys()) if (!seen.has(id)) born.delete(id);
    },
    fx(f) {
      if (f.k !== 'loot' || !f.h) return;
      const k = f.h as LootKind, def = LOOT[k];
      if (!def) return;
      const what = k === 'coin' ? L(`+${f.n ?? 0} 加隆`, `+${f.n ?? 0} galleon`) : k === 'mana' ? L(`+${f.n ?? 0} 魔力`, `+${f.n ?? 0} mana`) : k === 'heart' ? L(`+${f.n ?? 0} 生命`, `+${f.n ?? 0} health`) : L('药水！', 'Potion!');
      d.floatText(f.x, f.z, (f.n ?? 0) > 0 || k === 'potion' ? what : L(`${def.zh}已满`, `${def.en}: full`), `#${GLINT[k].toString(16).padStart(6, '0')}`, 1.4);
    },
  };
};
