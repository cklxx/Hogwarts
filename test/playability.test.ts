import { describe, expect, it } from 'vitest';
import { World } from '../src/kernel/world.js';
import type { Creature, Wizard } from '../src/kernel/types.js';
import { NEWCOMER_PEACE_S, type CreatureKind } from '../src/shared/constants.js';
import { XP_FOR_YEAR } from '../src/kernel/progression.js';
const SECRET = 'test-secret';
function mk() {
  const w = new World({ seed: 11, secret: SECRET });
  w.rules.creatures.spawnMultiplier = 0;
  return w;
}
function join(w: World, name: string, house?: string): Wizard {
  const x = w.enroll(name, house).wizard;
  x.connections = 1;
  x.pos = { x: 60, z: 60 };
  return x;
}
/** Advance through real level-ups so the curriculum is granted. */
const setYear = (w: World, a: Wizard, y: number) => { if (a.year < y) w.gainXp(a, XP_FOR_YEAR[y] - a.xp); a.year = y; };
const run = (w: World, s: number) => { for (let t = 0; t < s; t += 0.05) w.tick(0.05); };
function creature(w: World, kind: CreatureKind, x: number, z: number, hp = 200): Creature {
  const c: Creature = { id: `c_${kind}_${x}_${z}`, kind, pos: { x, z }, home: { x, z }, hp, maxHp: hp, facing: 0, target: null, attackCd: 99, rootedUntil: 0, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
  w.creatures.set(c.id, c);
  return c;
}

describe('playability: the first minutes', () => {
  it('pixies notice you from 7 m, not 10', () => {
    const w = mk();
    const a = join(w, 'Hermione Granger');
    a.pos = { x: 60, z: 60 };
    a.createdAt = -1e6; // (past a newcomer's peace)
    const c = creature(w, 'pixie', 68.5, 60);
    run(w, 0.5);
    expect(c.target).toBeNull();
    c.pos = { x: 66, z: 60 };
    run(w, 0.5);
    expect(c.target).toBe(a.id);
  });

  it('a newcomer is left alone for NEWCOMER_PEACE_S — by whatever they have not hurt; what they hurt fights back', () => {
    const w = mk();
    const a = join(w, 'Luna Lovegood');
    a.pos = { x: 60, z: 60 };
    const c = creature(w, 'pixie', 62, 60), d = creature(w, 'pixie', 58, 60);
    const hp = a.hp;
    run(w, 3);
    expect(c.target).toBeNull();
    expect(d.target).toBeNull();
    expect(a.hp).toBe(hp);
    w.damage(a.id, c.id, 5, 'arcane');
    run(w, 1);
    expect(c.target).toBe(a.id);
    expect(d.target).toBeNull();
    a.createdAt = w.now - NEWCOMER_PEACE_S - 1;
    run(w, 1);
    expect(d.target).toBe(a.id);
  });

  it('creatures hit a brand-new wizard 30% softer for the first three minutes', () => {
    const w = mk();
    const a = join(w, 'Neville Longbottom');
    a.pos = { x: 60, z: 60 };
    const c = creature(w, 'pixie', 61, 60);
    a.hp = 100;
    const fresh = w.damage(c.id, a.id, 10, 'arcane');
    a.createdAt = w.now - 1000;
    a.hp = 100;
    const later = w.damage(c.id, a.id, 10, 'arcane');
    expect(fresh).toBeCloseTo(later * 0.7, 5);
  });

  it('a spell that finds nothing to act on costs nothing and says so', () => {
    const w = mk();
    const a = join(w, 'Luna Lovegood');
    a.pos = { x: 60, z: 60 };
    const f = w.forgeSpell(a.id, { name: 'Picky', source: '(when (first (enemies 5)) (bolt (first (enemies 5)) 5))' });
    const before = a.mana;
    const r = w.cast(a.id, f.spell.id);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/found nothing/);
    expect(a.mana).toBe(before);
    expect(w.simulate(a.id, '(count (enemies 20))').ok).toBe(true);
  });

  it('a new attack spell replaces a spent reveal charm on a full hotbar', () => {
    const w = mk();
    const a = join(w, 'Ron Weasley');
    expect(a.hotbar.every((x) => x !== null)).toBe(true);
    a.ui.push('tempus');
    setYear(w, a, 2);
    const names = a.hotbar.map((id) => a.spells.find((s) => s.id === id)?.name);
    expect(names).not.toContain('Tempus');
    expect(names).not.toContain('Lumos');
  });
});
