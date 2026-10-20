/**
 * 素材包加载层（Kenney CC0，见 client/assets2d/ASSETS.md）。
 *
 * 启动时加载图集，按 tile 坐标切图，并把多 tile 精灵（房子/树/路灯）
 * 一次性合成到离屏 canvas；运行时只 drawImage，不再逐帧手绘。
 * 加载未完成时 assetsSettled() 为 false（渲染器先画占位）；
 * 加载失败时 villageSprites() 返回 null，渲染器回退到代码绘制。
 */
export type AssetState = 'loading' | 'ready' | 'failed';
let state: AssetState = 'loading';
export const assetsState = (): AssetState => state;
// 世界纹理只烘焙一次，预渲染精灵（3转2）必须在烘焙前就绪或明确失败，
// 故 settled 同时等图集与预渲染两条加载线（各自独立回退不受影响）。
export const assetsSettled = (): boolean => state !== 'loading' && preSettled;

const TOWN_URL = '/assets2d/kenney-tiny-town/tilemap_packed.png';
const RL_URL = '/assets2d/kenney-roguelike-rpg/roguelikeSheet_transparent.png';
const TILE = 16;

function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('asset load failed: ' + url));
    img.src = url;
  });
}

function mkCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}

/** 从图集切一块（源像素坐标）。 */
function cut(img: HTMLImageElement, sx: number, sy: number, w: number, h: number): HTMLCanvasElement {
  const [c, g] = mkCanvas(w, h);
  g.drawImage(img, sx, sy, w, h, 0, 0, w, h);
  return c;
}

/** Tiny Town tile：packed 图集 12 列、16px、无间隔，索引行主序。 */
const townTile = (img: HTMLImageElement, idx: number): HTMLCanvasElement =>
  cut(img, (idx % 12) * TILE, Math.floor(idx / 12) * TILE, TILE, TILE);

/** Roguelike tile：16px、间隔 1px（步距 17），按 (col,row) 取。 */
const rlTile = (img: HTMLImageElement, col: number, row: number): HTMLCanvasElement =>
  cut(img, col * (TILE + 1), row * (TILE + 1), TILE, TILE);

/** 把 tile 网格合成一张精灵（null = 透明格）。 */
function compose(grid: Array<Array<HTMLCanvasElement | null>>): HTMLCanvasElement {
  const rows = grid.length, cols = grid[0].length;
  const [c, g] = mkCanvas(cols * TILE, rows * TILE);
  grid.forEach((row, r) => row.forEach((t, cc) => { if (t) g.drawImage(t, cc * TILE, r * TILE); }));
  return c;
}

/**
 * 换色管线：对 canvas 的 y ∈ [y0,y1) 区域做色相旋转（保留明度/饱和度）。
 * 同一管线后续可用于人物袍子按学院换色；当前用于生成绿屋顶商店变体。
 */
export function hueShift(src: HTMLCanvasElement, y0: number, y1: number, deg: number): HTMLCanvasElement {
  const [c, g] = mkCanvas(src.width, src.height);
  g.drawImage(src, 0, 0);
  const img = g.getImageData(0, y0, src.width, y1 - y0);
  const d = img.data;
  const rad = (deg * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  // YIQ 色相旋转（近似 HSL hue rotate，对像素美术足够）
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    const y = 0.299 * r + 0.587 * gg + 0.114 * b;
    const ii = 0.596 * r - 0.274 * gg - 0.322 * b;
    const q = 0.211 * r - 0.523 * gg + 0.312 * b;
    const i2 = ii * cos - q * sin, q2 = ii * sin + q * cos;
    d[i] = Math.max(0, Math.min(255, y + 0.956 * i2 + 0.619 * q2));
    d[i + 1] = Math.max(0, Math.min(255, y - 0.272 * i2 - 0.647 * q2));
    d[i + 2] = Math.max(0, Math.min(255, y - 1.106 * i2 + 1.703 * q2));
  }
  g.putImageData(img, 0, y0);
  return c;
}

// ------------------------------------------------------------------ village sprite set
export interface VillageSprites {
  grass: HTMLCanvasElement[];             // [纯草, 变体, 草+花]
  dirtFull: HTMLCanvasElement;
  dirtVar: HTMLCanvasElement;             // 沙土变体（混入土路）
  dirtEdge: Record<'t' | 'b' | 'l' | 'r' | 'tl' | 'tr' | 'bl' | 'br', HTMLCanvasElement>;
  cottage: HTMLCanvasElement;             // 5×4 tile = 80×64
  stonehouse: HTMLCanvasElement;          // 7×5 tile = 112×80
  shopGray: HTMLCanvasElement;            // 7×5 石墙+灰顶
  shopRed: HTMLCanvasElement;             // 7×5 石墙+红顶
  shopGreen: HTMLCanvasElement;           // 7×5 石墙+绿顶（红顶 hueShift）
  lamp: HTMLCanvasElement;                // 16×32 木桩+火把
  sign: HTMLCanvasElement;                // 16×16 告示牌
  pine: HTMLCanvasElement;                // 16×32 绿松
  pineOrange: HTMLCanvasElement;          // 16×32 橙松
  pineSmall: HTMLCanvasElement;           // 16×16 小松
  roundTree: HTMLCanvasElement;           // 16×32 圆冠树
  thinTree: HTMLCanvasElement;            // 16×32 细树
  autumn: HTMLCanvasElement;              // 48×48 秋色树丛 3×3
  grove: HTMLCanvasElement;               // 48×48 绿树丛 3×3
  fenceRun: HTMLCanvasElement;            // 64×16 栅栏一段
}

