// What is solid in the world, and exactly where: the single source of truth for the kernel's colliders
// (src/kernel/physics.ts), the A* grid (src/kernel/pathfind.ts) and the client's placement of every solid
// thing it draws (client/scene.ts, client/decor.ts), plus the ?debug=colliders overlay (client/debug.ts).
//
//  * OBSTACLES (map.ts) are the big drawn things (castle, towers, houses, trees...). Their numbers are the
//    drawing's numbers; colliderOf() turns each into the footprint of what is actually drawn at ground level
//    (a tower's flared base, a tree's trunk rather than its crown, the tomb's box rather than a disc).
//  * The props below used to be literals in scene.ts; the scene now reads them from here.
//  * Ministers' statues appear and fall with decrees (world.flags.statues); statueCollider(i) is statue i.
//  * The walkable world ends at the square |x|, |z| <= WORLD_HALF AND the circle WORLD_EDGE, where the
//    Highlands start to climb (client/terrain.ts: ss(270, 420, hypot(x, z + 20))); inside it the ground stays
//    within ~3 m of the grounds' level, so nobody walks up a mountain side.
import { OBSTACLES, type Obstacle, type Style } from './map.js';

/** A footprint on the XZ plane, `h` metres tall. Boxes are axis-aligned; `obox` is a box turned by `yaw` about +Y. */
export type Collider = { h: number; style: Style; label?: string } & (
  | { kind: 'disc'; x: number; z: number; r: number }
  | { kind: 'box'; x0: number; z0: number; x1: number; z1: number }
  | { kind: 'obox'; x: number; z: number; hx: number; hz: number; yaw: number }
);

/** Bolts fly at about this height: anything lower (tables, the lake's surface) they pass over. */
export const BOLT_HEIGHT = 1.2;

/** The edge of the walkable world (a circle, intersected with the WORLD_HALF square). */
export const WORLD_EDGE = { x: 0, z: -20, r: 280 };

/** A tree's collider is its trunk: the drawn trunk is a cylinder 0.5·r wide at the foot and 0.4·h tall (scene.ts forest). */
export const TRUNK = 0.5;

// ---- props the scene used to place with literals ------------------------------------------------------------

/** Torch posts along the main path (scene.ts: CylinderGeometry(0.1, 0.12, 3)). */
export const TORCH_POSTS: { x: number; z: number }[] = [0, 40, 80, 120].map((z) => ({ x: 3.2, z }));
export const TORCH_POST = { r: 0.12, h: 3 };

/** The four house tables in the Great Hall (w along x, d along z). Low: bolts fly over them. */
export const HALL_TABLES: { x: number; z: number; w: number; d: number; h: number }[] = [-7.5, -2.5, 2.5, 7.5].map((x) => ({ x, z: -55, w: 1.4, d: 22, h: 0.9 }));

/** The Great Hall's floating candles (scene.ts; they bob a few centimetres): 8 across, 6 deep, 7.4-8.6 m up. */
export const HALL_CANDLES: { x: number; y: number; z: number }[] = Array.from({ length: 48 }, (_, i) => ({ x: -10 + (i % 8) * 2.9, y: 8 + Math.sin(i) * 0.6, z: -69 + Math.floor(i / 8) * 5 }));

/** Buttresses along both long walls of the Great Hall (w along x, d along z). */
export const HALL_BUTTRESS = { w: 0.7, d: 0.9, h: 13.2 };
export const HALL_BUTTRESSES: { x: number; z: number }[] = Array.from({ length: 7 }, (_, i) => -70.3 + i * 4.6).flatMap((z) => [-1, 1].map((sx) => ({ x: sx * 13.35, z })));

/** The Great Hall's door: a pointed arch frame `outer` wide round an opening `hole` wide, `depth` deep from z (toward +z). */
export const HALL_DOOR = { x: 0, z: -40, outer: 8, hole: 6, h: 10.2, holeH: 9, depth: 0.4 };

