/**
 * 宵禁: how Filch and Mrs Norris see — one rule for the kernel (who is caught, kernel/wheel.ts) and the HUD (the
 * reddened edge and the hint, client/funlogic.ts). Filch sees in his lantern's cone, Mrs Norris all round but close;
 * neither sees through walls or pillars (`clear` is the caller's line-of-sight test between the two points).
 */
export const FILCH = { speed: 2.6, range: 11, halfAngle: 0.8 };
export const NORRIS = { speed: 3.3, range: 4 };
/** The sight line is tested at this height (a pillar blocks it, a low bench does not). */
export const SIGHT_H = 1.5;

export interface Patroller { k: 'filch' | 'norris'; x: number; z: number; f: number }

/** Within the patroller's sight shape (ignoring walls). `f` is the facing, radians clockwise from north (−z). */
export function inSightShape(p: Patroller, at: { x: number; z: number }): boolean {
  const dx = at.x - p.x, dz = at.z - p.z, d = Math.hypot(dx, dz);
  if (p.k === 'norris') return d <= NORRIS.range;
  if (d > FILCH.range) return false;
  if (d <= 1.2) return true; // right next to him: he hears you
  const a = Math.atan2(dx, -dz);
  return Math.abs(Math.atan2(Math.sin(a - p.f), Math.cos(a - p.f))) <= FILCH.halfAngle;
}

export const sees = (p: Patroller, at: { x: number; z: number }, clear: (ax: number, az: number, bx: number, bz: number) => boolean) =>
  inSightShape(p, at) && clear(p.x, p.z, at.x, at.z);
