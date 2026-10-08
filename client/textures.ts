import * as THREE from 'three';
import { tex as fileTex } from './assets';

/**
 * Surface textures, painted at startup on a <canvas>. The default storybook look (see STYLE below)
 * paints them like an illustration: broad brush strokes and soft washes in a small palette per
 * material. ?style=real swaps in the CC0 photo sets (assets.ts), with the older procedural textures
 * here as their fallbacks. Tricks used either way: seeded noise for variation, a height map reused
 * as bumpMap for relief, world-space UVs (see worldUV) so blocks stay block-sized on any wall, and
 * vertex-colour macro variation on the ground to hide tiling.
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
/**
 * A texture for sprites / UI quads (labels, signs, banners, glow sprites): never tiles and is
 * rarely minified, so mipmaps are pure waste (x1.33 memory) — disable them (docs/PERF.md 2026-10-06).
 */
export function spriteTex(c: HTMLCanvasElement, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  t.anisotropy = 4;
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
  return spriteTex(c);
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
  return spriteTex(c); // banner 永不平铺：去 mipmap（省 x1.33 显存），srgb 保持
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


// ------------------------------------------------------------------ storybook (painted) textures
/**
 * The art direction. 'storybook' (default): hand-painted canvas textures in limited palettes, a soft
 * toon light ramp, a painted sky and ink outlines (render.ts). 'real' (?style=real): the CC0 photo
 * texture sets and HDRI light the game used before (client/public/textures/CREDITS.md).
 */
export const STYLE: 'storybook' | 'real' = typeof location !== 'undefined' && new URLSearchParams(location.search).get('style') === 'real' ? 'real' : 'storybook';
export const STORYBOOK = STYLE === 'storybook';

/** Mark a material as a character's: it gets the storybook rim light (render.ts; a no-op in ?style=real). */
export function rimLit<T extends THREE.Material>(m: T): T {
  if (STORYBOOK && (m as unknown as THREE.MeshStandardMaterial).isMeshStandardMaterial && !m.defines?.STORY_RIM) {
    m.defines = { ...m.defines, STORY_RIM: '' };
    m.needsUpdate = true;
  }
  return m;
}

type RGB = [number, number, number];
const hexRGB = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const paint = (c: RGB, a = 1, k = 1) => `rgba(${c.map((v) => Math.max(0, Math.min(255, Math.round(v * k)))).join(',')},${a})`;
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
const pal = (...h: string[]) => h.map(hexRGB);
/** Call `draw` at (x, y) and at every wrapped copy that reaches into the S x S tile, so strokes tile seamlessly. */
function tiled(S: number, x: number, y: number, r: number, draw: (x: number, y: number) => void) {
  for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
    const X = x + dx, Y = y + dy;
    if (X + r >= 0 && X - r <= S && Y + r >= 0 && Y - r <= S) draw(X, Y);
  }
}
/** One brush stroke: a slightly curved, round-ended line. */
function brush(g: CanvasRenderingContext2D, x: number, y: number, len: number, w: number, ang: number, col: string) {
  const dx = (Math.cos(ang) * len) / 2, dy = (Math.sin(ang) * len) / 2, bend = (rnd() - 0.5) * 0.5;
  g.strokeStyle = col;
  g.lineWidth = w;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x - dx, y - dy);
  g.quadraticCurveTo(x - dy * bend, y + dx * bend, x + dx, y + dy);
  g.stroke();
}
/** Many strokes scattered over the tile (wrapping). */
function strokes(g: CanvasRenderingContext2D, S: number, n: number, cols: RGB[], o: { len: [number, number]; w: [number, number]; ang: () => number; alpha: number; k?: [number, number] }) {
  for (let i = 0; i < n; i++) {
    const len = o.len[0] + rnd() * (o.len[1] - o.len[0]), w = o.w[0] + rnd() * (o.w[1] - o.w[0]), a = o.ang();
    const col = paint(pick(cols), o.alpha * (0.6 + 0.4 * rnd()), o.k ? o.k[0] + rnd() * (o.k[1] - o.k[0]) : 1);
    tiled(S, rnd() * S, rnd() * S, len, (X, Y) => brush(g, X, Y, len, w, a, col));
  }
}
/** Soft round washes of colour: the painted equivalent of low-frequency value noise. */
function washes(g: CanvasRenderingContext2D, S: number, n: number, cols: RGB[], r: [number, number], alpha: number) {
  for (let i = 0; i < n; i++) {
    const rad = r[0] + rnd() * (r[1] - r[0]), c = pick(cols), a = alpha * (0.5 + 0.5 * rnd());
    tiled(S, rnd() * S, rnd() * S, rad, (X, Y) => {
      const gr = g.createRadialGradient(X, Y, 0, X, Y, rad);
      gr.addColorStop(0, paint(c, a));
      gr.addColorStop(0.6, paint(c, a * 0.6));
      gr.addColorStop(1, paint(c, 0));
      g.fillStyle = gr;
      g.fillRect(X - rad, Y - rad, rad * 2, rad * 2);
    });
  }
}
/** Random widths that add up to exactly `total` (so a course of blocks tiles). */
function spans(total: number, mean: number, jitter: number) {
  const n = Math.max(1, Math.round(total / mean));
  const w = Array.from({ length: n }, () => 1 - jitter + rnd() * jitter * 2);
  const s = w.reduce((a, b) => a + b, 0);
  return w.map((x) => (x / s) * total);
}

