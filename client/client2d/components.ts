/**
 * client2d/components.ts — 工业化美术组件库 v2。
 *
 * 设计框架见 ~/workspace/goals/2d/hidden_files/art-framework.md。
 * 所有尺寸以"人"为基准：1 人 = 24w × 36h（设计 px）。
 *
 * 每个组件是函数：(g, x, y, s) => void
 *   g: CanvasRenderingContext2D
 *   x, y: 锚点 = 底部中心（脚底/地基中心）
 *   s: 缩放（设计 px → 目标 px）。纹理用 TPX(3)，屏幕用 zoom。
 *
 * 风格：1px #2a1f1a 描边，光源左上 45°，每色块 base/shadow/highlight 三层。
 */

export const OUTLINE = '#2a1f1a';
export const SHADOW_A = 'rgba(0,0,0,0.25)';
// T5 宝可梦式：同区域建筑屋顶统一色。霍格莫德 = 深红，城堡区 = 灰蓝
export const ROOF_VILLAGE = '#7a3b2e';
export const ROOF_VILLAGE_DARK = '#5e2c22';
export const ROOF_CASTLE = '#4a5a6e';

// ------------------------------------------------------------------ helpers
function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function blob(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

/** 投影：右下偏移，长度 = 高 × 0.3 */
function dropShadow(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, s: number): void {
  g.fillStyle = SHADOW_A;
  const off = h * 0.3 * s;
  g.beginPath();
  g.ellipse(x + off * 0.5, y - h * 0.05 * s, (w / 2) * s, (h * 0.12) * s, 0, 0, Math.PI * 2);
  g.fill();
}

// ------------------------------------------------------------------ 房屋
// 茅屋：72w × 56h。墙 32h + 屋顶 24h。门 16w×28h（≥1.0×人高 ✓）

export function drawCottage(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const W = 72 * s, H = 56 * s;
  const x0 = x - W / 2, y0 = y - H; // 左上
  dropShadow(g, x, y, W, H, s);

  // 墙体
  const wallH = 32 * s;
  g.fillStyle = '#c2b28e';
  rr(g, x0, y0 + H - wallH, W, wallH, 2 * s); g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.5);
  rr(g, x0, y0 + H - wallH, W, wallH, 2 * s); g.stroke();
  // 墙体阴影（右下）
  g.fillStyle = '#96876c';
  g.fillRect(x0 + W - 8 * s, y0 + H - wallH + 2 * s, 6 * s, wallH - 4 * s);

  // 屋顶：梯形，两坡（T5：霍格莫德统一深红）
  g.fillStyle = ROOF_VILLAGE;
  g.beginPath();
  g.moveTo(x0 - 4 * s, y0 + H - wallH);
  g.lineTo(x, y0);
  g.lineTo(x0 + W + 4 * s, y0 + H - wallH);
  g.closePath(); g.fill();
  g.strokeStyle = OUTLINE; g.stroke();
  // 左坡 highlight / 右坡 shadow
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.beginPath();
  g.moveTo(x0 - 4 * s, y0 + H - wallH); g.lineTo(x, y0); g.lineTo(x, y0 + H - wallH); g.closePath(); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.beginPath();
  g.moveTo(x, y0); g.lineTo(x0 + W + 4 * s, y0 + H - wallH); g.lineTo(x, y0 + H - wallH); g.closePath(); g.fill();
  // 屋脊线
  g.strokeStyle = ROOF_VILLAGE_DARK; g.lineWidth = Math.max(1, s * 0.4);
  g.beginPath(); g.moveTo(x - 3 * s, y0 + 2 * s); g.lineTo(x + 3 * s, y0 + 2 * s); g.stroke();

  // 烟囱
  const chx = x + W * 0.22, chW = 8 * s, chH = 14 * s;
  g.fillStyle = '#6e5a50';
  g.fillRect(chx - chW / 2, y0 + 6 * s, chW, chH);
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.4);
  g.strokeRect(chx - chW / 2, y0 + 6 * s, chW, chH);
  g.fillStyle = '#8a7368';
  g.fillRect(chx - chW / 2, y0 + 6 * s, chW, 3 * s);
  // 烟：三团渐淡
  blob(g, chx + 1 * s, y0 - 2 * s, 3 * s, 'rgba(200,200,200,0.35)');
  blob(g, chx + 3 * s, y0 - 8 * s, 4 * s, 'rgba(200,200,200,0.22)');
  blob(g, chx + 6 * s, y0 - 15 * s, 5 * s, 'rgba(200,200,200,0.12)');

  // 门（南墙中央）：16w × 28h
  const dw = 16 * s, dh = 28 * s;
  const dx = x - dw / 2, dy = y - dh;
  g.fillStyle = '#6b4f3a';
  rr(g, dx, dy, dw, dh, 3 * s); g.fill();
  g.strokeStyle = OUTLINE; g.stroke();
  g.fillStyle = '#4a352a'; // 门缝
  g.fillRect(x - s, dy + 2 * s, 2 * s, dh - 4 * s);

  // 窗（两侧）：8w × 8h，带反光
  for (const wx of [x - W * 0.28, x + W * 0.28]) {
    g.fillStyle = '#3a4a5c';
    rr(g, wx - 4 * s, y - 22 * s, 8 * s, 8 * s, s); g.fill();
    g.strokeStyle = OUTLINE; g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.35)'; // 反光
    g.fillRect(wx - 4 * s, y - 22 * s, 8 * s, 2 * s);
  }
}

// 石屋：96w × 72h。墙 44h + 屋顶 28h。双开门 24w×32h。

export function drawStoneHouse(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const W = 96 * s, H = 72 * s;
  const x0 = x - W / 2, y0 = y - H;
  dropShadow(g, x, y, W, H, s);

  // 石墙（带石块纹理）
  const wallH = 44 * s;
  g.fillStyle = '#9b958b';
  rr(g, x0, y0 + H - wallH, W, wallH, 2 * s); g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.5);
  rr(g, x0, y0 + H - wallH, W, wallH, 2 * s); g.stroke();
  // 石块缝
  g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = Math.max(1, s * 0.3);
  for (let i = 1; i < 4; i++) {
    g.beginPath();
    g.moveTo(x0 + 4 * s, y0 + H - wallH + (wallH / 4) * i);
    g.lineTo(x0 + W - 4 * s, y0 + H - wallH + (wallH / 4) * i);
    g.stroke();
  }
  g.fillStyle = '#7f7a71'; // 右下阴影
  g.fillRect(x0 + W - 10 * s, y0 + H - wallH + 2 * s, 8 * s, wallH - 4 * s);

  // 屋顶（T5：霍格莫德统一深红）
  g.fillStyle = ROOF_VILLAGE;
  g.beginPath();
  g.moveTo(x0 - 5 * s, y0 + H - wallH);
  g.lineTo(x, y0);
  g.lineTo(x0 + W + 5 * s, y0 + H - wallH);
  g.closePath(); g.fill();
  g.strokeStyle = OUTLINE; g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.beginPath();
  g.moveTo(x0 - 5 * s, y0 + H - wallH); g.lineTo(x, y0); g.lineTo(x, y0 + H - wallH); g.closePath(); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.beginPath();
  g.moveTo(x, y0); g.lineTo(x0 + W + 5 * s, y0 + H - wallH); g.lineTo(x, y0 + H - wallH); g.closePath(); g.fill();

  // 烟囱 ×2（带烟）
  for (const chx of [x - W * 0.25, x + W * 0.25]) {
    g.fillStyle = '#6e5a50';
    g.fillRect(chx - 4 * s, y0 + 8 * s, 8 * s, 14 * s);
    g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.4);
    g.strokeRect(chx - 4 * s, y0 + 8 * s, 8 * s, 14 * s);
    blob(g, chx + 1 * s, y0 + 2 * s, 3 * s, 'rgba(200,200,200,0.35)');
    blob(g, chx + 3 * s, y0 - 4 * s, 4 * s, 'rgba(200,200,200,0.22)');
  }

  // 双开门：24w × 32h
  const dw = 24 * s, dh = 32 * s;
  g.fillStyle = '#6b4f3a';
  rr(g, x - dw / 2, y - dh, dw, dh, 3 * s); g.fill();
  g.strokeStyle = OUTLINE; g.stroke();
  g.fillStyle = '#4a352a';
  g.fillRect(x - s, y - dh + 2 * s, 2 * s, dh - 4 * s);

  // 窗 ×4
  for (const wx of [x - W * 0.32, x - W * 0.12, x + W * 0.12, x + W * 0.32]) {
    g.fillStyle = '#3a4a5c';
    rr(g, wx - 4 * s, y - 26 * s, 8 * s, 10 * s, s); g.fill();
    g.strokeStyle = OUTLINE; g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(wx - 4 * s, y - 26 * s, 8 * s, 2 * s);
  }
}

// 城堡塔楼：60w × 120h。城墙 48h 可单独画。

export function drawTower(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const W = 60 * s, H = 120 * s;
  const x0 = x - W / 2, y0 = y - H;
  dropShadow(g, x, y, W, H, s);

  // 塔身
  g.fillStyle = '#9b958b';
  rr(g, x0, y0 + 24 * s, W, H - 24 * s, 2 * s); g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.5);
  rr(g, x0, y0 + 24 * s, W, H - 24 * s, 2 * s); g.stroke();
  // 石缝
  g.strokeStyle = 'rgba(0,0,0,0.15)'; g.lineWidth = Math.max(1, s * 0.3);
  for (let i = 1; i < 6; i++) {
    g.beginPath();
    g.moveTo(x0 + 4 * s, y0 + 24 * s + ((H - 24 * s) / 6) * i);
    g.lineTo(x0 + W - 4 * s, y0 + 24 * s + ((H - 24 * s) / 6) * i);
    g.stroke();
  }
  // 右侧阴影
  g.fillStyle = '#7f7a71';
  g.fillRect(x0 + W - 10 * s, y0 + 26 * s, 8 * s, H - 30 * s);

  // 城垛顶
  g.fillStyle = '#9b958b';
  for (let i = 0; i < 5; i++) {
    const bx = x0 + (i + 0.1) * (W / 5);
    g.fillRect(bx, y0 + 14 * s, W / 5 * 0.8, 10 * s);
  }
  g.strokeStyle = OUTLINE;
  g.strokeRect(x0, y0 + 14 * s, W, 10 * s);

  // 尖顶
  g.fillStyle = '#8a5f4a';
  g.beginPath();
  g.moveTo(x0 - 3 * s, y0 + 14 * s); g.lineTo(x, y0 - 10 * s); g.lineTo(x0 + W + 3 * s, y0 + 14 * s);
  g.closePath(); g.fill();
  g.strokeStyle = OUTLINE; g.stroke();

  // 窗（竖排 3 个）
  for (let i = 0; i < 3; i++) {
    const wy = y0 + 40 * s + i * 24 * s;
    g.fillStyle = '#2a3444';
    rr(g, x - 4 * s, wy, 8 * s, 12 * s, 2 * s); g.fill();
    g.strokeStyle = OUTLINE; g.stroke();
  }

  // 拱门（底部）
  g.fillStyle = '#4a352a';
  g.beginPath();
  g.arc(x, y - 10 * s, 10 * s, Math.PI, 0);
  g.fillRect(x - 10 * s, y - 10 * s, 20 * s, 10 * s);
  g.fill();
  g.strokeStyle = OUTLINE; g.stroke();
}

