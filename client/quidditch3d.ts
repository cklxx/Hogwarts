import * as THREE from 'three';
import { heightAt } from './terrain';
import { makeSnitch } from './funworld';

/**
 * 魁地奇 in the world (src/kernel/quidditch.ts, the snapshot's `qd`): the Quaffle, the two Bludgers, the match's
 * Snitch, and a broom under everyone on the roster while they play. The kernel is flat (x, z); flying is drawn here:
 * `lift(handle)` is how high above the grass a player rides (main.ts adds it to the wizard's height), eased in and out.
 */
export interface QdSnap {
  s: [string, string]; sc: [number, number]; ph: 'call' | 'play' | 'done'; t: number;
  q: [number, number, string] | null; bl: [number, number][]; sn: [number, number] | null; sa: number;
  r: [string, number, number][]; w?: 0 | 1 | null; c?: string;
}

const RIDE = 3.2;
const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });

export function makeBroom() {
  const g = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.9, 6), std(0x6b4423));
  stick.rotation.x = Math.PI / 2;
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.62, 8, 1, true), std(0xc9a25a, { side: THREE.DoubleSide }));
  tail.rotation.x = -Math.PI / 2;
  tail.position.z = 1.1;
  g.add(stick, tail);
  return g;
}

export function createQuidditch3d(pos: (handle: string) => THREE.Vector3 | null, facing: (handle: string) => number) {
  const group = new THREE.Group();
  group.name = 'quidditch';
  const quaffle = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10), std(0xa3262a, { roughness: 0.8 }));
  const bludgers = [0, 1].map(() => new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 9), std(0x1d1d22, { metalness: 0.6, roughness: 0.35 })));
  const snitch = makeSnitch();
  group.add(quaffle, ...bludgers, snitch.root);
  const brooms = new Map<string, THREE.Group>();
  const lifts = new Map<string, number>();
  const at = { q: new THREE.Vector3(), b: [new THREE.Vector3(), new THREE.Vector3()], s: new THREE.Vector3(), init: false };
  let t = 0, riders = new Set<string>();
  const hideBalls = () => { quaffle.visible = false; for (const b of bludgers) b.visible = false; snitch.root.visible = false; };
  hideBalls();
  return {
    group,
    /** Metres above the grass this wizard rides now (0 when not flying). */
    lift(handle: string): number { return lifts.get(handle) ?? 0; },
    frame(dt: number, qd: QdSnap | undefined) {
      t += dt;
      const k = 1 - Math.exp(-dt * 10);
      const play = qd?.ph === 'play';
      riders = new Set(play ? qd!.r.map((r) => r[0]) : []);
      // ease each rider up (and back down after the whistle)
      for (const h of new Set([...lifts.keys(), ...riders])) {
        const want = riders.has(h) ? RIDE + Math.sin(t * 1.7 + h.length) * 0.25 : 0;
        const v = (lifts.get(h) ?? 0) + (want - (lifts.get(h) ?? 0)) * (1 - Math.exp(-dt * 3));
        if (!riders.has(h) && v < 0.02) { lifts.delete(h); continue; }
        lifts.set(h, v);
      }
      for (const [h, b] of brooms) if (!lifts.has(h)) { group.remove(b); brooms.delete(h); }
      for (const [h, v] of lifts) {
        const p = pos(h);
        if (!p) continue;
        let b = brooms.get(h);
        if (!b) { b = makeBroom(); brooms.set(h, b); group.add(b); }
        b.position.set(p.x, p.y + 0.62, p.z);
        b.rotation.y = facing(h);
        b.visible = v > 0.3;
      }
      if (!play) { hideBalls(); at.init = false; return; }
      const snapTo = !at.init;
      at.init = true;
      // the Quaffle: in the carrier's hands, else where the kernel says, floating at riding height
      if (qd!.q) {
        const [x, z, carrier] = qd!.q;
        const cp = carrier ? pos(carrier) : null;
        const target = cp ? new THREE.Vector3(cp.x, cp.y + 1.25, cp.z) : new THREE.Vector3(x, heightAt(x, z) + RIDE + 0.9, z);
        if (snapTo) at.q.copy(target); else at.q.lerp(target, cp ? 1 : k);
        quaffle.position.copy(at.q);
        quaffle.visible = true;
      } else quaffle.visible = false;
      qd!.bl.forEach(([x, z], i) => {
        const b = bludgers[i];
        if (!b) return;
        const target = new THREE.Vector3(x, heightAt(x, z) + RIDE + 1 + Math.sin(t * 5 + i) * 0.3, z);
        if (snapTo) at.b[i].copy(target); else at.b[i].lerp(target, k);
        b.position.copy(at.b[i]);
        b.visible = true;
      });
      for (let i = qd!.bl.length; i < bludgers.length; i++) bludgers[i].visible = false;
      if (qd!.sn) {
        const [x, z] = qd!.sn;
        const target = new THREE.Vector3(x, heightAt(x, z) + RIDE + 1.6 + Math.sin(t * 2.3) * 0.7, z);
        if (!snitch.root.visible) at.s.copy(target); else at.s.lerp(target, k);
        snitch.root.position.copy(at.s);
        snitch.root.visible = true;
        snitch.anim(t);
      } else snitch.root.visible = false;
    },
  };
}
