// ------------------------------------------------------------------
// layout.ts — 地图布局引擎
//
// 道路网络（贝塞尔采样）+ 带碰撞检测的物件放置。
// 世界坐标，固定种子，输出确定性。单例，构建一次。
//
// 核心原则：src/shared/map.ts 是唯一 truth。服务器障碍物（树木/建筑/
// 湖泊）优先级最高，先注册进碰撞表；layout 只放置装饰物，绝不压盖。
// 设计依据：~/workspace/goals/2d/hidden_files/map-design.md (v2)
// ------------------------------------------------------------------
import { OBSTACLES } from '../../src/shared/map.js';

export interface Pt { x: number; z: number }
export interface Road { id: string; width: number; pts: Pt[] }
export type ItemKind =
  | 'bush' | 'stone'
  | 'cottage' | 'stonehouse' | 'lamp'
  | 'well' | 'marketstall' | 'villagegate'
  | 'dock' | 'boat' | 'lighthouse' | 'mooringpost'
  | 'web' | 'glowflower' | 'tent' | 'campfire'
  | 'greenhouse' | 'gardenplot'
  | 'owlery' | 'scoreboard' | 'traininghoop'
  | 'shop' | 'pub' | 'station' | 'library' | 'dormtower'
  | 'flowerbed' | 'bench' | 'scarecrow' | 'beehive' | 'swing';
export interface PlacedItem { kind: ItemKind; x: number; z: number; s: number; label?: string }
export interface LayoutResult { roads: Road[]; items: PlacedItem[] }

// --- seeded rng (mulberry32) ---
type Rnd = () => number;
function mulberry(seed: number): Rnd {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- collision registry: AABB overlap ---
interface Box { x0: number; z0: number; x1: number; z1: number }
const boxes: Box[] = [];
function overlaps(x0: number, z0: number, x1: number, z1: number, margin = 0): boolean {
  for (const b of boxes) {
    if (x0 - margin < b.x1 && x1 + margin > b.x0 && z0 - margin < b.z1 && z1 + margin > b.z0) return true;
  }
  return false;
}
function register(x: number, z: number, w: number, h: number): void {
  boxes.push({ x0: x - w / 2, z0: z - h / 2, x1: x + w / 2, z1: z + h / 2 });
}
function registerBox(x0: number, z0: number, x1: number, z1: number): void {
  boxes.push({ x0, z0, x1, z1 });
}
// test/debug: expose collision boxes
export function getBoxes(): Box[] { return boxes; }

// footprint (world units) per kind — from art-framework.md
const FOOT: Record<ItemKind, [number, number]> = {
  bush: [24, 18], stone: [16, 12],
  cottage: [76, 60], stonehouse: [100, 76],
  lamp: [12, 48],
  well: [36, 44], marketstall: [44, 52], villagegate: [52, 58],
  dock: [20, 68], boat: [40, 22], lighthouse: [28, 76], mooringpost: [12, 24],
  web: [52, 52], glowflower: [16, 20], tent: [52, 44], campfire: [24, 24],
  greenhouse: [84, 60], gardenplot: [36, 28],
  owlery: [52, 144], scoreboard: [44, 36], traininghoop: [20, 52],
  shop: [76, 68], pub: [114, 88], station: [148, 68], library: [108, 98], dormtower: [64, 144],
  flowerbed: [28, 20], bench: [28, 24], scarecrow: [20, 48], beehive: [18, 26], swing: [36, 48],
};

// --- exclusion rects (world): lake / castle / pitch footprints ---
const EXCLUDE: Array<[number, number, number, number]> = [
  [-155, 3, -81, 77],    // 黑湖（含岸）
  [-66, -118, 66, -40],  // 城堡
  [0, -215, 80, -95],    // 魁地奇球场（含看台）
  [-270, 80, -130, 210], // 对角巷
  [80, 102, 150, 165],   // 海格小屋区
  [15, -30, 75, 30],     // 打人柳区
];
function inExclude(x: number, z: number): boolean {
  for (const [x0, z0, x1, z1] of EXCLUDE) {
    if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return true;
  }
  return false;
}

// --- forest disc (server truth):禁林树木范围 ---
const FOREST = { x: 165, z: 15, r: 85 };
function inForestDeep(x: number, z: number, shrink = 20): boolean {
  return Math.hypot(x - FOREST.x, z - FOREST.z) < FOREST.r - shrink;
}

// --- roads: catmull-rom through control points, sampled every ~4 units ---
function catmull(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const t2 = t * t, t3 = t2 * t;
  return {
    x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    z: 0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
  };
}
function sampleRoad(ctrl: Pt[], step = 4): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    const segLen = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const n = Math.max(2, Math.ceil(segLen / step));
    for (let j = i === 0 ? 0 : 1; j <= n; j++) pts.push(catmull(p0, p1, p2, p3, j / n));
  }
  return pts;
}