// ------------------------------------------------------------------ 树木
// 宝可梦 Gen3 风格：树冠是多团错落的叶簇（不规则边缘），树干从树冠下露出。
// 锚点 = 底部中心（树干根部）。s = 缩放。seed 保证同位置树形一致。

/** 0..1 确定性抖动 */
function sjit(seed: number, n: number): number {
  const v = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

/** 一圈叶簇：n 团圆，中心在半径 ringR 的圆周上，每团半径 br，带抖动 */
function leafRing(g: CanvasRenderingContext2D, cx: number, cy: number,
  n: number, ringR: number, br: number, color: string, seed: number, squash = 0.85): void {
  g.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (sjit(seed, i) - 0.5) * 0.5;
    const rr = ringR * (0.9 + sjit(seed, i + 100) * 0.2);
    const bx = cx + Math.cos(a) * rr;
    const by = cy + Math.sin(a) * rr * squash;
    const brr = br * (0.85 + sjit(seed, i + 200) * 0.3);
    g.beginPath(); g.arc(bx, by, brr, 0, Math.PI * 2); g.fill();
  }
}

export function drawOak(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const seed = x * 0.371 + y * 0.737;
  const R = 36 * s;              // 冠径 72（框架）
  const cy = y - 58 * s;         // 树冠中心
  // 根部阴影
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.beginPath(); g.ellipse(x + 3 * s, y - 2 * s, 30 * s, 8 * s, 0, 0, Math.PI * 2); g.fill();
  // 树干（树冠下露出 22s）
  const tw = 9 * s;
  g.fillStyle = '#4a352a';
  g.fillRect(x - tw / 2, y - 34 * s, tw, 34 * s);
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.5);
  g.strokeRect(x - tw / 2, y - 34 * s, tw, 34 * s);
  g.fillStyle = '#6b4f3a'; // 左上高光
  g.fillRect(x - tw / 2 + 1.5 * s, y - 32 * s, 2.5 * s, 30 * s);
  // 树冠：外圈深色叶簇（带深色描边底）
  leafRing(g, x, cy, 11, R * 0.80, R * 0.42, OUTLINE, seed + 1);
  leafRing(g, x, cy, 11, R * 0.80, R * 0.42 - 1.4 * s, '#2c4530', seed + 1);
  // 中圈：上移，偏左上（光源方向）
  leafRing(g, x - 4 * s, cy - 7 * s, 8, R * 0.50, R * 0.38, OUTLINE, seed + 2);
  leafRing(g, x - 4 * s, cy - 7 * s, 8, R * 0.50, R * 0.38 - 1.4 * s, '#3d5c3e', seed + 2);
  // 顶簇：左上亮色
  leafRing(g, x - 9 * s, cy - 14 * s, 5, R * 0.24, R * 0.30, '#527a4e', seed + 3);
  // 叶面高光点
  blob(g, x - 16 * s, cy - 16 * s, 3.5 * s, 'rgba(255,255,255,0.16)');
  blob(g, x - 8 * s, cy - 22 * s, 2.5 * s, 'rgba(255,255,255,0.12)');
  blob(g, x - 20 * s, cy - 8 * s, 2 * s, 'rgba(255,255,255,0.10)');
}

/** 锯齿三角冠：松针层叠感。teeth = 每边齿数，齿深小，保证层间无镂空 */
function jaggedPineLayer(g: CanvasRenderingContext2D, cx: number, apexY: number,
  baseY: number, halfW: number, color: string, seed: number, teeth: number): void {
  const pts: Array<[number, number]> = [[cx, apexY]];
  // 左边：apex -> base-left，轻微锯齿
  for (let i = 1; i <= teeth; i++) {
    const t = i / teeth;
    const px = cx - halfW * t, py = apexY + (baseY - apexY) * t;
    const out = (i % 2 === 1 ? 1 : -0.5) * halfW * 0.045 * (0.7 + sjit(seed, i) * 0.6);
    pts.push([px - out, py]);
  }
  pts.push([cx + halfW, baseY]);
  // 右边：base-right -> apex
  for (let i = teeth; i >= 1; i--) {
    const t = i / teeth;
    const px = cx + halfW * t, py = apexY + (baseY - apexY) * t;
    const out = (i % 2 === 1 ? 1 : -0.5) * halfW * 0.045 * (0.7 + sjit(seed, i + 50) * 0.6);
    pts.push([px + out, py]);
  }
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath(); g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, 1.2);
  g.stroke();
}

export function drawPine(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const seed = x * 0.531 + y * 0.197;
  // 根部阴影
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.beginPath(); g.ellipse(x + 2 * s, y - 2 * s, 20 * s, 6 * s, 0, 0, Math.PI * 2); g.fill();
  // 树干（插入底层冠）
  const tw = 8 * s;
  g.fillStyle = '#4a352a';
  g.fillRect(x - tw / 2, y - 38 * s, tw, 38 * s);
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.5);
  g.strokeRect(x - tw / 2, y - 38 * s, tw, 38 * s);
  g.fillStyle = '#6b4f3a';
  g.fillRect(x - tw / 2 + 1.5 * s, y - 36 * s, 2 * s, 34 * s);
  // 三层锯齿冠：下大上小，深->浅，层间重叠 40%+
  jaggedPineLayer(g, x, y - 70 * s, y - 30 * s, 28 * s, '#24402a', seed, 7);
  jaggedPineLayer(g, x, y - 88 * s, y - 52 * s, 23 * s, '#2c4530', seed + 5, 6);
  jaggedPineLayer(g, x, y - 104 * s, y - 74 * s, 17 * s, '#3d5c3e', seed + 9, 5);
  // 左上针叶高光
  g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = Math.max(1, 1.6 * s); g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x - 15 * s, y - 62 * s); g.lineTo(x - 8 * s, y - 76 * s);
  g.moveTo(x - 10 * s, y - 82 * s); g.lineTo(x - 4 * s, y - 94 * s);
  g.stroke();
}

export function drawDeadTree(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  blob(g, x + 4 * s, y - 2 * s, 6 * s, SHADOW_A);
  // 主干
  g.strokeStyle = '#4a352a'; g.lineWidth = 10 * s; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x, y); g.lineTo(x + 2 * s, y - 48 * s); g.stroke();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.4);
  g.beginPath(); g.moveTo(x - 5 * s, y); g.lineTo(x - 3 * s, y - 48 * s); g.stroke();
  g.beginPath(); g.moveTo(x + 5 * s, y); g.lineTo(x + 7 * s, y - 48 * s); g.stroke();
  // 枝桠
  g.strokeStyle = '#4a352a'; g.lineWidth = 5 * s;
  const branches: Array<[number, number, number, number]> = [
    [0, -30, -18, -48], [2, -36, 20, -54], [1, -20, -14, -32], [3, -44, 14, -62],
  ];
  for (const [x1, y1, x2, y2] of branches) {
    g.beginPath();
    g.moveTo(x + x1 * s, y + y1 * s);
    g.lineTo(x + x2 * s, y + y2 * s);
    g.stroke();
  }
  // 树干 highlight
  g.strokeStyle = '#6b4f3a'; g.lineWidth = 3 * s;
  g.beginPath(); g.moveTo(x - 2 * s, y - 4 * s); g.lineTo(x, y - 44 * s); g.stroke();
}

// ------------------------------------------------------------------ 新增建筑（扩充 v1）
// 全部遵循框架：锚点=底部中心，OUTLINE 描边，dropShadow，base/shadow/highlight。

// 商店（带招牌）：96w × 76h。石墙 + 招牌板 + 橱窗 + 条纹雨棚。
export function drawShop(g: CanvasRenderingContext2D, x: number, y: number, s: number, sign = '商店'): void {
  const W = 96 * s, H = 76 * s;
  const x0 = x - W / 2, y0 = y - H;
  dropShadow(g, x, y, W, H, s);

  // 墙体
  const wallH = 44 * s;
  g.fillStyle = '#b3a58c';
  rr(g, x0, y0 + H - wallH, W, wallH, 2 * s); g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.5);
  rr(g, x0, y0 + H - wallH, W, wallH, 2 * s); g.stroke();
  g.fillStyle = '#8f8271'; // 右下阴影
  g.fillRect(x0 + W - 10 * s, y0 + H - wallH + 2 * s, 8 * s, wallH - 4 * s);

  // 屋顶（对角巷统一深紫红，区别于霍格莫德）
  g.fillStyle = '#6e3a4a';
  g.beginPath();
  g.moveTo(x0 - 5 * s, y0 + H - wallH);
  g.lineTo(x, y0 + 4 * s);
  g.lineTo(x0 + W + 5 * s, y0 + H - wallH);
  g.closePath(); g.fill();
  g.strokeStyle = OUTLINE; g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.15)';
  g.beginPath();
  g.moveTo(x0 - 5 * s, y0 + H - wallH); g.lineTo(x, y0 + 4 * s); g.lineTo(x, y0 + H - wallH); g.closePath(); g.fill();

  // 招牌板（门上方横木牌）
  const sw = 56 * s, sh = 12 * s;
  g.fillStyle = '#7a5c44'; // 招牌板（木质 base）
  rr(g, x - sw / 2, y - 40 * s, sw, sh, 2 * s); g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.4); g.stroke();
  g.fillStyle = '#f5e9c8';
  g.font = `${Math.max(8, 9 * s)}px sans-serif`; g.textAlign = 'center';
  g.fillText(sign.slice(0, 5), x, y - 40 * s + 9 * s);

  // 橱窗（大玻璃窗，暖光）
  g.fillStyle = '#ffd98a';
  rr(g, x - W * 0.32, y - 28 * s, 22 * s, 16 * s, 2 * s); g.fill();
  g.strokeStyle = OUTLINE; g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.4)';
  g.fillRect(x - W * 0.32, y - 28 * s, 22 * s, 3 * s);
  // 橱窗内货架剪影
  g.fillStyle = 'rgba(90,60,40,0.5)';
  g.fillRect(x - W * 0.32 + 3 * s, y - 18 * s, 16 * s, 6 * s);

  // 条纹雨棚（门上）
  const aw = 30 * s, ax = x + W * 0.18;
  for (let i = 0; i < 6; i++) {
    g.fillStyle = i % 2 ? '#a03a3a' : '#f0e6d0';
    g.fillRect(ax - aw / 2 + (i * aw) / 6, y - 34 * s, aw / 6 + 1, 7 * s);
  }
  g.strokeStyle = OUTLINE; g.strokeRect(ax - aw / 2, y - 34 * s, aw, 7 * s);

  // 门
  const dw = 16 * s, dh = 28 * s;
  g.fillStyle = '#7a5c44'; // 门（木质 base）
  rr(g, x + W * 0.18 - dw / 2, y - dh, dw, dh, 3 * s); g.fill();
  g.strokeStyle = OUTLINE; g.stroke();
}

