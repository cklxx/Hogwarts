import * as THREE from 'three';
import { heightAt } from './terrain';

/**
 * Short-lived spell effects (rings, puffs, pillars of light, floating damage numbers, lightning), pooled.
 *
 * Each used to be a new geometry, a new material and (for numbers) a new canvas texture, disposed when it
 * faded: in a busy fight that is hundreds of allocations and texture uploads a second, and disposing the
 * last material of a kind freed its shader program, so the next one compiled it again. Now geometries are
 * shared, each kind keeps its finished meshes for reuse, and number textures are cached by text and colour
 * (damage numbers repeat). Visually nothing changed.
 */
type Effect = { obj: THREE.Object3D; t: number; life: number; update: (k: number, o: THREE.Object3D) => void; done: () => void };

export function createEffects(scene: THREE.Scene) {
  const live: Effect[] = [];
  const add = (obj: THREE.Object3D, life: number, update: Effect['update'], done: Effect['done']) => {
    scene.add(obj);
    live.push({ obj, t: 0, life, update, done });
  };
  /** A free list per kind: take() reuses a finished object or makes one. */
  const pool = <T extends THREE.Object3D>(make: () => T) => {
    const free: T[] = [];
    return { take: () => free.pop() ?? make(), give: (o: T) => { free.push(o); } };
  };

  const ringGeo = new THREE.RingGeometry(0.8, 1, 32);
  const rings = pool(() => {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    return m;
  });
  const puffGeo = new THREE.SphereGeometry(0.5, 10, 8);
  const puffs = pool(() => new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })));
  /** The pillar's alpha: fades out upward. */
  const fade = (() => {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, 'rgb(0,0,0)'); gr.addColorStop(0.55, 'rgb(40,40,40)'); gr.addColorStop(0.9, 'rgb(200,200,200)'); gr.addColorStop(1, 'rgb(255,255,255)');
    g.fillStyle = gr; g.fillRect(0, 0, 4, 64);
    return new THREE.CanvasTexture(c);
  })();
  const columnGeo = new THREE.CylinderGeometry(0.9, 1.05, 8, 20, 1, true);
  const columns = pool(() => new THREE.Mesh(columnGeo, new THREE.MeshBasicMaterial({ alphaMap: fade, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })));
  const texts = pool(() => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
    sp.scale.set(1.6, 0.8, 1);
    sp.renderOrder = 20;
    return sp;
  });
  /** Damage-number textures by text and colour, least recently used dropped beyond 96. */
  const textTex = new Map<string, THREE.CanvasTexture>();
  const inUse = new Map<THREE.Texture, number>();
  const textTexture = (text: string, color: string) => {
    const key = `${text}|${color}`;
    let t = textTex.get(key);
    if (t) { textTex.delete(key); textTex.set(key, t); return t; }
    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const g = c.getContext('2d')!;
    g.font = 'bold 44px Georgia'; g.textAlign = 'center';
    g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.85)'; g.strokeText(text, 64, 48);
    g.fillStyle = color; g.fillText(text, 64, 48);
    t = new THREE.CanvasTexture(c);
    textTex.set(key, t);
    for (const [k, old] of textTex) {
      if (textTex.size <= 96) break;
      if (inUse.get(old)) continue;
      textTex.delete(k);
      old.dispose();
    }
    return t;
  };
  const MAXPTS = 64;
  const lines = pool(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXPTS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ transparent: true }));
    l.frustumCulled = false;
    return l;
  });
  const va = new THREE.Vector3(), vb = new THREE.Vector3();

  return {
    get count() { return live.length; },
    ring(x: number, z: number, color: number, r0: number, r1: number, life: number, y = 0.2) {
      const m = rings.take();
      (m.material as THREE.MeshBasicMaterial).color.set(color);
      (m.material as THREE.MeshBasicMaterial).opacity = 1;
      m.position.set(x, y + heightAt(x, z), z);
      m.scale.setScalar(r0);
      add(m, life, (k, o) => { const s = r0 + (r1 - r0) * k; o.scale.set(s, s, s); (m.material as THREE.MeshBasicMaterial).opacity = 1 - k; }, () => rings.give(m));
    },
    puff(x: number, z: number, color: number, size = 1.5) {
      const m = puffs.take();
      (m.material as THREE.MeshBasicMaterial).color.set(color);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.8;
      m.position.set(x, 1.2 + heightAt(x, z), z);
      m.scale.setScalar(1);
      add(m, 0.5, (k, o) => { o.scale.setScalar(1 + k * size * 2); (m.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k); }, () => puffs.give(m));
    },
    /** A pillar of light that fades out upward (alpha gradient), widening as it dies. */
    column(x: number, z: number, color: number, life = 1.2) {
      const m = columns.take();
      (m.material as THREE.MeshBasicMaterial).color.set(color);
      (m.material as THREE.MeshBasicMaterial).opacity = 0;
      m.position.set(x, 4 + heightAt(x, z), z);
      m.scale.set(1, 1, 1);
      add(m, life, (k, o) => { (m.material as THREE.MeshBasicMaterial).opacity = 0.28 * (1 - k) * Math.min(1, k * 8); o.scale.x = o.scale.z = 1 + k * 0.6; }, () => columns.give(m));
    },
    floatText(x: number, z: number, text: string, color: string) {
      const sp = texts.take();
      const tex = textTexture(text, color);
      inUse.set(tex, (inUse.get(tex) ?? 0) + 1);
      sp.material.map = tex;
      sp.material.opacity = 1;
      const jx = (Math.random() - 0.5) * 0.8;
      const gy = heightAt(x, z);
      sp.position.set(x + jx, 2.4 + gy, z);
      add(sp, 1.1, (k, o) => { o.position.y = gy + 2.4 + k * 1.8; sp.material.opacity = 1 - k * k; }, () => { inUse.set(tex, (inUse.get(tex) ?? 1) - 1); texts.give(sp); });
    },
    /** A jagged bolt through the given x,z points (at chest height, or from the sky when `sky` > 0). */
    lightning(pts: number[], color: number, sky = 0) {
      const l = lines.take();
      const pos = l.geometry.getAttribute('position') as THREE.BufferAttribute;
      let n = 0;
      const at = (i: number, out: THREE.Vector3) => out.set(pts[i], heightAt(pts[i], pts[i + 1]) + (i === 0 && sky ? sky : 1.3), pts[i + 1]);
      for (let i = 0; i + 3 < pts.length && n < MAXPTS - 1; i += 2) {
        at(i, va); at(i + 2, vb);
        for (let k = 0; k < 6 && n < MAXPTS - 1; k++, n++) {
          const f = k / 6;
          pos.setXYZ(n, va.x + (vb.x - va.x) * f + (Math.random() - 0.5) * 0.6, va.y + (vb.y - va.y) * f + (Math.random() - 0.5) * 0.6, va.z + (vb.z - va.z) * f + (Math.random() - 0.5) * 0.6);
        }
      }
      if (pts.length >= 2) { at(pts.length - 2 - ((pts.length - 2) % 2), va); pos.setXYZ(n++, va.x, va.y, va.z); }
      pos.needsUpdate = true;
      l.geometry.setDrawRange(0, n);
      (l.material as THREE.LineBasicMaterial).color.set(color).multiplyScalar(4);
      (l.material as THREE.LineBasicMaterial).opacity = 1;
      add(l, 0.35, (k) => { (l.material as THREE.LineBasicMaterial).opacity = 1 - k; }, () => lines.give(l));
    },
    update(dt: number) {
      for (let i = live.length - 1; i >= 0; i--) {
        const e = live[i];
        e.t += dt;
        e.update(Math.min(1, e.t / e.life), e.obj);
        if (e.t >= e.life) {
          scene.remove(e.obj);
          live[i] = live[live.length - 1];
          live.pop();
          e.done();
        }
      }
    },
  };
}
