import * as THREE from 'three';
import { L } from './i18n';
import { heightAt } from './terrain';
import type { ClientFeatureFactory } from './feature';
import { GATES, SCENES, sceneById, type Gate } from '../src/shared/scenes';

/**
 * 场景 in the browser (src/shared/scenes.ts, the kernel's src/kernel/scenes.ts): the veil of mist round each scene —
 * a curtain on its edge, pale at the foot and gone by head height of a tree, so the land beyond still shows — and
 * each gate: a standing ring of light with where it goes written over it. Walk in (the stick, a tap on the ground,
 * 带我去, an agent's move_to) and the server takes you through; a private line says where you came out.
 */

const MIST_H = 9;
/** The curtain's texture: white, fading from the foot up (and a little at both ends of each run, so corners soften). */
function mistTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 64, 0, 0);
  grad.addColorStop(0, 'rgba(236, 240, 250, 0.75)');
  grad.addColorStop(0.35, 'rgba(226, 232, 246, 0.35)');
  grad.addColorStop(1, 'rgba(220, 228, 244, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
/** A word on a sprite (the gate's destination). */
function label(text: string) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '600 34px "Noto Serif SC", "Songti SC", serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(30, 20, 10, 0.75)'; g.strokeText(text, 128, 32);
  g.fillStyle = '#fff4d6'; g.fillText(text, 128, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(4, 1, 1);
  return s;
}
/** Each scene's gate glow. */
const GLOW: Record<string, number> = { castle: 0xffe39a, lake: 0x8fd3ff, forest: 0x9dffb0, pitch: 0xffc27a, hogsmeade: 0xffa9d2 };

function veil(group: THREE.Group) {
  const mat = new THREE.MeshBasicMaterial({ map: mistTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true });
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
}

function gateModel(g: Gate) {
  const root = new THREE.Group();
  const col = GLOW[g.to] ?? 0xffffff;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.12, 10, 40), new THREE.MeshBasicMaterial({ color: col }));
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

export const scenesFeature: ClientFeatureFactory = () => {
  const group = new THREE.Group();
  group.name = 'scenes';
  veil(group);
  const gates = GATES.map(gateModel);
  for (const g of gates) group.add(g.root);
  let t = 0;
  return {
    id: 'scenes',
    group,
    frame(dt) {
      t += dt;
      for (let i = 0; i < gates.length; i++) {
        const g = gates[i];
        g.ring.rotation.z = t * 0.8 + i;
        (g.disc.material as THREE.MeshBasicMaterial).opacity = 0.22 + 0.1 * Math.sin(t * 2.4 + i);
      }
    },
  };
};
