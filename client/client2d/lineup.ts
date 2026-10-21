/**
 * 生物体型核验页（开发工具）：/lineup.html。
 *
 * 按 renderer.ts 的 CREATURE_HW 体型表，把每种生物与 1.8 米巫师并排画在
 * 同一地面线上，附 1 米刻度与 1.8 米参考线，目视核对比例。
 * 缩放取游戏默认 cam.zoom = 2.75，绘制公式与 renderer 生物路径一致
 * （绘制高 = hM × ENTITY_PX_PER_M × zoom，宽度按精灵宽高比跟随）。
 */
import { CREATURE_HW, ENTITY_PX_PER_M } from './renderer';
import { preSprite } from './assets';

const ZOOM = 2.75;
const PX_M = ENTITY_PX_PER_M * ZOOM; // 1 米的屏幕 px

async function waitSprites(): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (preSprite('hw-wizard-gryffindor-down') && preSprite('hw-troll')) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('prerendered sprites not loaded');
}

function draw(): void {
  const kinds = Object.keys(CREATURE_HW);
  const cols = 6, cellW = 360, cellH = 320;
  const rows = Math.ceil(kinds.length / cols);
  const cv = document.createElement('canvas');
  cv.width = cols * cellW;
  cv.height = rows * cellH;
  document.body.appendChild(cv);
  const g = cv.getContext('2d')!;
  g.fillStyle = '#7fa65c';
  g.fillRect(0, 0, cv.width, cv.height);
  g.imageSmoothingEnabled = false;

  const wiz = preSprite('hw-wizard-gryffindor-down')!;
  const wizDh = 1.8 * PX_M; // 与游戏内巫师绘制高一致（36 × zoom）

  kinds.forEach((kind, idx) => {
    const cx = (idx % cols) * cellW, cy = Math.floor(idx / cols) * cellH;
    const groundY = cy + cellH - 44;
    g.strokeStyle = 'rgba(0,0,0,0.3)';
    g.strokeRect(cx + 0.5, cy + 0.5, cellW - 1, cellH - 1);
    // 地面线
    g.fillStyle = '#55703d';
    g.fillRect(cx, groundY, cellW, 3);
    // 1 米刻度（左侧竖轴）
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.font = '10px sans-serif';
    g.textAlign = 'left';
    for (let m = 1; m <= 4; m++) {
      const y = groundY - m * PX_M;
      if (y < cy + 16) break;
      g.fillRect(cx + 4, y, m === 1 ? 10 : 6, 1.5);
      g.fillText(m + 'm', cx + 16, y + 3);
    }
    // 1.8 米参考线（巫师头顶）
    const refY = groundY - 1.8 * PX_M;
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(cx, refY); g.lineTo(cx + cellW, refY); g.stroke();
    g.setLineDash([]);
    // 巫师（参照物）
    const kw = wizDh / wiz.h;
    g.drawImage(wiz.img, cx + 58 - wiz.anchorX * kw, groundY - wiz.anchorY * kw, wiz.w * kw, wizDh);
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillText('wizard 1.8m', cx + 34, groundY + 14);
    // 生物：与游戏同一公式，锚点落在地面线
    const { name, hM } = CREATURE_HW[kind];
    const pm = preSprite(name);
    g.fillStyle = '#1d1508';
    g.font = 'bold 13px sans-serif';
    g.fillText(kind, cx + 8, cy + 16);
    g.font = '11px sans-serif';
    if (pm) {
      const dhC = hM * PX_M;
      const k = dhC / pm.h;
      const dwC = pm.w * k;
      const x0 = cx + 190;
      g.drawImage(pm.img, x0 - pm.anchorX * k, groundY - pm.anchorY * k, dwC, dhC);
      g.fillText(`${name}  h=${hM}m  w=${(dwC / PX_M).toFixed(2)}m`, cx + 8, cy + 31);
    } else {
      g.fillText(name + ' 精灵缺失', cx + 8, cy + 31);
    }
  });
  (window as unknown as { __lineupDone: number }).__lineupDone = kinds.length;
}

waitSprites().then(draw).catch((e) => {
  document.body.textContent = 'lineup failed: ' + (e as Error).message;
});
