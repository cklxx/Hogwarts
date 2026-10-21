/**
 * 2D 俯视渲染器 (Canvas 2D)。世界 (x, z) 直接映射屏幕 (x, y)，y 向下 = +z。
 * 用色块 + 字母占位绘制实体（sprite agent 后续替换为精美贴图）。
 */
import { ELEMENT_COLORS, type CreatureKind, type Element, type House } from '../../src/shared/constants';
import { drawSprite } from './sprites.js';
import { getCharSprite, charSpriteKey, charSpriteSize, variantForName, dirFromAngle, type CharVariant } from './chars.js';
import { drawOak, drawPine, drawDeadTree, drawCottage, drawStoneHouse, drawBush, drawStone, drawLamp,
  drawWell, drawMarketStall, drawVillageGate, drawDock, drawMooringPost, drawBoat, drawLighthouse,
  drawWeb, drawGlowFlower, drawTent, drawCampfire, drawGreenhouse, drawGardenPlot,
  drawOwlery, drawScoreboard, drawTrainingHoop,
  drawShop, drawPub, drawStation, drawLibrary, drawDormTower,
  drawFlowerbed, drawBench, drawScarecrow, drawBeehive, drawSwing,
  drawSignpost, drawReed, drawMushroom } from './components.js';
import { getLayout, itemsInRect } from './layout.js';
import { assetsSettled, villageSprites, preSprite, type PreSprite } from './assets.js';
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
  alley:   { base: '#a08a6a', dark: '#857052', light: '#b89e7e', detail: '#cbb894' },
  willow:  { base: '#6f9450', dark: '#5a7a40', light: '#86ad60', detail: '#9cc173' },
  hagrid:  { base: '#7fa65c', dark: '#6a8f4c', light: '#93bb6e', detail: '#e8a03c' },
} as const;

