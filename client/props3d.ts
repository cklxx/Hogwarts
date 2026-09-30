import * as THREE from 'three';
import { L } from './i18n';
import { OVERLAY } from './layers';
import { painted } from './models';
import { heightAt } from './terrain';
import type { ClientFeatureFactory } from './feature';
import { PROP_DEFS, PROPS, type Prop, type PropKind } from '../src/shared/props';

/**
 * 场景道具 in the browser (src/shared/props.ts; the kernel's src/kernel/props.ts): each kind is one instanced mesh
 * (all the crates of the world: one draw call), plus an instanced glow for the kinds that wake (a flame on a brazier,
 * a blue charge on a rune stone, ice in a basin, light in a crystal). The snapshot's `props` says what is broken or
 * awake; instance matrices change only when that does. A click or a tap on one casts your chosen spell at it
 * (`claim`), and hovering it shows what it wants, sharp on the overlay (layers.ts).
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const at = <T extends THREE.BufferGeometry>(g: T, x: number, y: number, z: number) => g.translate(x, y, z);
/** Each kind's body: a few painted primitives, merged (feet at y 0). */
function body(k: PropKind): THREE.BufferGeometry {
  switch (k) {
    case 'crate': return painted([[at(new THREE.BoxGeometry(0.8, 0.8, 0.8), 0, 0.4, 0), 0x9a6a36], [at(new THREE.BoxGeometry(0.84, 0.1, 0.84), 0, 0.78, 0), 0x6e4722], [at(new THREE.BoxGeometry(0.84, 0.1, 0.84), 0, 0.04, 0), 0x6e4722]]);
    case 'barrel': return painted([[at(new THREE.CylinderGeometry(0.34, 0.38, 0.95, 12), 0, 0.475, 0), 0x86532a], [at(new THREE.TorusGeometry(0.37, 0.03, 4, 16).rotateX(Math.PI / 2), 0, 0.22, 0), 0x3a3a40], [at(new THREE.TorusGeometry(0.35, 0.03, 4, 16).rotateX(Math.PI / 2), 0, 0.74, 0), 0x3a3a40]]);
    case 'pumpkin': return painted([[at(new THREE.SphereGeometry(0.45, 12, 8).scale(1, 0.72, 1), 0, 0.33, 0), 0xe57a1c], [at(new THREE.CylinderGeometry(0.04, 0.06, 0.2, 5), 0, 0.72, 0), 0x3f6b2a]]);
    case 'pot': return painted([[at(new THREE.CylinderGeometry(0.2, 0.3, 0.55, 10), 0, 0.28, 0), 0xb8643c], [at(new THREE.TorusGeometry(0.21, 0.035, 4, 12).rotateX(Math.PI / 2), 0, 0.56, 0), 0x8e4a2a]]);
    case 'whizbang': return painted([[at(new THREE.CylinderGeometry(0.34, 0.38, 0.95, 12), 0, 0.475, 0), 0xc2302a], [at(new THREE.CylinderGeometry(0.385, 0.385, 0.16, 12), 0, 0.5, 0), 0xf2c230], [at(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 4), 0.1, 1.1, 0), 0xf0e6c8]]);
    case 'brazier': return painted([
      [at(new THREE.CylinderGeometry(0.48, 0.26, 0.3, 12, 1, true), 0, 1.0, 0), 0x3b342e], [at(new THREE.CircleGeometry(0.42, 12).rotateX(-Math.PI / 2), 0, 0.95, 0), 0x241c16],
      ...[0, 1, 2].map((i) => [at(new THREE.CylinderGeometry(0.04, 0.05, 1.0, 5).rotateZ(0.2).rotateY((i * Math.PI * 2) / 3), Math.sin((i * Math.PI * 2) / 3) * 0.18, 0.5, Math.cos((i * Math.PI * 2) / 3) * 0.18), 0x2d2825] as [THREE.BufferGeometry, number]),
    ]);
    case 'rune': return painted([[at(new THREE.BoxGeometry(0.55, 1.3, 0.35), 0, 0.65, 0), 0x7c7f88], [at(new THREE.BoxGeometry(0.6, 0.12, 0.4), 0, 1.33, 0), 0x6a6d75], [at(new THREE.PlaneGeometry(0.3, 0.5), 0, 0.8, 0.176), 0x4f5a78]]);
    case 'basin': return painted([[at(new THREE.CylinderGeometry(0.62, 0.5, 0.4, 14, 1, true), 0, 0.2, 0), 0x8d8a82], [at(new THREE.CircleGeometry(0.58, 14).rotateX(-Math.PI / 2), 0, 0.32, 0), 0x2f5e8f]]);
    case 'crystal': return painted([[at(new THREE.OctahedronGeometry(0.28).scale(0.7, 1.9, 0.7), 0, 0.55, 0), 0xcfc4ff], [at(new THREE.OctahedronGeometry(0.2).scale(0.7, 1.6, 0.7).rotateZ(0.5), 0.25, 0.3, 0.05), 0xb7a8f5], [at(new THREE.OctahedronGeometry(0.17).scale(0.7, 1.5, 0.7).rotateZ(-0.6), -0.22, 0.26, -0.06), 0xdcd3ff]]);
  }
}
/** What an awake one shows, and its colour (additive, so the bloom catches it). */
const GLOW: Partial<Record<PropKind, { geo: () => THREE.BufferGeometry; color: number }>> = {
  brazier: { geo: () => at(new THREE.ConeGeometry(0.32, 0.9, 8), 0, 1.5, 0), color: 0xff8a2a },
  rune: { geo: () => at(new THREE.BoxGeometry(0.62, 1.36, 0.42), 0, 0.68, 0), color: 0x5aa8ff },
  basin: { geo: () => at(new THREE.CylinderGeometry(0.6, 0.6, 0.12, 14), 0, 0.36, 0), color: 0xcff4ff },
  crystal: { geo: () => at(new THREE.OctahedronGeometry(0.4).scale(0.8, 1.9, 0.8), 0, 0.6, 0), color: 0xfff1b8 },
};

