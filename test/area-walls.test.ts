/** Area spells (nova, storm) stop at walls, like bolts do (World.inBlast = the bolt's hitSegment test). */
import { describe, expect, it } from 'vitest';
import { World } from '../src/kernel/world.js';
import type { Creature } from '../src/kernel/types.js';

function mk() {
  const w = new World({ seed: 5, secret: 'area-walls' });
  w.rules.creatures.spawnMultiplier = 0;
  return w;
}
function add(w: World, id: string, x: number, z: number): Creature {
  const c: Creature = { id, kind: 'pixie', pos: { x, z }, home: { x, z }, hp: 1000, maxHp: 1000, facing: 0, target: null, attackCd: 1e9, rootedUntil: 1e9, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
  w.creatures.set(c.id, c);
  return c;
}
/** A wall with free ground 1.5 m either side of it, outside every safe zone. */
function findWall(w: World) {
  const free = (x: number, z: number) => { const p = { x, z }; w.solids.resolve(p, 0.5); return Math.hypot(p.x - x, p.z - z) < 1e-6 && !w.inSafe({ x, z }); };
  for (let z = -120; z <= 120; z += 1) for (let x = -120; x <= 120; x += 1) {
    if (!free(x, z) || !free(x + 4, z) || !free(x, z + 3) || !free(x + 4, z + 3)) continue;
    if (w.solids.hitSegment(x, z, x + 4, z) && !w.solids.hitSegment(x, z, x, z + 3) && !w.solids.hitSegment(x + 4, z, x + 4, z + 3)) return { x, z };
  }
  throw new Error('no wall found');
}

describe('area spells and walls', () => {
  it('a nova hits what stands on your side of a wall, not what stands behind it', () => {
    const w = mk();
    const at = findWall(w);
    const me = w.enroll('Blaster').wizard;
    me.pos = { ...at };
    const behind = add(w, 'c_behind', at.x + 4, at.z), beside = add(w, 'c_beside', at.x, at.z + 3);
    w.nova(me, 5, 20, 'arcane', []);
    expect(beside.hp).toBeLessThan(1000);
    expect(behind.hp).toBe(1000);
  });

  it('a storm hits from where it breaks: a wall between the centre and you shelters you', () => {
    const w = mk();
    const at = findWall(w);
    const me = w.enroll('Stormer').wizard;
    me.pos = { x: at.x, z: at.z + 3 };
    const behind = add(w, 'c_behind', at.x + 4, at.z), beside = add(w, 'c_beside', at.x, at.z + 1);
    w.storm(me, at, 5, 20, 'lightning', []);
    for (let i = 0; i < 40; i++) w.tick();
    expect(beside.hp).toBeLessThan(1000);
    expect(behind.hp).toBe(1000);
  });
});
