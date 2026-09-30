/** The quiet HUD (2026-09-30): the centre banner keeps one short line. */
import { describe, expect, it } from 'vitest';
import { headline } from '../client/panels/logic';

describe('the centre banner headline', () => {
  it('the first sentence only, at most 26 characters', () => {
    expect(headline('📜 乌姆里奇第 29 号教育令：宵禁提前到下午！🏮 宵禁！费尔奇和洛丽丝夫人开始巡逻城堡。')).toBe('乌姆里奇第 29 号教育令：宵禁提前到下午！');
    expect(headline('金色飞贼出现了！魁地奇球场上空。')).toBe('金色飞贼出现了！');
    expect(headline('A troll in the dungeon! Everyone to the stair.')).toBe('A troll in the dungeon!');
    expect(headline('x'.repeat(40)).length).toBe(26);
    expect(headline('short')).toBe('short');
  });
});