// 三把扫帚酒吧：110w × 84h。暖黄窗光 + 悬挂扫帚招牌。
export function drawPub(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const W = 110 * s, H = 84 * s;
  const x0 = x - W / 2, y0 = y - H;
  dropShadow(g, x, y, W, H, s);

  const wallH = 50 * s;
  g.fillStyle = '#8a6f52';
  rr(g, x0, y0 + H - wallH, W, wallH, 2 * s); g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.5);
  rr(g, x0, y0 + H - wallH, W, wallH, 2 * s); g.stroke();
  g.fillStyle = '#6e5741';
  g.fillRect(x0 + W - 12 * s, y0 + H - wallH + 2 * s, 10 * s, wallH - 4 * s);

  // 屋顶（深棕）
  g.fillStyle = '#5e3a2e';
  g.beginPath();
  g.moveTo(x0 - 6 * s, y0 + H - wallH);
  g.lineTo(x, y0);
  g.lineTo(x0 + W + 6 * s, y0 + H - wallH);
  g.closePath(); g.fill();
  g.strokeStyle = OUTLINE; g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.beginPath();
  g.moveTo(x0 - 6 * s, y0 + H - wallH); g.lineTo(x, y0); g.lineTo(x, y0 + H - wallH); g.closePath(); g.fill();

  // 烟囱（冒烟）
  g.fillStyle = '#6e5a50';
  g.fillRect(x + W * 0.25, y0 + 10 * s, 9 * s, 16 * s);
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.4);
  g.strokeRect(x + W * 0.25, y0 + 10 * s, 9 * s, 16 * s);
  blob(g, x + W * 0.25 + 5 * s, y0 + 4 * s, 3.5 * s, 'rgba(200,200,200,0.35)');
  blob(g, x + W * 0.25 + 8 * s, y0 - 3 * s, 4.5 * s, 'rgba(200,200,200,0.2)');

  // 暖黄窗 ×3（酒吧灯光）
  for (const wx of [x - W * 0.3, x, x + W * 0.3]) {
    g.fillStyle = '#ffca6a';
    rr(g, wx - 7 * s, y - 32 * s, 14 * s, 14 * s, 2 * s); g.fill();
    g.strokeStyle = OUTLINE; g.stroke();
    g.strokeStyle = '#7a5c44'; g.lineWidth = Math.max(1, s * 0.3); // 窗棂
    g.beginPath();
    g.moveTo(wx, y - 32 * s); g.lineTo(wx, y - 18 * s);
    g.moveTo(wx - 7 * s, y - 25 * s); g.lineTo(wx + 7 * s, y - 25 * s);
    g.stroke();
  }

  // 悬挂招牌：扫帚图案
  const sx = x - W / 2 - 10 * s, sy = y - 30 * s;
  g.strokeStyle = '#3a3230'; g.lineWidth = 3 * s;
  g.beginPath(); g.moveTo(x - W / 2, y - 38 * s); g.lineTo(sx, sy - 8 * s); g.stroke();
  g.fillStyle = '#7a5c44'; // 悬挂招牌（木质 base）
  rr(g, sx - 11 * s, sy - 8 * s, 22 * s, 16 * s, 2 * s); g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.4); g.stroke();
  // 扫帚简笔画
  g.strokeStyle = '#f5e9c8'; g.lineWidth = 2 * s;
  g.beginPath(); g.moveTo(sx - 6 * s, sy - 4 * s); g.lineTo(sx + 4 * s, sy + 2 * s); g.stroke();
  g.fillStyle = '#c9a86a';
  g.beginPath();
  g.moveTo(sx + 4 * s, sy + 2 * s); g.lineTo(sx + 9 * s, sy - 1 * s); g.lineTo(sx + 9 * s, sy + 5 * s);
  g.closePath(); g.fill();

  // 双开门
  g.fillStyle = '#5e4632';
  rr(g, x - 13 * s, y - 30 * s, 26 * s, 30 * s, 3 * s); g.fill();
  g.strokeStyle = OUTLINE; g.stroke();
  g.fillStyle = '#ffca6a'; // 门缝透光
  g.fillRect(x - s, y - 28 * s, 2 * s, 26 * s);
}

// 车站：144w × 60h。长条建筑 + 站台 + 钟。
export function drawStation(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const W = 144 * s, H = 60 * s;
  const x0 = x - W / 2, y0 = y - H;
  dropShadow(g, x, y, W + 20 * s, H, s);

  // 站台（底部延伸）
  g.fillStyle = '#9b958b';
  rr(g, x0 - 10 * s, y - 10 * s, W + 20 * s, 10 * s, 2 * s); g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.4); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = Math.max(1, s * 0.3); // 站台白线
  g.beginPath(); g.moveTo(x0 - 8 * s, y - 5 * s); g.lineTo(x0 + W + 8 * s, y - 5 * s); g.stroke();

  // 主楼
  const wallH = 36 * s;
  g.fillStyle = '#a89a80';
  rr(g, x0, y0 + H - wallH - 10 * s, W, wallH, 2 * s); g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.5);
  rr(g, x0, y0 + H - wallH - 10 * s, W, wallH, 2 * s); g.stroke();

  // 平屋顶 + 女儿墙
  g.fillStyle = '#7f7a71';
  g.fillRect(x0 - 2 * s, y0 + H - wallH - 14 * s, W + 4 * s, 6 * s);
  g.strokeStyle = OUTLINE; g.strokeRect(x0 - 2 * s, y0 + H - wallH - 14 * s, W + 4 * s, 6 * s);

  // 钟（中央）
  const cx = x, cy = y0 + H - wallH - 14 * s + 3 * s;
  g.fillStyle = '#f5f0e0';
  g.beginPath(); g.arc(cx, cy - 8 * s, 8 * s, 0, Math.PI * 2); g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.4); g.stroke();
  g.strokeStyle = '#3a3230'; g.lineWidth = Math.max(1, s * 0.4);
  g.beginPath(); g.moveTo(cx, cy - 8 * s); g.lineTo(cx, cy - 12 * s); g.stroke();
  g.beginPath(); g.moveTo(cx, cy - 8 * s); g.lineTo(cx + 4 * s, cy - 6 * s); g.stroke();

  // 拱门 ×3
  for (const ax of [x - W * 0.3, x, x + W * 0.3]) {
    g.fillStyle = '#5e4632';
    g.beginPath();
    g.arc(ax, y - 10 * s - 12 * s, 9 * s, Math.PI, 0);
    g.fillRect(ax - 9 * s, y - 10 * s - 12 * s, 18 * s, 12 * s);
    g.fill();
    g.strokeStyle = OUTLINE; g.stroke();
  }
  // 窗 ×4（小方窗）
  for (const wx of [x - W * 0.4, x - W * 0.15, x + W * 0.15, x + W * 0.4]) {
    g.fillStyle = '#3a4a5c';
    g.fillRect(wx - 4 * s, y0 + H - wallH - 6 * s, 8 * s, 8 * s);
    g.strokeStyle = OUTLINE; g.strokeRect(wx - 4 * s, y0 + H - wallH - 6 * s, 8 * s, 8 * s);
  }
}

// 图书馆：104w × 94h。石墙 + 立柱 + 台阶 + 大窗。
export function drawLibrary(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const W = 104 * s, H = 94 * s;
  const x0 = x - W / 2, y0 = y - H;
  dropShadow(g, x, y, W + 16 * s, H, s);

  // 台阶
  g.fillStyle = '#8f887c';
  for (let i = 0; i < 3; i++) {
    const sw = W + 16 * s - i * 8 * s;
    g.fillRect(x - sw / 2, y - (3 - i) * 4 * s, sw, 4 * s);
    g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.3);
    g.strokeRect(x - sw / 2, y - (3 - i) * 4 * s, sw, 4 * s);
  }
  const baseY = y - 12 * s;

  // 主墙
  const wallH = 56 * s;
  g.fillStyle = '#9b958b';
  rr(g, x0, y0 + H - wallH - 12 * s, W, wallH, 2 * s); g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.5);
  rr(g, x0, y0 + H - wallH - 12 * s, W, wallH, 2 * s); g.stroke();
  // 石缝
  g.strokeStyle = 'rgba(0,0,0,0.15)'; g.lineWidth = Math.max(1, s * 0.3);
  for (let i = 1; i < 3; i++) {
    g.beginPath();
    g.moveTo(x0 + 4 * s, y0 + H - wallH - 12 * s + (wallH / 3) * i);
    g.lineTo(x0 + W - 4 * s, y0 + H - wallH - 12 * s + (wallH / 3) * i);
    g.stroke();
  }

  // 三角楣 + 立柱
  g.fillStyle = '#8f887c';
  g.beginPath();
  g.moveTo(x0 - 4 * s, y0 + H - wallH - 12 * s);
  g.lineTo(x, y0);
  g.lineTo(x0 + W + 4 * s, y0 + H - wallH - 12 * s);
  g.closePath(); g.fill();
  g.strokeStyle = OUTLINE; g.stroke();
  for (const cx of [x - W * 0.32, x - W * 0.11, x + W * 0.11, x + W * 0.32]) {
    g.fillStyle = '#b3ada2';
    g.fillRect(cx - 5 * s, y0 + H - wallH - 10 * s, 10 * s, wallH - 4 * s);
    g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.4);
    g.strokeRect(cx - 5 * s, y0 + H - wallH - 10 * s, 10 * s, wallH - 4 * s);
    // 柱头柱础
    g.fillRect(cx - 7 * s, y0 + H - wallH - 10 * s, 14 * s, 3 * s);
    g.fillRect(cx - 7 * s, y0 + H - 18 * s, 14 * s, 3 * s);
  }

  // 大窗 ×2（柱间）
  for (const wx of [x - W * 0.215, x + W * 0.215]) {
    g.fillStyle = '#2a3444';
    rr(g, wx - 8 * s, baseY - 40 * s, 16 * s, 28 * s, 6 * s); g.fill();
    g.strokeStyle = OUTLINE; g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(wx - 8 * s, baseY - 40 * s, 16 * s, 4 * s);
  }

  // 正门（中央）
  g.fillStyle = '#4a352a';
  rr(g, x - 10 * s, baseY - 30 * s, 20 * s, 30 * s, 8 * s); g.fill();
  g.strokeStyle = OUTLINE; g.stroke();
}

