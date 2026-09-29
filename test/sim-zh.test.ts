/** client/i18n.ts simEffectZh: every effect line the kernel's simulate produces reads in Chinese. */
import { describe, expect, it } from 'vitest';
import { primName, simEffectZh } from '../client/i18n';
import { EFFECT_PRIMITIVES } from '../src/shared/constants';
import { World } from '../src/kernel/world.js';

const SOURCES = [
  '(bolt target 8 :ice)', '(disarm target)', '(root target 2)', '(heal self 10)', '(shield self 10 3)', '(haste self 1.3 3)',
  '(push target 3)', '(nova 4 6 :fire)', '(patronus 5)', '(apparate (vec 3 3))', '(light 10)', '(reveal :tempus)',
  '(chain target 6 :lightning)', '(storm aim 4 6 :lightning)', '(say "hi there")', '(regen self 2 4)', '(cleanse self)',
  '(mend 5 8)', '(summon :serpent 10)', '(glamour :robe "#7a1f2b")', '(after 1 (heal self 2))',
];

describe('simulate lines in Chinese', () => {
  it('translates every primitive the kernel can plan', () => {
    const w = new World({ seed: 4, secret: 'sim-zh' });
    const me = w.enroll('Linguist').wizard;
    me.year = 7; me.seals = 4; me.connections = 1; me.hp = me.hp - 30;
    const other = w.enroll('Target').wizard;
    other.pos = { x: me.pos.x + 3, z: me.pos.z };
    other.connections = 1;
    const lines: string[] = [];
    for (const src of SOURCES) {
      const r = w.simulate(me.id, src, { target: other.handle });
      lines.push(...r.effects);
    }
    expect(lines.length).toBeGreaterThanOrEqual(SOURCES.length - 3);
    for (const l of lines) {
      const zh = simEffectZh(l);
      expect(zh, l).not.toBe(l);
      expect(zh, l).not.toMatch(/\b(mana|bolt|heal|shield|nova|storm|chain|root|push|haste|regen|mend|summon|glamour|delayed)\b/);
    }
  });
  it('names every primitive', () => {
    for (const p of EFFECT_PRIMITIVES) expect(primName(p), p).not.toBe(p);
  });
});
