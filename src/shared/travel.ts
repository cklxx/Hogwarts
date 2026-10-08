/**
 * 飞路网 and brooms (kernel/travel.ts, client/panels/travel.ts): the fireplaces both sides draw and use, and the
 * numbers they share.
 */
export interface Fireplace { id: string; x: number; z: number; zh: string; en: string }
/** Fireplaces on the Floo Network: the castle's corners of the map, a few seconds of green flame apart. */
export const FIREPLACES: readonly Fireplace[] = [
  { id: 'courtyard', x: 12, z: -12, zh: '庭院', en: 'the Courtyard' },
  { id: 'great_hall', x: 0, z: -48, zh: '礼堂', en: 'the Great Hall' },
  { id: 'pitch', x: 48, z: -126, zh: '魁地奇球场', en: 'the Quidditch pitch' },
  { id: 'hagrid', x: 96, z: 18, zh: '海格小屋', en: "Hagrid's hut" },
  { id: 'lake', x: -82, z: 26, zh: '黑湖岸边', en: 'the Black Lake shore' },
  { id: 'hogsmeade', x: 10, z: 160, zh: '霍格莫德', en: 'Hogsmeade' },
];
/** Stand within this of a fireplace to use it. */
export const FLOO_R = 3;
/** Between two journeys, and after being hurt (no escaping a fight by the fire). */
export const FLOO_CD_S = 30, FLOO_HURT_S = 6;
/** On a broom, outside the castle: this much faster; mounting takes a moment's calm. */
export const BROOM_MULT = 2.0, BROOM_MOUNT_CD_S = 3, BROOM_HURT_S = 4;
/** Broom stamina: a full bar of 100; drains while riding (25 s to empty), regenerates on foot (10 s to full), then a 5 s weak window where remounting is refused. */
/** 扫帚耐力：满格 100；骑行消耗（25 秒耗尽），步行恢复（10 秒回满），耗尽后 5 秒虚弱期不可再骑。 */
export const BROOM_STAMINA_MAX = 100, BROOM_STAMINA_DRAIN_S = 4, BROOM_STAMINA_REGEN_S = 10, BROOM_STAMINA_WEAK_S = 5;
export const fireplaceNear = (p: { x: number; z: number }, r = FLOO_R) => FIREPLACES.find((f) => Math.hypot(f.x - p.x, f.z - p.z) <= r) ?? null;
