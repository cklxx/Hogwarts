/**
 * Creatures fight back (the AI playtest: 「刷怪没风险」 — ten bolts at a Devil's Snare from 40 m, not a scratch).
 * Hurt a creature and it goes after you well past its aggro range for PROVOKED_SECS; the snare, the troll and the
 * acromantula shoot. Their shots are real projectiles aimed where you stand, so standing still in a cast loop gets
 * you hit and moving dodges.
 */
import { describe, expect, it } from 'vitest';
import { PROVOKED_SECS, World } from '../src/kernel/world.js';
import type { Creature } from '../src/kernel/types.js';

function mk() {
  const w = new World({ seed: 7 });
  w.rules.creatures.spawnMultiplier = 0;
  return w;
}
function add(w: World, kind: Creature['kind'], x: number, z: number): Creature {
  const c: Creature = { id: `c_${kind}`, kind, pos: { x, z }, home: { x, z }, hp: 1000, maxHp: 1000, facing: 0, target: null, attackCd: 0, rootedUntil: 0, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
  w.creatures.set(c.id, c);
  return c;
}
function sniper(w: World, x: number, z: number) {
  const a = w.enroll('Sniper').wizard;
  a.connections = 1;
  a.pos = { x, z };
  return a;
}
const run = (w: World, secs: number, each?: () => void) => { for (let t = 0; t < secs * 20; t++) { each?.(); w.tick(); } };

describe('creatures fight back', () => {
  it('a snare burned from 40 m flings thorns back; one that was never hurt leaves a passer-by alone', () => {
    const w = mk();
    const snare = add(w, 'snare', 100, 100);
    const a = sniper(w, 60, 100);
    const hp0 = a.hp;
    run(w, 3);
    expect(a.hp).toBe(hp0); // not provoked: the snare only roots what lingers beside it
    w.damage(a.id, snare.id, 5, 'fire');
    run(w, 4);
    expect(a.hp).toBeLessThan(hp0);
  });

  it('a wizard who keeps moving dodges the thorns; one standing still in a loop does not', () => {
    const still = mk(), moving = mk();
    const s1 = add(still, 'snare', 100, 100), s2 = add(moving, 'snare', 100, 100);
    const a = sniper(still, 60, 100), b = sniper(moving, 60, 100);
    const hpA = a.hp, hpB = b.hp;
    let flip = 0;
    run(still, 6, () => { if (!(flip++ % 20)) still.damage(a.id, s1.id, 1, 'fire'); });
    flip = 0;
    run(moving, 6, () => {
      if (!(flip % 20)) moving.damage(b.id, s2.id, 1, 'fire');
      moving.setInput(b.id, 0, Math.floor(flip++ / 16) % 2 ? 1 : -1); // strafe back and forth
    });
    const lostStill = hpA - a.hp, lostMoving = hpB - b.hp;
    expect(lostStill).toBeGreaterThan(10);
    expect(lostMoving).toBeLessThan(lostStill / 2);
  });

  it('a provoked pixie chases past its aggro range, then gives up once the grudge fades', () => {
    const w = mk();
    const pixie = add(w, 'pixie', 100, 100);
    const a = sniper(w, 80, 100); // 20 m: beyond the pixie's 7 m aggro and 17.5 m pursuit
    w.damage(a.id, pixie.id, 1, 'fire');
    run(w, 2);
    expect(Math.hypot(pixie.pos.x - a.pos.x, pixie.pos.z - a.pos.z)).toBeLessThan(12);
    // run far away: past the leash it forgets you
    a.pos = { x: 20, z: 100 };
    run(w, PROVOKED_SECS + 2);
    expect(pixie.target).toBeNull();
  });
});
