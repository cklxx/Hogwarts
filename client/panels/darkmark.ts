import * as THREE from 'three';

/**
 * 黑魔标记: the skull-and-serpent over the Dark Lord's head, drawn from the ink set's own symbol (index.html
 * #i-darkmark, one Path2D per element) into a canvas sprite like the name tags (models.ts Label): green ink with
 * a glow, depth test off so it shows through the canopy, hung on the wizard's root so it follows them (and is
 * gone with them when they leave your area; the HUD compass then points the way). Nothing in the 3D art changes.
 */
const INK: Record<string, { fill?: string; stroke?: string; width?: number }> = {
  s: { stroke: '#8dffa6', width: 2.6 },
  f: { fill: 'rgba(8, 42, 20, .82)' },
  f2: { fill: '#46e878' },
  t: { stroke: '#a8ffbb', width: 1.9 },
  p: { fill: '#07140b' },
};

function paint(c: CanvasRenderingContext2D) {
  const sym = document.getElementById('i-darkmark');
  c.clearRect(0, 0, 256, 256);
  if (!sym) return;
  c.save();
  c.translate(12, 12);
  c.scale(232 / 48, 232 / 48);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.shadowColor = 'rgba(90, 255, 150, .95)';
  c.shadowBlur = 16;
  for (const el of Array.from(sym.children)) {
    const d = el.getAttribute('d');
    if (!d) continue;
    const cls = (el.getAttribute('class') ?? '').split(/\s+/);
    const ink = INK[cls[0]];
    if (!ink) continue;
    const p = new Path2D(d);
    if (ink.fill) { c.fillStyle = ink.fill; c.fill(p); }
    if (ink.stroke) {
      c.strokeStyle = ink.stroke;
      c.lineWidth = (ink.width ?? 2) * (cls.includes('w2') ? 2.2 : cls.includes('w') ? 1.5 : 1);
      c.stroke(p);
    }
  }
  c.restore();
}

export function createDarkMark() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // not tone mapped and not fogged: the mark glows the same green by day, by night and through the forest's mist
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, fog: false, toneMapped: false });
  const sprite = new THREE.Sprite(mat);
  sprite.name = 'darkmark';
  sprite.scale.set(1.9, 1.9, 1);
  sprite.renderOrder = 11;
  let painted = false;
  let host: THREE.Object3D | null = null;
  return {
    /** Hang the mark over `root` (the Dark Lord's model, or null for nobody in view); `t` seconds for its drift. */
    update(root: THREE.Object3D | null, t: number) {
      if (root !== host) {
        sprite.removeFromParent();
        if (root) root.add(sprite);
        host = root;
      }
      if (!root) return;
      if (!painted) { paint(ctx); tex.needsUpdate = true; painted = true; }
      sprite.position.y = 4.5 + Math.sin(t * 1.3) * 0.15;
      mat.opacity = 0.82 + 0.18 * Math.sin(t * 2.1);
    },
  };
}
