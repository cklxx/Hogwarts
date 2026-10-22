// ------------------------------------------------------------------
// layout2d.ts — 2D 客户端地图布局引擎（src/shared：服务器碰撞与客户端绘制共用同一份数据）
//
// 道路网络（贝塞尔采样）+ 带碰撞检测的物件放置。
// 世界坐标，固定种子，输出确定性。单例，构建一次。
//
// 核心原则：src/shared/map.ts 是唯一 truth。服务器障碍物（树木/建筑/
// 湖泊）优先级最高，先注册进碰撞表；layout 只放置装饰物，绝不压盖。
// 建筑类物件的包围盒经 buildingColliders2D() 注册进服务器静态碰撞
// （src/shared/layout.ts props），玩家与生物都不能走进 2D 建筑。
// 设计依据：~/workspace/goals/2d/hidden_files/map-design.md (v2)
// ------------------------------------------------------------------
import { OBSTACLES } from './map.js';
import { ASSET } from './asset-data.js';

export interface Pt { x: number; z: number }
export interface Road { id: string; width: number; pts: Pt[] }
export type ItemKind =
  | 'bush' | 'stone'
  | 'cottage' | 'stonehouse' | 'lamp' | 'brazier'
  | 'well' | 'marketstall' | 'villagegate'
  | 'dock' | 'boat' | 'lighthouse' | 'mooringpost'
  | 'web' | 'glowflower' | 'tent' | 'campfire'
  | 'greenhouse' | 'gardenplot'
  | 'owlery' | 'scoreboard' | 'traininghoop'
  | 'shop' | 'pub' | 'station' | 'library' | 'dormtower'
  | 'flowerbed' | 'bench' | 'scarecrow' | 'beehive' | 'swing'
  | 'signpost' | 'reed' | 'mushroom';
export interface PlacedItem { kind: ItemKind; x: number; z: number; s: number; label?: string; v?: 'moss' | 'rune' | 'curb' }
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

// footprint (world units) per kind — 地面占地（宽 × 地面深，s=1）。
// 不再手抄：读派生表（ASSET.layoutKinds[*].foot，manifest → derive.py）。
// 派生口径分两种（manifest 里逐 kind 声明）：
// - stance：3D 模型地面带截面（站姿占地）× 绘制尺度 × 1.1 余量——物理占地；
// - lot：场地/间隙盒（商店地块、记分牌场、路灯间隙等），值在 manifest 里
//   声明（lotFoot），与物理占地分开，不再混抄成一张表。
// 历史教训：2026-10-21 前本表把总绘制高误记为深度、住宅沿用旧单位，
// 占地虚大 3–8 倍，是村庄住宅/码头/营地成片放置失败的总根因；手抄表
// 与 renderer 登记宽、sprites.json 三处漂移是同类事故，故全量改派生。
const FOOT: Record<ItemKind, [number, number]> = Object.fromEntries(
  Object.entries(ASSET.layoutKinds).map(([k, v]) => [k, v.foot]),
) as Record<ItemKind, [number, number]>;

