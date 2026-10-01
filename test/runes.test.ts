/**
 * 符文零件 (src/shared/runes.ts, src/kernel/runes.ts) and the greenhouse encounter — with the guarantees of
 * docs/DESIGN.md §4: every new player gets a rune from the first reaction (which is itself guaranteed), and the
 * first spell anyone casts at the greenhouse's snares reacts.
 */
import { describe, expect, it } from 'vitest';
import { FEATURE_BY_ID } from '../src/kernel/features.js';
import { touch } from '../src/kernel/props.js';
import { equipRune, grantRune } from '../src/kernel/runes.js';
import { waiting } from '../client/panels/runes.js';
import { World, spellKind } from '../src/kernel/world.js';
import type { Creature, Fx, Wizard } from '../src/kernel/types.js';
import { SPAWN } from '../src/shared/map.js';
import { PROPS } from '../src/shared/props.js';
import { BURST_DMG, CHAIN_DMG, GREENHOUSE, GREENHOUSE_SNARES, SPLIT_SHARE } from '../src/shared/runes.js';

function mk(spawn = 0) {
  const w = new World({ seed: 41, secret: 'runes' });
  w.rules.creatures.spawnMultiplier = spawn;
  w.rules.events.pool = [];
  w.term.endsAt = 1e12;
  return w;
}
function wiz(w: World, name: string, at = { x: 40, z: 12 }): Wizard {
  const a = w.enroll(`${name} Rune`.slice(0, 24), 'Ravenclaw' as never).wizard;
  a.connections = 1; a.createdAt = -1e6; a.pos = { ...at }; a.mana = 1e6;
  return a;
}
function mob(w: World, kind: Creature['kind'], x: number, z: number, hp = 1000): Creature {
  const c: Creature = { id: `c_${kind}_${x}_${z}`, kind, pos: { x, z }, home: { x, z }, hp, maxHp: hp, facing: 0, target: null, attackCd: 99, rootedUntil: 0, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
  w.creatures.set(c.id, c);
  return c;
}
const run = (w: World, s: number) => { for (let i = 0; i < Math.round(s * 20); i++) w.tick(); };
const bag = (w: World, a: Wizard) => w.runes.of.get(a.id)?.bag ?? [];

describe('runes: what they do', () => {
  it('split: the bolt goes out as three, each SPLIT_SHARE of the power', () => {
    const w = mk();
    const a = wiz(w, 'Split');
    grantRune(w, a.id, 'split');
    equipRune(w, a.id, 'split', 'Incendio');
    let spawned = 0;
    const sp = w.spawnProjectile.bind(w);
    w.spawnProjectile = (...args: Parameters<typeof sp>) => { spawned++; return sp(...args); };
    expect(w.cast(a.id, 'Incendio', { aim: { x: 40, z: 30 } }).ok).toBe(true);
    run(w, 0.2);
    expect(spawned).toBe(3);
    expect([...w.projectiles.values()].every((p) => p.power <= 12 * SPLIT_SHARE + 1e-6)).toBe(true);
  });
  it('chain: a hit leaps on to two more foes; burst: a hit bursts round the target', () => {
    const w = mk();
    const a = wiz(w, 'Chain', { x: 40, z: 0 });
    grantRune(w, a.id, 'chain'); grantRune(w, a.id, 'burst');
    const t = mob(w, 'troll', 40, 10), u = mob(w, 'troll', 44, 10), v = mob(w, 'troll', 48, 10);
    equipRune(w, a.id, 'chain', 'Stupefy');
    w.cast(a.id, 'Stupefy', { target: t.id }); run(w, 1.5);
    expect(u.hp).toBeLessThan(1000);
    expect(v.hp).toBeLessThan(1000);
    expect(1000 - v.hp).toBeGreaterThanOrEqual(CHAIN_DMG * 0.5);
    const w2 = mk();
    const b = wiz(w2, 'Burst', { x: 40, z: 0 });
    grantRune(w2, b.id, 'burst');
    equipRune(w2, b.id, 'burst', 'Stupefy');
    const t2 = mob(w2, 'troll', 40, 10), n2 = mob(w2, 'troll', 41.5, 11);
    w2.cast(b.id, 'Stupefy', { target: t2.id }); run(w2, 1.5);
    expect(1000 - n2.hp).toBeGreaterThanOrEqual(BURST_DMG * 0.5);
  });
  it('one rune per spell; moving it takes it off the other; no rune you do not own', () => {
    const w = mk();
    const a = wiz(w, 'Move');
    expect(() => equipRune(w, a.id, 'split', 'Incendio')).toThrow(/no split/);
    grantRune(w, a.id, 'split');
    equipRune(w, a.id, 'split', 'Incendio');
    equipRune(w, a.id, 'split', 'Stupefy');
    expect(Object.values(w.runes.of.get(a.id)!.on)).toEqual(['split']);
    expect(grantRune(w, a.id, 'split')).toBe(false);
  });
  it('the browser card: shows the first rune owned and on no spell, until each is on one', () => {
    expect(waiting(null)).toBe(null);
    expect(waiting({ bag: ['split'], on: {} })).toBe('split');
    expect(waiting({ bag: ['split', 'chain'], on: { s1: 'split' } })).toBe('chain');
    expect(waiting({ bag: ['split'], on: { s1: 'split' } })).toBe(null);
  });
  it('the runes survive a restart', () => {
    const w = mk();
    const a = wiz(w, 'Keep');
    grantRune(w, a.id, 'split'); equipRune(w, a.id, 'split', 'Incendio');
    const back = World.restore(JSON.parse(JSON.stringify(w.serialize())));
    expect(back.runes.of.get(a.id)).toEqual(w.runes.of.get(a.id));
  });
});

describe('runes: how you get them (guaranteed)', () => {
  it('every new first-year gets split from the first cast at the lawn pixies — whichever attack spell', () => {
    const w0 = mk(1);
    const a0 = w0.enroll('Bar Rune', 'Hufflepuff' as never).wizard;
    const attacks = a0.hotbar.map((id, i) => ({ i, sp: a0.spells.find((s) => s.id === id) })).filter((x) => x.sp && spellKind(x.sp.effects) === 'harm');
    expect(attacks.length).toBe(3);
    for (const { i, sp } of attacks) {
      const w = mk(1);
      const a = w.enroll(`Split ${sp!.name}`.slice(0, 24), 'Hufflepuff' as never).wizard;
      a.connections = 1;
      run(w, 6);
      const t = [...w.creatures.values()].filter((c) => c.kind === 'pixie').sort((p, q) => Math.hypot(p.pos.x - SPAWN.x, p.pos.z - SPAWN.z) - Math.hypot(q.pos.x - SPAWN.x, q.pos.z - SPAWN.z))[0];
      a.pos = { x: t.pos.x, z: t.pos.z - 14 };
      w.cast(a.id, String(i + 1), { target: t.id });
      run(w, 2.5);
      expect(bag(w, a), sp!.name).toContain('split');
    }
  });
  it('the greenhouse: the first spell at a snare there reacts (whichever); downing GREENHOUSE_SNARES pays chain', () => {
    const w0 = mk();
    const a0 = w0.enroll('GH Bar', 'Hufflepuff' as never).wizard;
    const attacks = a0.hotbar.map((id, i) => ({ i, sp: a0.spells.find((s) => s.id === id) })).filter((x) => x.sp && spellKind(x.sp.effects) === 'harm');
    for (const { i, sp } of attacks) {
      const w = mk();
      const a = w.enroll(`GH ${sp!.name}`.slice(0, 24), 'Hufflepuff' as never).wizard;
      a.connections = 1; a.pos = { x: GREENHOUSE.x, z: GREENHOUSE.z + 12 };
      const s = mob(w, 'snare', GREENHOUSE.x, GREENHOUSE.z + 2, 60);
      run(w, 1.2); // (the humid air soaks it)
      const seen: string[] = [];
      const f = w.fx.bind(w); w.fx = (x: Fx) => { if (x.k === 'react') seen.push(x.h!); f(x); };
      w.cast(a.id, String(i + 1), { target: s.id });
      run(w, 2);
      expect(seen.length, `${sp!.name} at a greenhouse snare`).toBeGreaterThan(0);
    }
    const w = mk();
    const a = wiz(w, 'Weeder', { x: GREENHOUSE.x, z: GREENHOUSE.z + 12 });
    for (let k = 0; k < GREENHOUSE_SNARES; k++) {
      const s = mob(w, 'snare', GREENHOUSE.x + k * 2, GREENHOUSE.z + 2, 10);
      run(w, 1.1);
      w.damage(a.id, s.id, 999, 'fire');
      run(w, 2.2);
    }
    expect(bag(w, a)).toContain('chain');
  });
  it('the first puzzle of three props pays burst', () => {
    const w = mk();
    const a = wiz(w, 'Puzzle', { x: -40, z: -18 });
    for (const q of PROPS.filter((p) => p.group === 'dungeon-fire')) touch(w, q, 'fire', a.id);
    run(w, 1.2);
    expect(bag(w, a)).toContain('burst');
  });
  it('agents: the runes tool lists them and puts one on a spell', () => {
    const w = mk();
    const a = wiz(w, 'Agent');
    const tool = FEATURE_BY_ID.get('runes')!.tools![0];
    expect((tool.run(w, a.id, {}) as { runes: { owned: boolean }[] }).runes.every((r) => !r.owned)).toBe(true);
    grantRune(w, a.id, 'split');
    expect(tool.run(w, a.id, { rune: 'split', spell: 'Incendio' })).toMatchObject({ ok: true, spell: 'Incendio' });
  });
});
