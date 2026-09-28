/**
 * The curse half of the forge egg (docs/AGENT_LINK.md §B): parsing a jinx out of a parcel's lore, the
 * player-facing refusals (English here; client/i18n.ts tr() translates them), and small pure helpers.
 * The state changes live in World (guardHostileGift, applyJinx, silence, cleanse, the 1 Hz sweep).
 */
import { JINX_DEFAULTS, type JinxKind } from '../shared/constants.js';
import type { Jinx } from './types.js';

/** The one refusal for an unknown registry number and for every protected recipient (so it cannot be used to probe). */
export const FORGE_REFUSAL = "The forge won't deliver to that registry number.";
export const SILENCED = 'Your tongue is stuck to the roof of your mouth (Langlock)! You cannot cast or speak aloud for a moment. (Owls to your agent still fly.)';
export const BOUND_REFUSAL = 'That cursed item is stuck to you. Cast Finite Incantatem on yourself to break the binding, or wait for it to wear off.';
export const CURSE_BLESS = 'A curse cannot also bless: every enchantment on a hostile parcel must be a hindrance (no positive values, no charm).';
export const HEX_YEAR = 'You have not learned the Dark Arts yet. (Come back in year 2.)';
export const HEX_FRESH_SENDER = 'The forge will not post curses for a wizard who enrolled less than 10 minutes ago.';

/**
 * Canon incantations the forge recognises in a parcel's lore, as letters only (case, spaces and
 * punctuation are ignored). Strength and duration come from JINX_DEFAULTS, never from the text.
 */
const INCANTATIONS: [string, JinxKind][] = [
  ['locomotorwibbly', 'jelly'], ['jellylegs', 'jelly'], ['jellyleg', 'jelly'],
  ['tarantallegra', 'dance'],
  ['furnunculus', 'boils'],
  ['batbogey', 'bats'],
  ['langlock', 'langlock'],
];

/** The first jinx incantation in `lore`, with kernel-chosen strength, or null. */
export function parseJinx(lore: string | undefined | null): Jinx | null {
  if (!lore) return null;
  const letters = lore.toLowerCase().replace(/[^a-z]/g, '');
  let best: { at: number; kind: JinxKind } | null = null;
  for (const [word, kind] of INCANTATIONS) {
    const at = letters.indexOf(word);
    if (at >= 0 && (!best || at < best.at)) best = { at, kind };
  }
  return best ? { kind: best.kind, ...JINX_DEFAULTS[best.kind] } : null;
}

export const JINX_NAMES: Record<JinxKind, { en: string; zh: string }> = {
  jelly: { en: 'Jelly-Legs Jinx', zh: '软腿咒' },
  dance: { en: 'Tarantallegra', zh: '塔朗泰拉舞' },
  boils: { en: 'Furnunculus', zh: '火疖子咒' },
  bats: { en: 'Bat-Bogey Hex', zh: '蝙蝠精咒' },
  langlock: { en: 'Langlock', zh: '锁舌封喉' },
};

/** Deterministic dance jitter in [-1, 1) from (step, handle): no draw from the world's seeded RNG. */
export function danceJitter(step: number, handle: string): number {
  let h = (Math.imul(step | 0, 0x9e3779b1) ^ 0x85ebca6b) >>> 0;
  for (let i = 0; i < handle.length; i++) h = Math.imul(h ^ handle.charCodeAt(i), 0x01000193) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 0x80000000 - 1;
}