// --- zone footprints (world, for reference): lake / castle / pitch ---
//    黑湖 [-155,3,-81,77] / 城堡 [-66,-118,66,-40] / 球场 [0,-215,80,-95]
//    对角巷 [-270,80,-130,210] / 海格小屋 [80,102,150,165] / 打人柳 [15,-30,75,30]
//    禁林 disc (server truth): 中心 (165,15) r85
//    注：v2 起删除随机散布，以上仅作坐标参考，不再用于排除逻辑。

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

  const tryPlace = (kind: ItemKind, x: number, z: number, s: number, roadClear: number, label?: string, v?: 'moss' | 'rune' | 'curb'): boolean => {
    // T1 宝可梦式：所有放置对齐到 16px 网格
    x = Math.round(x / 16) * 16;
    z = Math.round(z / 16) * 16;
    const [w, h] = FOOT[kind];
    const { d, road } = distToRoads(roads, x, z);
    if (d < road.width / 2 + roadClear) return false;
    if (overlaps(x - w / 2, z - h / 2, x + w / 2, z + h / 2)) return false;
    register(x, z, w, h);
    items.push({ kind, x, z, s, label, v });
    return true;
  };
  const tryPlaceNear = (kind: ItemKind, x: number, z: number, s: number, roadClear: number, label?: string, v?: 'moss' | 'rune' | 'curb'): boolean => {
    if (tryPlace(kind, x, z, s, roadClear, label, v)) return true;
    for (let i = 0; i < 8; i++) {
      const a = rnd() * Math.PI * 2, r = 4 + rnd() * 8;
      if (tryPlace(kind, x + Math.cos(a) * r, z + Math.sin(a) * r, s, roadClear, label, v)) return true;
    }
    return false;
  };
  // 精确放置（不 snap、不查道路）：给与既有绘制锚点绑定的建筑用
  // （海格石屋：hw 精灵钉在 (105,118)，碰撞须与精灵占地对齐）。
  const placeExact = (kind: ItemKind, x: number, z: number, s: number, w: number, h: number): boolean => {
    if (overlaps(x - w / 2, z - h / 2, x + w / 2, z + h / 2)) return false;
    register(x, z, w, h);
    items.push({ kind, x, z, s });
    return true;
  };

  // 1) 村庄住宅沿 R5 成排（z 150–205），两侧交替 + 第二排 + 村南一排。
  //    2026-10-21 修复（此前 0 栋）：根因链——FOOT 旧值虚大（茅屋 76×60，
  //    实际绘制宽 13）+ 横距 lat 26–34 使候选点 x 落在 ±32 网格列，正压
  //    5 栋命名商店的服务器盒（x 半宽 14–38）+ side 只在成功时翻面，
  //    一侧失败后永远试同一侧。现：FOOT 按实测占地重标（见 FOOT 注），
  //    lat 44–48（snap 后 x=±48，商店盒外缘 ±38 之外），间距 30→14，
  //    每次尝试都翻面。第二排 lat 62–68（x=±64）。村南固定一排 (±48,232)。
  {
    const r5 = roadById('R5');
    const row = (latMin: number, latVar: number, spacing: number, z0: number, z1: number, phase: number, side0: number): void => {
      let acc = 0, lastPlaced = phase, side = side0;
      for (let i = 1; i < r5.pts.length; i++) {
        const a = r5.pts[i - 1], b = r5.pts[i];
        acc += Math.hypot(b.x - a.x, b.z - a.z);
        if (acc - lastPlaced < spacing) continue;
        if (b.z < z0 || b.z > z1) continue;
        const tx = b.x - a.x, tz = b.z - a.z;
        const len = Math.hypot(tx, tz) || 1;
        const nx = -tz / len, nz = tx / len;
        const lat = latMin + rnd() * latVar;
        const hx = b.x + nx * lat * side, hz = b.z + nz * lat * side;
        const kind: ItemKind = rnd() < 0.6 ? 'cottage' : 'stonehouse';
        if (tryPlaceNear(kind, hx, hz, 0.9 + rnd() * 0.2, 2)) lastPlaced = acc;
        side = -side; // 成功失败都翻面：一侧被占不堵死整排
      }
    };
    row(44, 4, 14, 150, 205, -100, 1);
    row(62, 6, 20, 155, 200, -12, -1);
    tryPlaceNear('cottage', -48, 232, 1, 2);
    tryPlaceNear('stonehouse', 48, 232, 1, 2);
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
    tryPlaceNear('flowerbed', -140, 132, 1, 0);
    tryPlaceNear('flowerbed', -140, 162, 1, 0);
  }

  // 5b) 海格小屋区：石屋 + 稻草人 + 蜂箱（南瓜地由 texHagrid 绘制）
  {
    // 石屋与 hw-hagrid-hut 精灵同体：精灵钉在 (105,118)、宽 24、占地深
    // 约 24.6（sprites.json footD/footW）。布局 item 放 (105,124) s=1.6，
    // 注册盒 24×16——buildingColliders2D 由此得 [94.4,115.6]×[109.9,124]，
    // 覆盖精灵主体；南侧 124–130 是门前空地（精灵锚点以南的门廊条带），
    // 故意不设碰撞。旧 tryPlace(105,118,0.85) snap 到 (112,112) 且被
    // R7 道路口径与旧 FOOT 100×76 双杀，常年 0 栋。
    placeExact('stonehouse', 105, 124, 1.6, 24, 16);
    tryPlaceNear('scarecrow', 170, 140, 1, 0);
    tryPlaceNear('beehive', 120, 170, 1, 0);
    tryPlaceNear('beehive', 140, 170, 1, 0);
  }

  // 5c) 打人柳区：观景长椅（树由 texWillow 绘制，server (45,0) r3）
  {
    tryPlaceNear('bench', 64, 18, 1, 0);
    tryPlaceNear('bench', 20, -24, 1, 0);
  }

  // 5d) 新建筑：车站（村西南）/ 图书馆（城堡北）/ 宿舍塔楼（北，避开 server tower (-20,-118)）
  {
    tryPlace('station', -40, 280, 1, 0);
    // 图书馆原放在 (-150,-145)：正盖住考试大厅 HALL (-170,-170)（kernel/exams.ts，
    // 假设 45 m 内无固体）。挪到球场东北高地 (112,-240)，碰撞盒距 HALL 约 234 m，
    // 且与宿舍塔楼/猫头鹰棚屋的放置盒不重叠。
    tryPlace('library', 112, -240, 1, 0);
    tryPlaceNear('dormtower', -20, -208, 1, 0, '#7a1f1f');
  }

  // 5e) 新装饰：花坛 / 长椅 / 秋千 / 蜂箱 / 稻草人
  {
    // 霍格莫德村南空地（server 商店 z<190，秋千 z0>190）
    tryPlaceNear('bench', 0, 196, 1, 3);
    tryPlaceNear('swing', -32, 216, 1, 3);
    tryPlaceNear('swing', 32, 216, 1, 3);
    // 花坛：只在温室旁放 1 个。城堡南带（z -16..-48）被庭院柱
    // (±18,-12/-30)、长椅、温室苗圃三方挤压，历轮花坛盒反复堵死
    // 苗圃 (-32,-16) 与 (-96,-16)——南带不再放花坛（村庄花坛在 4h）。
    tryPlaceNear('flowerbed', -150, -80, 1, 4);
    // 长椅在城堡南广场 (±32,-32)：温室苗圃带（z=-16, x -114..-30）
    // 已被 4 块苗圃占满，长椅无处落——两轮实测各堵一块苗圃
    tryPlaceNear('bench', -36, -44, 1, 4);
    tryPlaceNear('bench', 36, -44, 1, 4);
    // 草甸蜂箱（定点空地）：(-90,70) 旧锚 jitter 后落 (-80,64) 压黑湖
    // 码头东段、(100,-80) 落 (96,-80) 压猫头鹰棚屋、(-100,-40) 落
    // (-96,-32) 压温室苗圃——三锚都挪到各自区域的空带
    tryPlaceNear('beehive', -160, -48, 1, 4);
    tryPlaceNear('beehive', 120, -64, 1, 4);
    tryPlaceNear('beehive', -112, 88, 1, 4);
    tryPlaceNear('beehive', 80, 70, 1, 4);
    // 村庄稻草人（农田感）：东侧旧锚 (40,215) jitter 落 (32,208)
    // 正压水井位，挪到 (56,224) 空带
    tryPlaceNear('scarecrow', -48, 215, 1, 3);
    tryPlaceNear('scarecrow', 56, 224, 1, 3);
  }


  // 3) scatter 已移到所有建筑之后（见文末），保证呼吸空间检查覆盖全部建筑

  // 4) 新地区 v2：6 个独立地区（坐标已避开服务器障碍物和另一 agent 的对角巷/海格小屋/打人柳/看台）
  // 4a) 霍格莫德村完整版：水井 + 集市摊位 + 村门
  //     2026-10-21 坐标全换：snap 网格（16 的倍数）+ 命名商店服务器盒
  //     （三把扫帚 x[-30,-16] z[150,162]、佐科 x[-28,-16] z[178,188]、
  //     蜂蜜公爵 x[14,28] z[150,160]、猪头 x[16,30] z[178,190]）之间
  //     只剩四条空带——井（村南 z=200 带）、摊（z=168 两侧带 + z=208 带）。
  //     旧坐标 (3,180) 等 snap 后不是压路就是压店，常年 0 放置。
  {
    // 村门 (0,140) 先行：门体横跨 R5，tryPlace 的道路口径必然拒绝——
    // 专用放置：只登记两根门柱的占地盒（±24 处各 8×8，与工厂精灵
    // 门柱的视觉位置 ±21 对齐），横梁下可通行。
    {
      const gx = 0, gz = 140;
      let blocked = false;
      for (const s of [-1, 1]) {
        if (overlaps(gx + s * 24 - 4, gz - 4, gx + s * 24 + 4, gz + 4)) blocked = true;
      }
      if (!blocked) {
        for (const s of [-1, 1]) register(gx + s * 24, gz, 8, 8);
        items.push({ kind: 'villagegate', x: gx, z: gz, s: 1 });
      }
    }
    // 水井：村东南空带 (32,208)（西带被 R5 末灯 (16,208) 与井位冲突让出）
    tryPlace('well', 32, 200, 1, 4);
    // 集市摊位 4 个：村口一排（门北 z=128，门柱盒以北 12 单位）+ 村南一排。
    // 中段 z=168/176 两带被 snap 半数取整（168→176）推进商店盒，已弃。
    const stalls: Array<[number, number]> = [[-16, 128], [16, 128], [-16, 224], [16, 224]];
    for (const [sx, sz] of stalls) tryPlaceNear('marketstall', sx, sz, 1, 3);
  }

  // 4b) 黑湖码头：木码头伸入湖中 + 系船柱 + 小船 + 灯塔
  //     湖心 (-118,40) r30，东岸 x=-88。码头从岸边向西延伸（dock bypasses lake exclusion）。
  {
    // 水上放置：只查「本块开始前」的盒（湖泊 disc 登记盒豁免）+ 块内
    // 安装件互检；onPier 件（系船柱）豁免块内互检——柱子本就立在桥面上。
    // 旧实现查全量盒：两段码头间距 16 < 旧 FOOT 宽 20 自相重叠、系船柱
    // 必然压码头盒，码头 1/2、柱/船全灭。坐标按 snap 网格与湖心距校验：
    // 码头两段 x=-80/-96（盒 [-88,-72]/[-104,-88]，恰相接），船在湖心
    // disc（中心 (-118,40) r30）内且避开桥面盒。
    const waterStart = getBoxes().length;
    const placeOnWater = (kind: ItemKind, x: number, z: number, s: number, onPier = false): boolean => {
      x = Math.round(x / 16) * 16;
      z = Math.round(z / 16) * 16;
      const [w, h] = FOOT[kind];
      const x0 = x - w / 2, z0 = z - h / 2, x1 = x + w / 2, z1 = z + h / 2;
      const all = getBoxes();
      for (let i = 0; i < all.length; i++) {
        const b = all[i];
        if (i >= waterStart && onPier) break; // 桥面件跳过块内互检
        if (i < waterStart) {
          const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
          if (Math.abs(cx - (-118)) < 1 && Math.abs(cz - 40) < 1) continue; // 湖泊本身
        }
        if (x0 < b.x1 && x1 > b.x0 && z0 < b.z1 && z1 > b.z0) return false;
      }
      register(x, z, w, h);
      items.push({ kind, x, z, s });
      return true;
    };
    // 码头主体（2 段相接成一条桥）
    placeOnWater('dock', -80, 48, 1);
    placeOnWater('dock', -96, 48, 1);
    // 系船柱（立在桥面上，南北各一）
    placeOnWater('mooringpost', -92, 28, 1, true);
    placeOnWater('mooringpost', -92, 68, 1, true);
    // 小船（桥头以西水面 + 湖南锚泊）
    placeOnWater('boat', -144, 40, 1);
    placeOnWater('boat', -132, 62, 0.9);
    // 灯塔（东岸高地，桥面盒以东；旧点 (-80,28) snap 后压湖 disc 登记
    // 盒，次选点 (-64,32) 被 R2 末灯 (同点) 占——锚点直接给落点 (-48,16)）
    tryPlaceNear('lighthouse', -56, 16, 1, 2);
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
    // 蜘蛛巢穴：3 张蛛网（坐标按 snap 后两两 ≥ FOOT 宽 30 校验；
    // 旧坐标 snap 后两网同点、且旧 FOOT 52 必然互堵，只活 1 张）
    const webs: Array<[number, number]> = [[192, 52], [224, 68], [176, 84]];
    for (const [wx, wz] of webs) placeInForest('web', wx, wz, 0.9 + rnd() * 0.3);
    // 独角兽空地 (130,-30)：8 朵发光花，环形（半径 14→16：snap 后
    // 相邻花距 ≥16 > FOOT 10，8 朵全活；旧半径下 snap 合并只活 4 朵）
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI * 2) / 8;
      placeInForest('glowflower', 130 + Math.cos(a) * 16, -30 + Math.sin(a) * 16, 0.8 + rnd() * 0.4);
    }
    // 马人营地：3 帐篷 + 篝火（旧坐标 snap 后帐篷与篝火同点互堵；
    // 现坐标 snap 后两两 ≥ 帐篷/篝火 FOOT 阈值）
    const tents: Array<[number, number]> = [[174, -28], [206, -28], [190, -4]];
    for (const [tx, tz] of tents) placeInForest('tent', tx, tz, 1);
    placeInForest('campfire', 190, -20, 1);
  }

  // 4d) 魁地奇训练场：(-50,-160)，主球场以西。小型场地+球门+记分牌
  //     中心由 -150 南移到 -160：北排球门 z=-120 时占地盒 z[-125,-115]
  //     压城堡服务器包围盒南缘（z=-118），整排被拒。
  {
    const cx = -50, cz = -160;
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
    // 两栋沿西线，第三栋挪到训练场西 (-100,-150)：原第三栋 (10,-60)
    // 落在城堡服务器包围盒（x[-66,66] z[-118,-40]）内，任何 FOOT 都放不出。
    tryPlace('greenhouse', gx - 100, gz, 1, 0);
    tryPlace('greenhouse', gx, gz, 1, 0);
    tryPlace('greenhouse', -100, -150, 1, 0);
    // 第三块由 gx+50 改 gx+42：snap 后中心 (-48,-16)，占地盒东缘 -30
    // 恰避开庭院柱 disc (-18,-12) 的登记盒（旧中心 -32 时盒东缘 -14 压柱）
    const plots: Array<[number, number]> = [
      [gx - 50, gz + 50], [gx, gz + 50], [gx + 42, gz + 50], [gx, gz - 50],
    ];
    for (const [px, pz] of plots) tryPlace('gardenplot', px, pz, 1, 0);
  }

  // 4f) 猫头鹰棚屋：东北高塔。旧点 (80,-90) snap 后 (80,-96)，占地盒
  //      与狮院塔服务器盒（x[50,62] z[-114,-102]）相交；东移至 (96,-80)，
  //      恰在时钟塔盒（x[61,71]）东侧 1 单位外。
  {
    tryPlaceNear('owlery', 88, -84, 1, 0);
  }

  // 4g) 区域视觉语言：城堡火盆（8 个，沿城墙/入口）
  //     城堡 x -62..62, z -118..-40。入口在南侧 z=-40。
  //     火盆 FOOT 高 24（半高 12），z 必须 ≥ -28 才不压城堡盒。
  {
    const braziers: Array<[number, number]> = [
      [28, -20], [48, -20],                       // 南墙外东排（snap z=-16）
      [-48, -48], [-16, -64],                     // 西排贴墙（z=-16 带西段是温室苗圃，火盆让带）
      [-72, -50], [72, -50],                      // 城堡东南/西南角
      [-88, -88], [72, -110],                     // 西墙中段 / 东北角（NW 旧点被苗圃 4 号 (-96,-112) 占地盒压住）
    ];
    for (const [bx, bz] of braziers) tryPlaceNear('brazier', bx, bz, 1, 6);
  }

  // 4h) 区域视觉语言：村庄花坛（6 个，沿主路 R5）
  {
    const beds: Array<[number, number]> = [
      [-12, 155], [14, 158], [-14, 175], [16, 178], [-10, 195], [12, 198],
    ];
    for (const [fx, fz] of beds) tryPlace('flowerbed', fx, fz, 1, 4);
  }

  // 4i) 物品 v1：告示牌（岔路口）+ 芦苇（黑湖岸）
  {
    // 岔路口：R1/R4、R1/R2、R1/R5。锚点避开路灯位（灯先放，牌后放，
    // 同点必败）：R1/R4 牌落 (16,16)，R1/R2 牌落 (-32,48)
    const junctions: Array<[number, number]> = [[20, 8], [-24, 52], [6, 146]];
    for (const [jx, jz] of junctions) tryPlaceNear('signpost', jx, jz, 1, 4);
    // 黑湖岸芦苇：湖心 (-118,40) r30，沿南岸弧线（东岸已被码头盒占满，
    // 旧东南弧大半落进桥面/船盒）。弧半径 lakeR+12 起（旧 +6 落湖
    // disc 登记盒内全灭）；tryPlaceNear 兜底避让岸边石
    const lakeCx = -118, lakeCz = 40, lakeR = 30;
    for (let i = 0; i < 8; i++) {
      const a = Math.PI * (0.40 + i * 0.057); // 南岸弧
      const rx = lakeCx + Math.cos(a) * (lakeR + 12 + rnd() * 8);
      const rz = lakeCz + Math.sin(a) * (lakeR + 12 + rnd() * 8);
      tryPlaceNear('reed', rx, rz, 0.8 + rnd() * 0.5, 0);
    }
  }

  // 3) 石头系统性重做 v1：每块石头都有含义，删除随机散布。
  //    5 种场景：边界石 / 石阵 / 路缘石 / 石堆石墙 / 湖畔石。总数 ≤ 60。
  //    variant: moss=边界石（苔藓）/ rune=石阵（符文）/ curb=路缘石（小而扁）
  {
    const stone = (x: number, z: number, s: number, v?: 'moss' | 'rune' | 'curb', roadClear = 2): boolean =>
      tryPlaceNear('stone', x, z, s, roadClear, undefined, v);

    // 3a) 边界石：每处入口 1 块醒目巨石，moss 变体，s 1.6（地标感）
    //   roadClear=0：界石就立在路边。tryPlaceNear 8 次兜底找空位
    //   - 禁林入口：R4 中段，"前面是禁林"
    stone(48, 2, 1.6, 'moss', 0);
    //   - 黑湖：R2 中段，"前面是黑湖"
    stone(-60, 48, 1.6, 'moss', 0);
    //   - 城堡南门：R1 起点
    stone(0, -32, 1.6, 'moss', 0);

    // 3b) 石阵：禁林深处残破石圈，rune 变体。4 块（残缺感更神秘），中心 (180,22) 半径 16
    //   实测 (194,30)/(166,14) 有空位，其余靠 tryPlaceNear 兜底
    stone(194, 30, 1.3, 'rune', 0);
    stone(166, 14, 1.3, 'rune', 0);
    stone(180, 38, 1.25, 'rune', 0);
    stone(196, 12, 1.35, 'rune', 0);

    // 3c) 路缘石：道路两侧小扁石，curb 变体，沿 R1/R5/R7 每 ~14 单位交替
    for (const rid of ['R1', 'R5', 'R7']) {
      const r = roadById(rid);
      let acc = 0, last = -100, side = 1, count = 0;
      for (let i = 1; i < r.pts.length && count < 8; i++) {
        const a = r.pts[i - 1], b = r.pts[i];
        acc += Math.hypot(b.x - a.x, b.z - a.z);
        if (acc - last < 14) continue;
        const tx = b.x - a.x, tz = b.z - a.z;
        const len = Math.hypot(tx, tz) || 1;
        const cx = b.x + (-tz / len) * 5.5 * side, cz = b.z + (tx / len) * 5.5 * side;
        if (stone(cx, cz, 0.55 + (count % 3) * 0.1, 'curb', 0)) { last = acc; side = -side; count++; }
      }
    }

    // 3d) 石堆/石墙：生活气息
    //   - 海格小屋菜园石堆：(95,150) 簇 3 块
    stone(92, 148, 0.9); stone(99, 152, 1.0); stone(95, 156, 0.8);
    //   - 温室旁石墙残段：(-40,-60) 排 4 块成墙
    stone(-52, -58, 1.0); stone(-44, -60, 1.1); stone(-36, -59, 1.0); stone(-28, -61, 0.9);
    //   - 村庄石墙残段：(20,190) 排 3 块
    stone(14, 188, 1.0); stone(22, 190, 1.1); stone(30, 189, 0.9);

    // 3e) 湖畔石：黑湖岸鹅卵石，沿东岸 (x=-79) 和北岸 (z=5) 小石 10 块
    const shore: Array<[number, number]> = [
      [-76, 12], [-74, 28], [-77, 44], [-75, 60], [-78, 72],
      [-148, 8], [-132, 6], [-116, 8], [-100, 6], [-88, 10],
    ];
    for (const [sx, sz] of shore) stone(sx, sz, 0.5 + ((sx + sz) % 3) * 0.15, undefined, 0);
  }

  // 3g) 蘑菇：只在禁林深处（神秘感）。石阵周围 + 蜘蛛巢附近，2-3 朵一簇。
  //    为什么在这里：潮湿阴暗的禁林深处才长毒蘑菇，石阵的神秘感需要它们。
  //    传达什么：这里很深、很古老、别乱吃。
  //    不放会怎样：石阵周围光秃，神秘感减半。
  //    注：禁林树密，用 20 次宽范围兜底（r 4-20）
  {
    const shroom = (x: number, z: number): boolean => {
      for (let i = 0; i < 20; i++) {
        const a = rnd() * Math.PI * 2, r = i === 0 ? 0 : 4 + rnd() * 16;
        if (tryPlace('mushroom', x + Math.cos(a) * r, z + Math.sin(a) * r, 0.9 + rnd() * 0.3, 0)) return true;
      }
      return false;
    };
    // 石阵周围 (180,22)：4 簇
    shroom(168, 30); shroom(192, 28); shroom(174, 12); shroom(188, 16);
    // 蜘蛛巢 (200,60) 附近：3 簇
    shroom(208, 68); shroom(192, 72); shroom(204, 52);
    // 独角兽空地边缘 (130,-30)：2 簇（空地边缘的潮湿处）
    shroom(118, -22); shroom(142, -38);
  }

  // 3f) 灌木语义化 v2：删除 110 随机散布。灌木只做"镶边"用，不再单独乱长。
  //    三个语义：建筑底座镶边 / 道路转弯处 / 花坛配植。
  //    为什么在这里：灌木是人工修剪的痕迹，出现在人工物旁边才有含义。
  //    传达什么：这里有人打理 / 路要转弯了 / 花坛的配植。
  //    不放会怎样：建筑底座光秃、转弯处无提示、花坛孤零。
  {
    const bush = (x: number, z: number, s: number): boolean =>
      tryPlaceNear('bush', x, z, s, 2);
    let placed = 0;

    // (1) 建筑底座镶边：每栋建筑底座两侧各 1 丛
    //     灌木半宽 12，留 4 单位间隙：x 偏移 = w/2 + 16
    const BUILDING_KINDS = new Set(['cottage', 'stonehouse', 'shop', 'pub', 'station',
      'library', 'dormtower', 'greenhouse', 'owlery']);
    for (const it of items) {
      if (!BUILDING_KINDS.has(it.kind)) continue;
      const [w] = FOOT[it.kind];
      // 底座左右角外侧
      if (bush(it.x - w / 2 - 16, it.z + 12, 0.9)) placed++;
      if (bush(it.x + w / 2 + 16, it.z + 12, 0.9)) placed++;
    }

    // (2) 道路转弯处：方向变化 > 35° 的拐点，外侧放 1 丛（提示转弯）
    for (const r of roads) {
      for (let i = 2; i < r.pts.length - 2; i += 3) {
        const a = r.pts[i - 2], b = r.pts[i], c = r.pts[i + 2];
        const v1x = b.x - a.x, v1z = b.z - a.z, v2x = c.x - b.x, v2z = c.z - b.z;
        const dot = v1x * v2x + v1z * v2z;
        const m1 = Math.hypot(v1x, v1z) || 1, m2 = Math.hypot(v2x, v2z) || 1;
        const ang = Math.acos(Math.max(-1, Math.min(1, dot / (m1 * m2)))) * 180 / Math.PI;
        if (ang > 35) {
          // 拐点外侧：转弯方向的反方向偏移
          const nx = -(v1z + v2z) / 2, nz = (v1x + v2x) / 2;
          const nl = Math.hypot(nx, nz) || 1;
          if (bush(b.x + (nx / nl) * 10, b.z + (nz / nl) * 10, 0.8)) placed++;
        }
      }
    }

    // (3) 花坛配植：每个花坛旁边 1 丛（花坛半宽 14 + 灌木半宽 12 + 间隙 4 = 30）
    for (const it of items) {
      if (it.kind !== 'flowerbed') continue;
      if (bush(it.x + 30, it.z + 4, 0.7)) placed++;
    }
    // console.log('[layout] semantic bushes:', placed);
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

// --- 建筑碰撞盒（服务器静态碰撞注册用） ------------------------------------------------
// 与 buildLayout 内灌木镶边用的 BUILDING_KINDS 保持一致。绘制约定（历史口径）：
// 建筑以 item.z 为南墙基线向北展开，地面包围盒 = [x-W/2, z-H, x+W/2, z]，
// W/H = FOOT × s；横向内缩 6%（屋檐）、北侧内缩 12%（只有屋顶的条带不算墙体）。
// 注：绘制层已全量工厂精灵化（2026-10-22），此碰撞口径只管碰撞、与视觉无关。
const COLLIDER_KINDS = new Set(['cottage', 'stonehouse', 'shop', 'pub', 'station',
  'library', 'dormtower', 'greenhouse', 'owlery']);
export interface BuildingBox { x0: number; z0: number; x1: number; z1: number; kind: ItemKind }
export function buildingColliders2D(): BuildingBox[] {
  const out: BuildingBox[] = [];
  for (const it of getLayout().items) {
    if (!COLLIDER_KINDS.has(it.kind)) continue;
    const [fw, fh] = FOOT[it.kind];
    const W = fw * it.s, H = fh * it.s;
    out.push({
      x0: it.x - W / 2 + W * 0.06, z0: it.z - H + H * 0.12,
      x1: it.x + W / 2 - W * 0.06, z1: it.z, kind: it.kind,
    });
  }
  return out;
}
