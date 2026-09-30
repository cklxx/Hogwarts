import * as THREE from 'three';
import { L } from './i18n';
import { heightAt } from './terrain';
import type { ClientFeatureFactory } from './feature';
import { REACTIONS, WET_ZONES, type ReactionId } from '../src/shared/chem';

/**
 * 魔法化学 in the browser (src/shared/chem.ts; the kernel's src/kernel/chem.ts): a reaction's name springs up over its
 * target with a burst, a jolt and a hit-stop (the weight of a combo); the wet drip (three drops circling the head)
 * and the frozen stand in a shell of ice; the south lawn's fountain, whose dew keeps the first pixies wet.
 */

/** Each reaction's colour (its element's, or water's). */
const COLOR: Record<ReactionId, [string, number]> = {
  soak: ['#8fd0ff', 0x8fd0ff], vaporize: ['#ffffff', 0xf2f2f2], freeze: ['#bff0ff', 0xbff0ff], conduct: ['#ffe36a', 0xffe36a],
  slip: ['#c8b0ff', 0xc8b0ff], rainbow: ['#ffb3e0', 0xffb3e0], shatter: ['#e0faff', 0xe0faff], melt: ['#ffb070', 0xffb070],
  overload: ['#ff8a3a', 0xff8a3a], douse: ['#9fd8ff', 0x9fd8ff],
};
/** How hard each lands (a jolt of the camera, seconds of hit-stop). */
const WEIGHT: Partial<Record<ReactionId, [number, number]>> = { soak: [0.04, 0.03], shatter: [0.3, 0.11], overload: [0.32, 0.1], conduct: [0.22, 0.08], vaporize: [0.2, 0.08] };

function fountain() {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0xa8a294, roughness: 0.9 });
  const water = new THREE.MeshStandardMaterial({ color: 0x5aa0d8, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 });
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.8, 0.6, 24, 1, true), stone);
  rim.position.y = 0.3;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(2.55, 24).rotateX(-Math.PI / 2), water);
  floor.position.y = 0.45;
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 1.8, 10), stone);
  pillar.position.y = 0.9;
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.35, 0.3, 14), stone);
  bowl.position.y = 1.85;
  for (const m of [rim, pillar, bowl]) { m.castShadow = true; m.receiveShadow = true; }
  g.add(rim, floor, pillar, bowl);
  // the spray: drops thrown up from the bowl and falling back into the pool
  const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 6, 4), new THREE.MeshBasicMaterial({ color: 0xcfeaff, transparent: true, opacity: 0.8 }), 36);
  drops.frustumCulled = false;
  g.add(drops);
  return { g, drops };
}

export const chemFeature: ClientFeatureFactory = (d) => {
  const group = new THREE.Group();
  group.name = 'chem';
  const lawn = WET_ZONES.find((z) => z.id === 'lawn')!;
  const f = fountain();
  f.g.position.set(lawn.x, heightAt(lawn.x, lawn.z), lawn.z);
  group.add(f.g);
  // the wet: three drops each (a pool of markers), the frozen: a shell of ice
  const N = 24;
  const drip = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 6, 4).scale(0.8, 1.3, 0.8), new THREE.MeshBasicMaterial({ color: 0x7cc4ff }), N * 3);
  const ice = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.9, 0).scale(1, 1.4, 1), new THREE.MeshStandardMaterial({ color: 0xcff4ff, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.55, depthWrite: false }), N);
  for (const m of [drip, ice]) { m.frustumCulled = false; m.count = 0; group.add(m); }
  const m4 = new THREE.Matrix4(), v = new THREE.Vector3(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  let t = 0;
  return {
    id: 'chem',
    group,
    fx(x) {
      if (x.k !== 'react' || !x.h || !(x.h in REACTIONS)) return;
      const r = x.h as ReactionId, def = REACTIONS[r], [css, hex] = COLOR[r], [jolt, stop] = WEIGHT[r] ?? [0.16, 0.07];
      d.floatText(x.x, x.z, L(`${def.zh}！`, `${def.en}!`), css, 1.1);
      d.sparks(x.x, x.z, hex, r === 'soak' ? 18 : 44);
      // (a reaction close to you lands on you: the jolt and the stop; far off, only the name)
      const me = d.myPos();
      if (me && Math.hypot(me.x - x.x, me.z - x.z) < 18) { d.shake(jolt); d.hitStop(stop); }
    },
    frame(dt) {
      t += dt;
      // the fountain's spray
      for (let i = 0; i < f.drops.count; i++) {
        const ph = (t * 0.9 + i / f.drops.count) % 1, a = (i * 2.399) % 6.283, rr = 0.5 + ph * 1.7;
        v.set(Math.cos(a) * rr, 1.95 + ph * 2.2 - ph * ph * 3.6, Math.sin(a) * rr);
        f.drops.setMatrixAt(i, m4.compose(v, q, one));
      }
      f.drops.instanceMatrix.needsUpdate = true;
      // who is wet or frozen (the snapshot's chem; in the rain the rest are wet too, unmarked)
      const st = d.wire<Record<string, string>>('chem') ?? {};
      let nd = 0, ni = 0;
      for (const k in st) {
        const root = d.rootOf(k);
        if (!root || !root.visible) continue;
        const p = root.position;
        if (st[k] === 'f' && ni < N) { ice.setMatrixAt(ni++, m4.compose(v.set(p.x, p.y + 1, p.z), q, one)); continue; }
        if (st[k] === 'w' && nd < N * 3) for (let j = 0; j < 3; j++) {
          const a = t * 2.2 + j * 2.094 + p.x;
          drip.setMatrixAt(nd++, m4.compose(v.set(p.x + Math.cos(a) * 0.45, p.y + 2.05 + Math.sin(t * 3 + j) * 0.08, p.z + Math.sin(a) * 0.45), q, one));
        }
      }
      drip.count = nd; ice.count = ni;
      if (nd) drip.instanceMatrix.needsUpdate = true;
      if (ni) ice.instanceMatrix.needsUpdate = true;
    },
  };
};