/**
 * Dressed limestone: broad, quiet faces and fine recessed joints. Edge wear stays narrow, so
 * the stone reads as cut masonry rather than rows of rounded cushions at the playing camera.
 */
function paintedStone(colors: string[], mortar: string, o: { S?: number; rows?: number; lichen?: number; light?: string; shade?: string } = {}) {
  const S = o.S ?? 512, rows = o.rows ?? 8, bh = S / rows;
  const [c, g] = canvas(S);
  const [hc, h] = canvas(S);
  const P = pal(...colors), lit = hexRGB(o.light ?? '#fff1cf'), dim = hexRGB(o.shade ?? '#4a2f1a');
  g.fillStyle = mortar;
  g.fillRect(0, 0, S, S);
  h.fillStyle = '#909090';
  h.fillRect(0, 0, S, S);
  const m = Math.max(1, S / 340);
  for (let r = 0; r < rows; r++) {
    let x = (r % 2 ? bh * 0.8 : 0) + rnd() * bh * 0.3;
    for (const bw of spans(S, bh * 1.9, 0.35)) {
      const base = pick(P), k = 0.96 + rnd() * 0.08, y0 = r * bh + m, hh = bh - m * 2, w = bw - m * 2, hv = (184 + rnd() * 8) | 0;
      const block = (X: number) => {
        const x0 = X + m;
        g.save();
        g.beginPath();
        g.roundRect(x0, y0, w, hh, m);
        g.fillStyle = paint(base, 1, k);
        g.fill();
        g.clip();
        for (let i = 0; i < 6; i++) brush(g, x0 + rnd() * w, y0 + rnd() * hh, w * (0.35 + rnd() * 0.5), hh * (0.2 + rnd() * 0.3), (rnd() - 0.5) * 0.25, paint(base, 0.25, k * (0.94 + rnd() * 0.12)));
        const lg = g.createLinearGradient(0, y0, 0, y0 + hh);
        lg.addColorStop(0, paint(lit, 0.18));
        lg.addColorStop(0.04, paint(lit, 0));
        lg.addColorStop(0.96, paint(dim, 0));
        lg.addColorStop(1, paint(dim, 0.16));
        g.fillStyle = lg;
        g.fillRect(x0, y0, w, hh);
        g.restore();
        h.fillStyle = `rgb(${hv},${hv},${hv})`;
        h.beginPath();
        h.roundRect(x0, y0, w, hh, m);
        h.fill();
      };
      const xs = x % S;
      block(xs);
      if (xs + bw > S) block(xs - S);
      x += bw;
    }
  }
  // lichen and weathering dabs, soft value washes over the whole wall
  strokes(g, S, o.lichen ?? 40, pal('#7d8a46', '#94925a', '#6b7a3e'), { len: [4, 12], w: [2, 5], ang: () => rnd() * 6.28, alpha: 0.12 });
  washes(g, S, 26, pal('#e8dfcd', '#6c6254'), [S * 0.06, S * 0.18], 0.06);
  return { map: tex(c), bump: tex(hc, false) };
}

