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
  { id: 'lake', zh: '黑湖', en: 'the Black Lake', box: [-175, -25, -70, 105],
    gate: { x: -76, z: 12 }, entry: { x: -80, z: 20 }, hubGate: { x: -23, z: -22 }, hubExit: { x: -18.5, z: -22 } },
  { id: 'forest', zh: '禁林', en: 'the Forbidden Forest', box: [80, -50, 236, 80],
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
export interface Gate { at: Vec2; in: SceneId; to: SceneId; out: Vec2 }
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
