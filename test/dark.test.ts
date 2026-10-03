/** 黑魔法 (src/kernel/dark.ts): plugin primitives, their price, and the rules they never break. */
import { describe, expect, it } from 'vitest';
import { DARK_BLEED, DARK_COST, DARK_CUP, DARK_FIRE_PULSES, DARK_SHOWN } from '../src/kernel/dark.js';
import { analyze } from '../src/runes/checker.js';
import { PRIM_BY_NAME } from '../src/runes/primitives.js';
import { World } from '../src/kernel/world.js';
import type { Creature, Wizard } from '../src/kernel/types.js';

function mk() {
  const w = new World({ seed: 13, secret: 'dark' });
  w.rules.creatures.spawnMultiplier = 0;
  w.rules.combat.safeZones = [];
  return w;
}
function wiz(w: World, name: string, house = 'Slytherin', x = 60): Wizard {
  const a = w.enroll(name, house as never).wizard;
  a.connections = 1; a.createdAt = -1e6; a.pos = { x, z: 40 };
  return a;
}
function dark(w: World, a: Wizard) { a.year = 5; a.seals = 1; a.xp = 5000; a.mana = 400; return a; }
function beast(w: World, kind: Creature['kind'], x: number, z = 40): Creature {
  const c: Creature = { id: `c_${kind}_${x}`, kind, pos: { x, z }, home: { x, z }, hp: 300, maxHp: 300, facing: 0, target: null, attackCd: 99, rootedUntil: 0, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
  w.creatures.set(c.id, c);
  return c;
}
const run = (w: World, s: number) => { for (let i = 0; i < Math.round(s * 20); i++) w.tick(); };
function cast(w: World, a: Wizard, source: string, target?: string) {
  const s = w.forgeSpell(a.id, { name: `S${Math.floor(Math.random() * 1e9)}`, source }).spell;
  a.mana = 400; a.globalCd = 0; a.cooldowns = {};
  return w.cast(a.id, s.id, target ? { target } : {});
}

describe('the Dark Arts', () => {
  it('are Runes primitives from a plugin: in the grimoire table, gated by year 4 and a broken seal', () => {
    for (const n of ['sectumsempra', 'fiendfyre', 'imperio', 'morsmordre']) expect(PRIM_BY_NAME.get(n)).toMatchObject({ kind: 'effect', year: 4, seals: 1 });
    expect(() => analyze('(morsmordre)', { year: 3, maxNodes: 99, seals: 1 })).toThrow(/year 4/);
    expect(() => analyze('(morsmordre)', { year: 5, maxNodes: 99, seals: 0 })).toThrow(/seal/i);
    expect(analyze('(morsmordre)', { year: 5, maxNodes: 99, seals: 1 }).nodes).toBeGreaterThan(0);
  });

  it('sectumsempra wounds (a bleed), deepens darkness and costs house points; others see darkness past the threshold', () => {
    const w = mk();
    const a = dark(w, wiz(w, 'Severus')), b = wiz(w, 'Harry', 'Gryffindor', 66);
    w.cupGain(a, 20, 'creatures');
    const pts = a.cup!.pts;
    expect(cast(w, a, '(sectumsempra target)', b.handle).ok).toBe(true);
    run(w, 1);
    expect(b.auras.some((x) => x.k === 'poison' && x.mag === DARK_BLEED)).toBe(true);
    expect(w.dark.of.get(a.id)).toBeCloseTo(DARK_COST.sectumsempra, 0);
    expect(a.cup!.pts).toBe(pts - DARK_CUP.sectumsempra);
    for (let i = 0; i < 6; i++) cast(w, a, '(morsmordre)');
    expect(w.dark.of.get(a.id)!).toBeGreaterThanOrEqual(DARK_SHOWN);
    const dk = (w.snapshot() as { dk?: { w: string[]; m: unknown[] } }).dk!;
    expect(dk.w).toContain(a.handle);
    expect(dk.m.length).toBeGreaterThan(0);
    expect(w.events.some((e) => e.type === 'dark' && /黑魔标记/.test(e.zh ?? ''))).toBe(true);
  });

  it('fiendfyre burns in pulses, and only what canHarm allows (a safe zone stays safe)', () => {
    const w = mk();
    const a = dark(w, wiz(w, 'Crabbe'));
    const c = beast(w, 'troll', 66);
    const hp = c.hp;
    expect(cast(w, a, '(fiendfyre (pos target) 20)', c.id).ok).toBe(true);
    run(w, DARK_FIRE_PULSES + 0.5);
    expect(hp - c.hp).toBeGreaterThan(20 * 2); // several pulses
    w.rules.combat.safeZones = ['great_hall'];
    const b = wiz(w, 'Luna', 'Ravenclaw', 0);
    b.pos = { x: 0, z: -56 };
    a.pos = { x: 0, z: -40 };
    const hb = b.hp;
    cast(w, a, '(fiendfyre (vec 0 -56) 20)');
    run(w, DARK_FIRE_PULSES + 0.5);
    expect(b.hp).toBe(hb); // the Great Hall is safe
  });

  it('imperio: a wild creature fights for you, then remembers itself; never a wizard, a benign creature or a summon', () => {
    const w = mk();
    const a = dark(w, wiz(w, 'Bellatrix'));
    const b = wiz(w, 'Neville', 'Gryffindor', 64);
    const t = beast(w, 'troll', 64, 44);
    expect(cast(w, a, '(imperio target 5)', t.id).ok).toBe(true);
    expect(t.owner).toBe(a.id);
    run(w, 5.2);
    expect(t.owner).toBeNull();
    expect(w.creatures.has(t.id)).toBe(true); // handed back, not dismissed
    expect(cast(w, a, '(imperio target 5)', b.handle).ok).toBe(false); // nobody takes a wizard's will
    const u = beast(w, 'unicorn', 62, 44);
    expect(cast(w, a, '(imperio target 5)', u.id).ok).toBe(false);
  });

  it('the Minister can ban a Dark Art by decree, like any primitive; the lawless forest charges no house points', () => {
    const w = mk();
    const a = dark(w, wiz(w, 'Dolohov'));
    expect(w.rules.magic.bannedPrimitives).toEqual([]);
    w.rules.magic.bannedPrimitives = ['morsmordre'];
    expect(() => cast(w, a, '(morsmordre)')).toThrow(/banned/); // refused at the forge, like any banned primitive
    w.rules.magic.bannedPrimitives = [];
    a.pos = { x: 143, z: 38 }; // the deep forest
    w.cupGain(a, 10, 'creatures');
    const pts = a.cup!.pts;
    expect(cast(w, a, '(morsmordre)').ok).toBe(true);
    expect(a.cup!.pts).toBe(pts);
  });
});