/** The Mirror of Erised's gilt frame, against the south face of the East Wing. */
export const MIRROR = { x: 30, z: -62.5, w: 2.4, h: 4.2, d: 0.3 };

// ---- Ministers' statues -------------------------------------------------------------------------------------

/** Where statue i stands (decor.ts): lining the approach to the castle, facing the road. */
export const STATUE_SPOTS: [number, number][] = [[-7, 4], [7, 4], [-7, 16], [7, 16], [-7, 28], [7, 28], [-7, 40], [7, 40]];
/** The plinth's footprint (its trim is 2.1 m square) and the statue's height. */
export const STATUE = { size: 2.1, h: 5.3 };
export const statueYaw = (x: number) => (x < 0 ? Math.PI / 2 : -Math.PI / 2);
export function statueCollider(i: number): Collider {
  const [x, z] = STATUE_SPOTS[i % STATUE_SPOTS.length];
  return { kind: 'obox', x, z, hx: STATUE.size / 2, hz: STATUE.size / 2, yaw: statueYaw(x), h: STATUE.h, style: 'stone', label: 'Minister statue' };
}

// ---- from drawn things to colliders -------------------------------------------------------------------------

const box = (x0: number, z0: number, x1: number, z1: number, h: number, style: Style, label?: string): Collider => ({ kind: 'box', x0, z0, x1, z1, h, style, label });
const disc = (x: number, z: number, r: number, h: number, style: Style, label?: string): Collider => ({ kind: 'disc', x, z, r, h, style, label });

/** The footprint of what scene.ts draws for an obstacle (see the matching case there). */
export function colliderOf(o: Obstacle): Collider {
  if (o.kind === 'box') return box(o.x0, o.z0, o.x1, o.z1, o.h, o.style, o.label);
  switch (o.style) {
    case 'tree': return disc(o.x, o.z, o.r * TRUNK, o.h * 0.4, 'tree'); // trunk; the crown starts above head height
    case 'tower': return disc(o.x, o.z, o.r * 1.06, o.h, o.style, o.label); // CylinderGeometry(r, 1.06 r)
    case 'tomb': return box(o.x - o.r * 1.1, o.z - o.r * 0.65, o.x + o.r * 1.1, o.z + o.r * 0.65, o.h, o.style, o.label); // BoxGeometry(2.2 r, h, 1.3 r)
    case 'hoop': return disc(o.x, o.z, 0.25, o.h, o.style, o.label); // the pole, CylinderGeometry(0.2, 0.25)
    case 'rock': return disc(o.x, o.z, o.r * 4 * (1 + Math.cos(Math.PI / 6)) / 2, o.h, o.style, o.label); // hexagonal CylinderGeometry(2 r, 4 r, h, 6) at its foot
    case 'water': case 'willow': case 'wood': return disc(o.x, o.z, o.r, o.h, o.style, o.label);
    default: return disc(o.x, o.z, o.r * 1.1, o.h, o.style, o.label); // pillars: CylinderGeometry(r, 1.1 r)
  }
}

function props(): Collider[] {
  const out: Collider[] = [];
  for (const t of TORCH_POSTS) out.push(disc(t.x, t.z, TORCH_POST.r, TORCH_POST.h, 'wood', 'Torch'));
  for (const t of HALL_TABLES) out.push(box(t.x - t.w / 2, t.z - t.d / 2, t.x + t.w / 2, t.z + t.d / 2, t.h, 'wood', 'House table'));
  const B = HALL_BUTTRESS;
  for (const b of HALL_BUTTRESSES) out.push(box(b.x - B.w / 2, b.z - B.d / 2, b.x + B.w / 2, b.z + B.d / 2, B.h, 'stone', 'Buttress'));
  const D = HALL_DOOR;
  for (const s of [-1, 1]) {
    const inner = D.x + (s * D.hole) / 2, outer = D.x + (s * D.outer) / 2;
    out.push(box(Math.min(inner, outer), D.z, Math.max(inner, outer), D.z + D.depth, D.h, 'stone', 'Door jamb'));
  }
  out.push(box(MIRROR.x - MIRROR.w / 2, MIRROR.z - MIRROR.d / 2, MIRROR.x + MIRROR.w / 2, MIRROR.z + MIRROR.d / 2, MIRROR.h, 'stone', 'Mirror of Erised'));
  return out;
}

