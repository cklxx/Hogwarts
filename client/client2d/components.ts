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

  // 屋顶：梯形，两坡
  g.fillStyle = '#8a5f4a';
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
  g.strokeStyle = '#6e4a38'; g.lineWidth = Math.max(1, s * 0.4);
  g.beginPath(); g.moveTo(x - 3 * s, y0 + 2 * s); g.lineTo(x + 3 * s, y0 + 2 * s); g.stroke();

  // 烟囱
  const chx = x + W * 0.22, chW = 8 * s, chH = 14 * s;
  g.fillStyle = '#6e5a50';
  g.fillRect(chx - chW / 2, y0 + 6 * s, chW, chH);
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.4);
  g.strokeRect(chx - chW / 2, y0 + 6 * s, chW, chH);
  g.fillStyle = '#8a7368';
  g.fillRect(chx - chW / 2, y0 + 6 * s, chW, 3 * s);

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

  // 屋顶
  g.fillStyle = '#8a5f4a';
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

  // 烟囱 ×2
  for (const chx of [x - W * 0.25, x + W * 0.25]) {
    g.fillStyle = '#6e5a50';
    g.fillRect(chx - 4 * s, y0 + 8 * s, 8 * s, 14 * s);
    g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.4);
    g.strokeRect(chx - 4 * s, y0 + 8 * s, 8 * s, 14 * s);
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
// 俯视：树冠圆形 + 树干阴影。光源左上。

export function drawOak(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  // 树干阴影（右下）
  blob(g, x + 4 * s, y - 2 * s, 7 * s, SHADOW_A);
  // 树干
  g.fillStyle = '#4a352a';
  blob(g, x, y - 4 * s, 6 * s, '#4a352a');
  blob(g, x - 2 * s, y - 6 * s, 2 * s, '#6b4f3a'); // highlight
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.4);
  g.beginPath(); g.arc(x, y - 4 * s, 6 * s, 0, Math.PI * 2); g.stroke();

  // 树冠三层：dark 底层 / base 中层 / light 顶层（左上）
  const R = 36 * s;
  blob(g, x, y - 36 * s, R, '#2c4530');
  blob(g, x - 2 * s, y - 38 * s, R * 0.82, '#3d5c3e');
  blob(g, x - 6 * s, y - 44 * s, R * 0.55, '#527a4e');
  blob(g, x - 10 * s, y - 50 * s, R * 0.28, '#6a9463');
  // 描边（只画外圈）
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.5);
  g.beginPath(); g.arc(x, y - 36 * s, R, 0, Math.PI * 2); g.stroke();
  // 树冠投影
  blob(g, x + 10 * s, y - 28 * s, R * 0.9, 'rgba(0,0,0,0.15)');
}

export function drawPine(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  blob(g, x + 3 * s, y - 2 * s, 5 * s, SHADOW_A);
  // 树干
  g.fillStyle = '#4a352a';
  g.fillRect(x - 5 * s, y - 24 * s, 10 * s, 20 * s);
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.4);
  g.strokeRect(x - 5 * s, y - 24 * s, 10 * s, 20 * s);

  // 三角冠三层
  const layers: Array<[number, number, number, string]> = [
    // [topY, halfW, h, color]
    [20, 24, 28, '#24402a'],
    [36, 18, 24, '#2c4530'],
    [52, 12, 20, '#3d5c3e'],
  ];
  for (const [topY, hw, h, col] of layers) {
    const ty = y - (84 - topY) * s;
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(x, ty - h * s);
    g.lineTo(x - hw * s, ty);
    g.lineTo(x + hw * s, ty);
    g.closePath(); g.fill();
    g.strokeStyle = OUTLINE; g.stroke();
  }
  // 左上 highlight
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.beginPath();
  g.moveTo(x, y - 84 * s); g.lineTo(x - 24 * s, y - 56 * s); g.lineTo(x - 12 * s, y - 56 * s);
  g.closePath(); g.fill();
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

// ------------------------------------------------------------------ 道具
export function drawBush(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  blob(g, x + 3 * s, y, 10 * s, SHADOW_A);
  blob(g, x, y - 6 * s, 10 * s, '#3d5c3e');
  blob(g, x - 3 * s, y - 9 * s, 6 * s, '#527a4e');
  blob(g, x - 5 * s, y - 11 * s, 3 * s, '#6a9463');
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.4);
  g.beginPath(); g.arc(x, y - 6 * s, 10 * s, 0, Math.PI * 2); g.stroke();
}

export function drawStone(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  blob(g, x + 2 * s, y, 6 * s, SHADOW_A);
  g.fillStyle = '#9b958b';
  g.beginPath();
  g.ellipse(x, y - 4 * s, 6 * s, 4 * s, 0.3, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.4); g.stroke();
  g.fillStyle = '#b3ada2'; // highlight
  g.beginPath();
  g.ellipse(x - 2 * s, y - 6 * s, 2.5 * s, 1.5 * s, 0.3, 0, Math.PI * 2);
  g.fill();
}

export function drawLamp(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  blob(g, x + 2 * s, y, 4 * s, SHADOW_A);
  // 杆
  g.fillStyle = '#3a3230';
  g.fillRect(x - 3 * s, y - 36 * s, 6 * s, 36 * s);
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.3);
  g.strokeRect(x - 3 * s, y - 36 * s, 6 * s, 36 * s);
  // 灯头
  g.fillStyle = '#3a3230';
  rr(g, x - 6 * s, y - 48 * s, 12 * s, 12 * s, 2 * s); g.fill();
  g.strokeStyle = OUTLINE; g.stroke();
  g.fillStyle = '#ffd98a'; // 灯光
  blob(g, x, y - 42 * s, 3.5 * s, '#ffd98a');
}

export function drawFence(g: CanvasRenderingContext2D, x: number, y: number, s: number, len = 1): void {
  // len = 节数，每节 24w
  const W = 24 * s * len, H = 16 * s;
  const x0 = x - W / 2;
  for (let i = 0; i <= len * 2; i++) {
    const px = x0 + (i * W) / (len * 2);
    g.fillStyle = '#6b4f3a';
    g.fillRect(px - 2 * s, y - H, 4 * s, H);
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
}

export function drawChest(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const W = 20 * s, H = 14 * s;
  const x0 = x - W / 2, y0 = y - H;
  blob(g, x + 2 * s, y, W / 2, SHADOW_A);
  // 箱体
  g.fillStyle = '#6b4f3a';
  rr(g, x0, y0, W, H, 2 * s); g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * 0.4);
  rr(g, x0, y0, W, H, 2 * s); g.stroke();
  // 箱盖
  g.fillStyle = '#7a5c44';
  rr(g, x0, y0, W, 6 * s, 2 * s); g.fill();
  g.strokeStyle = OUTLINE; g.stroke();
  // 金属包边
  g.fillStyle = '#8a8a8a';
  g.fillRect(x0, y0 + 5 * s, W, 2 * s);
  g.fillRect(x - s, y0, 2 * s, H);
  // 锁
  g.fillStyle = '#d4a017';
  blob(g, x, y0 + 6 * s, 2.5 * s, '#d4a017');
  g.strokeStyle = OUTLINE; g.stroke();
}
