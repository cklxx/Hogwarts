/**
 * 2D 俯视渲染器 (Canvas 2D)。世界 (x, z) 直接映射屏幕 (x, y)，y 向下 = +z。
 * 用色块 + 字母占位绘制实体（sprite agent 后续替换为精美贴图）。
 */
import { ELEMENT_COLORS, type CreatureKind, type Element, type House } from '../../src/shared/constants';
import { drawSprite } from './sprites.js';
import { drawOak, drawPine, drawDeadTree, drawCottage, drawStoneHouse, drawBush, drawStone, drawLamp } from './components.js';
import { getLayout, itemsInRect, type PlacedItem } from './layout.js';
// 服务器地图是唯一的真实数据源（src/shared/map.ts）：2D 视觉必须与服务器碰撞一致
import { OBSTACLES } from '../../src/shared/map.js';

// ------------------------------------------------------------------ snapshot types (mirror of World.snapshot, client/main.ts)
export interface SW { h: string; n: string; ho: House; x: number; z: number; f: number; hp: number; m: number; y: number; t: string; s: string; say?: string; mm?: string }
export interface SC { i: string; k: CreatureKind; x: number; z: number; f: number; hp: number; m: number; o?: string; s: string; b?: 1 }
export interface SP { i: string; k: string; x: number; z: number; e: Element }
export interface Fx { k: string; x: number; z: number; r?: number; e?: Element; h?: string; n?: number; pts?: number[] }
export interface Snap {
  t: number; hour: number; night: boolean; weather: string;
  term: { n: number; left: number };
  w: SW[]; c: SC[]; p: SP[]; fx: Fx[];
  elder: { x: number; z: number } | null;
  /** 大战周 wire (kernel/warweek.ts): day/total + 墓碑 */
  warweek?: { day: number; total: number; tombstones: { n: string; x: number; z: number }[] };
}

const css = (n: number) => '#' + n.toString(16).padStart(6, '0');

// ------------------------------------------------------------------ ground zones (fixed layout, matches src/shared/map.ts)
// --- art direction: Stardew Valley top-down. Muted harmonious palette, 3+ layers per zone.
interface Palette3 { base: string; dark: string; light: string; detail: string }
const PAL = {
  grass:   { base: '#7fa65c', dark: '#6a8f4c', light: '#93bb6e', detail: '#a8cc82' },
  meadow:  { base: '#86ad60', dark: '#719552', light: '#9cc173', detail: '#b5d68e' },
  forest:  { base: '#3d5c3e', dark: '#2c4530', light: '#527a4e', detail: '#6a9463' },
  lake:    { base: '#3a6a8c', dark: '#2a4f6a', light: '#5a8cab', detail: '#7fb0cc' },
  shore:   { base: '#c9b98e', dark: '#b3a37a', light: '#ddd0a5', detail: '#efe6c4' },
  stone:   { base: '#9b958b', dark: '#7f7a71', light: '#b3ada2', detail: '#c8c2b6' },
  roof:    { base: '#8a5f4a', dark: '#6e4a38', light: '#a5765c', detail: '#bd8f6e' },
  village: { base: '#ac9c7e', dark: '#96876c', light: '#c2b28e', detail: '#d4c69e' },
  path:    { base: '#b89e6e', dark: '#a08858', light: '#cbb080', detail: '#dcc493' },
  pitchA:  { base: '#7fa65c', dark: '#6a8f4c', light: '#93bb6e', detail: '#a8cc82' },
  pitchB:  { base: '#8fb56a', dark: '#7aa257', light: '#a3c87e', detail: '#b8d695' },
} as const;

type ZoneTex = 'castle' | 'grass' | 'forest' | 'lake' | 'village' | 'pitch';
interface Zone { x0: number; z0: number; x1: number; z1: number; pal: Palette3; label: string; tex: ZoneTex }
// 区域划分对齐 src/shared/map.ts 的服务器真实布局（此前 2D 自创位置与服务器碰撞错位）
// 服务器：城堡 x -62..62, z -118..-40；黑湖 (-118,40) r30；禁林 (165,15) r85；霍格莫德 x -30..70, z 150..208；魁地奇 x 30..50, z -185..-115
const ZONES: Zone[] = [
  { x0: -62, z0: -118, x1: 62, z1: -40, pal: PAL.stone, label: '城堡', tex: 'castle' },
  { x0: -80, z0: -40, x1: 80, z1: 60, pal: PAL.meadow, label: '', tex: 'grass' },
  { x0: 80, z0: -70, x1: 250, z1: 100, pal: PAL.forest, label: '禁林', tex: 'forest' },
  { x0: -148, z0: 10, x1: -88, z1: 70, pal: PAL.lake, label: '黑湖', tex: 'lake' },
  { x0: -30, z0: 150, x1: 70, z1: 208, pal: PAL.village, label: '霍格莫德', tex: 'village' },
  { x0: 30, z0: -185, x1: 50, z1: -115, pal: PAL.pitchA, label: '魁地奇球场', tex: 'pitch' },
];
const GROUND = PAL.grass.base;