/** Every static collider: the obstacles' footprints, then the props. Statues are added per world (dynamic). */
export const STATIC_COLLIDERS: Collider[] = [...OBSTACLES.map(colliderOf), ...props()];

/** Axis-aligned bounds of a collider: [x0, z0, x1, z1]. */
export function colliderBounds(c: Collider): [number, number, number, number] {
  if (c.kind === 'disc') return [c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r];
  if (c.kind === 'box') return [c.x0, c.z0, c.x1, c.z1];
  const cs = Math.abs(Math.cos(c.yaw)), sn = Math.abs(Math.sin(c.yaw));
  const ex = c.hx * cs + c.hz * sn, ez = c.hx * sn + c.hz * cs;
  return [c.x - ex, c.z - ez, c.x + ex, c.z + ez];
}

/**
 * Signed distance from (x, z) to the collider's footprint (negative inside). Reference implementation for
 * tests and the debug overlay; the kernel's hot path (physics.ts) inlines the same maths over typed arrays.
 */
export function signedDistance(c: Collider, x: number, z: number): number {
  if (c.kind === 'disc') return Math.hypot(x - c.x, z - c.z) - c.r;
  let lx: number, lz: number, hx: number, hz: number;
  if (c.kind === 'box') { lx = x - (c.x0 + c.x1) / 2; lz = z - (c.z0 + c.z1) / 2; hx = (c.x1 - c.x0) / 2; hz = (c.z1 - c.z0) / 2; }
  else {
    const dx = x - c.x, dz = z - c.z, cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    // local frame: three.js rotation.y = yaw maps local (lx, lz) to world (lx cos + lz sin, -lx sin + lz cos)
    lx = dx * cs - dz * sn; lz = dx * sn + dz * cs; hx = c.hx; hz = c.hz;
  }
  const qx = Math.abs(lx) - hx, qz = Math.abs(lz) - hz;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}

/** The corners of a box or oriented box, in order round the edge (for drawing outlines). */
export function colliderCorners(c: Collider): [number, number][] {
  if (c.kind === 'disc') return [];
  if (c.kind === 'box') return [[c.x0, c.z0], [c.x1, c.z0], [c.x1, c.z1], [c.x0, c.z1]];
  const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([a, b]) => {
    const lx = a * c.hx, lz = b * c.hz;
    return [c.x + lx * cs + lz * sn, c.z - lx * sn + lz * cs] as [number, number];
  });
}

// ---- what the camera sees as solid (client/view.ts) ---------------------------------------------------------
//
// The colliders above are footprints at walking height. The third-person camera also needs to know how TALL
// each thing is and what stands on top of it (roofs, battlements, turrets, tree crowns), so it can keep out of
// walls, look over a low wall, and fade whatever still hides you. These are the drawn shapes of scene.ts,
// simplified to vertical prisms: a footprint standing from y0 to y1 metres. Cones and pyramids (roofs, crowns)
// are stacks of prisms that shrink as they rise, each as wide as the shape at its foot (never inside the drawing).

/** A thing in 3D for the camera. `soft`: leaves and branches (faded when in the way; the camera passes through
 *  them). `roof`: part of interior i's roof (hidden while the player is inside, so never in the way then). */
export interface ViewSolid { c: Collider | Diamond; y0: number; y1: number; soft?: boolean; roof?: number }
/**
 * The foot of a house's four-sided roof as scene.ts draws it (ConeGeometry with 4 segments, scaled to the house,
 * then turned 45°): a rhombus whose corners are `hu` out along its own x and `hv` out along its own z, turned by
 * `yaw` (as an `obox`). On a long house it overhangs the ends by a metre or more.
 */
