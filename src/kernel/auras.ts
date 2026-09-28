/**
 * Auras: the one timed-status layer shared by wizards, creatures and summons.
 * Healing over time, poison, burning, chill, a unicorn's grace and a unicorn's curse are all auras;
 * the tick applies them uniformly and `cleanse` removes every debuff. Re-applying an aura refreshes
 * its duration and keeps the stronger magnitude (so stacking can never exceed a single cast's cap).
 */
export const AURA_KINDS = ['regen', 'grace', 'poison', 'burn', 'chill', 'cursed'] as const;
export type AuraKind = (typeof AURA_KINDS)[number];

export interface Aura { k: AuraKind; until: number; mag: number; src: string | null }

export const AURA_DEFS: Record<AuraKind, { debuff: boolean; doc: string }> = {
  regen: { debuff: false, doc: 'heals mag HP per second' },
  grace: { debuff: false, doc: "a unicorn's presence: heals mag HP per second" },
  poison: { debuff: true, doc: 'mag damage per second (Acromantula venom)' },
  burn: { debuff: true, doc: 'mag fire damage per second' },
  chill: { debuff: true, doc: 'movement slowed by mag (0..0.6)' },
  cursed: { debuff: true, doc: 'you harmed a unicorn: max health reduced by 30%' },
};

/** Refresh-and-keep-max stacking. Returns the new list (does not mutate). */
export function addAura(list: Aura[], a: Aura): Aura[] {
  const cur = list.find((x) => x.k === a.k);
  if (!cur) return [...list, a];
  return list.map((x) => (x === cur ? { k: a.k, until: Math.max(cur.until, a.until), mag: Math.max(cur.mag, a.mag), src: a.src ?? cur.src } : x));
}

export const hasAura = (list: Aura[], k: AuraKind, now: number) => list.some((a) => a.k === k && a.until > now);
export const auraMag = (list: Aura[], k: AuraKind, now: number) => list.reduce((m, a) => (a.k === k && a.until > now ? Math.max(m, a.mag) : m), 0);
export const withoutDebuffs = (list: Aura[]) => list.filter((a) => !AURA_DEFS[a.k].debuff);
export const live = (list: Aura[], now: number) => list.filter((a) => a.until > now);
