/**
 * The four dark corners of the HUD and the reveal charms that light them (`(reveal :tempus|:revelio|:point-me|:homenum)`,
 * UI_CHARMS): one description for the browser, which draws them, and for MCP `look`, which reports the same things
 * to an agent in sections that appear once the charm is cast (kernel/reveal.ts).
 */
import type { UiCharm } from './constants.js';

export const UI_CHARM_INFO: Record<UiCharm, { spell: string; look: string; en: string; zh: string }> = {
  tempus: { spell: 'Tempus', look: 'tempus', en: 'the top-right corner: the time, and the term', zh: '右上角：时间与学期' },
  revelio: { spell: 'Revelio', look: 'revelio', en: 'the top-left corner: your own measure', zh: '左上角：你自己的斤两' },
  'point-me': { spell: 'Point Me', look: 'pointMe', en: 'the bottom-left corner: a radar that always points north', zh: '左下角：永远指北的雷达' },
  homenum: { spell: 'Homenum Revelio', look: 'homenum', en: 'the bottom-right corner: everyone near you', zh: '右下角：身边的每一个人' },
};

/** Point Me: how far the radar reaches (the minimap's radius, metres; north is up, i.e. −z). */
export const RADAR_RANGE = 100;
/** Homenum Revelio: whom you sense — the nearest HOMENUM_MAX others within HOMENUM_RANGE metres. */
export const HOMENUM_RANGE = 60;
export const HOMENUM_MAX = 5;

/**
 * Homenum Revelio: the nearest others within range, nearest first, with the distance and the bearing
 * (radians clockwise from north, −z; the browser turns its arrows by the camera, an agent reads a compass point).
 */
export function homenum<T extends { x: number; z: number }>(me: { x: number; z: number }, others: Iterable<T>) {
  const near: { o: T; d: number; a: number }[] = [];
  for (const o of others) {
    const dx = o.x - me.x, dz = o.z - me.z, d = Math.hypot(dx, dz);
    if (d < HOMENUM_RANGE) near.push({ o, d, a: Math.atan2(dx, -dz) });
  }
  return near.sort((p, q) => p.d - q.d).slice(0, HOMENUM_MAX);
}

/** A bearing (radians clockwise from north) as one of eight compass points. */
export const compass = (a: number) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