export interface Diamond { kind: 'diamond'; x: number; z: number; hu: number; hv: number; yaw: number; style: Style; label?: string }

/**
 * Rooms you can walk into that have a roof (scene.ts hides the roof while you are inside; the camera rises and
 * shortens its arm there). [x0, z0, x1, z1] is the floor, doorway included; `h` is the height of the eaves.
 */
export const INTERIORS: { label: string; x0: number; z0: number; x1: number; z1: number; h: number }[] = [
  { label: 'The Great Hall', x0: -12, z0: -72, x1: 12, z1: -39.5, h: 14 },
];
/** The interior (index into INTERIORS) that (x, z) is in, or -1. */
export function interiorAt(x: number, z: number): number {
  for (let i = 0; i < INTERIORS.length; i++) {
    const r = INTERIORS[i];
    if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return i;
  }
  return -1;
}

/** The Great Hall's slate roof (scene.ts gableRoof): eaves at y, ridge (along z) `rise` higher. Roof of interior 0. */
export const HALL_ROOF = { x0: -13.8, x1: 13.8, z0: -72.6, z1: -39.4, y: 14, rise: 10 };
/** The lintel over the Great Hall's doors (scene.ts): w x h x d, centred at (x, y, z). */
export const HALL_LINTEL = { x: 0, y: 11.5, z: -40.5, w: 6.2, h: 5, d: 1 };
/** Corner turrets corbelled out from the castle walls (scene.ts turret): shaft radius r, shaft centre at height H. */
export const TURRETS: { x: number; z: number; H: number; r: number }[] = [-1, 1].flatMap((sx) => [
  { x: sx * 30, z: -72, H: 26, r: 1.9 }, { x: sx * 30, z: -112, H: 26, r: 1.9 }, { x: sx * 13, z: -64, H: 18, r: 1.6 },
]);

/**
 * Every static thing the camera should know about, in 3D. `ground(x, z)` is the terrain height at a tree's
 * foot (buildings stand on flattened ground at y = 0); leave it out for flat ground. Statues: statueViewSolid.
 */