/** Slate-blue scalloped shingles, each with a lit lower lip; upper courses overlap the lower ones. */
function paintedSlate() {
  const S = 256, rows = 8, th = S / rows, tw = S / 8;
  const [c, g] = canvas(S);
  g.fillStyle = '#1d2a42';
  g.fillRect(0, 0, S, S);
  const P = pal('#3e5e8a', '#48699a', '#34507a', '#5577a6', '#40608e', '#2f4a72');
  const lip = hexRGB('#9ab6da');
  const row = (r: number, dy: number) => {
    for (let i = -1; i < 9; i++) {
      const x = i * tw + (r % 2 ? tw / 2 : 0), y = r * th + dy, base = pick(P), k = 0.88 + rnd() * 0.24;
      g.beginPath();
      g.moveTo(x + 1, y);
      g.lineTo(x + tw - 1, y);
      g.lineTo(x + tw - 1, y + th * 0.72);
      g.quadraticCurveTo(x + tw / 2, y + th * 1.2, x + 1, y + th * 0.72);
      g.closePath();
      g.fillStyle = paint(base, 1, k);
      g.fill();
      g.save();
      g.clip();
      brush(g, x + tw * 0.5, y + th * 0.35, tw * 0.7, th * 0.35, (rnd() - 0.5) * 0.4, paint(base, 0.4, k * 1.12));
      g.restore();
      g.strokeStyle = paint(lip, 0.55);
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(x + 3, y + th * 0.78);
      g.quadraticCurveTo(x + tw / 2, y + th * 1.12, x + tw - 3, y + th * 0.78);
      g.stroke();
    }
  };
  for (let r = rows - 1; r >= 0; r--) row(r, 0);
  row(rows - 1, -S); // the bottom course's lips wrap onto the top of the tile
  washes(g, S, 14, pal('#8fb0dc', '#101a30'), [20, 50], 0.12);
  return tex(c);
}

/** Deep green meadow: broad washes of several greens under short upright brush strokes. */
function paintedGrass() {
  const S = 512;
  const [c, g] = canvas(S);
  g.fillStyle = '#3a6230';
  g.fillRect(0, 0, S, S);
  washes(g, S, 70, pal('#2f5728', '#467238', '#2a4d26', '#527c3a', '#365e3a'), [30, 90], 0.45);
  const up = () => -Math.PI / 2 + (rnd() - 0.5) * 0.9;
  strokes(g, S, 2600, pal('#2b5024', '#38622e', '#447135', '#52803c'), { len: [8, 20], w: [2.5, 5], ang: up, alpha: 0.55 });
  strokes(g, S, 900, pal('#6c9a46', '#7fa851', '#5f8c44'), { len: [6, 14], w: [1.5, 3], ang: up, alpha: 0.45 });
  strokes(g, S, 500, pal('#1f3c1c', '#1a341a'), { len: [6, 12], w: [2, 3.5], ang: up, alpha: 0.4 });
  // a few painted flowers
  for (let i = 0; i < 70; i++) {
    const col = ['#e6dcae', '#d9d2c0', '#b79ad6', '#e0b957'][i % 4];
    tiled(S, rnd() * S, rnd() * S, 3, (X, Y) => { g.fillStyle = col; g.beginPath(); g.arc(X, Y, 1.6 + rnd(), 0, 7); g.fill(); });
  }
  return tex(c);
}

