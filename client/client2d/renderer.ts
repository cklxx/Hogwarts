/**
 * 2D 俯视渲染器 (Canvas 2D)。世界 (x, z) 直接映射屏幕 (x, y)，y 向下 = +z。
 * 用色块 + 字母占位绘制实体（sprite agent 后续替换为精美贴图）。
 */
import { ELEMENT_COLORS, type CreatureKind, type Element, type House } from '../../src/shared/constants';
import { getLayout, itemsInRect } from './layout.js';
import { assetsSettled, preSprite, preSpritesReady, masterPalette, type PreSprite } from './assets.js';
// 服务器地图是唯一的真实数据源（src/shared/map.ts）：2D 视觉必须与服务器碰撞一致
import { OBSTACLES } from '../../src/shared/map.js';
// 素材派生数据（manifest → derive.py → derived.json）：尺寸/占地/脚偏移的
// 唯一运行时入口，禁止在本文件再手抄数值表（见 src/shared/asset-data.ts）
import { ASSET } from '../../src/shared/asset-data.js';

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

// ------------------------------------------------------------------ 像素地面
// 与工厂精灵共用主调色板（masterPalette，源头 palette.json）：程序生成可平铺
// 像素贴图（1 格 = 1 世界单位），烘焙末尾整图再过马赛克+量化，使地面、
// 代码绘制与 hw 精灵收敛到同一像素风。调色板缺失时用内置回退板。
const FALLBACK_PALETTE = [
  '#2a1f1a', '#ffb84d', '#ffca6a', '#f5f0e0', '#7a1f1f', '#1f5c3d', '#27436e', '#d9a92c', '#d9a441',
  '#66854c', '#56743f', '#476335', '#7d9b5e', '#a08b62', '#8a744e', '#9b958b', '#7f7a71',
  '#2a4f6a', '#3c6b8a', '#274b33', '#1d3325', '#8b8e96', '#47536b', '#7a5230', '#3c6134',
];
type Rgb = [number, number, number];
const hexRgb = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const palRgbs = (): Rgb[] => (masterPalette() ?? FALLBACK_PALETTE).map(hexRgb);
const snapCache = new Map<string, Rgb>();
function snapPal(target: string, pal: Rgb[]): Rgb {
  const hit = snapCache.get(target);
  if (hit) return hit;
  const t = hexRgb(target);
  let best = pal[0], bd = Infinity;
  for (const p of pal) {
    const d = (t[0] - p[0]) ** 2 * 3 + (t[1] - p[1]) ** 2 * 4 + (t[2] - p[2]) ** 2 * 2;
    if (d < bd) { bd = d; best = p; }
  }
  snapCache.set(target, best);
  return best;
}
function makeQuantizer(pal: Rgb[]): (r: number, g: number, b: number) => Rgb {
  const cache = new Map<number, Rgb>();
  return (r, g, b) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let v = cache.get(key);
    if (!v) {
      let bd = Infinity; v = pal[0];
      for (const p of pal) {
        const d = (r - p[0]) ** 2 * 3 + (g - p[1]) ** 2 * 4 + (b - p[2]) ** 2 * 2;
        if (d < bd) { bd = d; v = p; }
      }
      cache.set(key, v);
    }
    return v;
  };
}

