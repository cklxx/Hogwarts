import * as THREE from 'three';
import { tex as fileTex } from './assets';

/**
 * Every texture in the game is painted at startup on a <canvas> — no image assets.
 * Tricks used: seeded noise for variation, a height map reused as bumpMap for fake relief,
 * world-space UVs (see worldUV) so bricks stay brick-sized on any wall, and vertex-colour
 * macro variation on the ground to hide tiling.
 */

let seed = 1337;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const canvas = (size = 512) => {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!] as const;
};
function tex(c: HTMLCanvasElement, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const shade = (base: [number, number, number], k: number) => `rgb(${base.map((v) => Math.max(0, Math.min(255, Math.round(v * k)))).join(',')})`;
function speckle(g: CanvasRenderingContext2D, size: number, n: number, alpha: number) {
  for (let i = 0; i < n; i++) {
    const v = rnd() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${alpha * rnd()})`;
    g.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 2, 1 + rnd() * 2);
  }
}

/** Castle stone: staggered ashlar blocks, mortar, soot at the bottom of each block. */
function stone(base: [number, number, number]) {
  const S = 512;
  const [c, g] = canvas(S);
  const [hc, h] = canvas(S);
  g.fillStyle = '#5b5750';
  g.fillRect(0, 0, S, S);
  h.fillStyle = '#000';
  h.fillRect(0, 0, S, S);
  const rows = 8, bh = S / rows;
  for (let r = 0; r < rows; r++) {
    let x = r % 2 ? -bh : 0;
    while (x < S) {
      const bw = bh * (1.4 + rnd() * 1.2);
      const k = 0.8 + rnd() * 0.35;
      const grad = g.createLinearGradient(0, r * bh, 0, (r + 1) * bh);
      grad.addColorStop(0, shade(base, k * 1.08));
      grad.addColorStop(1, shade(base, k * 0.82));
      g.fillStyle = grad;
      g.fillRect(x + 3, r * bh + 3, bw - 6, bh - 6);
      const hv = (170 + rnd() * 60) | 0;
      h.fillStyle = `rgb(${hv},${hv},${hv})`;
      h.fillRect(x + 3, r * bh + 3, bw - 6, bh - 6);
      // wrap-around so the texture tiles horizontally
      if (x + bw > S) { g.fillRect(x + 3 - S, r * bh + 3, bw - 6, bh - 6); h.fillRect(x + 3 - S, r * bh + 3, bw - 6, bh - 6); }
      x += bw;
    }
  }
  speckle(g, S, 9000, 0.25);
  // moss creeping along the lower mortar lines
  for (let i = 0; i < 120; i++) {
    g.fillStyle = `rgba(70,95,50,${0.15 * rnd()})`;
    g.beginPath();
    g.arc(rnd() * S, Math.floor(rnd() * rows) * bh + bh - 2, 3 + rnd() * 8, 0, 7);
    g.fill();
  }
  return { map: tex(c), bump: tex(hc, false) };
}

/** Slate roof: overlapping scalloped tiles. */
function slate() {
  const S = 256;
  const [c, g] = canvas(S);
  g.fillStyle = '#1e2433';
  g.fillRect(0, 0, S, S);
  const rows = 8, th = S / rows, tw = S / 8;
  for (let r = 0; r < rows; r++)
    for (let i = -1; i < 9; i++) {
      const x = i * tw + (r % 2 ? tw / 2 : 0);
      g.fillStyle = shade([44, 52, 72], 0.75 + rnd() * 0.5);
      g.beginPath();
      g.moveTo(x + 1, r * th);
      g.lineTo(x + tw - 1, r * th);
      g.lineTo(x + tw - 1, r * th + th * 0.7);
      g.quadraticCurveTo(x + tw / 2, r * th + th * 1.15, x + 1, r * th + th * 0.7);
      g.fill();
    }
  speckle(g, S, 2000, 0.2);
  return tex(c);
}

/** Grass: dense short strokes of many greens. Tiles; macro variation comes from vertex colours. */
function grass() {
  const S = 512;
  const [c, g] = canvas(S);
  g.fillStyle = '#4a7436';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 26000; i++) {
    const x = rnd() * S, y = rnd() * S;
    g.strokeStyle = shade([70 + rnd() * 30, 115 + rnd() * 40, 50 + rnd() * 20], 0.7 + rnd() * 0.5);
    g.globalAlpha = 0.6;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 3, y - 3 - rnd() * 5);
    g.stroke();
  }
  g.globalAlpha = 1;
  for (let i = 0; i < 60; i++) {
    g.fillStyle = ['#e8e2a0', '#ffffff', '#c9a0e8'][i % 3];
    g.fillRect(rnd() * S, rnd() * S, 2, 2);
  }
  return tex(c);
}

/** Cobbles for paths and the courtyard. */
function cobbles() {
  const S = 256;
  const [c, g] = canvas(S);
  const [hc, h] = canvas(S);
  g.fillStyle = '#6d6250';
  g.fillRect(0, 0, S, S);
  h.fillStyle = '#000';
  h.fillRect(0, 0, S, S);
  for (let i = 0; i < 180; i++) {
    const x = rnd() * S, y = rnd() * S, r = 7 + rnd() * 9;
    for (const [dx, dy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
      g.fillStyle = shade([150, 138, 115], 0.7 + rnd() * 0.4);
      g.beginPath();
      g.ellipse(x + dx, y + dy, r, r * 0.8, rnd() * 3, 0, 7);
      g.fill();
      const rg = h.createRadialGradient(x + dx, y + dy, 1, x + dx, y + dy, r);
      rg.addColorStop(0, '#fff');
      rg.addColorStop(1, '#000');
      h.fillStyle = rg;
      h.beginPath();
      h.ellipse(x + dx, y + dy, r, r * 0.8, 0, 0, 7);
      h.fill();
    }
  }
  speckle(g, S, 3000, 0.2);
  return { map: tex(c), bump: tex(hc, false) };
}

/** Planks with grain. */
function wood() {
  const S = 256;
  const [c, g] = canvas(S);
  const n = 6, pw = S / n;
  for (let i = 0; i < n; i++) {
    g.fillStyle = shade([112, 76, 44], 0.75 + rnd() * 0.4);
    g.fillRect(i * pw, 0, pw, S);
    for (let k = 0; k < 40; k++) {
      g.strokeStyle = `rgba(40,20,5,${0.15 * rnd()})`;
      g.beginPath();
      const x = i * pw + rnd() * pw;
      g.moveTo(x, 0);
      g.bezierCurveTo(x + (rnd() - 0.5) * 8, S / 3, x + (rnd() - 0.5) * 8, (2 * S) / 3, x, S);
      g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,.45)';
    g.fillRect(i * pw, 0, 2, S);
  }
  return tex(c);
}

/** Hogsmeade Tudor plaster with timber framing. */
function tudor() {
  const S = 256;
  const [c, g] = canvas(S);
  g.fillStyle = '#d9ccaf';
  g.fillRect(0, 0, S, S);
  speckle(g, S, 4000, 0.15);
  g.fillStyle = '#4a3322';
  for (const x of [0, S / 2 - 6]) g.fillRect(x, 0, 12, S);
  g.fillRect(0, S / 2 - 6, S, 12);
  g.lineWidth = 10;
  g.strokeStyle = '#4a3322';
  g.beginPath(); g.moveTo(6, S / 2); g.lineTo(S / 2, 6); g.moveTo(S / 2, S / 2); g.lineTo(S, S); g.stroke();
  // a lit window
  g.fillStyle = '#ffd98a';
  g.fillRect(S * 0.62, S * 0.14, S * 0.22, S * 0.22);
  g.fillStyle = '#4a3322';
  g.fillRect(S * 0.72, S * 0.14, 4, S * 0.22);
  return tex(c);
}

/** Tileable water normal map from summed sine waves (for the Black Lake). */
export function waterNormals() {
  const S = 256;
  const [c, g] = canvas(S);
  const img = g.createImageData(S, S);
  const waves = Array.from({ length: 6 }, () => ({ kx: (1 + Math.floor(rnd() * 4)) * (rnd() < 0.5 ? -1 : 1), ky: 1 + Math.floor(rnd() * 4), a: 0.3 + rnd() * 0.7, p: rnd() * 7 }));
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let dx = 0, dy = 0;
      for (const w of waves) {
        const ph = ((w.kx * x + w.ky * y) / S) * Math.PI * 2 + w.p;
        dx += w.a * w.kx * Math.cos(ph);
        dy += w.a * w.ky * Math.cos(ph);
      }
      const nx = -dx * 0.08, ny = -dy * 0.08, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * S + x) * 4;
      img.data[i] = ((nx / l) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / l) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return tex(c, false);
}

/** A soft round glow sprite (candles, fireflies, lanterns, spell halos). */
export function glowSprite(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const [c, g] = canvas(64);
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, inner);
  rg.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.6)'));
  rg.addColorStop(1, outer);
  g.fillStyle = rg;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A house banner: field colour, gold trim, and the house initial in the middle. */
export function bannerTexture(color: string, letter: string) {
  const [c, g] = canvas(256);
  c.height = 512;
  g.fillStyle = color;
  g.fillRect(0, 0, 256, 512);
  g.strokeStyle = '#d4af37';
  g.lineWidth = 14;
  g.strokeRect(14, 14, 228, 484);
  g.fillStyle = '#d4af37';
  g.beginPath(); g.moveTo(0, 440); g.lineTo(128, 512); g.lineTo(256, 440); g.lineTo(256, 512); g.lineTo(0, 512); g.fill();
  g.font = 'bold 180px Georgia';
  g.textAlign = 'center';
  g.fillText(letter, 128, 290);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Scale a BoxGeometry's UVs so the texture repeats every `tile` metres on every face. */
export function worldUV(geo: THREE.BufferGeometry, w: number, h: number, d: number, tile: number) {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 verts each)
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++)
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile);
    }
  uv.needsUpdate = true;
  return geo;
}
/** Same idea for cylinders/cones: around = circumference, up = height. */
export function cylUV(geo: THREE.BufferGeometry, r: number, h: number, tile: number) {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * 2 * Math.PI * r) / tile, (uv.getY(i) * h) / tile);
  uv.needsUpdate = true;
  return geo;
}

export function makeMaterials() {
  const st = stone([150, 144, 132]);
  const dark = stone([112, 106, 98]);
  const cob = cobbles();
  const grassTex = grass();
  grassTex.repeat.set(90, 90);
  // Open-source PBR sets where we have them (procedural textures stay as fallbacks and for the rest).
  const stoneSet = () => ({
    map: fileTex('stone_color.webp', { fallback: st.map }),
    normalMap: fileTex('stone_normal.webp', { srgb: false }),
    roughnessMap: fileTex('stone_rough.webp', { srgb: false }),
    aoMap: fileTex('stone_ao.webp', { srgb: false }),
  });
  const grassFile = fileTex('grass_color.webp', { fallback: grassTex, repeat: 110 });
  const woodSet = { map: fileTex('wood_color.webp', { fallback: wood() }), bumpMap: fileTex('wood_bump.webp', { srgb: false }), roughnessMap: fileTex('wood_rough.webp', { srgb: false }) };
  const flag = stoneSet();
  for (const t of Object.values(flag)) t.repeat.set(0.5, 0.5);
  return {
    stone: new THREE.MeshStandardMaterial({ ...stoneSet(), normalScale: new THREE.Vector2(1.2, 1.2), aoMapIntensity: 0.8 }),
    darkStone: new THREE.MeshStandardMaterial({ ...stoneSet(), color: 0x8f8a84, normalScale: new THREE.Vector2(1.2, 1.2) }),
    roof: new THREE.MeshStandardMaterial({ map: slate(), roughness: 0.6, metalness: 0.1 }),
    grass: new THREE.MeshStandardMaterial({ map: grassFile, vertexColors: true, roughness: 1 }),
    path: new THREE.MeshStandardMaterial({ map: fileTex('gravel_color.webp', { fallback: cob.map }), bumpMap: cob.bump, bumpScale: 1.5, roughness: 0.95 }),
    flagstone: new THREE.MeshStandardMaterial({ ...flag, color: 0xb8b0a4, roughness: 0.85 }),
    wood: new THREE.MeshStandardMaterial({ ...woodSet, bumpScale: 1.5 }),
    tudor: new THREE.MeshStandardMaterial({ map: tudor(), roughness: 0.9, emissive: 0x000000 }),
    rock: new THREE.MeshStandardMaterial({ map: fileTex('rock_color.webp'), roughness: 0.95 }),
    sand: new THREE.MeshStandardMaterial({ map: fileTex('sand_color.webp', { repeat: 30 }), roughness: 1 }),
    moss: new THREE.MeshStandardMaterial({ map: fileTex('moss_color.webp'), roughness: 1 }),
  };
}
