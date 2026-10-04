/** Existing kill XP, shared once with effective Aguamenti collaborators. No new reward is minted. */
export const WATER_ASSIST_DIVISOR = 4, WATER_ASSIST_MAX = 8, WATER_ASSIST_S = 60, WATER_ASSIST_R = 30;

/** Integer XP shares; any fractional existing budget stays with the killer. */
export function splitWaterAssistXp(xp: number, helpers: number): { killerXp: number; shares: number[] } {
  const n = Math.min(WATER_ASSIST_MAX, Math.max(0, Math.floor(helpers)));
  if (!n || !Number.isFinite(xp) || xp < 0) return { killerXp: xp, shares: [] };
  const pool = Math.floor(xp / WATER_ASSIST_DIVISOR), each = Math.floor(pool / n), remainder = pool % n;
  return { killerXp: xp - pool, shares: Array.from({ length: n }, (_, i) => each + (i < remainder ? 1 : 0)) };
}
