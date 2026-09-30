/**
 * The second Sonnet phone round's leftovers (docs/PLAYTEST.md round 6): a first-year is not swarmed — at most
 * NEWCOMER_PACK wild creatures pick them on their own at once; one they hit still comes after them.
 */
import { describe, expect, it } from 'vitest';
import { World } from '../src/kernel/world.js';
import type { Creature, Wizard } from '../src/kernel/types.js';

function mk() {
  const w = new World({ seed: 9, secret: 'round9' });
  w.rules.creatures.spawnMultiplier = 0;
  w.rules.events.pool = [];
  w.term.endsAt = 1e12;
  return w;
}
function join(w: World, name: string, x: number, z: number, year: number): Wizard {
  const a = w.enroll(name, 'Gryffindor' as never).wizard;
  a.connections = 1; a.createdAt = -1e6; a.year = year; a.pos = { x, z };
  a.hp = w.privateState(a.id).maxHp;
  return a;
}
function pixies(w: World, x: number, z: number, n: number): Creature[] {
  const out: Creature[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, p = { x: x + Math.cos(a) * 4, z: z + Math.sin(a) * 4 };
    const c: Creature = { id: `px${i}`, kind: 'pixie', pos: { ...p }, home: { ...p }, hp: 24, maxHp: 24, facing: 0, target: null, attackCd: 1e9, rootedUntil: 0, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
    w.creatures.set(c.id, c);
    out.push(c);
  }
  return out;
}
const run = (w: World, s: number) => { for (let i = 0; i < Math.round(s * 20); i++) w.tick(); };

describe('a newcomer is not swarmed', () => {
  it('five pixies round a first-year: two come for them; round a third-year: all five', () => {
    for (const [year, want] of [[1, 2], [3, 5]] as const) {
      const w = mk();
      const a = join(w, `Y${year}`, 120, 120, year);
      const ps = pixies(w, 120, 120, 5);
      run(w, 1);
      expect(ps.filter((c) => c.target === a.id).length, `year ${year}`).toBe(want);
    }
  });

  it('a pixie the first-year hits still goes for them (provoked is provoked)', () => {
    const w = mk();
    const a = join(w, 'Hitter', 120, 120, 1);
    const ps = pixies(w, 120, 120, 5);
    run(w, 1);
    const idle = ps.find((c) => c.target !== a.id)!;
    idle.target = a.id; idle.provokedUntil = w.now + 10; // what a hit does
    run(w, 1);
    expect(idle.target).toBe(a.id);
  });
});
