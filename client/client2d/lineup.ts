/**
 * lineup 对照页（/lineup.html）：素材系统验收图。
 * 全部数值读派生表（manifest → derive.py → derived.json，经 asset-data）：
 * 主对照排、人物排、生物网格、全素材画廊（按类分组、同一尺度、共地面线、
 * 每排带 1.8m 巫师参照影 + 世界单位刻度）。精灵按规范绘制宽 drawW 定宽，
 * k = W × ZOOM / 精灵px宽，高度按宽高比跟随，锚点对齐地面线。
 */
import { preSprite } from './assets';
import { CREATURE_HW, FIGURE_W, drawWOf } from './renderer';
import { ASSET } from '../../src/shared/asset-data';

async function waitSprites(): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (preSprite('hw-wizard-gryffindor-down') && preSprite('hw-troll') && preSprite('hw-express')) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('prerendered sprites not loaded');
}

const ZOOM = 4; // 对照页 px / 世界单位
const PAGE_W = 2600;

interface Item { name: string; label: string; w: number; note: string }

function drawItem(ctx: CanvasRenderingContext2D, it: Item, cx: number, groundY: number, ghost = false, lane = 0): number {
  const pm = preSprite(it.name);
  const wpx = it.w * ZOOM;
  if (pm) {
    const k = wpx / pm.w;
    ctx.save();
    if (ghost) ctx.globalAlpha = 0.35;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(pm.img, cx + wpx / 2 - pm.anchorX * k, groundY - pm.anchorY * k, pm.w * k, pm.h * k);
    ctx.restore();
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
  const ly = groundY + lane * 44; // 密排时标签双行错位，避免相邻压字
  ctx.fillStyle = '#1d2733';
  ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(it.label, cx + wpx / 2, ly + 17);
  ctx.font = '10px sans-serif'; ctx.fillStyle = '#5a6a7a';
  ctx.fillText(`宽 ${it.w} · 高 ${dh.toFixed(1)}`, cx + wpx / 2, ly + 31);
  if (it.note) ctx.fillText(it.note, cx + wpx / 2, ly + 44);
  return wpx;
}

/** 流式排布一区物品（巫师参照影起头，超宽换行）。maxH = 本区地面线
 *  以上的预留高度（世界单位）。返回本区占用的总高度（px）。 */
function drawFlow(ctx: CanvasRenderingContext2D, items: Item[], y0: number, maxH: number): number {
  const wiz: Item = { name: 'hw-wizard-gryffindor-down', label: '巫师参照', w: FIGURE_W['hw-wizard-gryffindor']!, note: '1.8m' };
  let cx = 20, groundY = y0 + maxH * ZOOM, idx = 0;
  cx += drawItem(ctx, wiz, cx, groundY, true) + 30;
  for (const it of items) {
    const wpx = it.w * ZOOM;
    if (cx + wpx > PAGE_W - 20) {
      groundY += maxH * ZOOM + 110;
      cx = 20; idx = 0;
      cx += drawItem(ctx, wiz, cx, groundY, true) + 30;
    }
    cx += drawItem(ctx, it, cx, groundY, false, idx++ % 2) + 34;
  }
  return groundY + 110 - y0;
}

function ruler(ctx: CanvasRenderingContext2D, y: number) {
  ctx.strokeStyle = '#8a97a5'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PAGE_W, y); ctx.stroke();
  ctx.font = '10px sans-serif'; ctx.fillStyle = '#5a6a7a'; ctx.textAlign = 'center';
  for (let x = 0; x <= PAGE_W; x += 5 * ZOOM) {
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

  const MAIN: Item[] = [
    { name: 'hw-wizard-gryffindor-down', label: '巫师', w: FIGURE_W['hw-wizard-gryffindor']!, note: '1.8m+帽0.65m' },
    { name: 'treePine', label: '松树', w: drawWOf('treePine'), note: '高 7m' },
    { name: 'treeRound', label: '橡树', w: drawWOf('treeRound'), note: '冠径 6m 高 8m' },
    { name: 'houseWood', label: '村庄住宅', w: drawWOf('houseWood'), note: '模型 4.07m × U_STRUCT' },
    { name: 'hw-tower-tall', label: '塔楼', w: drawWOf('hw-tower-tall'), note: '规范宽（实例按布局半径）' },
    { name: 'hw-troll', label: '巨怪', w: CREATURE_HW.troll!.wM, note: '高 3.5m' },
    { name: 'hw-unicorn', label: '独角兽', w: CREATURE_HW.unicorn!.wM, note: '高 1.6m+角' },
    { name: 'hw-express', label: '特快车头', w: drawWOf('hw-express'), note: '高 4m 长 11m' },
  ];
  const FIGURES: Item[] = Object.entries(ASSET.figures).map(([base, f]) => ({
    name: `${base}-down`, label: base.replace('hw-', ''), w: f.w,
    note: `绘制高 ${f.dh}`,
  }));
  const CREATURES: Item[] = Object.entries(ASSET.creatures).map(([kind, c]) => ({
    name: c.sprite, label: kind, w: c.wM, note: ASSET.sprites[c.sprite]?.flag ? '⚠比例标记' : '',
  }));
  const CAT_LABEL: Record<string, string> = {
    building: '建筑', tree: '树', layout: '布局物件', prop: '道具',
    stamp: '地面盖印', creature: '生物（精灵规范宽）',
  };
  const gallery: Record<string, Item[]> = {};
  for (const [name, d] of Object.entries(ASSET.sprites)) {
    if (!d.cat || d.cat === 'figure-frame' || d.cat === 'frame') continue;
    (gallery[d.cat] ??= []).push({
      name, label: name, w: d.drawW ?? 10,
      note: d.drawW == null ? '无规范宽（实例尺度）' : d.flag ? '⚠比例标记' : '',
    });
  }
  for (const items of Object.values(gallery)) items.sort((a, b) => b.w - a.w);

  // 画布高度预估（宁大：末尾按实际用量裁剪）
  const est = 20000;
  cv.width = PAGE_W; cv.height = est;
  ctx.fillStyle = '#f4f1e8';
  ctx.fillRect(0, 0, PAGE_W, est);
  ctx.fillStyle = '#1d2733';
  ctx.font = 'bold 21px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('素材系统阵容（manifest → derive 派生）：同尺度、共地面线、巫师参照', 20, 36);
  ctx.font = '13px sans-serif'; ctx.fillStyle = '#5a6a7a';
  ctx.fillText('全部宽度读 derived.json 派生表；活物 U_LIVE = 5 世界单位/真实米，建筑 U_STRUCT = 3.2；⚠ = 模型比例标记（lint PENDING）。', 20, 60);

  let y = 84;
  const title = (text: string): void => {
    ctx.fillStyle = '#1d2733';
    ctx.font = 'bold 17px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(text, 20, y);
    y += 14;
  };
  title('主对照排');
  y += drawFlow(ctx, MAIN, y, 46) + 14;
  ruler(ctx, y); y += 44;

  title('人物（全部基名，down 帧）');
  y += drawFlow(ctx, FIGURES, y, 16) + 14;
  ruler(ctx, y); y += 44;

  title(`生物（全部 ${CREATURES.length} 物种，按物种登记宽）`);
  y += drawFlow(ctx, CREATURES, y, 24) + 14;
  ruler(ctx, y); y += 44;

  for (const [cat, label] of Object.entries(CAT_LABEL)) {
    const items = gallery[cat];
    if (!items?.length) continue;
    title(`全素材 · ${label}（${items.length} 个精灵，规范宽）`);
    const maxH = Math.min(52, Math.max(12, ...items.map((it) => {
      const pm = preSprite(it.name);
      return pm ? (it.w * pm.h) / pm.w : it.w;
    })));
    y += drawFlow(ctx, items, y, maxH) + 14;
    ruler(ctx, y); y += 44;
  }

  title('无消费方（待拍板）');
  y += drawFlow(ctx, [{ name: 'char3d-down-stand', label: 'char3d 角色帧 ×20', w: 10, note: '客户端已无引用' }], y, 12) + 30;

  // 裁掉预估多余高度
  const used = document.createElement('canvas');
  used.width = PAGE_W; used.height = y;
  used.getContext('2d')!.drawImage(cv, 0, 0);
  cv.height = y;
  ctx.drawImage(used, 0, 0);
  document.title = '素材阵容 lineup';
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
