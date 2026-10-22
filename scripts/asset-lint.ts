// ------------------------------------------------------------------
// asset-lint.ts — 2D 素材验收门（npm run lint:assets）。
//
// 检查素材系统的一致性：manifest（唯一手写源）→ derived.json（派生）→
// 消费方（renderer/layout2d/assets）三段不得漂移。
// 结果分两级：
// - FAIL：机械性不一致，本轮必须修到 0，exit 1。
// - PENDING：需要人拍板的口径（无视觉碰撞盘、模型比例标记、无消费方
//   精灵），只列清单与计数，不阻塞。
// ------------------------------------------------------------------
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ASSET } from '../src/shared/asset-data.js';
import { OBSTACLES } from '../src/shared/map.js';
import { getLayout, buildingColliders2D } from '../src/shared/layout2d.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p: string): string => readFileSync(root + p, 'utf8');
const manifest = JSON.parse(read('tools/sprite-factory/manifest.json'));
const spritesJson = JSON.parse(read('client/assets2d/prerendered/sprites.json'));
const rendererSrc = read('client/client2d/renderer.ts');
const layoutSrc = read('src/shared/layout2d.ts');

let fails = 0;
const fail = (msg: string): void => { fails++; console.log('FAIL ', msg); };
const ok = (msg: string): void => console.log('ok   ', msg);
const pending = (msg: string): void => console.log('PEND ', msg);

// 1) 三方集合一致：manifest / sprites.json / derived.json
const mNames = new Set(Object.keys(manifest.sprites));
const sNames = new Set(Object.keys(spritesJson));
const dNames = new Set(Object.keys(ASSET.sprites));
const only = (a: Set<string>, b: Set<string>): string[] => [...a].filter((x) => !b.has(x));
for (const [label, a, b] of [['manifest−sprites.json', mNames, sNames], ['sprites.json−manifest', sNames, mNames],
  ['sprites.json−derived', sNames, dNames], ['derived−sprites.json', dNames, sNames]] as const) {
  const d = only(a, b);
  if (d.length) fail(`${label}: ${d.slice(0, 6).join(', ')}${d.length > 6 ? ` …共 ${d.length}` : ''}`);
}
if (!fails) ok(`精灵集合三方一致（${sNames.size} 个）`);

// 2) sprites.json 禁止手写 footOffset（派生值只许在 derived.json）
const handFo = Object.entries(spritesJson).filter(([, v]) => 'footOffset' in (v as object));
if (handFo.length) fail(`sprites.json 含 ${handFo.length} 条手写 footOffset（应由 derive 派生）`);
else ok('sprites.json 无手写 footOffset');

// 3) 派生完整性：stance 齐全；rule 非空的精灵必有 drawW
let stanceMissing = 0, drawMissing = 0;
for (const [name, e] of Object.entries(manifest.sprites) as [string, { rule?: string | null; cat: string }][]) {
  const d = ASSET.sprites[name];
  if (!d) continue;
  if (e.cat !== 'frame' && e.cat !== 'figure-frame' && d.stance.d == null) stanceMissing++;
  if (e.rule && d.drawW == null) drawMissing++;
}
if (stanceMissing) fail(`${stanceMissing} 个精灵缺 stance 派生`);
if (drawMissing) fail(`${drawMissing} 个精灵 rule 非空但 drawW 缺失`);
if (!stanceMissing && !drawMissing) ok('stance/drawW 派生完整');

// 4) 消费方改读检查：手抄表不得回潮
if (/wM:\s*[\d]/.test(rendererSrc)) fail('renderer.ts 出现 wM 数值字面量（生物表回潮）');
if (/FIGURE_W[^=]*=\s*\{[^}]*:\s*[\d]/.test(rendererSrc)) fail('renderer.ts 出现 FIGURE_W 数值表（回潮）');
if (!rendererSrc.includes('ASSET.creatures')) fail('renderer.ts 未读 ASSET.creatures');
if (!rendererSrc.includes('ASSET.layoutKinds')) fail('renderer.ts 未读 ASSET.layoutKinds');
if (!layoutSrc.includes('ASSET.layoutKinds')) fail('layout2d.ts 未读 ASSET.layoutKinds（FOOT 回潮风险）');
if (!fails) ok('消费方全部改读派生表');

