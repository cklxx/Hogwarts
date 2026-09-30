/**
 * 魔法化学 (src/shared/chem.ts, src/kernel/chem.ts): each reaction, the wet zones and the rain — and the guarantee
 * docs/DESIGN.md §4 asks for: a first-year's first attack on the first pixies, whichever spell, is a named reaction.
 */
import { describe, expect, it } from 'vitest';
import { CONDUCT_DMG, isFrozen, isWet } from '../src/kernel/chem.js';
import { World, spellKind } from '../src/kernel/world.js';
import type { Creature, Fx, Wizard } from '../src/kernel/types.js';
import { FREEZE_S, REACTIONS, WET_S, WET_ZONES, reactionOf } from '../src/shared/chem.js';
import { SPAWN } from '../src/shared/map.js';

function mk(spawn = 0) {
  const w = new World({ seed: 31, secret: 'chem' });
  w.rules.creatures.spawnMultiplier = spawn;
  w.rules.events.pool = [];
  w.term.endsAt = 1e12;
  return w;
}
function wiz(w: World, name: string, at = { x: 12, z: -6 }): Wizard {
  const a = w.enroll(`${name} Chem`, 'Gryffindor' as never).wizard;
  a.connections = 1; a.createdAt = -1e6; a.pos = { ...at }; a.mana = 1e6;
  return a;
}
function mob(w: World, kind: Creature['kind'], x: number, z: number): Creature {
  const c: Creature = { id: `c_${kind}_${x}_${z}`, kind, pos: { x, z }, home: { x, z }, hp: 1000, maxHp: 1000, facing: 0, target: null, attackCd: 99, rootedUntil: 0, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
  w.creatures.set(c.id, c);
  return c;
}
const run = (w: World, s: number) => { for (let i = 0; i < Math.round(s * 20); i++) w.tick(); };
function reacts(w: World) { const seen: string[] = []; const f = w.fx.bind(w); w.fx = (x: Fx) => { if (x.k === 'react') seen.push(x.h!); f(x); }; return seen; }
/** A place off the wet lawn, in the castle's scene, clear of the courtyard's safe zone. */
const DRY = { x: 40, z: 20 };

describe('chemistry: the table', () => {
  it('every element does something to the wet; frozen shatters; water soaks or douses', () => {
    const wet = { wet: true, frozen: false, burning: false, chilled: false };
    expect((['fire', 'ice', 'lightning', 'arcane', 'light'] as const).map((e) => reactionOf(e, wet))).toEqual(['vaporize', 'freeze', 'conduct', 'slip', 'rainbow']);
    expect(reactionOf('arcane', { ...wet, frozen: true })).toBe('shatter');
    expect(reactionOf('lightning', { wet: false, frozen: false, burning: true, chilled: false })).toBe('overload');
    expect(reactionOf('fire', { wet: false, frozen: false, burning: false, chilled: true })).toBe('melt');
    expect(reactionOf('fire', { wet: false, frozen: false, burning: false, chilled: false })).toBeNull();
    expect(reactionOf('arcane', { ...wet, wet: false, burning: true }, true)).toBe('douse');
    expect(reactionOf('arcane', { ...wet, wet: false }, true)).toBe('soak');
  });
});

describe('chemistry: in the world', () => {
  it('Aguamenti soaks (no damage), then Incendio vaporizes ×1.5', () => {
    const w = mk();
    const a = wiz(w, 'Wet', { x: DRY.x, z: DRY.z - 8 });
    const t = mob(w, 'troll', DRY.x, DRY.z);
    const seen = reacts(w);
    expect(w.cast(a.id, 'Aguamenti', { target: t.id }).ok).toBe(true);
    run(w, 1);
    expect(t.hp).toBe(1000);
    expect(isWet(w, t.id)).toBe(true);
    // the same fire on a dry twin, for the multiplier (direct hits: no burning ticks in between)
    const dry = mob(w, 'troll', DRY.x + 4, DRY.z);
    const plain = w.damage(a.id, dry.id, 10, 'fire'), wet = w.damage(a.id, t.id, 10, 'fire');
    expect(wet).toBeCloseTo(plain * REACTIONS.vaporize.mult, 5);
    expect(seen).toEqual(['soak', 'vaporize']);
    expect(isWet(w, t.id)).toBe(false);
  });
  it('ice on the wet freezes it still; the next hit shatters for ×2', () => {
    const w = mk();
    const a = wiz(w, 'Ice', { x: DRY.x, z: DRY.z - 8 });
    a.year = 2; w.gainXp(a, 0);
    const t = mob(w, 'troll', DRY.x, DRY.z);
    w.chem.wet.set(t.id, w.now + WET_S);
    const seen = reacts(w);
    w.damage(a.id, t.id, 10, 'ice');
    expect(isFrozen(w, t.id)).toBe(true);
    expect(t.rootedUntil).toBeGreaterThan(w.now + FREEZE_S - 0.1);
    const hp = t.hp;
    w.damage(a.id, t.id, 10, 'arcane');
    expect(hp - t.hp).toBeCloseTo(2 * 10 * (w.rules.combat.damageMultiplier) * 0.6, 0); // (a troll shrugs off arcane ×0.6)
    expect(seen).toEqual(['freeze', 'shatter']);
  });
  it('lightning on one wet foe arcs to the others wet within reach', () => {
    const w = mk();
    const a = wiz(w, 'Zap', { x: DRY.x, z: DRY.z - 8 });
    const t = mob(w, 'troll', DRY.x, DRY.z), u = mob(w, 'troll', DRY.x + 3, DRY.z), far = mob(w, 'troll', DRY.x + 20, DRY.z);
    for (const c of [t, u, far]) w.chem.wet.set(c.id, w.now + WET_S);
    w.damage(a.id, t.id, 10, 'lightning');
    expect(u.hp).toBeLessThan(1000);
    expect(far.hp).toBe(1000);
    expect(1000 - u.hp).toBeGreaterThan(CONDUCT_DMG * 0.5);
  });
  it('a stunner on the wet knocks it back and off its feet; light on the wet heals your house', () => {
    const w = mk();
    const a = wiz(w, 'Push', { x: DRY.x, z: DRY.z - 8 });
    const t = mob(w, 'troll', DRY.x, DRY.z);
    w.chem.wet.set(t.id, w.now + WET_S);
    w.damage(a.id, t.id, 5, 'arcane');
    expect(t.pos.z).toBeGreaterThan(DRY.z + 1);
    const mate = wiz(w, 'Mate', { x: DRY.x + 2, z: DRY.z - 8 });
    mate.hp = 50;
    w.chem.wet.set(t.id, w.now + WET_S);
    w.damage(a.id, t.id, 5, 'light');
    expect(mate.hp).toBeGreaterThan(50);
  });
  it('the south lawn and the rain soak you; indoors and on dry ground you dry off', () => {
    const w = mk();
    const lawn = WET_ZONES.find((z) => z.id === 'lawn')!;
    const a = wiz(w, 'Dew', { x: lawn.x, z: lawn.z });
    run(w, 1.2);
    expect(isWet(w, a.id)).toBe(true);
    a.pos = { ...DRY };
    run(w, WET_S + 1.5);
    expect(isWet(w, a.id)).toBe(false);
    w.rules.world.weather = 'rain';
    run(w, 1.2);
    expect(isWet(w, a.id)).toBe(true);
    a.pos = { x: 0, z: -58 }; // the Great Hall
    w.chem.wet.delete(a.id);
    run(w, 1.2);
    expect(isWet(w, a.id)).toBe(false);
  });
});

describe('the guarantee: the first attack on the first pixies is always a reaction', () => {
  it('a new first-year at the spawn: every attack spell on the bar, cast at the nearest pixie, names a reaction', () => {
    const w0 = mk(1);
    const a0 = w0.enroll('Bar Chem', 'Hufflepuff' as never).wizard;
    const attacks = a0.hotbar.map((id, i) => ({ i, sp: a0.spells.find((s) => s.id === id) })).filter((x) => x.sp && spellKind(x.sp.effects) === 'harm');
    expect(attacks.map((x) => x.sp!.name)).toEqual(['Stupefy', 'Incendio', 'Aguamenti']);
    for (const { i, sp } of attacks) {
      const w = mk(1);
      const a = w.enroll(`First ${sp!.name}`.slice(0, 24), 'Hufflepuff' as never).wizard;
      a.connections = 1;
      run(w, 6); // the lawn's pixies spawn
      const pixies = [...w.creatures.values()].filter((c) => c.kind === 'pixie');
      expect(pixies.length, sp!.name).toBeGreaterThan(0);
      const t = pixies.sort((p, q) => Math.hypot(p.pos.x - SPAWN.x, p.pos.z - SPAWN.z) - Math.hypot(q.pos.x - SPAWN.x, q.pos.z - SPAWN.z))[0];
      // walk into range the way a new player does (to the lawn's edge), then the first cast
      a.pos = { x: t.pos.x, z: t.pos.z - 14 };
      const seen = reacts(w);
      expect(w.cast(a.id, String(i + 1), { target: t.id }).ok, sp!.name).toBe(true);
      run(w, 2);
      expect(seen.length, `${sp!.name}: no reaction`).toBeGreaterThan(0);
    }
  });
});