// ------------------------------------------------------------------ night sky: pre-rendered starfield + moon
// Both are lazy one-time builds; per frame they cost one drawImage + a few
// arcs — well inside the 60 fps budget.
let starTex: HTMLCanvasElement | null = null;
function getStarTex(): HTMLCanvasElement {
  if (!starTex) {
    const c = document.createElement('canvas');
    c.width = 640; c.height = 360;
    const g = c.getContext('2d')!;
    // deterministic seed so the sky doesn't reshuffle on rebuild
    let s = 1234567;
    const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < 150; i++) {
      const r = 0.5 + rnd() * 1.2;
      g.fillStyle = `rgba(235,240,255,${(0.35 + rnd() * 0.6).toFixed(2)})`;
      g.beginPath();
      g.arc(rnd() * c.width, rnd() * c.height, r, 0, Math.PI * 2);
      g.fill();
    }
    starTex = c;
  }
  return starTex;
}
let moonGlow: CanvasGradient | null = null;
/** Moon disc + halo at fixed screen position (mx, my). k = night strength 0..1. */
function drawMoon(ctx: CanvasRenderingContext2D, mx: number, my: number, k: number) {
  const R = 26;
  if (!moonGlow) {
    moonGlow = ctx.createRadialGradient(0, 0, R * 0.4, 0, 0, R * 3.2);
    moonGlow.addColorStop(0, 'rgba(220,228,255,0.55)');
    moonGlow.addColorStop(1, 'rgba(220,228,255,0)');
  }
  ctx.save();
  ctx.translate(mx, my);
  ctx.fillStyle = moonGlow;
  ctx.fillRect(-R * 3.2, -R * 3.2, R * 6.4, R * 6.4);
  // disc
  ctx.fillStyle = '#e8ecf7';
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
  // craters: subtle darker patches
  ctx.fillStyle = 'rgba(180,190,215,0.55)';
  for (const [cx, cy, cr] of [[-8, -4, 6], [7, 6, 4.5], [2, -11, 3.5]] as const) {
    ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.fill();
  }
  // terminator shading: night side darkens as k grows
  ctx.fillStyle = `rgba(22,30,66,${(0.25 * (1 - k) + 0.05).toFixed(2)})`;
  ctx.beginPath(); ctx.arc(-R * 0.25, -R * 0.25, R * 0.96, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ------------------------------------------------------------------ per-frame hot-path caches
// These avoid per-entity allocations and string work inside draw():
// - HOSTILE_KINDS: Set lookup instead of a per-creature array literal
// - elemCss: precomputed '#rrggbb' per Element (css() does toString(16) per call)
const HOSTILE_KINDS = new Set(['dementor', 'spider', 'troll', 'basilisk', 'dragon', 'aragog', 'nundu', 'chimera', 'manticore', 'lethifold', 'werewolf']);
const elemCssCache = new Map<Element, string>();
// projectile motion trails: id -> recent screen positions + last-seen timestamp
const projTrails = new Map<string, { pts: [number, number][]; last: number }>();
const elemCss = (e: Element): string => {
  let s = elemCssCache.get(e);
  if (!s) { s = css(ELEMENT_COLORS[e] ?? 0xffffff); elemCssCache.set(e, s); }
  return s;
};

// ------------------------------------------------------------------ terrain texture: pre-rendered once, blitted per frame
const TPX = 3; // texture px per world unit
const TB = { x0: -280, z0: -280, x1: 280, z1: 360 }; // texture world bounds
const TW = (TB.x1 - TB.x0) * TPX, TH = (TB.z1 - TB.z0) * TPX;
const w2tx = (x: number) => (x - TB.x0) * TPX;
const w2ty = (z: number) => (z - TB.z0) * TPX;

type Rnd = () => number;
function mulberry(seed: number): Rnd {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Painter = (g: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, rnd: Rnd) => void;

// --- helper: soft blob ---
const blob = (g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) => {
  g.fillStyle = color;
  g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
};

// --- grass: layered meadow. base patches -> tufts -> wildflowers -> clover ---
const texGrass: Painter = (g, x0, y0, w, h, rnd) => {
  const P = PAL.meadow;
  // large soft tonal patches (darker + lighter)
  const np = (w * h) / 9000;
  for (let i = 0; i < np; i++) {
    const x = x0 + rnd() * w, y = y0 + rnd() * h, r = 18 + rnd() * 42;
    blob(g, x, y, r, rnd() < 0.5 ? hexA(P.dark, 0.25) : hexA(P.light, 0.22));
  }
  // grass tufts: 3-blade clusters, darker green
  const nt = (w * h) / 700;
  g.strokeStyle = hexA(P.dark, 0.55);
  g.lineWidth = 1.6;
  g.beginPath();
  for (let i = 0; i < nt; i++) {
    const x = x0 + rnd() * w, y = y0 + rnd() * h;
    g.moveTo(x - 3, y); g.lineTo(x - 4, y - 5 - rnd() * 3);
    g.moveTo(x, y); g.lineTo(x, y - 6 - rnd() * 3);
    g.moveTo(x + 3, y); g.lineTo(x + 4, y - 5 - rnd() * 3);
  }
  g.stroke();
  // wildflowers: white / yellow / soft pink dots with tiny stem
  const flowers = ['#f5f0e0', '#f2d06b', '#e8a0b4', '#ffffff'];
  const nf = (w * h) / 4200;
  for (let i = 0; i < nf; i++) {
    const x = x0 + rnd() * w, y = y0 + rnd() * h;
    g.strokeStyle = hexA(P.dark, 0.5);
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 4); g.stroke();
    blob(g, x, y - 5, 1.8 + rnd(), flowers[Math.floor(rnd() * flowers.length)]!);
  }
  // light sparkle flecks
  const ns = (w * h) / 2600;
  for (let i = 0; i < ns; i++) {
    blob(g, x0 + rnd() * w, y0 + rnd() * h, 1 + rnd() * 1.5, hexA(P.detail, 0.35));
  }
};

// --- forest: layered canopy. dark under -> mid -> light top, trunks, clearings ---
// 服务器真实树木位置（src/shared/map.ts OBSTACLES）：视觉与碰撞一致，不再随机撒树
const SERVER_TREES: Array<{ x: number; z: number }> = OBSTACLES.filter(
  (o) => o.style === 'tree' && o.kind === 'disc'
).map((o) => ({ x: (o as { x: number }).x, z: (o as { z: number }).z }));
const texForest: Painter = (g, x0, y0, w, h, rnd) => {
  const P = PAL.forest;
  // clearings first (lighter grass showing through)
  const nc = (w * h) / 26000;
  for (let i = 0; i < nc; i++) {
    const x = x0 + rnd() * w, y = y0 + rnd() * h, r = 14 + rnd() * 26;
    blob(g, x, y, r, hexA(PAL.grass.dark, 0.5));
  }
  // 地面阴影基底（树冠投影用）
  const n1 = (w * h) / 1400;
  for (let i = 0; i < n1; i++) {
    blob(g, x0 + rnd() * w, y0 + rnd() * h, 10 + rnd() * 16, hexA(P.dark, 0.35));
  }
  // dappled sunlight spots
  const nd = (w * h) / 9000;
  for (let i = 0; i < nd; i++) {
    blob(g, x0 + rnd() * w, y0 + rnd() * h, 3 + rnd() * 6, hexA(P.detail, 0.3));
  }
  // 真正的树：服务器真实位置（与碰撞一致）
  // 世界单位转纹理 px：TPX=3。树锚点 = 底部中心。
  const w2x = (wx: number): number => w2tx(wx);
  const w2y = (wz: number): number => w2ty(wz);
  // 从世界坐标反推本 zone 的世界范围
  const zx0 = (x0 / TPX) + TB.x0, zy0 = (y0 / TPX) + TB.z0;
  const zx1 = zx0 + w / TPX, zy1 = zy0 + h / TPX;
  for (const t of SERVER_TREES) {
    if (t.x < zx0 || t.x > zx1 || t.z < zy0 || t.z > zy1) continue;
    const tx = w2x(t.x), ty = w2y(t.z);
    // 确定性种类选择（基于位置哈希，保证每次一致）
    const hk = Math.abs(Math.sin(t.x * 12.9898 + t.z * 78.233) * 43758.5453) % 1;
    if (hk < 0.55) drawOak(g, tx, ty, TPX);
    else if (hk < 0.85) drawPine(g, tx, ty, TPX);
    else drawDeadTree(g, tx, ty, TPX);
  }
  void P; void nd;
};

// --- lake: depth gradient + shore + waves ---
const texLake: Painter = (g, x0, y0, w, h, rnd) => {
  const P = PAL.lake;
  // depth: darker toward center via radial-ish patches
  const cx = x0 + w / 2, cy = y0 + h / 2;
  const maxR = Math.max(w, h) / 2;
  const nd = 26;
  for (let i = nd; i > 0; i--) {
    const r = (maxR * i) / nd;
    const t = 1 - i / nd; // 0 edge -> 1 center
    blob(g, cx + (rnd() - 0.5) * 20, cy + (rnd() - 0.5) * 20, r,
      t > 0.6 ? hexA(P.dark, 0.5) : hexA(P.base, 0.35));
  }
  // shore ring: sandy shallows around edges
  g.strokeStyle = hexA(PAL.shore.base, 0.85);
  g.lineWidth = 10 * TPX * 0.55;
  g.strokeRect(x0 + 8, y0 + 8, w - 16, h - 16);
  g.strokeStyle = hexA(PAL.shore.light, 0.5);
  g.lineWidth = 5 * TPX * 0.55;
  g.strokeRect(x0 + 16, y0 + 16, w - 32, h - 32);
  // wave highlights: short arcs
  const nw = (w * h) / 2400;
  g.strokeStyle = hexA(P.detail, 0.4);
  g.lineWidth = 1.8;
  g.beginPath();
  for (let i = 0; i < nw; i++) {
    const x = x0 + 14 + rnd() * (w - 28), y = y0 + 14 + rnd() * (h - 28);
    const r = 5 + rnd() * 9, a = rnd() * Math.PI;
    g.arc(x, y, r, a, a + 1.1);
  }
  g.stroke();
  // sparkles
  const ns = (w * h) / 5200;
  for (let i = 0; i < ns; i++) {
    blob(g, x0 + 14 + rnd() * (w - 28), y0 + 14 + rnd() * (h - 28), 1.4, hexA('#e8f4ff', 0.55));
  }
};

// --- castle: warm stone + actual structures (walls, towers, courtyard) ---
const texCastle: Painter = (g, x0, y0, w, h, rnd) => {
  const P = PAL.stone;
  // subtle stone variation patches
  const np = (w * h) / 12000;
  for (let i = 0; i < np; i++) {
    blob(g, x0 + rnd() * w, y0 + rnd() * h, 12 + rnd() * 26,
      rnd() < 0.5 ? hexA(P.dark, 0.2) : hexA(P.light, 0.2));
  }
  // flagstone seams (soft, irregular)
  const step = 11 * TPX;
  g.strokeStyle = hexA(P.dark, 0.35);
  g.lineWidth = 1.4;
  g.beginPath();
  for (let x = x0 + step + rnd() * 4; x < x0 + w; x += step) {
    g.moveTo(x, y0); g.lineTo(x + (rnd() - 0.5) * 6, y0 + h);
  }
  for (let y = y0 + step + rnd() * 4; y < y0 + h; y += step) {
    g.moveTo(x0, y); g.lineTo(x0 + w, y + (rnd() - 0.5) * 6);
  }
  g.stroke();
  // moss accents in corners / edges
  const nm = (w * h) / 20000;
  for (let i = 0; i < nm; i++) {
    blob(g, x0 + rnd() * w, y0 + rnd() * h, 2 + rnd() * 5, hexA('#6b8f5a', 0.4));
  }
  // structures are drawn by paintCastle() as a crisp post-blur pass (see below)
};

// --- village: cobble streets + houses with roofs ---
const texVillage: Painter = (g, x0, y0, w, h, rnd) => {
  const P = PAL.village;
  // tonal patches
  const np = (w * h) / 14000;
  for (let i = 0; i < np; i++) {
    blob(g, x0 + rnd() * w, y0 + rnd() * h, 14 + rnd() * 30,
      rnd() < 0.5 ? hexA(P.dark, 0.22) : hexA(P.light, 0.22));
  }
  // cobblestone: staggered, soft
  const step = 5 * TPX;
  let row = 0;
  for (let y = y0 + step / 2; y < y0 + h; y += step, row++) {
    const off = (row % 2) * step / 2;
    for (let x = x0 + step / 2 + off; x < x0 + w; x += step) {
      blob(g, x, y, step * 0.32, rnd() < 0.5 ? hexA(P.dark, 0.3) : hexA(P.light, 0.25));
    }
  }
  // buildings from layout.ts (collision-checked, avoids server's named shops)
  // + server's 5 named buildings drawn from OBSTACLES below
  const zx0v = (x0 / TPX) + TB.x0, zy0v = (y0 / TPX) + TB.z0;
  const zx1v = zx0v + w / TPX, zy1v = zy0v + h / TPX;
  for (const it of itemsInRect(getLayout(), zx0v, zy0v, zx1v, zy1v)) {
    const hx = w2tx(it.x), hy = w2ty(it.z);
    if (it.kind === 'cottage') drawCottage(g, hx, hy, TPX * it.s);
    else if (it.kind === 'stonehouse') drawStoneHouse(g, hx, hy, TPX * it.s);
    else if (it.kind === 'lamp') drawLamp(g, hx, hy, TPX * it.s);
  }
};

// --- server named buildings (Hogsmeade shops): drawn from OBSTACLES, labeled ---
function paintServerBuildings(g: CanvasRenderingContext2D): void {
  for (const o of OBSTACLES) {
    if (o.kind !== 'box' || o.style !== 'house' || !o.label) continue;
    const cx = (o.x0 + o.x1) / 2, cz = (o.z0 + o.z1) / 2;
    const hx = w2tx(cx), hy = w2ty(cz);
    // named shops get stone houses, scaled to footprint
    const fw = (o.x1 - o.x0), fh = (o.z1 - o.z0);
    const s = TPX * Math.max(fw / 96, fh / 72, 0.7);
    drawStoneHouse(g, hx, hy, s);
    // label
    g.fillStyle = '#fff'; g.font = `${Math.max(10, 11 * 1)}px sans-serif`;
    g.textAlign = 'center';
    g.fillText(o.label, hx, hy + 30 * TPX * 0.5);
  }
}

// house: top-down — walls, pitched roof (two slopes), chimney, door shadow
function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// --- quidditch pitch: mowed stripes + white lines + goal hoops ---
const texPitch: Painter = (g, x0, y0, w, h, rnd) => {
  // mowed stripes (horizontal bands, alternating tones)
  const stripeH = h / 9;
  for (let i = 0; i < 9; i++) {
    g.fillStyle = i % 2 ? PAL.pitchA.base : PAL.pitchB.base;
    g.fillRect(x0, y0 + i * stripeH, w, stripeH + 1);
  }
  // subtle noise on top
  const nn = (w * h) / 3000;
  for (let i = 0; i < nn; i++) {
    blob(g, x0 + rnd() * w, y0 + rnd() * h, 1.5, hexA(PAL.pitchA.detail, 0.25));
  }
  const L = 'rgba(245,245,240,0.85)';
  g.strokeStyle = L; g.lineWidth = 2.4;
  // boundary
  g.strokeRect(x0 + 14, y0 + 14, w - 28, h - 28);
  // center line + circle
  g.beginPath();
  g.moveTo(x0 + w / 2, y0 + 14); g.lineTo(x0 + w / 2, y0 + h - 14);
  g.arc(x0 + w / 2, y0 + h / 2, 26, 0, 7);
  g.stroke();
  // goal hoops: 3 per end (north + south), gold rings on posts
  for (const endY of [y0 + 26, y0 + h - 26]) {
    for (let k = -1; k <= 1; k++) {
      const hx = x0 + w / 2 + k * 30;
      g.strokeStyle = '#3a3230'; g.lineWidth = 3; // post
      g.beginPath(); g.moveTo(hx, endY); g.lineTo(hx, endY + (endY < y0 + h / 2 ? -14 : 14)); g.stroke();
      g.strokeStyle = '#d4a017'; g.lineWidth = 2.6; // gold hoop
      g.beginPath(); g.arc(hx, endY + (endY < y0 + h / 2 ? -20 : 20), 7, 0, 7); g.stroke();
    }
  }
};

const TEX_PAINT: Record<ZoneTex, Painter> = {
  castle: texCastle, grass: texGrass, forest: texForest,
  lake: texLake, village: texVillage, pitch: texPitch,
};

// --- hex + alpha helper (for palette colors) ---
function hexA(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16), gg = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${gg},${b},${a})`;
}

// --- decorative scatter: paths, bushes, stones (fixed seeds, drawn over zones) ---
// 障碍物包围盒缓存（世界坐标）：装饰物散布时避开，防止视觉重叠
// 从服务器 OBSTACLES 派生，与碰撞一致
interface BBox { x0: number; z0: number; x1: number; z1: number }
const OBSTACLE_BOXES: BBox[] = OBSTACLES.map((o) => {
  if (o.kind === 'box') return { x0: o.x0, z0: o.z0, x1: o.x1, z1: o.z1 };
  // disc: 树木用树冠半径做视觉包围（比碰撞的树干大，避免树冠压住灌木）
  const vr = o.style === 'tree' ? o.r * 2.5 : o.r;
  return { x0: o.x - vr, z0: o.z - vr, x1: o.x + vr, z1: o.z + vr };
});
/** 点 (x,z) 是否落在任一障碍物包围盒内（pad 为额外间距） */
function hitsObstacle(x: number, z: number, pad = 0): boolean {
  for (const b of OBSTACLE_BOXES) {
    if (x >= b.x0 - pad && x <= b.x1 + pad && z >= b.z0 - pad && z <= b.z1 + pad) return true;
  }
  return false;
}
function paintDecorations(g: CanvasRenderingContext2D): void {
  const L = getLayout();
  // roads from layout: dark edge -> base -> light center
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const road of L.roads) {
    const passes: Array<[number, string]> = [
      [road.width + 2.5, hexA(PAL.path.dark, 0.9)],
      [road.width, hexA(PAL.path.base, 0.95)],
      [road.width * 0.45, hexA(PAL.path.light, 0.5)],
    ];
    for (const [w, style] of passes) {
      g.strokeStyle = style;
      g.lineWidth = w * TPX * 0.5;
      g.beginPath();
      road.pts.forEach((p, i) => {
        const tx = w2tx(p.x), ty = w2ty(p.z);
        if (i === 0) g.moveTo(tx, ty); else g.lineTo(tx, ty);
      });
      g.stroke();
    }
  }
  // bushes & stones from layout (collision-checked at build)
  for (const it of L.items) {
    if (it.kind !== 'bush' && it.kind !== 'stone') continue;
    const x = w2tx(it.x), y = w2ty(it.z);
    if (it.kind === 'bush') drawBush(g, x, y, TPX * it.s);
    else drawStone(g, x, y, TPX * it.s);
  }
}

// --- castle structures: crisp top-down pass, drawn AFTER the 9px blur ---
// Hogwarts-inspired irregular ward: polygonal outer wall, great hall, clock tower,
// central keep + wing, viaduct, astronomy tower, bell towers, courtyard + well, south gate.
// World coords; all sizes in world units (TPX tex px per unit).
function paintCastle(g: CanvasRenderingContext2D): void {
  const S = PAL.stone, R = PAL.roof;
  const X = (x: number): number => w2tx(x);
  const Y = (z: number): number => w2ty(z);
  const WD = '#6f6a61', WB = S.base, WL = S.light;
  const RD = R.dark, RB = R.base, RL = R.light;
  const WOD = '#4a352a', WOB = '#6b4f3a';

  // irregular outer wall polygon (not a rectangle)
  const WALL: Array<[number, number]> = [
    [-56, -102], [-32, -107], [-6, -105], [18, -99], [36, -90],
    [48, -76], [53, -59], [47, -47], [28, -43.5], [8, -45.5],
    [-14, -43.5], [-34, -47], [-52, -59], [-58, -79],
  ];
  const trace = (pts: Array<[number, number]>): void => {
    g.beginPath();
    pts.forEach(([x, z], i) => { if (i === 0) g.moveTo(X(x), Y(z)); else g.lineTo(X(x), Y(z)); });
    g.closePath();
  };

  // round tower: shadow + stone ring + crenellations + conical roof hint
  const tower = (x: number, z: number, r: number, big = false): void => {
    const cx = X(x), cy = Y(z), rr = r * TPX;
    blob(g, cx + 1.4 * TPX, cy + 1.8 * TPX, rr, 'rgba(0,0,0,0.3)');
    blob(g, cx, cy, rr, WD);
    blob(g, cx, cy, rr * 0.82, WB);
    const n = big ? 12 : 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.3;
      blob(g, cx + Math.cos(a) * rr * 0.88, cy + Math.sin(a) * rr * 0.88, Math.max(1.6, rr * 0.13), WL);
    }
    blob(g, cx, cy, rr * 0.55, RD);
    blob(g, cx - rr * 0.16, cy - rr * 0.16, rr * 0.2, hexA(RL, 0.85));
  };

  // pitched-roof building: shadow + walls + two roof slopes + ridge + chimney
  const roofed = (x0: number, z0: number, x1: number, z1: number, ridge: 'v' | 'h'): void => {
    const w = (x1 - x0) * TPX, h = (z1 - z0) * TPX;
    const px = X(x0), py = Y(z0);
    g.fillStyle = 'rgba(0,0,0,0.28)';
    roundRect(g, px + 1.5 * TPX, py + 2 * TPX, w, h, 3); g.fill();
    g.fillStyle = WB;
    roundRect(g, px, py, w, h, 3); g.fill();
    g.strokeStyle = hexA(WD, 0.8); g.lineWidth = 1.6;
    roundRect(g, px, py, w, h, 3); g.stroke();
    const ox = 0.9 * TPX, rx = px - ox, ry = py - ox, rw = w + ox * 2, rh = h + ox * 2;
    if (ridge === 'v') {
      g.fillStyle = RL; g.fillRect(rx, ry, rw / 2, rh);
      g.fillStyle = RD; g.fillRect(rx + rw / 2, ry, rw / 2, rh);
      g.fillStyle = hexA(RL, 0.9); g.fillRect(rx + rw / 2 - 1, ry, 2, rh);
    } else {
      g.fillStyle = RL; g.fillRect(rx, ry, rw, rh / 2);
      g.fillStyle = RD; g.fillRect(rx, ry + rh / 2, rw, rh / 2);
      g.fillStyle = hexA(RL, 0.9); g.fillRect(rx, ry + rh / 2 - 1, rw, 2);
    }
    const chx = px + w * 0.72, chy = py + h * 0.2;
    g.fillStyle = WD; g.fillRect(chx - 2, chy - 4, 5, 9);
    g.fillStyle = WL; g.fillRect(chx - 2, chy - 4, 5, 2.5);
  };

  // square tower with hip (pyramid) roof
  const clockTower = (x0: number, z0: number, x1: number, z1: number): void => {
    const w = (x1 - x0) * TPX, h = (z1 - z0) * TPX, px = X(x0), py = Y(z0);
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.fillRect(px + 1.5 * TPX, py + 2 * TPX, w, h);
    g.fillStyle = WB; g.fillRect(px, py, w, h);
    g.strokeStyle = hexA(WD, 0.8); g.lineWidth = 1.6; g.strokeRect(px, py, w, h);
    g.fillStyle = RD; g.fillRect(px - TPX, py - TPX, w + 2 * TPX, h + 2 * TPX);
    g.fillStyle = RB; g.fillRect(px + w * 0.18, py + h * 0.18, w * 0.64, h * 0.64);
    g.fillStyle = RL; g.fillRect(px + w * 0.36, py + h * 0.36, w * 0.28, h * 0.28);
  };

  // window row: start (x,z), step (dx,dz), n windows
  const windows = (x: number, z: number, dx: number, dz: number, n: number): void => {
    g.fillStyle = 'rgba(30,26,24,0.85)';
    for (let i = 0; i < n; i++) {
      g.fillRect(X(x + dx * i) - 2, Y(z + dz * i) - 2, 4, 4);
    }
  };

  // courtyard tree: canopy blobs
  const tree = (x: number, z: number): void => {
    blob(g, X(x) + 1.5, Y(z) + 2, 2.6 * TPX, 'rgba(0,0,0,0.2)');
    blob(g, X(x), Y(z), 2.6 * TPX, PAL.forest.dark);
    blob(g, X(x) - 2, Y(z) - 2, 1.4 * TPX, hexA(PAL.forest.light, 0.8));
  };

  // --- 1. inner ward: paved ground ---
  trace(WALL); g.fillStyle = '#a39c8f'; g.fill();
  const prnd = mulberry(60221);
  for (let i = 0; i < 26; i++) {
    blob(g, X(-52 + prnd() * 100), Y(-102 + prnd() * 56), 8 + prnd() * 18, hexA(WD, 0.15));
  }

  // --- 2. gate spur path (ward -> main south path at [0,-40]) ---
  g.strokeStyle = hexA(PAL.path.base, 0.95);
  g.lineCap = 'round'; g.lineWidth = 4 * TPX;
  g.beginPath(); g.moveTo(X(-3), Y(-50)); g.lineTo(X(0), Y(-38)); g.stroke();

  // --- 3. courtyard: garden court + well + trees ---
  g.fillStyle = 'rgba(0,0,0,0.18)';
  roundRect(g, X(-20) + 1.5 * TPX, Y(-56) + 2 * TPX, 38 * TPX, 7 * TPX, 6); g.fill();
  g.fillStyle = '#8aa864';
  roundRect(g, X(-20), Y(-56), 38 * TPX, 7 * TPX, 6); g.fill();
  tree(-14, -52.5); tree(12, -52.5);
  const wx = X(0), wy = Y(-52.5); // well
  blob(g, wx + 1.5, wy + 2, 2.2 * TPX, 'rgba(0,0,0,0.25)');
  blob(g, wx, wy, 2.2 * TPX, WD);
  blob(g, wx, wy, 1.4 * TPX, '#2a4f6a');
  blob(g, wx - 1.5, wy - 1.5, 1.2, hexA('#cfe4ef', 0.8));

  // --- 4. buildings ---
  roofed(-50, -98, -28, -68, 'v'); // great hall (west)
  clockTower(-17, -101, -10, -94); // clock tower (north)
  roofed(-14, -88, 14, -60, 'v');  // keep (center)
  roofed(14, -80, 26, -64, 'h');   // keep east wing
  roofed(-28, -78, -14, -72, 'h'); // viaduct (hall -> keep)
  windows(-49.2, -94, 0, 4, 5);    // great hall west windows
  windows(25.2, -77, 0, 4, 4);     // east wing windows

  // --- 5. outer wall: dark band + lighter wall-walk + crenellations ---
  trace(WALL); g.strokeStyle = WD; g.lineWidth = 3.6 * TPX; g.lineJoin = 'round'; g.stroke();
  trace(WALL); g.strokeStyle = hexA(WL, 0.9); g.lineWidth = 2.1 * TPX; g.stroke();
  trace(WALL);
  g.strokeStyle = hexA('#ddd6c6', 0.95); g.lineWidth = 1.1 * TPX;
  g.setLineDash([2.4 * TPX, 2.0 * TPX]); g.stroke(); g.setLineDash([]);

  // --- 6. towers: wall bastions + bell towers + astronomy tower ---
  tower(-56, -102, 4.5); tower(18, -99, 4.5); tower(53, -59, 5);
  tower(8, -45.5, 4.5); tower(-52, -59, 4.5);
  tower(-44, -63, 3.2); tower(-36, -62.5, 2.8);
  tower(33, -70, 7, true);

  // --- 7. south gate: cut wall, wooden doors, flanking towers ---
  const gz = -44.6;
  g.fillStyle = '#a39c8f';
  g.fillRect(X(-7), Y(-47.5), 8 * TPX, 6 * TPX); // wall cut
  g.fillStyle = WOB;
  g.fillRect(X(-6), Y(-46.2), 6 * TPX, 3.2 * TPX); // doors
  g.fillStyle = WOD;
  g.fillRect(X(-3.25), Y(-46.2), 0.5 * TPX, 3.2 * TPX); // center seam
  for (let i = 0; i < 3; i++) {
    blob(g, X(-5 + i * 2), Y(-45.4), 1.6, WOD);
    blob(g, X(-5 + i * 2), Y(-43.8), 1.6, WOD);
  }
  tower(-8.4, gz, 2.6); tower(2.4, gz - 0.2, 2.6);
}

// grass-area check for scatter placement (excludes lake/castle/village/pitch interiors)
function inGrass(x: number, z: number): boolean {  for (const zn of ZONES) {
    if (x >= zn.x0 && x <= zn.x1 && z >= zn.z0 && z <= zn.z1) {
      return zn.tex === 'grass';
    }
  }
  return true; // outside zones = wild grass
}


/** Build the full-world ground texture once. Zone edges are blurred for soft transitions. */
function buildGroundTexture(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TW; c.height = TH;
  const g = c.getContext('2d')!;
  const rnd = mulberry(20261017);
  // base ground: wild grass with tonal patches + tufts
  g.fillStyle = GROUND;
  g.fillRect(0, 0, TW, TH);
  const brnd = mulberry(31337);
  // large tonal patches
  for (let i = 0; i < 120; i++) {
    blob(g, brnd() * TW, brnd() * TH, 20 + brnd() * 50,
      brnd() < 0.5 ? hexA(PAL.grass.dark, 0.18) : hexA(PAL.grass.light, 0.15));
  }
  // grass tufts
  g.strokeStyle = hexA(PAL.grass.dark, 0.4);
  g.lineWidth = 1.6;
  g.beginPath();
  for (let i = 0; i < 900; i++) {
    const x = brnd() * TW, y = brnd() * TH;
    g.moveTo(x - 3, y); g.lineTo(x - 4, y - 5 - brnd() * 3);
    g.moveTo(x, y); g.lineTo(x, y - 6 - brnd() * 3);
    g.moveTo(x + 3, y); g.lineTo(x + 4, y - 5 - brnd() * 3);
  }
  g.stroke();
  // fine noise
  const nb = (TW * TH) / 800;
  for (let i = 0; i < nb; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)';
    g.fillRect(rnd() * TW, rnd() * TH, 2, 2);
  }
  // zone layer: color + detail, then blurred onto base for soft edges
  const layer = document.createElement('canvas');
  layer.width = TW; layer.height = TH;
  const lg = layer.getContext('2d')!;
  for (const zn of ZONES) {
    const x0 = w2tx(zn.x0), y0 = w2ty(zn.z0), w = (zn.x1 - zn.x0) * TPX, h = (zn.z1 - zn.z0) * TPX;
    lg.fillStyle = zn.pal.base;
    lg.fillRect(x0, y0, w, h);
    lg.save();
    lg.beginPath(); lg.rect(x0, y0, w, h); lg.clip();
    TEX_PAINT[zn.tex](lg, x0, y0, w, h, rnd);
    lg.restore();
  }
  g.filter = 'blur(9px)';
  g.drawImage(layer, 0, 0);
  g.filter = 'none';
  // decorations on top (paths, bushes, stones) — not blurred, crisp details
  paintDecorations(g);
  // castle structures — crisp, drawn after the blur so walls/towers read at 1x
  paintCastle(g);
  return c;
}


// ------------------------------------------------------------------ renderer
export interface Camera { x: number; z: number; zoom: number }

export function createRenderer2D(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  const cam: Camera = { x: 0, z: -22, zoom: 1 };
  let snap: Snap | null = null;
  let myHandle = '';
  let follow = true;
  const keys = new Set<string>();
  let groundTex: HTMLCanvasElement | null = null; // built lazily on first frame

  // --- perf sampler (opt-in via ?perf=1): collects draw() ms, exposed as window.__2dperf() ---
  const PERF = /[?&]perf=1/.test(location.search);
  const perfBuf: number[] = [];
  if (PERF) {
    (window as any).__2dperf = () => {
      const a = [...perfBuf].sort((x, y) => x - y);
      if (!a.length) return null;
      const sum = a.reduce((x, y) => x + y, 0);
      const q = (p: number) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
      return { n: a.length, avg: sum / a.length, p50: q(0.5), p95: q(0.95), max: a[a.length - 1] };
    };
    (window as any).__2dzoom = () => cam.zoom;
    (window as any).__2dents = () => snap ? { w: snap.w.length, c: snap.c.length, p: snap.p.length, fx: snap.fx.length } : null;
  }
  const perfEnd = (t0: number) => { if (PERF) { perfBuf.push(performance.now() - t0); if (perfBuf.length > 600) perfBuf.shift(); } };

  // --- input: wheel zoom, arrows pan (pan breaks follow), WASD = player move (main.ts) ---
  canvas.tabIndex = 0;
  addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.zoom = Math.min(3, Math.max(0.5, cam.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
  }, { passive: false });
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      keys.add(k); follow = false; e.preventDefault();
    }
    if (k === 'f') follow = true; // F: resume follow
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

  const resize = () => {
    canvas.width = innerWidth * devicePixelRatio;
    canvas.height = innerHeight * devicePixelRatio;
    canvas.style.width = innerWidth + 'px';
    canvas.style.height = innerHeight + 'px';
  };
  addEventListener('resize', resize);
  resize();

  function setSnap(s: Snap) { snap = s; }
  function setMe(h: string) { myHandle = h; }

  // view size in CSS px, refreshed each draw() (avoids recomputing per entity)
  let vw = 0, vh = 0;
  // canvas state caches: setting font/textAlign re-parses the string each time
  let curFont = '', curAlign = '';
  const setFont = (f: string) => { if (f !== curFont) { ctx.font = f; curFont = f; } };
  const setAlign = (a: CanvasTextAlign) => { if (a !== curAlign) { ctx.textAlign = a; curAlign = a; } };

  // world -> screen
  const w2s = (x: number, z: number): [number, number] => {
    return [(x - cam.x) * cam.zoom + vw / 2, (z - cam.z) * cam.zoom + vh / 2];
  };
  const s2w = (sx: number, sy: number): { x: number; z: number } => {
    const w = canvas.width / devicePixelRatio, h = canvas.height / devicePixelRatio;
    return { x: (sx - w / 2) / cam.zoom + cam.x, z: (sy - h / 2) / cam.zoom + cam.z };
  };
  const scale = (v: number) => v * cam.zoom;

  // cull: is world point inside view?
  const visible = (x: number, z: number, pad = 40): boolean => {
    const [sx, sy] = w2s(x, z);
    return sx > -pad && sx < vw + pad && sy > -pad && sy < vh + pad;
  };

  // me lookup, cached per snapshot object (was: O(n) find with closure per frame)
  let lastSnapObj: Snap | null = null;
  let meCache: SW | null = null;
  const meOf = (): SW | null => {
    if (snap !== lastSnapObj) {
      lastSnapObj = snap;
      meCache = snap?.w.find((w) => w.h === myHandle) ?? null;
    }
    return meCache;
  };

  let lastT = 0;
  function frame(now: number) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - lastT) / 1000 || 0.016);
    lastT = now;

    // camera: follow me, or WASD pan
    if (snap) {
      const me = meOf();
      if (follow && me) { cam.x = me.x; cam.z = me.z; }
    }
    const pan = 320 * dt / cam.zoom;
    if (keys.has('w') || keys.has('arrowup')) cam.z -= pan;
    if (keys.has('s') || keys.has('arrowdown')) cam.z += pan;
    if (keys.has('a') || keys.has('arrowleft')) cam.x -= pan;
    if (keys.has('d') || keys.has('arrowright')) cam.x += pan;

    draw();
  }

  function draw() {
    const t0 = PERF ? performance.now() : 0;
    const W = canvas.width / devicePixelRatio, H = canvas.height / devicePixelRatio;
    vw = W; vh = H;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

    // --- ground: single pre-rendered texture blit (culling = source-rect clamp) ---
    // drawSprite leaves imageSmoothingEnabled=false; ground wants smooth scaling.
    ctx.imageSmoothingEnabled = true;
    const tex = groundTex ?? (groundTex = buildGroundTexture());
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, W, H);
    const wA = s2w(0, 0), wB = s2w(W, H);
    const sx0 = Math.max(0, w2tx(wA.x)), sy0 = Math.max(0, w2ty(wA.z));
    const sx1 = Math.min(TW, w2tx(wB.x)), sy1 = Math.min(TH, w2ty(wB.z));
    if (sx1 > sx0 && sy1 > sy0) {
      const dx = (TB.x0 + sx0 / TPX - cam.x) * cam.zoom + W / 2;
      const dy = (TB.z0 + sy0 / TPX - cam.z) * cam.zoom + H / 2;
      ctx.drawImage(tex, sx0, sy0, sx1 - sx0, sy1 - sy0,
        dx, dy, ((sx1 - sx0) / TPX) * cam.zoom, ((sy1 - sy0) / TPX) * cam.zoom);
    }
    // lighting inputs: smoothstep day curve — sunrise 5→8, sunset 16.5→19.5.
    // C1 continuous everywhere, so dusk/dawn never jump. 1 = full day, 0 = deep night.
    const hour = snap?.hour ?? 12;
    const sstep = (a: number, b: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const dayFactor = sstep(5, 8, hour) * (1 - sstep(16.5, 19.5, hour));
    const night = dayFactor < 0.5;
    // zone labels (culled per zone); collected as fixed anchors for the unified
    // label layout pass below — wizard names must not collide with them
    const zoneFont = `${Math.max(10, 12 * cam.zoom)}px sans-serif`;
    const zoneLabels: { x: number; y: number; text: string; hw: number }[] = [];
    for (const zn of ZONES) {
      if (!visible((zn.x0 + zn.x1) / 2, (zn.z0 + zn.z1) / 2, Math.max(zn.x1 - zn.x0, zn.z1 - zn.z0))) continue;
      if (zn.label && cam.zoom > 0.7) {
        const [sx, sy] = w2s(zn.x0, zn.z0);
        const lx = sx + scale(zn.x1 - zn.x0) / 2, ly = sy + 16;
        setFont(zoneFont); setAlign('center');
        zoneLabels.push({ x: lx, y: ly, text: zn.label, hw: ctx.measureText(zn.label).width / 2 + 2 });
        ctx.fillStyle = night ? '#cfd4dc' : '#2c2c2c';
        ctx.fillText(zn.label, lx, ly);
      }
    }

    if (!snap) {
      ctx.fillStyle = '#fff';
      setFont('16px sans-serif');
      setAlign('center');
      ctx.fillText('等待快照…', W / 2, H / 2);
      perfEnd(t0);
      return;
    }

    // --- chests / props as squares (from fx? no: props come via events; draw elder wand tomb) ---
    if (snap.elder && visible(snap.elder.x, snap.elder.z)) {
      const [sx, sy] = w2s(snap.elder.x, snap.elder.z);
      ctx.fillStyle = '#d4af37';
      ctx.fillRect(sx - 4, sy - 4, 8, 8);
      ctx.fillStyle = '#fff'; setFont('10px sans-serif'); setAlign('center');
      ctx.fillText('E', sx, sy + 12);
    }

    // --- tombstones: 战后世界 (kernel/aftermath.ts) ---
    for (const t of snap.warweek?.tombstones ?? []) {
      if (!visible(t.x, t.z)) continue;
      const [sx, sy] = w2s(t.x, t.z);
      const size = Math.max(14, 22 * cam.zoom);
      drawSprite(ctx, 'tombstone', sx - size / 2, sy - size / 2, size, size);
      if (cam.zoom > 0.9) {
        ctx.fillStyle = '#c9c9d4'; setFont('10px sans-serif'); setAlign('center');
        ctx.fillText(t.n.split(' ').pop() ?? t.n, sx, sy + size / 2 + 11);
      }
    }

    // --- projectiles: glowing core + motion trail ---
    // trails tracked locally: id -> recent screen positions (no velocity in snapshot)
    const now = performance.now();
    for (const id of projTrails.keys()) {
      const tr = projTrails.get(id)!;
      if (now - tr.last > 500) projTrails.delete(id); // stale
    }
    for (const p of snap.p) {
      if (!visible(p.x, p.z)) continue;
      const [sx, sy] = w2s(p.x, p.z);
      let tr = projTrails.get(p.i);
      if (!tr) { tr = { pts: [], last: 0 }; projTrails.set(p.i, tr); }
      tr.last = now;
      tr.pts.push([sx, sy]);
      if (tr.pts.length > 6) tr.pts.shift();
      const col = elemCss(p.e);
      // trail: fading circles along recent path
      for (let i = 0; i < tr.pts.length - 1; i++) {
        const a = (i + 1) / tr.pts.length * 0.35;
        ctx.globalAlpha = a;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(tr.pts[i][0], tr.pts[i][1], Math.max(1.5, 2.5 * cam.zoom * (i + 1) / tr.pts.length), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // glow halo
      const coreR = Math.max(4, 5 * cam.zoom);
      const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, coreR * 2.5);
      grad.addColorStop(0, col);
      grad.addColorStop(0.4, col + 'cc');
      grad.addColorStop(1, col + '00');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(sx, sy, coreR * 2.5, 0, Math.PI * 2);
      ctx.fill();
      // bright core
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(sx, sy, coreR * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- entities (creatures + wizards): y-sorted by world z so nearer (larger z)
    // draws over farther — fixes characters clipping through trees/others ---
    type Ent = { z: number; kind: 'c' | 'w'; c?: (typeof snap.c)[number]; w?: (typeof snap.w)[number] };
    const ents: Ent[] = [];
    for (const c of snap.c) { if (visible(c.x, c.z)) ents.push({ z: c.z, kind: 'c', c }); }
    for (const w of snap.w) { if (visible(w.x, w.z)) ents.push({ z: w.z, kind: 'w', w }); }
    ents.sort((a, b) => a.z - b.z);

    // name labels collected during y-sorted draw, rendered after (de-collided)
    interface NameLbl { x: number; y: number; n: string; isMe: boolean; dy: number; hw: number; dw2: number; dot: boolean }
    const nameQueue: NameLbl[] = [];
    const meW = meOf();

    for (const e of ents) {
      if (e.kind === 'c') {
        const c = e.c!;
        // --- creature: pixel sprite per kind, hp bar below ---
        const [sx, sy] = w2s(c.x, c.z);
      const size = Math.max(12, 20 * cam.zoom);
      drawSprite(ctx, c.k, sx - size / 2, sy - size / 2, size, size);
      const hostile = c.s.includes('H') || HOSTILE_KINDS.has(c.k);
      if (hostile) { ctx.strokeStyle = '#ff2a1a'; ctx.lineWidth = 2; ctx.strokeRect(sx - size / 2 - 1, sy - size / 2 - 1, size + 2, size + 2); }
      const r = size / 2;
      // hp bar
      if (c.hp < c.m) {
        ctx.fillStyle = '#222'; ctx.fillRect(sx - r, sy - r - 5, r * 2, 3);
        ctx.fillStyle = '#4dff4d'; ctx.fillRect(sx - r, sy - r - 5, (r * 2 * c.hp) / c.m, 3);
      }
      if (cam.zoom > 1.2) {
        ctx.fillStyle = '#fff'; setFont(`${Math.max(9, 10 * cam.zoom)}px sans-serif`); setAlign('center');
        ctx.fillText(c.k[0].toUpperCase(), sx, sy + r + 11);
      }
      } else {
        const w = e.w!;
        // --- wizard: house sprite + hp bar + name (names drawn in 2nd pass with de-collision) ---
      const [sx, sy] = w2s(w.x, w.z);
      const isMe = w.h === myHandle;
      const r = Math.max(5, 8 * cam.zoom);
      const size = r * 3;
      drawSprite(ctx, `wizard-${String(w.ho).toLowerCase()}`, sx - size / 2, sy - size / 2, size, size);
      if (isMe) { ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2; ctx.strokeRect(sx - size / 2 - 1, sy - size / 2 - 1, size + 2, size + 2); }
      // facing tick
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(w.f) * (r + 4), sy + Math.sin(w.f) * (r + 4));
      ctx.stroke();
      // hp bar
      if (w.hp < w.m) {
        ctx.fillStyle = '#222'; ctx.fillRect(sx - r, sy - r - 6, r * 2, 3);
        ctx.fillStyle = w.hp / w.m > 0.4 ? '#4dff4d' : '#ff4d4d';
        ctx.fillRect(sx - r, sy - r - 6, (r * 2 * w.hp) / w.m, 3);
      }
      // distance² to player (world units; viewport-center fallback if player unknown)
      const dw2 = meW ? (w.x - meW.x) * (w.x - meW.x) + (w.z - meW.z) * (w.z - meW.z)
        : (sx - vw / 2) * (sx - vw / 2) + (sy - vh / 2) * (sy - vh / 2);
      nameQueue.push({ x: sx, y: sy + r + 13, n: w.n, isMe, dy: 0, hw: 0, dw2, dot: false });
      // status letters (S shield / X stunned / J jailed)
      const flags = w.s.replace('N', '');
      if (flags && cam.zoom > 0.8) {
        ctx.fillStyle = '#ffec8a'; setFont('10px sans-serif');
        ctx.fillText(flags, sx, sy - r - 8);
      }
      // speech
      if (w.say && cam.zoom > 0.9) {
        ctx.fillStyle = '#fff'; setFont('10px sans-serif');
        ctx.fillText(w.say.slice(0, 24), sx, sy - r - 20);
      }
      } // end else (wizard)
    } // end y-sorted entity loop
    // --- lighting: applied over the whole world (ground + sprites) so night
    // dims everything consistently. Dusk/dawn get a warm wash, night gets
    // moonlight blue + stars + a moon disc. Names, fx and HUD render above.
    {
      const k = 1 - dayFactor; // 0 = full day, 1 = deep night
      const warm = 4 * dayFactor * (1 - dayFactor); // 0..1, peaks mid-transition
      if (warm > 0.02) {
        ctx.fillStyle = `rgba(255,125,55,${(0.24 * warm).toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
      }
      if (k > 0.02) {
        // moonlight blue (no harsh black)
        ctx.fillStyle = `rgba(16,24,54,${(0.58 * k).toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = Math.min(1, k * 1.25);
        ctx.drawImage(getStarTex(), 0, 0, W, H);
        drawMoon(ctx, W - 250, 100, k);
        ctx.globalAlpha = 1;
      } else if (hour >= 10 && hour <= 15) {
        // midday warmth, very subtle
        ctx.fillStyle = 'rgba(255,240,200,0.06)';
        ctx.fillRect(0, 0, W, H);
      }
    }
    // --- unified label layout: wizard names avoid zone labels and each other ---
    // 1) measure real text half-widths (the old fixed 50px threshold missed
    //    overlaps between long names whose centers are 50-90px apart)
    const nameFont = (isMe: boolean) => `${isMe ? 'bold ' : ''}${Math.max(10, 11 * cam.zoom)}px sans-serif`;
    setAlign('center');
    for (const nm of nameQueue) {
      setFont(nameFont(nm.isMe));
      nm.hw = ctx.measureText(nm.n).width / 2 + 2;
    }
    // 2) density cap: keep text for the nearest MAXN names to the player
    //    (player always kept); the rest become dots instead of unreadable blobs
    const MAXN = 6;
    nameQueue.sort((a, b) => (a.isMe ? -1 : b.isMe ? 1 : a.dw2 - b.dw2));
    for (let i = 0; i < nameQueue.length; i++) nameQueue[i].dot = i >= MAXN;
    // 3) vertical stacking with width-aware collision; zone labels are fixed anchors
    nameQueue.sort((a, b) => a.y - b.y || a.x - b.x);
    const lineH = Math.max(14, 13 * cam.zoom);
    const placed: { x: number; y: number; hw: number }[] = [];
    for (const z of zoneLabels) placed.push({ x: z.x, y: z.y, hw: z.hw });
    for (const nm of nameQueue) {
      if (nm.dot) continue;
      let y = nm.y, ok = false;
      // find a y that doesn't collide with already-placed labels
      for (let attempt = 0; attempt < 24; attempt++) {
        let hit = false;
        for (const p of placed) {
          if (Math.abs(p.x - nm.x) < (p.hw + nm.hw) * 0.9 && Math.abs(p.y - y) < lineH) { hit = true; break; }
        }
        if (!hit) { ok = true; break; }
        y += lineH;
      }
      if (!ok || y > vh + 24) { nm.dot = true; continue; } // too crowded: dot instead
      nm.dy = y - nm.y;
      placed.push({ x: nm.x, y, hw: nm.hw });
    }
    // 4) draw
    for (const nm of nameQueue) {
      if (nm.dot) {
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.beginPath(); ctx.arc(nm.x, nm.y - 5, 2, 0, Math.PI * 2); ctx.fill();
        continue;
      }
      ctx.fillStyle = nm.isMe ? '#ffd700' : '#fff';
      setFont(nameFont(nm.isMe));
      // subtle dark outline for readability
      ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 3;
      ctx.strokeText(nm.n, nm.x, nm.y + nm.dy);
      ctx.fillText(nm.n, nm.x, nm.y + nm.dy);
    }

    // --- fx: expanding rings / flashes ---
    for (const f of snap.fx) {
      if (!visible(f.x, f.z)) continue;
      const [sx, sy] = w2s(f.x, f.z);
      const col = f.e ? elemCss(f.e) : '#ffffff';
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, scale(f.r ?? 6), 0, Math.PI * 2);
      ctx.stroke();
    }

    // --- HUD: term / time / zoom ---
    // NOTE: the controls hint used to be a third line here, but #tipbar in
    // hud.ts owns that corner now; the canvas copy peeked out from behind the
    // panel and read as overlapping ghost text. Keep only the unique info.
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(8, 8, 180, 48);
    ctx.fillStyle = '#fff'; setFont('13px sans-serif'); setAlign('left');
    const mm = Math.floor(snap.term.left / 60), ss = snap.term.left % 60;
    ctx.fillText(`第 ${snap.term.n} 学期  ${mm}:${String(ss).padStart(2, '0')}`, 16, 28);
    const wzh = ({ clear: '晴', rain: '雨', snow: '雪', fog: '雾' } as Record<string, string>)[snap.weather] ?? snap.weather;
    ctx.fillText(`${snap.night ? '夜' : '昼'} · ${wzh} · 缩放 ${cam.zoom.toFixed(1)}x`, 16, 48);
    perfEnd(t0);
  }

  requestAnimationFrame(frame);
  return { setSnap, setMe, cam, screenToWorld: s2w };
}

export type Renderer2D = ReturnType<typeof createRenderer2D>;
