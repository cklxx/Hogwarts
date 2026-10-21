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

export function drawMushroom(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  // 蘑菇：只长在禁林深处（神秘感）。红盖白点毒蝇伞 + 棕色小菇，2-3 朵一簇。
  const seed = x * 0.731 + y * 0.197;
  blob(g, x + 1 * s, y, 5 * s, SHADOW_A);
  // 主菇：红盖
  const ch = 10 * s; // 盖高
  g.fillStyle = '#c0392b';
  g.beginPath(); g.ellipse(x, y - ch, 7 * s, 5 * s, 0, Math.PI, 0); g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.35); g.stroke();
  // 白点
  g.fillStyle = '#f0e8d8';
  blob(g, x - 3 * s, y - ch - 2 * s, 1.2 * s, '#f0e8d8');
  blob(g, x + 1 * s, y - ch - 3.5 * s, 1 * s, '#f0e8d8');
  blob(g, x + 3.5 * s, y - ch - 1 * s, 0.8 * s, '#f0e8d8');
  // 柄
  g.fillStyle = '#e8dcc0';
  g.fillRect(x - 1.5 * s, y - ch + 1 * s, 3 * s, ch - 1 * s);
  g.strokeStyle = OUTLINE;
  g.strokeRect(x - 1.5 * s, y - ch + 1 * s, 3 * s, ch - 1 * s);
  // 侧小菇（棕盖）
  if (sjit(seed, 7) > 0.3) {
    const sx = x + 8 * s, sh = 6 * s;
    g.fillStyle = '#8a6a42';
    g.beginPath(); g.ellipse(sx, y - sh, 4 * s, 3 * s, 0, Math.PI, 0); g.fill();
    g.strokeStyle = OUTLINE; g.stroke();
    g.fillStyle = '#e8dcc0';
    g.fillRect(sx - 1 * s, y - sh + 1 * s, 2 * s, sh - 1 * s);
  }
}
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
  mushroom: {name: '蘑菇', desc: '只长在禁林深处的毒蝇伞，石阵周围最多。', grade: '普通'},
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
