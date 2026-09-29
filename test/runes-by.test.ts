/** min-by / max-by (Runes special forms, year 4): the weakest enemy without a long chain of nths. */
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/runes/checker.js';
import { World } from '../src/kernel/world.js';
import type { Creature } from '../src/kernel/types.js';

function mob(w: World, id: string, x: number, z: number, hp: number): Creature {
  const c: Creature = { id, kind: 'pixie', pos: { x, z }, home: { x, z }, hp, maxHp: 100, facing: 0, target: null, attackCd: 1e9, rootedUntil: 1e9, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
  w.creatures.set(id, c);
  return c;
}

describe('min-by / max-by', () => {
  it('is fourth-year magic (the third-year exam weakest-link is about doing without it)', () => {
    expect(analyze('(bolt (min-by e (enemies 30) (hp e)) 10)').minYear).toBe(4);
    expect(() => analyze('(min-by (enemies 30) (hp e))')).toThrow(/min-by x list expr/);
    expect(() => analyze('(max-by e (enemies 30))')).toThrow(/max-by x list expr/);
  });

  it('picks the lowest / highest, nil on an empty list, ties to the first', () => {
    const w = new World({ seed: 3, secret: 'by' });
    w.rules.creatures.spawnMultiplier = 0;
    const me = w.enroll('Arithmancer').wizard;
    me.connections = 1; me.year = 4; me.pos = { x: 60, z: 60 };
    mob(w, 'c_a', 60, 66, 40); mob(w, 'c_b', 60, 70, 12); mob(w, 'c_c', 66, 60, 90); mob(w, 'c_d', 54, 60, 12);
    const aimAt = (src: string) => w.simulate(me.id, src).effects.join(' ');
    expect(aimAt('(bolt (min-by e (enemies 30) (hp e)) 10)')).toMatch(/bolt 10/);
    const r = w.simulate(me.id, '(say (name (min-by e (enemies 30) (hp e))))');
    expect(r.ok).toBe(true);
    const say = (src: string) => { const x = w.simulate(me.id, src); return x.effects[0]; };
    expect(say('(say (str (hp (min-by e (enemies 30) (hp e)))))')).toMatch(/"12"/);
    expect(say('(say (str (hp (max-by e (enemies 30) (hp e)))))')).toMatch(/"90"/);
    expect(say('(say (str (min-by e (list) (hp e))))')).toMatch(/say ""|say "nil"/);
  });
});