// 宿舍塔楼：60w × 140h。塔楼结构 + 暖窗 + 学院色横幅。
export function drawDormTower(g: CanvasRenderingContext2D, x: number, y: number, s: number, banner = '#7a1f1f'): void {
  const W = 60 * s, H = 140 * s;
  const x0 = x - W / 2, y0 = y - H;
  dropShadow(g, x, y, W, H, s);

  // 塔身
  g.fillStyle = '#9b958b';
  rr(g, x0, y0 + 20 * s, W, H - 20 * s, 2 * s); g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.5);
  rr(g, x0, y0 + 20 * s, W, H - 20 * s, 2 * s); g.stroke();
  g.strokeStyle = 'rgba(0,0,0,0.15)'; g.lineWidth = Math.max(1, s * 0.3);
  for (let i = 1; i < 7; i++) {
    g.beginPath();
    g.moveTo(x0 + 4 * s, y0 + 20 * s + ((H - 20 * s) / 7) * i);
    g.lineTo(x0 + W - 4 * s, y0 + 20 * s + ((H - 20 * s) / 7) * i);
    g.stroke();
  }
  g.fillStyle = '#7f7a71';
  g.fillRect(x0 + W - 10 * s, y0 + 22 * s, 8 * s, H - 26 * s);

  // 城垛
  g.fillStyle = '#9b958b';
  for (let i = 0; i < 5; i++) {
    const bx = x0 + (i + 0.1) * (W / 5);
    g.fillRect(bx, y0 + 10 * s, W / 5 * 0.8, 10 * s);
  }
  g.strokeStyle = OUTLINE;
  g.strokeRect(x0, y0 + 10 * s, W, 10 * s);

  // 尖顶（学院色）
  g.fillStyle = banner;
  g.beginPath();
  g.moveTo(x0 - 3 * s, y0 + 10 * s); g.lineTo(x, y0 - 14 * s); g.lineTo(x0 + W + 3 * s, y0 + 10 * s);
  g.closePath(); g.fill();
  g.strokeStyle = OUTLINE; g.stroke();

  // 暖窗（竖排 4 个，宿舍灯光）
  for (let i = 0; i < 4; i++) {
    const wy = y0 + 36 * s + i * 24 * s;
    g.fillStyle = '#ffca6a';
    rr(g, x - 5 * s, wy, 10 * s, 14 * s, 3 * s); g.fill();
    g.strokeStyle = OUTLINE; g.stroke();
  }

  // 学院横幅
  g.fillStyle = banner;
  g.fillRect(x - 8 * s, y0 + 22 * s, 16 * s, 26 * s);
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.4);
  g.strokeRect(x - 8 * s, y0 + 22 * s, 16 * s, 26 * s);
  g.fillStyle = 'rgba(255,255,255,0.75)'; // 徽章圆
  g.beginPath(); g.arc(x, y0 + 32 * s, 4 * s, 0, Math.PI * 2); g.fill();

  // 拱门
  g.fillStyle = '#4a352a';
  g.beginPath();
  g.arc(x, y - 10 * s, 10 * s, Math.PI, 0);
  g.fillRect(x - 10 * s, y - 10 * s, 20 * s, 10 * s);
  g.fill();
  g.strokeStyle = OUTLINE; g.stroke();
}

// ------------------------------------------------------------------ 新增装饰（扩充 v1）

// 花坛：28w × 20h。土 + 5 朵花。
export function drawFlowerbed(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const W = 28 * s, H = 20 * s;
  const x0 = x - W / 2, y0 = y - H;
  g.fillStyle = 'rgba(0,0,0,0.15)';
  g.beginPath(); g.ellipse(x, y - 2 * s, W / 2, 4 * s, 0, 0, Math.PI * 2); g.fill();
  // 土
  g.fillStyle = '#5e4632';
  rr(g, x0, y0 + 8 * s, W, 12 * s, 3 * s); g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.4);
  rr(g, x0, y0 + 8 * s, W, 12 * s, 3 * s); g.stroke();
  // 花 ×5
  const cols = ['#e86a7a', '#f5d76e', '#f0e8d8', '#e86a7a', '#b48ae0'];
  for (let i = 0; i < 5; i++) {
    const fx = x0 + (6 + i * 5.5) * s, fy = y0 + (4 + (i % 2) * 3) * s;
    g.strokeStyle = '#3d5c3e'; g.lineWidth = Math.max(1, s * 0.5);
    g.beginPath(); g.moveTo(fx, fy + 6 * s); g.lineTo(fx, fy); g.stroke();
    blob(g, fx, fy, 2.6 * s, cols[i]!);
    blob(g, fx - 1 * s, fy - 1 * s, 1.2 * s, 'rgba(255,255,255,0.28)');
  }
}

// 长椅：28w × 14h。座板 + 靠背 + 腿。
export function drawBench(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const W = 28 * s;
  const x0 = x - W / 2;
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.beginPath(); g.ellipse(x, y - 1 * s, W / 2, 3 * s, 0, 0, Math.PI * 2); g.fill();
  // 腿
  g.fillStyle = '#5e4632';
  for (const lx of [x0 + 4 * s, x0 + W - 4 * s]) {
    g.fillRect(lx - 2 * s, y - 10 * s, 4 * s, 10 * s);
    g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.3);
    g.strokeRect(lx - 2 * s, y - 10 * s, 4 * s, 10 * s);
  }
  // 座板
  g.fillStyle = '#7a5c44';
  rr(g, x0, y - 14 * s, W, 5 * s, 2 * s); g.fill();
  g.strokeStyle = OUTLINE; g.stroke();
  g.fillStyle = '#8f6f52'; // highlight
  g.fillRect(x0 + 1 * s, y - 14 * s, W - 2 * s, 1.5 * s);
  // 靠背
  g.fillStyle = '#7a5c44';
  rr(g, x0, y - 24 * s, W, 5 * s, 2 * s); g.fill();
  g.strokeStyle = OUTLINE; g.stroke();
  // 靠背立柱
  g.fillStyle = '#5e4632';
  for (const lx of [x0 + 4 * s, x0 + W - 4 * s]) {
    g.fillRect(lx - 1.5 * s, y - 24 * s, 3 * s, 12 * s);
  }
}

// 稻草人：16w × 44h。杆 + 横杆 + 头 + 草。
export function drawScarecrow(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  blob(g, x + 3 * s, y, 7 * s, SHADOW_A);
  // 杆（木质 base，左上 highlight）
  g.strokeStyle = '#7a5c44'; g.lineWidth = 5 * s; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 40 * s); g.stroke();
  g.strokeStyle = '#8f6f52'; g.lineWidth = 2 * s;
  g.beginPath(); g.moveTo(x - 1.5 * s, y - 2 * s); g.lineTo(x - 1.5 * s, y - 38 * s); g.stroke();
  // 横杆（手臂）
  g.strokeStyle = '#7a5c44'; g.lineWidth = 4 * s;
  g.beginPath(); g.moveTo(x - 12 * s, y - 28 * s); g.lineTo(x + 12 * s, y - 28 * s); g.stroke();
  // 草（手臂上）
  g.strokeStyle = '#c9a86a'; g.lineWidth = 2 * s;
  for (const [hx, dir] of [[-12, -1], [12, 1]] as const) {
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.moveTo(x + hx * s, y - 28 * s);
      g.lineTo(x + (hx + dir * (4 + i * 2)) * s, y - (26 + i) * s);
      g.stroke();
    }
  }
  // 头（南瓜）
  blob(g, x, y - 44 * s, 7 * s, '#d08030');
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.4);
  g.beginPath(); g.arc(x, y - 44 * s, 7 * s, 0, Math.PI * 2); g.stroke();
  // 脸（三角眼+锯齿嘴）
  g.fillStyle = '#3a2a1a';
  g.beginPath();
  g.moveTo(x - 4 * s, y - 46 * s); g.lineTo(x - 2 * s, y - 43 * s); g.lineTo(x - 6 * s, y - 43 * s);
  g.closePath(); g.fill();
  g.beginPath();
  g.moveTo(x + 4 * s, y - 46 * s); g.lineTo(x + 6 * s, y - 43 * s); g.lineTo(x + 2 * s, y - 43 * s);
  g.closePath(); g.fill();
  g.fillRect(x - 4 * s, y - 40 * s, 8 * s, 1.5 * s);
  // 草帽
  g.fillStyle = '#a08448';
  g.beginPath(); g.ellipse(x, y - 50 * s, 10 * s, 3 * s, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = OUTLINE; g.stroke();
}

// 蜂箱：16w × 24h。三层叠箱。
export function drawBeehive(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  blob(g, x + 2 * s, y, 8 * s, SHADOW_A);
  // 三层叠箱（木质家族：base #7a5c44 / shadow #5e4632 / highlight #8f6f52）
  for (let i = 0; i < 3; i++) {
    const bw = (16 - i * 1.5) * s, bh = 7 * s;
    const bx = x - bw / 2, by = y - (i + 1) * bh;
    g.fillStyle = '#7a5c44';
    rr(g, bx, by, bw, bh + 1, 2 * s); g.fill();
    g.fillStyle = '#8f6f52'; // 顶部 highlight
    g.fillRect(bx + 1 * s, by + 1 * s, bw - 2 * s, 1.5 * s);
    g.fillStyle = '#5e4632'; // 底部 shadow
    g.fillRect(bx + 1 * s, by + bh - 1.5 * s, bw - 2 * s, 1.5 * s);
    g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.35);
    rr(g, bx, by, bw, bh + 1, 2 * s); g.stroke();
  }
  // 顶盖
  g.fillStyle = '#8f6f52';
  g.beginPath(); g.ellipse(x, y - 22 * s, 9 * s, 3 * s, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = OUTLINE; g.stroke();
  // 蜜蜂（两点 + 翅）
  for (const [bx, by] of [[-6, -26], [7, -20]] as const) {
    blob(g, x + bx * s, y + by * s, 1.6 * s, '#3a2a1a');
    blob(g, x + bx * s - 1 * s, y + (by - 2) * s, 1 * s, 'rgba(255,255,255,0.7)');
  }
  // 入口
  g.fillStyle = '#3a2a1a';
  g.fillRect(x - 3 * s, y - 5 * s, 6 * s, 3 * s);
}

// 秋千：36w × 44h。A 架 + 绳 + 座。
export function drawSwing(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  blob(g, x, y, 16 * s, SHADOW_A);
  // A 架（两侧，木质 base）
  g.strokeStyle = '#7a5c44'; g.lineWidth = 4 * s; g.lineCap = 'round';
  for (const dir of [-1, 1] as const) {
    g.beginPath();
    g.moveTo(x + dir * 14 * s, y);
    g.lineTo(x + dir * 8 * s, y - 40 * s);
    g.stroke();
    g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.3);
    g.beginPath();
    g.moveTo(x + dir * 14 * s - 2 * s, y);
    g.lineTo(x + dir * 8 * s - 2 * s, y - 40 * s);
    g.stroke();
    g.strokeStyle = '#7a5c44'; g.lineWidth = 4 * s;
  }
  // 横梁（木质 base）
  g.strokeStyle = '#7a5c44'; g.lineWidth = 4 * s;
  g.beginPath(); g.moveTo(x - 10 * s, y - 40 * s); g.lineTo(x + 10 * s, y - 40 * s); g.stroke();
  // 绳 ×2
  g.strokeStyle = '#8a7a5e'; g.lineWidth = Math.max(1, 1.6 * s);
  for (const rx of [-6, 6]) {
    g.beginPath();
    g.moveTo(x + rx * s, y - 40 * s);
    g.lineTo(x + rx * s, y - 16 * s);
    g.stroke();
  }
  // 座板
  g.fillStyle = '#7a5c44';
  rr(g, x - 9 * s, y - 16 * s, 18 * s, 4 * s, 1.5 * s); g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.35); g.stroke();
}