/** The hover line over a prop: its name and what it wants. */
function signTexture(k: PropKind) {
  const d = PROP_DEFS[k];
  const c = document.createElement('canvas');
  c.width = 384; c.height = 88;
  const g = c.getContext('2d')!;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(28, 20, 12, 0.72)';
  g.beginPath(); g.roundRect?.(8, 6, 368, 76, 16); if (!g.roundRect) g.rect(8, 6, 368, 76); g.fill();
  g.font = '600 30px "Noto Serif SC", "Songti SC", serif'; g.fillStyle = '#fff1cf'; g.fillText(L(d.zh, d.en), 192, 30);
  g.font = '500 20px "Noto Sans SC", "PingFang SC", sans-serif'; g.fillStyle = '#e6dcc4'; g.fillText(L(d.hintZh, d.hintEn), 192, 62);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const CLAIM_R = 1.3;
/** Things you can touch read a size larger than life (the 2.5D camera hangs 24 m up) and a touch brighter. */
const SIZE = 1.35;
/** A faint ring on the ground under each kind that wakes, in its element's colour: this one does something. */
const RING: Partial<Record<PropKind, number>> = { brazier: 0xff9a3c, rune: 0x6ab4ff, basin: 0xa8e8ff, crystal: 0xffe6a0 };

export const propsFeature: ClientFeatureFactory = (d) => {
  const group = new THREE.Group();
  group.name = 'props';
  const kinds = [...new Set(PROPS.map((p) => p.kind))];
  const byKind = new Map<PropKind, Prop[]>(kinds.map((k) => [k, PROPS.filter((p) => p.kind === k)]));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s1 = V(1, 1, 1), s0 = V(0, 0, 0), up = V(0, 1, 0);
  const place = (p: Prop, on: boolean, grow = 1) => m4.compose(V(p.x, heightAt(p.x, p.z), p.z), q.setFromAxisAngle(up, (p.x * 7.13 + p.z * 3.1) % 6.28), on ? s1.clone().multiplyScalar(grow * SIZE) : s0);
  const rings = new Map<PropKind, THREE.InstancedMesh>();
  const meshes = new Map<PropKind, THREE.InstancedMesh>(), glows = new Map<PropKind, THREE.InstancedMesh>();
  for (const k of kinds) {
    const list = byKind.get(k)!;
    const m = new THREE.InstancedMesh(body(k), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, emissive: 0xffffff, emissiveIntensity: 0.06 }), list.length);
    m.name = `props:${k}`; m.castShadow = true; m.receiveShadow = true;
    list.forEach((p, i) => m.setMatrixAt(i, place(p, true)));
    m.computeBoundingSphere();
    group.add(m); meshes.set(k, m);
    const rc = RING[k];
    if (rc) {
      const r = new THREE.InstancedMesh(new THREE.RingGeometry(0.62, 0.8, 24).rotateX(-Math.PI / 2).translate(0, 0.06, 0), new THREE.MeshBasicMaterial({ color: rc, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }), list.length);
      r.name = `props:${k}:ring`;
      list.forEach((p, i) => r.setMatrixAt(i, place(p, true)));
      group.add(r); rings.set(k, r);
    }
    const gl = GLOW[k];
    if (gl) {
      const g = new THREE.InstancedMesh(gl.geo(), new THREE.MeshBasicMaterial({ color: gl.color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }), list.length);
      g.name = `props:${k}:glow`;
      list.forEach((p, i) => g.setMatrixAt(i, place(p, false)));
      g.computeBoundingSphere();
      group.add(g); glows.set(k, g);
    }
  }
  // (instanced bounds: the whole world's spread, so they are never culled as one)
  for (const m of [...meshes.values(), ...glows.values(), ...rings.values()]) m.frustumCulled = false;

  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, toneMapped: false }));
  sign.scale.set(3.4, 0.78, 1); sign.visible = false; sign.renderOrder = 7; sign.layers.set(OVERLAY);
  group.add(sign);
  const signs = new Map<PropKind, THREE.Texture>();
  let hovered: Prop | null = null, hoverAt = 0, t = 0;

  let sig = '';
  let awake = new Set<string>();
  function apply() {
    const w = d.wire<{ b?: Record<string, number>; a?: Record<string, number> }>('props');
    const b = w?.b ?? {}, a = w?.a ?? {};
    const next = `${Object.keys(b).sort().join()}|${Object.keys(a).sort().join()}`;
    if (next === sig) return;
    sig = next;
    awake = new Set(Object.keys(a));
    for (const k of kinds) {
      const list = byKind.get(k)!, m = meshes.get(k)!, g = glows.get(k);
      const r = rings.get(k);
      list.forEach((p, i) => { m.setMatrixAt(i, place(p, !(p.id in b))); if (g) g.setMatrixAt(i, place(p, p.id in a && !(p.id in b))); if (r) r.setMatrixAt(i, place(p, !(p.id in a))); });
      m.instanceMatrix.needsUpdate = true;
      if (r) r.instanceMatrix.needsUpdate = true;
      if (g) g.instanceMatrix.needsUpdate = true;
    }
  }
  const broken = (p: Prop) => p.id in (d.wire<{ b?: Record<string, number> }>('props')?.b ?? {});

  return {
    id: 'props',
    group,
    // a click or a tap on one: cast at it (controls.ts); hovering: show what it is
    claim(x, z, hover) {
      let best: Prop | null = null, bd = CLAIM_R;
      for (const p of PROPS) { const dd = Math.hypot(p.x - x, p.z - z); if (dd < bd && !broken(p)) { bd = dd; best = p; } }
      if (hover) { hovered = best; hoverAt = t; }
      return best ? { x: best.x, z: best.z } : null;
    },
    frame(dt) {
      t += dt;
      apply();
      // the flames and charges breathe
      for (const [k, g] of glows) {
        if (!awake.size) break;
        const list = byKind.get(k)!;
        let any = false;
        list.forEach((p, i) => { if (awake.has(p.id)) { g.setMatrixAt(i, place(p, true, 1 + 0.08 * Math.sin(t * 9 + i * 1.7))); any = true; } });
        if (any) g.instanceMatrix.needsUpdate = true;
      }
      if (hovered && t - hoverAt > 0.2) hovered = null;
      sign.visible = !!hovered;
      if (hovered) {
        let tx = signs.get(hovered.kind);
        if (!tx) { tx = signTexture(hovered.kind); signs.set(hovered.kind, tx); }
        if (sign.material.map !== tx) { sign.material.map = tx; sign.material.needsUpdate = true; }
        sign.position.set(hovered.x, heightAt(hovered.x, hovered.z) + 2.3, hovered.z);
      }
    },
  };
};
