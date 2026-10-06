import * as THREE from 'three';
import { L } from './i18n';
import { OVERLAY } from './layers';
import { painted } from './models';
import { heightAt } from './terrain';
import type { ClientFeatureFactory } from './feature';
import { PROP_DEFS, PROPS, propHint, type Prop, type PropKind } from '../src/shared/props';

/**
 * 场景道具 in the browser (src/shared/props.ts; the kernel's src/kernel/props.ts): each kind is one instanced mesh
 * per TILE square (culled square by square: a frame draws the kinds round you), plus an instanced glow for the kinds
 * that wake (a flame on a brazier, a blue charge on a rune stone, ice in a basin, light in a crystal). The snapshot's `props` says what is broken or
 * awake; instance matrices change only when that does. A click or a tap on one casts your chosen spell at it
 * (`claim`), and hovering it shows what it wants, sharp on the overlay (layers.ts).
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const at = <T extends THREE.BufferGeometry>(g: T, x: number, y: number, z: number) => g.translate(x, y, z);
/** Drop uv: no prop material uses a map (models.ts already strips uv for wizards). */
const noUV = <T extends THREE.BufferGeometry>(g: T): T => { g.deleteAttribute('uv'); return g; };
/** Each kind's body: a few painted primitives, merged (feet at y 0). */
function body(k: PropKind): THREE.BufferGeometry {
  switch (k) {
    case 'crate': return noUV(painted([[at(new THREE.BoxGeometry(0.8, 0.8, 0.8), 0, 0.4, 0), 0x9a6a36], [at(new THREE.BoxGeometry(0.84, 0.1, 0.84), 0, 0.78, 0), 0x6e4722], [at(new THREE.BoxGeometry(0.84, 0.1, 0.84), 0, 0.04, 0), 0x6e4722]]));
    case 'barrel': return noUV(painted([[at(new THREE.CylinderGeometry(0.34, 0.38, 0.95, 12), 0, 0.475, 0), 0x86532a], [at(new THREE.TorusGeometry(0.37, 0.03, 4, 16).rotateX(Math.PI / 2), 0, 0.22, 0), 0x3a3a40], [at(new THREE.TorusGeometry(0.35, 0.03, 4, 16).rotateX(Math.PI / 2), 0, 0.74, 0), 0x3a3a40]]));
    case 'pumpkin': return noUV(painted([[at(new THREE.SphereGeometry(0.45, 12, 8).scale(1, 0.72, 1), 0, 0.33, 0), 0xe57a1c], [at(new THREE.CylinderGeometry(0.04, 0.06, 0.2, 5), 0, 0.72, 0), 0x3f6b2a]]));
    case 'pot': return noUV(painted([[at(new THREE.CylinderGeometry(0.2, 0.3, 0.55, 10), 0, 0.28, 0), 0xb8643c], [at(new THREE.TorusGeometry(0.21, 0.035, 4, 12).rotateX(Math.PI / 2), 0, 0.56, 0), 0x8e4a2a]]));
    case 'whizbang': return noUV(painted([[at(new THREE.CylinderGeometry(0.34, 0.38, 0.95, 12), 0, 0.475, 0), 0xc2302a], [at(new THREE.CylinderGeometry(0.385, 0.385, 0.16, 12), 0, 0.5, 0), 0xf2c230], [at(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 4), 0.1, 1.1, 0), 0xf0e6c8]]));
    // a web strung upright (feet at 0.2 m): spokes and two rings of silk
    case 'web': return noUV(painted([
      ...[0, 1, 2, 3, 4, 5].map((i) => [at(new THREE.BoxGeometry(0.035, 1.7, 0.035).rotateZ((i * Math.PI) / 6), 0, 1.05, 0), 0xeeeae2] as [THREE.BufferGeometry, number]),
      [at(new THREE.TorusGeometry(0.38, 0.018, 3, 12), 0, 1.05, 0), 0xe4e0d6], [at(new THREE.TorusGeometry(0.72, 0.018, 3, 16), 0, 1.05, 0), 0xe4e0d6],
    ]));
    case 'hay': return noUV(painted([[at(new THREE.BoxGeometry(1.0, 0.7, 0.72), 0, 0.35, 0), 0xd9b55c], [at(new THREE.BoxGeometry(1.02, 0.08, 0.74), 0, 0.22, 0), 0x8a6a2c], [at(new THREE.BoxGeometry(1.02, 0.08, 0.74), 0, 0.5, 0), 0x8a6a2c]]));
    case 'bush': return noUV(painted([[at(new THREE.IcosahedronGeometry(0.55, 1), 0, 0.5, 0), 0x4c7d38], [at(new THREE.IcosahedronGeometry(0.42, 1), 0.42, 0.38, 0.15), 0x5c9044], [at(new THREE.IcosahedronGeometry(0.38, 1), -0.38, 0.34, -0.12), 0x447233]]));
    case 'mushroom': return noUV(painted([
      [at(new THREE.CylinderGeometry(0.09, 0.12, 0.42, 7), 0, 0.21, 0), 0xf1e8d6], [at(new THREE.SphereGeometry(0.3, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.4, 0), 0xc8322a],
      [at(new THREE.CylinderGeometry(0.06, 0.08, 0.26, 6), 0.32, 0.13, 0.12), 0xf1e8d6], [at(new THREE.SphereGeometry(0.18, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), 0.32, 0.25, 0.12), 0xd8452e],
    ]));
    case 'ice': return noUV(painted([[at(new THREE.BoxGeometry(0.85, 0.85, 0.85).rotateY(0.4).rotateX(0.12), 0, 0.45, 0), 0xc2e8f7], [at(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 10).rotateX(1.2), 0, 0.45, 0), 0xf2c230]]));
    case 'lantern': return noUV(painted([
      [at(new THREE.CylinderGeometry(0.05, 0.07, 1.7, 6), 0, 0.85, 0), 0x2f2a26], [at(new THREE.BoxGeometry(0.36, 0.42, 0.36), 0, 1.86, 0), 0x3a3026],
      [at(new THREE.BoxGeometry(0.3, 0.32, 0.37), 0, 1.86, 0), 0xe8cf8a], [at(new THREE.ConeGeometry(0.28, 0.2, 4).rotateY(Math.PI / 4), 0, 2.17, 0), 0x2f2a26],
    ]));
    case 'cauldron': return noUV(painted([
      [at(new THREE.SphereGeometry(0.5, 12, 8, 0, Math.PI * 2, Math.PI * 0.18, Math.PI * 0.82), 0, 0.55, 0), 0x26262b], [at(new THREE.TorusGeometry(0.42, 0.05, 5, 16).rotateX(Math.PI / 2), 0, 0.97, 0), 0x3a3a42],
      ...[0, 1, 2].map((i) => [at(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 4), Math.sin((i * Math.PI * 2) / 3) * 0.3, 0.12, Math.cos((i * Math.PI * 2) / 3) * 0.3), 0x26262b] as [THREE.BufferGeometry, number]),
    ]));
    // (three overlapping pools, darker at the edge: water, not a decal)
    case 'puddle': return noUV(painted([[at(new THREE.CircleGeometry(1.0, 16).rotateX(-Math.PI / 2).scale(1, 1, 0.7), 0, 0.03, 0), 0x2c4456], [at(new THREE.CircleGeometry(0.7, 14).rotateX(-Math.PI / 2), 0.55, 0.031, 0.25), 0x2c4456], [at(new THREE.CircleGeometry(0.82, 16).rotateX(-Math.PI / 2).scale(1, 1, 0.65), -0.05, 0.035, -0.02), 0x47677f], [at(new THREE.CircleGeometry(0.5, 12).rotateX(-Math.PI / 2), 0.5, 0.036, 0.22), 0x47677f]]));
    case 'brazier': return noUV(painted([
      [at(new THREE.CylinderGeometry(0.48, 0.26, 0.3, 12, 1, true), 0, 1.0, 0), 0x3b342e], [at(new THREE.CircleGeometry(0.42, 12).rotateX(-Math.PI / 2), 0, 0.95, 0), 0x241c16],
      ...[0, 1, 2].map((i) => [at(new THREE.CylinderGeometry(0.04, 0.05, 1.0, 5).rotateZ(0.2).rotateY((i * Math.PI * 2) / 3), Math.sin((i * Math.PI * 2) / 3) * 0.18, 0.5, Math.cos((i * Math.PI * 2) / 3) * 0.18), 0x2d2825] as [THREE.BufferGeometry, number]),
    ]));
    case 'rune': return noUV(painted([[at(new THREE.BoxGeometry(0.55, 1.3, 0.35), 0, 0.65, 0), 0x7c7f88], [at(new THREE.BoxGeometry(0.6, 0.12, 0.4), 0, 1.33, 0), 0x6a6d75], [at(new THREE.PlaneGeometry(0.3, 0.5), 0, 0.8, 0.176), 0x4f5a78]]));
    case 'basin': return noUV(painted([[at(new THREE.CylinderGeometry(0.62, 0.5, 0.4, 14, 1, true), 0, 0.2, 0), 0x8d8a82], [at(new THREE.CircleGeometry(0.58, 14).rotateX(-Math.PI / 2), 0, 0.32, 0), 0x2f5e8f]]));
    case 'crystal': return noUV(painted([[at(new THREE.OctahedronGeometry(0.28).scale(0.7, 1.9, 0.7), 0, 0.55, 0), 0xcfc4ff], [at(new THREE.OctahedronGeometry(0.2).scale(0.7, 1.6, 0.7).rotateZ(0.5), 0.25, 0.3, 0.05), 0xb7a8f5], [at(new THREE.OctahedronGeometry(0.17).scale(0.7, 1.5, 0.7).rotateZ(-0.6), -0.22, 0.26, -0.06), 0xdcd3ff]]));
    // 路灯: flared base, tapered pole with collars, glass housing with cap and finial (~90 tris)
    case 'lamppost': return noUV(painted([
      [at(new THREE.CylinderGeometry(0.18, 0.26, 0.32, 8), 0, 0.16, 0), 0x2b2b30],
      [at(new THREE.CylinderGeometry(0.06, 0.10, 2.6, 6), 0, 1.6, 0), 0x2b2b30],
      [at(new THREE.TorusGeometry(0.10, 0.025, 4, 8).rotateX(Math.PI / 2), 0, 0.95, 0), 0x3d3d45],
      [at(new THREE.TorusGeometry(0.085, 0.022, 4, 8).rotateX(Math.PI / 2), 0, 2.25, 0), 0x3d3d45],
      [at(new THREE.BoxGeometry(0.36, 0.44, 0.36), 0, 3.12, 0), 0x2b2b30],
      [at(new THREE.BoxGeometry(0.28, 0.34, 0.28), 0, 3.12, 0), 0xffd88a],
      [at(new THREE.ConeGeometry(0.28, 0.20, 4).rotateY(Math.PI / 4), 0, 3.44, 0), 0x2b2b30],
      [at(new THREE.SphereGeometry(0.05, 6, 4), 0, 3.58, 0), 0x3d3d45],
    ]));
    // 路牌: weathered post with two directional arms (~40 tris)
    case 'signpost': return noUV(painted([
      [at(new THREE.CylinderGeometry(0.07, 0.10, 2.3, 6), 0, 1.15, 0), 0x6b4a2e],
      [at(new THREE.BoxGeometry(0.95, 0.20, 0.06).rotateY(0.35), 0.1, 1.92, 0), 0x7d5a38],
      [at(new THREE.BoxGeometry(0.20, 0.20, 0.06).rotateY(0.35 + Math.PI / 4), 0.52, 1.92, -0.14), 0x7d5a38],
      [at(new THREE.BoxGeometry(0.75, 0.18, 0.06).rotateY(-0.55), -0.08, 1.62, 0), 0x6b4a2e],
      [at(new THREE.BoxGeometry(0.18, 0.18, 0.06).rotateY(-0.55 + Math.PI / 4), -0.42, 1.62, 0.12), 0x6b4a2e],
      [at(new THREE.SphereGeometry(0.09, 6, 4), 0, 2.34, 0), 0x4a3320],
    ]));
    // 长椅: slatted seat and back, iron frames (~70 tris)
    case 'bench': return noUV(painted([
      [at(new THREE.BoxGeometry(1.8, 0.06, 0.18), 0, 0.45, -0.20), 0x7d5a38],
      [at(new THREE.BoxGeometry(1.8, 0.06, 0.18), 0, 0.45, 0.0), 0x7d5a38],
      [at(new THREE.BoxGeometry(1.8, 0.06, 0.18), 0, 0.45, 0.20), 0x7d5a38],
      [at(new THREE.BoxGeometry(1.8, 0.14, 0.06).rotateX(-0.15), 0, 0.78, -0.34), 0x6b4a2e],
      [at(new THREE.BoxGeometry(1.8, 0.14, 0.06).rotateX(-0.15), 0, 0.98, -0.37), 0x6b4a2e],
      [at(new THREE.BoxGeometry(0.08, 0.45, 0.55), -0.80, 0.225, 0), 0x2b2b30],
      [at(new THREE.BoxGeometry(0.08, 0.45, 0.55), 0.80, 0.225, 0), 0x2b2b30],
      [at(new THREE.BoxGeometry(0.06, 0.06, 0.62), -0.85, 0.68, -0.05), 0x2b2b30],
      [at(new THREE.BoxGeometry(0.06, 0.06, 0.62), 0.85, 0.68, -0.05), 0x2b2b30],
    ]));
  }
}
/** What an awake one shows, and its colour (additive, so the bloom catches it). */
const GLOW: Partial<Record<PropKind, { geo: () => THREE.BufferGeometry; color: number }>> = {
  brazier: { geo: () => at(new THREE.ConeGeometry(0.32, 0.9, 8), 0, 1.5, 0), color: 0xff8a2a },
  rune: { geo: () => at(new THREE.BoxGeometry(0.62, 1.36, 0.42), 0, 0.68, 0), color: 0x5aa8ff },
  basin: { geo: () => at(new THREE.CylinderGeometry(0.6, 0.6, 0.12, 14), 0, 0.36, 0), color: 0xcff4ff },
  crystal: { geo: () => at(new THREE.OctahedronGeometry(0.4).scale(0.8, 1.9, 0.8), 0, 0.6, 0), color: 0xfff1b8 },
  lantern: { geo: () => at(new THREE.SphereGeometry(0.42, 10, 8), 0, 1.86, 0), color: 0xffc060 },
  cauldron: { geo: () => at(new THREE.CylinderGeometry(0.4, 0.4, 0.12, 14), 0, 0.98, 0), color: 0x7dff7a },
  lamppost: { geo: () => at(new THREE.SphereGeometry(0.30, 10, 8), 0, 3.12, 0), color: 0xffc060 },
};