// ------------------------------------------------------------------ 道具
export function drawBush(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  // 灌木：不规则叶丛轮廓（8 顶点 seed 扰动，≥3 处凹凸），三层绿 #6a9463 家族。
  const seed = x * 0.413 + y * 0.719;
  const R = 11 * s;
  const cy = y - 8 * s;
  // 地面阴影
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.beginPath(); g.ellipse(x + 2 * s, y - 1 * s, 13 * s, 4 * s, 0, 0, Math.PI * 2); g.fill();
  // base：不规则多边形轮廓
  g.beginPath();
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const k = 0.78 + sjit(seed, i) * 0.45; // 半径扰动形成凹凸
    const px = x + Math.cos(a) * R * k;
    const py = cy + Math.sin(a) * R * k * 0.62;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath();
  g.fillStyle = '#6a9463'; g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.35); g.stroke();
  // shadow：右下（混黑 25% #506f4a）
  g.save();
  g.clip();
  g.fillStyle = '#506f4a';
  g.beginPath(); g.ellipse(x + 5 * s, cy + 4 * s, 9 * s, 5 * s, 0.4, 0, Math.PI * 2); g.fill();
  // highlight：左上（混白 20% #749e6d）
  g.fillStyle = '#749e6d';
  g.beginPath(); g.ellipse(x - 5 * s, cy - 4 * s, 7 * s, 4 * s, -0.4, 0, Math.PI * 2); g.fill();
  g.restore();
  // 叶面光斑（左上）
  blob(g, x - 6 * s, cy - 5 * s, 1.8 * s, 'rgba(255,255,255,0.14)');
  blob(g, x - 2 * s, cy - 7 * s, 1.4 * s, 'rgba(255,255,255,0.10)');
}

export type StoneVariant = 'moss' | 'rune' | 'curb';
export function drawStone(g: CanvasRenderingContext2D, x: number, y: number, s: number, variant?: StoneVariant): void {
  // 石头：不规则 6 顶点多边形，三层石灰 #9b958b 家族。
  // variant: moss=边界石（苔藓）/ rune=石阵（符文刻痕）/ curb=路缘石（小而扁）
  const seed = x * 0.617 + y * 0.233;
  const flat = variant === 'curb' ? 0.55 : 1; // 路缘石压扁
  blob(g, x + 2 * s, y, 6 * s * flat, SHADOW_A);
  g.beginPath();
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const k = 0.72 + sjit(seed, i) * 0.55; // 半径扰动形成凹凸
    const px = x + Math.cos(a) * 7 * s * k;
    const py = y - 4 * s * flat + Math.sin(a) * 4.5 * s * k * flat;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath();
  g.fillStyle = '#9b958b'; g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.4); g.stroke();
  // 三层：左上 highlight（混白 20% #afa99f）/ 右下 shadow（混黑 25% #747068）
  g.save();
  g.clip();
  g.fillStyle = '#747068';
  g.beginPath(); g.ellipse(x + 3.5 * s, y - 2 * s * flat, 5 * s, 3.5 * s * flat, 0.4, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#afa99f';
  g.beginPath(); g.ellipse(x - 3 * s, y - 6 * s * flat, 4 * s, 2.5 * s * flat, -0.4, 0, Math.PI * 2); g.fill();
  // moss：左上苔藓斑（#5a7a4a）
  if (variant === 'moss') {
    g.fillStyle = '#5a7a4a';
    g.beginPath(); g.ellipse(x - 2 * s, y - 6.5 * s * flat, 3.2 * s, 1.8 * s * flat, -0.3, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(x + 2.5 * s, y - 5 * s * flat, 2 * s, 1.2 * s * flat, 0.5, 0, Math.PI * 2); g.fill();
  }
  // rune：符文刻痕（暖金 #d4a017，2 划）
  if (variant === 'rune') {
    g.strokeStyle = '#d4a017'; g.lineWidth = Math.max(1, s * 0.35);
    g.beginPath();
    g.moveTo(x - 2.5 * s, y - 6 * s); g.lineTo(x + 0.5 * s, y - 3 * s); g.lineTo(x - 1.5 * s, y - 1.5 * s);
    g.moveTo(x + 1.5 * s, y - 6.5 * s); g.lineTo(x + 3 * s, y - 3.5 * s);
    g.stroke();
  }
  g.restore();
}

export function drawLamp(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  blob(g, x + 2 * s, y, 4 * s, SHADOW_A);
  // 铁质杆：base #3a3230 / shadow #26211f / highlight #52484a
  g.fillStyle = '#3a3230';
  g.fillRect(x - 3 * s, y - 36 * s, 6 * s, 36 * s);
  g.fillStyle = '#52484a'; // 左上光源 highlight
  g.fillRect(x - 3 * s, y - 36 * s, 2 * s, 36 * s);
  g.fillStyle = '#26211f'; // 右侧 shadow
  g.fillRect(x + 1.5 * s, y - 36 * s, 1.5 * s, 36 * s);
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.3);
  g.strokeRect(x - 3 * s, y - 36 * s, 6 * s, 36 * s);
  // 底座
  g.fillStyle = '#3a3230';
  g.fillRect(x - 5 * s, y - 4 * s, 10 * s, 4 * s);
  g.fillStyle = '#52484a';
  g.fillRect(x - 5 * s, y - 4 * s, 10 * s, 1.5 * s);
  g.strokeStyle = OUTLINE;
  g.strokeRect(x - 5 * s, y - 4 * s, 10 * s, 4 * s);
  // 灯头（铁罩 + 暖光玻璃）
  g.fillStyle = '#3a3230';
  rr(g, x - 6 * s, y - 50 * s, 12 * s, 14 * s, 2 * s); g.fill();
  g.strokeStyle = OUTLINE; g.stroke();
  g.fillStyle = '#ffd98a'; // 暖光灯罩
  rr(g, x - 3.5 * s, y - 46 * s, 7 * s, 8 * s, 1.5 * s); g.fill();
  g.fillStyle = 'rgba(255,240,200,0.85)'; // 左上高光
  g.fillRect(x - 3.5 * s, y - 46 * s, 7 * s, 2 * s);
  // 顶盖
  g.fillStyle = '#26211f';
  g.beginPath();
  g.moveTo(x - 7 * s, y - 50 * s); g.lineTo(x, y - 56 * s); g.lineTo(x + 7 * s, y - 50 * s);
  g.closePath(); g.fill();
  g.strokeStyle = OUTLINE; g.stroke();
  // 微光晕
  g.fillStyle = 'rgba(255,217,138,0.12)';
  g.beginPath(); g.arc(x, y - 42 * s, 12 * s, 0, Math.PI * 2); g.fill();
}

// 火盆：24w × 32h。铁质三脚架 + 火盆 + 火焰三层。lit=true 为传说级点燃状态（金色光晕）。
export function drawBrazier(g: CanvasRenderingContext2D, x: number, y: number, s: number, lit = false): void {
  blob(g, x + 2 * s, y, 8 * s, SHADOW_A);
  // 三脚架（铁质）
  g.strokeStyle = '#3a3230'; g.lineWidth = 3 * s; g.lineCap = 'round';
  for (const dx of [-7, 0, 7]) {
    g.beginPath();
    g.moveTo(x + dx * s, y);
    g.lineTo(x + (dx / 2) * s, y - 20 * s);
    g.stroke();
  }
  g.strokeStyle = '#52484a'; g.lineWidth = Math.max(1, 1.2 * s);
  g.beginPath();
  g.moveTo(x - 7 * s, y - 2 * s); g.lineTo(x - 3.5 * s, y - 20 * s);
  g.stroke();
  // 盆（铁碗）
  g.fillStyle = '#3a3230';
  g.beginPath();
  g.moveTo(x - 11 * s, y - 20 * s);
  g.lineTo(x + 11 * s, y - 20 * s);
  g.lineTo(x + 7 * s, y - 13 * s);
  g.lineTo(x - 7 * s, y - 13 * s);
  g.closePath(); g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.4); g.stroke();
  g.fillStyle = '#52484a'; // 盆沿 highlight
  g.fillRect(x - 11 * s, y - 20 * s, 22 * s, 2 * s);
  // 火焰三层
  blob(g, x, y - 27 * s, 6 * s, '#e85d2a');
  blob(g, x, y - 28 * s, 4 * s, '#f0a03a');
  blob(g, x, y - 29 * s, 2.5 * s, '#ffd98a');
  if (lit) {
    // 传说级点燃：金色呼吸光晕
    g.fillStyle = 'rgba(212,160,23,0.22)';
    g.beginPath(); g.arc(x, y - 27 * s, 18 * s, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#d4a017'; g.lineWidth = Math.max(1, s * 0.4);
    g.beginPath(); g.arc(x, y - 27 * s, 18 * s, 0, Math.PI * 2); g.stroke();
  }
}

export function drawFence(g: CanvasRenderingContext2D, x: number, y: number, s: number, len = 1): void {
  // len = 节数，每节 24w
  const W = 24 * s * len, H = 16 * s;
  const x0 = x - W / 2;
  for (let i = 0; i <= len * 2; i++) {
    const px = x0 + (i * W) / (len * 2);
    g.fillStyle = '#7a5c44'; // 木质 base
    g.fillRect(px - 2 * s, y - H, 4 * s, H);
    g.fillStyle = '#8f6f52'; // 左上 highlight
    g.fillRect(px - 2 * s, y - H, 1.5 * s, H);
    g.fillStyle = '#5e4632'; // 右侧 shadow
    g.fillRect(px + 0.5 * s, y - H, 1.5 * s, H);
    g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.3);
    g.strokeRect(px - 2 * s, y - H, 4 * s, H);
  }
  // 横杆 ×2
  g.fillStyle = '#7a5c44';
  for (const hy of [y - H + 3 * s, y - 5 * s]) {
    g.fillRect(x0, hy, W, 3 * s);
    g.strokeStyle = OUTLINE;
    g.strokeRect(x0, hy, W, 3 * s);
  }
  g.fillStyle = '#8f6f52'; // 横杆上沿 highlight
  g.fillRect(x0, y - H + 3 * s, W, 1.5 * s);
  g.fillRect(x0, y - 5 * s, W, 1.5 * s);
}

