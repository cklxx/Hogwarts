/**
 * 场景 (the owner, 2026-09-30: "场景与场景间不需要那么多空白"): the grounds are not one open field any more but a
 * handful of dense scenes, each walled in by a veil of mist, joined by gates. Walk into a gate and you step out at
 * the other end — the castle's courtyard holds one gate to every other scene, and every other scene one gate home.
 * The empty land between them is still drawn (you see the forest beyond the mist) but nobody walks it.
 *
 * Coordinates are the old ones: nothing inside a scene moved. The veil is a ring of low walls (VEIL_H: bolts do not
 * cross it, the camera looks over it); `move_to` into another scene walks to the gate first (World.setGoal, routeVia).
 * Shared by the kernel (walls, gates, routing) and the client (the mist, the gate glows, the scene you are in).
 */
export interface Vec2 { x: number; z: number }
export type SceneId = 'castle' | 'lake' | 'forest' | 'pitch' | 'hogsmeade';
export interface Scene {
  id: SceneId; zh: string; en: string;
  /** The walkable box [x0, z0, x1, z1]; the veil stands on its edge. */
  box: readonly [number, number, number, number];
  /** Not the castle: its gate home, where you step out coming from the castle, and its gate in the castle
   *  courtyard with where you step out there coming home. */
  gate?: Vec2; entry?: Vec2; hubGate?: Vec2; hubExit?: Vec2;
}
export const HUB: SceneId = 'castle';
export const SCENES: readonly Scene[] = [
  { id: 'castle', zh: '城堡', en: 'the castle', box: [-66, -73, 74, 38] }, // the Great Hall's far end and the Clock Tower's foot inside
  // (2026-09-30, 「地图太大，东西太少」: the lake and the forest cut down to what is in them — 35 → 7 and 52 → 12 screens)
  { id: 'lake', zh: '黑湖', en: 'the Black Lake', box: [-112, -2, -70, 62],
    gate: { x: -76, z: 12 }, entry: { x: -80, z: 20 }, hubGate: { x: -23, z: -22 }, hubExit: { x: -18.5, z: -22 } },
  { id: 'forest', zh: '禁林', en: 'the Forbidden Forest', box: [80, -12, 156, 52],
    gate: { x: 86, z: 8 }, entry: { x: 90, z: 16 }, hubGate: { x: 23, z: -22 }, hubExit: { x: 18.5, z: -22 } },
  { id: 'pitch', zh: '魁地奇球场', en: 'the Quidditch pitch', box: [-5, -195, 85, -116],
    gate: { x: 30, z: -124 }, entry: { x: 40, z: -128 }, hubGate: { x: 23, z: -34 }, hubExit: { x: 19.5, z: -35 } },
  { id: 'hogsmeade', zh: '霍格莫德', en: 'Hogsmeade', box: [-45, 128, 90, 215],
    gate: { x: -8, z: 132 }, entry: { x: 0, z: 136 }, hubGate: { x: -23, z: -10 }, hubExit: { x: -19, z: -7.5 } },
];
/** Step within this of a gate and you go through. */
export const GATE_R = 1.3;
/** After going through, gates ignore you this long (you step out beside the other end, never on it). */
export const GATE_COOLDOWN_S = 1.5;
/** The veil: a wall this high (above a bolt's flight, below what the camera climbs) and this thick. */
export const VEIL_H = 3, VEIL_T = 1;

const inBox = (b: readonly number[], x: number, z: number) => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3];
/** The scene (x, z) is in, or null (the land between, Azkaban). */
export function sceneAt(x: number, z: number): Scene | null {
  for (const s of SCENES) if (inBox(s.box, x, z)) return s;
  return null;
}
export const sceneById = (id: string) => SCENES.find((s) => s.id === id) ?? null;

/** Every gate: where it stands, the scene it is in, where it takes you, and to which scene. */
export interface Gate { at: Vec2; in: SceneId; to: SceneId; out: Vec2; /** an edge crossing (edgeHop): its side */ side?: Side }
export const GATES: readonly Gate[] = SCENES.flatMap((s) => s.gate ? [
  { at: s.hubGate!, in: HUB, to: s.id, out: s.entry! },
  { at: s.gate, in: s.id, to: HUB, out: s.hubExit! },
] : []);
export const gateAt = (x: number, z: number) => GATES.find((g) => Math.hypot(g.at.x - x, g.at.z - z) <= GATE_R) ?? null;