/** The hover line over a prop: its name and what it wants. */
function signTexture(p: Prop) {
  const d = PROP_DEFS[p.kind], hint = propHint(p);
  const c = document.createElement('canvas');
  c.width = 384; c.height = 88;
  const g = c.getContext('2d')!;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(28, 20, 12, 0.72)';
  g.beginPath(); g.roundRect?.(8, 6, 368, 76, 16); if (!g.roundRect) g.rect(8, 6, 368, 76); g.fill();
  g.font = '600 30px "Noto Serif SC", "Songti SC", serif'; g.fillStyle = '#fff1cf'; g.fillText(L(d.zh, d.en), 192, 30);
  g.font = '500 20px "Noto Sans SC", "PingFang SC", sans-serif'; g.fillStyle = '#e6dcc4'; g.fillText(L(hint.zh, hint.en), 192, 62, 352);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const CLAIM_R = 1.3;
/** The squares the props are cut into for culling (metres). */
const TILE = 48;
/** Things you can touch read a size larger than life (the 2.5D camera hangs 24 m up) and a touch brighter. */
const SIZE = 1.35;
/** Kinds too small for their shadow to matter: they skip the shadow map (docs/PERF.md 2026-10-03). */
const NO_SHADOW: Set<PropKind> = new Set(['mushroom', 'web', 'pumpkin', 'pot', 'ice', 'hay']);
/** A faint ring on the ground under each kind that wakes, in its element's colour: this one does something. */
const RING: Partial<Record<PropKind, number>> = { brazier: 0xff9a3c, rune: 0x6ab4ff, basin: 0xa8e8ff, crystal: 0xffe6a0, lantern: 0xffb24a, cauldron: 0x7de07a };

export const propsFeature: ClientFeatureFactory = (d) => {
  const group = new THREE.Group();
  group.name = 'props';
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s1 = V(1, 1, 1), s0 = V(0, 0, 0), up = V(0, 1, 0);
  const place = (p: Prop, on: boolean, grow = 1) => m4.compose(V(p.x, heightAt(p.x, p.z), p.z), q.setFromAxisAngle(up, (p.x * 7.13 + p.z * 3.1) % 6.28), on ? s1.clone().multiplyScalar(grow * SIZE) : s0);
  // one instanced mesh per kind per TILE square (and its glow and ring): each is culled on its own, so a frame draws
  // only the kinds round you, not all of the world's (docs/PERF.md 2026-10-01)
  const kinds = [...new Set(PROPS.map((p) => p.kind))];
  const geo = new Map(kinds.map((k) => [k, body(k)])), mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, emissive: 0xffffff, emissiveIntensity: 0.06 });
  // (a puddle: glossy and a little see-through, so it takes the sky and the lamps)
  const wetMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.35, transparent: true, opacity: 0.82, depthWrite: false });
  const ringGeo = noUV(new THREE.RingGeometry(0.62, 0.8, 24).rotateX(-Math.PI / 2).translate(0, 0.06, 0));
  const ringMat = new Map(kinds.filter((k) => RING[k]).map((k) => [k, new THREE.MeshBasicMaterial({ color: RING[k], transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false })]));
  const glowGeo = new Map(kinds.filter((k) => GLOW[k]).map((k) => [k, noUV(GLOW[k]!.geo())]));
  // the flames and charges breathe in the vertex shader (a scale pulsation): the CPU never rewrites a live matrix
  const glowTime = { value: 0 };
  const glowMat = new Map(kinds.filter((k) => GLOW[k]).map((k) => {
    const gm = new THREE.MeshBasicMaterial({ color: GLOW[k]!.color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    gm.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = glowTime;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float gph = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
          transformed *= 1.0 + 0.08 * sin(uTime * 9.0 + gph);
        #endif`);
    };
    gm.customProgramCacheKey = () => 'prop-glow';
    return [k, gm] as [PropKind, THREE.MeshBasicMaterial];
  }));
  interface Bucket { k: PropKind; list: Prop[]; m: THREE.InstancedMesh; g?: THREE.InstancedMesh; r?: THREE.InstancedMesh }
  const byKey = new Map<string, Prop[]>();
  for (const p of PROPS) { const key = `${p.kind}|${Math.floor(p.x / TILE)},${Math.floor(p.z / TILE)}`; (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(p); }
  const buckets: Bucket[] = [];
  for (const [key, list] of byKey) {
    const k = list[0].kind;
    const m = new THREE.InstancedMesh(geo.get(k)!, PROP_DEFS[k].wets ? wetMat : mat, list.length);
    m.name = `props:${key}`; m.castShadow = !PROP_DEFS[k].wets && !NO_SHADOW.has(k); m.receiveShadow = true;
    list.forEach((p, i) => m.setMatrixAt(i, place(p, true)));
    m.computeBoundingSphere();
    const b: Bucket = { k, list, m };
    group.add(m);
    if (ringMat.has(k)) {
      b.r = new THREE.InstancedMesh(ringGeo, ringMat.get(k)!, list.length);
      b.r.name = `props:${key}:ring`;
      list.forEach((p, i) => b.r!.setMatrixAt(i, place(p, true)));
      b.r.boundingSphere = m.boundingSphere;
      group.add(b.r);
    }
    if (glowMat.has(k)) {
      b.g = new THREE.InstancedMesh(glowGeo.get(k)!, glowMat.get(k)!, list.length);
      b.g.name = `props:${key}:glow`;
      list.forEach((p, i) => b.g!.setMatrixAt(i, place(p, false)));
      // (the bounds of the bodies, grown for a flame's height: the glows start at size 0)
      b.g.boundingSphere = m.boundingSphere!.clone();
      b.g.boundingSphere.radius += 2;
      group.add(b.g);
    }
    buckets.push(b);
  }

  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, toneMapped: false }));
  sign.scale.set(3.4, 0.78, 1); sign.visible = false; sign.renderOrder = 7; sign.layers.set(OVERLAY);
  group.add(sign);
  const signs = new Map<string, THREE.Texture>();
  let hovered: Prop | null = null, hoverAt = 0, t = 0;

  let sig = '';
  function apply() {
    const w = d.wire<{ b?: Record<string, number>; a?: Record<string, number> }>('props');
    const b = w?.b ?? {}, a = w?.a ?? {};
    const next = `${Object.keys(b).sort().join()}|${Object.keys(a).sort().join()}`;
    if (next === sig) return;
    sig = next;
    for (const { list, m, g, r } of buckets) {
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
      glowTime.value = t;
      if (hovered && t - hoverAt > 0.2) hovered = null;
      sign.visible = !!hovered;
      if (hovered) {
        const key = `${hovered.kind}:${propHint(hovered).en}`;
        let tx = signs.get(key);
        if (!tx) { tx = signTexture(hovered); signs.set(key, tx); }
        if (sign.material.map !== tx) { sign.material.map = tx; sign.material.needsUpdate = true; }
        sign.position.set(hovered.x, heightAt(hovered.x, hovered.z) + 2.3, hovered.z);
      }
    },
  };
};