export function drawChest(g: CanvasRenderingContext2D, x: number, y: number, s: number, grade: 'common' | 'rare' | 'legend' = 'common'): void {
  // 宝箱 20w × 14h。分级描边：普通铜色 / 稀有银色 #c0c8d0 / 传说金色 #d4a017 + 光晕。
  const trim = grade === 'legend' ? '#d4a017' : grade === 'rare' ? '#c0c8d0' : '#a06a3f';
  const W = 20 * s, H = 14 * s;
  const x0 = x - W / 2, y0 = y - H;
  if (grade === 'legend') {
    g.fillStyle = 'rgba(212,160,23,0.20)';
    g.beginPath(); g.arc(x, y - 7 * s, 18 * s, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(212,160,23,0.55)'; g.lineWidth = Math.max(1, s * 0.35);
    g.beginPath(); g.arc(x, y - 7 * s, 18 * s, 0, Math.PI * 2); g.stroke();
  } else if (grade === 'rare') {
    g.fillStyle = 'rgba(192,200,208,0.12)';
    g.beginPath(); g.arc(x, y - 7 * s, 14 * s, 0, Math.PI * 2); g.fill();
  }
  blob(g, x + 2 * s, y, W / 2, SHADOW_A);
  // 箱体
  const outline = grade === 'common' ? OUTLINE : trim;
  g.fillStyle = '#6b4f3a';
  rr(g, x0, y0, W, H, 2 * s); g.fill();
  g.strokeStyle = outline; g.lineWidth = Math.max(1, s * 0.6);
  rr(g, x0, y0, W, H, 2 * s); g.stroke();
  // 箱盖
  g.fillStyle = '#7a5c44';
  rr(g, x0, y0, W, 6 * s, 2 * s); g.fill();
  g.strokeStyle = outline; g.stroke();
  // 金属包边（分级色）
  g.fillStyle = trim;
  g.fillRect(x0, y0 + 5 * s, W, 2 * s);
  g.fillRect(x - s, y0, 2 * s, H);
  // 锁
  g.fillStyle = trim;
  blob(g, x, y0 + 6 * s, 2.5 * s, trim);
  g.strokeStyle = outline; g.stroke();
}

// ------------------------------------------------------------------ 新地区组件 v2
// 水井：32w × 28h。村广场中心。
export function drawWell(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const W = 32 * s, H = 28 * s;
  dropShadow(g, x, y, W, H, s);
  // 井台（石砌圆环）
  g.fillStyle = '#9b958b';
  g.beginPath(); g.ellipse(x, y - 8 * s, W / 2, H / 2, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.5); g.stroke();
  // 井口（黑）
  g.fillStyle = '#1a1a1a';
  g.beginPath(); g.ellipse(x, y - 8 * s, W / 3, H / 3, 0, 0, Math.PI * 2); g.fill();
  // 井架（木质家族：shadow #5e4632）
  g.fillStyle = '#5e4632';
  g.fillRect(x - 14 * s, y - 28 * s, 4 * s, 22 * s);
  g.fillRect(x + 10 * s, y - 28 * s, 4 * s, 22 * s);
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.4);
  g.strokeRect(x - 14 * s, y - 28 * s, 4 * s, 22 * s);
  g.strokeRect(x + 10 * s, y - 28 * s, 4 * s, 22 * s);
  // 横梁（base #7a5c44）+小屋顶
  g.fillStyle = '#7a5c44';
  g.fillRect(x - 16 * s, y - 30 * s, 32 * s, 4 * s);
  g.fillStyle = ROOF_VILLAGE;
  g.beginPath();
  g.moveTo(x - 18 * s, y - 30 * s); g.lineTo(x, y - 40 * s); g.lineTo(x + 18 * s, y - 30 * s);
  g.closePath(); g.fill();
  g.strokeStyle = OUTLINE; g.stroke();
  // 绳+水桶
  g.strokeStyle = '#5e4632'; g.lineWidth = Math.max(1, s * 0.3);
  g.beginPath(); g.moveTo(x, y - 30 * s); g.lineTo(x, y - 18 * s); g.stroke();
  g.fillStyle = '#8f6f52'; // 水桶 highlight 木
  g.fillRect(x - 3 * s, y - 18 * s, 6 * s, 6 * s);
  g.strokeStyle = OUTLINE; g.strokeRect(x - 3 * s, y - 18 * s, 6 * s, 6 * s);
}

// 集市摊位：40w × 36h。遮阳棚+货台。
export function drawMarketStall(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const W = 40 * s, H = 36 * s;
  dropShadow(g, x, y, W, H, s);
  // 货台
  g.fillStyle = '#7a5c44';
  rr(g, x - W / 2, y - 14 * s, W, 14 * s, 2 * s); g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.4);
  rr(g, x - W / 2, y - 14 * s, W, 14 * s, 2 * s); g.stroke();
  // 货物（彩色圆点）
  const goods = ['#d44d4d', '#e8a33d', '#5a8c3d', '#4a7ab5'];
  for (let i = 0; i < 4; i++) {
    blob(g, x - 12 * s + i * 8 * s, y - 16 * s, 3 * s, goods[i]);
  }
  // 支柱（木质 shadow）
  g.fillStyle = '#5e4632';
  for (const px of [x - W / 2 + 3 * s, x + W / 2 - 3 * s]) {
    g.fillRect(px - 2 * s, y - 36 * s, 4 * s, 24 * s);
    g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.3);
    g.strokeRect(px - 2 * s, y - 36 * s, 4 * s, 24 * s);
  }
  // 条纹遮阳棚
  for (let i = 0; i < 5; i++) {
    g.fillStyle = i % 2 ? '#c94f4f' : '#f0e8d8';
    const sx = x - W / 2 - 2 * s + (i * (W + 4 * s)) / 5;
    g.fillRect(sx, y - 40 * s, (W + 4 * s) / 5, 6 * s);
  }
  g.strokeStyle = OUTLINE;
  g.strokeRect(x - W / 2 - 2 * s, y - 40 * s, W + 4 * s, 6 * s);
  // 棚顶三角
  g.fillStyle = '#c94f4f';
  g.beginPath();
  g.moveTo(x - W / 2 - 2 * s, y - 40 * s); g.lineTo(x, y - 48 * s); g.lineTo(x + W / 2 + 2 * s, y - 40 * s);
  g.closePath(); g.fill();
  g.strokeStyle = OUTLINE; g.stroke();
}

// 村门牌坊：48w × 44h。霍格莫德村口。
export function drawVillageGate(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const W = 48 * s, H = 44 * s;
  dropShadow(g, x, y, W, H, s);
  // 双柱
  for (const px of [x - 20 * s, x + 20 * s]) {
    g.fillStyle = '#9b958b';
    g.fillRect(px - 4 * s, y - 36 * s, 8 * s, 36 * s);
    g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.4);
    g.strokeRect(px - 4 * s, y - 36 * s, 8 * s, 36 * s);
    // 柱顶球
    blob(g, px, y - 38 * s, 5 * s, '#7f7a71');
    g.strokeStyle = OUTLINE;
    g.beginPath(); g.arc(px, y - 38 * s, 5 * s, 0, Math.PI * 2); g.stroke();
  }
  // 横梁+挂牌（木质 base）
  g.fillStyle = '#7a5c44';
  g.fillRect(x - 26 * s, y - 44 * s, 52 * s, 8 * s);
  g.fillStyle = '#8f6f52'; // 上沿 highlight
  g.fillRect(x - 26 * s, y - 44 * s, 52 * s, 2 * s);
  g.fillStyle = '#5e4632'; // 下沿 shadow
  g.fillRect(x - 26 * s, y - 38 * s, 52 * s, 2 * s);
  g.strokeStyle = OUTLINE; g.strokeRect(x - 26 * s, y - 44 * s, 52 * s, 8 * s);
  // 铁质箍（梁柱连接处）
  for (const px of [x - 20 * s, x + 20 * s]) {
    g.fillStyle = '#3a3230';
    g.fillRect(px - 4 * s, y - 44 * s, 8 * s, 8 * s);
    g.fillStyle = '#52484a';
    g.fillRect(px - 4 * s, y - 44 * s, 8 * s, 2 * s);
    g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.3);
    g.strokeRect(px - 4 * s, y - 44 * s, 8 * s, 8 * s);
  }
  // 小屋顶
  g.fillStyle = ROOF_VILLAGE;
  g.beginPath();
  g.moveTo(x - 28 * s, y - 44 * s); g.lineTo(x, y - 54 * s); g.lineTo(x + 28 * s, y - 44 * s);
  g.closePath(); g.fill();
  g.strokeStyle = OUTLINE; g.stroke();
}

// 木码头：16w × 64h（一段）。木板+桩。
export function drawDock(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const W = 16 * s, H = 64 * s;
  // 木桩（4 根，木质 shadow #5e4632）
  g.fillStyle = '#5e4632';
  for (const [px, py] of [[-6, -28], [6, -28], [-6, 28], [6, 28]] as Array<[number, number]>) {
    g.fillRect(x + px * s - 2 * s, y + py * s - 8 * s, 4 * s, 16 * s);
  }
  // 甲板
  g.fillStyle = '#7a5c44';
  rr(g, x - W / 2, y - H / 2, W, H, 2 * s); g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.4);
  rr(g, x - W / 2, y - H / 2, W, H, 2 * s); g.stroke();
  // 木板缝
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = Math.max(1, s * 0.3);
  for (let i = 1; i < 8; i++) {
    g.beginPath();
    g.moveTo(x - W / 2 + 2 * s, y - H / 2 + (H / 8) * i);
    g.lineTo(x + W / 2 - 2 * s, y - H / 2 + (H / 8) * i);
    g.stroke();
  }
  // 边缘 highlight
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.fillRect(x - W / 2, y - H / 2, 3 * s, H);
}

// 系船柱：8w × 20h
export function drawMooringPost(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  // 系船柱：8w × 20h。木质家族。
  blob(g, x + 2 * s, y, 5 * s, SHADOW_A);
  g.fillStyle = '#7a5c44';
  rr(g, x - 4 * s, y - 20 * s, 8 * s, 20 * s, 2 * s); g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.4);
  rr(g, x - 4 * s, y - 20 * s, 8 * s, 20 * s, 2 * s); g.stroke();
  // 左侧 highlight / 右侧 shadow
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.fillRect(x - 4 * s, y - 18 * s, 2 * s, 16 * s);
  g.fillStyle = 'rgba(0,0,0,0.20)';
  g.fillRect(x + 2 * s, y - 18 * s, 2 * s, 16 * s);
  g.fillStyle = '#8f6f52';
  blob(g, x, y - 20 * s, 4 * s, '#8f6f52');
  g.strokeStyle = OUTLINE;
  g.beginPath(); g.arc(x, y - 20 * s, 4 * s, 0, Math.PI * 2); g.stroke();
  // 绳圈
  g.strokeStyle = '#8a7368'; g.lineWidth = Math.max(1, s * 0.3);
  g.beginPath(); g.arc(x, y - 12 * s, 5 * s, 0, Math.PI * 2); g.stroke();
}

// 小船：36w × 18h。俯视船体。
export function drawBoat(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const W = 36 * s, H = 18 * s;
  // 船影（水面）
  g.fillStyle = 'rgba(0,0,0,0.2)';
  g.beginPath(); g.ellipse(x + 2 * s, y, W / 2, H / 2, 0, 0, Math.PI * 2); g.fill();
  // 船体（base #7a5c44）
  g.fillStyle = '#7a5c44';
  g.beginPath(); g.ellipse(x, y - 2 * s, W / 2, H / 2, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.5); g.stroke();
  // 船舱（shadow #5e4632）
  g.fillStyle = '#5e4632';
  g.beginPath(); g.ellipse(x, y - 2 * s, W / 4, H / 4, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.3); g.stroke();
  // 船沿 highlight（#8f6f52）
  g.strokeStyle = '#8f6f52'; g.lineWidth = Math.max(1, s * 0.3);
  g.beginPath(); g.ellipse(x, y - 2 * s, W / 2 - 2 * s, H / 2 - 2 * s, 0, Math.PI * 1.2, Math.PI * 1.8); g.stroke();
}

