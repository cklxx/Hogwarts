/**
 * The society playtest (five agents playing people, 2026-09-30): a duellist's roll stays on the stage (the duel
 * reflex rolled two of them into the Great Hall's safe zone: out); the lake's Dementors hunt only at the lake (they
 * flew into the courtyard after anyone within 25 m); reflexes survive a restart (one player thought them lost).
 */
import { describe, expect, it } from 'vitest';
import { DUEL_BOW_S, DUEL_COUNT_S, DUEL_LEASH, DUEL_STAGE, duelJoin } from '../src/kernel/duelclub.js';
import { setReflexes } from '../src/kernel/reflexes.js';
import { DODGE_DIST, World } from '../src/kernel/world.js';
import type { Creature, Wizard } from '../src/kernel/types.js';
import { sceneAt } from '../src/shared/scenes.js';

function mk() {
  const w = new World({ seed: 10, secret: 'round10' });
  w.rules.creatures.spawnMultiplier = 0;
  w.rules.events.pool = [];
  w.term.endsAt = 1e12;
  return w;
}
function join(w: World, name: string, house: string, at = { x: DUEL_STAGE.x, z: DUEL_STAGE.z + 5 }): Wizard {
  const a = w.enroll(name, house as never).wizard;
  a.connections = 1; a.createdAt = -1e6; a.pos = { ...at };
  a.hp = w.privateState(a.id).maxHp;
  return a;
}
const run = (w: World, s: number) => { for (let i = 0; i < Math.round(s * 20); i++) w.tick(); };

describe('a roll in a duel stays on the stage', () => {
  it('rolling toward the Great Hall from the stage edge goes another way: still in the match', () => {
    const w = mk();
    const a = join(w, 'Mia', 'Gryffindor'), b = join(w, 'Jake', 'Slytherin');
    duelJoin(w, a.id); duelJoin(w, b.id);
    run(w, DUEL_BOW_S + DUEL_COUNT_S + 0.2);
    expect(w.duel.match?.phase).toBe('fight');
    // a metre from the Great Hall's doors (its safe zone starts at z = -41), rolling straight in
    a.pos = { x: 0, z: -38 };
    expect(w.dodge(a.id, 0, -1).ok).toBe(true);
    run(w, 1);
    expect(w.inSafe(a.pos)).toBe(false);
    expect(w.duel.match?.out[a.id]).toBeUndefined();
    // and at the leash, rolling outward comes back in
    w.now += 5;
    a.pos = { x: DUEL_STAGE.x + DUEL_LEASH - 2, z: DUEL_STAGE.z };
    expect(w.dodge(a.id, 1, 0).ok).toBe(true);
    run(w, 1);
    expect(Math.hypot(a.pos.x - DUEL_STAGE.x, a.pos.z - DUEL_STAGE.z)).toBeLessThanOrEqual(DUEL_LEASH);
    expect(w.duel.match?.out[a.id]).toBeUndefined();
  });

  it('outside a duel a roll goes where it is aimed', () => {
    const w = mk();
    const a = join(w, 'Lin', 'Ravenclaw', { x: 0, z: 0 }); // the lawn south of the courtyard
    w.dodge(a.id, 0, 1);
    run(w, 1);
    expect(a.pos.z).toBeGreaterThan(DODGE_DIST * 0.75); // (4 of the roll's 5 ticks at 20 Hz: 3.6 m, as before)
  });
});

describe("the lake's Dementors stay at the lake", () => {
  it('one at the lake shore never picks a wizard across the mist, and never flies into the castle', () => {
    const w = mk();
    w.isNight = () => true;
    const a = join(w, 'Qiu', 'Hufflepuff', { x: -60, z: 20 }); // the castle's west lawn, 20 m from the lake's veil
    const c: Creature = { id: 'dm', kind: 'dementor', pos: { x: -74, z: 20 }, home: { x: -74, z: 20 }, hp: 150, maxHp: 150, facing: 0, target: null, attackCd: 0, rootedUntil: 0, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
    w.creatures.set(c.id, c);
    run(w, 10);
    expect(c.target).not.toBe(a.id);
    expect(sceneAt(c.pos.x, c.pos.z)?.id).toBe('lake');
    // even set on them (a stale target from before the scenes), it lets go and stays home
    c.target = a.id;
    run(w, 5);
    expect(c.target).toBeNull();
    expect(sceneAt(c.pos.x, c.pos.z)?.id).toBe('lake');
  });
});

describe('reflexes survive a restart', () => {
  it('saved and loaded with the world', () => {
    const w = mk();
    const a = join(w, 'Jake', 'Slytherin');
    setReflexes(w, a.id, [{ when: 'incoming', do: 'dodge' }, { when: 'low_hp', do: 'say', text: '救命', below: 0.2 }]);
    const w2 = World.restore(JSON.parse(JSON.stringify(w.serialize())));
    expect(w2.reflexes.of.get(a.id)?.map((r) => r.do)).toEqual(['dodge', 'say']);
  });
});
