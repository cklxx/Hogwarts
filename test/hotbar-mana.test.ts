/** The hotbar shows each spell's mana cost before its first cast (World.manaOf), then what it last cost. */
import { describe, expect, it } from 'vitest';
import { World } from '../src/kernel/world.js';

describe('hotbar mana cost', () => {
  it('is estimated before the first cast and equals what a cast then charges', () => {
    const w = new World({ seed: 9, secret: 'hotbar-mana' });
    const me = w.enroll('Costly').wizard;
    me.connections = 1;
    const bar = w.privateState(me.id).hotbar.filter(Boolean);
    expect(bar.length).toBeGreaterThan(0);
    for (const s of bar) expect(s!.mana, s!.name).toBeGreaterThan(0);
    const heal = me.spells.find((s) => s.effects.includes('heal'))!;
    const before = w.privateState(me.id).hotbar.find((s) => s?.id === heal.id)!.mana;
    me.hp -= 20;
    const r = w.cast(me.id, heal.id, { target: me.id });
    expect(r.ok).toBe(true);
    expect(Math.round(r.mana)).toBe(before);
    expect(heal.lastMana).toBe(Math.round(r.mana));
  });
});