// 小灯塔：24w × 72h。黑湖码头标志。
export function drawLighthouse(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const W = 24 * s, H = 72 * s;
  const x0 = x - W / 2, y0 = y - H;
  dropShadow(g, x, y, W, H, s);
  // 塔身（红白条纹）
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 ? '#c94f4f' : '#f0e8d8';
    const sy = y0 + (i * H) / 4;
    g.fillRect(x0, sy, W, H / 4 + 1);
  }
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.5);
  g.strokeRect(x0, y0, W, H);
  // 灯室
  g.fillStyle = '#3a3230';
  rr(g, x - 8 * s, y0 - 14 * s, 16 * s, 14 * s, 2 * s); g.fill();
  g.strokeStyle = OUTLINE; g.stroke();
  g.fillStyle = '#ffd98a';
  blob(g, x, y0 - 7 * s, 4 * s, '#ffd98a');
  // 顶盖
  g.fillStyle = '#3a3230';
  g.beginPath();
  g.moveTo(x - 10 * s, y0 - 14 * s); g.lineTo(x, y0 - 24 * s); g.lineTo(x + 10 * s, y0 - 14 * s);
  g.closePath(); g.fill();
  g.strokeStyle = OUTLINE; g.stroke();
  // 光晕
  g.fillStyle = 'rgba(255,217,138,0.15)';
  g.beginPath(); g.arc(x, y0 - 7 * s, 20 * s, 0, Math.PI * 2); g.fill();
}

// 蜘蛛网：48w × 48h。挂在树间。
export function drawWeb(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  // 蜘蛛网：48w × 48h。挂在树间。统一 #c8ccd4 半透明。
  const R = 24 * s;
  g.strokeStyle = 'rgba(200,204,212,0.6)'; g.lineWidth = Math.max(1, s * 0.3);
  // 放射线
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    g.beginPath();
    g.moveTo(x, y - 24 * s);
    g.lineTo(x + Math.cos(a) * R, y - 24 * s + Math.sin(a) * R);
    g.stroke();
  }
  // 螺旋线
  for (let r = 6; r <= 24; r += 6) {
    g.beginPath();
    for (let i = 0; i <= 8; i++) {
      const a = (i * Math.PI) / 4;
      const px = x + Math.cos(a) * r * s, py = y - 24 * s + Math.sin(a) * r * s;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath(); g.stroke();
  }
  // 中心蜘蛛剪影
  blob(g, x, y - 24 * s, 3 * s, '#1a1a1a');
}

// 发光花：12w × 16h。独角兽空地。
export function drawGlowFlower(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  // 发光花：12w × 16h。独角兽空地。稀有标识：银色描边 + 微光点。
  // 光晕
  g.fillStyle = 'rgba(180,220,255,0.25)';
  g.beginPath(); g.arc(x, y - 8 * s, 10 * s, 0, Math.PI * 2); g.fill();
  // 茎
  g.strokeStyle = '#3d5c3e'; g.lineWidth = Math.max(1, s * 0.4);
  g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 10 * s); g.stroke();
  // 花瓣
  g.fillStyle = '#b8d4f0';
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    blob(g, x + Math.cos(a) * 4 * s, y - 12 * s + Math.sin(a) * 4 * s, 2.5 * s, '#b8d4f0');
  }
  blob(g, x, y - 12 * s, 2 * s, '#f0f0ff');
  // 银色描边（稀有）
  g.strokeStyle = '#c0c8d0'; g.lineWidth = Math.max(1, s * 0.4);
  g.beginPath(); g.arc(x, y - 12 * s, 6 * s, 0, Math.PI * 2); g.stroke();
  // 微光点（3 粒）
  blob(g, x - 6 * s, y - 14 * s, 1.2 * s, 'rgba(220,240,255,0.9)');
  blob(g, x + 7 * s, y - 10 * s, 1 * s, 'rgba(220,240,255,0.7)');
  blob(g, x + 2 * s, y - 18 * s, 0.9 * s, 'rgba(220,240,255,0.8)');
}

// 马人帐篷：48w × 40h。圆锥帐篷。
export function drawTent(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const W = 48 * s, H = 40 * s;
  dropShadow(g, x, y, W, H, s);
  // 帐篷体
  g.fillStyle = '#a08c6a';
  g.beginPath();
  g.moveTo(x - W / 2, y);
  g.lineTo(x, y - H);
  g.lineTo(x + W / 2, y);
  g.closePath(); g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.5); g.stroke();
  // 左 highlight / 右 shadow
  g.fillStyle = 'rgba(255,255,255,0.15)';
  g.beginPath();
  g.moveTo(x - W / 2, y); g.lineTo(x, y - H); g.lineTo(x, y); g.closePath(); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.beginPath();
  g.moveTo(x, y - H); g.lineTo(x + W / 2, y); g.lineTo(x, y); g.closePath(); g.fill();
  // 入口
  g.fillStyle = '#3a2e1f';
  g.beginPath();
  g.moveTo(x - 8 * s, y); g.lineTo(x, y - 20 * s); g.lineTo(x + 8 * s, y);
  g.closePath(); g.fill();
  // 顶部饰带
  g.fillStyle = '#7a3b2e';
  blob(g, x, y - H, 3 * s, '#7a3b2e');
  g.strokeStyle = OUTLINE;
  g.beginPath(); g.arc(x, y - H, 3 * s, 0, Math.PI * 2); g.stroke();
}

// 篝火：20w × 20h。马人营地中心。
export function drawCampfire(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  // 石头圈（石灰 #9b958b，8 块）
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const sx = x + Math.cos(a) * 8 * s, sy = y - 2 * s + Math.sin(a) * 3 * s;
    blob(g, sx, sy, 2.5 * s, '#9b958b');
    g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.25);
    g.beginPath(); g.arc(sx, sy, 2.5 * s, 0, Math.PI * 2); g.stroke();
  }
  // 木柴
  g.strokeStyle = '#5e4632'; g.lineWidth = 4 * s; g.lineCap = 'round';
  for (const [x1, y1, x2, y2] of [[-6, 0, 6, -4], [6, 0, -6, -4], [0, 2, 0, -6]] as Array<[number, number, number, number]>) {
    g.beginPath();
    g.moveTo(x + x1 * s, y + y1 * s); g.lineTo(x + x2 * s, y + y2 * s);
    g.stroke();
  }
  // 火焰三层：外 #c94f28 / 中 #e86a3a / 芯 #f5b86e
  blob(g, x, y - 7 * s, 6 * s, '#c94f28');
  blob(g, x, y - 9 * s, 4 * s, '#e86a3a');
  blob(g, x, y - 10 * s, 2.5 * s, '#f5b86e');
  // 火光
  g.fillStyle = 'rgba(255,180,80,0.12)';
  g.beginPath(); g.arc(x, y - 8 * s, 16 * s, 0, Math.PI * 2); g.fill();
}

// 玻璃温室：80w × 56h。草药课。
export function drawGreenhouse(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const W = 80 * s, H = 56 * s;
  const x0 = x - W / 2, y0 = y - H;
  dropShadow(g, x, y, W, H, s);
  // 基座
  g.fillStyle = '#9b958b';
  rr(g, x0, y - 16 * s, W, 16 * s, 2 * s); g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.5);
  rr(g, x0, y - 16 * s, W, 16 * s, 2 * s); g.stroke();
  // 玻璃墙
  g.fillStyle = 'rgba(180,220,230,0.45)';
  rr(g, x0 + 2 * s, y0 + 20 * s, W - 4 * s, H - 36 * s, 2 * s); g.fill();
  g.strokeStyle = OUTLINE; g.stroke();
  // 框架线（木质）
  g.strokeStyle = '#7a5c44'; g.lineWidth = Math.max(1, s * 0.4);
  for (let i = 1; i < 5; i++) {
    g.beginPath();
    g.moveTo(x0 + (W / 5) * i, y0 + 20 * s);
    g.lineTo(x0 + (W / 5) * i, y - 16 * s);
    g.stroke();
  }
  // 内部植物剪影
  g.fillStyle = 'rgba(60,120,60,0.5)';
  for (let i = 0; i < 4; i++) {
    blob(g, x0 + 12 * s + i * 18 * s, y - 22 * s, 5 * s, 'rgba(60,120,60,0.5)');
  }
  // 拱形屋顶
  g.fillStyle = 'rgba(180,220,230,0.35)';
  g.beginPath();
  g.moveTo(x0 + 2 * s, y0 + 20 * s);
  g.quadraticCurveTo(x, y0 - 8 * s, x0 + W - 2 * s, y0 + 20 * s);
  g.closePath(); g.fill();
  g.strokeStyle = OUTLINE; g.stroke();
  // 反光
  g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = Math.max(1, s * 0.4);
  g.beginPath();
  g.moveTo(x0 + 12 * s, y0 + 30 * s); g.lineTo(x0 + 20 * s, y0 + 44 * s);
  g.stroke();
}

// 药草园圃：32w × 24h。种植床。
export function drawGardenPlot(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const W = 32 * s, H = 24 * s;
  // 土壤（木质 shadow）
  g.fillStyle = '#5e4632';
  rr(g, x - W / 2, y - H, W, H, 2 * s); g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.4);
  rr(g, x - W / 2, y - H, W, H, 2 * s); g.stroke();
  // 木框（木质 base）
  g.strokeStyle = '#7a5c44'; g.lineWidth = 3 * s;
  g.strokeRect(x - W / 2, y - H, W, H);
  // 幼苗 2 排
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 4; c++) {
      const px = x - 12 * s + c * 8 * s, py = y - 6 * s - r * 10 * s;
      g.strokeStyle = '#3d5c3e'; g.lineWidth = Math.max(1, s * 0.3);
      g.beginPath(); g.moveTo(px, py); g.lineTo(px, py - 6 * s); g.stroke();
      blob(g, px - 2 * s, py - 7 * s, 2 * s, '#527a4e');
      blob(g, px + 2 * s, py - 7 * s, 2 * s, '#527a4e');
    }
  }
}

