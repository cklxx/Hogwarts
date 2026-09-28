/**
 * Auras: the one timed-status layer shared by wizards, creatures and summons.
 * Healing over time, poison, burning, chill, a unicorn's grace and a unicorn's curse are all auras;
 * the tick applies them uniformly and `cleanse` removes every debuff. Re-applying an aura refreshes
 * its duration and keeps the stronger magnitude (so stacking can never exceed a single cast's cap).
 */
export const AURA_KINDS = ['regen', 'grace', 'poison', 'burn', 'chill', 'cursed', 'jelly', 'dance', 'boils', 'bats'] as const;
export type AuraKind = (typeof AURA_KINDS)[number];

export interface Aura { k: AuraKind; until: number; mag: number; src: string | null }

export const AURA_DEFS: Record<AuraKind, { debuff: boolean; doc: string; zh: string; hex?: boolean }> = {
  regen: { debuff: false, doc: 'heals mag HP per second', zh: '每秒回复 mag 点生命' },
  grace: { debuff: false, doc: "a unicorn's presence: heals mag HP per second", zh: '独角兽的气息：每秒回复 mag 点生命' },
  poison: { debuff: true, doc: 'mag damage per second (Acromantula venom)', zh: '中毒：每秒 mag 点伤害（八眼巨蛛的毒液）' },
  burn: { debuff: true, doc: 'mag fire damage per second', zh: '灼烧：每秒 mag 点火焰伤害' },
  chill: { debuff: true, doc: 'movement slowed by mag (0..0.6)', zh: '冰冷：移动减速' },
  cursed: { debuff: true, doc: 'you harmed a unicorn: max health reduced by 30%', zh: '诅咒：你伤害了独角兽，最大生命 -30%' },
  // Jinxes posted in a parcel (docs/AGENT_LINK.md §B.3). Computed live where they act, never in derived().
  jelly: { debuff: true, hex: true, doc: 'Jelly-Legs Jinx: movement slowed by mag (you can always still move)', zh: '软腿咒：腿脚发软，移动变慢（永远还能挪动）' },
  dance: { debuff: true, hex: true, doc: 'Tarantallegra: your legs dance, your steps wander a little', zh: '塔朗泰拉舞：双腿乱跳，方向轻微失灵' },
  boils: { debuff: true, hex: true, doc: 'Furnunculus: mag damage per second; never knocks you out', zh: '火疖子咒：每秒 mag 点伤害，不会打晕你' },
  bats: { debuff: true, hex: true, doc: 'Bat-Bogey Hex: mag damage per second and a brief silence', zh: '蝙蝠精咒：持续伤害，外加短暂沉默' },
};

/** The aura kinds only a hostile parcel can put on you. */
export const HEX_AURAS = AURA_KINDS.filter((k) => AURA_DEFS[k].hex) as AuraKind[];

/** Refresh-and-keep-max stacking. Returns the new list (does not mutate). */
export function addAura(list: Aura[], a: Aura): Aura[] {
  const cur = list.find((x) => x.k === a.k);
  if (!cur) return [...list, a];
  return list.map((x) => (x === cur ? { k: a.k, until: Math.max(cur.until, a.until), mag: Math.max(cur.mag, a.mag), src: a.src ?? cur.src } : x));
}

export const hasAura = (list: Aura[], k: AuraKind, now: number) => list.some((a) => a.k === k && a.until > now);
export const auraMag = (list: Aura[], k: AuraKind, now: number) => list.reduce((m, a) => (a.k === k && a.until > now ? Math.max(m, a.mag) : m), 0);
export const withoutDebuffs = (list: Aura[]) => list.filter((a) => !AURA_DEFS[a.k]?.debuff);
export const isDebuff = (k: string) => !!AURA_DEFS[k as AuraKind]?.debuff;
export const live = (list: Aura[], now: number) => list.filter((a) => a.until > now);
