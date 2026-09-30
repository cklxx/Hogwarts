import * as THREE from 'three';

/**
 * A fixed budget of real point lights for the whole scene.
 *
 * three.js lights every lit fragment with every visible light, and compiles the light count into each
 * shader. The world makes point lights freely — torches, hut lamps, the Great Hall, a Lumos light in
 * every wizard's wand, a pool for spells in flight — so with 60 wizards online every pixel of the castle
 * looped over ~80 lights, and each wizard that came or went recompiled every material in the game (a
 * visible hitch). Here every point light in the scene becomes a *source*: it stays where it is (its code
 * still sets its intensity, colour and position) but is hidden, and each frame the `slots` sources that
 * matter most — lit, nearest the point of interest, relative to their range — are copied into `slots`
 * real lights that never come or go. The shader always sees the same count, so nothing recompiles, and
 * no pixel pays for lights on the far side of the map.
 */
export function createLightBudget(scene: THREE.Scene, slots: number) {
  const real: THREE.PointLight[] = [];
  const owned = new Set<THREE.Object3D>();
  const sources = new Set<THREE.PointLight>();
  /** Which source each real light shows (null: dark), kept from frame to frame so lights do not swap around. */
  const shown: (THREE.PointLight | null)[] = [];
  const pos = new Map<THREE.PointLight, THREE.Vector3>();
  /** This frame's candidates, nearest first: `nc` of the pooled entries in `cand` (nothing allocated per frame). */
  const cand: { s: THREE.PointLight; score: number }[] = [];
  let nc = 0;
  const keep = new Set<THREE.PointLight>();
  const consider = (s: THREE.PointLight) => {
    if (s.intensity <= 0 || !inScene(s)) return;
    const d = where(s).distanceTo(focusNow);
    const reach = s.distance > 0 ? s.distance : 40;
    if (d > reach + 60) return; // lights nothing near you
    // nearer first, a longer reach counts as nearer; the lights on screen now keep a small advantage
    const score = Math.max(0, d - reach) + d * 0.1 - (shown.includes(s) ? 3 : 0);
    const e = (cand[nc] ??= { s, score: 0.5 });
    e.s = s; e.score = score;
    let i = nc++;
    while (i > 0 && cand[i - 1].score > score) { cand[i] = cand[i - 1]; i--; }
    cand[i] = e;
  };
  let focusNow = new THREE.Vector3();

  function resize(n: number) {
    while (real.length < n) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.name = 'light-slot';
      owned.add(l);
      real.push(l);
      shown.push(null);
      scene.add(l);
    }
    while (real.length > n) { const l = real.pop()!; shown.pop(); owned.delete(l); scene.remove(l); l.dispose(); }
  }
  resize(slots);

  const inScene = (o: THREE.Object3D) => { let x: THREE.Object3D | null = o; while (x) { if (x === scene) return true; if (!x.visible && x !== o) return false; x = x.parent; } return false; };
  const where = (s: THREE.PointLight) => {
    let v = pos.get(s);
    if (!v) pos.set(s, (v = new THREE.Vector3()));
    // lights parented to the scene are placed by position; others (a wand tip) by last frame's world matrix
    return s.parent === scene ? v.copy(s.position) : v.setFromMatrixPosition(s.matrixWorld);
  };

  return {
    /** Real lights in use (change only with the graphics quality: it recompiles every lit material once). */
    get slots() { return real.length; },
    setSlots(n: number) { if (n !== real.length) resize(n); },
    /** Take over every point light under `root` (lights with children, like a lens-flare host, are left alone). */
    adopt(root: THREE.Object3D) {
      root.traverse((o) => { const l = o as THREE.PointLight; if (l.isPointLight && !owned.has(l) && !l.children.length) this.add(l); });
    },
    add(l: THREE.PointLight) { l.visible = false; sources.add(l); },
    remove(l: THREE.PointLight) {
      sources.delete(l);
      pos.delete(l);
      const i = shown.indexOf(l);
      if (i >= 0) { shown[i] = null; real[i].intensity = 0; }
    },
    /** Pick and copy the lights for this frame; `focus` is what the camera looks at (your wizard). */
    update(focus: THREE.Vector3) {
      nc = 0;
      focusNow = focus;
      sources.forEach(consider);
      const n = Math.min(nc, real.length);
      keep.clear();
      for (let i = 0; i < n; i++) keep.add(cand[i].s);
      // sources still chosen keep their slot; the rest fill the free ones
      for (let i = 0; i < shown.length; i++) if (shown[i] && !keep.has(shown[i]!)) shown[i] = null;
      keep.forEach((s) => {
        if (shown.includes(s)) return;
        const i = shown.indexOf(null);
        if (i >= 0) shown[i] = s;
      });
      for (let i = 0; i < real.length; i++) {
        const r = real[i], s = shown[i];
        if (!s) { r.intensity = 0; continue; }
        r.position.copy(pos.get(s)!);
        r.color.copy(s.color);
        r.intensity = s.intensity;
        r.distance = s.distance;
        r.decay = s.decay;
      }
    },
  };
}
export type LightBudget = ReturnType<typeof createLightBudget>;
