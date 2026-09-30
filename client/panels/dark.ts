/**
 * 黑魔法 in the browser (src/kernel/dark.ts, the snapshot's `dk`): a green-black haze at the feet of every wizard
 * whose darkness shows, and the Dark Mark — the skull-and-serpent of darkmark.ts, large — in the sky wherever
 * someone cast Morsmordre. Two sprite materials, a handful of sprites; nothing when nobody is dark.
 */
import * as THREE from 'three';
import type { ClientFeature, ClientFeatureFactory } from '../feature';
import { heightAt } from '../terrain';
import { glowSprite } from '../textures';
import { paint } from './darkmark';

interface DkSnap { w: string[]; m: [number, number, number][] }
const SKY = 34;

export const darkFeature: ClientFeatureFactory = (d): ClientFeature => {
  const group = new THREE.Group();
  group.name = 'dark';
  const hazeMat = new THREE.SpriteMaterial({ map: glowSprite('rgba(40,120,60,.9)', 'rgba(0,20,8,0)'), transparent: true, depthWrite: false });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const markMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, toneMapped: false });
  let painted = false, t = 0;
  const hazes: THREE.Sprite[] = [], marks: THREE.Sprite[] = [];
  const take = (pool: THREE.Sprite[], i: number, mat: THREE.SpriteMaterial) => {
    let s = pool[i];
    if (!s) { s = new THREE.Sprite(mat); pool.push(s); group.add(s); }
    s.visible = true;
    return s;
  };
  return {
    id: 'dark',
    group,
    frame(dt) {
      t += dt;
      const dk = d.wire<DkSnap>('dk');
      let n = 0;
      for (const h of dk?.w ?? []) {
        const p = d.posOf(h);
        if (!p) continue;
        const s = take(hazes, n++, hazeMat);
        s.position.set(p.x, p.y + 0.35, p.z);
        s.scale.setScalar(2.4 + Math.sin(t * 3 + n) * 0.2);
      }
      for (let i = n; i < hazes.length; i++) hazes[i].visible = false;
      const ms = dk?.m ?? [];
      if (ms.length && !painted) { const c = canvas.getContext('2d'); if (c) { paint(c); tex.needsUpdate = true; painted = true; } }
      ms.forEach(([x, z], i) => {
        const s = take(marks, i, markMat);
        s.position.set(x, heightAt(x, z) + SKY + Math.sin(t * 0.8 + i) * 0.6, z);
        s.scale.setScalar(16);
      });
      for (let i = ms.length; i < marks.length; i++) marks[i].visible = false;
      markMat.opacity = 0.75 + 0.2 * Math.sin(t * 1.7);
    },
  };
};