export function viewSolids(ground: (x: number, z: number) => number = () => 0): ViewSolid[] {
  const out: ViewSolid[] = [];
  const put = (c: Collider | Diamond, y0: number, y1: number, extra?: Partial<ViewSolid>) => { out.push({ c, y0, y1, ...extra }); };
  /** A cone or pyramid from y0 (footprint at(1)) to its tip at y1, as n prisms each as wide as its foot. */
  const taper = (at: (k: number) => Collider | Diamond, y0: number, y1: number, n = 3, extra?: Partial<ViewSolid>) => {
    for (let i = 0; i < n; i++) put(at(1 - i / n), y0 + ((y1 - y0) * i) / n, y0 + ((y1 - y0) * (i + 1)) / n, extra);
  };
  const boxAt = (cx: number, cz: number, hx: number, hz: number, style: Style, label?: string) => box(cx - hx, cz - hz, cx + hx, cz + hz, 0, style, label);
  for (const o of OBSTACLES) {
    const c = colliderOf(o);
    if (o.kind === 'box') {
      const cx = (o.x0 + o.x1) / 2, cz = (o.z0 + o.z1) / 2, hx = (o.x1 - o.x0) / 2, hz = (o.z1 - o.z0) / 2;
      if (o.style === 'house' || o.style === 'wood') {
        put(c, 0, o.h);
        // the roof: ConeGeometry(0.72 max(w, d), 0.7 h, 4) scaled by (w, d) / max(w, d), turned 45°
        const r = Math.max(hx, hz) * 2 * 0.72, m = Math.max(hx, hz);
        taper((k) => ({ kind: 'diamond', x: cx, z: cz, hu: r * (hx / m) * k, hv: r * (hz / m) * k, yaw: Math.PI / 4, style: o.style, label: o.label }), o.h, o.h * 1.7);
      } else put(c, 0, o.h > 15 ? o.h + 1.6 : o.h); // keep and wings: battlements on top
      continue;
    }
    switch (o.style) {
      case 'water': break;
      case 'tree': {
        const g = ground(o.x, o.z);
        put(c, g, g + o.h * 0.4); // the trunk
        // the crown (scene.ts crownGeometry): three tiers, 3.4 r wide at 0.275 h, 2.6 r at 0.5 h, 1.7 r at 0.68 h, to h
        const crown = (r: number) => disc(o.x, o.z, r, 0, 'tree');
        put(crown(o.r * 3.4), g + o.h * 0.275, g + o.h * 0.6, { soft: true });
        put(crown(o.r * 2.3), g + o.h * 0.6, g + o.h * 0.8, { soft: true });
        put(crown(o.r * 1.2), g + o.h * 0.8, g + o.h, { soft: true });
        break;
      }
      case 'tower':
        put(c, 0, o.h);
        taper((k) => disc(o.x, o.z, o.r * 1.3 * k, 0, o.style, o.label), o.h, o.h + o.r * 2.8);
        break;
      case 'wood': // Hagrid's hut: a drum 0.6 h tall under a cone 1.35 r wide
        put(c, 0, o.h * 0.6);
        taper((k) => disc(o.x, o.z, o.r * 1.35 * k, 0, o.style, o.label), o.h * 0.595, o.h * 1.245);
        break;
      case 'willow': // the trunk; the crown (an icosahedron r 4.2) and the whirling arms are soft
        put(c, 0, o.h * 0.6);
        put(disc(o.x, o.z, 6, 0, 'willow'), o.h * 0.6 - 3.5, o.h * 0.78 + 4.2, { soft: true });
        break;
      case 'hoop':
        put(c, 0, o.h);
        put(disc(o.x, o.z, 1.8, 0, 'hoop'), o.h, o.h + 3.4, { soft: true }); // the ring
        break;
      case 'rock': // a hexagonal cone, 4 r across at the foot, 2 r at the top
        taper((k) => disc(o.x, o.z, o.r * (2 + 2 * k) * 0.93, 0, o.style, o.label), 0, o.h);
        break;
      case 'tomb': put(c, 0, o.h); break;
      default: // courtyard pillars and their caps
        put(c, 0, o.h);
        put(boxAt(o.x, o.z, o.r * 1.3, o.r * 1.3, o.style), o.h, o.h + 0.5);
    }
  }
  for (const c of props()) put(c, 0, c.label === 'Buttress' ? c.h + 3.4 : c.h); // buttresses carry pinnacles
  const L = HALL_LINTEL;
  put(boxAt(L.x, L.z, L.w / 2, L.d / 2, 'stone', 'Lintel'), L.y - L.h / 2, L.y + L.h / 2);
  const R = HALL_ROOF, rcx = (R.x0 + R.x1) / 2, rcz = (R.z0 + R.z1) / 2;
  taper((k) => boxAt(rcx, rcz, ((R.x1 - R.x0) / 2) * k, (R.z1 - R.z0) / 2, 'stone', 'Great Hall roof'), R.y, R.y + R.rise, 3, { roof: 0 });
  // a candle and its glow: soft (the arm passes by; one in the way turns the fade on)
  for (const c of HALL_CANDLES) put(disc(c.x, c.z, 0.4, 0, 'wood', 'Candle'), c.y - 0.4, c.y + 0.9, { soft: true });
  for (const t of TURRETS) {
    put(disc(t.x, t.z, t.r, 0, 'tower', 'Turret'), t.H - 6.2, t.H + 3.5);
    taper((k) => disc(t.x, t.z, t.r * 1.32 * k, 0, 'tower', 'Turret'), t.H + 3.5, t.H + 3.5 + t.r * 3.4, 2);
  }
  return out;
}
/** Minister's statue i for the camera (plinth and figure). */
export const statueViewSolid = (i: number): ViewSolid => ({ c: statueCollider(i), y0: 0, y1: STATUE.h });