type GroundTileKind = 'grass' | 'forest' | 'dirt' | 'stone' | 'water' | 'sand' | 'grassL';
const groundTileCache = new Map<GroundTileKind, HTMLCanvasElement>();
function makeGroundTile(kind: GroundTileKind): HTMLCanvasElement {
  const S = 256;
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  const d = img.data;
  const pal = palRgbs();
  const snap = (h: string): Rgb => snapPal(h, pal);
  const shades: Record<GroundTileKind, Array<[string, number]>> = {
    grass: [['#66854c', 0.52], ['#56743f', 0.26], ['#7d9b5e', 0.14], ['#476335', 0.08]],
    grassL: [['#7d9b5e', 0.52], ['#66854c', 0.26], ['#93ad72', 0.14], ['#56743f', 0.08]],
    sand: [['#c9b078', 0.55], ['#b89e6e', 0.3], ['#dcc48c', 0.15]],
    forest: [['#584731', 0.5], ['#463723', 0.28], ['#6a5638', 0.14], ['#38291a', 0.08]],
    dirt: [['#a08b62', 0.55], ['#8a744e', 0.3], ['#b89e6e', 0.15]],
    stone: [['#9b958b', 0.6], ['#8f887c', 0.25], ['#b3ada2', 0.15]],
    water: [['#2a4f6a', 0.62], ['#3c6b8a', 0.24], ['#22425a', 0.14]],
  };
  const table: Rgb[] = [];
  for (const [hex, wgt] of shades[kind]) {
    for (let i = 0; i < Math.round(wgt * 100); i++) table.push(snap(hex));
  }
  const rnd = mulberry(9182 + kind.length * 131 + kind.charCodeAt(0));
  const set = (x: number, y: number, rgb: Rgb): void => {
    const xx = ((x % S) + S) % S, yy = ((y % S) + S) % S;
    const i = (yy * S + xx) * 4;
    d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = 255;
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    set(x, y, table[Math.floor(rnd() * table.length)]);
  }
  const dark = snap(kind === 'water' ? '#22425a' : '#476335');
  const light = snap(kind === 'grass' || kind === 'grassL' ? '#7d9b5e' : kind === 'forest' ? '#cbb080' : '#c8c2b6');
  if (kind === 'forest') {
    // 林地地板（禁林重设计，2026-10-22）：深色落叶土 + 落叶碎点 + 稀疏
    // 林下光斑 + 断枝。不再有草叶簇——树冠地毯退役后，林内地面是落叶层，
    // 光斑是透过稀疏站立树的光（大光斑在 texForest 细节层另画）。
    const leaf = snap('#a8842c');
    const leaf2 = snap('#7d6435');
    for (let i = 0; i < 120; i++) {
      const x = Math.floor(rnd() * S), y = Math.floor(rnd() * S);
      set(x, y, rnd() < 0.5 ? leaf : leaf2);
      if (rnd() < 0.5) set(x + 1, y, rnd() < 0.5 ? leaf : leaf2);
    }
    // 林下光斑：2-3px 亮簇，稀疏（每 tile 约 14 簇）
    for (let i = 0; i < 14; i++) {
      const x = Math.floor(rnd() * S), y = Math.floor(rnd() * S);
      set(x, y, light); set(x + 1, y, light);
      if (rnd() < 0.6) { set(x, y + 1, light); }
      if (rnd() < 0.3) { set(x + 2, y, light); }
    }
    const twig = snap('#54381f');
    for (let i = 0; i < 9; i++) {
      const x = Math.floor(rnd() * S), y = Math.floor(rnd() * S);
      for (let k = 0; k < 3; k++) set(x + k, y, twig);
    }
  } else if (kind === 'grass' || kind === 'grassL') {
    // 草叶像素簇：竖簇底深尖浅，绕边回绕保证可平铺
    const n = kind === 'grass' ? 110 : 70;
    for (let i = 0; i < n; i++) {
      const x = Math.floor(rnd() * S), y = Math.floor(rnd() * S);
      set(x, y, dark); set(x, y - 1, table[0]);
      if (rnd() < 0.6) set(x + (rnd() < 0.5 ? 1 : -1), y - 1, light);
    }
  } else if (kind === 'dirt' || kind === 'sand') {
    for (let i = 0; i < 150; i++) set(Math.floor(rnd() * S), Math.floor(rnd() * S), rnd() < 0.5 ? light : dark);
  } else if (kind === 'stone') {
    // 石板：32 格错缝勾缝 + 板内斑点（底噪保留）
    const grout = snap('#676b73');
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const row = Math.floor(y / 32);
      const sx = x + (row % 2) * 16;
      if (sx % 32 === 0 || y % 32 === 0) set(x, y, grout);
      else if (rnd() < 0.1) set(x, y, dark);
    }
  } else {
    // water：横向波纹短划
    const wave = snap('#7fb0cc');
    for (let i = 0; i < 80; i++) {
      const x = Math.floor(rnd() * S), y = Math.floor(rnd() * S), len = 3 + Math.floor(rnd() * 3);
      for (let k = 0; k < len; k++) set(x + k, y, wave);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}
function groundTilePattern(g: CanvasRenderingContext2D, kind: GroundTileKind): CanvasPattern | null {
  let tile = groundTileCache.get(kind);
  if (!tile) { tile = makeGroundTile(kind); groundTileCache.set(kind, tile); }
  const p = g.createPattern(tile, 'repeat');
  if (p) p.setTransform(new DOMMatrix().scale(TPX, TPX)); // 1 格 = TPX 纹理px = 1 世界单位
  return p;
}
const ZONE_TILE: Record<ZoneTex, GroundTileKind> = {
  castle: 'stone', alley: 'stone', lake: 'water', forest: 'forest',
  grass: 'grass', village: 'grass', pitch: 'grass', hagrid: 'grass', willow: 'grass',
};

/** 整图马赛克（2 纹理px 一格）+ 调色板量化：地面烘焙的收尾工序。 */
function pixelateGround(c: HTMLCanvasElement): void {
  const W = c.width >> 1, H = c.height >> 1;
  const small = document.createElement('canvas'); small.width = W; small.height = H;
  const sg = small.getContext('2d')!;
  sg.imageSmoothingEnabled = false;
  sg.drawImage(c, 0, 0, W, H);
  const img = sg.getImageData(0, 0, W, H);
  const d = img.data;
  const q = makeQuantizer(palRgbs());
  for (let i = 0; i < d.length; i += 4) {
    const v = q(d[i], d[i + 1], d[i + 2]);
    d[i] = v[0]; d[i + 1] = v[1]; d[i + 2] = v[2]; d[i + 3] = 255;
  }
  sg.putImageData(img, 0, 0);
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(small, 0, 0, c.width, c.height);
}
/** 捕获专用马赛克 + 量化：与 pixelateGround 同口径（2 纹理px 一格 + 调色板
 *  量化），但保留透明通道。pixelateGround 面向整幅不透明地面纹理，会把每个
 *  像素的 alpha 强制为 255；用在站立实体捕获画布上会把透明区变成不透明
 *  深棕色块（实测角点像素 (0,0,0,0) -> (42,31,26,255)），整幅捕获退化
 *  为盖住一切的矩形。透明像素在此直接清零，不透明像素保留原 alpha。 */
function pixelateCapture(c: HTMLCanvasElement): void {
  const W = c.width >> 1, H = c.height >> 1;
  const small = document.createElement('canvas'); small.width = W; small.height = H;
  const sg = small.getContext('2d')!;
  sg.imageSmoothingEnabled = false;
  sg.drawImage(c, 0, 0, W, H);
  const img = sg.getImageData(0, 0, W, H);
  const d = img.data;
  const q = makeQuantizer(palRgbs());
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 24) { d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 0; continue; }
    const v = q(d[i], d[i + 1], d[i + 2]);
    d[i] = v[0]; d[i + 1] = v[1]; d[i + 2] = v[2];
  }
  sg.putImageData(img, 0, 0);
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, c.width, c.height);
  g.drawImage(small, 0, 0, c.width, c.height);
}
/** 仅量化不马赛克（水面波光帧等薄细节）。 */
function quantizeCanvas(c: HTMLCanvasElement): void {
  const g = c.getContext('2d')!;
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const q = makeQuantizer(palRgbs());
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 24) continue;
    const v = q(d[i], d[i + 1], d[i + 2]);
    d[i] = v[0]; d[i + 1] = v[1]; d[i + 2] = v[2];
  }
  g.putImageData(img, 0, 0);
}

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
// ------------------------------------------------------------------ 接触阴影（落地感）
// 活体虚浮的主因之一：精灵自带的烘焙阴影在像素化后只剩一团淡色污渍，
// 且位置偏侧，脚下没有明确的接地暗斑。统一改由渲染器在实体绘制前、
// 其排序槽位内画一张预烘焙的径向渐变椭圆（全活体共用同一张贴图，
// 逐帧只 drawImage 缩放，禁止每帧新建渐变）。椭圆宽 = 登记宽 × 0.8，
// 高按地面深度压缩 × 0.646（size-design.md 投影口径），中心 alpha ≈ 0.34。
let shadowTex: HTMLCanvasElement | null = null;
function getShadowTex(): HTMLCanvasElement {
  if (!shadowTex) {
    const S = 128;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, 'rgba(22,18,9,0.34)');
    grad.addColorStop(0.55, 'rgba(22,18,9,0.20)');
    grad.addColorStop(1, 'rgba(22,18,9,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    shadowTex = c;
  }
  return shadowTex;
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

// ------------------------------------------------------------------ 人物分类（原 chars.ts 逻辑辅助，2026-10-21 随手绘人物退役迁入）
// 素材统一收口后，人物只走工厂 hw 精灵；此处只保留「名字 -> 变体 / 朝向 ->
// 精灵方向」的纯逻辑，不再有任何代码绘制的人物精灵。
export type CharDir = 'down' | 'up' | 'left' | 'right';
export type CharVariant = 'student' | 'professor' | 'merchant' | 'hagrid' | 'elf';

/** Facing angle (radians, screen space: 0=right, PI/2=down) -> sprite dir. */
export function dirFromAngle(f: number): CharDir {
  const a = ((f % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  if (a < Math.PI / 4 || a >= Math.PI * 7 / 4) return 'right';
  if (a < Math.PI * 3 / 4) return 'down';
  if (a < Math.PI * 5 / 4) return 'left';
  return 'up';
}

const ELF_NAMES = ['dobby', 'kreacher', 'winky', 'hokie'];
const PROFESSOR_NAMES = ['snape', 'mcgonagall', 'dumbledore', 'flitwick', 'sprout', 'binns', 'trelawney'];
const MERCHANT_NAMES = ['rosmerta', 'flume', 'ollivander', 'fortescue', 'borgin', 'zabini'];

/** Name -> variant. Students (players + student NPCs) get house robes. */
export function variantForName(name: string): CharVariant {
  const n = name.toLowerCase();
  if (n.includes('hagrid')) return 'hagrid';
  if (ELF_NAMES.some((e) => n.includes(e))) return 'elf';
  if (PROFESSOR_NAMES.some((e) => n.includes(e))) return 'professor';
  if (MERCHANT_NAMES.some((e) => n.includes(e))) return 'merchant';
  return 'student';
}

// 工厂精灵缺失 = 素材缺口，必须暴露：该实体不绘制 + 每类只警告一次。
// （旧口径是回退 sprites.ts/chars.ts 代码手绘，把缺口糊住——已废除。）
const warnedMissing = new Set<string>();
export function warnMissingSprite(what: string): void {
  if (!preSpritesReady()) return; // 还在加载：null 不是缺失，不打假警报
  if (warnedMissing.has(what)) return;
  warnedMissing.add(what);
  console.warn(`[2d] factory sprite missing, not drawn: ${what}`);
}

// ------------------------------------------------------------------ per-frame hot-path caches
// These avoid per-entity allocations and string work inside draw():
// - HOSTILE_KINDS: Set lookup instead of a per-creature array literal
// - elemCss: precomputed '#rrggbb' per Element (css() does toString(16) per call)
const HOSTILE_KINDS = new Set(['dementor', 'spider', 'troll', 'basilisk', 'dragon', 'aragog', 'nundu', 'chimera', 'manticore', 'lethifold', 'werewolf']);
/** 统一尺寸系统：全图只有一条绘制规则——精灵按登记的世界宽度 W（世界
 * 单位）绘制，k = W × zoom / 精灵px宽，高度由精灵自身像素比带出（精灵
 * 在工厂俯角 40° 下渲染，投影自洽：宽 14px/米、竖直 ×cos40°、深度
 * ×sin40°）。
 * 登记值不再手抄在本文件：唯一手写源 = tools/sprite-factory/manifest.json
 * （每素材一条：模型来源 + 设计真实尺寸 + 派生规则），derive.py 用工厂
 * 标定常数（G/V/D、U_LIVE、U_STRUCT）与 3D 几何派生出 derived.json，
 * 本文件与 layout2d/lineup 全部经 src/shared/asset-data.ts 读派生值。
 * 派生公式（derive.py 单点实现）：高锚 = (H·cos40° + D·sin40°) × 尺度
 * × 精灵宽高比；宽锚 = W × 尺度；struct = 描绘宽 × U_STRUCT；pin = 钉版。
 * 此前三套口径（建筑占地×1.8、生物 hM×20、登记 visualW 逐个拍）与本文件
 * 内的 FIGURE_W/FIGURE_DH/CREATURE_HW 手抄表已废除（2026-10-22）。 */
export const U_LIVE = ASSET.constants.U_LIVE;
export const U_STRUCT = ASSET.constants.U_STRUCT;
/** 巫师绘制高（世界单位）：Front 淡化判定与 lineup 共用同一锚点。 */
export const WIZARD_DH = ASSET.figures['hw-wizard-gryffindor']!.dh;
/** 人物精灵基名 -> 登记世界宽度（派生：投影高 × U_LIVE × 精灵宽高比）。 */
export const FIGURE_W: Record<string, number> = Object.fromEntries(
  Object.entries(ASSET.figures).map(([base, f]) => [base, f.w]),
);
/** 人物绘制高登记（世界单位，按变体；与 FIGURE_W 同源派生）。 */
export const FIGURE_DH: Record<string, number> = Object.fromEntries(
  Object.values(ASSET.figures).filter((f) => f.variant).map((f) => [f.variant!, f.dh]),
);
// 3转2 生物映射：物种 kind -> hw 精灵名 + 登记世界宽度 wM（派生，见上）。
export const CREATURE_HW: Record<string, { name: string; wM: number }> = Object.fromEntries(
  Object.entries(ASSET.creatures).map(([kind, c]) => [kind, { name: c.sprite, wM: c.wM }]),
);
/** 精灵规范绘制宽（derived.json drawW）：站立注册缺省用它，实例级缩放
 *  （塔楼半径、林木密度尺度等放置数据）才在注册点另给数值。 */
export const drawWOf = (name: string): number => {
  const w = ASSET.sprites[name]?.drawW;
  if (w == null) { warnMissingSprite(name); return 10; }
  return w;
};
const HW_HOUSES = ['gryffindor', 'slytherin', 'ravenclaw', 'hufflepuff'];
/** 巫师实体 -> hw 人物精灵基名。全部变体已有 hw 模型；返回 null = 变体未映射（素材缺口，调用方警告并跳过绘制）。 */
function hwFigureBase(name: string, house: string, variant: CharVariant): string | null {
  const n = name.toLowerCase();
  if (n.includes('norris')) return 'hw-cat'; // 洛丽丝夫人是猫，不是巫师
  if (n.includes('dementor')) return 'hw-dementor';
  if (variant === 'hagrid') return 'hw-hagrid';
  if (variant === 'professor') return 'hw-professor';
  if (variant === 'merchant') return 'hw-merchant';
  if (variant === 'elf') return 'hw-elf';
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
  // 波光只落在圆盘水面内（与地形分类同口径）：擦除盘外弧线，避免浮在岸上
  g.globalCompositeOperation = 'destination-out';
  const mask = new Path2D();
  mask.rect(0, 0, w, h);
  mask.arc(w / 2, h / 2, 29.5 * TPX, 0, Math.PI * 2);
  g.fill(mask, 'evenodd');
  g.globalCompositeOperation = 'source-over';
  quantizeCanvas(c); // 波光颜色并入主调色板
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
  // 林间空地：落叶土亮斑（与林地地板 tile 同色系，不再是草地绿）
  const nc = (w * h) / 26000;
  for (let i = 0; i < nc; i++) {
    const x = x0 + rnd() * w, y = y0 + rnd() * h, r = 14 + rnd() * 26;
    blob(g, x, y, r, hexA('#6a5638', 0.35));
  }
  // 地面明暗基底（稀疏站立树的地面层次，不再是整面树冠投影）
  const n1 = (w * h) / 4200;
  for (let i = 0; i < n1; i++) {
    blob(g, x0 + rnd() * w, y0 + rnd() * h, 10 + rnd() * 16, hexA(P.dark, 0.16));
  }
  // dappled sunlight spots — 林下光斑：透过树冠的光，1x 下可见
  const nd = (w * h) / 4500;
  for (let i = 0; i < nd; i++) {
    blob(g, x0 + rnd() * w, y0 + rnd() * h, 4 + rnd() * 8, hexA('#d9c493', 0.4));
  }
  // leaf litter: 落叶碎点
  const nl = (w * h) / 1100;
  for (let i = 0; i < nl; i++) {
    blob(g, x0 + rnd() * w, y0 + rnd() * h, 1.6 + rnd() * 2.2,
      rnd() < 0.5 ? hexA('#6b5a3a', 0.4) : hexA(P.dark, 0.5));
  }
  // 禁林树木已改为站立精灵（registerForestStanding，2026-10-22 重设计）：
  // 设计密度选点（服务器树干位子集）+ 林缘疏林带，逐帧 y-sort + Front
  // 淡化。此处不再往地面盖印树冠——旧口径 170 棵盖印成整片深青地毯、
  // 生物走在树冠上，是虚浮感来源之一，已废除。
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
  // 建筑本体不在纹理里：全部为工厂精灵站立实体（registerHwLandmarks /
  // registerCastleSprites）。本画笔只有石面色斑/石板缝/苔藓，且城堡区
  // 整面已由 tile 网格接管（SKIP_TEX），此画笔现仅作纹理生成器存档。
};

// --- village: tonal patches only. 地面走 tile 网格（paintTileGrid），
// --- 建筑/树/灯由 registerVillageStanding() 注册为站立实体排序绘制。 ---
const texVillage: Painter = (g, x0, y0, w, h, rnd) => {
  const P = PAL.village;
  // tonal patches
  const np = (w * h) / 14000;
  for (let i = 0; i < np; i++) {
    blob(g, x0 + rnd() * w, y0 + rnd() * h, 14 + rnd() * 30,
      rnd() < 0.5 ? hexA(P.dark, 0.22) : hexA(P.light, 0.22));
  }
};

/** 3转2 精灵绘制：(ox, oy) = 地面原点（占地中心）在纹理空间的落点，
 *  k = 纹理px / 精灵px。精灵已过工厂像素化管线，绘制时关闭平滑缩放保硬像素。
 *  返回 false = 精灵未就绪，调用方按素材缺失口径处理（不绘制 + 警告）。 */
function drawPre(g: CanvasRenderingContext2D, pm: PreSprite | null, ox: number, oy: number, k: number): boolean {
  if (!pm) return false;
  g.imageSmoothingEnabled = false;
  g.drawImage(pm.img, ox - pm.anchorX * k, oy - pm.anchorY * k, pm.w * k, pm.h * k);
  return true;
}

/** hw 精灵（地面纹理空间）：以世界坐标 (wx, wz) 为占地中心原点、visualW 为
 *  视觉宽度（世界单位）绘制。返回 false = 精靈未就绪（不存在该行） */
function drawHwTex(g: CanvasRenderingContext2D, name: string, wx: number, wz: number, visualW: number): boolean {
  const pm = preSprite(name);
  if (!pm) return false;
  return drawPre(g, pm, w2tx(wx), w2ty(wz), (visualW * TPX) / pm.w);
}

// ------------------------------------------------------------------ 统一深度排序：站立实体注册表
// 遮挡修复（2026-10-21）：此前所有建筑/树/道具都烘焙进地面纹理，实体（生物/
// 巫师）永远画在最上层——站在塔北面的人也压在屋顶上。现在地面纹理只保留
// 平铺内容；高出地面的对象在烘焙期注册为站立实体，逐帧与生物/巫师按
// 「占地南缘 z」统一排序绘制（北先南后）。
// 两类条目：cap = 代码绘制捕获的离屏 canvas（纹理坐标）；pre = hw 预渲染
// 精灵（逐帧按屏幕坐标绘制）。bx0..bz1 为世界包围盒（裁剪用，宁大勿裁）。
// frontZ = 占地北缘世界 z：精灵在 frontZ 以北的部分属于星露谷 Front 层
// （屋顶探出/树冠），在实体层之后统一盖绘，且盖住玩家时渐变半透明；
// frontZ 以南的部分留在排序层内正常参与深度排序。
type Standing =
  | { kind: 'cap'; key: number; canvas: HTMLCanvasElement; tx0: number; ty0: number; bx0: number; bz0: number; bx1: number; bz1: number; frontZ: number }
  | { kind: 'pre'; key: number; pm: PreSprite; wx: number; wz: number; visualW: number; bx0: number; bz0: number; bx1: number; bz1: number; frontZ: number };
const standing: Standing[] = [];

/** 把一段「以纹理坐标绘制」的代码捕获为独立站立实体。
 *  key = 占地南缘世界 z；包围盒为世界坐标（须覆盖绘制范围）。 */
function captureStanding(key: number, wx0: number, wz0: number, wx1: number, wz1: number,
  draw: (g: CanvasRenderingContext2D) => void, frontZ?: number): void {
  const bx0 = Math.floor(w2tx(wx0)), by0 = Math.floor(w2ty(wz0));
  const bx1 = Math.ceil(w2tx(wx1)), by1 = Math.ceil(w2ty(wz1));
  const c = document.createElement('canvas');
  c.width = Math.max(1, bx1 - bx0); c.height = Math.max(1, by1 - by0);
  const g = c.getContext('2d')!;
  g.translate(-bx0, -by0);
  draw(g);
  pixelateCapture(c); // 与地面同口径像素化，但保留透明通道（见 pixelateCapture）
  standing.push({
    kind: 'cap', key, canvas: c, tx0: bx0, ty0: by0, bx0: wx0, bz0: wz0, bx1: wx1, bz1: wz1,
    frontZ: frontZ ?? key - 8, // 缺省：占地南缘以北 8 单位起为 Front 层
  });
}

/** hw 预渲染精灵注册为站立实体（key = 站姿占地南缘）。
 *  占地一律用派生 stance（地面带截面，见 asset-data）：包围盒 footD 含
 *  尾/颈/翼等高位部件，曾使排序键/Front 切分线系统性偏南（龙偏 12.7px
 *  的同源问题）。stance 缺失（不应发生）时回退包围盒中心口径。
 *  精灵缺失时不注册——捕获的代码绘制在下面兜底。返回是否注册成功。 */
function registerPre(name: string, wx: number, wz: number, visualW: number): boolean {
  const pm = preSprite(name);
  if (!pm) return false;
  const wPerM = visualW / pm.footW;               // 世界单位 / 模型米
  const sS = pm.stanceS != null ? pm.stanceS * wPerM : (pm.footD * wPerM) / 2;
  const sN = pm.stanceN != null ? pm.stanceN * wPerM : -(pm.footD * wPerM) / 2;
  const northW = (pm.anchorY / pm.ppm) * wPerM;   // 锚点以北图幅（世界单位）
  standing.push({
    kind: 'pre', key: wz + sS, pm, wx, wz, visualW,
    bx0: wx - visualW / 2 - 2, bx1: wx + visualW / 2 + 2,
    bz0: wz - northW - 2, bz1: wz + sS + 2,
    frontZ: wz + sN, // 站姿北缘：以北为探出（屋顶/树冠），走 Front 层
  });
  return true;
}

// --- Hogsmeade（统一系统）：地面走 tile 网格地形（paintTileGrid，村庄广场
// 土盘与 R5 路面在 buildClassGrid 里分类）；房屋/树/栅栏/路灯全部走工厂
// 精灵站立注册。Kenney 2D 像素试点层已于 2026-10-21 下线，assets.ts 不再
// 加载任何图集，村内不再有第二套素材与第二套尺寸口径。 ---
// 聚落范围（站立注册/跳过判定用）：ZONES 的 village 是地面纹理区（x −30..70），
// 比聚落实际范围小——4 间命名商店（x −52..−28）与西侧住宅都在纹理区外，
// 旧口径下它们漏出村庄工厂注册、被别处代码绘制接管。聚落范围按
// layout2d 村庄布局实测取 x −56..74、z 138..250。
const VILLAGE_EXT = { x0: -56, z0: 138, x1: 74, z1: 250 };
const inVillageExt = (x: number, z: number): boolean =>
  x >= VILLAGE_EXT.x0 && x <= VILLAGE_EXT.x1 && z >= VILLAGE_EXT.z0 && z <= VILLAGE_EXT.z1;

/** 村庄站立实体注册：定点树/栅栏/街灯 + 布局住宅/路灯 + 命名商店，
 *  全部工厂精灵、全部走 registerPre 的统一深度口径。精灵缺失 = 不注册
 *  并警告（素材缺口暴露，不回退手绘）。 */
function registerVillageStanding(): void {
  const items = itemsInRect(getLayout(), VILLAGE_EXT.x0, VILLAGE_EXT.z0, VILLAGE_EXT.x1, VILLAGE_EXT.z1);
  const reg = (name: string, x: number, z: number, w: number): void => {
    if (!registerPre(name, x, z, w)) warnMissingSprite(name);
  };

  // ---- 定点树（装饰位，避开建筑/道路）：原 Kenney 图集树（小松/秋树丛/
  // 细树/绿树丛）无工厂对应件，统一改用工厂松/圆冠：小松 = 幼松（宽 6）、
  // 树丛 = 3 棵簇植。登记宽与尺寸表第 6 节同口径（松/橡按高登记 13.8）。
  const trees: Array<[number, number, string, number]> = [
    [-24, 146, 'treePine', -1], [14, 145, 'treeRound', -1], [27, 146, 'treePine', 6],
    // (44,157)/(45,197) 两棵原位在住宅恢复后正压屋身（住宅精灵占地以
    // item 北移 3.7s 为中心）：分别挪到 (62,146) 村口东 grove 与
    // (74,220) 尖叫棚屋东南，树干出屋身、仅树冠轻搭屋顶边
    [62, 146, 'treePine', -1], [74, 220, 'treeRound', -1],
    [59, 189, 'treePine', -1], [-25, 197, 'treePine', -1], [-21, 206, 'treePine', -1],
    [21, 205, 'treeRound', -1], [37, 207, 'treePine', 6], [-13, 207, 'treePine', -1],
  ];
  // w = -1 表示标准尺寸：读派生 drawW（treePine/treeRound 的 live-height 派生）
  for (const [tx, tz, name, w] of trees) reg(name, tx, tz, w < 0 ? drawWOf(name) : w);
  // 树丛两处：秋色丛 (53,175) 与绿树丛 (64,168)，各 3 棵簇植
  for (const [cx, cz] of [[53, 175], [64, 168]] as Array<[number, number]>) {
    reg('treeRound', cx - 4, cz - 2, 11);
    reg('treePine', cx + 4, cz + 1, 12);
    reg('treeRound', cx, cz + 4, 10);
  }
  // ---- 村口北缘栅栏两段（门/路留缺口 x -6..8）：工厂栅栏一段全宽 3 世界
  // 单位（与原素材柱距相近），逐段平铺注册。
  for (const [fx0, fx1] of [[-27, -8], [10, 28]] as Array<[number, number]>) {
    for (let cx = fx0 + 1.5; cx < fx1; cx += 3) reg('fence', cx, 143, 3);
  }
  // ---- R5 街灯（共享布局在村内放不下路灯：占地与商店碰撞盒冲突；
  // 沿用原视觉补点：每约 17 单位一盏、左右交替）。登记宽读派生表
  // （layoutKinds.lamp.drawW：工厂灯按绘制高 32 世界单位钉版）。
  for (const [lx, lz] of [[-11, 153], [11, 170], [-11, 187], [11, 203]] as Array<[number, number]>) {
    reg('lamp', lx, lz, ASSET.layoutKinds.lamp!.drawW);
  }

  // ---- 布局住宅与路灯 ----
  // 住宅尺寸：登记宽读派生表（layoutKinds.cottage/stonehouse.drawW =
  // 模型描绘宽 × U_STRUCT）。锚点 = 站姿中心：布局 z 为原绘制基线
  // （南缘），向北移站姿南缘深（stanceS × W/footW）与 registerPre 对齐。
  for (const it of items) {
    if (it.kind === 'cottage' || it.kind === 'stonehouse') {
      const lk = ASSET.layoutKinds[it.kind]!;
      const W = lk.drawW * it.s;
      const pm = preSprite(lk.sprite);
      const shift = pm ? (pm.stanceS ?? pm.footD / 2) * (W / pm.footW) : 0;
      reg(lk.sprite, it.x, it.z - shift, W);
    } else if (it.kind === 'lamp') {
      reg('lamp', it.x, it.z, ASSET.layoutKinds.lamp!.drawW * it.s);
    }
  }

  // ---- 命名商店：工厂房屋钉占地（登记宽 = 占地宽，尺寸表第 7 节），
  // 按标签选变体：三把扫帚 = 高顶酒馆、猪头酒吧/佐科 = 石屋、其余 = 木屋。
  // 店名标签单独捕获一层（只有文字），排序键与原口径一致（占地南缘）。
  const shopPreName = (label: string): string =>
    label.includes('Broomsticks') ? 'houseTavern'
    : label.includes("Hog's Head") || label.includes('Zonko') ? 'houseStone' : 'houseWood';
  for (const o of OBSTACLES) {
    if (o.kind !== 'box' || o.style !== 'house' || !o.label) continue;
    const cx = (o.x0 + o.x1) / 2, cz = (o.z0 + o.z1) / 2;
    if (!inVillageExt(cx, cz)) continue;
    const fw = o.x1 - o.x0;
    reg(shopPreName(o.label), cx, cz, fw);
    captureStanding(o.z1, cx - fw / 2 - 2, o.z1, cx + fw / 2 + 2, o.z1 + 16, (cg) => {
      cg.fillStyle = '#fff'; cg.font = '11px sans-serif'; cg.textAlign = 'center';
      cg.fillText(o.label!, w2tx(cx), w2ty(o.z1) + 13);
    }, o.z0); // Front 切分线 = 占地北缘
  }
}

// --- server named buildings (outside Hogsmeade): from OBSTACLES, labeled.
// 注册为站立实体（key = 占地南缘 o.z1），逐帧参与深度排序。
function registerServerBuildings(): void {
  for (const o of OBSTACLES) {
    if (o.kind !== 'box' || o.style !== 'house' || !o.label) continue;
    // Hogsmeade shops are registered by registerVillageStanding
    if (inVillageExt((o.x0 + o.x1) / 2, (o.z0 + o.z1) / 2)) continue;
    const cx = (o.x0 + o.x1) / 2, cz = (o.z0 + o.z1) / 2;
    const fw = (o.x1 - o.x0);
    // 建筑本体 = 工厂 houseStone 精灵（登记宽 = 占地宽，与村内命名商店同口径）；
    // 店名标签单独捕获一层（只有文字），排序键与村内商店一致（占地南缘）。
    if (!registerPre('houseStone', cx, cz, fw)) warnMissingSprite('houseStone');
    captureStanding(o.z1, cx - fw / 2 - 2, o.z1, cx + fw / 2 + 2, o.z1 + 16, (cg) => {
      cg.fillStyle = '#fff'; cg.font = '11px sans-serif'; cg.textAlign = 'center';
      cg.fillText(o.label!, w2tx(cx), w2ty(o.z1) + 13);
    }, o.z0); // Front 切分线 = 占地北缘
  }
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
  // 球门环不在纹理里画：hw-quidditch-hoops 精灵已在 registerHwLandmarks
  // 按服务器位置 (40,-178)/(40,-122) 注册为站立实体（原纹理矢量环与之双画）。
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
  // 跨街吊灯原以矢量线+光晕画在纹理里（物件描绘），已随矢量层退役删除；
  // 街面只剩鹅卵石与街带（纹理生成器范围）。巷内照明语义由两侧店铺
  // 精灵的窗光承担。
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
  // pumpkin rows: 3 rows x 5（工厂 hw-pumpkin 精灵盖印，位置/抖动沿用原排布；
  // 世界坐标换算：土 patch 为世界 x 95..135、z 140..160）
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 5; c++) {
      const wx = 95 + 4 + c * 8 + (rnd() - 0.5) * 2;
      const wz = 140 + 4.7 + r * 6 + (rnd() - 0.5) * 2;
      if (!drawHwTex(g, 'hw-pumpkin', wx, wz, 4.5 + rnd() * 2)) warnMissingSprite('hw-pumpkin');
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
  // 树冠地面投影是地面效果，随地面纹理绘制（半径 40 世界单位的软阴影）。
  blob(g, w2tx(45) + 8 * TPX, w2ty(0), 40 * TPX, 'rgba(0,0,0,0.25)');
  // 树身与告示牌不在地面纹理里画：树身 = 工厂 hw-whomping-willow 精灵
  // （registerHwLandmarks），告示牌 = hw-signpost（registerStandingAll）。
};

/** 禁林站立树木注册（2026-10-22 重设计，废除地面树冠盖印）：
 * 设计密度：林内 17 棵 + 林缘疏林带补足至 25 棵整树上限（默认 2.75x 下
 * 整片禁林同框，任意 1280px 视口可见整树 ≤ 25 的上限即总数上限）。
 * 选点全部取自服务器树干位（SERVER_TREES 子集：可见的树必有碰撞），
 * 确定性哈希序贪心、间距 ≥30（不足时 26/23 两档放宽）。主径走廊
 * （服务器留白 |z−15|<5、x<200）两侧放宽至 7.5 留空，海格园与布局
 * 道路同避。树种按位置哈希：松/圆冠为主、橡 ≤3、枯树 ≤2。
 * 林下灌木（hw-bush，不计整树）内 12 丛 + 林缘 8 丛补层次。
 * 全部走 registerPre：y-sort + Front 淡化与全图同口径，树干可见、
 * 地面（落叶土 tile）透出。 */
function registerForestStanding(): void {
  const reg = (name: string, x: number, z: number, w: number): void => {
    if (!registerPre(name, x, z, w)) warnMissingSprite(name);
  };
  const C = { x: 165, z: 15 };
  const roads = getLayout().roads;
  const roadDist = (x: number, z: number): number => {
    let best = Infinity;
    for (const r of roads) {
      const p = r.pts;
      for (let i = 0; i < p.length - 1; i++) {
        const ax = p[i].x, az = p[i].z, dx = p[i + 1].x - ax, dz = p[i + 1].z - az;
        const len2 = dx * dx + dz * dz;
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
        const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
        if (d < best) best = d;
      }
    }
    return best;
  };
  const hash = (x: number, z: number, s: number): number =>
    Math.abs(Math.sin(x * 12.9898 + z * 78.233 + s * 37.719) * 43758.5453) % 1;
  const clearOfTrail = (x: number, z: number): boolean => !(Math.abs(z - C.z) < 7.5 && x < 208);
  // ---- 林内选点：候选 = 服务器树干位（林盘内、避主径/海格园/道路）
  const cand = SERVER_TREES.filter((t) =>
    Math.hypot(t.x - C.x, t.z - C.z) <= 80 && clearOfTrail(t.x, t.z) &&
    Math.hypot(t.x - 95, t.z - 30) >= 14 && roadDist(t.x, t.z) >= 8);
  const order = [...cand].sort((a, b) => hash(a.x, a.z, 1) - hash(b.x, b.z, 1));
  const picked: Array<{ x: number; z: number }> = [];
  for (const minD of [30, 26, 23]) {
    for (const t of order) {
      if (picked.length >= 17) break;
      if (picked.includes(t)) continue;
      if (picked.some((p) => Math.hypot(p.x - t.x, p.z - t.z) < minD)) continue;
      picked.push(t);
    }
    if (picked.length >= 17) break;
  }
  let oaks = 0, deads = 0;
  for (const t of picked) {
    const hk = hash(t.x, t.z, 2);
    let name = 'treePine', w = 7.5;
    if (hk >= 0.5 && hk < 0.8) { name = 'treeRound'; w = 7.5; }
    else if (hk >= 0.8 && hk < 0.92 && oaks < 3) { name = 'hw-oak'; w = 24; oaks++; }
    else if (hk >= 0.92 && deads < 2) { name = 'hw-dead-tree'; w = 10; deads++; }
    reg(name, t.x, t.z, w);
  }
  // ---- 林缘疏林带：林盘外小树（约 0.6 尺度）补足至 25 棵，与草地衔接
  let total = picked.length;
  for (let i = 0; i < 14 && total < 25; i++) {
    const a = (i / 14) * Math.PI * 2 + hash(i, 7, 3) * 0.35;
    const r = 90 + hash(i, 11, 4) * 12;
    const x = C.x + Math.cos(a) * r, z = C.z + Math.sin(a) * r;
    if (roadDist(x, z) < 9) continue;
    if (x > 74 && x < 156 && z > 96 && z < 171) continue; // 海格区
    reg(hash(i, 13, 5) < 0.5 ? 'treePine' : 'treeRound', x, z, 4.6);
    total++;
  }
  // ---- 林下灌木（不计整树）：林内 12 丛 + 林缘 8 丛
  const features: Array<[number, number]> = [[174, -28], [206, -28], [190, -4], [190, -20]];
  let bushIn = 0;
  for (let i = 0; i < 60 && bushIn < 12; i++) {
    const a = hash(i, 21, 6) * Math.PI * 2, r = 18 + hash(i, 23, 7) * 58;
    const x = C.x + Math.cos(a) * r, z = C.z + Math.sin(a) * r;
    if (!clearOfTrail(x, z) || roadDist(x, z) < 7) continue;
    if (picked.some((p) => Math.hypot(p.x - x, p.z - z) < 9)) continue;
    if (features.some(([fx, fz]) => Math.hypot(fx - x, fz - z) < 8)) continue;
    const dc = Math.hypot(x - 130, z + 30);
    if (dc > 11 && dc < 21) continue; // 独角兽空地的发光花环带
    reg('hw-bush', x, z, 10);
    bushIn++;
  }
  let bushRing = 0;
  for (let i = 0; i < 30 && bushRing < 8; i++) {
    const a = hash(i, 31, 8) * Math.PI * 2, r = 86 + hash(i, 33, 9) * 18;
    const x = C.x + Math.cos(a) * r, z = C.z + Math.sin(a) * r;
    if (roadDist(x, z) < 7) continue;
    if (x > 74 && x < 156 && z > 96 && z < 171) continue; // 海格区
    reg('hw-bush', x, z, 8);
    bushRing++;
  }
}

/** 城堡/村庄/装饰/hw 地标的站立实体统一注册（buildGroundTexture 收尾调用）。 */
function registerStandingAll(): void {
  registerCastleSprites();
  registerVillageStanding();
  registerServerBuildings();
  registerDecorationStanding();
  registerForestStanding();
  registerHwLandmarks();
  // 打人柳警告牌 (62,14)：树身本体在 registerHwLandmarks（hw-whomping-willow）
  if (!registerPre('hw-signpost', 62, 14, 5)) warnMissingSprite('hw-signpost');
}

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
  // 道路不再矢量描边：已在 paintTileGrid 里按 layout 折线栅格化为 dirt
  // tile 并走 autotile 边缘融合（星露谷式 tile 路面）。村庄路面同口径，
  // 不再有单独覆写层。
  // bushes & stones from layout (collision-checked at build)
  // + v2 new regions: well/market/gate/dock/boat/lighthouse/web/glowflower/tent/campfire/greenhouse/garden/owlery/scoreboard/hoop
  // L4 视觉层次：灌木/石头是背景板，压暗 30% + 降饱和度，不抢建筑的戏。
  // 实现：先画到独立 deco 图层，source-atop 罩深灰绿（同时压暗+去饱和），再合成。
  // 这是纹理烘焙时的一次性成本，不影响帧率。
  const decoC = document.createElement('canvas');
  decoC.width = TW; decoC.height = TH;
  const dg = decoC.getContext('2d')!;
  for (const it of L.items) {
    // L4 散布物全为工厂精灵盖印（登记宽读派生表 ASSET.layoutKinds）；
    // 石头按 variant 选苔藓版（moss）/普通版（rune 刻痕无 3D 对应，归普通版）。
    const decoStamp = (name: string, w: number): void => {
      if (!drawHwTex(dg, name, it.x, it.z, w * it.s)) warnMissingSprite(name);
    };
    switch (it.kind) {
      case 'bush': decoStamp('hw-bush', ASSET.layoutKinds.bush!.drawW); break;
      case 'stone': decoStamp(it.v === 'moss' ? 'hw-stone-moss' : 'hw-stone', ASSET.layoutKinds.stone!.drawW); break;
      default: break; // 非 L4 装饰画到主图层
    }
  }
  // 压暗 30% + 降饱和度：深灰绿罩
  dg.globalCompositeOperation = 'source-atop';
  dg.fillStyle = 'rgba(38,44,38,0.30)';
  dg.fillRect(0, 0, TW, TH);
  dg.globalCompositeOperation = 'source-over';
  g.drawImage(decoC, 0, 0);
  // 只画平铺地面的物件；站立类物件由 registerDecorationStanding 注册排序绘制
  for (const it of L.items) {
    if (!GROUND_ITEM_KINDS.has(it.kind)) continue;
    drawLayoutItem(g, it);
  }
  // T3 宝可梦式：高草=遭遇区语言。禁林边缘一圈高草，3 层深浅+缺口
  paintTallGrassRing(g);
}

/** 平铺在地面上、不参与深度排序的布局物件（灌木/石头在 deco 图层另画，此处为空操作）。
 *  蘑菇已移出本表（2026-10-22 落地感修复）：改走站立排序注册，生物站在
 *  蘑菇北侧时脚被菇体轻盖，给出脚落在草丛里的深度线索；此前蘑菇烘焙进
 *  地面纹理，永远画在生物之下，顺序与该线索相反。 */
const GROUND_ITEM_KINDS = new Set([
  'bush', 'stone',
  'dock', 'boat', 'web', 'glowflower', 'gardenplot', 'flowerbed', 'reed',
]);

/** 单个布局物件的绘制（纹理坐标）。地面物件由 paintDecorations 直接调用；
 *  站立物件由 captureStanding 在捕获上下文中调用，代码完全一致。 */
function drawLayoutItem(g: CanvasRenderingContext2D, it: { kind: string; x: number; z: number; s: number; label?: string }): void {
  const x = w2tx(it.x), y = w2ty(it.z);
  // 工厂精灵绘制：精灵名与登记宽全部读派生表（ASSET.layoutKinds，
  // manifest → derive.py 单点派生）：缺失即警告、不回退矢量
  const lk = ASSET.layoutKinds[it.kind];
  if (!lk) { warnMissingSprite(`layout:${it.kind}`); return; }
  const hw = (name: string, w: number): void => {
    if (!drawHwTex(g, name, it.x, it.z, w * it.s)) warnMissingSprite(name);
  };
  // 底边锚定绘制（shop/pub 专用，与原矢量绘制的南缘锚点同口径）：
  // 精灵站姿南缘落在 it.z，避免建筑整体北移压进街道/邻居占地。
  const hwBase = (name: string, w: number): void => {
    const pm = preSprite(name);
    if (!pm) { warnMissingSprite(name); return; }
    const vw = w * it.s;
    const southW = (pm.stanceS ?? pm.footD / 2) * (vw / pm.footW);
    drawHwTex(g, name, it.x, it.z - southW, vw);
  };
  switch (it.kind) {
    case 'bush': case 'stone': break; // 已在 deco 图层画过
    case 'dock': if (!preSprite('hw-lake-dock')) warnMissingSprite('hw-lake-dock'); break; // hw 码头在 landmarks pass 合并绘制
    case 'shop':
      hwBase(lk.sprite, lk.drawW);
      if (it.label) {
        g.fillStyle = '#fff'; g.font = '11px sans-serif'; g.textAlign = 'center';
        g.fillText(it.label, x, y + 14);
      }
      break;
    case 'pub': hwBase(lk.sprite, lk.drawW); break;
    default: hw(lk.sprite, lk.drawW); break;
  }
}

/** 装饰站立实体注册：非地面类的布局物件逐个捕获（key = 基线 z + 基座深）。 */
function registerDecorationStanding(): void {
  const L = getLayout();
  const BIG = new Set(['greenhouse', 'station', 'library', 'dormtower', 'shop', 'pub']);
  const MED = new Set(['well', 'marketstall', 'villagegate', 'lighthouse', 'tent', 'owlery', 'scoreboard']);
  // 村庄内的住宅/路灯/商店/酒吧与 OBSTACLES 命名商店同址，由
  // registerVillageStanding 用工厂精灵唯一注册，此处跳过避免代码绘制同址
  // 双画盖住工厂精灵（素材统一收口，2026-10-21）。
  const VILLAGE_FACTORY_KINDS = new Set(['cottage', 'stonehouse', 'lamp', 'shop', 'pub']);
  for (const it of L.items) {
    if (GROUND_ITEM_KINDS.has(it.kind)) continue;
    if (VILLAGE_FACTORY_KINDS.has(it.kind) && inVillageExt(it.x, it.z)) continue;
    const ex = BIG.has(it.kind) ? { x: 84 * it.s + 4, n: 118 * it.s + 6 }
      : MED.has(it.kind) ? { x: 48 * it.s + 3, n: 76 * it.s + 5 }
      : { x: 28 * it.s + 3, n: 50 * it.s + 5 };
    captureStanding(it.z + 3 * it.s, it.x - ex.x, it.z - ex.n, it.x + ex.x, it.z + 8 * it.s + 3,
      (cg) => drawLayoutItem(cg, it));
  }
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

/** 城堡站立实体注册（全工厂精灵）：庭院橡树 + 庭院井 + 城墙各边。
 *  城堡建筑本体（礼堂/keep/塔楼/北墙/城门）在 registerHwLandmarks 注册；
 *  此处补矢量城堡层退役后的其余覆盖：庭院两棵橡树（工厂新模型 hw-oak）、
 *  庭院井（hw-well §13 登记宽 7），以及城墙多边形除北墙外的各边——工厂按
 *  各边线角预渲了旋转变体（hw-castle-wall-r1..r6），逐边注册 1–2 段，
 *  登记宽 = footW × U_STRUCT（与北墙段同尺度，段长 4.4 米 × 3.2 ≈ 14）。
 *  Front 淡化走 pre 精灵通用切片（frontZ = 占地北缘），与原捕获口径等价。 */
function registerCastleSprites(): void {
  const reg = (name: string, x: number, z: number, w: number): void => {
    if (!registerPre(name, x, z, w)) warnMissingSprite(name);
  };
  // 庭院橡树（原矢量橡树冠幅 ±28 世界单位）+ 庭院井
  reg('hw-oak', -14, -52.5, drawWOf('hw-oak'));
  reg('hw-oak', 12, -52.5, drawWOf('hw-oak'));
  reg('hw-well', 0, -52.5, ASSET.layoutKinds.well!.drawW);
  // 城墙各边（顶点序沿原城墙多边形；北墙 3 段与南门在 registerHwLandmarks）
  reg('hw-castle-wall-r1', 22.9, -96.5, drawWOf('hw-castle-wall-r1'));  // NE 边 (18,-99)->(36,-90)
  reg('hw-castle-wall-r1', 31.1, -92.5, drawWOf('hw-castle-wall-r1'));
  reg('hw-castle-wall-r2', 39.3, -86.2, drawWOf('hw-castle-wall-r2'));  // E 上边 (36,-90)->(48,-76)
  reg('hw-castle-wall-r2', 44.7, -79.8, drawWOf('hw-castle-wall-r2'));
  reg('hw-castle-wall-r3', 49.3, -71.7, drawWOf('hw-castle-wall-r3'));   // E 下边 (48,-76)->(53,-59)
  reg('hw-castle-wall-r3', 51.7, -63.3, drawWOf('hw-castle-wall-r3'));
  reg('hw-castle-wall-r4', 50, -53, drawWOf('hw-castle-wall-r4'));       // SE 边 (53,-59)->(47,-47)
  reg('hw-castle-wall', 37, -45.3, drawWOf('hw-castle-wall'));         // 南墙东段
  reg('hw-castle-wall', 20, -44.5, drawWOf('hw-castle-wall'));
  reg('hw-castle-wall', -24, -44.8, drawWOf('hw-castle-wall'));         // 南墙西段
  reg('hw-castle-wall-r5', -38.6, -50.1, drawWOf('hw-castle-wall-r5')); // SW 边 (-34,-47)->(-52,-59)
  reg('hw-castle-wall-r5', -47.4, -55.9, drawWOf('hw-castle-wall-r5'));
  reg('hw-castle-wall-r3', -53.5, -64, drawWOf('hw-castle-wall-r3'));    // W 边 (-52,-59)->(-58,-79)
  reg('hw-castle-wall-r3', -56.5, -74, drawWOf('hw-castle-wall-r3'));
  reg('hw-castle-wall-r6', -57.5, -85, drawWOf('hw-castle-wall-r6'));    // NW 边 (-58,-79)->(-56,-102)
  reg('hw-castle-wall-r6', -57, -96, drawWOf('hw-castle-wall-r6'));
}

// (inGrass retired: scatter placement moved to layout.ts with collision registry)


/**
 * 3转2 hw 地标 + 道具注册（站立实体）。
 * 城堡建筑位置/占地沿用城堡布局坐标；道具按 item-design.md 分类摆放到
 * 对应场景。逐帧按占地南缘深度与实体统一排序绘制；精灵未就绪时不注册
 * 并警告（无代码绘制回退，素材缺口必须暴露）。
 * 登记宽度口径：size-design.md 尺寸表（建筑钉占地或 U_STRUCT、活物 U_LIVE）。
 */
function registerHwLandmarks(): void {
  // --- 城堡（布局坐标：大礼堂西、钟塔北、塔楼群、南门） ---
  registerPre('hw-great-hall', -39, -83, drawWOf('hw-great-hall'));
  registerPre('hw-tower-mid', -13.5, -97.5, 9);    // 钟塔（塔径 = 布局 2r）
  registerPre('hw-tower-tall', -56, -102, 9);
  registerPre('hw-tower-mid', 18, -99, 9);
  registerPre('hw-tower-tall', 53, -59, 10);
  registerPre('hw-tower-mid', 8, -45.5, 9);
  registerPre('hw-tower-short', -52, -59, 9);
  registerPre('hw-tower-short', -44, -63, 6.5);
  registerPre('hw-tower-short', -36, -62.5, 5.5);
  registerPre('hw-astro-tower', 33, -70, 14);      // 天文塔（布局 r=7）
  registerPre('hw-castle-wall', -32, -104, drawWOf('hw-castle-wall'));
  registerPre('hw-castle-wall', -4, -103, drawWOf('hw-castle-wall'));
  registerPre('hw-castle-wall', 24, -99.5, drawWOf('hw-castle-wall'));
  registerPre('hw-castle-gate', -3, -45.3, drawWOf('hw-castle-gate'));
  // --- 城堡主体第二批：主楼 keep + 东翼 + 高架桥（布局坐标） ---
  registerPre('hw-keep', 0, -74, drawWOf('hw-keep'));              // 主楼（模型 11.5m × U_STRUCT；keep 障碍 60 宽含两翼）
  registerPre('hw-keep', 20, -72, 24);             // 东翼塔楼块（东翼障碍内）
  registerPre('hw-viaduct', -21, -75, drawWOf('hw-viaduct'));         // 高架桥（钉代码矩形宽 14）
  // --- 魁地奇看台：沿球场四边分段（texPitch 色带之上） ---
  for (const sz of [-176, -161, -146, -131]) {
    registerPre('hw-pitch-stand', 7, sz, drawWOf('hw-pitch-stand'));
    registerPre('hw-pitch-stand', 73, sz, drawWOf('hw-pitch-stand'));
  }
  for (const sx of [31, 49]) {
    registerPre('hw-pitch-stand', sx, -200, drawWOf('hw-pitch-stand'));
    registerPre('hw-pitch-stand', sx, -100, drawWOf('hw-pitch-stand'));
  }
  // --- 标志地点 ---
  registerPre('hw-hagrid-hut', 105, 118, drawWOf('hw-hagrid-hut'));      // 海格小屋（7×6m 按 U_LIVE 高度锚 ≈ 绘制高 20）
  registerPre('hw-whomping-willow', 45, 0, drawWOf('hw-whomping-willow'));    // 打人柳（冠径 10m，绘制高 ≈29）
  registerPre('hw-quidditch-hoops', 40, -178, drawWOf('hw-quidditch-hoops')); // 球门环组（展开 12m × U_STRUCT，高 ≈31）
  registerPre('hw-quidditch-hoops', 40, -122, drawWOf('hw-quidditch-hoops'));
  registerPre('hw-lake-dock', -104, 48, drawWOf('hw-lake-dock'));       // 黑湖码头（两段 dock 合并跨度 ≈12m × U_STRUCT）
  registerPre('hw-express', -44, 300, drawWOf('hw-express'));         // 霍格沃茨特快（按投影高登记：车高 4m，地面长 ≈34）
  registerPre('hw-owl-brown', 86, -84, 7);         // 猫头鹰棚屋栖鸟（与生物 owl 同口径）
  registerPre('hw-owl-snowy', 75, -82, 7);
  // --- 道具（功能类：可交互场景；装饰类：依附建筑/场景） ---
  const props: Array<[string, number, number, number]> = [
    ['hw-cauldron', 99, 128, drawWOf('hw-cauldron')],        // 海格小屋前院（坩埚 口径 0.8m × U_LIVE）
    ['hw-cauldron', 6, 186, drawWOf('hw-cauldron')],         // 霍格莫德广场
    ['hw-pumpkin', 108, 148, drawWOf('hw-pumpkin')],          // 南瓜田（海格巨型南瓜 ≈1m）
    ['hw-pumpkin', 118, 152, 5.5],
    ['hw-pumpkin', 128, 146, 4.5],
    ['hw-candle', -6, -52, drawWOf('hw-candle')],          // 城堡庭院（蜡烛 0.3m）
    ['hw-candle', 6, -52, drawWOf('hw-candle')],
    ['hw-candle', -39, -64, drawWOf('hw-candle')],        // 大礼堂门前
    ['hw-chest', -24, -48, drawWOf('hw-chest')],            // 庭院角（箱 1.0m）
    ['hw-chest', -196, 118, drawWOf('hw-chest')],           // 对角巷街口
    ['hw-diary', 112, -230, drawWOf('hw-diary')],         // 图书馆门前（书 0.3m）
    ['hw-broomstick', 24, -148, drawWOf('hw-broomstick')],       // 魁地奇场边（扫帚长 1.6m）
    ['hw-snitch', 40, -150, drawWOf('hw-snitch')],         // 球场中央（飞贼，可见性下限）
    ['hw-quaffle', 45, -145, drawWOf('hw-quaffle')],        // 鬼飞球 0.3m
    ['hw-potion-red', -146, -52, drawWOf('hw-potion-red')],    // 温室群门前（药水瓶 0.25m）
    ['hw-potion-green', -90, -50, drawWOf('hw-potion-green')],
    ['hw-potion-blue', -34, -52, drawWOf('hw-potion-blue')],
    ['hw-mandrake', -84, -50, drawWOf('hw-mandrake')],       // 曼德拉草盆 0.5m
    ['hw-potion-blue', 14, 166, drawWOf('hw-potion-blue')],     // 霍格莫德店前
    ['hw-devils-snare', 92, 8, 9],        // 禁林边缘（藤团宽 2m）
    ['hw-wand-box', -236, 148, drawWOf('hw-wand-box')],        // 奥利凡德门前（魔杖盒 0.35m）
    ['hw-willow-branch', 53, 7, drawWOf('hw-willow-branch')],       // 打人柳下断枝（≈2m）
  ];
  for (const [n, x, z, w] of props) registerPre(n, x, z, w);
}

// ------------------------------------------------------------------ tile 网格地形（星露谷式 autotile 烘焙）
// 世界按 TILE_U=2 单位栅格化分类（水/沙/草/浅草/土/林/石），逐 tile 画地形
// 图案，再按四邻居优先级把高优先级地形的图案以噪声锯齿边缘条画入本 tile，
// 融合交界——等价于星露谷 tilesheet 的手工边缘件，自动化到烘焙期。
// 替代原 zone 色块填充 + 9px 模糊过渡。分类只读已有世界数据（ZONES /
// LAKE_ZONE / layout 道路折线），不改布局、碰撞与服务器。
const TILE_U = 2;
const GRID_PRIO: Record<GroundTileKind, number> = {
  water: 0, sand: 1, grass: 2, grassL: 2, dirt: 3, forest: 4, stone: 5,
};

function buildClassGrid(): { grid: GroundTileKind[]; cols: number; rows: number } {
  const cols = Math.ceil((TB.x1 - TB.x0) / TILE_U);
  const rows = Math.ceil((TB.z1 - TB.z0) / TILE_U);
  const grid: GroundTileKind[] = new Array(cols * rows).fill('grass');
  const L = getLayout();
  const roadBox = L.roads.map((r) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of r.pts) {
      x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z);
    }
    return { r, x0: x0 - 6, z0: z0 - 6, x1: x1 + 6, z1: z1 + 6 };
  });
  const onRoad = (x: number, z: number): boolean => {
    for (const b of roadBox) {
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
      const p = b.r.pts, lim = b.r.width / 4 + 1.2, lim2 = lim * lim;
      for (let i = 0; i < p.length - 1; i++) {
        const ax = p[i].x, az = p[i].z, dx = p[i + 1].x - ax, dz = p[i + 1].z - az;
        const len2 = dx * dx + dz * dz;
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
        const ex = x - (ax + dx * t), ez = z - (az + dz * t);
        if (ex * ex + ez * ez < lim2) return true;
      }
    }
    return false;
  };
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = TB.x0 + (col + 0.5) * TILE_U, cz = TB.z0 + (row + 0.5) * TILE_U;
      let kind: GroundTileKind = 'grass';
      for (const zn of ZONES) {
        if (cx >= zn.x0 && cx < zn.x1 && cz >= zn.z0 && cz < zn.z1) {
          // 球场修剪条纹：8 单位一带的深浅草（原 texPitch 条纹的 tile 化）
          kind = zn.tex === 'pitch'
            ? (Math.floor(cz / 8) % 2 === 0 ? 'grass' : 'grassL')
            : ZONE_TILE[zn.tex];
        }
      }
      // 黑湖水面 = 碰撞圆盘（src/shared/map.ts 的 disc(-118, 40, r=30)）加
      // 逐 tile 噪声摆动，形成有机岸线。LAKE_ZONE 矩形只是圆盘的包围盒：
      // zone 循环已把整个矩形预填为 water，圆盘外必须改回草地（道路优先），
      // 否则可走的四角岸地会被画成水（视觉与碰撞不一致）。
      const lakeWob = (gridHash(col, row, 77) - 0.5) * 3;
      if (Math.hypot(cx + 118, cz - 40) < 30 + lakeWob) kind = 'water';
      // 霍格莫德广场土盘（原 Kenney 试点层的地面构成，下线后由 tile 网格接管）
      else if (Math.hypot(cx - 3, cz - 180) < 15) kind = 'dirt';
      else if (onRoad(cx, cz)) kind = 'dirt';
      else if (kind === 'water') kind = 'grass';
      // 禁林主径：服务器树木留白走廊（|z−15|<5、x<200，通往阿拉戈克
      // 巢穴）在 tile 层画成土路，林内主径可读；站立选点对走廊的留空
      // 口径见 registerForestStanding 的 clearOfTrail。走廊半宽带逐 tile
      // 噪声摆动，避免尺子般的直边。
      if (kind === 'forest' && cx > 82 && cx < 210 &&
        Math.abs(cz - 15) < 4.2 + (gridHash(col, row, 31) - 0.5) * 1.6) kind = 'dirt';
      // 林地地板只落在林盘内：禁林 = disc(165,15,r85)（服务器真相），
      // zone 矩形四角在林盘外，落叶土不得铺成整块矩形（实测露馅：整幅
      // 棕色方块压在草地上）。盘缘带逐 tile 噪声摆动（与湖岸同法），
      // autotile 再把林地边缘融进草地。
      if (kind === 'forest' &&
        Math.hypot(cx - 165, cz - 15) > 85 + (gridHash(col, row, 47) - 0.5) * 4) kind = 'grass';
      // 城堡庭院花坛：原矢量层在院内 (-20..18, -56..-49) 铺的草地带，
      // 矢量层退役后以分类数据保留（两棵橡树与井在其上，见 registerCastleSprites）
      if (cx >= -20 && cx < 18 && cz >= -56 && cz < -49) kind = 'grass';
      grid[row * cols + col] = kind;
    }
  }
  // 沙岸环：与水 8 邻接的陆地（石面除外）改判 sand，水岸由此成形
  const src = [...grid];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const k = src[row * cols + col];
      if (k === 'water' || k === 'sand' || k === 'stone') continue;
      let shore = false;
      for (let dr = -1; dr <= 1 && !shore; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = row + dr, cc = col + dc;
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          if (src[rr * cols + cc] === 'water') { shore = true; break; }
        }
      }
      if (shore) grid[row * cols + col] = 'sand';
    }
  }
  return { grid, cols, rows };
}

