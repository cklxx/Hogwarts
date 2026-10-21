/**
 * lineup 对照页（?lineup=1）：统一尺寸系统验收图（size-design.md）。
 * 绘制规则与 renderer 完全一致：精灵按登记世界宽度 W 定宽，
 * k = W × ZOOM / 精灵px宽，高度按精灵宽高比跟随，地面锚点对齐同一
 * 条地面线。主对照排：巫师/松树/橡树/商店/塔楼/巨怪/独角兽/特快；
 * 其下人物排与全部生物网格。刻度为世界单位（活物 1 真实米 = 5 单位，
 * U_LIVE；建筑登记宽见尺寸表）。
 */
import { preSprite } from './assets';
import { CREATURE_HW, FIGURE_W } from './renderer';

async function waitSprites(): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (preSprite('hw-wizard-gryffindor-down') && preSprite('hw-troll') && preSprite('hw-express')) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('prerendered sprites not loaded');
}

const ZOOM = 4; // 对照页 px / 世界单位

interface Item { name: string; label: string; w: number; note: string }

const MAIN: Item[] = [
  { name: 'hw-wizard-gryffindor-down', label: '巫师', w: FIGURE_W['hw-wizard-gryffindor'], note: '1.8m+帽0.65m' },
  { name: 'treePine', label: '松树', w: 13.8, note: '高 7m' },
  { name: 'treeRound', label: '橡树', w: 13.8, note: '冠径 6m 高 8m' },
  { name: 'houseWood', label: '商店', w: 14, note: '占地 14×12' },
  { name: 'hw-tower-tall', label: '塔楼', w: 10, note: '布局径 2r=10' },
  { name: 'hw-troll', label: '巨怪', w: CREATURE_HW.troll.wM, note: '高 3.5m' },
  { name: 'hw-unicorn', label: '独角兽', w: CREATURE_HW.unicorn.wM, note: '高 1.6m+角' },
  { name: 'hw-express', label: '特快车头', w: 24, note: '高 4m 长 11m' },
];

const FIGURES: Item[] = [
  { name: 'hw-wizard-gryffindor-down', label: '巫师', w: FIGURE_W['hw-wizard-gryffindor'], note: '高 1.8m' },
  { name: 'hw-professor-down', label: '教授', w: FIGURE_W['hw-professor'], note: '高 1.85m+帽' },
  { name: 'hw-hagrid-down', label: '海格', w: FIGURE_W['hw-hagrid'], note: '高 2.6m' },
  { name: 'hw-dementor-down', label: '摄魂怪', w: FIGURE_W['hw-dementor'], note: '高 2.4m' },
  { name: 'hw-merchant-down', label: '商人', w: FIGURE_W['hw-merchant'], note: '高 1.75m' },
  { name: 'hw-elf-down', label: '小精灵', w: FIGURE_W['hw-elf'], note: '高 1.0m' },
  { name: 'hw-cat', label: '猫', w: CREATURE_HW.cat.wM, note: '体长 0.75m' },
];

function drawRow(
  ctx: CanvasRenderingContext2D, items: Item[], groundY: number, x0: number,
): void {
  let cx = x0;
  for (const it of items) {
    const pm = preSprite(it.name);
    const wpx = it.w * ZOOM;
    if (pm) {
      const k = wpx / pm.w;
      const dx = cx + wpx / 2 - pm.anchorX * k;
      const dy = groundY - pm.anchorY * k;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(pm.img, dx, dy, pm.w * k, pm.h * k);
      ctx.fillStyle = '#ff2a1a';
      ctx.fillRect(cx + wpx / 2 - 1, groundY - 1, 2, 2);
    } else {
      ctx.fillStyle = '#999';
      ctx.fillRect(cx, groundY - wpx, wpx, wpx);
      ctx.fillStyle = '#fff';
      ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('未加载', cx + wpx / 2, groundY - wpx / 2);
    }
    const dh = pm ? (it.w * pm.h) / pm.w : it.w;
    ctx.fillStyle = '#1d2733';
    ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(it.label, cx + wpx / 2, groundY + 18);
    ctx.font = '11px sans-serif'; ctx.fillStyle = '#5a6a7a';
    ctx.fillText(`宽 ${it.w} · 高 ${dh.toFixed(1)} 单位`, cx + wpx / 2, groundY + 34);
    ctx.fillText(it.note, cx + wpx / 2, groundY + 48);
    cx += wpx + 48;
  }
}

