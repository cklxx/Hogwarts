/**
 * 冰路 (the Black Lake's toy, src/shared/encounters.ts): an ice spell flying over the lake freezes the water along its
 * way — a path you can walk out on for ICE_S, then it melts and the water puts you back on the shore. The lake is
 * cut into ICE_CELL squares; a bolt freezes those within ICE_FREEZE_R of it each tick (at its speed, a strip without
 * gaps), an ice nova those under it. Shared by the kernel (src/kernel/ice.ts) and the browser (client/ice3d.ts).
 */
export const ICE_CELL = 1.5, ICE_S = 25, ICE_FREEZE_R = 1.4;
/** The lake's water (= the 'water' collider in src/shared/map.ts; test/ice.test.ts checks). */
export const LAKE_WATER = { x: -118, z: 40, r: 30 };
export const overWater = (x: number, z: number) => Math.hypot(x - LAKE_WATER.x, z - LAKE_WATER.z) < LAKE_WATER.r;
export const iceKey = (x: number, z: number) => `${Math.floor(x / ICE_CELL)},${Math.floor(z / ICE_CELL)}`;
/** The ice's top (the water plane is at 0.08 in client/scene.ts): where a walker on it stands. */
export const ICE_Y = 0.18;
