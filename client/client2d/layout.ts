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
  | 'cottage' | 'stonehouse' | 'lamp';
export interface PlacedItem { kind: ItemKind; x: number; z: number; s: number }
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

// footprint (world units) per kind — from art-framework.md
const FOOT: Record<ItemKind, [number, number]> = {
  bush: [24, 18], stone: [16, 12],
  cottage: [76, 60], stonehouse: [100, 76],
  lamp: [12, 48],
};

// --- exclusion rects (world): lake / castle / pitch footprints ---
const EXCLUDE: Array<[number, number, number, number]> = [
  [-155, 3, -81, 77],    // 黑湖（含岸）
  [-66, -118, 66, -40],  // 城堡
  [0, -190, 80, -110],   // 魁地奇球场
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

  const tryPlace = (kind: ItemKind, x: number, z: number, s: number, roadClear: number): boolean => {
    // T1 宝可梦式：所有放置对齐到 16px 网格
    x = Math.round(x / 16) * 16;
    z = Math.round(z / 16) * 16;
    const [w, h] = FOOT[kind];
    const { d, road } = distToRoads(roads, x, z);
    if (d < road.width / 2 + roadClear) return false;
    if (overlaps(x - w / 2, z - h / 2, x + w / 2, z + h / 2)) return false;
    register(x, z, w, h);
    items.push({ kind, x, z, s });
    return true;
  };
  const tryPlaceNear = (kind: ItemKind, x: number, z: number, s: number, roadClear: number): boolean => {
    if (tryPlace(kind, x, z, s, roadClear)) return true;
    for (let i = 0; i < 8; i++) {
      const a = rnd() * Math.PI * 2, r = 4 + rnd() * 8;
      if (tryPlace(kind, x + Math.cos(a) * r, z + Math.sin(a) * r, s, roadClear)) return true;
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

  // 3) scatter: 90 bushes + 60 stones in meadow/fringe, collision-checked
  //    服务器障碍物（含树木）已注册，不会压盖
  {
    let placedBush = 0, placedStone = 0, guard = 0;
    const tryScatter = (kind: 'bush' | 'stone'): boolean => {
      const x = -260 + rnd() * 520, z = -260 + rnd() * 560;
      if (inExclude(x, z)) return false;
      if (inForestDeep(x, z)) return false;
      if (x > -50 && x < 80 && z > 140 && z < 220) return false; // 村庄内部
      return tryPlace(kind, x, z, 0.8 + rnd() * 0.4, 3);
    };
    while (placedBush < 90 && guard++ < 3000) if (tryScatter('bush')) placedBush++;
    guard = 0;
    while (placedStone < 60 && guard++ < 3000) if (tryScatter('stone')) placedStone++;
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
