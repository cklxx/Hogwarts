import * as THREE from 'three';
import { L } from './i18n';
import { OVERLAY } from './layers';
import { heightAt } from './terrain';
import type { ClientFeatureFactory } from './feature';
import { spriteTex } from './textures';
import { edgeFaces, edgeTo, GATES, SCENES, SIDES, sceneAt, sceneById, type Gate, type Scene, type Side } from '../src/shared/scenes';

/**
 * 场景 in the browser (src/shared/scenes.ts, the kernel's src/kernel/scenes.ts): the veil of mist round each scene —
 * a curtain on its edge, pale at the foot and gone by head height of a tree, so the land beyond still shows — and
 * each gate: a standing ring of light with where it goes written over it. Walk in (the stick, a tap on the ground,
 * 带我去, an agent's move_to) and the server takes you through; a private line says where you came out.
 *
 * The veil is a way through too (边缘出口): near an edge a sign stands on it — where it leads and 往迷雾里走 — at the
 * point of the edge nearest you (a pool of four signs, placed each frame: no sign anywhere else costs a draw call).
 */

const MIST_H = 9;
/** The curtain's texture: white, fading from the foot up, in soft billows along it (it wraps: the frame drifts it). */
function mistTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 64, 0, 0);
  grad.addColorStop(0, 'rgba(236, 240, 250, 0.7)');
  grad.addColorStop(0.35, 'rgba(226, 232, 246, 0.3)');
  grad.addColorStop(1, 'rgba(220, 228, 244, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 64);
  // billows: a few soft puffs low on the curtain, drawn twice across the seam so the texture tiles
  for (const [x, y, r] of [[14, 50, 20], [52, 44, 26], [90, 52, 18], [118, 40, 22]]) for (const dx of [0, -128, 128]) {
    const b = g.createRadialGradient(x + dx, y, 0, x + dx, y, r);
    b.addColorStop(0, 'rgba(244, 247, 255, 0.35)');
    b.addColorStop(1, 'rgba(244, 247, 255, 0)');
    g.fillStyle = b;
    g.fillRect(x + dx - r, y - r, 2 * r, 2 * r);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
/** A word on a sprite (the gate's destination), with a smaller line under it (the veil's signs). */
function labelTexture(text: string, sub = '') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = sub ? 96 : 64;
  const g = c.getContext('2d')!;
  g.font = '600 34px "Noto Serif SC", "Songti SC", serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(30, 20, 10, 0.75)'; g.strokeText(text, 128, 32);
  g.fillStyle = '#fff4d6'; g.fillText(text, 128, 32);
  if (sub) {
    g.font = '500 24px "Noto Sans SC", "PingFang SC", sans-serif';
    g.lineWidth = 5; g.strokeText(sub, 128, 74);
    g.fillStyle = '#e8eefc'; g.fillText(sub, 128, 74);
  }
  const t = spriteTex(c);
  return t;
}
function label(text: string) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(text), transparent: true, depthWrite: false }));
  s.scale.set(4, 1, 1);
  return s;
}

