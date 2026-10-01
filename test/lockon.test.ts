/**
 * 锁定 (the 2026-10-01 playtest: four agents locked on to Mia in a 2v2, and their own spells — written as
 * (first (enemies r)) — hit Seamus, who stood nearer): the foe you name comes first in (enemies r), so every spell
 * that picks "the first enemy" goes for whom you locked on to. The kernel's own targeted spells already did.
 */
import { describe, expect, it } from 'vitest';
import { DUEL_BOW_S, DUEL_COUNT_S, DUEL_STAGE, duelJoin } from '../src/kernel/duelclub.js';
import { XP_FOR_YEAR } from '../src/kernel/progression.js';
import { World } from '../src/kernel/world.js';
import type { Creature } from '../src/kernel/types.js';

const run = (w: World, s: number) => { for (let i = 0; i < Math.round(s * 20); i++) w.tick(); };
function troll(w: World, id: string, x: number, z: number): Creature {
  const c: Creature = { id, kind: 'troll', pos: { x, z }, home: { x, z }, hp: 1000, maxHp: 1000, facing: 0, target: null, attackCd: 99, rootedUntil: 0, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
  w.creatures.set(id, c);
  return c;
}

describe('lock-on', () => {
  it('(first (enemies r)) is the foe you named, wherever the others stand; nearest first when you named none', () => {
    const w = new World({ seed: 21, secret: 'lock' });
    w.rules.creatures.spawnMultiplier = 0;
    const me = w.enroll('Lock Me', 'Gryffindor' as never).wizard;
    me.connections = 1; me.createdAt = -1e6; me.pos = { x: 40, z: 0 }; me.mana = 1e6;
    w.forgeSpell(me.id, { name: 'Pick', source: '(bolt (first (enemies 25)) 10)' });
    const near = troll(w, 'c_near', 40, 4), far = troll(w, 'c_far', 40, 12);
    expect(w.cast(me.id, 'Pick', { target: far.id }).ok).toBe(true);
    run(w, 1.5);
    expect(far.hp).toBeLessThan(1000);
    expect(near.hp).toBe(1000);
    me.cooldowns = {}; me.globalCd = 0;
    expect(w.cast(me.id, 'Pick').ok).toBe(true);
    run(w, 1.5);
    expect(near.hp).toBeLessThan(1000);
  });
  it('a 2v2: every first-to-fifth-year attack spell named at one foe lands on that foe, the other standing in front', () => {
    const w = new World({ seed: 21, secret: '2v2' });
    w.rules.creatures.spawnMultiplier = 0;
    const mk = (n: string, h: string) => { const a = w.enroll(n, h as never).wizard; a.connections = 1; a.createdAt = -1e6; a.pos = { x: DUEL_STAGE.x, z: DUEL_STAGE.z + 5 }; w.gainXp(a, XP_FOR_YEAR[5] - a.xp); return a; };
    const ps = [mk('Jake Lock', 'Gryffindor'), mk('Qiu Lock', 'Ravenclaw'), mk('Mia Lock', 'Slytherin'), mk('Seamus Finnigan', 'Gryffindor')];
    ps[3].npc = true;
    for (const p of ps) duelJoin(w, p.id, '2v2');
    run(w, 0.1);
    const m = w.duel.match!;
    run(w, DUEL_BOW_S + DUEL_COUNT_S + 0.2);
    const me = ps[0], foes = m.sides.find((s) => !s.includes(me.id))!.map((id) => w.wizards.get(id)!);
    const [t, o] = foes;
    w.forgeSpell(me.id, { name: 'First Foe', source: '(bolt (first (enemies 25)) 12 :fire)' });
    for (const name of ['Stupefy', 'Incendio', 'Glacius', 'Expelliarmus', 'Petrificus Totalus', 'Depulso', 'Reducto', 'First Foe']) {
      me.mana = 1e6; me.cooldowns = {}; me.globalCd = 0;
      for (const f of foes) { f.hp = 100; f.st.rootedUntil = 0; f.st.disarmedUntil = 0; }
      me.pos = { x: DUEL_STAGE.x, z: DUEL_STAGE.z - 6 }; o.pos = { x: DUEL_STAGE.x, z: DUEL_STAGE.z - 2 }; t.pos = { x: DUEL_STAGE.x + 0.5, z: DUEL_STAGE.z + 4 };
      const o0 = { ...o.pos }, t0 = { ...t.pos };
      expect(w.cast(me.id, name, { target: t.name }).ok, name).toBe(true);
      run(w, 1.5);
      const tHit = t.hp < 100 || t.st.rootedUntil > w.now || t.st.disarmedUntil > w.now || Math.hypot(t.pos.x - t0.x, t.pos.z - t0.z) > 1;
      const oHit = o.hp < 100 || o.st.rootedUntil > w.now || o.st.disarmedUntil > w.now || Math.hypot(o.pos.x - o0.x, o.pos.z - o0.z) > 1;
      expect([name, tHit, oHit]).toEqual([name, true, false]);
    }
  });
});

describe('a spell with a target weaves past trees (「火打不到后面的怪物」)', () => {
  it('every forest trunk: a spider right behind it, locked on, is hit; a straight shot still stops at the trunk; look says not blocked', async () => {
    const { STATIC_COLLIDERS } = await import('../src/shared/layout.js');
    const { sceneAt } = await import('../src/shared/scenes.js');
    const trees = STATIC_COLLIDERS.filter((c) => c.style === 'tree' && c.kind === 'disc' && sceneAt(c.x, c.z)?.id === 'forest') as { x: number; z: number; r: number }[];
    expect(trees.length).toBeGreaterThan(10);
    let checked = 0;
    for (const t of trees) {
      const w = new World({ seed: 21, secret: 'tree' });
      w.rules.creatures.spawnMultiplier = 0; w.rules.events.pool = []; w.term.endsAt = 1e12;
      const me = w.enroll('Tree Me', 'Gryffindor' as never).wizard;
      me.connections = 1; me.createdAt = -1e6; me.mana = 1e6;
      me.pos = { x: t.x, z: t.z + t.r + 8 };
      const foe = troll(w, 'c_behind', t.x, t.z - t.r - 1.5);
      foe.rootedUntil = 1e9; // (it stays behind the trunk)
      const at = { ...foe.pos };
      w.solids.resolve(me.pos, 0.5); w.solids.resolve(foe.pos, 1);
      if (Math.hypot(foe.pos.x - at.x, foe.pos.z - at.z) > 0.01) continue; // (pushed aside: the trunk is not squarely between)
      // only trunks between (no wall, nothing else)
      const hit = w.solids.hitSegment(me.pos.x, me.pos.z, foe.pos.x, foe.pos.z);
      if (!hit || hit.style !== 'tree' || !w.inAim(me.pos, foe.pos) || sceneAt(me.pos.x, me.pos.z)?.id !== 'forest') continue;
      checked++;
      const look = w.look(me.id) as unknown as { creatures: { id: string; blocked?: boolean }[] };
      expect(look.creatures.find((c) => c.id === foe.id)?.blocked, 'look').toBeUndefined();
      expect(w.cast(me.id, 'Incendio', { target: foe.id }).ok).toBe(true);
      run(w, 2);
      expect(foe.hp, `behind the tree at (${t.x}, ${t.z})`).toBeLessThan(1000);
      me.cooldowns = {}; me.globalCd = 0;
      foe.auras = []; // (the first one's burn)
      const hp = foe.hp;
      w.cast(me.id, 'Incendio', { aim: { ...foe.pos } });
      run(w, 2);
      expect(foe.hp, 'a straight shot stops at the trunk').toBe(hp);
    }
    expect(checked).toBeGreaterThan(10);
  });
});
