import { DODGE_DIST } from '/workspace/Hogwarts/src/shared/constants.ts';
import { ZONES } from '/workspace/Hogwarts/src/shared/map.ts';
import { DODGE_S, TICK, type World } from '/workspace/Hogwarts/src/kernel/world.ts';
import type { Vec2, Wizard } from '/workspace/Hogwarts/src/kernel/types.ts';
import { DUEL_STAGE, DUEL_LEASH } from '/workspace/Hogwarts/src/kernel/duelclub.ts';

/** A conservative continuous check, including a safe zone crossed between two outside endpoints. */
function crossesSafe(world: World, a: Vec2, b: Vec2): boolean {
  const dx = b.x - a.x, dz = b.z - a.z;
  for (const zone of ZONES) {
    if (!world.rules.combat.safeZones.includes(zone.id as never)) continue;
    if (!zone.box) {
      const l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((zone.x - a.x) * dx + (zone.z - a.z) * dz) / l2)) : 0;
      if (Math.hypot(a.x + dx * t - zone.x, a.z + dz * t - zone.z) <= (zone.r ?? 0)) return true;
    } else {
      let lo = 0, hi = 1;
      const [x0, z0, x1, z1] = zone.box;
      for (const [v, d, min, max] of [[a.x, dx, x0, x1], [a.z, dz, z0, z1]]) {
        if (Math.abs(d) < 1e-12) { if (v < min || v > max) { hi = -1; break; } }
        else { const t0 = (min - v) / d, t1 = (max - v) / d; lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1)); }
      }
      if (lo <= hi) return true;
    }
  }
  return false;
}

/** Review candidate only: retain the existing direction order while checking the resolved path. */
export function candidateStageRoll(world: World, w: Wizard, dx: number, dz: number): [number, number] | null {
  const m = world.duel.match;
  if (!m || m.phase !== 'fight' || m.out[w.id] || ![...m.sides[0], ...m.sides[1]].includes(w.id)) return null;
  const ok = (x: number, z: number) => {
    const end = { x: w.pos.x + x * DODGE_DIST, z: w.pos.z + z * DODGE_DIST };
    if (Math.hypot(end.x - DUEL_STAGE.x, end.z - DUEL_STAGE.z) > DUEL_LEASH - 1 || crossesSafe(world, w.pos, end)) return false;
    const p = { ...w.pos }, step = DODGE_DIST / DODGE_S * TICK;
    // A reflex may start before movement in the same tick; rounding at expiry can allow a sixth step.
    for (let i = 0; i < Math.ceil(DODGE_S / TICK) + 1; i++) {
      const before = { ...p };
      p.x += x * step; p.z += z * step;
      world.solids.resolve(p, 0.5, true);
      if (Math.hypot(p.x - DUEL_STAGE.x, p.z - DUEL_STAGE.z) > DUEL_LEASH || crossesSafe(world, before, p)) return false;
    }
    return true;
  };
  if (ok(dx, dz)) return null;
  for (const [x, z] of [[-dx, -dz], [-dz, dx], [dz, -dx]] as const) if (ok(x, z)) return [x, z];
  // Keep an existing active dodge's immunity/cooldown, but never retain a known unsafe direction.
  return [0, 0];
}