const gridHash = (a: number, b: number, c: number): number => {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

function paintTileGrid(g: CanvasRenderingContext2D): void {
  const { grid, cols, rows } = buildClassGrid();
  const TP = TILE_U * TPX; // 6 texture px per tile
  const pats = new Map<GroundTileKind, CanvasPattern | null>();
  const pat = (k: GroundTileKind): CanvasPattern | string => {
    if (!pats.has(k)) pats.set(k, groundTilePattern(g, k));
    return pats.get(k) ?? GROUND;
  };
  const at = (col: number, row: number): GroundTileKind | null =>
    col < 0 || row < 0 || col >= cols || row >= rows ? null : grid[row * cols + col];
  g.fillStyle = pat('grass');
  g.fillRect(0, 0, TW, TH);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const k = grid[row * cols + col];
      if (k === 'grass') continue;
      g.fillStyle = pat(k);
      g.fillRect(col * TP, row * TP, TP, TP);
    }
  }
  // autotile 边缘融合：高优先级邻居的图案沿交界画入本 tile，
  // 内界深度由逐点噪声决定（25%–55% tile），呈不规则锯齿。
  const SEG = 3;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const k = grid[row * cols + col];
      const tx = col * TP, ty = row * TP;
      for (let d = 0; d < 4; d++) {
        const dc = d === 0 ? 1 : d === 1 ? -1 : 0;
        const dr = d === 2 ? 1 : d === 3 ? -1 : 0;
        const nk = at(col + dc, row + dr);
        if (!nk || nk === k || GRID_PRIO[nk] <= GRID_PRIO[k]) continue;
        const inner: Array<[number, number]> = [];
        for (let i = 0; i <= SEG; i++) {
          const t = i / SEG;
          const dep = TP * (0.25 + 0.3 * gridHash(col * 7 + i * 31, row * 13 + d * 17, i * 3 + d * 101));
          if (d === 0) inner.push([tx + TP - dep, ty + t * TP]);
          else if (d === 1) inner.push([tx + dep, ty + t * TP]);
          else if (d === 2) inner.push([tx + t * TP, ty + TP - dep]);
          else inner.push([tx + t * TP, ty + dep]);
        }
        const A: [number, number] = d === 0 ? [tx + TP, ty] : d === 1 ? [tx, ty] : d === 2 ? [tx, ty + TP] : [tx, ty];
        const B: [number, number] = d === 0 ? [tx + TP, ty + TP] : d === 1 ? [tx, ty + TP] : d === 2 ? [tx + TP, ty + TP] : [tx + TP, ty];
        g.save();
        g.beginPath();
        g.moveTo(A[0], A[1]);
        g.lineTo(B[0], B[1]);
        for (let i = SEG; i >= 0; i--) g.lineTo(inner[i][0], inner[i][1]);
        g.closePath();
        g.clip();
        g.fillStyle = pat(nk);
        g.fillRect(tx, ty, TP, TP);
        g.restore();
      }
    }
  }
}

