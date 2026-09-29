/** 决斗手感 (roadmap step 3): the dodge roll, the perfect Protego, and spells meeting in mid-air. */
import { describe, expect, it } from 'vitest';
import { DODGE_CD_S, DODGE_DIST, PERFECT_PROTEGO_S, World } from '../src/kernel/world.js';
import type { Wizard } from '../src/kernel/types.js';

function mk() {
  const w = new World({ seed: 11, secret: 'duel-feel' });
  w.rules.creatures.spawnMultiplier = 0;
  w.rules.combat.pvp = true;
  return w;
}
function join(w: World, name: string, x: number, z: number): Wizard {
  const a = w.enroll(name).wizard;
  a.connections = 1;
  a.year = 1;
  a.createdAt = -1e6;
  a.pos = { x, z };
  return a;
}
const run = (w: World, s: number) => { for (let i = 0; i < s * 20; i++) w.tick(); };
/** A bolt from `a` at `b` (the kernel's own projectile, as a cast would make). */
const bolt = (w: World, a: Wizard, b: Wizard, power = 10) => w.spawnProjectile(a, 'bolt', b.pos, b.id, power, 'arcane', 0, []);

describe('dodge roll', () => {
  it('dashes about DODGE_DIST metres, lets a bolt fly past, then needs DODGE_CD_S', () => {
    const w = mk();
    const a = join(w, 'Harry', 100, 100), b = join(w, 'Draco', 100, 115);
    const hp = a.hp;
    bolt(w, b, a);
    run(w, 0.25); // the bolt is on its way
    expect(w.dodge(a.id, 1, 0)).toEqual({ ok: true });
    run(w, 0.3);
    expect(a.pos.x - 100).toBeGreaterThan(DODGE_DIST * 0.8);
    run(w, 1.5);
    expect(a.hp).toBe(hp); // it flew where they had been
    expect(w.dodge(a.id, 1, 0).ok).toBe(false); // still catching their breath
    run(w, DODGE_CD_S);
    expect(w.dodge(a.id, -1, 0).ok).toBe(true);
  });

  it('an agent\'s dodge yields to the human steering', () => {
    const w = mk();
    const a = join(w, 'Ron', 100, 100);
    w.setInput(a.id, 0, 1);
    expect(w.dodge(a.id, 1, 0, 'agent').ok).toBe(false);
  });
});

describe('perfect Protego', () => {
  it('a shield raised just before the bolt lands sends it back at the caster; a late one only absorbs', () => {
    const w = mk();
    const a = join(w, 'Hermione', 100, 100), b = join(w, 'Pansy', 100, 110);
    const hpA = a.hp, hpB = b.hp;
    bolt(w, b, a, 12);
    // the bolt needs ~0.3 s for 10 m: raise the shield when it is about to land
    for (let i = 0; i < 40 && !w.wizards.get(a.id)!.st.shieldAt; i++) {
      const p = [...w.projectiles.values()][0];
      if (p && Math.hypot(p.pos.x - a.pos.x, p.pos.z - a.pos.z) < 3) w.shield(a, a, 30, 3);
      w.tick();
    }
    run(w, 1.5);
    expect(a.hp).toBe(hpA);
    expect(b.hp).toBeLessThan(hpB); // hit by their own spell
    expect(a.stats.reflects).toBe(1);

    // a shield raised long before: it just soaks up the bolt
    const c = join(w, 'Neville', 140, 100), d = join(w, 'Goyle', 140, 110);
    w.shield(c, c, 30, 5);
    run(w, PERFECT_PROTEGO_S + 0.2);
    const hpD = d.hp;
    bolt(w, d, c, 12);
    run(w, 1.5);
    expect(d.hp).toBe(hpD);
    expect(c.stats.reflects ?? 0).toBe(0);
  });
});

describe('spell clash', () => {
  it('two duelists\' bolts meeting head-on: the stronger goes on, weakened; equal ones cancel', () => {
    const w = mk();
    const a = join(w, 'Cedric', 100, 100), b = join(w, 'Viktor', 100, 130);
    const hpA = a.hp, hpB = b.hp;
    bolt(w, a, b, 14);
    bolt(w, b, a, 10);
    run(w, 2);
    expect(hpA - a.hp).toBe(0);
    expect(hpB - b.hp).toBeGreaterThan(0);
    expect(hpB - b.hp).toBeLessThanOrEqual(4 + 1e-6); // 14 − 10 got through (before wards)

    const c = join(w, 'Fred', 160, 100), d = join(w, 'George', 160, 130);
    const hpC = c.hp, hpD = d.hp;
    bolt(w, c, d, 10);
    bolt(w, d, c, 10);
    run(w, 2);
    expect(c.hp).toBe(hpC);
    expect(d.hp).toBe(hpD);
  });
});