// 猫头鹰棚屋：48w × 140h。高塔+栖木。
export function drawOwlery(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const W = 48 * s, H = 140 * s;
  const x0 = x - W / 2, y0 = y - H;
  dropShadow(g, x, y, W, H, s);
  // 塔身（石砌）
  g.fillStyle = '#8a8478';
  rr(g, x0, y0 + 30 * s, W, H - 30 * s, 2 * s); g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.5);
  rr(g, x0, y0 + 30 * s, W, H - 30 * s, 2 * s); g.stroke();
  // 石缝
  g.strokeStyle = 'rgba(0,0,0,0.15)'; g.lineWidth = Math.max(1, s * 0.3);
  for (let i = 1; i < 5; i++) {
    g.beginPath();
    g.moveTo(x0 + 4 * s, y0 + 30 * s + ((H - 30 * s) / 5) * i);
    g.lineTo(x0 + W - 4 * s, y0 + 30 * s + ((H - 30 * s) / 5) * i);
    g.stroke();
  }
  // 开放式顶层（栖木层，木质 base）
  g.fillStyle = '#7a5c44';
  for (let i = 0; i < 3; i++) {
    const py = y0 + 8 * s + i * 10 * s;
    g.fillRect(x0 - 4 * s, py, W + 8 * s, 3 * s);
  }
  // 栖木上的猫头鹰剪影
  g.fillStyle = '#2a1f1a';
  for (const [ox, oy] of [[-12, 8], [8, 18], [0, 28]] as Array<[number, number]>) {
    blob(g, x + ox * s, y0 + oy * s, 3 * s, '#2a1f1a');
    // 耳朵
    g.beginPath();
    g.moveTo(x + ox * s - 3 * s, y0 + oy * s - 2 * s);
    g.lineTo(x + ox * s - 2 * s, y0 + oy * s - 6 * s);
    g.lineTo(x + ox * s, y0 + oy * s - 2 * s);
    g.closePath(); g.fill();
    g.beginPath();
    g.moveTo(x + ox * s + 3 * s, y0 + oy * s - 2 * s);
    g.lineTo(x + ox * s + 2 * s, y0 + oy * s - 6 * s);
    g.lineTo(x + ox * s, y0 + oy * s - 2 * s);
    g.closePath(); g.fill();
  }
  // 锥形屋顶
  g.fillStyle = ROOF_CASTLE;
  g.beginPath();
  g.moveTo(x0 - 4 * s, y0 + 4 * s); g.lineTo(x, y0 - 16 * s); g.lineTo(x0 + W + 4 * s, y0 + 4 * s);
  g.closePath(); g.fill();
  g.strokeStyle = OUTLINE; g.stroke();
  // 入口拱门
  g.fillStyle = '#3a2e1f';
  g.beginPath();
  g.arc(x, y - 12 * s, 8 * s, Math.PI, 0);
  g.fillRect(x - 8 * s, y - 12 * s, 16 * s, 12 * s);
  g.fill();
}

// 记分牌：40w × 32h。魁地奇训练场。
export function drawScoreboard(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const W = 40 * s, H = 32 * s;
  dropShadow(g, x, y, W, H, s);
  // 支柱（木质 shadow）
  g.fillStyle = '#5e4632';
  g.fillRect(x - 12 * s, y - 16 * s, 4 * s, 16 * s);
  g.fillRect(x + 8 * s, y - 16 * s, 4 * s, 16 * s);
  // 牌面
  g.fillStyle = '#2a3444';
  rr(g, x - W / 2, y - H, W, H - 8 * s, 2 * s); g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.5);
  rr(g, x - W / 2, y - H, W, H - 8 * s, 2 * s); g.stroke();
  // 比分（示例）
  g.fillStyle = '#ffd98a'; g.font = `${Math.max(8, 10 * s)}px sans-serif`; g.textAlign = 'center';
  g.fillText('120 : 90', x, y - H + 14 * s);
  // 顶部装饰
  g.fillStyle = '#7a3b2e';
  g.fillRect(x - W / 2, y - H, W, 4 * s);
}

// 训练用球门：单门 16w × 48h（比正式的小）
export function drawTrainingHoop(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  // 杆
  g.strokeStyle = '#3a3230'; g.lineWidth = 4 * s; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 40 * s); g.stroke();
  // 金环
  g.strokeStyle = '#d4a017'; g.lineWidth = 3 * s;
  g.beginPath(); g.arc(x, y - 46 * s, 8 * s, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(212,160,23,0.15)';
  g.beginPath(); g.arc(x, y - 46 * s, 8 * s, 0, Math.PI * 2); g.fill();
}

// ------------------------------------------------------------------ A 组新增
// 告示牌：24w × 48h。木牌 24 × 16 + 木杆，岔路口指示方向。
export function drawSignpost(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  blob(g, x + 2 * s, y, 6 * s, SHADOW_A);
  // 木杆（shadow #5e4632）
  g.fillStyle = '#5e4632';
  rr(g, x - 2 * s, y - 40 * s, 4 * s, 40 * s, s); g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.35);
  rr(g, x - 2 * s, y - 40 * s, 4 * s, 40 * s, s); g.stroke();
  // 木牌（base #7a5c44），右端箭头指向
  g.fillStyle = '#7a5c44';
  g.beginPath();
  g.moveTo(x - 12 * s, y - 48 * s);
  g.lineTo(x + 8 * s, y - 48 * s);
  g.lineTo(x + 12 * s, y - 40 * s);
  g.lineTo(x + 8 * s, y - 32 * s);
  g.lineTo(x - 12 * s, y - 32 * s);
  g.closePath(); g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.4); g.stroke();
  // 牌面 highlight（左上）/ shadow（右下）
  g.fillStyle = '#8f6f52';
  g.fillRect(x - 10 * s, y - 46 * s, 8 * s, 2 * s);
  g.fillStyle = 'rgba(0,0,0,0.20)';
  g.fillRect(x - 10 * s, y - 34 * s, 18 * s, 2 * s);
  // 刻字线（2px 最小细节）
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = Math.max(1, s * 0.25);
  g.beginPath(); g.moveTo(x - 8 * s, y - 41 * s); g.lineTo(x + 4 * s, y - 41 * s); g.stroke();
  g.beginPath(); g.moveTo(x - 8 * s, y - 37 * s); g.lineTo(x, y - 37 * s); g.stroke();
}

// 芦苇丛：12w × 24h。黑湖岸水生植物，3–5 根随风摆动的芦苇。
export function drawReed(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const seed = x * 0.529 + y * 0.881;
  const n = 3 + Math.floor(sjit(seed, 7) * 3); // 3–5 根
  const greens = ['#527a4e', '#6a9463', '#749e6d'];
  blob(g, x, y, 6 * s, SHADOW_A);
  for (let i = 0; i < n; i++) {
    const bx = x + (i - (n - 1) / 2) * 5 * s;
    const lean = (sjit(seed, i) - 0.5) * 8 * s; // 倾斜
    const h = (18 + sjit(seed, i + 50) * 8) * s;
    g.strokeStyle = greens[i % 3];
    g.lineWidth = Math.max(2, 2.5 * s); g.lineCap = 'round';
    g.beginPath();
    g.moveTo(bx, y);
    g.quadraticCurveTo(bx + lean * 0.3, y - h * 0.6, bx + lean, y - h);
    g.stroke();
    // 穗头（2 根带穗）
    if (i % 2 === 0) {
      blob(g, bx + lean, y - h, 1.8 * s, '#a08c6a');
    }
  }
}

// ------------------------------------------------------------------ 物品图鉴
// 图鉴 UI（点击/E 弹窗）的数据源。只收录 A 组重画的物品。
export const ITEM_INFO: Record<string, {name: string; desc: string; grade: '普通' | '稀有' | '传说'}> = {
  bush: {name: '灌木', desc: '低矮的叶丛，通常三五成簇长在草地上。', grade: '普通'},
  stone: {name: '石头', desc: '有含义的石头：边界石标示区域、石阵藏着符文、路缘石引导方向。', grade: '普通'},
  chest: {name: '宝箱', desc: '封印的木箱，铜色普通、银色稀有、金色传说。', grade: '稀有'},
  well: {name: '水井', desc: '村广场中央的老井，石台木架上垂着水桶。', grade: '普通'},
  dock: {name: '木码头', desc: '伸向黑湖的木板栈道，桩柱钉得牢固。', grade: '普通'},
  mooringpost: {name: '系船柱', desc: '拴小船的矮木桩，缠着一圈绳索。', grade: '普通'},
  boat: {name: '小船', desc: '黑湖上的小木船，一年级新生渡湖用的。', grade: '普通'},
  campfire: {name: '篝火', desc: '石圈围着的柴火堆，夜里生火驱寒照明。', grade: '普通'},
  web: {name: '蛛网', desc: '禁林树间挂着的蛛网，蛛丝沾着露水。', grade: '普通'},
  glowflower: {name: '发光花', desc: '禁林深处的稀有植物，花瓣夜里发出微光。', grade: '稀有'},
  signpost: {name: '告示牌', desc: '岔路口的木指示牌，箭头指向各个方向。', grade: '普通'},
  reed: {name: '芦苇丛', desc: '黑湖岸边的水生植物，成簇随风摇摆。', grade: '普通'},
  lamp: {name: '路灯', desc: '铁质灯杆，罩着暖黄的玻璃灯，夜里照亮道路。', grade: '普通'},
  brazier: {name: '火盆', desc: '铁质三脚火盆，点燃后是传说级警戒火光。', grade: '传说'},
  fence: {name: '栅栏', desc: '木栅栏，三节以上成排，围出农田和庭院。', grade: '普通'},
  villagegate: {name: '村门', desc: '霍格莫德村口的木石牌坊，梁上钉着铁箍。', grade: '普通'},
  marketstall: {name: '集市摊位', desc: '木货台加条纹遮阳棚，摊上摆满各色货物。', grade: '普通'},
  greenhouse: {name: '温室', desc: '草药课的玻璃温室，木框里种着奇异植物。', grade: '稀有'},
  flowerbed: {name: '花坛', desc: '小方花圃，五朵小花开在深色土上。', grade: '普通'},
  bench: {name: '长椅', desc: '木质长椅，成对摆在建筑的呼吸空间里。', grade: '普通'},
  scarecrow: {name: '稻草人', desc: '木杆撑起的草帽南瓜头，守护农田。', grade: '普通'},
  beehive: {name: '蜂箱', desc: '三层叠木蜂箱，蜜满时是稀有采集点。', grade: '稀有'},
  gardenplot: {name: '苗圃', desc: '木框围出的种植床，两排幼苗刚发芽。', grade: '普通'},
  swing: {name: '秋千', desc: '木 A 架吊着的秋千，绳结系得很牢。', grade: '普通'},
  tent: {name: '帐篷', desc: '马人营地的圆锥帆布帐篷，顶上系着红带。', grade: '普通'},
  scoreboard: {name: '记分牌', desc: '魁地奇训练场的木记分牌，挂着当前比分。', grade: '普通'},
  traininghoop: {name: '训练球门', desc: '单门的训练用金环，杆比正式球门矮。', grade: '普通'},
  owlery: {name: '猫头鹰棚屋', desc: '高塔上的开放栖木层，住着送信的猫头鹰。', grade: '普通'},
  lighthouse: {name: '灯塔', desc: '黑湖码头的红白条纹小灯塔，指引归航。', grade: '普通'},
  station: {name: '车站', desc: '长条站楼带站台和大钟，霍格沃茨特快的起点。', grade: '普通'},
  library: {name: '图书馆', desc: '石柱三角楣的阅览馆，台阶拾级而上。', grade: '普通'},
  dormtower: {name: '宿舍塔楼', desc: '学院色的尖顶塔楼，竖排暖窗是宿舍灯光。', grade: '普通'},
  shop: {name: '商店', desc: '临街店铺，挂着招牌板和条纹雨棚。', grade: '普通'},
  pub: {name: '酒吧', desc: '三把扫帚酒吧，暖窗和悬挂扫帚招牌。', grade: '普通'},
};
