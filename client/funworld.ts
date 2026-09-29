import * as THREE from 'three/webgpu';
import { StoryStandardMaterial } from './storybook';
import { CHESTS } from '../src/shared/chests';
import { heightAt } from './terrain';
import { L } from './i18n';
import { Label, makeWizard, setWizardLook, type WizardModel } from './models';
import type { CupSnap, EvSnap } from './funlogic';

/**
 * Sprint 1's things in the world (README 校园事件轮盘 / 隐藏宝箱): the Golden Snitch, Filch (with his lantern and the
 * cone it lights) and Mrs Norris, Peeves over his ink, the Room of Requirement's door, and the hidden chests. Each is
 * a small self-contained model in its own function, with node materials (the storybook StoryStandardMaterial and
 * MeshBasicNodeMaterial; no custom shaders), so they draw the same on WebGPU and the WebGL 2 fallback; main.ts adds `group` to the scene and calls `frame` every frame.
 */
const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new StoryStandardMaterial({ color, roughness: 0.7, ...extra });
const basic = (p: THREE.MeshBasicMaterialParameters) => new THREE.MeshBasicNodeMaterial(p);

/** The Golden Snitch: a gold ball with two fast silver wings. */
export function makeSnitch() {
  const root = new THREE.Group();
  const gold = std(0xe8b923, { metalness: 0.9, roughness: 0.25, emissive: 0x7a5200, emissiveIntensity: 0.9 });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), gold);
  root.add(ball);
  const wingGeo = new THREE.PlaneGeometry(0.62, 0.2);
  wingGeo.translate(0.31, 0, 0);
  const wingMat = std(0xf4f1e6, { side: THREE.DoubleSide, transparent: true, opacity: 0.85, emissive: 0x9a8f70, emissiveIntensity: 0.5 });
  const wings = [1, -1].map((s) => { const w = new THREE.Mesh(wingGeo, wingMat); w.scale.x = s; root.add(w); return w; });
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), basic({ color: 0xffd35c, transparent: true, opacity: 0.18, depthWrite: false }));
  root.add(glow);
  return { root, anim(t: number) { for (const [i, w] of wings.entries()) w.rotation.x = Math.sin(t * 40 + i * Math.PI) * 0.9; glow.scale.setScalar(1 + Math.sin(t * 6) * 0.15); } };
}

/** Filch: a hunched caretaker in a brown coat, and the lantern light he sees by (a cone on the ground). */
export function makeFilch() {
  const m = makeWizard('Slytherin', false, 'filch') as WizardModel;
  setWizardLook(m, 'plain:4a3b2c:6b5a3a:3a2e22:d8b89a:ffb040');
  m.body.scale.set(1, 0.92, 1);
  const lantern = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), basic({ color: 0xffc860 }));
  lantern.position.set(0.45, 1.05, -0.3);
  m.body.add(lantern);
  // the cone he sees in: 11 m, ±0.8 rad (kernel/wheel.ts FILCH), drawn flat on the ground
  const cone = new THREE.Mesh(new THREE.CircleGeometry(11, 24, Math.PI / 2 - 0.8, 1.6), basic({ color: 0xffb040, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
  cone.rotation.x = -Math.PI / 2;
  cone.position.y = 0.06;
  m.body.add(cone);
  m.label.draw(L('费尔奇', 'Argus Filch'), '#ffd9a0', 1);
  m.label.show(true);
  return m;
}

/** Mrs Norris: a thin grey cat with lamp-like eyes. */
export function makeNorris() {
  const root = new THREE.Group();
  const fur = std(0x6d6760, { roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.42, 4, 8), fur);
  body.rotation.x = Math.PI / 2;
  body.position.set(0, 0.28, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), fur);
  head.position.set(0, 0.42, -0.32);
  const earGeo = new THREE.ConeGeometry(0.05, 0.1, 4);
  for (const s of [-1, 1]) { const e = new THREE.Mesh(earGeo, fur); e.position.set(s * 0.07, 0.54, -0.33); root.add(e); }
  const eyeMat = basic({ color: 0xffe066 });
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), eyeMat); e.position.set(s * 0.05, 0.44, -0.44); root.add(e); }
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.5, 5), fur);
  tail.position.set(0, 0.45, 0.38);
  tail.rotation.x = -0.6;
  const legGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.22, 5);
  const legs = [[-0.07, -0.16], [0.07, -0.16], [-0.07, 0.16], [0.07, 0.16]].map(([x, z]) => { const l = new THREE.Mesh(legGeo, fur); l.position.set(x, 0.11, z); root.add(l); return l; });
  root.add(body, head, tail);
  const label = new Label(0.7);
  label.sprite.position.y = 1.1;
  label.draw(L('洛丽丝夫人', 'Mrs Norris'), '#ffd9a0', 1);
  label.show(true);
  root.add(label.sprite);
  return { root, label, anim(t: number, speed: number) { for (const [i, l] of legs.entries()) l.rotation.x = Math.sin(t * 12 + i * Math.PI / 2) * 0.5 * Math.min(1, speed / 2); tail.rotation.z = Math.sin(t * 2) * 0.3; } };
}