// 5) 布局种类：manifest.layoutKinds == layout2d ItemKind 集合；每 kind 有精灵/绘制宽/占地
const kindUnion = layoutSrc.match(/export type ItemKind =([\s\S]*?);/)?.[1] ?? '';
const codeKinds = new Set([...kindUnion.matchAll(/'(\w+)'/g)].map((m) => m[1]));
const lkKinds = new Set(Object.keys(ASSET.layoutKinds));
for (const k of codeKinds) if (!lkKinds.has(k)) fail(`ItemKind ${k} 在派生表缺失`);
for (const k of lkKinds) if (!codeKinds.has(k)) fail(`派生表 layoutKind ${k} 在代码中不存在`);
for (const [k, v] of Object.entries(ASSET.layoutKinds)) {
  if (!ASSET.sprites[v.sprite]) fail(`layoutKind ${k} 的精灵 ${v.sprite} 不存在`);
  if (!(v.drawW > 0)) fail(`layoutKind ${k} drawW 非正`);
  if (!(v.foot[0] > 0 && v.foot[1] > 0)) fail(`layoutKind ${k} foot 非正`);
}
const layout = getLayout();
const placedKinds = new Set(layout.items.map((i) => i.kind));
for (const k of placedKinds) if (!ASSET.layoutKinds[k]) fail(`已放置 kind ${k} 无派生条目`);
const colliders = buildingColliders2D();
if (!colliders.length) fail('buildingColliders2D 为空');
else ok(`布局 ${layout.items.length} 件 / 建筑碰撞 ${colliders.length} 个，种类与派生表一致`);

// 6) footOffset 覆盖：非飞行生物精灵必有派生条目（null = 容差内）
const flyKinds = new Set(Object.entries(manifest.creatures as Record<string, { fly?: boolean }>)
  .filter(([, c]) => c.fly).map(([k]) => k));
for (const [kind, c] of Object.entries(ASSET.creatures)) {
  const d = ASSET.sprites[c.sprite];
  if (!d) { fail(`生物 ${kind} 精灵 ${c.sprite} 缺派生`); continue; }
  if (!flyKinds.has(kind) && !('footOffsetPx' in d)) fail(`生物 ${kind} 无 footOffset 派生字段`);
}
ok(`footOffset 覆盖 ${Object.keys(ASSET.creatures).length} 物种（飞行豁免 ${flyKinds.size}）`);

// 7) 碰撞 ↔ 视觉双向（PENDING：需要拍板的口径）
// 7a) 禁林树干盘：145 个服务器碰撞盘 vs 站立视觉树（复刻 renderer 选点口径计数）
const trees = OBSTACLES.filter((o) => o.style === 'tree' && o.kind === 'disc') as { x: number; z: number }[];
const roads = layout.roads;
const roadDist = (x: number, z: number): number => {
  let best = Infinity;
  for (const r of roads) {
    const p = r.pts;
    for (let i = 0; i < p.length - 1; i++) {
      const ax = p[i]!.x, az = p[i]!.z, dx = p[i + 1]!.x - ax, dz = p[i + 1]!.z - az;
      const len2 = dx * dx + dz * dz;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
      best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
    }
  }
  return best;
};
const hash = (x: number, z: number, s: number): number =>
  Math.abs(Math.sin(x * 12.9898 + z * 78.233 + s * 37.719) * 43758.5453) % 1;
const cand = trees.filter((t) =>
  Math.hypot(t.x - 165, t.z - 15) <= 80 && !(Math.abs(t.z - 15) < 7.5 && t.x < 208) &&
  Math.hypot(t.x - 95, t.z - 30) >= 14 && roadDist(t.x, t.z) >= 8);
const order = [...cand].sort((a, b) => hash(a.x, a.z, 1) - hash(b.x, b.z, 1));
const picked: { x: number; z: number }[] = [];
for (const minD of [30, 26, 23]) {
  for (const t of order) {
    if (picked.length >= 17) break;
    if (picked.includes(t)) continue;
    if (picked.some((p) => Math.hypot(p.x - t.x, p.z - t.z) < minD)) continue;
    picked.push(t);
  }
  if (picked.length >= 17) break;
}
const invisible = trees.filter((t) => !picked.includes(t));
pending(`禁林树干碰撞盘 ${trees.length} 个：有站立视觉 ${picked.length} 个，无视觉 ${invisible.length} 个` +
  `（例：${invisible.slice(0, 5).map((t) => `(${t.x.toFixed(0)},${t.z.toFixed(0)})`).join(' ')}）` +
  '——处置待拍板：补视觉（提高选点上限）/ 删碰撞（改 map.ts 生成）/ 保留例外（深林不可及区）');
// 7b) 有视觉无碰撞（既有口径例外）：村庄定点树、林缘疏林带、庭院橡树等装饰树
//     不进服务器碰撞（map.ts 树盘是禁林专用真相），全图一致，登记为例外。
pending('装饰树（村庄定点/林缘带/庭院）有视觉无碰撞：全图既有口径，登记为例外类');

// 8) 模型比例标记（PENDING：工厂重做模型时处理，只标记不阻塞）
const flagged = Object.entries(ASSET.sprites).filter(([, d]) => d.flag);
pending(`模型比例标记 ${flagged.length} 项（偏差 >15%）：${flagged.map(([n]) => n).join(', ')}`);

// 9) 无消费方精灵（PENDING）
pending('char3d-* 20 个精灵无任何客户端消费方（renderCharacterSet 历史产出）：保留工厂能力或删除，待拍板');

console.log(fails ? `\nasset-lint: ${fails} FAIL` : '\nasset-lint: 全部机械检查通过（PENDING 项见上，待拍板）');
process.exit(fails ? 1 : 0);
