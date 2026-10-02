/**
 * 战斗回蓝 (a Feature; the owner, 2026-10-02: 「火打不到后面的怪物，后头太难了」): a hurting spell that lands on a wild
 * creature gives FOCUS_REFUND mana back, at most FOCUS_MAX_PER_S a second. Before, a first-year had about seven quick
 * casts, then one every two seconds (regen 7/s against a 15-mana Stupefy), and 70 % of a mashing player's presses
 * were refused for mana. Hitting now keeps you going; casting at nothing does not. Wizards, duels and summons are
 * untouched (only wild creatures refund), and so is an exam's sandbox (it runs without regen: its mana is the score).
 */
import type { Feature } from './feature.js';
import { derived } from './progression.js';
import './world.js'; // (the World this module declares state on)

export const FOCUS_REFUND = 6, FOCUS_MAX_PER_S = 10;

declare module './world.js' {
  interface World {
    /** 战斗回蓝 (this module's Feature): mana refunded this second, per wizard. */
    refund: { at: number; got: Map<string, number> };
  }
}

export const FOCUS_FEATURE: Feature = {
  id: 'focus',
  init(world) { world.refund = { at: 0, got: new Map() }; },
  hit(world, by, src, dstId, tags, dmg) {
    if (!dmg || !src || src.npc || !by || src.id !== by || world.rules.magic.manaRegen <= 0) return 1;
    const c = world.creatures.get(dstId);
    if (!c || c.owner || tags.includes('rune') || tags.includes('conduct') || tags.includes('overload') || tags.includes('whizbang')) return 1;
    const s = world.refund, sec = Math.floor(world.now);
    if (s.at !== sec) { s.at = sec; s.got.clear(); }
    const got = s.got.get(src.id) ?? 0, n = Math.min(FOCUS_REFUND, FOCUS_MAX_PER_S - got);
    if (n <= 0) return 1;
    s.got.set(src.id, got + n);
    src.mana = Math.min(derived(src, world.rules).maxMana, src.mana + n);
    return 1;
  },
};