/** A beaten-earth path strewn with round painted pebbles. */
function paintedPath() {
  const S = 256;
  const [c, g] = canvas(S);
  const [hc, h] = canvas(S);
  g.fillStyle = '#a88a62';
  g.fillRect(0, 0, S, S);
  h.fillStyle = '#000';
  h.fillRect(0, 0, S, S);
  washes(g, S, 30, pal('#b99c70', '#957650', '#c2a77c'), [20, 50], 0.5);
  const P = pal('#c7ab80', '#b39668', '#d6bf94', '#9f825a', '#bfa47c');
  for (let i = 0; i < 150; i++) {
    const r = 4 + rnd() * 8, base = pick(P), a = rnd() * 3;
    tiled(S, rnd() * S, rnd() * S, r + 2, (X, Y) => {
      g.fillStyle = 'rgba(80,58,34,0.45)';
      g.beginPath(); g.ellipse(X + 1, Y + 1.5, r * 1.05, r * 0.82, a, 0, 7); g.fill();
      g.fillStyle = paint(base);
      g.beginPath(); g.ellipse(X, Y, r, r * 0.78, a, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,245,220,0.35)';
      g.beginPath(); g.ellipse(X - r * 0.25, Y - r * 0.25, r * 0.45, r * 0.3, a, 0, 7); g.fill();
      h.fillStyle = '#fff';
      h.beginPath(); h.ellipse(X, Y, r, r * 0.78, a, 0, 7); h.fill();
    });
  }
  strokes(g, S, 200, pal('#6e5234', '#e0cda6'), { len: [3, 8], w: [1, 2.5], ang: () => rnd() * 6.28, alpha: 0.35 });
  return { map: tex(c), bump: tex(hc, false) };
}

/** Big courtyard flags: warm grey-honey slabs with lit edges. */
function paintedFlags() {
  const S = 512, n = 5, cell = S / n;
  const [c, g] = canvas(S);
  g.fillStyle = '#5e4c3a';
  g.fillRect(0, 0, S, S);
  const P = pal('#b9a281', '#aa9275', '#c4ae8c', '#a08a6e', '#b39a78');
  const lit = hexRGB('#fff0d0'), dim = hexRGB('#3e2c1c');
  for (let r = 0; r < n; r++) {
    let x = r % 2 ? cell * 0.5 : 0;
    for (const w of spans(S, cell, 0.3)) {
      const base = pick(P), k = 0.9 + rnd() * 0.2, y0 = r * cell + 4, hh = cell - 8;
      const slab = (X: number) => {
        g.save();
        g.beginPath();
        g.roundRect(X + 4, y0, w - 8, hh, 10);
        g.fillStyle = paint(base, 1, k);
        g.fill();
        g.clip();
        for (let i = 0; i < 7; i++) brush(g, X + rnd() * w, y0 + rnd() * hh, w * (0.3 + rnd() * 0.4), hh * (0.15 + rnd() * 0.25), rnd() * 6.28, paint(base, 0.4, k * (0.85 + rnd() * 0.3)));
        const lg = g.createLinearGradient(0, y0, 0, y0 + hh);
        lg.addColorStop(0, paint(lit, 0.3)); lg.addColorStop(0.2, paint(lit, 0)); lg.addColorStop(0.8, paint(dim, 0)); lg.addColorStop(1, paint(dim, 0.35));
        g.fillStyle = lg;
        g.fillRect(X, y0, w, hh);
        g.restore();
      };
      const xs = x % S;
      slab(xs);
      if (xs + w > S) slab(xs - S);
      x += w;
    }
  }
  strokes(g, S, 120, pal('#7d8a46', '#6b7a3e'), { len: [4, 10], w: [2, 4], ang: () => rnd() * 6.28, alpha: 0.3 });
  return tex(c);
}