interface RoadDef { id: string; width: number; ctrl: Pt[] }
const ROAD_DEFS: RoadDef[] = [
  { id: 'R1', width: 7, ctrl: [
    { x: 0, z: -40 }, { x: 8, z: -10 }, { x: -6, z: 30 }, { x: -10, z: 80 },
    { x: 5, z: 110 }, { x: 0, z: 140 },
  ]},
  { id: 'R5', width: 5, ctrl: [
    { x: 0, z: 140 }, { x: -2, z: 160 }, { x: 3, z: 180 }, { x: 0, z: 205 },
  ]},
  { id: 'R2', width: 4, ctrl: [
    { x: -10, z: 55 }, { x: -40, z: 50 }, { x: -65, z: 45 }, { x: -80, z: 40 },
  ]},
  { id: 'R3', width: 4, ctrl: [
    { x: 5, z: -60 }, { x: 20, z: -80 }, { x: 35, z: -95 }, { x: 40, z: -112 },
  ]},
  { id: 'R4', width: 3, ctrl: [
    { x: 8, z: -10 }, { x: 30, z: -2 }, { x: 55, z: 8 }, { x: 75, z: 15 },
  ]},
  { id: 'R6', width: 5, ctrl: [
    { x: -10, z: 80 }, { x: -60, z: 88 }, { x: -100, z: 100 }, { x: -125, z: 120 },
  ]},
  { id: 'R7', width: 4, ctrl: [
    { x: 40, z: 40 }, { x: 65, z: 65 }, { x: 90, z: 95 }, { x: 108, z: 118 },
  ]},
];

// min distance from point to any road centerline; also returns the road
function distToRoads(roads: Road[], x: number, z: number): { d: number; road: Road } {
  let best = Infinity, bestRoad = roads[0];
  for (const r of roads) {
    const p = r.pts;
    for (let i = 0; i < p.length - 1; i++) {
      const ax = p[i].x, az = p[i].z, bx = p[i + 1].x, bz = p[i + 1].z;
      const dx = bx - ax, dz = bz - az;
      const len2 = dx * dx + dz * dz;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
      if (d < best) { best = d; bestRoad = r; }
    }
  }
  return { d: best, road: bestRoad };
}