let sprites: VillageSprites | null = null;
export const villageSprites = (): VillageSprites | null => sprites;

// ------------------------------------------------------------------ 3转2 预渲染精灵
// tools/sprite-factory 产出（client/assets2d/prerendered/）：3D 模型在固定
// 相机+灯光下渲染的透明底 PNG + sprites.json（锚点/占地）。独立加载、独立
// 回退：preSprite() 返回 null 时渲染器走原素材/代码绘制路径。
export interface PreSprite {
  img: HTMLImageElement;
  w: number; h: number;           // PNG 像素尺寸
  anchorX: number; anchorY: number; // 地面原点（占地中心、y=0）在图内的像素位置
  footW: number; footD: number;     // 3D 占地（米）
  ppm: number;                      // 渲染密度（px/米）
}
const preMap = new Map<string, PreSprite>();
let preReady = false;
let preSettled = false;
export const preSprite = (name: string): PreSprite | null =>
  preReady ? (preMap.get(name) ?? null) : null;

fetch('/assets2d/prerendered/sprites.json')
  .then((r) => { if (!r.ok) throw new Error('sprites.json ' + r.status); return r.json(); })
  .then(async (meta: Record<string, Omit<PreSprite, 'img'>>) => {
    await Promise.all(Object.entries(meta).map(async ([name, m]) => {
      const img = await loadImg('/assets2d/prerendered/' + name + '.png');
      preMap.set(name, { img, ...m });
    }));
    preReady = true;
  })
  .catch((e) => console.warn('[2d] prerendered sprites unavailable, fallback:', e))
  .finally(() => { preSettled = true; });

function buildSprites(town: HTMLImageElement, rl: HTMLImageElement): VillageSprites {
  const T = (idx: number) => townTile(town, idx);
  // 房子：屋顶 2 行（下行中央嵌山墙片）+ 墙体（下行中央门、两侧窗）
  const house = (roofT: number[], roofB: number[], wallRows: number[][]): HTMLCanvasElement =>
    compose([
      roofT.map(T),
      roofB.map(T),
      ...wallRows.map((r) => r.map(T)),
    ]);
  const cottage = house(
    [52, 53, 53, 53, 54],
    [64, 65, 67, 65, 66],
    [
      [72, 72, 72, 72, 72],
      [73, 84, 85, 84, 73],
    ],
  );
  const stoneGrid = (roofT: number[], roofB: number[]): number[][] => [
    roofT, roofB,
    [76, 76, 88, 76, 88, 76, 76],
    [77, 76, 76, 76, 76, 76, 77],
    [76, 88, 76, 89, 76, 88, 76],
  ];
  const stonehouse = compose(stoneGrid(
    [48, 49, 49, 49, 49, 49, 50],
    [60, 61, 61, 63, 61, 61, 62],
  ).map((r) => r.map(T)));
  const shopGray = stonehouse;
  const shopRed = compose(stoneGrid(
    [52, 53, 53, 53, 53, 53, 54],
    [64, 65, 65, 67, 65, 65, 66],
  ).map((r) => r.map(T)));
  // 绿顶：红顶屋顶行（前 2 行 = 32px）色相 +150°（红→绿）
  const shopGreen = hueShift(shopRed, 0, 32, 150);

  return {
    grass: [T(0), T(1), T(2)],
    dirtFull: T(25),
    dirtVar: T(39),
    dirtEdge: {
      t: T(13), b: T(37), l: T(24), r: T(26),
      tl: T(12), tr: T(14), bl: T(36), br: T(38),
    },
    cottage,
    stonehouse,
    shopGray, shopRed, shopGreen,
    // 路灯：Roguelike 火把（头） + Tiny Town 木桩（杆）
    lamp: compose([[rlTile(rl, 18, 7)], [T(47)]]),
    sign: T(83),
    pine: compose([[T(4)], [T(16)]]),
    pineOrange: compose([[T(3)], [T(15)]]),
    pineSmall: T(28),
    roundTree: compose([[T(5)], [T(17)]]),
    thinTree: compose([[T(7)], [T(19)]]),
    autumn: compose([
      [T(9), T(10), T(11)],
      [T(21), T(22), T(23)],
      [T(33), T(34), T(35)],
    ]),
    grove: compose([
      [T(6), T(7), T(8)],
      [T(18), T(19), T(20)],
      [T(30), T(31), T(32)],
    ]),
    fenceRun: compose([[T(80), T(81), T(81), T(82)]]),
  };
}

// 启动即加载；3 秒超时兜底（本地文件应远快于此），失败则 settled + 回退代码绘制。
const timeout = new Promise<never>((_, reject) =>
  setTimeout(() => reject(new Error('asset load timeout')), 3000));
Promise.race([
  Promise.all([loadImg(TOWN_URL), loadImg(RL_URL)]),
  timeout,
]).then(([town, rl]) => {
  sprites = buildSprites(town, rl);
  state = 'ready';
}).catch((e) => {
  console.warn('[2d] assets fallback to code-drawn:', e);
  state = 'failed';
});