/** Peeves: a small floating ghost of a poltergeist in orange and purple, and the ink he spilt. */
export function makePeeves() {
  const m = makeWizard('Gryffindor', false, 'peeves') as WizardModel;
  setWizardLook(m, 'ghost:d8622a:6b3a8a:e0a030::ff8844');
  m.root.scale.setScalar(0.72);
  m.label.draw(L('皮皮鬼', 'Peeves'), '#ffd9a0', 1);
  m.label.show(true);
  const ink = new THREE.Mesh(new THREE.CircleGeometry(1, 40), basic({ color: 0x14163a, transparent: true, opacity: 0.55, depthWrite: false }));
  ink.rotation.x = -Math.PI / 2;
  return { m, ink };
}

/** The Room of Requirement's door, in the blank wall of the seventh-floor corridor (while the event runs). */
export function makeRoomDoor() {
  const root = new THREE.Group();
  const wood = std(0x5a3a1e, { emissive: 0x3a1a00, emissiveIntensity: 0.4 });
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.8, 3.2, 0.2), wood);
  door.position.y = 1.6;
  const arch = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.2, 16, 1, false, 0, Math.PI), wood);
  arch.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  arch.position.y = 3.2;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), std(0xd4af37, { metalness: 0.8, roughness: 0.3 }));
  knob.position.set(0.6, 1.5, 0.14);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 4.4), basic({ color: 0xffd98a, transparent: true, opacity: 0.2, depthWrite: false }));
  glow.position.set(0, 2, -0.12);
  root.add(door, arch, knob, glow);
  return root;
}

/** A hidden chest: an iron-bound wooden box with a rounded lid. */
export function makeChest() {
  const root = new THREE.Group();
  const wood = std(0x7a4a22);
  const iron = std(0x3a3430, { metalness: 0.6, roughness: 0.5 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.6), wood);
  box.position.y = 0.25;
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 12, 1, false, 0, Math.PI), wood);
  lid.rotation.z = Math.PI / 2;
  lid.position.y = 0.5;
  const bands = [-0.3, 0.3].map((x) => { const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.52, 0.62), iron); b.position.set(x, 0.26, 0); return b; });
  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.05), std(0xd4af37, { metalness: 0.8, roughness: 0.3, emissive: 0x4a3200, emissiveIntensity: 0.6 }));
  lock.position.set(0, 0.42, 0.31);
  root.add(box, lid, lock, ...bands);
  return root;
}

