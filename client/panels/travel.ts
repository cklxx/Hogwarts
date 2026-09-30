/**
 * 飞路网 and brooms in the browser (src/kernel/travel.ts): green fires at the fireplaces (one instanced stone
 * hearth, one set of flame sprites: two draw calls), F at a fire opens the destinations, M mounts or dismounts a
 * broom (drawn under every rider the snapshot's `tr` names, who then ride a little above the grass).
 */
import * as THREE from 'three';
import type { ClientFeature, ClientFeatureFactory } from '../feature';
import { L, lang } from '../i18n';
import { makeBroom } from '../quidditch3d';
import { heightAt } from '../terrain';
import { glowSprite } from '../textures';
import { FIREPLACES, fireplaceNear } from '../../src/shared/travel';
import { esc } from './logic';

const RIDE = 0.7;
const tmp = new THREE.Object3D();

/** The destinations offered at `here` (every other fireplace, nearest first); pure, for tests. */
export function flooChoices(here: { x: number; z: number }) {
  const at = fireplaceNear(here);
  if (!at) return null;
  return { at, to: FIREPLACES.filter((f) => f.id !== at.id).map((f) => ({ ...f, dist: Math.round(Math.hypot(f.x - at.x, f.z - at.z)) })).sort((a, b) => a.dist - b.dist) };
}

export const travelFeature: ClientFeatureFactory = (d): ClientFeature => {
  const group = new THREE.Group();
  group.name = 'travel';
  const hearth = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 1.6, 0.9), new THREE.MeshStandardMaterial({ color: 0x8a8278, roughness: 0.95 }), FIREPLACES.length);
  const flameGeo = new THREE.BufferGeometry();
  const fp = new Float32Array(FIREPLACES.length * 3);
  FIREPLACES.forEach((f, i) => {
    const y = heightAt(f.x, f.z);
    tmp.position.set(f.x, y + 0.8, f.z); tmp.updateMatrix(); hearth.setMatrixAt(i, tmp.matrix);
    fp.set([f.x, y + 1.0, f.z + 0.5], i * 3);
  });
  flameGeo.setAttribute('position', new THREE.BufferAttribute(fp, 3));
  const flameMat = new THREE.PointsMaterial({ map: glowSprite('rgba(120,255,140,1)', 'rgba(20,160,60,0)'), size: 2.2, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  group.add(hearth, new THREE.Points(flameGeo, flameMat));
  const brooms = new Map<string, THREE.Group>();
  let riders: readonly string[] = [], t = 0;
  let picker: HTMLElement | null = null;
  const closePicker = () => { picker?.remove(); picker = null; };
  function openPicker() {
    const p = d.myPos();
    const c = p ? flooChoices(p) : null;
    if (!c) return;
    closePicker();
    picker = document.createElement('div');
    picker.id = 'floo';
    picker.className = 'sheet';
    picker.innerHTML = `<p><b>${L('飞路网', 'Floo Network')}</b> · ${esc(lang === 'zh' ? c.at.zh : c.at.en)}</p><p>${c.to.map((f) => `<button data-to="${f.id}">${esc(lang === 'zh' ? f.zh : f.en)} <small>${f.dist} m</small></button>`).join(' ')}</p><p><button class="ghost" data-to="">${L('取消', 'Cancel')}</button></p>`;
    picker.style.cssText = 'position:fixed;left:50%;bottom:calc(180px * var(--u));transform:translateX(-50%);z-index:20;max-width:calc(100vw - 32px);padding:10px 14px;background:rgb(var(--sheen2) / .96);color:var(--ink);border:1px solid var(--ink3);border-radius:8px';
    picker.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-to]') as HTMLElement | null;
      if (!b) return;
      if (b.dataset.to) d.send({ t: 'travel', to: b.dataset.to });
      closePicker();
    });
    document.body.append(picker);
  }
  return {
    id: 'travel',
    group,
    keydown(e) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return false;
      if (e.key === 'Escape' && picker) { closePicker(); return true; }
      if (e.key !== 'm' && e.key !== 'M') return false;
      d.send({ t: 'travel', op: 'broom' });
      return true;
    },
    action() {
      const p = d.myPos();
      const f = p ? fireplaceNear(p) : null;
      return f ? { label: L(`按 F 使用飞路网 ·「${f.zh}」`, `F — the Floo Network (${f.en})`), x: f.x, z: f.z, y: heightAt(f.x, f.z) + 2.4, act: openPicker } : null;
    },
    onMessage(msg) {
      if (msg.t !== 'travel' || !msg.r) return false;
      const r = msg.r as { riding?: boolean; to?: string };
      if (typeof r.riding === 'boolean') d.toast(r.riding ? L('🧹 骑上了扫帚（M 下来；施法、受伤或进城堡会自动下来）', '🧹 On your broom (M to get off; casting, being hurt or going indoors puts you down)') : L('🧹 下了扫帚', '🧹 Off your broom'));
      return true;
    },
    frame(dt) {
      t += dt;
      flameMat.size = 2.0 + Math.sin(t * 7) * 0.25;
      riders = d.wire<string[]>('tr') ?? [];
      for (const [h, b] of brooms) if (!riders.includes(h)) { group.remove(b); brooms.delete(h); }
      for (const h of riders) {
        const p = d.posOf(h);
        if (!p) continue;
        let b = brooms.get(h);
        if (!b) { b = makeBroom(); brooms.set(h, b); group.add(b); }
        b.position.set(p.x, p.y + 0.62, p.z);
        b.rotation.y = d.facingOf(h);
      }
      if (picker && !fireplaceNear(d.myPos() ?? { x: 1e9, z: 1e9 })) closePicker(); // walked away from the fire
    },
    lift: (h) => (riders.includes(h) ? RIDE : 0),
  };
};