function ruler(ctx: CanvasRenderingContext2D, y: number, w: number) {
  ctx.strokeStyle = '#8a97a5'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  ctx.font = '10px sans-serif'; ctx.fillStyle = '#5a6a7a'; ctx.textAlign = 'center';
  for (let x = 0; x <= w; x += 5 * ZOOM) {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 5); ctx.stroke();
    ctx.fillText(String(x / ZOOM), x, y + 16);
  }
  ctx.textAlign = 'left';
  ctx.fillText('刻度：世界单位', 4, y - 6);
}

export async function renderLineupPage(): Promise<void> {
  await waitSprites();
  const cv = document.getElementById('cv') as HTMLCanvasElement;
  const ctx = cv.getContext('2d')!;
  (window as unknown as { __lineupDone?: boolean }).__lineupDone = false;

  const mainW = MAIN.reduce((s, it) => s + it.w * ZOOM + 48, 0) + 40;
  const kinds = Object.keys(CREATURE_HW);
  const perRow = 6;
  const cellW = 34 * ZOOM + 30;
  const gridW = perRow * cellW + 40;
  const W = Math.max(mainW, gridW, 900);
  const rowH = 46 * ZOOM + 70;
  const H = 130 + rowH + Math.ceil(kinds.length / perRow) * rowH + 140;
  cv.width = W; cv.height = H;

  ctx.fillStyle = '#f4f1e8';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1d2733';
  ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('统一尺寸系统对照（size-design.md）：同排共地面线，按登记世界宽度绘制', 20, 34);
  ctx.font = '13px sans-serif'; ctx.fillStyle = '#5a6a7a';
  ctx.fillText('活物 U_LIVE = 5 世界单位/真实米（巫师锚点）；建筑钉占地/布局；精灵为工厂俯角 40° 渲染，高度按自身像素比带出。', 20, 56);

  // --- 主对照排 ---
  const g1 = 90 + 46 * ZOOM;
  ctx.strokeStyle = '#3a7d2c'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, g1); ctx.lineTo(W, g1); ctx.stroke();
  drawRow(ctx, MAIN, g1, 20);
  ruler(ctx, g1 + 62, W);

  // --- 人物排 ---
  let y = g1 + 110;
  ctx.fillStyle = '#1d2733'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('人物', 20, y);
  const g2 = y + 24 + 16 * ZOOM;
  ctx.strokeStyle = '#3a7d2c'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, g2); ctx.lineTo(W, g2); ctx.stroke();
  drawRow(ctx, FIGURES, g2, 20);

  // --- 生物网格 ---
  y = g2 + 90;
  ctx.fillStyle = '#1d2733'; ctx.font = 'bold 16px sans-serif';
  ctx.fillText('生物（全部登记物种）', 20, y);
  y += 10;
  const items: Item[] = kinds.map((k) => ({
    name: CREATURE_HW[k].name, label: k, w: CREATURE_HW[k].wM, note: '',
  }));
  for (let r0 = 0; r0 < items.length; r0 += perRow) {
    const row = items.slice(r0, r0 + perRow);
    const gy = y + 40 * ZOOM;
    ctx.strokeStyle = '#b9c4ae'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    let cx = 20;
    for (const it of row) {
      const pm = preSprite(it.name);
      const wpx = it.w * ZOOM;
      if (pm) {
        const k = wpx / pm.w;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(pm.img, cx + cellW / 2 - pm.anchorX * k, gy - pm.anchorY * k, pm.w * k, pm.h * k);
      }
      const dh = pm ? (it.w * pm.h) / pm.w : it.w;
      ctx.fillStyle = '#1d2733'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(it.label, cx + cellW / 2, gy + 16);
      ctx.font = '11px sans-serif'; ctx.fillStyle = '#5a6a7a';
      ctx.fillText(`宽 ${it.w} · 高 ${dh.toFixed(1)}`, cx + cellW / 2, gy + 31);
      cx += cellW;
    }
    y = gy + 44;
  }
  document.title = '尺寸对照 lineup';
  (window as unknown as { __lineupDone?: boolean }).__lineupDone = true;
}

// lineup.html 直接以模块加载本文件：自建画布并启动。
{
  const cv = document.createElement('canvas');
  cv.id = 'cv';
  document.body.appendChild(cv);
  renderLineupPage().catch((e) => {
    document.body.textContent = 'lineup failed: ' + (e as Error).message;
  });
}