type ZoneTex = 'castle' | 'grass' | 'forest' | 'lake' | 'village' | 'pitch' | 'alley' | 'hagrid' | 'willow';
interface Zone { x0: number; z0: number; x1: number; z1: number; pal: Palette3; label: string; tex: ZoneTex }
// 区域划分对齐 src/shared/map.ts 的服务器真实布局（此前 2D 自创位置与服务器碰撞错位）
// 服务器：城堡 x -62..62, z -118..-40；黑湖 (-118,40) r30；禁林 (165,15) r85；霍格莫德 x -30..70, z 150..208；魁地奇 x 30..50, z -185..-115
const ZONES: Zone[] = [
  { x0: -62, z0: -118, x1: 62, z1: -40, pal: PAL.stone, label: '城堡', tex: 'castle' },
  { x0: -80, z0: -40, x1: 80, z1: 60, pal: PAL.meadow, label: '', tex: 'grass' },
  { x0: 80, z0: -70, x1: 250, z1: 100, pal: PAL.forest, label: '禁林', tex: 'forest' },
  { x0: -148, z0: 10, x1: -88, z1: 70, pal: PAL.lake, label: '黑湖', tex: 'lake' },
  { x0: -30, z0: 150, x1: 70, z1: 208, pal: PAL.village, label: '霍格莫德', tex: 'village' },
  { x0: 0, z0: -215, x1: 80, z1: -95, pal: PAL.pitchA, label: '魁地奇球场', tex: 'pitch' },
  { x0: -270, z0: 80, x1: -130, z1: 210, pal: PAL.alley, label: '对角巷', tex: 'alley' },
  { x0: 80, z0: 102, x1: 150, z1: 165, pal: PAL.hagrid, label: '海格小屋', tex: 'hagrid' },
  { x0: 15, z0: -30, x1: 75, z1: 30, pal: PAL.willow, label: '打人柳', tex: 'willow' },
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
// 3转2 生物映射：物种 kind -> hw 精灵名 + 目标宽度系数（× 旧绘制 size 的屏幕 px）。
// 未映射的物种继续走 sprites.ts 代码绘制（分批替换中）。
const CREATURE_HW: Record<string, { name: string; kw: number }> = {
  spider: { name: 'hw-spider', kw: 2.6 },
  aragog: { name: 'hw-spider', kw: 3.6 },
  basilisk: { name: 'hw-basilisk', kw: 1.7 },
  hippogriff: { name: 'hw-hippogriff', kw: 1.7 },
  snare: { name: 'hw-devils-snare', kw: 2.0 },
  dementor: { name: 'hw-dementor-down', kw: 1.6 },
  owl: { name: 'hw-owl-brown', kw: 1.6 },
  cat: { name: 'hw-cat', kw: 1.2 },
};
const HW_HOUSES = ['gryffindor', 'slytherin', 'ravenclaw', 'hufflepuff'];
/** 巫师实体 -> hw 人物精灵基名。merchant/elf 暂无 hw 模型，返回 null 回退 chars.ts。 */
function hwFigureBase(name: string, house: string, variant: CharVariant): string | null {
  const n = name.toLowerCase();
  if (n.includes('norris')) return 'hw-cat'; // 洛丽丝夫人是猫，不是巫师
  if (n.includes('dementor')) return 'hw-dementor';
  if (variant === 'hagrid') return 'hw-hagrid';
  if (variant === 'professor') return 'hw-professor';
  if (variant === 'student') return 'hw-wizard-' + (HW_HOUSES.includes(house) ? house : 'gryffindor');
  return null;
}
const elemCssCache = new Map<Element, string>();
// projectile motion trails: id -> recent screen positions + last-seen timestamp
const projTrails = new Map<string, { pts: [number, number][]; last: number }>();
// walk animation state per wizard handle: last pos + frame counter
const walkState = new Map<string, { x: number; z: number; t: number }>();
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

// --- T4 宝可梦式：水面 2 帧波光动画。预渲染两帧波光 overlay，按时间切换 ---
const LAKE_ZONE = { x0: -148, z0: 10, x1: -88, z1: 70 };
function buildWaveFrame(phase: number): HTMLCanvasElement {
  const w = (LAKE_ZONE.x1 - LAKE_ZONE.x0) * TPX, h = (LAKE_ZONE.z1 - LAKE_ZONE.z0) * TPX;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  const rnd = mulberry(phase === 0 ? 777 : 778);
  g.strokeStyle = hexA(PAL.lake.detail, 0.55);
  g.lineWidth = 2;
  g.beginPath();
  const n = 14;
  for (let i = 0; i < n; i++) {
    const x = 14 + rnd() * (w - 28), y = 14 + rnd() * (h - 28);
    const r = 5 + rnd() * 8, a = rnd() * Math.PI + phase * 1.2;
    g.arc(x, y, r, a, a + 1.1);
  }
  g.stroke();
  return c;
}
let waveFrames: HTMLCanvasElement[] | null = null;

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
  // grass tufts: 3-blade clusters, darker green — 1x 下可见：更粗更高更密
  const nt = (w * h) / 480;
  g.strokeStyle = hexA(P.dark, 0.8);
  g.lineWidth = 2.4;
  g.beginPath();
  for (let i = 0; i < nt; i++) {
    const x = x0 + rnd() * w, y = y0 + rnd() * h;
    g.moveTo(x - 3.5, y); g.lineTo(x - 5, y - 7 - rnd() * 4);
    g.moveTo(x, y); g.lineTo(x, y - 9 - rnd() * 4);
    g.moveTo(x + 3.5, y); g.lineTo(x + 5, y - 7 - rnd() * 4);
  }
  g.stroke();
  // dirt specks: 小土斑，1x 下的地面颗粒感
  const nd2 = (w * h) / 1300;
  for (let i = 0; i < nd2; i++) {
    blob(g, x0 + rnd() * w, y0 + rnd() * h, 1.6 + rnd() * 2.4, hexA('#5a4a38', 0.35));
  }
  // 野花已移除（语义规范 v2）：花只长在花坛/人工处，野外不长花
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
  // dappled sunlight spots — 1x 下可见：更亮更多
  const nd = (w * h) / 6000;
  for (let i = 0; i < nd; i++) {
    blob(g, x0 + rnd() * w, y0 + rnd() * h, 4 + rnd() * 8, hexA(P.detail, 0.45));
  }
  // leaf litter: 落叶碎点
  const nl = (w * h) / 1100;
  for (let i = 0; i < nl; i++) {
    blob(g, x0 + rnd() * w, y0 + rnd() * h, 1.6 + rnd() * 2.2,
      rnd() < 0.5 ? hexA('#6b5a3a', 0.4) : hexA(P.dark, 0.5));
  }
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
  // 区域视觉语言：禁林雾气。12 团半透明灰白，低空漂浮感。
  for (let i = 0; i < 12; i++) {
    const mx = x0 + rnd() * w, my = y0 + rnd() * h;
    const mr = 30 + rnd() * 50;
    const grad = g.createRadialGradient(mx, my, 0, mx, my, mr);
    grad.addColorStop(0, 'rgba(200,210,220,0.14)');
    grad.addColorStop(1, 'rgba(200,210,220,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(mx, my, mr, 0, Math.PI * 2); g.fill();
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

// --- village: tonal patches only. Ground tiles + buildings are drawn crisp
// --- by paintVillageAssets() after the blur pass (Kenney asset pilot). ---
const texVillage: Painter = (g, x0, y0, w, h, rnd) => {
  const P = PAL.village;
  // tonal patches
  const np = (w * h) / 14000;
  for (let i = 0; i < np; i++) {
    blob(g, x0 + rnd() * w, y0 + rnd() * h, 14 + rnd() * 30,
      rnd() < 0.5 ? hexA(P.dark, 0.22) : hexA(P.light, 0.22));
  }
};

// --- Hogsmeade asset pilot (Kenney CC0, assets.ts): tiled ground + composed
// --- houses/trees/lamps, drawn CRISP after the zone blur. Falls back to the
// --- old code-drawn items when the asset pack failed to load. ---
const VILLAGE = ZONES.find((z) => z.tex === 'village')!;
const inVillage = (x: number, z: number): boolean =>
  x >= VILLAGE.x0 && x <= VILLAGE.x1 && z >= VILLAGE.z0 && z <= VILLAGE.z1;

/** 3转2 精灵绘制：(ox, oy) = 地面原点（占地中心）在纹理空间的落点，
 *  k = 纹理px / 精灵px。预渲染图非像素画，绘制时开启平滑缩放。
 *  返回 false = 精灵未就绪，调用方走原路径回退。 */
function drawPre(g: CanvasRenderingContext2D, pm: PreSprite | null, ox: number, oy: number, k: number): boolean {
  if (!pm) return false;
  g.imageSmoothingEnabled = true;
  g.drawImage(pm.img, ox - pm.anchorX * k, oy - pm.anchorY * k, pm.w * k, pm.h * k);
  g.imageSmoothingEnabled = false;
  return true;
}

/** hw 精灵（地面纹理空间）：以世界坐标 (wx, wz) 为占地中心原点、visualW 为
 *  视觉宽度（世界单位）绘制。返回 false = 精灵未就绪，调用方走原代码绘制。 */
function drawHwTex(g: CanvasRenderingContext2D, name: string, wx: number, wz: number, visualW: number): boolean {
  const pm = preSprite(name);
  if (!pm) return false;
  return drawPre(g, pm, w2tx(wx), w2ty(wz), (visualW * TPX) / pm.w);
}

function paintVillageAssets(g: CanvasRenderingContext2D): void {
  const vs = villageSprites();
  const items = itemsInRect(getLayout(), VILLAGE.x0, VILLAGE.z0, VILLAGE.x1, VILLAGE.z1);
  const shadow = (x: number, y: number, w: number): void => {
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath(); g.ellipse(x, y - 2, w / 2, Math.max(2, w / 7), 0, 0, Math.PI * 2); g.fill();
  };
  // 3转2 试点：命名商店按标签选预渲染房屋，视觉宽度 = 占地宽 1.8 倍（碰撞不变），
  // 地面原点对齐占地中心。精灵自带烘焙阴影，不再叠椭圆假阴影。
  const shopPreName = (label: string): string =>
    label.includes('Broomsticks') ? 'houseTavern'
    : label.includes("Hog's Head") || label.includes('Zonko') ? 'houseStone' : 'houseWood';
  const drawPreShop = (o: { label?: string; x0: number; x1: number; z0: number; z1: number }): boolean => {
    const pm = preSprite(shopPreName(o.label ?? ''));
    if (!pm) return false;
    const k = (1.8 * (o.x1 - o.x0) * TPX) / pm.w;
    return drawPre(g, pm, w2tx((o.x0 + o.x1) / 2), w2ty((o.z0 + o.z1) / 2), k);
  };
  if (!vs) {
    // fallback: previous code-drawn village items + named shops
    for (const it of items) {
      const hx = w2tx(it.x), hy = w2ty(it.z);
      if (it.kind === 'cottage') drawCottage(g, hx, hy, TPX * it.s);
      else if (it.kind === 'stonehouse') drawStoneHouse(g, hx, hy, TPX * it.s);
      else if (it.kind === 'lamp') drawLamp(g, hx, hy, TPX * it.s);
    }
    for (const o of OBSTACLES) {
      if (o.kind !== 'box' || o.style !== 'house' || !o.label) continue;
      const cx = (o.x0 + o.x1) / 2, cz = (o.z0 + o.z1) / 2;
      if (!inVillage(cx, cz)) continue;
      const hx = w2tx(cx), hy = w2ty(o.z1);
      if (!drawPreShop(o)) {
        const s = TPX * Math.min((o.x1 - o.x0) / 96, (o.z1 - o.z0) / 72);
        drawStoneHouse(g, hx, hy, s);
      }
      g.fillStyle = '#fff'; g.font = '11px sans-serif'; g.textAlign = 'center';
      g.fillText(o.label, hx, hy + 13);
    }
    return;
  }

  // ---- ground tiles: grass base, dirt plaza + dirt band along village roads ----
  const TS = 16; // texture px per tile (1:1 with source art)
  const gx0 = w2tx(VILLAGE.x0), gy0 = w2ty(VILLAGE.z0);
  const gx1 = w2tx(VILLAGE.x1), gy1 = w2ty(VILLAGE.z1);
  const c0 = Math.floor(gx0 / TS), c1 = Math.floor(gx1 / TS);
  const r0 = Math.floor(gy0 / TS), r1 = Math.floor(gy1 / TS);
  const roadPts = getLayout().roads.flatMap((r) => r.pts)
    .filter((p) => p.x > VILLAGE.x0 - 8 && p.x < VILLAGE.x1 + 8 && p.z > VILLAGE.z0 - 8 && p.z < VILLAGE.z1 + 8);
  const cellWorld = (cx: number, cy: number): [number, number] =>
    [TB.x0 + (cx * TS + TS / 2) / TPX, TB.z0 + (cy * TS + TS / 2) / TPX];
  const dirtAt = (wx: number, wz: number): boolean => {
    if (Math.hypot(wx - 3, wz - 180) < 15) return true; // village plaza
    for (const p of roadPts) if (Math.hypot(wx - p.x, wz - p.z) < 5.5) return true;
    return false;
  };
  const hash = (a: number, b: number): number => {
    const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const dirtGrid = new Map<string, boolean>();
  const isDirt = (cx: number, cy: number): boolean => {
    const k = cx + ',' + cy;
    let v = dirtGrid.get(k);
    if (v === undefined) { const [wx, wz] = cellWorld(cx, cy); v = dirtAt(wx, wz); dirtGrid.set(k, v); }
    return v;
  };
  for (let cy = r0; cy <= r1; cy++) {
    for (let cx = c0; cx <= c1; cx++) {
      const [wx, wz] = cellWorld(cx, cy);
      const inside = inVillage(wx, wz);
      // outer transition ring: cells just outside the rect fade the tiles in
      const near = wx > VILLAGE.x0 - 6 && wx < VILLAGE.x1 + 6 && wz > VILLAGE.z0 - 6 && wz < VILLAGE.z1 + 6;
      if (!inside && !near) continue;
      // feather the patch edge against the blurred surroundings
      const edge = wx - VILLAGE.x0 < 6 || VILLAGE.x1 - wx < 6 || wz - VILLAGE.z0 < 6 || VILLAGE.z1 - wz < 6;
      g.globalAlpha = !inside ? 0.22 : edge ? 0.45 : 1;
      let tile: HTMLCanvasElement;
      if (isDirt(cx, cy)) {
        const n = isDirt(cx, cy - 1), s2 = isDirt(cx, cy + 1), w = isDirt(cx - 1, cy), e = isDirt(cx + 1, cy);
        if (!n && !w) tile = vs.dirtEdge.tl;
        else if (!n && !e) tile = vs.dirtEdge.tr;
        else if (!s2 && !w) tile = vs.dirtEdge.bl;
        else if (!s2 && !e) tile = vs.dirtEdge.br;
        else if (!n) tile = vs.dirtEdge.t;
        else if (!s2) tile = vs.dirtEdge.b;
        else if (!w) tile = vs.dirtEdge.l;
        else if (!e) tile = vs.dirtEdge.r;
        else tile = hash(cx, cy) < 0.12 ? vs.dirtVar : vs.dirtFull;
      } else {
        const h = hash(cx, cy);
        tile = h < 0.8 ? vs.grass[0] : h < 0.94 ? vs.grass[1] : vs.grass[2];
      }
      g.drawImage(tile, cx * TS, cy * TS);
    }
  }
  g.globalAlpha = 1;

  // ---- trees + fence runs (fixed decorative spots, clear of buildings/roads) ----
  const trees: Array<[number, number, HTMLCanvasElement, number, number]> = [
    [-24, 146, vs.pine, 10, 20], [14, 145, vs.roundTree, 10, 20], [27, 146, vs.pineSmall, 7, 7],
    [44, 157, vs.pine, 10, 20], [53, 175, vs.autumn, 22, 22], [45, 197, vs.roundTree, 10, 20],
    [59, 189, vs.thinTree, 9, 18], [-25, 197, vs.pine, 10, 20], [-21, 206, vs.pineOrange, 10, 20],
    [21, 205, vs.roundTree, 10, 20], [37, 207, vs.pineSmall, 7, 7], [-13, 207, vs.pine, 10, 20],
    [64, 168, vs.grove, 22, 22],
  ];
  for (const [tx, tz, spr, wu, hu] of trees) {
    const x = w2tx(tx), y = w2ty(tz);
    // 3转2：松/圆冠换预渲染树（自带阴影），其余仍用图集精灵 + 椭圆假阴影
    const pm = spr === vs.pine ? preSprite('treePine') : spr === vs.roundTree ? preSprite('treeRound') : null;
    if (pm && drawPre(g, pm, x, y, (wu * TPX * 1.1) / pm.w)) continue;
    shadow(x, y, wu * TPX * 0.8);
    g.drawImage(spr, x - (wu * TPX) / 2, y - hu * TPX, wu * TPX, hu * TPX);
  }
  // fence runs along the north edge, gap at the gate/road (x -6..8)
  for (const [fx0, fx1] of [[-27, -8], [10, 28]] as Array<[number, number]>) {
    const x = w2tx(fx0), y = w2ty(143), w = (fx1 - fx0) * TPX;
    const pmFence = preSprite('fence');
    if (pmFence) {
      // 预渲染栅栏一段 = 1 米；游戏内每 3 世界单位铺一段（柱距与原素材相近）
      const segW = 3 * TPX, k = segW / pmFence.w;
      for (let sx = x + segW / 2; sx < x + w; sx += segW) drawPre(g, pmFence, sx, y, k);
    } else {
      g.drawImage(vs.fenceRun, x, y - 5 * TPX, w, (w / 64) * 16);
    }
  }
  // street lamps along R5 (the shared layout places none inside the village:
  // its 12x48 footprint collides with the shop boxes — these are visual-only,
  // mirroring the layout's own road-lamp rhythm: every ~15 units, alternating)
  for (const [lx, lz] of [[-11, 153], [11, 170], [-11, 187], [11, 203]] as Array<[number, number]>) {
    const x = w2tx(lx), y = w2ty(lz), s = TPX;
    const pmLamp = preSprite('lamp');
    if (!(pmLamp && drawPre(g, pmLamp, x, y, (32 * s) / pmLamp.h))) {
      g.drawImage(vs.lamp, x - 6 * s, y - 32 * s, 12 * s, 32 * s);
    }
  }

  // ---- layout houses + lamps ----
  for (const it of items) {
    const x = w2tx(it.x), y = w2ty(it.z), s = TPX * it.s;
    if (it.kind === 'cottage' || it.kind === 'stonehouse') {
      // 3转2：原点（占地中心）= 基线（南缘）向北 footD/2；宽度沿用原素材口径
      const pm = preSprite(it.kind === 'cottage' ? 'houseWood' : 'houseStone');
      const artW = it.kind === 'cottage' ? 72 * s : 96 * s;
      if (pm) {
        const k = artW / pm.w;
        if (drawPre(g, pm, x, y - (pm.footD / 2) * pm.ppm * k, k)) continue;
      }
      if (it.kind === 'cottage') {
        shadow(x, y, 72 * s);
        g.drawImage(vs.cottage, x - 36 * s, y - 56 * s, 72 * s, 56 * s);
      } else {
        shadow(x, y, 96 * s);
        g.drawImage(vs.stonehouse, x - 48 * s, y - 72 * s, 96 * s, 72 * s);
      }
    } else if (it.kind === 'lamp') {
      const pmLamp = preSprite('lamp');
      if (!(pmLamp && drawPre(g, pmLamp, x, y, (32 * s) / pmLamp.h))) {
        g.drawImage(vs.lamp, x - 6 * s, y - 32 * s, 12 * s, 32 * s);
      }
    }
  }

  // ---- server named shops (asset houses + sign + label) ----
  for (const o of OBSTACLES) {
    if (o.kind !== 'box' || o.style !== 'house' || !o.label) continue;
    const cx = (o.x0 + o.x1) / 2, cz = (o.z0 + o.z1) / 2;
    if (!inVillage(cx, cz)) continue;
    const hx = w2tx(cx), hy = w2ty(o.z1);
    const fw = o.x1 - o.x0, fh = o.z1 - o.z0;
    const s = TPX * Math.min(fw / 96, fh / 72);
    const spr = o.label.includes('Broomsticks') ? vs.shopRed
      : o.label.includes("Hog's Head") ? vs.shopGreen : vs.shopGray;
    if (!drawPreShop(o)) {
      shadow(hx, hy, 96 * s);
      g.drawImage(spr, hx - 48 * s, hy - 72 * s, 96 * s, 72 * s);
      g.drawImage(vs.sign, hx + 32 * s, hy - 16 * s, 16 * s, 16 * s);
    }
    g.fillStyle = '#fff'; g.font = '11px sans-serif'; g.textAlign = 'center';
    g.fillText(o.label, hx, hy + 13);
  }
}

// --- server named buildings (outside Hogsmeade): drawn from OBSTACLES, labeled ---
function paintServerBuildings(g: CanvasRenderingContext2D): void {
  for (const o of OBSTACLES) {
    if (o.kind !== 'box' || o.style !== 'house' || !o.label) continue;
    // Hogsmeade shops are drawn by paintVillageAssets (asset pilot)
    if (inVillage((o.x0 + o.x1) / 2, (o.z0 + o.z1) / 2)) continue;
    const cx = (o.x0 + o.x1) / 2;
    const hx = w2tx(cx), hy = w2ty(o.z1); // anchored on the footprint's south edge (the sprite grows north from its base line)
    // named shops get stone houses, scaled to fit INSIDE the server footprint: the old
    // max(..., 0.7) floor blew a 12x10 m shop up to ~67x50 m of art, merging both shops
    // into one mega-building that covered the walkable street — players standing on the
    // street rendered "on the roof" (2026-10-20 review)
    const fw = (o.x1 - o.x0), fh = (o.z1 - o.z0);
    const s = TPX * Math.min(fw / 96, fh / 72);
    drawStoneHouse(g, hx, hy, s);
    // label just south of the base line
    g.fillStyle = '#fff'; g.font = `${Math.max(10, 11 * 1)}px sans-serif`;
    g.textAlign = 'center';
    g.fillText(o.label, hx, hy + 13);
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

// --- quidditch pitch: stands ring + mowed field + goal hoops (server positions) ---
// zone: x 0..80, z -215..-95. field centered at world (40,-150), x 22..58, z -185..-115.
const texPitch: Painter = (g, x0, y0, w, h, rnd) => {
  // outer ground: trampled grass
  g.fillStyle = PAL.pitchB.base;
  g.fillRect(x0, y0, w, h);
  const nn = (w * h) / 4000;
  for (let i = 0; i < nn; i++) {
    blob(g, x0 + rnd() * w, y0 + rnd() * h, 1.5, hexA(PAL.pitchB.detail, 0.2));
  }
  // field rect (world -> texture px)
  const fx0 = w2tx(22), fz0 = w2ty(-185), fx1 = w2tx(58), fz1 = w2ty(-115);
  const fw = fx1 - fx0, fh = fz1 - fz0;
  // stands: 3 tiers around field, alternating house colors
  const tiers: Array<[number, string, string]> = [
    [10, '#7a1f1f', '#1f3a5e'],  // gryffindor / ravenclaw
    [20, '#1f5e2e', '#8a7a1f'],  // slytherin / hufflepuff
    [30, '#5e5e5e', '#7a7a7a'],  // neutral top
  ];
  for (const [off, c1, c2] of tiers) {
    const o = off * TPX;
    g.fillStyle = c1;
    g.fillRect(fx0 - o, fz0 - o, fw + o * 2, o);                    // north
    g.fillRect(fx0 - o, fz1, fw + o * 2, o);                       // south
    g.fillStyle = c2;
    g.fillRect(fx0 - o, fz0, o, fh + o * 2);                       // west
    g.fillRect(fx1, fz0, o, fh + o * 2);                          // east
    // crowd dots
    g.fillStyle = 'rgba(240,230,200,0.5)';
    const n = Math.floor((fw + fh) / 12);
    for (let i = 0; i < n; i++) {
      const t = rnd();
      const px = fx0 - o + rnd() * (fw + o * 2), py = fz0 - o + rnd() * o;
      blob(g, px, py, 1.6, 'rgba(240,230,200,0.5)');
      blob(g, fx0 - o + rnd() * (fw + o * 2), fz1 + rnd() * o, 1.6, 'rgba(240,230,200,0.5)');
      void t;
    }
  }
  // mowed stripes on field
  const stripeH = fh / 9;
  for (let i = 0; i < 9; i++) {
    g.fillStyle = i % 2 ? PAL.pitchA.base : PAL.pitchB.base;
    g.fillRect(fx0, fz0 + i * stripeH, fw, stripeH + 1);
  }
  const L = 'rgba(245,245,240,0.85)';
  g.strokeStyle = L; g.lineWidth = 2.4;
  g.strokeRect(fx0 + 6, fz0 + 6, fw - 12, fh - 12);
  g.beginPath();
  g.moveTo(fx0 + fw / 2, fz0 + 6); g.lineTo(fx0 + fw / 2, fz1 - 6);
  g.arc(fx0 + fw / 2, fz0 + fh / 2, 26, 0, 7);
  g.stroke();
  // goal hoops at server positions: x 34/40/46, z -178 / -122
  for (const wz of [-178, -122]) {
    for (const wx of [34, 40, 46]) {
      const hx = w2tx(wx), hy = w2ty(wz);
      g.strokeStyle = '#3a3230'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx, hy - 14); g.stroke();
      g.strokeStyle = '#d4a017'; g.lineWidth = 2.6;
      g.beginPath(); g.arc(hx, hy - 20, 7, 0, 7); g.stroke();
    }
  }
};


// --- diagon alley: cobblestone commercial street, shop-lined ---
// zone: x -270..-130, z 80..210. street along x=-200.
const texAlley: Painter = (g, x0, y0, w, h, rnd) => {
  const P = PAL.alley;
  // tonal patches
  const np = (w * h) / 14000;
  for (let i = 0; i < np; i++) {
    blob(g, x0 + rnd() * w, y0 + rnd() * h, 14 + rnd() * 30,
      rnd() < 0.5 ? hexA(P.dark, 0.22) : hexA(P.light, 0.22));
  }
  // cobblestone: staggered
  const step = 5 * TPX;
  let row = 0;
  for (let y = y0 + step / 2; y < y0 + h; y += step, row++) {
    const off = (row % 2) * step / 2;
    for (let x = x0 + step / 2 + off; x < x0 + w; x += step) {
      blob(g, x, y, step * 0.32, rnd() < 0.5 ? hexA(P.dark, 0.3) : hexA(P.light, 0.25));
    }
  }
  // central street: lighter band along x=-200 (world)
  const sx = w2tx(-200);
  g.fillStyle = hexA(P.light, 0.35);
  g.fillRect(sx - 9 * TPX, y0, 18 * TPX, h);
  // street edge lines
  g.strokeStyle = hexA(P.dark, 0.6); g.lineWidth = 2;
  g.beginPath(); g.moveTo(sx - 9 * TPX, y0); g.lineTo(sx - 9 * TPX, y0 + h); g.stroke();
  g.beginPath(); g.moveTo(sx + 9 * TPX, y0); g.lineTo(sx + 9 * TPX, y0 + h); g.stroke();
  // hanging lanterns across street
  for (let i = 0; i < 6; i++) {
    const ly = y0 + (h / 7) * (i + 1);
    g.strokeStyle = '#3a3230'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(sx - 9 * TPX, ly); g.lineTo(sx + 9 * TPX, ly); g.stroke();
    blob(g, sx, ly + 3, 3, '#ffd98a');
    blob(g, sx, ly + 3, 6, 'rgba(255,217,138,0.25)');
  }
};

// --- hagrid's hut area: meadow + pumpkin patch + dirt ---
// zone: x 80..150, z 102..165.
const texHagrid: Painter = (g, x0, y0, w, h, rnd) => {
  const P = PAL.hagrid;
  // tonal patches
  const np = (w * h) / 14000;
  for (let i = 0; i < np; i++) {
    blob(g, x0 + rnd() * w, y0 + rnd() * h, 12 + rnd() * 26,
      rnd() < 0.5 ? hexA(P.dark, 0.2) : hexA(P.light, 0.2));
  }
  // dirt patch for pumpkins (world 95..135, 140..160)
  const dx0 = w2tx(95), dz0 = w2ty(140), dx1 = w2tx(135), dz1 = w2ty(160);
  g.fillStyle = '#7a5c44';
  g.fillRect(dx0, dz0, dx1 - dx0, dz1 - dz0);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let i = 0; i < 40; i++) {
    blob(g, dx0 + rnd() * (dx1 - dx0), dz0 + rnd() * (dz1 - dz0), 2 + rnd() * 3, 'rgba(0,0,0,0.12)');
  }
  // pumpkin rows: 3 rows x 5
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 5; c++) {
      const px = dx0 + 12 + c * ((dx1 - dx0 - 24) / 4) + (rnd() - 0.5) * 6;
      const py = dz0 + 14 + r * ((dz1 - dz0 - 28) / 2) + (rnd() - 0.5) * 6;
      const pr = 7 + rnd() * 3;
      blob(g, px + 2, py + 1, pr, 'rgba(0,0,0,0.2)');       // shadow
      blob(g, px, py, pr, '#d08030');                        // pumpkin
      blob(g, px - pr * 0.3, py - pr * 0.3, pr * 0.45, '#e8a03c'); // highlight
      g.strokeStyle = '#8a5a20'; g.lineWidth = 1.5;          // ribs
      g.beginPath(); g.moveTo(px, py - pr); g.lineTo(px, py + pr); g.stroke();
      g.strokeStyle = '#3d5c3e'; g.lineWidth = 2;            // stem
      g.beginPath(); g.moveTo(px, py - pr); g.lineTo(px + 2, py - pr - 5); g.stroke();
    }
  }
  // grass tufts around
  g.strokeStyle = hexA(P.dark, 0.4); g.lineWidth = 1.6;
  g.beginPath();
  for (let i = 0; i < 120; i++) {
    const x = x0 + rnd() * w, y = y0 + rnd() * h;
    if (x > dx0 - 10 && x < dx1 + 10 && y > dz0 - 10 && y < dz1 + 10) continue;
    g.moveTo(x - 3, y); g.lineTo(x - 4, y - 5 - rnd() * 3);
    g.moveTo(x, y); g.lineTo(x, y - 6 - rnd() * 3);
    g.moveTo(x + 3, y); g.lineTo(x + 4, y - 5 - rnd() * 3);
  }
  g.stroke();
};

// --- whomping willow: meadow + landmark tree + warning sign ---
// zone: x 15..75, z -30..30. server tree at (45,0) r=3.
const texWillow: Painter = (g, x0, y0, w, h, rnd) => {
  const P = PAL.willow;
  // tonal patches
  const np = (w * h) / 14000;
  for (let i = 0; i < np; i++) {
    blob(g, x0 + rnd() * w, y0 + rnd() * h, 12 + rnd() * 26,
      rnd() < 0.5 ? hexA(P.dark, 0.2) : hexA(P.light, 0.2));
  }
  const tx = w2tx(45), ty = w2ty(0);
  const S = TPX;
  // ground shadow
  blob(g, tx + 8 * S, ty, 40 * S, 'rgba(0,0,0,0.25)');
  // trunk: thick, gnarled
  g.strokeStyle = '#4a352a'; g.lineWidth = 14 * S; g.lineCap = 'round';
  g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx + 3 * S, ty - 40 * S); g.stroke();
  g.strokeStyle = '#2a1f1a'; g.lineWidth = Math.max(1, 1.2 * S);
  g.beginPath(); g.moveTo(tx - 7 * S, ty); g.lineTo(tx - 4 * S, ty - 40 * S); g.stroke();
  g.strokeStyle = '#6b4f3a'; g.lineWidth = 4 * S;
  g.beginPath(); g.moveTo(tx - 2 * S, ty - 4 * S); g.lineTo(tx + 1 * S, ty - 36 * S); g.stroke();
  // branches
  g.strokeStyle = '#4a352a'; g.lineWidth = 6 * S;
  for (const [dx, len] of [[-1, 34], [1, 30], [0, 38]] as const) {
    g.beginPath();
    g.moveTo(tx + 3 * S, ty - 40 * S);
    g.lineTo(tx + (3 + dx * len * 0.5) * S, ty - (40 + len * 0.8) * S);
    g.stroke();
  }
  // drooping canopy: layered hanging blobs
  const layers: Array<[number, number, string]> = [
    [52, 34, '#2c4530'], [62, 30, '#3d5c3e'], [72, 25, '#527a4e'],
  ];
  for (const [dy, r, col] of layers) {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + dy;
      const bx = tx + Math.cos(a) * r * S * 0.9;
      const by = ty - dy * S + Math.sin(a) * r * S * 0.35 + 8 * S;
      blob(g, bx, by, (10 + rnd() * 8) * S * 0.5, col);
    }
  }
  // hanging strands
  g.strokeStyle = hexA('#3d5c3e', 0.7); g.lineWidth = 2 * S;
  g.beginPath();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const sx = tx + Math.cos(a) * 30 * S, sy = ty - 58 * S + Math.sin(a) * 8 * S;
    g.moveTo(sx, sy); g.lineTo(sx + (rnd() - 0.5) * 6 * S, sy + (14 + rnd() * 10) * S);
  }
  g.stroke();
  // canopy outline
  g.strokeStyle = '#2a1f1a'; g.lineWidth = Math.max(1, 1.5 * S);
  g.beginPath(); g.ellipse(tx, ty - 62 * S, 34 * S, 22 * S, 0, 0, Math.PI * 2); g.stroke();
  // warning sign at (62,14)
  const wx = w2tx(62), wy = w2ty(14);
  g.fillStyle = '#4a3a2c';
  g.fillRect(wx - 1.5 * S, wy - 16 * S, 3 * S, 16 * S);
  g.fillStyle = '#e8c03c';
  g.beginPath();
  g.moveTo(wx, wy - 28 * S); g.lineTo(wx + 10 * S, wy - 10 * S); g.lineTo(wx - 10 * S, wy - 10 * S);
  g.closePath(); g.fill();
  g.strokeStyle = '#2a1f1a'; g.lineWidth = Math.max(1, S * 0.5); g.stroke();
  g.fillStyle = '#2a1f1a';
  g.font = `bold ${Math.max(10, 12 * S * 0.5)}px sans-serif`; g.textAlign = 'center';
  g.fillText('!', wx, wy - 13 * S);
};

