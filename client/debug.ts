import * as THREE from 'three';
import { BOLT_HEIGHT, STATIC_COLLIDERS, WORLD_EDGE, colliderCorners, statueCollider, type Collider } from '../src/shared/layout';
import { WORLD_HALF } from '../src/shared/map';
import { heightAt } from './terrain';

/**
 * `?debug=colliders`: outlines every collider the kernel resolves against (src/shared/layout.ts) over the
 * scene, at the foot of each thing and again at bolt height, drawn through walls. Magenta: stops walkers
 * and bolts; orange: stops walkers only (bolts fly over: tables, the lake); cyan: Ministers' statues (dynamic,
 * rebuilt when the decree list changes); yellow: the edge of the walkable world. Loaded on demand by main.ts.
 */
export function showColliders(scene: THREE.Scene, statues: () => number) {
  const mat = (color: number) => new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
  const solid = mat(0xff2bd6), low = mat(0xff9a1f), dyn = mat(0x2be8ff), edge = mat(0xffe23a);

  /** Ground-following outline points of a collider (closed loop). */
  const loop = (c: Collider): [number, number][] => {
    if (c.kind === 'disc') {
      const n = Math.max(12, Math.min(96, Math.ceil(c.r * 6)));
      return Array.from({ length: n }, (_, i) => [c.x + Math.cos((i / n) * Math.PI * 2) * c.r, c.z + Math.sin((i / n) * Math.PI * 2) * c.r]);
    }
    // subdivide long edges so the outline follows the ground
    const cs = colliderCorners(c), out: [number, number][] = [];
    cs.forEach((a, i) => {
      const b = cs[(i + 1) % cs.length], k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));
      for (let s = 0; s < k; s++) out.push([a[0] + ((b[0] - a[0]) * s) / k, a[1] + ((b[1] - a[1]) * s) / k]);
    });
    return out;
  };
  /** Line segments for a list of collider outlines: at the ground, at bolt height, and a few uprights. */
  const segments = (cs: Collider[]) => {
    const v: number[] = [];
    for (const c of cs) {
      const pts = loop(c), top = Math.min(c.h, BOLT_HEIGHT + 0.1);
      const levels = c.h >= BOLT_HEIGHT ? [0.12, top] : [0.12, Math.max(0.12, c.h)];
      for (const y of levels)
        pts.forEach((a, i) => {
          const b = pts[(i + 1) % pts.length];
          v.push(a[0], heightAt(a[0], a[1]) + y, a[1], b[0], heightAt(b[0], b[1]) + y, b[1]);
        });
      const step = Math.max(1, Math.floor(pts.length / 4));
      for (let i = 0; i < pts.length; i += step) {
        const [x, z] = pts[i], g = heightAt(x, z);
        v.push(x, g + levels[0], z, x, g + levels[1], z);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    return geo;
  };
  const add = (geo: THREE.BufferGeometry, m: THREE.Material) => {
    const l = new THREE.LineSegments(geo, m);
    l.renderOrder = 999;
    l.frustumCulled = false;
    scene.add(l);
    return l;
  };
  add(segments(STATIC_COLLIDERS.filter((c) => c.h >= BOLT_HEIGHT)), solid);
  add(segments(STATIC_COLLIDERS.filter((c) => c.h < BOLT_HEIGHT)), low);

  // the world's edge: the circle, clipped to the square
  const ev: number[] = [];
  const inside = (x: number, z: number) => Math.abs(x) <= WORLD_HALF && Math.abs(z) <= WORLD_HALF;
  const clamp = (v: number) => Math.max(-WORLD_HALF, Math.min(WORLD_HALF, v));
  const edgePt = (a: number): [number, number] => {
    const x = WORLD_EDGE.x + Math.cos(a) * WORLD_EDGE.r, z = WORLD_EDGE.z + Math.sin(a) * WORLD_EDGE.r;
    return inside(x, z) ? [x, z] : [clamp(x), clamp(z)];
  };
  for (let i = 0; i < 360; i++) {
    const [ax, az] = edgePt((i / 360) * Math.PI * 2), [bx, bz] = edgePt(((i + 1) / 360) * Math.PI * 2);
    ev.push(ax, heightAt(ax, az) + 0.3, az, bx, heightAt(bx, bz) + 0.3, bz);
  }
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.Float32BufferAttribute(ev, 3));
  add(eg, edge);

  // Ministers' statues: rebuilt whenever the count changes (the kernel does the same: World.syncSolids)
  let shown = -1, dynLines: THREE.LineSegments | null = null;
  const refresh = () => {
    const n = statues();
    if (n === shown) return;
    shown = n;
    if (dynLines) { scene.remove(dynLines); dynLines.geometry.dispose(); }
    dynLines = add(segments(Array.from({ length: n }, (_, i) => statueCollider(i))), dyn);
  };
  refresh();
  setInterval(refresh, 500);
}
