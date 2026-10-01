/**
 * 场景道具 (src/shared/props.ts, src/kernel/props.ts): where they stand, what each spell does to them, and that the
 * rewards are capped.
 */
import { describe, expect, it } from 'vitest';
import { XP_FOR_YEAR } from '../src/kernel/progression.js';
import { STATIC_COLLIDERS, signedDistance } from '../src/shared/layout.js';
import { PROP_BREAKS_PER_TERM, PROP_BREAK_XP, PROP_DEFS, PROP_GROUPS, PROP_GROUP_GALLEONS, PROP_GROUP_XP, PROP_RESPAWN_S, PROPS, propById } from '../src/shared/props.js';
import { sceneAt } from '../src/shared/scenes.js';
import { touch } from '../src/kernel/props.js';
import { World } from '../src/kernel/world.js';
import type { Creature, Wizard } from '../src/kernel/types.js';

function mk() {
  const w = new World({ seed: 21, secret: 'props' });
  w.rules.creatures.spawnMultiplier = 0;
  w.rules.events.pool = [];
  w.term.endsAt = 1e12;
  return w;
}
function wiz(w: World, name: string, at: { x: number; z: number }, year = 1): Wizard {
  const a = w.enroll(`${name} Wiz`, 'Gryffindor' as never).wizard;
  a.connections = 1; a.createdAt = -1e6; a.pos = { ...at };
  if (year > 1) w.gainXp(a, XP_FOR_YEAR[year] - a.xp);
  a.mana = 1e6;
  return a;
}
function addCreature(world: World, kind: Creature['kind'], x: number, z: number): Creature {
  const c: Creature = { id: `c_${kind}_${x}_${z}`, kind, pos: { x, z }, home: { x, z }, hp: 1000, maxHp: 1000, facing: 0, target: null, attackCd: 99, rootedUntil: 0, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
  world.creatures.set(c.id, c);
  return c;
}
const run = (w: World, s: number) => { for (let i = 0; i < Math.round(s * 20); i++) w.tick(); };
const p = (id: string) => propById(id)!;

describe('props: where they stand', () => {
  it('every prop on open ground inside a scene, clear of the veil, out of the safe zones; ids unique', () => {
    const w = mk();
    expect(new Set(PROPS.map((q) => q.id)).size).toBe(PROPS.length);
    for (const q of PROPS) {
      const s = sceneAt(q.x, q.z);
      expect(s, q.id).not.toBeNull();
      expect(Math.min(q.x - s!.box[0], s!.box[2] - q.x, q.z - s!.box[1], s!.box[3] - q.z), q.id).toBeGreaterThanOrEqual(3);
      expect(w.inSafe(q), q.id).toBe(false);
      expect(STATIC_COLLIDERS.every((c) => signedDistance(c, q.x, q.z) >= 1.4), q.id).toBe(true);
    }
  });
  it('each group: three of its kind, close enough for one nova of radius 5 from their middle', () => {
    for (const g of PROP_GROUPS) {
      const ms = PROPS.filter((q) => q.group === g.id);
      expect(ms.length, g.id).toBe(3);
      expect(ms.every((q) => q.kind === g.kind), g.id).toBe(true);
      const cx = ms.reduce((a, q) => a + q.x / 3, 0), cz = ms.reduce((a, q) => a + q.z / 3, 0);
      for (const q of ms) expect(Math.hypot(q.x - cx, q.z - cz), q.id).toBeLessThan(4);
    }
    expect(PROPS.length).toBeGreaterThanOrEqual(60);
  });
});

describe('props: what spells do', () => {
  it('a straight Stupefy at a crate breaks it (the bolt is spent), pays a little, and the crate comes back', () => {
    const w = mk();
    const crate = p('lawn-1');
    const a = wiz(w, 'Breaker', { x: crate.x, z: crate.z + 8 });
    const xp = a.xp;
    expect(w.cast(a.id, 'Stupefy', { aim: { x: crate.x, z: crate.z } }).ok).toBe(true);
    run(w, 1.5);
    expect(w.props.broken.has(crate.id)).toBe(true);
    expect(a.xp - xp).toBe(PROP_BREAK_XP);
    expect(w.projectiles.size).toBe(0);
    run(w, PROP_RESPAWN_S + 1.5);
    expect(w.props.broken.has(crate.id)).toBe(false);
  });
  it('breaking pays at most PROP_BREAKS_PER_TERM times a term', () => {
    const w = mk();
    const a = wiz(w, 'Greedy', { x: 0, z: 10 });
    const xp = a.xp;
    for (let i = 0; i < PROP_BREAKS_PER_TERM + 20; i++) { w.props.broken.clear(); touch(w, p('lawn-1'), 'arcane', a.id); }
    expect(a.xp - xp).toBe(PROP_BREAK_XP * PROP_BREAKS_PER_TERM);
  });
  it('three Incendios at the dungeon braziers, one by one: the group pays once this term; the next term again', () => {
    const w = mk();
    const ms = PROPS.filter((q) => q.group === 'dungeon-fire');
    const a = wiz(w, 'Lighter', { x: -40, z: -18 });
    const xp = a.xp, g = a.galleons;
    for (const q of ms) { expect(w.cast(a.id, 'Incendio', { aim: { x: q.x, z: q.z } }).ok).toBe(true); run(w, 1.6); }
    for (const q of ms) expect(w.props.awake.has(q.id), q.id).toBe(true);
    expect(a.xp - xp).toBe(PROP_GROUP_XP);
    expect(a.galleons - g).toBe(PROP_GROUP_GALLEONS);
    // again this term: nothing more
    w.props.awake.clear();
    for (const q of ms) touch(w, q, 'fire', a.id);
    expect(a.xp - xp).toBe(PROP_GROUP_XP);
    // a new term
    w.term.n++;
    w.props.awake.clear();
    for (const q of ms) touch(w, q, 'fire', a.id);
    expect(a.xp - xp).toBe(2 * PROP_GROUP_XP);
  });
  it('one Bombarda (a fire nova) in their middle lights all three at once', () => {
    const w = mk();
    const ms = PROPS.filter((q) => q.group === 'dungeon-fire');
    const c = { x: ms.reduce((s, q) => s + q.x / 3, 0), z: ms.reduce((s, q) => s + q.z / 3, 0) };
    const a = wiz(w, 'Bomber', c, 3);
    const xp = a.xp;
    expect(w.cast(a.id, 'Bombarda').ok).toBe(true);
    run(w, 0.2);
    for (const q of ms) expect(w.props.awake.has(q.id), q.id).toBe(true);
    expect(a.xp - xp).toBeGreaterThanOrEqual(PROP_GROUP_XP);
  });
  it('two wizards lighting one group together are both paid', () => {
    const w = mk();
    const ms = PROPS.filter((q) => q.group === 'village-fire');
    const a = wiz(w, 'A', { x: 0, z: 170 }), b = wiz(w, 'B', { x: 0, z: 171 });
    const xa = a.xp, xb = b.xp;
    touch(w, ms[0], 'fire', a.id); touch(w, ms[1], 'fire', b.id); touch(w, ms[2], 'fire', a.id);
    expect(a.xp - xa).toBe(PROP_GROUP_XP);
    expect(b.xp - xb).toBe(PROP_GROUP_XP);
  });
  it('the wrong element does nothing; ice puts a lit brazier out; a lit one burns down', () => {
    const w = mk();
    const a = wiz(w, 'Frost', { x: -40, z: -18 });
    const b = p('dun-1');
    expect(touch(w, b, 'lightning', a.id)).toBe(false);
    touch(w, b, 'fire', a.id);
    expect(w.props.awake.has(b.id)).toBe(true);
    touch(w, b, 'ice', a.id);
    expect(w.props.awake.has(b.id)).toBe(false);
    touch(w, b, 'fire', a.id);
    run(w, (PROP_DEFS.brazier.secs ?? 40) + 1.5);
    expect(w.props.awake.has(b.id)).toBe(false);
  });
  it('a whizbang set off by fire hurts a wild creature near it and sets off the crate beside it', () => {
    const w = mk();
    const wb = p('yard-1'), crate = p('yard-2');
    const a = wiz(w, 'Weasley', { x: wb.x + 10, z: wb.z });
    const troll = addCreature(w, 'troll', wb.x + 1.5, wb.z);
    const hp = troll.hp;
    touch(w, wb, 'fire', a.id);
    expect(w.props.broken.has(wb.id)).toBe(true);
    expect(w.props.broken.has(crate.id)).toBe(true);
    expect(troll.hp).toBeLessThan(hp);
  });
  it('a bolt with a target flies past the crates to it', () => {
    const w = mk();
    const crate = p('lawn-1');
    const a = wiz(w, 'Duel', { x: crate.x, z: crate.z + 6 });
    const pixie = addCreature(w, 'pixie', crate.x, crate.z - 4);
    expect(w.cast(a.id, 'Stupefy', { target: pixie.id }).ok).toBe(true);
    run(w, 1.5);
    expect(w.props.broken.has(crate.id)).toBe(false);
  });
  it('the snapshot carries what is not at rest; look lists the props near you; the counts survive a restart', () => {
    const w = mk();
    const a = wiz(w, 'Look', { x: -40, z: -20 });
    touch(w, p('dun-1'), 'fire', a.id);
    touch(w, p('dun-4'), 'arcane', a.id);
    const s = w.snapshot() as unknown as { props?: { b: Record<string, number>; a: Record<string, number> } };
    expect(s.props?.a['dun-1']).toBeGreaterThan(0);
    expect(s.props?.b['dun-4']).toBeGreaterThan(0);
    const look = w.look(a.id) as unknown as { props?: { id: string; state: string }[] };
    const seen = JSON.stringify(look);
    expect(seen).toContain('dun-1');
    const d1 = (look.props ?? []).find((q) => q.id === 'dun-1') as unknown as { secondsLeft?: number; groupLit?: string };
    expect(d1.secondsLeft).toBeGreaterThan(30);
    expect(d1.groupLit).toBe('1/3');
    const back = World.restore(JSON.parse(JSON.stringify(w.serialize())));
    expect(back.props.breaks.get(a.id)).toBe(1);
  });
});