const TEX_PAINT: Record<ZoneTex, Painter> = {
  castle: texCastle, grass: texGrass, forest: texForest,
  lake: texLake, village: texVillage, pitch: texPitch,
  alley: texAlley, hagrid: texHagrid, willow: texWillow,
};

// --- hex + alpha helper (for palette colors) ---
function hexA(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16), gg = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${gg},${b},${a})`;
}

// --- decorative scatter: paths, bushes, stones (fixed seeds, drawn over zones) ---
function paintDecorations(g: CanvasRenderingContext2D): void {
  const L = getLayout();
  // roads from layout: dark edge -> base -> light center
  // (Hogsmeade pilot: the tiled dirt band replaces road strokes inside the
  // village rect, so strokes are clipped out of it when assets are ready)
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.save();
  if (villageSprites()) {
    const clip = new Path2D();
    clip.rect(0, 0, TW, TH);
    clip.rect(w2tx(VILLAGE.x0), w2ty(VILLAGE.z0), (VILLAGE.x1 - VILLAGE.x0) * TPX, (VILLAGE.z1 - VILLAGE.z0) * TPX);
    g.clip(clip, 'evenodd');
  }
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
  g.restore();
  // bushes & stones from layout (collision-checked at build)
  // + v2 new regions: well/market/gate/dock/boat/lighthouse/web/glowflower/tent/campfire/greenhouse/garden/owlery/scoreboard/hoop
  // L4 视觉层次：灌木/石头是背景板，压暗 30% + 降饱和度，不抢建筑的戏。
  // 实现：先画到独立 deco 图层，source-atop 罩深灰绿（同时压暗+去饱和），再合成。
  // 这是纹理烘焙时的一次性成本，不影响帧率。
  const decoC = document.createElement('canvas');
  decoC.width = TW; decoC.height = TH;
  const dg = decoC.getContext('2d')!;
  for (const it of L.items) {
    const x = w2tx(it.x), y = w2ty(it.z);
    const s = TPX * it.s;
    switch (it.kind) {
      case 'bush': drawBush(dg, x, y, s); break;
      case 'stone': drawStone(dg, x, y, s, it.v); break;
      case 'mushroom': drawMushroom(dg, x, y, s); break;
      default: break; // 非 L4 装饰画到主图层
    }
  }
  // 压暗 30% + 降饱和度：深灰绿罩
  dg.globalCompositeOperation = 'source-atop';
  dg.fillStyle = 'rgba(38,44,38,0.30)';
  dg.fillRect(0, 0, TW, TH);
  dg.globalCompositeOperation = 'source-over';
  g.drawImage(decoC, 0, 0);
  for (const it of L.items) {
    const x = w2tx(it.x), y = w2ty(it.z);
    const s = TPX * it.s;
    switch (it.kind) {
      case 'bush': case 'stone': case 'mushroom': break; // 已在 deco 图层画过
      case 'brazier': {
        const bs = Math.max(16, 20 * TPX * it.s / 3);
        drawSprite(g, 'brazier', x - bs / 2, y - bs / 2 - 8 * TPX * it.s / 3, bs, bs);
        break;
      }
      case 'well': drawWell(g, x, y, s); break;
      case 'marketstall': drawMarketStall(g, x, y, s); break;
      case 'villagegate': drawVillageGate(g, x, y, s); break;
      case 'dock': if (!preSprite('hw-lake-dock')) drawDock(g, x, y, s); break; // hw 码头在 landmarks pass 合并绘制
      case 'mooringpost': drawMooringPost(g, x, y, s); break;
      case 'boat': drawBoat(g, x, y, s); break;
      case 'lighthouse': drawLighthouse(g, x, y, s); break;
      case 'web': drawWeb(g, x, y, s); break;
      case 'glowflower': drawGlowFlower(g, x, y, s); break;
      case 'tent': drawTent(g, x, y, s); break;
      case 'campfire': drawCampfire(g, x, y, s); break;
      case 'greenhouse': if (!drawHwTex(g, 'hw-greenhouse', it.x, it.z, 80 * it.s)) drawGreenhouse(g, x, y, s); break;
      case 'gardenplot': drawGardenPlot(g, x, y, s); break;
      case 'owlery': drawOwlery(g, x, y, s); break;
      case 'scoreboard': drawScoreboard(g, x, y, s); break;
      case 'traininghoop': drawTrainingHoop(g, x, y, s); break;
      case 'shop': drawShop(g, x, y, s, it.label ?? '商店'); break;
      case 'pub': drawPub(g, x, y, s); break;
      case 'station': drawStation(g, x, y, s); break;
      case 'library': drawLibrary(g, x, y, s); break;
      case 'dormtower': drawDormTower(g, x, y, s, it.label ?? '#7a1f1f'); break;
      case 'flowerbed': drawFlowerbed(g, x, y, s); break;
      case 'bench': drawBench(g, x, y, s); break;
      case 'scarecrow': drawScarecrow(g, x, y, s); break;
      case 'beehive': drawBeehive(g, x, y, s); break;
      case 'swing': drawSwing(g, x, y, s); break;
      case 'signpost': drawSignpost(g, x, y, s); break;
      case 'reed': drawReed(g, x, y, s); break;
    }
  }
  // T3 宝可梦式：高草=遭遇区语言。禁林边缘一圈高草，3 层深浅+缺口
  paintTallGrassRing(g);
}

// --- T3: tall grass ring at forest edge — "danger here" visual language ---
function paintTallGrassRing(g: CanvasRenderingContext2D): void {
  const rnd = mulberry(4242);
  const fx = 165, fz = 15, fr = 85; // forest disc (server truth)
  const P = PAL.grass;
  // 3-layer tufts: dark base / mid / light tip
  for (let i = 0; i < 260; i++) {
    const a = rnd() * Math.PI * 2;
    const r = fr + 4 + rnd() * 18; // ring just outside forest
    if (rnd() < 0.25) continue; // 宝可梦式随机缺口
    const x = w2tx(fx + Math.cos(a) * r), y = w2ty(fz + Math.sin(a) * r);
    const s = 0.9 + rnd() * 0.5;
    // dark base blades
    g.strokeStyle = hexA(P.dark, 0.85); g.lineWidth = 2.2 * s;
    g.beginPath();
    for (let b = -1; b <= 1; b++) {
      g.moveTo(x + b * 4 * s, y);
      g.lineTo(x + b * 5 * s, y - (10 + rnd() * 6) * s);
    }
    g.stroke();
    // mid blades
    g.strokeStyle = hexA(P.base, 0.9); g.lineWidth = 1.8 * s;
    g.beginPath();
    for (let b = -1; b <= 1; b++) {
      g.moveTo(x + b * 3 * s, y - 2 * s);
      g.lineTo(x + b * 3.5 * s, y - (13 + rnd() * 5) * s);
    }
    g.stroke();
    // light tips
    g.strokeStyle = hexA(P.light, 0.75); g.lineWidth = 1.2 * s;
    g.beginPath();
    g.moveTo(x - 2 * s, y - 8 * s); g.lineTo(x - 2.5 * s, y - 16 * s);
    g.moveTo(x + 2 * s, y - 8 * s); g.lineTo(x + 2.5 * s, y - 16 * s);
    g.stroke();
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

  // courtyard tree: small oak (same component as forest, smaller scale)
  const tree = (x: number, z: number): void => {
    drawOak(g, X(x), Y(z), TPX * 0.55);
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

// (inGrass retired: scatter placement moved to layout.ts with collision registry)


/**
 * 3转2 hw 地标 + 道具 pass（地面纹理烘焙的最后一层）。
 * 城堡建筑覆盖 paintCastle 的代码绘制（位置/占地沿用 paintCastle 的布局坐标）；
 * 道具按 item-design.md 分类摆放到对应场景。精灵未就绪时 drawHwTex 返回
 * false，什么都不画，底下的代码绘制原样保留（回退）。
 * 视觉宽度口径：建筑 ≈ 占地 1.8 倍（与霍格莫德商店试点一致），道具按实物感。
 */
function paintHwLandmarks(g: CanvasRenderingContext2D): void {
  // --- 城堡（paintCastle 坐标：大礼堂西、钟塔北、塔楼群、 南门） ---
  drawHwTex(g, 'hw-great-hall', -39, -83, 30);
  drawHwTex(g, 'hw-tower-mid', -13.5, -97.5, 11);   // 钟塔
  drawHwTex(g, 'hw-tower-tall', -56, -102, 11);
  drawHwTex(g, 'hw-tower-mid', 18, -99, 11);
  drawHwTex(g, 'hw-tower-tall', 53, -59, 12);
  drawHwTex(g, 'hw-tower-mid', 8, -45.5, 10);
  drawHwTex(g, 'hw-tower-short', -52, -59, 10);
  drawHwTex(g, 'hw-tower-short', -44, -63, 8);
  drawHwTex(g, 'hw-tower-short', -36, -62.5, 8);
  drawHwTex(g, 'hw-astro-tower', 33, -70, 12);      // 天文塔
  drawHwTex(g, 'hw-castle-wall', -32, -104, 15);
  drawHwTex(g, 'hw-castle-wall', -4, -103, 15);
  drawHwTex(g, 'hw-castle-wall', 24, -99.5, 15);
  drawHwTex(g, 'hw-castle-gate', -3, -45.3, 14);
  // --- 标志地点 ---
  drawHwTex(g, 'hw-hagrid-hut', 105, 118, 34);      // 海格小屋（布局石屋位置）
  drawHwTex(g, 'hw-whomping-willow', 45, 0, 22);    // 打人柳（willow 区中心）
  drawHwTex(g, 'hw-quidditch-hoops', 40, -178, 26);
  drawHwTex(g, 'hw-quidditch-hoops', 40, -122, 26);
  drawHwTex(g, 'hw-lake-dock', -104, 48, 36);       // 黑湖码头（两段 dock 合并）
  drawHwTex(g, 'hw-express', -44, 300, 44);         // 霍格沃茨特快（车站站台前）
  drawHwTex(g, 'hw-owl-brown', 86, -84, 5);         // 猫头鹰棚屋栖鸟
  drawHwTex(g, 'hw-owl-snowy', 75, -82, 5);
  // --- 道具（功能类：可交互场景；装饰类：依附建筑/场景） ---
  const props: Array<[string, number, number, number]> = [
    ['hw-cauldron', 99, 128, 5.5],        // 海格小屋前院
    ['hw-cauldron', 6, 186, 5],           // 霍格莫德广场
    ['hw-pumpkin', 108, 148, 5],          // 南瓜田（texHagrid 南瓜区）
    ['hw-pumpkin', 118, 152, 5.6],
    ['hw-pumpkin', 128, 146, 4.6],
    ['hw-candle', -6, -52, 2.8],          // 城堡庭院
    ['hw-candle', 6, -52, 2.8],
    ['hw-candle', -39, -64, 2.8],         // 大礼堂门前
    ['hw-chest', -24, -48, 5],            // 庭院角
    ['hw-chest', -196, 118, 5],           // 对角巷街口
    ['hw-diary', 112, -230, 3.8],         // 图书馆门前
    ['hw-broomstick', 24, -148, 5],       // 魁地奇场边
    ['hw-snitch', 40, -150, 4.2],         // 球场中央
    ['hw-quaffle', 45, -145, 3.4],
    ['hw-potion-red', -146, -52, 3],      // 温室群门前（草药课）
    ['hw-potion-green', -90, -50, 3],
    ['hw-potion-blue', -34, -52, 3],
    ['hw-mandrake', -84, -50, 3.8],
    ['hw-potion-blue', 14, 166, 3],       // 霍格莫德店前
    ['hw-devils-snare', 92, 8, 8],        // 禁林边缘
    ['hw-wand-box', -236, 148, 4],        // 奥利凡德门前
    ['hw-willow-branch', 53, 7, 8],       // 打人柳下断枝
  ];
  for (const [n, x, z, w] of props) drawHwTex(g, n, x, z, w);
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
  // Hogsmeade asset pilot: tiled ground + asset buildings (crisp, pre-decor)
  paintVillageAssets(g);
  // decorations on top (paths, bushes, stones) — not blurred, crisp details
  paintDecorations(g);
  // castle structures — crisp, drawn after the blur so walls/towers read at 1x
  paintCastle(g);
  // server named buildings (Hogsmeade shops) — crisp, after blur
  paintServerBuildings(g);
  // 3转2 hw 地标 + 道具：覆盖在代码绘制之上（精灵未就绪时各自回退，代码版保留）
  paintHwLandmarks(g);
  return c;
}


// ------------------------------------------------------------------ renderer
export interface Camera { x: number; z: number; zoom: number }

export function createRenderer2D(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  const cam: Camera = { x: 0, z: -22, zoom: 2.75 };
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
  (window as any).__2dgoto = (x: number, z: number) => { cam.x = x; cam.z = z; follow = false; };
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
    // Ground texture waits for the asset pack to settle (ready or failed);
    // a failed pack still builds, with code-drawn fallbacks inside.
    ctx.imageSmoothingEnabled = true;
    const tex = groundTex ?? (assetsSettled() ? (groundTex = buildGroundTexture()) : null);
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, W, H);
    const wA = s2w(0, 0), wB = s2w(W, H);
    const sx0 = Math.max(0, w2tx(wA.x)), sy0 = Math.max(0, w2ty(wA.z));
    const sx1 = Math.min(TW, w2tx(wB.x)), sy1 = Math.min(TH, w2ty(wB.z));
    if (tex && sx1 > sx0 && sy1 > sy0) {
      const dx = (TB.x0 + sx0 / TPX - cam.x) * cam.zoom + W / 2;
      const dy = (TB.z0 + sy0 / TPX - cam.z) * cam.zoom + H / 2;
      ctx.drawImage(tex, sx0, sy0, sx1 - sx0, sy1 - sy0,
        dx, dy, ((sx1 - sx0) / TPX) * cam.zoom, ((sy1 - sy0) / TPX) * cam.zoom);
      // T4: lake wave shimmer — 2 frames, 0.6s switch
      const wf = waveFrames ?? (waveFrames = [buildWaveFrame(0), buildWaveFrame(1)]);
      const lx0 = w2tx(LAKE_ZONE.x0), ly0 = w2ty(LAKE_ZONE.z0);
      const lx1 = w2tx(LAKE_ZONE.x1), ly1 = w2ty(LAKE_ZONE.z1);
      if (lx1 > sx0 && lx0 < sx1 && ly1 > sy0 && ly0 < sy1) {
        const frame = wf[Math.floor(performance.now() / 600) % 2];
        const cx0 = Math.max(lx0, sx0), cy0 = Math.max(ly0, sy0);
        const cx1 = Math.min(lx1, sx1), cy1 = Math.min(ly1, sy1);
        const ddx = (TB.x0 + cx0 / TPX - cam.x) * cam.zoom + W / 2;
        const ddy = (TB.z0 + cy0 / TPX - cam.z) * cam.zoom + H / 2;
        ctx.drawImage(frame, cx0 - lx0, cy0 - ly0, cx1 - cx0, cy1 - cy0,
          ddx, ddy, ((cx1 - cx0) / TPX) * cam.zoom, ((cy1 - cy0) / TPX) * cam.zoom);
      }
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
    if (cam.zoom > 0.7) {
      // 只显示离屏幕中心最近的 1 个区标签：高倍率下多个区标签
      // （城堡/禁林/黑湖…）必然重叠，玩家只关心自己在哪。
      const zoneCand: { x: number; y: number; text: string; d2: number }[] = [];
      for (const zn of ZONES) {
        if (!zn.label) continue;
        if (!visible((zn.x0 + zn.x1) / 2, (zn.z0 + zn.z1) / 2, Math.max(zn.x1 - zn.x0, zn.z1 - zn.z0))) continue;
        const [sx, sy] = w2s(zn.x0, zn.z0);
        const lx = sx + scale(zn.x1 - zn.x0) / 2, ly = sy + 16;
        const dx = lx - vw / 2, dy = ly - vh / 2;
        zoneCand.push({ x: lx, y: ly, text: zn.label, d2: dx * dx + dy * dy });
      }
      zoneCand.sort((a, b) => a.d2 - b.d2);
      const best = zoneCand[0];
      if (best) {
        setFont(zoneFont); setAlign('center');
        // 只登记锚点，文字延后到最终标签层绘制（在所有建筑/实体之上）：
        // 此处立即画会被随后绘制的建筑盖住一半（2026-10-20 review：「霍格莫德」压在楼后）
        zoneLabels.push({ x: best.x, y: best.y, text: best.text, hw: ctx.measureText(best.text).width / 2 + 2 });
      }
    }

    if (!snap) {
      ctx.fillStyle = '#fff';
      setFont('16px sans-serif');
      setAlign('center');
      ctx.fillText(tex ? '等待快照…' : '素材加载中…', W / 2, H / 2);
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
        // --- creature: hw 预渲染精灵优先，未映射物种走 pixel sprite，hp bar below ---
        const [sx, sy] = w2s(c.x, c.z);
      const size = Math.max(12, 20 * cam.zoom);
      const hwC = CREATURE_HW[c.k];
      const pmC = hwC ? preSprite(hwC.name) : null;
      if (hwC && pmC) {
        // 锚点 = 脚下地面原点，对齐旧绘制框底边（sy + size/2）
        const tw = size * hwC.kw, k = tw / pmC.w;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(pmC.img, sx - pmC.anchorX * k, sy + size / 2 - pmC.anchorY * k, tw, pmC.h * k);
        ctx.imageSmoothingEnabled = false;
      } else {
        drawSprite(ctx, c.k, sx - size / 2, sy - size / 2, size, size);
      }
      const hostile = c.s.includes('H') || HOSTILE_KINDS.has(c.k);
      const r = size / 2;
      // 密度感知：怪堆里只给最近的 3 个敌对显示标记+血条，其余只显示 sprite。
      // 否则 10+ 蜘蛛的红菱形+血条糊成一团，完全看不清。
      let showMarker = hostile;
      if (hostile && meW) {
        const d2 = (c.x - meW.x) * (c.x - meW.x) + (c.z - meW.z) * (c.z - meW.z);
        // 粗略：只在玩家 25 格内显示标记，远的怪不需要
        if (d2 > 625) showMarker = false;
      }
      if (showMarker) {
        // 红色小菱形标记（头顶），代替大红框——多怪聚集时不糊成一团
        const dx = sx, dy = sy - r - 9;
        ctx.fillStyle = '#ff2a1a';
        ctx.beginPath();
        ctx.moveTo(dx, dy - 5); ctx.lineTo(dx + 4, dy);
        ctx.lineTo(dx, dy + 5); ctx.lineTo(dx - 4, dy);
        ctx.closePath(); ctx.fill();
      }
      // hp bar：受伤必显；敌对只在有标记时显示（避免怪堆血条重叠）
      if (c.hp < c.m || showMarker) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(sx - r, sy - r - 4, r * 2, 2.5);
        ctx.fillStyle = hostile ? '#ff5a4d' : '#4dff4d';
        ctx.fillRect(sx - r, sy - r - 4, (r * 2 * c.hp) / c.m, 2.5);
      }
      // 生物不显示任何文字：敌对有红色菱形+血条，受击有血条，足够辨认。
      // 之前的首字母标签（B/R/S/P）在怪堆里必然糊成一团，已删除。
      } else {
        const w = e.w!;
        // --- wizard: house sprite + hp bar + name (names drawn in 2nd pass with de-collision) ---
      const [sx, sy] = w2s(w.x, w.z);
      const isMe = w.h === myHandle;
      const r = Math.max(5, 8 * cam.zoom);
      const size = r * 3;
      // walk animation: 2-frame leg cycle when moving (track position deltas)
      const wk = walkState.get(w.h);
      let walkFrame: 0 | 1 | 2 = 0;
      if (wk) {
        const dx = w.x - wk.x, dz = w.z - wk.z;
        const moved = dx * dx + dz * dz > 0.0004; // ~0.02 world units threshold
        if (moved) {
          wk.t += 1;
          walkFrame = ((Math.floor(wk.t / 8) % 2) + 1) as 1 | 2; // w1/w2 alternate @60fps
        } else {
          wk.t = 0;
        }
        wk.x = w.x; wk.z = w.z;
      } else {
        walkState.set(w.h, { x: w.x, z: w.z, t: 0 });
      }
      // chars.ts: 4-direction 24x36 sprites, aspect-correct draw (fallback path)
      const variant: CharVariant = variantForName(w.n);
      const spriteKey = charSpriteKey(w.n, String(w.ho).toLowerCase(), w.f, walkFrame);
      const { w: sprW, h: sprH } = charSpriteSize(variant);
      const dh = size * 1.5, dw = (dh * sprW) / sprH;
      // 3转2 hw 人物：玩家按学院色、NPC 按名字映射（教授/海格/摄魂怪/洛丽丝夫人）。
      // 行走时播工厂 w0..w3 帧（bobbing+倾斜+袍摆），站立用静态帧；精灵锚点 =
      // 脚下地面原点，对齐原绘制框的底边（sy + dh/2）；平滑缩放。
      // hw 未就绪/未映射（merchant/elf）时回退 chars.ts 代码人物。
      const hwBase = hwFigureBase(w.n, String(w.ho).toLowerCase(), variant);
      let pmChar: PreSprite | null = null;
      let charDh = dh;
      if (hwBase === 'hw-cat') {
        pmChar = preSprite('hw-cat');
        charDh = size * 0.9; // 猫的体型
      } else if (hwBase) {
        const dir = dirFromAngle(w.f);
        pmChar = (walkFrame
          ? preSprite(`${hwBase}-${dir}-w${wk ? Math.floor(wk.t / 7) % 4 : 0}`)
          : null) ?? preSprite(`${hwBase}-${dir}`);
        if (hwBase === 'hw-hagrid') charDh = dh * 1.3; // 半巨人更高大
      }
      if (pmChar) {
        const k = charDh / pmChar.h;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(pmChar.img, sx - pmChar.anchorX * k, sy + dh / 2 - pmChar.anchorY * k, pmChar.w * k, charDh);
        ctx.imageSmoothingEnabled = false;
      } else {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(getCharSprite(spriteKey), sx - dw / 2, sy - dh / 2, dw, dh);
      }
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
    // Font size capped: at 2.75x, 11*zoom=30px is unreadably huge. Cap at 14px
    // like Pokemon-style games where labels stay small regardless of zoom.
    const nameFont = (isMe: boolean) => `${isMe ? 'bold ' : ''}${Math.min(14, Math.max(10, 11 * cam.zoom))}px sans-serif`;
    setAlign('center');
    for (const nm of nameQueue) {
      setFont(nameFont(nm.isMe));
      nm.hw = ctx.measureText(nm.n).width / 2 + 2;
    }
    // 2) density cap: keep text for the nearest MAXN names to the player
    //    (player always kept); the rest become dots instead of unreadable blobs.
    //    hostile units never get names (creatures show only hp bar + marker).
    const MAXN = 8;
    nameQueue.sort((a, b) => (a.isMe ? -1 : b.isMe ? 1 : a.dw2 - b.dw2));
    for (let i = 0; i < nameQueue.length; i++) nameQueue[i].dot = i >= MAXN;
    // 2b) cluster guard: if 3+ text candidates sit within CLUSTER_R of each other
    //     (wizards stacked on one spot), keep only the 2 nearest as text.
    //     Without this, vertical stacking builds an ugly 60px+ text pillar.
    const CLUSTER_R = 60;
    {
      const cand = nameQueue.filter(n => !n.dot);
      const dropped = new Set<NameLbl>();
      for (let i = 0; i < cand.length; i++) {
        if (dropped.has(cand[i]) || cand[i].isMe) continue;
        const near: NameLbl[] = [cand[i]];
        for (let j = 0; j < cand.length; j++) {
          if (i === j || dropped.has(cand[j])) continue;
          const dx = cand[j].x - cand[i].x, dy = cand[j].y - cand[i].y;
          if (dx * dx + dy * dy < CLUSTER_R * CLUSTER_R) near.push(cand[j]);
        }
        if (near.length >= 3) {
          // keep player + 2 nearest to player, dot the rest
          near.sort((a, b) => (a.isMe ? -1 : b.isMe ? 1 : a.dw2 - b.dw2));
          for (let k = 0; k < near.length; k++) {
            if (!near[k].isMe && k >= 2) { near[k].dot = true; dropped.add(near[k]); }
          }
        }
      }
    }
    // 3) vertical stacking with width-aware collision; zone labels are fixed anchors.
    //    Stop-loss: if a label is pushed more than 4 lines from its origin,
    //    turn it into a dot instead of building a text pillar.
    nameQueue.sort((a, b) => a.y - b.y || a.x - b.x);
    const lineH = Math.min(18, Math.max(14, 13 * cam.zoom));
    const MAX_PUSH = 4 * lineH;
    const placed: { x: number; y: number; hw: number }[] = [];
    for (const z of zoneLabels) placed.push({ x: z.x, y: z.y, hw: z.hw });
    for (const nm of nameQueue) {
      if (nm.dot) continue;
      // 顶边钳制必须在碰撞循环之前作为起始 y：字体已封顶 14px，
      // baseline < 字高+边距时名字上半截被切。放循环后会破坏无碰撞保证。
      const minY = 18;
      let y = Math.max(nm.y, minY), ok = false;
      // find a y that doesn't collide with already-placed labels
      for (let attempt = 0; attempt < 24; attempt++) {
        let hit = false;
        for (const p of placed) {
          if (Math.abs(p.x - nm.x) < p.hw + nm.hw && Math.abs(p.y - y) < lineH) { hit = true; break; }
        }
        if (!hit) { ok = true; break; }
        y += lineH;
        if (y - nm.y > MAX_PUSH) break; // stop-loss: too far, give up to dot
      }
      if (!ok || y - nm.y > MAX_PUSH || y > vh + 24) { nm.dot = true; continue; }
      nm.dy = y - nm.y;
      placed.push({ x: nm.x, y, hw: nm.hw });
    }
    // 4) draw
    // zone labels first (under names, over everything else: they were painted under
    // buildings before — see the collection pass above)
    for (const z of zoneLabels) {
      setFont(zoneFont); setAlign('center');
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 3;
      ctx.strokeText(z.text, z.x, z.y);
      ctx.fillStyle = night ? '#cfd4dc' : '#2c2c2c';
      ctx.fillText(z.text, z.x, z.y);
    }
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