// --- main builder ---
function buildLayout(): LayoutResult {
  const rnd = mulberry(20261018);

  // 0) 服务器障碍物先注册（最高优先级）：box 直接注册，disc 按包围盒注册
  for (const o of OBSTACLES) {
    if (o.kind === 'box') registerBox(o.x0, o.z0, o.x1, o.z1);
    else register(o.x, o.z, o.r * 2, o.r * 2);
  }

  const roads: Road[] = ROAD_DEFS.map((d) => ({ id: d.id, width: d.width, pts: sampleRoad(d.ctrl) }));
  const items: PlacedItem[] = [];
  const roadById = (id: string): Road => roads.find((r) => r.id === id)!;

  const tryPlace = (kind: ItemKind, x: number, z: number, s: number, roadClear: number, label?: string): boolean => {
    // T1 宝可梦式：所有放置对齐到 16px 网格
    x = Math.round(x / 16) * 16;
    z = Math.round(z / 16) * 16;
    const [w, h] = FOOT[kind];
    const { d, road } = distToRoads(roads, x, z);
    if (d < road.width / 2 + roadClear) return false;
    if (overlaps(x - w / 2, z - h / 2, x + w / 2, z + h / 2)) return false;
    register(x, z, w, h);
    items.push({ kind, x, z, s, label });
    return true;
  };
  const tryPlaceNear = (kind: ItemKind, x: number, z: number, s: number, roadClear: number, label?: string): boolean => {
    if (tryPlace(kind, x, z, s, roadClear, label)) return true;
    for (let i = 0; i < 8; i++) {
      const a = rnd() * Math.PI * 2, r = 4 + rnd() * 8;
      if (tryPlace(kind, x + Math.cos(a) * r, z + Math.sin(a) * r, s, roadClear, label)) return true;
    }
    return false;
  };

  // 1) village infill buildings along R5 (z 150–205), alternating sides
  //    服务器 5 栋命名建筑已注册，不会重叠
  {
    const r5 = roadById('R5');
    let acc = 0, lastPlaced = -100, side = 1;
    for (let i = 1; i < r5.pts.length; i++) {
      const a = r5.pts[i - 1], b = r5.pts[i];
      acc += Math.hypot(b.x - a.x, b.z - a.z);
      if (acc - lastPlaced < 30) continue;
      if (b.z < 150 || b.z > 205) continue;
      const tx = b.x - a.x, tz = b.z - a.z;
      const len = Math.hypot(tx, tz) || 1;
      const nx = -tz / len, nz = tx / len;
      const lat = 26 + rnd() * 8;
      const hx = b.x + nx * lat * side, hz = b.z + nz * lat * side;
      const kind: ItemKind = rnd() < 0.6 ? 'cottage' : 'stonehouse';
      if (tryPlaceNear(kind, hx, hz, 0.9 + rnd() * 0.2, 2)) { lastPlaced = acc; side = -side; }
    }
  }

  // 2) lamps along R1/R2/R3/R5 every 25 units, alternating sides; 2 at R4 entrance
  {
    for (const r of ['R1', 'R2', 'R3', 'R5'].map(roadById)) {
      let acc = 0, last = -100, side = 1;
      for (let i = 1; i < r.pts.length; i++) {
        const a = r.pts[i - 1], b = r.pts[i];
        acc += Math.hypot(b.x - a.x, b.z - a.z);
        if (acc - last < 25) continue;
        const tx = b.x - a.x, tz = b.z - a.z;
        const len = Math.hypot(tx, tz) || 1;
        const lx = b.x + (-tz / len) * 6 * side, lz = b.z + (tx / len) * 6 * side;
        if (tryPlaceNear('lamp', lx, lz, 1, 1)) { last = acc; side = -side; }
      }
    }
    const r4 = roadById('R4');
    tryPlace('lamp', r4.pts[1].x + 5, r4.pts[1].z - 5, 1, 1);
    tryPlace('lamp', r4.pts[2].x - 5, r4.pts[2].z + 5, 1, 1);
  }

  // 5) 内容扩充 v1：对角巷 / 海格小屋 / 打人柳 / 新建筑 / 新装饰
  // 坐标均经碰撞表校验（server OBSTACLES + 已放置），tryPlaceNear 兜底 8 次
  // 5a) 对角巷商铺：街道 x=-200，东 1 间 + 西 1 间 + 南端酒吧
  {
    tryPlaceNear('shop', -158, 130, 0.8, 0, '蜂蜜公爵');
    tryPlaceNear('shop', -242, 155, 0.8, 0, '奥利凡德');
    tryPlaceNear('pub', -200, 236, 0.85, 0, '三把扫帚');
    tryPlaceNear('flowerbed', -185, 105, 1, 0);
    tryPlaceNear('flowerbed', -215, 168, 1, 0);
  }

  // 5b) 海格小屋区：石屋 + 稻草人 + 蜂箱（南瓜地由 texHagrid 绘制）
  {
    tryPlace('stonehouse', 105, 118, 0.85, 0);
    tryPlaceNear('scarecrow', 170, 140, 1, 0);
    tryPlaceNear('beehive', 170, 110, 1, 0);
    tryPlaceNear('beehive', 178, 122, 1, 0);
  }

  // 5c) 打人柳区：观景长椅（树由 texWillow 绘制，server (45,0) r3）
  {
    tryPlaceNear('bench', 64, 18, 1, 0);
    tryPlaceNear('bench', 26, -16, 1, 0);
  }

  // 5d) 新建筑：车站（村南）/ 图书馆（西北）/ 宿舍塔楼（北）
  {
    tryPlace('station', 30, 258, 1, 0);
    tryPlace('library', -150, -145, 1, 0);
    tryPlace('dormtower', -20, -200, 1, 0, '#7a1f1f');
  }

  // 5e) 新装饰：花坛 / 长椅 / 秋千 / 蜂箱 / 稻草人
  {
    // 霍格莫德村南空地（server 商店在 z<190，此处 z 195-210）
    tryPlaceNear('flowerbed', -15, 198, 1, 3);
    tryPlaceNear('flowerbed', 15, 198, 1, 3);
    tryPlaceNear('bench', 0, 206, 1, 3);
    tryPlaceNear('swing', -24, 200, 1, 3);
    tryPlaceNear('swing', 24, 200, 1, 3);
    // 城堡南草坪（避开 R1、喷泉、庭院柱）
    tryPlaceNear('flowerbed', -34, -28, 1, 4);
    tryPlaceNear('flowerbed', 34, -28, 1, 4);
    tryPlaceNear('flowerbed', -52, -28, 1, 4);
    tryPlaceNear('flowerbed', 52, -28, 1, 4);
    tryPlaceNear('bench', -44, -24, 1, 4);
    tryPlaceNear('bench', 44, -24, 1, 4);
    // 草甸蜂箱（定点空地）
    tryPlaceNear('beehive', -60, -20, 1, 4);
    tryPlaceNear('beehive', 60, -52, 1, 4);
    tryPlaceNear('beehive', -70, 24, 1, 4);
    tryPlaceNear('beehive', 70, 44, 1, 4);
    // 村庄稻草人（农田感）
    tryPlaceNear('scarecrow', -40, 215, 1, 3);
    tryPlaceNear('scarecrow', 40, 215, 1, 3);
  }


  // 3) scatter: 220 bushes + 160 stones in meadow/fringe, collision-checked
  //    服务器障碍物（含树木）已注册，不会压盖
  {
    let placedBush = 0, placedStone = 0, guard = 0;
    const tryScatter = (kind: 'bush' | 'stone'): boolean => {
      const x = -260 + rnd() * 520, z = -260 + rnd() * 560;
      if (inExclude(x, z)) return false;
      if (inForestDeep(x, z)) return false;
      if (x > -50 && x < 80 && z > 140 && z < 220) return false; // 村庄内部
      if (x > -270 && x < -130 && z > 80 && z < 210) return false; // 对角巷
      if (x > 80 && x < 150 && z > 102 && z < 165) return false; // 海格小屋区
      if (x > 15 && x < 75 && z > -30 && z < 30) return false; // 打人柳区
      return tryPlace(kind, x, z, 0.8 + rnd() * 0.4, 3);
    };
    while (placedBush < 220 && guard++ < 3000) if (tryScatter('bush')) placedBush++;
    guard = 0;
    while (placedStone < 160 && guard++ < 3000) if (tryScatter('stone')) placedStone++;
  }

  // 4) 新地区 v2：6 个独立地区（坐标已避开服务器障碍物和另一 agent 的对角巷/海格小屋/打人柳/看台）
  // 4a) 霍格莫德村完整版：广场水井 + 集市摊位 + 村门
  {
    // 村广场水井 (3,180)
    tryPlace('well', 3, 180, 1, 4);
    // 集市摊位：广场周围 4 个
    const stalls: Array<[number, number]> = [[-14, 172], [20, 174], [-12, 188], [18, 190]];
    for (const [sx, sz] of stalls) tryPlaceNear('marketstall', sx, sz, 1, 3);
    // 村门：村口 (0,140)
    tryPlace('villagegate', 0, 140, 1, 6);
  }

  // 4b) 黑湖码头：木码头伸入湖中 + 系船柱 + 小船 + 灯塔
  //     湖心 (-118,40) r30，东岸 x=-88。码头从岸边向西延伸（dock bypasses lake exclusion）。
  {
    const dockX = -92, dockZ = 40;
    // 手动注册码头（跳过 inExclude，因为码头本就该在水上）
    // 注意：跳过与湖泊 disc 的重叠检测（码头建在水上是设计意图），但仍避开其他障碍物
    const placeOnWater = (kind: ItemKind, x: number, z: number, s: number): boolean => {
      x = Math.round(x / 16) * 16;
      z = Math.round(z / 16) * 16;
      const [w, h] = FOOT[kind];
      const x0 = x - w / 2, z0 = z - h / 2, x1 = x + w / 2, z1 = z + h / 2;
      // 自定义重叠检测：跳过湖泊包围盒（中心 -118,40）
      for (const b of getBoxes()) {
        const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
        if (Math.abs(cx - (-118)) < 1 && Math.abs(cz - 40) < 1) continue; // 湖泊本身
        if (x0 < b.x1 && x1 > b.x0 && z0 < b.z1 && z1 > b.z0) return false;
      }
      register(x, z, w, h);
      items.push({ kind, x, z, s });
      return true;
    };
    // 码头主体（2 段）
    placeOnWater('dock', dockX, dockZ, 1);
    placeOnWater('dock', dockX - 16, dockZ, 1);
    // 系船柱（码头两侧）
    placeOnWater('mooringpost', dockX - 8, dockZ - 12, 1);
    placeOnWater('mooringpost', dockX - 8, dockZ + 12, 1);
    // 小船（码头旁水面）
    placeOnWater('boat', dockX - 8, dockZ - 24, 1);
    placeOnWater('boat', dockX - 24, dockZ + 20, 0.9);
    // 灯塔（岸上，避开湖 exclusion）
    tryPlace('lighthouse', -80, 28, 1, 2);
  }

  // 4c) 禁林深处：蜘蛛巢穴 + 独角兽空地 + 马人营地
  //     森林 disc (165,15) r85。树木由服务器放置，这里只放特色物。
  //     注意：禁林内树木密集，特色物允许与树木轻微重叠（蛛网本就挂在树上）
  {
    const placeInForest = (kind: ItemKind, x: number, z: number, s: number): boolean => {
      x = Math.round(x / 16) * 16;
      z = Math.round(z / 16) * 16;
      const [w, h] = FOOT[kind];
      // 只避开其他特色物，不避开树木（树木是环境）
      for (const it of items) {
        if (['web', 'glowflower', 'tent', 'campfire'].includes(it.kind)) {
          const [ow, oh] = FOOT[it.kind];
          if (Math.abs(it.x - x) < (w + ow) / 2 && Math.abs(it.z - z) < (h + oh) / 2) return false;
        }
      }
      items.push({ kind, x, z, s });
      return true;
    };
    // 蜘蛛巢穴 (200,60)：3 张蛛网
    const webs: Array<[number, number]> = [[200, 60], [214, 52], [190, 70]];
    for (const [wx, wz] of webs) placeInForest('web', wx, wz, 0.9 + rnd() * 0.3);
    // 独角兽空地 (130,-30)：8 朵发光花，环形
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI * 2) / 8;
      placeInForest('glowflower', 130 + Math.cos(a) * 14, -30 + Math.sin(a) * 14, 0.8 + rnd() * 0.4);
    }
    // 马人营地 (190,-20)：3 帐篷 + 篝火
    const tents: Array<[number, number]> = [[182, -26], [198, -26], [190, -12]];
    for (const [tx, tz] of tents) placeInForest('tent', tx, tz, 1);
    placeInForest('campfire', 190, -20, 1);
  }

  // 4d) 魁地奇训练场：(-50,-150)，主球场以西。小型场地+球门+记分牌
  {
    const cx = -50, cz = -150;
    // 6 个训练球门（南北各 3）
    for (const k of [-1, 0, 1]) {
      tryPlace('traininghoop', cx + k * 20, cz - 30, 1, 0);
      tryPlace('traininghoop', cx + k * 20, cz + 30, 1, 0);
    }
    // 记分牌（场边）
    tryPlace('scoreboard', cx + 40, cz, 1, 0);
  }

  // 4e) 草药课温室群：(-90,-60)，城堡以西。3 温室 + 4 苗圃
  {
    const gx = -90, gz = -60;
    for (let i = 0; i < 3; i++) {
      tryPlace('greenhouse', gx + (i - 1) * 100, gz, 1, 0);
    }
    const plots: Array<[number, number]> = [
      [gx - 50, gz + 50], [gx, gz + 50], [gx + 50, gz + 50], [gx, gz - 50],
    ];
    for (const [px, pz] of plots) tryPlace('gardenplot', px, pz, 1, 0);
  }

  // 4f) 猫头鹰棚屋：(80,-90)，东北高塔
  {
    tryPlace('owlery', 80, -90, 1, 0);
  }

  return { roads, items };
}

// --- singleton ---
let _layout: LayoutResult | null = null;
export function getLayout(): LayoutResult {
  if (!_layout) _layout = buildLayout();
  return _layout;
}

export function itemsInRect(r: LayoutResult, x0: number, z0: number, x1: number, z1: number): PlacedItem[] {
  return r.items.filter((i) => i.x >= x0 && i.x <= x1 && i.z >= z0 && i.z <= z1);
}

export { distToRoads };