/** Signs on the veil show within this of an edge. */
const SIGN_NEAR = 14;
/** The veil's signs: a small pool, each put at the point of an edge nearest you. */
function edgeSigns(group: THREE.Group) {
  const tex = new Map<string, THREE.Texture>();
  const texFor = (s: Scene, side: Side) => {
    const k = `${s.id}.${side}`;
    let t = tex.get(k);
    if (!t) {
      const to = sceneById(edgeTo(s, side))!;
      const name = L(to.zh, to.en.replace(/^the /, ''));
      t = labelTexture(edgeFaces(s, side) ? `→ ${name}` : L(`迷雾深处 → ${to.zh}`, `mist → ${name}`), L('往迷雾里走', 'walk into the mist'));
      tex.set(k, t);
    }
    return t;
  };
  const pool = Array.from({ length: 4 }, () => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, fog: false, toneMapped: false }));
    sp.scale.set(4, 1.5, 1);
    sp.visible = false;
    sp.renderOrder = 6;
    sp.layers.set(OVERLAY); // sharp, and never hidden in the mist it stands on (layers.ts)
    group.add(sp);
    return sp;
  });
  return (p: { x: number; z: number } | null) => {
    let n = 0;
    const s = p ? sceneAt(p.x, p.z) : null;
    if (p && s) {
      const [x0, z0, x1, z1] = s.box;
      for (const side of SIDES) {
        const d = side === 'x0' ? p.x - x0 : side === 'x1' ? x1 - p.x : side === 'z0' ? p.z - z0 : z1 - p.z;
        if (d > SIGN_NEAR || n >= pool.length) continue;
        const along = (v: number, lo: number, hi: number) => Math.max(lo + 2, Math.min(hi - 2, v));
        const x = side === 'x0' ? x0 + 0.6 : side === 'x1' ? x1 - 0.6 : along(p.x, x0, x1);
        const z = side === 'z0' ? z0 + 0.6 : side === 'z1' ? z1 - 0.6 : along(p.z, z0, z1);
        const sp = pool[n++], m = sp.material;
        const t = texFor(s, side);
        if (m.map !== t) { m.map = t; m.needsUpdate = true; }
        m.opacity = Math.min(1, (SIGN_NEAR - d) / 5);
        sp.position.set(x, heightAt(x, z) + 2.3, z);
        sp.visible = true;
      }
    }
    for (let i = n; i < pool.length; i++) pool[i].visible = false;
  };
}
/** Each scene's gate glow. */
const GLOW: Record<string, number> = { castle: 0xffe39a, lake: 0x8fd3ff, forest: 0x9dffb0, pitch: 0xffc27a, hogsmeade: 0xffa9d2 };

/** The curtains; returns their texture (the frame drifts it). */
function veil(group: THREE.Group) {
  const map = mistTexture();
  const mat = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true });
  for (const s of SCENES) {
    const [x0, z0, x1, z1] = s.box;
    const runs: [number, number, number, number][] = [[x0, z0, x1, z0], [x0, z1, x1, z1], [x0, z0, x0, z1], [x1, z0, x1, z1]];
    for (const [ax, az, bx, bz] of runs) {
      // in pieces of ~12 m, each on the ground under it (the grounds roll)
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 12));
      for (let i = 0; i < n; i++) {
        const u0 = i / n, u1 = (i + 1) / n;
        const px = ax + (bx - ax) * (u0 + u1) / 2, pz = az + (bz - az) * (u0 + u1) / 2;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(len / n + 0.2, MIST_H), mat);
        m.position.set(px, heightAt(px, pz) - 0.5 + MIST_H / 2, pz);
        m.rotation.y = ax === bx ? Math.PI / 2 : 0;
        m.renderOrder = 5;
        m.name = 'veil';
        group.add(m);
      }
    }
  }
  return map;
}

function gateModel(g: Gate) {
  const root = new THREE.Group();
  const col = GLOW[g.to] ?? 0xffffff;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.12, 10, 16), new THREE.MeshBasicMaterial({ color: col }));
  ring.position.y = 1.5;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.15, 32), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
  disc.position.y = 1.5;
  const base = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.4, 32), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.45, depthWrite: false }));
  base.rotation.x = -Math.PI / 2; base.position.y = 0.05;
  const to = sceneById(g.to)!;
  const tag = label(L(`→ ${to.zh}`, `→ ${to.en.replace(/^the /, '')}`));
  tag.position.y = 3.4;
  root.add(ring, disc, base, tag);
  root.position.set(g.at.x, heightAt(g.at.x, g.at.z), g.at.z);
  // face the way you come out on this side (the ring stands across the path)
  root.rotation.y = Math.atan2(g.out.x - g.at.x, g.out.z - g.at.z);
  root.name = `gate:${g.in}>${g.to}`;
  return { root, ring, disc };
}

export const scenesFeature: ClientFeatureFactory = (d) => {
  const group = new THREE.Group();
  group.name = 'scenes';
  const mist = veil(group);
  const signs = edgeSigns(group);
  const gates = GATES.map(gateModel);
  for (const g of gates) group.add(g.root);
  let t = 0;
  return {
    id: 'scenes',
    group,
    frame(dt) {
      t += dt;
      signs(d.myPos());
      mist.offset.x = t * 0.02; // the curtain drifts
      for (let i = 0; i < gates.length; i++) {
        const g = gates[i];
        g.ring.rotation.z = t * 0.8 + i;
        (g.disc.material as THREE.MeshBasicMaterial).opacity = 0.22 + 0.1 * Math.sin(t * 2.4 + i);
      }
    },
  };
};
