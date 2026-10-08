/**
 * The basic loop (the 2026-10-02 measure): the press buffer (client/controls.ts castGate) and 战斗回蓝
 * (src/kernel/focus.ts) — a mashing first-year is never refused for pressing early, and hitting keeps them in mana.
 */
import { describe, expect, it } from 'vitest';
import { World } from '../src/kernel/world.js';
import { castGate } from '../client/controls.js';
import { FOCUS_MAX_PER_S, FOCUS_REFUND } from '../src/kernel/focus.js';
import type { Creature } from '../src/kernel/types.js';


describe('the press buffer', () => {
  const s = { id: 's1', name: 'Stupefy', cd: 0, mana: 15 };
  it('waits out the global cooldown, the spell’s own and the server’s; then goes', () => {
    expect(castGate(s, 100, 1, 1.2, 0)).toBe('cd');
    expect(castGate(s, 100, 1, 0, 1.4)).toBe('cd');
    expect(castGate({ ...s, cd: 0.3 }, 100, 1, 0, 0)).toBe('cd');
    expect(castGate(s, 100, 1, 0.9, 0.95)).toBe('go');
  });
  it('waits for mana; an unknown cost never blocks', () => {
    expect(castGate(s, 10, 1, 0, 0)).toBe('mana');
    expect(castGate({ ...s, mana: null }, 0, 1, 0, 0)).toBe('go');
  });
});

describe('战斗回蓝', () => {
  function mk() {
    const w = new World({ seed: 31, secret: 'focus' });
    w.rules.creatures.spawnMultiplier = 0; w.rules.events.pool = []; w.term.endsAt = 1e12;
    const a = w.enroll('Focus Me', 'Hufflepuff' as never).wizard;
    a.connections = 1; a.createdAt = -1e6; a.pos = { x: 30, z: 22 };
    const c: Creature = { id: 'c_t', kind: 'pixie', pos: { x: 30, z: 32 }, home: { x: 30, z: 32 }, hp: 1e5, maxHp: 1e5, facing: 0, target: null, attackCd: 99, rootedUntil: 1e9, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
    w.creatures.set(c.id, c);
    return { w, a, c };
  }
  it('a hit on a wild creature gives FOCUS_REFUND back, at most FOCUS_MAX_PER_S a second', () => {
    const { w, a, c } = mk();
    a.mana = 50;
    w.damage(a.id, c.id, 10, 'arcane', ['Stupefy'], undefined);
    expect(a.mana).toBe(50 + FOCUS_REFUND);
    for (let i = 0; i < 5; i++) w.damage(a.id, c.id, 10, 'arcane', ['Stupefy']);
    expect(a.mana).toBeLessThanOrEqual(50 + FOCUS_MAX_PER_S);
  });
  it('not on a wizard, not on a summon, not in an exam sandbox', () => {
    const { w, a, c } = mk();
    const b = w.enroll('Focus Foe', 'Slytherin' as never).wizard;
    b.connections = 1; b.createdAt = -1e6; b.pos = { x: 32, z: 22 };
    a.mana = 50;
    w.damage(a.id, b.id, 10, 'arcane', ['Stupefy']);
    expect(a.mana).toBe(50);
    w.rules.magic.manaRegen = 0;
    w.damage(a.id, c.id, 10, 'arcane', ['Stupefy']);
    expect(a.mana).toBe(50);
  });
  it('mashing Stupefy at a (rooted, harmless) pixie for 60 s: half again as many casts as mana alone could pay for', () => {
    const { w, a, c } = mk();
    const mana0 = a.mana;
    let ok = 0, cost = 0;
    for (let t = 0; t < 60 * 20; t++) {
      w.tick();
      if (t % 2) continue;
      const r = w.cast(a.id, 'Stupefy', { target: c.id });
      if (r.ok) { ok++; cost = r.mana; }
    }
    expect(a.st.stunnedUntil).toBe(0);
    const ceiling = (mana0 + 60 * w.rules.magic.manaRegen) / cost; // (every cast paid by regen alone)
    expect(ok).toBeGreaterThan(ceiling * 1.5);
  });
});