/**
 * Walking from `from` to `to` in another scene: the gate to walk to first (the castle is the crossroads, so from one
 * outer scene to another it is the gate home), or null when both are in one scene (or either is in none).
 */
export function routeVia(from: Vec2, to: Vec2): Gate | null {
  const a = sceneAt(from.x, from.z), b = sceneAt(to.x, to.z);
  if (!a || !b || a.id === b.id) return null;
  return GATES.find((g) => g.in === a.id && (g.to === b.id || a.id !== HUB)) ?? null;
}

/** The veil's walls: four per scene, just outside its box. */
export function veilWalls(): { x0: number; z0: number; x1: number; z1: number }[] {
  const t = VEIL_T;
  return SCENES.flatMap(({ box: [x0, z0, x1, z1] }) => [
    { x0: x0 - t, z0: z0 - t, x1: x1 + t, z1: z0 },
    { x0: x0 - t, z0: z1, x1: x1 + t, z1: z1 + t },
    { x0: x0 - t, z0, x1: x0, z1 },
    { x0: x1, z0, x1: x1 + t, z1 },
  ]);
}

/**
 * 边缘出口 (the owner, 2026-09-30: "空气墙体验很差"): the veil is not a wall. Keep walking into it (EDGE_HOLD_S) and
 * you come out on the other side — the way zone edges work in Diablo or old Zelda. The castle's four edges lead to
 * the scene that lies that way (west the lake, east the forest, the pitch at -z, Hogsmeade at +z), stepping out just
 * inside the facing edge at the same place along it; each outer scene's edge facing the castle leads back the same
 * way, and its other edges lead home to the courtyard (where its gate comes out).
 */
export type Side = 'x0' | 'z0' | 'x1' | 'z1';
export const SIDES: readonly Side[] = ['x0', 'z0', 'x1', 'z1'];
const NEXT: Partial<Record<SceneId, Partial<Record<Side, SceneId>>>> = {
  castle: { x0: 'lake', x1: 'forest', z0: 'pitch', z1: 'hogsmeade' },
  lake: { x1: 'castle' }, forest: { x0: 'castle' }, pitch: { z1: 'castle' }, hogsmeade: { z0: 'castle' },
};
const OPP: Record<Side, Side> = { x0: 'x1', x1: 'x0', z0: 'z1', z1: 'z0' };
/** Pressing into the veil this long takes you through. */
export const EDGE_HOLD_S = 0.35;
/** "At the edge": this near it (a wizard's radius stops them 0.5 m short of the wall). */
export const EDGE_NEAR = 1.1;
/** You step out this far inside the next scene's edge. */
export const EDGE_IN = 2.5;

/** Where an edge leads: the scene that way, or home (the castle) from an outer scene's far edges. */
export const edgeTo = (s: Scene, side: Side): SceneId => NEXT[s.id]?.[side] ?? HUB;
/** Whether the edge lies straight onto the next scene (else it is the way home to the courtyard). */
export const edgeFaces = (s: Scene, side: Side) => !!NEXT[s.id]?.[side];
/** The outward direction of a side. */
export const sideDir = (side: Side): Vec2 => ({ x: side === 'x0' ? -1 : side === 'x1' ? 1 : 0, z: side === 'z0' ? -1 : side === 'z1' ? 1 : 0 });
/** How far (x, z) is from a side of the box (inside: positive). */
const inset = (b: Scene['box'], side: Side, p: Vec2) => (side === 'x0' ? p.x - b[0] : side === 'x1' ? b[2] - p.x : side === 'z0' ? p.z - b[1] : b[3] - p.z);

/** The side a wizard at `p` walking `d` (any length) is pressing into, or null: at the edge, heading out of it. */
export function pressing(s: Scene, p: Vec2, d: Vec2): Side | null {
  const l = Math.hypot(d.x, d.z);
  if (l < 0.3) return null;
  for (const side of SIDES) {
    const o = sideDir(side);
    if (inset(s.box, side, p) <= EDGE_NEAR && (d.x * o.x + d.z * o.z) / l > 0.5) return side;
  }
  return null;
}