/** Broad walnut boards: understated grain, fine seams and staggered end joints. */
function paintedWood() {
  const S = 256, n = 4, pw = S / n;
  const [c, g] = canvas(S);
  const P = pal('#705239', '#6c4e36', '#795a40', '#72533a');
  for (let i = 0; i < n; i++) {
    const base = pick(P), k = 0.97 + rnd() * 0.06;
    g.fillStyle = paint(base, 1, k);
    g.fillRect(i * pw, 0, pw, S);
    for (let s = 0; s < 5; s++) {
      const x = i * pw + 5 + rnd() * (pw - 10), len = S * (0.4 + rnd() * 0.5), y = rnd() * S;
      const col = rnd() < 0.4 ? paint(hexRGB('#b69a70'), 0.1) : paint(hexRGB('#463426'), 0.12);
      const w = 4 + rnd() * 3;
      tiled(S, x, y, len, (X, Y) => brush(g, X, Y, len, w, Math.PI / 2 + (rnd() - 0.5) * 0.04, col));
    }
    // Fine flowing fibres sit inside the broad board tone, not bright scratches across it.
    g.strokeStyle = 'rgba(42,29,19,0.2)';
    g.lineWidth = 0.65;
    for (let s = 0; s < 12; s++) {
      const x = i * pw + 5 + rnd() * (pw - 10), bend = (rnd() - 0.5) * 6;
      g.beginPath(); g.moveTo(x, 0);
      g.bezierCurveTo(x + bend, S / 3, x - bend, S * 2 / 3, x, S);
      g.stroke();
    }
    g.fillStyle = 'rgba(35,27,20,0.45)';
    g.fillRect(i * pw, 0, 1.5, S);
    const joint = Math.round(S * (0.15 + rnd() * 0.7));
    g.fillRect(i * pw, joint, pw, 1.5);
    g.fillStyle = 'rgba(222,203,169,0.16)';
    g.fillRect(i * pw + 1.5, 0, 1, S);
    g.fillRect(i * pw + 1.5, joint + 1.5, pw - 1.5, 1);
  }
  return tex(c);
}

/** Hogsmeade: cream plaster laid on in strokes, dark timber framing, a warm lit window. */
function paintedTudor() {
  const S = 256;
  const [c, g] = canvas(S);
  g.fillStyle = '#e4d3ae';
  g.fillRect(0, 0, S, S);
  washes(g, S, 20, pal('#f2e4c4', '#cdb88e', '#e9d9b4'), [20, 50], 0.5);
  strokes(g, S, 260, pal('#efe0bc', '#d6c298'), { len: [10, 26], w: [4, 8], ang: () => (rnd() - 0.5) * 0.6, alpha: 0.35 });
  const timber = '#4a2f1d';
  g.fillStyle = timber;
  for (const x of [0, S / 2 - 7]) g.fillRect(x, 0, 14, S);
  g.fillRect(0, S / 2 - 7, S, 14);
  g.lineWidth = 11;
  g.strokeStyle = timber;
  g.lineCap = 'butt';
  g.beginPath(); g.moveTo(7, S / 2); g.lineTo(S / 2, 7); g.moveTo(S / 2, S / 2); g.lineTo(S, S); g.stroke();
  strokes(g, S, 60, pal('#6a4630', '#2e1c10'), { len: [10, 30], w: [2, 3], ang: () => (rnd() < 0.5 ? 0 : Math.PI / 2), alpha: 0.35 });
  // a lit window with a painted glow around it
  const wx = S * 0.62, wy = S * 0.14, ws = S * 0.22;
  const gl = g.createRadialGradient(wx + ws / 2, wy + ws / 2, 2, wx + ws / 2, wy + ws / 2, ws);
  gl.addColorStop(0, 'rgba(255,214,140,0.5)'); gl.addColorStop(1, 'rgba(255,214,140,0)');
  g.fillStyle = gl;
  g.fillRect(wx - ws / 2, wy - ws / 2, ws * 2, ws * 2);
  g.fillStyle = '#ffd98a';
  g.fillRect(wx, wy, ws, ws);
  g.fillStyle = timber;
  g.fillRect(wx + ws / 2 - 2, wy, 4, ws);
  g.fillRect(wx, wy + ws / 2 - 2, ws, 4);
  return tex(c);
}