/** Build the full-world ground texture once: tile grid + autotile edges (no blur). */
function buildGroundTexture(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TW; c.height = TH;
  const g = c.getContext('2d')!;
  const rnd = mulberry(20261017);
  // tile 网格地形 + autotile 边缘融合（替代 zone 色块 + 模糊过渡）
  paintTileGrid(g);
  // zone 细节画笔（半透明色斑/草丛/鹅卵石等）画在独立图层后无模糊合成。
  // 整面型画笔 lake/castle/pitch 已由 tile 网格接管（水面+沙岸、石板地、
  // 球场条纹），跳过避免双画。
  const layer = document.createElement('canvas');
  layer.width = TW; layer.height = TH;
  const lg = layer.getContext('2d')!;
  const SKIP_TEX: ReadonlySet<ZoneTex> = new Set(['lake', 'castle', 'pitch']);
  for (const zn of ZONES) {
    if (SKIP_TEX.has(zn.tex)) continue;
    const x0 = w2tx(zn.x0), y0 = w2ty(zn.z0), w = (zn.x1 - zn.x0) * TPX, h = (zn.z1 - zn.z0) * TPX;
    lg.save();
    lg.beginPath(); lg.rect(x0, y0, w, h); lg.clip();
    TEX_PAINT[zn.tex](lg, x0, y0, w, h, rnd);
    lg.restore();
  }
  g.drawImage(layer, 0, 0);
  // Hogsmeade 地面已并入 tile 网格（buildClassGrid 的村庄广场土盘 + 道路
  // dirt 分类）；建筑/树/灯在 registerStandingAll 里注册为站立实体。
  // decorations on top (paths, bushes, stones) — not blurred, crisp details
  paintDecorations(g);
  // 城堡院内铺地已由 tile 网格接管（castle 区 stone 分类）；庭院花坛草地
  // 在 buildClassGrid 里以 grass 分类保留（原矢量层花坛 rect 的数据化）。
  // 站立实体注册（建筑/树/道具/hw 地标）：逐帧与生物/巫师按占地南缘统一排序
  registerStandingAll();
  // 收尾：整图马赛克+主调色板量化（地面/代码绘制/hw 精灵统一像素风）
  pixelateGround(c);
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
  // Front 层（星露谷式）淡化状态：每站立实体 Front 切片的当前 alpha，
  // 逐帧向目标 lerp（盖住玩家 -> 0.35，否则 -> 1），避免突变闪烁。
  const frontAlpha = new Map<Standing, number>();
  let frameDt = 0.016;
  // 夜光光源表（懒构建）：全部 layout 路灯 + 定点窗光锚（夜里亮窗的立面）
  let glowSrc: Array<{ x: number; z: number; r: number; lamp: boolean }> | null = null;
  const getGlowSrc = (): Array<{ x: number; z: number; r: number; lamp: boolean }> => {
    if (glowSrc) return glowSrc;
    const out: Array<{ x: number; z: number; r: number; lamp: boolean }> = [];
    for (const it of itemsInRect(getLayout(), TB.x0, TB.z0, TB.x1, TB.z1)) {
      if (it.kind === 'lamp') out.push({ x: it.x, z: it.z, r: 7, lamp: true });
    }
    const win: Array<[number, number, number]> = [
      [0, -78, 15], [-39, -80, 12], [41, -38, 9], [105, 112, 10], [-44, 288, 12],
      [-23, 158, 9], [21, 156, 9], [-22, 184, 9], [23, 186, 9],
    ];
    for (const [x, z, r] of win) out.push({ x, z, r, lamp: false });
    glowSrc = out;
    return out;
  };
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
    (window as any).__2dcam = () => ({ x: cam.x, z: cam.z, zoom: cam.zoom });
    (window as any).__2dents = () => snap ? { w: snap.w.length, c: snap.c.length, p: snap.p.length, fx: snap.fx.length } : null;
    (window as any).__2dcreatures = () => snap?.c ?? null;
    (window as any).__2dhour = () => snap?.hour ?? null;
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
  // 接触阴影：以 (sx, anchorScrY) 为椭圆中心画预烘焙贴图（getShadowTex）。
  // 宽 = 登记世界宽 × 0.8，高再乘地面深度压缩 0.646。在实体的排序槽位内、
  // 本体之前调用——阴影与本体同序，不会被南侧物件错误盖住或盖住北侧物件。
  const drawContactShadow = (sx: number, anchorScrY: number, wWorld: number): void => {
    const dw = wWorld * 0.8 * cam.zoom;
    const dh = dw * 0.646;
    ctx.imageSmoothingEnabled = true; // 软边阴影要平滑缩放（精灵绘制处各自关回 false）
    ctx.drawImage(getShadowTex(), sx - dw / 2, anchorScrY - dh / 2, dw, dh);
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
    frameDt = dt;
    // 相机钳制（星露谷式）：视口不越出纹理世界边界；世界比视口小时居中。
    const hvx = (canvas.width / devicePixelRatio / 2) / cam.zoom;
    const hvz = (canvas.height / devicePixelRatio / 2) / cam.zoom;
    cam.x = TB.x1 - TB.x0 > hvx * 2 ? Math.min(TB.x1 - hvx, Math.max(TB.x0 + hvx, cam.x)) : (TB.x0 + TB.x1) / 2;
    cam.z = TB.z1 - TB.z0 > hvz * 2 ? Math.min(TB.z1 - hvz, Math.max(TB.z0 + hvz, cam.z)) : (TB.z0 + TB.z1) / 2;

    draw();
  }

  function draw() {
    const t0 = PERF ? performance.now() : 0;
    const W = canvas.width / devicePixelRatio, H = canvas.height / devicePixelRatio;
    vw = W; vh = H;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

    // --- ground: single pre-rendered texture blit (culling = source-rect clamp) ---
    // 地面纹理已像素化：关闭平滑缩放，保硬像素边缘。
    // Ground texture waits for the factory sprite load to settle (ready or
    // failed); on failure the world still builds, with sprites simply absent
    // (each missing entity warns once via warnMissingSprite).
    ctx.imageSmoothingEnabled = false;
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
      // 碑体走工厂精灵（hw-tombstone，登记宽读派生表 pin 3.2）；
      // 锚点口径与生物一致（脚下地面原点落在 sy + 绘制高/2）
      const pmT = preSprite('hw-tombstone');
      if (pmT) {
        const dwT = drawWOf('hw-tombstone') * cam.zoom;
        const kT = dwT / pmT.w;
        const dhT = pmT.h * kT;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(pmT.img, sx - pmT.anchorX * kT, sy + dhT / 2 - pmT.anchorY * kT, dwT, dhT);
      } else {
        warnMissingSprite('hw-tombstone');
      }
      if (cam.zoom > 0.9) {
        ctx.fillStyle = '#c9c9d4'; setFont('10px sans-serif'); setAlign('center');
        ctx.fillText(t.n.split(' ').pop() ?? t.n, sx, sy + size / 2 + 11);
      }
    }

    // --- 统一深度排序 pass：站立实体（建筑/树/灯/道具/hw 地标）与生物/巫师
    // 按占地南缘 z 升序绘制（北先南后）。站在塔北面被塔挡住、南面压住塔基；
    // 此前实体只在彼此间排序、永远盖在烘焙进地面纹理的建筑之上。
    // 血条/标记/状态文字收集到 overlays，本体全部画完后统一补画（不被南侧
    // 建筑盖住）；名字仍走最后的标签 pass。
    interface NameLbl { x: number; y: number; n: string; isMe: boolean; dy: number; hw: number; dw2: number; dot: boolean }
    const nameQueue: NameLbl[] = [];
    const overlays: Array<() => void> = [];
    const meW = meOf();

    const drawCreature = (c: SC): void => {
        // --- creature: 只走 hw 工厂精灵（未映射/缺失则不绘制并警告），hp bar below ---
        const [sx, sy] = w2s(c.x, c.z);
      const size = Math.max(12, 20 * cam.zoom);
      const hwC = CREATURE_HW[c.k];
      const pmC = hwC ? preSprite(hwC.name) : null;
      // 精灵顶部屏幕 y 与血条半宽：hw 路径按目标身高算，代码绘制路径用旧框
      let topY = sy - size / 2;
      let r = size / 2;
      if (hwC && pmC) {
        // 统一尺寸系统（size-design.md）：按登记世界宽度 wM 定宽，
        // k = wM × zoom / 精灵px宽；高度按精灵宽高比跟随（精灵在工厂
        // 俯角 40° 下渲染，投影自洽，窄高/宽扁都不会爆尺寸）。
        // 锚点 = 脚下地面原点，落在 sy + 绘制高/2（与巫师同口径）。
        const dwC = hwC.wM * cam.zoom;
        const k = dwC / pmC.w;
        const dhC = pmC.h * k;
        // 脚锚点补偿（derived.json footOffset，几何派生）：
        // 脚底偏离站姿南缘的精灵整体纵向移位 −footOffset × k，脚底落回
        // 站姿南缘行；锚点不动，接触阴影仍画在锚点上。
        const footShift = pmC.footOffset ? -pmC.footOffset * k : 0;
        drawContactShadow(sx, sy + dhC / 2, hwC.wM);
        ctx.imageSmoothingEnabled = false; // 像素精灵硬边缘
        ctx.drawImage(pmC.img, sx - pmC.anchorX * k, sy + dhC / 2 - pmC.anchorY * k + footShift, dwC, dhC);
        topY = sy + dhC / 2 - pmC.anchorY * k + footShift;
        r = Math.max(6, Math.min(dwC / 2, 16 * cam.zoom));
      } else {
        // 无工厂精灵（未映射物种或加载失败）：不绘制本体，缺口暴露。
        // 血条/标记仍走 overlays 的缺省框（topY/r 已按旧框赋值）。
        warnMissingSprite(`creature:${c.k}`);
      }
      const hostile = c.s.includes('H') || HOSTILE_KINDS.has(c.k);
      // 密度感知：怪堆里只给最近的 3 个敌对显示标记+血条，其余只显示 sprite。
      // 否则 10+ 蜘蛛的红菱形+血条糊成一团，完全看不清。
      let showMarker = hostile;
      if (hostile && meW) {
        const d2 = (c.x - meW.x) * (c.x - meW.x) + (c.z - meW.z) * (c.z - meW.z);
        // 粗略：只在玩家 25 格内显示标记，远的怪不需要
        if (d2 > 625) showMarker = false;
      }
      overlays.push(() => {
        if (showMarker) {
          // 红色小菱形标记（头顶），代替大红框——多怪聚集时不糊成一团
          const dx = sx, dy = topY - 9;
          ctx.fillStyle = '#ff2a1a';
          ctx.beginPath();
          ctx.moveTo(dx, dy - 5); ctx.lineTo(dx + 4, dy);
          ctx.lineTo(dx, dy + 5); ctx.lineTo(dx - 4, dy);
          ctx.closePath(); ctx.fill();
        }
        // hp bar：受伤必显；敌对只在有标记时显示（避免怪堆血条重叠）
        if (c.hp < c.m || showMarker) {
          ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(sx - r, topY - 4, r * 2, 2.5);
          ctx.fillStyle = hostile ? '#ff5a4d' : '#4dff4d';
          ctx.fillRect(sx - r, topY - 4, (r * 2 * c.hp) / c.m, 2.5);
        }
      });
      // 生物不显示任何文字：敌对有红色菱形+血条，受击有血条，足够辨认。
      // 之前的首字母标签（B/R/S/P）在怪堆里必然糊成一团，已删除。
    };

    const drawWizard = (w: SW): void => {
        // --- wizard: house sprite + hp bar + name (names drawn in 2nd pass with de-collision) ---
      const [sx, sy] = w2s(w.x, w.z);
      const isMe = w.h === myHandle;
      // 统一尺寸系统：人物绘制高 = FIGURE_DH（世界单位）× zoom，r/size 由
      // 绘制高导出（旧口径 dh = 36 × zoom 已废除，见 size-design.md）。
      const variant: CharVariant = variantForName(w.n);
      const dhW = (FIGURE_DH[variant] ?? WIZARD_DH) * cam.zoom;
      const r = Math.max(5, dhW * 0.34);
      const size = dhW * 0.72;
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
      // 3转2 hw 人物（唯一人物素材）：玩家按学院色、NPC 按名字映射
      // （教授/海格/摄魂怪/洛丽丝夫人）。行走时播工厂 w0..w3 帧
      // （bobbing+倾斜+袍摆），站立用静态帧；精灵锚点 = 脚下地面原点，
      // 对齐绘制框的底边（sy + dh/2）；硬像素缩放。
      // 精灵缺失时不绘制本体并警告（原 chars.ts 代码人物回退已退役）。
      const hwBase = hwFigureBase(w.n, String(w.ho).toLowerCase(), variant);
      let pmChar: PreSprite | null = null;
      let charW = dhW * 0.66;
      if (hwBase === 'hw-cat') {
        pmChar = preSprite('hw-cat');
        charW = CREATURE_HW.cat.wM * cam.zoom; // 猫与生物共用同一登记
      } else if (hwBase) {
        const dir = dirFromAngle(w.f);
        pmChar = (walkFrame
          ? preSprite(`${hwBase}-${dir}-w${wk ? Math.floor(wk.t / 7) % 4 : 0}`)
          : null) ?? preSprite(`${hwBase}-${dir}`);
        charW = (FIGURE_W[hwBase] ?? 7.1) * cam.zoom; // 按登记世界宽度定宽
      }
      if (pmChar) {
        const k = charW / pmChar.w;
        const charDh = pmChar.h * k;
        // 人物同口径：接触阴影（锚点地面）+ footOffset 补偿（派生表里
        // 人物各帧偏差均 ≤2px、无条目，读法与生物统一，防未来新帧漂移）。
        const footShift = pmChar.footOffset ? -pmChar.footOffset * k : 0;
        drawContactShadow(sx, sy + charDh / 2, charW / cam.zoom);
        ctx.imageSmoothingEnabled = false; // 像素精灵硬边缘
        ctx.drawImage(pmChar.img, sx - pmChar.anchorX * k, sy + charDh / 2 - pmChar.anchorY * k + footShift, charW, charDh);
      } else {
        warnMissingSprite(`figure:${hwBase ?? variant}`);
      }
      if (isMe) { ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2; ctx.strokeRect(sx - size / 2 - 1, sy - size / 2 - 1, size + 2, size + 2); }
      // facing tick
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(w.f) * (r + 4), sy + Math.sin(w.f) * (r + 4));
      ctx.stroke();
      // distance² to player (world units; viewport-center fallback if player unknown)
      const dw2 = meW ? (w.x - meW.x) * (w.x - meW.x) + (w.z - meW.z) * (w.z - meW.z)
        : (sx - vw / 2) * (sx - vw / 2) + (sy - vh / 2) * (sy - vh / 2);
      nameQueue.push({ x: sx, y: sy + r + 13, n: w.n, isMe, dy: 0, hw: 0, dw2, dot: false });
      overlays.push(() => {
        // hp bar
        if (w.hp < w.m) {
          ctx.fillStyle = '#222'; ctx.fillRect(sx - r, sy - r - 6, r * 2, 3);
          ctx.fillStyle = w.hp / w.m > 0.4 ? '#4dff4d' : '#ff4d4d';
          ctx.fillRect(sx - r, sy - r - 6, (r * 2 * w.hp) / w.m, 3);
        }
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
      });
    };

    // --- execute the unified depth-sorted pass ---
    interface DrawItem { key: number; ord: number; run: () => void }
    interface FrontSlice { s: Standing; img: CanvasImageSource; dx: number; dy: number; dw: number; dh: number; fy: number }
    const drawItems: DrawItem[] = [];
    const frontSlices: FrontSlice[] = [];
    const vPad = 48;
    const vx0 = wA.x - vPad, vz0 = wA.z - vPad, vx1 = wB.x + vPad, vz1 = wB.z + vPad;
    // 玩家屏幕矩形（与 drawWizard 同口径：绘制高 WIZARD_DH × zoom，宽 0.72dh），
    // 供 Front 切片淡化判定：切片盖住玩家到一定比例才渐变。
    let meRect: { l: number; t: number; r: number; b: number } | null = null;
    if (meW) {
      const [mx, my] = w2s(meW.x, meW.z);
      const dhM = WIZARD_DH * cam.zoom;
      meRect = { l: mx - dhM * 0.36, t: my - dhM / 2, r: mx + dhM * 0.36, b: my + dhM / 2 };
    }
    // 全部角色（巫师+生物）的近似屏幕矩形：Front 切分是昂贵路径（切片要在
    // Front pass 整幅重绘），只有真有角色压到切片时才拆分；无人被盖的实体
    // 走整图单次绘制（与旧路径同成本）。矩形取宽松近似并外扩 6px，宁可
    // 多拆分一次，不可漏盖。
    interface ActorRect { l: number; t: number; r: number; b: number }
    const actorRects: ActorRect[] = [];
    {
      const dhW = WIZARD_DH * cam.zoom;
      for (const w of snap.w) {
        if (!visible(w.x, w.z)) continue;
        const [sx, sy] = w2s(w.x, w.z);
        actorRects.push({ l: sx - dhW * 0.36 - 6, t: sy - dhW / 2 - 6, r: sx + dhW * 0.36 + 6, b: sy + dhW / 2 + 6 });
      }
      for (const c of snap.c) {
        if (!visible(c.x, c.z)) continue;
        const [sx, sy] = w2s(c.x, c.z);
        const hwC = CREATURE_HW[c.k];
        const pmC = hwC ? preSprite(hwC.name) : null;
        const dwC = hwC ? hwC.wM * cam.zoom : Math.max(12, 20 * cam.zoom);
        const dhC = hwC && pmC ? dwC * (pmC.h / pmC.w) : dwC;
        actorRects.push({ l: sx - dwC / 2 - 6, t: sy - dhC / 2 - 6, r: sx + dwC / 2 + 6, b: sy + dhC / 2 + 6 });
      }
    }
    for (const s of standing) {
      if (s.bx1 < vx0 || s.bx0 > vx1 || s.bz1 < vz0 || s.bz0 > vz1) continue;
      drawItems.push({
        key: s.key, ord: 0, run: () => {
          let img: CanvasImageSource, dx: number, dy: number, dw: number, dh: number;
          if (s.kind === 'cap') {
            img = s.canvas;
            dx = (TB.x0 + s.tx0 / TPX - cam.x) * cam.zoom + vw / 2;
            dy = (TB.z0 + s.ty0 / TPX - cam.z) * cam.zoom + vh / 2;
            dw = (s.canvas.width / TPX) * cam.zoom;
            dh = (s.canvas.height / TPX) * cam.zoom;
          } else {
            const [sx, sy] = w2s(s.wx, s.wz);
            const k = (s.visualW * cam.zoom) / s.pm.w;
            img = s.pm.img;
            dx = sx - s.pm.anchorX * k; dy = sy - s.pm.anchorY * k;
            dw = s.pm.w * k; dh = s.pm.h * k;
          }
          ctx.imageSmoothingEnabled = false;
          // Front 切分（星露谷 Front 层）：占地北缘以北的精灵行属于 Front 层，
          // 延后到 Front pass 盖绘；本 pass 只画南片。两片以 fy 为界互补，
          // 半透明像素不会双重混合。仅当真有角色压到切片、或该实体正在
          // 淡化中（alpha<1）才拆分，否则整图绘制（零额外成本）。
          const fy = (s.frontZ - cam.z) * cam.zoom + vh / 2;
          let split = false;
          if (fy > dy + 2 && fy < dy + dh - 2) {
            if ((frontAlpha.get(s) ?? 1) < 0.999) split = true;
            else {
              for (const r of actorRects) {
                if (r.l < dx + dw && r.r > dx && r.t < fy && r.b > dy) { split = true; break; }
              }
            }
          }
          if (split) {
            frontSlices.push({ s, img, dx, dy, dw, dh, fy });
            ctx.save();
            ctx.beginPath(); ctx.rect(dx, fy, dw, dy + dh - fy); ctx.clip();
            ctx.drawImage(img, dx, dy, dw, dh);
            ctx.restore();
          } else {
            ctx.drawImage(img, dx, dy, dw, dh);
          }
        },
      });
    }
    for (const c of snap.c) { if (visible(c.x, c.z)) drawItems.push({ key: c.z, ord: 1, run: () => drawCreature(c) }); }
    for (const w of snap.w) { if (visible(w.x, w.z)) drawItems.push({ key: w.z, ord: 1, run: () => drawWizard(w) }); }
    drawItems.sort((a, b) => a.key - b.key || a.ord - b.ord);
    for (const it of drawItems) it.run();

    // --- Front pass（星露谷 Front 层）：屋顶探出/树冠统一盖绘在所有实体
    // 之后——站在物件北侧的角色会被其 Front 部分盖住，与真实空间一致。
    // 例外照抄星露谷 FadeWhenBehind/树冠透明：切片盖住玩家本人且玩家在
    // 该实体排序键以北时，切片渐变至 alpha 0.35（逐帧 lerp，约 0.2s），
    // 本体（南片）不动。星露谷建筑整栋淡化，我们只淡 Front 切片，差异见
    // stardew-system.md 第 4 节。
    for (const f of frontSlices) {
      const cur = frontAlpha.get(f.s) ?? 1;
      let target = 1;
      if (meRect && meW && meW.z < f.s.key) {
        const ow = Math.min(f.dx + f.dw, meRect.r) - Math.max(f.dx, meRect.l);
        const oh = Math.min(f.fy, meRect.b) - Math.max(f.dy, meRect.t);
        if (ow > (meRect.r - meRect.l) * 0.3 && oh > (meRect.b - meRect.t) * 0.25) target = 0.35;
      }
      const step = frameDt * 3.2;
      const na = cur + Math.max(-step, Math.min(step, target - cur));
      frontAlpha.set(f.s, na);
      ctx.save();
      ctx.beginPath(); ctx.rect(f.dx, f.dy, f.dw, f.fy - f.dy); ctx.clip();
      if (na < 0.999) ctx.globalAlpha = na;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(f.img, f.dx, f.dy, f.dw, f.dh);
      ctx.restore();
    }
    for (const ov of overlays) ov();

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
    // --- 夜窗光/灯光（星露谷 NightTiles 点亮 + 光源的等价实现）：光照罩
    // 之后以 'lighter' 叠加暖色光晕，强度随夜幕深度缩放。路灯双层：
    // 大而淡的外晕 + 小而亮的内芯（星露谷路灯的双光源结构）。
    {
      const nk = 1 - dayFactor;
      if (nk > 0.05) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const s of getGlowSrc()) {
          if (!visible(s.x, s.z, s.r + 6)) continue;
          const [sx, sy] = w2s(s.x, s.z);
          const cy = sy - 3 * cam.zoom;
          const R = s.r * cam.zoom;
          const grad = ctx.createRadialGradient(sx, cy, 0, sx, cy, R);
          grad.addColorStop(0, `rgba(255,180,92,${(0.30 * nk).toFixed(3)})`);
          grad.addColorStop(1, 'rgba(255,180,92,0)');
          ctx.fillStyle = grad;
          ctx.beginPath(); ctx.arc(sx, cy, R, 0, Math.PI * 2); ctx.fill();
          if (s.lamp) {
            const R2 = R * 0.38;
            const grad2 = ctx.createRadialGradient(sx, cy, 0, sx, cy, R2);
            grad2.addColorStop(0, `rgba(255,214,140,${(0.5 * nk).toFixed(3)})`);
            grad2.addColorStop(1, 'rgba(255,214,140,0)');
            ctx.fillStyle = grad2;
            ctx.beginPath(); ctx.arc(sx, cy, R2, 0, Math.PI * 2); ctx.fill();
          }
        }
        ctx.restore();
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