export function createFunWorld() {
  const group = new THREE.Group();
  group.name = 'fun';
  const snitch = makeSnitch();
  const filch = makeFilch();
  const norris = makeNorris();
  const peeves = makePeeves();
  const door = makeRoomDoor();
  door.position.set(-32, heightAt(-32, -63.7), -63.7);
  const chests = new Map<string, THREE.Group>();
  for (const c of CHESTS) {
    const g = makeChest();
    g.position.set(c.x, heightAt(c.x, c.z), c.z);
    g.rotation.y = ((c.x * 13 + c.z * 7) % 6.28);
    chests.set(c.id, g);
    group.add(g);
  }
  group.add(snitch.root, filch.root, norris.root, peeves.m.root, peeves.ink, door);
  const hide = () => { snitch.root.visible = false; filch.root.visible = false; norris.root.visible = false; peeves.m.root.visible = false; peeves.ink.visible = false; door.visible = false; };
  hide();
  const at = { fx: 0, fz: 0, ff: 0, nx: 0, nz: 0, nf: 0, sx: 0, sz: 0, px: 0, pz: 0, init: '' };
  let t = 0;
  return {
    group,
    frame(dt: number, snap: { cup?: CupSnap; ev?: EvSnap | null } | null) {
      t += dt;
      const k = 1 - Math.exp(-dt * 10);
      const ev = snap?.ev ?? null;
      const on = ev?.st === 'on' ? ev : null;
      const key = on ? `${on.id}:${on.n}` : '';
      if (key !== at.init) {
        at.init = key;
        hide();
        if (on?.s) { at.sx = on.s.x; at.sz = on.s.z; }
        const f = on?.p?.find((p) => p.k === 'filch'), n = on?.p?.find((p) => p.k === 'norris');
        if (f) { at.fx = f.x; at.fz = f.z; at.ff = f.f; }
        if (n) { at.nx = n.x; at.nz = n.z; at.nf = n.f; }
        if (on?.px !== undefined) { at.px = on.px; at.pz = on.pz!; }
      }
      // the chests nobody has opened this term
      const open = new Set(snap?.cup?.ch ?? []);
      for (const [id, g] of chests) g.visible = open.has(id);
      if (!on) return;
      if (on.id === 'snitch' && on.s) {
        at.sx += (on.s.x - at.sx) * k; at.sz += (on.s.z - at.sz) * k;
        snitch.root.visible = true;
        snitch.root.position.set(at.sx, heightAt(at.sx, at.sz) + 2.6 + Math.sin(t * 2.3) * 0.8, at.sz);
        snitch.anim(t);
      }
      if (on.id === 'curfew' && on.p) {
        for (const p of on.p) {
          if (p.k === 'filch') {
            const px = at.fx, pz = at.fz;
            at.fx += (p.x - at.fx) * k; at.fz += (p.z - at.fz) * k;
            at.ff += Math.atan2(Math.sin(p.f - at.ff), Math.cos(p.f - at.ff)) * Math.min(1, dt * 8);
            filch.root.visible = true;
            filch.root.position.set(at.fx, heightAt(at.fx, at.fz), at.fz);
            filch.body.rotation.y = -at.ff;
            filch.update(dt, dt > 0 ? Math.hypot(at.fx - px, at.fz - pz) / dt : 0, false);
          } else {
            const px = at.nx, pz = at.nz;
            at.nx += (p.x - at.nx) * k; at.nz += (p.z - at.nz) * k;
            at.nf += Math.atan2(Math.sin(p.f - at.nf), Math.cos(p.f - at.nf)) * Math.min(1, dt * 8);
            norris.root.visible = true;
            norris.root.position.set(at.nx, heightAt(at.nx, at.nz), at.nz);
            norris.root.rotation.y = -at.nf;
            norris.anim(t, dt > 0 ? Math.hypot(at.nx - px, at.nz - pz) / dt : 0);
          }
        }
      }
      if (on.id === 'peeves' && on.px !== undefined) {
        at.px += (on.px - at.px) * k; at.pz += (on.pz! - at.pz) * k;
        peeves.m.root.visible = true;
        peeves.m.root.position.set(at.px, heightAt(at.px, at.pz) + 1.4 + Math.sin(t * 3) * 0.3, at.pz);
        peeves.m.body.rotation.y = t * 1.5;
        peeves.m.update(dt, 0, false);
        peeves.ink.visible = true;
        const r = on.r ?? 7;
        peeves.ink.scale.setScalar(r);
        peeves.ink.position.set(on.x ?? at.px, heightAt(on.x ?? at.px, on.z ?? at.pz) + 0.05, on.z ?? at.pz);
      }
      if (on.id === 'room') door.visible = true;
    },
    /** The shader warm-up (main.ts): everything shown for the compile, then hidden again until an event needs it. */
    warm(on: boolean) {
      if (!on) { hide(); at.init = ''; return; }
      for (const o of [snitch.root, filch.root, norris.root, peeves.m.root, peeves.ink, door]) o.visible = true;
    },
    /** The nearest closed chest within reach of `p` (the F prompt). */
    chestNear(p: { x: number; z: number }, open: readonly string[], reach = 2.4) {
      let best: (typeof CHESTS)[number] | null = null, bd = reach;
      for (const c of CHESTS) { if (!open.includes(c.id)) continue; const d = Math.hypot(c.x - p.x, c.z - p.z); if (d <= bd) { bd = d; best = c; } }
      return best;
    },
  };
}