/** Grey-violet rock in broad, faceted diagonal strokes (crags, Azkaban, the Highlands). */
function paintedRock() {
  const S = 512;
  const [c, g] = canvas(S);
  g.fillStyle = '#8a8288';
  g.fillRect(0, 0, S, S);
  washes(g, S, 40, pal('#9a9096', '#716a74', '#a89c90', '#7c7480'), [40, 110], 0.5);
  strokes(g, S, 700, pal('#9d9398', '#b3a89c', '#7a727c', '#655f6a'), { len: [16, 44], w: [6, 14], ang: () => -0.6 + (rnd() - 0.5) * 0.7, alpha: 0.45 });
  strokes(g, S, 260, pal('#4e4854', '#57505e'), { len: [10, 30], w: [1.5, 3], ang: () => -0.6 + (rnd() - 0.5) * 1.4, alpha: 0.5 });
  strokes(g, S, 200, pal('#cbbfae', '#d8ccb8'), { len: [8, 20], w: [2, 4], ang: () => -0.6 + (rnd() - 0.5) * 0.5, alpha: 0.35 });
  return tex(c);
}

/** Warm lakeshore sand with soft dabs. */
function paintedSand() {
  const S = 256;
  const [c, g] = canvas(S);
  g.fillStyle = '#d4bc8c';
  g.fillRect(0, 0, S, S);
  washes(g, S, 30, pal('#e0cb9c', '#c2a878', '#d9c49a'), [20, 60], 0.5);
  strokes(g, S, 500, pal('#e6d3a8', '#b89d6e', '#cdb384'), { len: [4, 12], w: [2, 4], ang: () => (rnd() - 0.5) * 0.8, alpha: 0.45 });
  return tex(c);
}

/** Soft painted cloud billboards (4 shapes in a 2 x 2 atlas): red = how lit, alpha = cover. */
export function paintedClouds() {
  const S = 512, H = S / 2;
  const [c, g] = canvas(S);
  g.clearRect(0, 0, S, S);
  for (let q = 0; q < 4; q++) {
    const ox = (q % 2) * H, oy = Math.floor(q / 2) * H;
    const [pc, p] = canvas(H); // each cloud on its own layer, then stamped into the atlas
    p.clearRect(0, 0, H, H);
    // a long, low bank of soft puffs, taller in the middle, with a few small ones breaking the top
    const puffs = 7 + Math.floor(rnd() * 4);
    const puff = (x: number, y: number, r: number) => {
      const gr = p.createRadialGradient(x - r * 0.2, y - r * 0.3, r * 0.05, x, y, r);
      gr.addColorStop(0, 'rgba(255,0,0,0.95)');
      gr.addColorStop(0.5, 'rgba(240,0,0,0.8)');
      gr.addColorStop(1, 'rgba(210,0,0,0)');
      p.fillStyle = gr;
      p.beginPath(); p.arc(x, y, r, 0, 7); p.fill();
    };
    for (let i = 0; i < puffs; i++) {
      const t = i / (puffs - 1);
      const r = H * (0.1 + 0.13 * Math.sin(t * Math.PI) + rnd() * 0.05);
      puff(H * (0.14 + 0.72 * t) + (rnd() - 0.5) * H * 0.05, H * 0.6 - r * (0.25 + rnd() * 0.35), r);
    }
    for (let i = 0; i < 5; i++) puff(H * (0.25 + rnd() * 0.5), H * (0.3 + rnd() * 0.15), H * (0.05 + rnd() * 0.05));
    // shade the belly (the shader turns low red into the shadow colour) and soften the flat base away
    p.globalCompositeOperation = 'source-atop';
    const bg = p.createLinearGradient(0, H * 0.3, 0, H * 0.64);
    bg.addColorStop(0, 'rgba(90,0,0,0)');
    bg.addColorStop(1, 'rgba(90,0,0,0.85)');
    p.fillStyle = bg;
    p.fillRect(0, H * 0.3, H, H * 0.4);
    p.globalCompositeOperation = 'destination-out';
    const cut = p.createLinearGradient(0, H * 0.58, 0, H * 0.68);
    cut.addColorStop(0, 'rgba(0,0,0,0)');
    cut.addColorStop(1, 'rgba(0,0,0,1)');
    p.fillStyle = cut;
    p.fillRect(0, H * 0.58, H, H * 0.42);
    p.globalCompositeOperation = 'source-over';
    g.drawImage(pc, ox, oy);
  }
  return new THREE.CanvasTexture(c);
}

