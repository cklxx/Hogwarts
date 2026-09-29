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