/** Where going through `side` of `s` from `p` puts you. */
export function edgeOut(s: Scene, side: Side, p: Vec2): Vec2 {
  const to = sceneById(edgeTo(s, side))!;
  if (!edgeFaces(s, side)) return { ...s.hubExit! };
  const b = to.box, o = OPP[side], m = 3;
  const along = (v: number, lo: number, hi: number) => Math.max(lo + m, Math.min(hi - m, v));
  return side === 'x0' || side === 'x1'
    ? { x: o === 'x0' ? b[0] + EDGE_IN : b[2] - EDGE_IN, z: along(p.z, b[1], b[3]) }
    : { x: along(p.x, b[0], b[2]), z: o === 'z0' ? b[1] + EDGE_IN : b[3] - EDGE_IN };
}

/**
 * A walk from `from` toward `to` beyond its scene's edge — a tap into the mist, or into the scene that lies that way
 * (the lake seen past the castle's west veil): the crossing to walk to, just inside the edge where the line leaves
 * the scene, or null (the same scene, or another that is not that way: its gate).
 */
export function edgeHop(from: Vec2, to: Vec2): Gate | null {
  const a = sceneAt(from.x, from.z);
  if (!a) return null;
  const b = sceneAt(to.x, to.z);
  if (b?.id === a.id) return null;
  const [x0, z0, x1, z1] = a.box, dx = to.x - from.x, dz = to.z - from.z;
  let t = Infinity, side: Side | null = null;
  const hit = (s: Side, tt: number) => { if (tt >= 0 && tt < t) { t = tt; side = s; } };
  if (dx < 0) hit('x0', (x0 - from.x) / dx);
  if (dx > 0) hit('x1', (x1 - from.x) / dx);
  if (dz < 0) hit('z0', (z0 - from.z) / dz);
  if (dz > 0) hit('z1', (z1 - from.z) / dz);
  if (!side || t > 1) return null;
  const s: Side = side;
  if (b && (!edgeFaces(a, s) || edgeTo(a, s) !== b.id)) return null;
  const m = 0.7, along = 2;
  const at = {
    x: Math.max(x0 + (s === 'x0' ? m : along), Math.min(x1 - (s === 'x1' ? m : along), from.x + dx * t)),
    z: Math.max(z0 + (s === 'z0' ? m : along), Math.min(z1 - (s === 'z1' ? m : along), from.z + dz * t)),
  };
  if (s === 'x0') at.x = x0 + m; else if (s === 'x1') at.x = x1 - m; else if (s === 'z0') at.z = z0 + m; else at.z = z1 - m;
  return { at, in: a.id, to: edgeTo(a, s), out: edgeOut(a, s, at), side: s };
}
/** The edge crossing moved to `at` (where a route really ends), or null when that is no longer at its edge. */
export function edgeAt(g: Gate, at: Vec2): Gate | null {
  const s = sceneById(g.in);
  if (!s || !g.side || sceneAt(at.x, at.z) !== s || inset(s.box, g.side, at) > EDGE_NEAR + 0.5) return null;
  return { ...g, at: { ...at }, out: edgeOut(s, g.side, at) };
}
/** A walk that ends this near the mist beyond its scene's edge only goes to the edge (a tap on the veil's foot, a
 *  chase along it): the point pulled back inside; further out it goes through (edgeHop). */
export const EDGE_SLACK = 3;
export function nearEdge(from: Vec2, to: Vec2): Vec2 | null {
  const a = sceneAt(from.x, from.z);
  if (!a || sceneAt(to.x, to.z)) return null;
  const [x0, z0, x1, z1] = a.box, m = 0.7;
  if (Math.max(x0 - to.x, to.x - x1, z0 - to.z, to.z - z1) >= EDGE_SLACK) return null;
  return { x: Math.max(x0 + m, Math.min(x1 - m, to.x)), z: Math.max(z0 + m, Math.min(z1 - m, to.z)) };
}