/** A painted moon: a cream disc with soft grey seas, inside a wide pale halo. */
export function paintedMoon() {
  const S = 256, R = S * 0.16;
  const [c, g] = canvas(S);
  const halo = g.createRadialGradient(S / 2, S / 2, R * 0.8, S / 2, S / 2, S / 2);
  halo.addColorStop(0, 'rgba(210,222,255,0.55)');
  halo.addColorStop(0.35, 'rgba(160,180,255,0.16)');
  halo.addColorStop(1, 'rgba(140,160,255,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#fbf3da';
  g.beginPath(); g.arc(S / 2, S / 2, R, 0, 7); g.fill();
  g.save();
  g.beginPath(); g.arc(S / 2, S / 2, R, 0, 7); g.clip();
  for (let i = 0; i < 7; i++) {
    g.fillStyle = `rgba(170,165,160,${0.18 + rnd() * 0.2})`;
    g.beginPath(); g.arc(S / 2 + (rnd() - 0.5) * R * 1.3, S / 2 + (rnd() - 0.5) * R * 1.3, R * (0.12 + rnd() * 0.25), 0, 7); g.fill();
  }
  const sh = g.createRadialGradient(S / 2 + R * 0.5, S / 2 + R * 0.3, R * 0.2, S / 2, S / 2, R * 1.1);
  sh.addColorStop(0, 'rgba(90,100,150,0)');
  sh.addColorStop(1, 'rgba(90,100,150,0.35)');
  g.fillStyle = sh;
  g.fillRect(0, 0, S, S);
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A painted ice sheet: pale blue-white with drifting snow dust, crack veins and a soft marbled wash. */
export function paintedIce() {
  const S = 512;
  const [c, g] = canvas(S);
  // base wash: pale ice blue, a touch deeper toward the rim
  const base = g.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.55);
  base.addColorStop(0, '#dceef7');
  base.addColorStop(0.7, '#c3dfee');
  base.addColorStop(1, '#a9cde4');
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  // marbled wash: broad soft strokes of white and deeper blue
  for (let i = 0; i < 40; i++) {
    const x = rnd() * S, y = rnd() * S, r = S * (0.04 + rnd() * 0.12);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const white = rnd() < 0.6;
    gr.addColorStop(0, white ? 'rgba(255,255,255,0.16)' : 'rgba(120,170,210,0.14)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  // crack veins: jagged white-blue polylines wandering across the sheet
  for (let i = 0; i < 14; i++) {
    let x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI * 2;
    g.strokeStyle = `rgba(240,250,255,${0.35 + rnd() * 0.3})`;
    g.lineWidth = 1 + rnd() * 1.6;
    g.beginPath(); g.moveTo(x, y);
    const segs = 6 + Math.floor(rnd() * 8);
    for (let s = 0; s < segs; s++) {
      a += (rnd() - 0.5) * 1.1;
      const len = S * (0.03 + rnd() * 0.06);
      x += Math.cos(a) * len; y += Math.sin(a) * len;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // snow dust: soft white speckles
  speckle(g, S, 900, 0.10);
  const t = tex(c);
  return t;
}

/** The world's surface materials in the current STYLE. */
export function makeMaterials() {
  return STORYBOOK ? storybookMaterials() : realMaterials();
}

function storybookMaterials() {
  // Warm grey limestone, with a darker dressed stone for trim and window frames.
  const st = paintedStone(['#cbb498', '#c4ad92', '#d3bda2', '#c8b196', '#cfb99d', '#c6af94'], '#91826b');
  const dk = paintedStone(['#887f70', '#807768', '#918777', '#827969'], '#5f584e', { S: 256, rows: 4, lichen: 20, light: '#ded4bf', shade: '#49443c' });
  const grassTex = paintedGrass();
  grassTex.repeat.set(52, 52); // ~12 m per tile: big enough for the strokes to read as brushwork
  const path = paintedPath();
  const flags = paintedFlags();
  flags.repeat.set(0.5, 0.5);
  const sand = paintedSand();
  sand.repeat.set(30, 30);
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...p });
  return {
    stone: std({ map: st.map, bumpMap: st.bump, bumpScale: 0.18 }),
    darkStone: std({ map: dk.map, bumpMap: dk.bump, bumpScale: 0.16 }),
    roof: std({ map: paintedSlate(), roughness: 0.7 }),
    grass: std({ map: grassTex, vertexColors: true, roughness: 1 }),
    path: std({ map: path.map, bumpMap: path.bump, bumpScale: 0.8, roughness: 0.95 }),
    flagstone: std({ map: flags, roughness: 0.9 }),
    wood: std({ map: paintedWood(), roughness: 0.85 }),
    tudor: std({ map: paintedTudor(), roughness: 0.9 }),
    rock: std({ map: paintedRock(), roughness: 0.95 }),
    sand: std({ map: sand, roughness: 1 }),
  };
}

/** ?style=real: the open-source PBR sets (procedural canvas textures stay as fallbacks). */

/**
 * stone/darkStone 共用的 PBR 贴图组：模块级缓存，fileTex().load() 只跑一次。
 * flagstone 不走缓存——它的 repeat 是 0.5（stone/darkStone 是 1），共享纹理会改视觉。
 */
let stoneSetCache: { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture; aoMap: THREE.Texture } | null = null;

function realMaterials() {
  const st = stone([150, 144, 132]);
  const cob = cobbles();
  const grassTex = grass();
  grassTex.repeat.set(90, 90);
  const stoneSetRaw = () => ({
    map: fileTex('stone_color.webp', { fallback: st.map }),
    normalMap: fileTex('stone_normal.webp', { srgb: false }),
    roughnessMap: fileTex('stone_rough.webp', { srgb: false }),
    aoMap: fileTex('stone_ao.webp', { srgb: false }),
  });
  /** stone/darkStone：同一组贴图，repeat 相同，共享安全。 */
  const stoneSet = () => {
    if (!stoneSetCache) stoneSetCache = stoneSetRaw();
    return stoneSetCache;
  };
  const grassFile = fileTex('grass_color.webp', { fallback: grassTex, repeat: 110 });
  const woodSet = { map: fileTex('wood_color.webp', { fallback: wood() }), bumpMap: fileTex('wood_bump.webp', { srgb: false }), roughnessMap: fileTex('wood_rough.webp', { srgb: false }) };
  const flag = stoneSetRaw(); // 独立纹理：下面把 repeat 改成 0.5，不能污染 stone/darkStone 的共享组
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
  };
}
