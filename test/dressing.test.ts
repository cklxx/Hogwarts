/**
 * 布景 (scripts/dress.ts → src/shared/dressing.ts) and the new kinds (src/shared/props.ts) and drops (src/kernel/loot.ts):
 * how much there is to do on a screen, and — on every path — what each kind does to a first-year's spells.
 */
import { describe, expect, it } from 'vitest';
import { touch } from '../src/kernel/props.js';
import { drop } from '../src/kernel/loot.js';
import { derived } from '../src/kernel/progression.js';
import { CREATURES } from '../src/kernel/creatures.js';
import { World } from '../src/kernel/world.js';
import type { Creature, Fx, Wizard } from '../src/kernel/types.js';
import { CHESTS } from '../src/shared/chests.js';
import { inWetZone, PUDDLE_R } from '../src/shared/chem.js';
import { DRESSING, DRESSING_GROUPS } from '../src/shared/dressing.js';
import { ENCOUNTERS } from '../src/shared/encounters.js';
import { overWater } from '../src/shared/ice.js';
import { STATIC_COLLIDERS, signedDistance } from '../src/shared/layout.js';
import { LOOT_GALLEONS_PER_TERM, LOOT_PICK_R } from '../src/shared/loot.js';
import { PROP_DEFS, PROPS, type Prop } from '../src/shared/props.js';
import { SCENES, sceneAt } from '../src/shared/scenes.js';
import { FIREPLACES } from '../src/shared/travel.js';

function mk() {
  const w = new World({ seed: 71, secret: 'dress' });
  w.rules.creatures.spawnMultiplier = 0;
  w.rules.events.pool = [];
  w.term.endsAt = 1e12;
  return w;
}
function wiz(w: World, name: string, at: { x: number; z: number }): Wizard {
  const a = w.enroll(`${name} Dr`.slice(0, 24), 'Gryffindor' as never).wizard;
  a.connections = 1; a.createdAt = -1e6; a.pos = { ...at }; a.mana = 1e6;
  return a;
}
function mob(w: World, kind: Creature['kind'], x: number, z: number, hp = 1000): Creature {
  const c: Creature = { id: `c_${kind}_${x}_${z}`, kind, pos: { x, z }, home: { x, z }, hp, maxHp: hp, facing: 0, target: null, attackCd: 99, rootedUntil: 0, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
  w.creatures.set(c.id, c);
  return c;
}
const run = (w: World, s: number) => { for (let i = 0; i < Math.round(s * 20); i++) w.tick(); };
/** The props a fire on `p` reaches: along whatever fire sets off (a blast's reach), as kernel/props.ts runs it. */
function burns(p: Prop): Set<string> {
  const out = new Set([p.id]), q = [p];
  while (q.length) {
    const a = q.pop()!, r = PROP_DEFS[a.kind].blast ?? 0;
    for (const b of PROPS) if (!out.has(b.id) && Math.hypot(a.x - b.x, a.z - b.z) <= r) { out.add(b.id); if (PROP_DEFS[b.kind].blast) q.push(b); }
  }
  return out;
}
/** A spot 6 m off `p` (any of 8 ways) in its scene, on open ground, with nothing — wall or other prop — on the line to it. */
function clearShot(w: World, p: Prop) {
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4, at = { x: p.x + Math.cos(a) * 6, z: p.z + Math.sin(a) * 6 };
    if (sceneAt(at.x, at.z)?.id !== sceneAt(p.x, p.z)?.id || w.solids.blocked(at, 0.5) || w.solids.hitSegment(at.x, at.z, p.x, p.z)) continue;
    const onLine = PROPS.some((q) => q !== p && Math.hypot(q.x - p.x, q.z - p.z) > 0.1 && segDist(q, at, p) < 1.3);
    if (!onLine) return at;
  }
  return null;
}
const segDist = (q: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }) => {
  const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.z - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(q.x - a.x - dx * t, q.z - a.z - dz * t);
};
const SCREEN_M2 = 571; // the 2.5D view's ground on a 16:9 screen (docs/PERF.md 2026-10-01)

describe('dressing: how much there is', () => {
  it('every scene has at least 4 things to do per screen of open ground', () => {
    for (const s of SCENES) {
      let open = 0;
      for (let x = s.box[0]; x < s.box[2]; x += 2) for (let z = s.box[1]; z < s.box[3]; z += 2) if (!overWater(x, z) && STATIC_COLLIDERS.every((c) => signedDistance(c, x, z) > 0)) open++;
      const inS = (p: { x: number; z: number }) => sceneAt(p.x, p.z)?.id === s.id;
      const spawns = Object.values(CREATURES).flatMap((c) => (c.spawn.max ? [c.spawn, ...(c.also ?? [])] : [])).filter(inS).length;
      const n = PROPS.filter(inS).length + CHESTS.filter(inS).length + FIREPLACES.filter(inS).length + ENCOUNTERS.filter(inS).length + spawns + (s.gate ? 1 : 0);
      expect(n / ((open * 4) / SCREEN_M2), s.id).toBeGreaterThanOrEqual(4);
    }
  });
  it('the dressing keeps off the gates, chests, fireplaces and the encounters’ toys; ids unique', () => {
    expect(new Set(PROPS.map((p) => p.id)).size).toBe(PROPS.length);
    for (const p of DRESSING) {
      expect(CHESTS.every((c) => Math.hypot(c.x - p.x, c.z - p.z) >= 3), p.id).toBe(true);
      expect(FIREPLACES.every((c) => Math.hypot(c.x - p.x, c.z - p.z) >= 3), p.id).toBe(true);
      expect(ENCOUNTERS.filter((e) => e.id !== 'greenhouse').every((e) => Math.hypot(e.x - p.x, e.z - p.z) >= e.r), p.id).toBe(true);
      expect(overWater(p.x, p.z), p.id).toBe(false);
    }
  });
});

describe('dressing: what each kind does (every one of them)', () => {
  it('any hurting spell breaks every breakable (a first-year’s Stupefy is arcane)', () => {
    const w = mk();
    const a = wiz(w, 'Breaker', { x: 0, z: 0 });
    for (const p of DRESSING.filter((q) => PROP_DEFS[q.kind].breaks)) { w.props.broken.clear(); expect(touch(w, p, 'arcane', a.id), p.id).toBe(true); }
  });
  it('fire on any bush, hay bale or web burns its whole clump: one Incendio, a clump', () => {
    const clumps = DRESSING.filter((p) => ['bush', 'hay', 'web'].includes(p.kind));
    const seen = new Set<string>();
    for (const p of clumps) {
      if (seen.has(p.id)) continue;
      const want = burns(p);
      for (const id of want) seen.add(id);
      expect([...want].filter((id) => DRESSING.some((q) => q.id === id && q.kind === p.kind)).length, `${p.id}'s clump`).toBeGreaterThanOrEqual(3);
      const w = mk();
      const from = clearShot(w, p);
      expect(from, `${p.id}: some clear line of fire`).not.toBeNull();
      const a = wiz(w, `Fire ${p.id}`, from!);
      expect(w.cast(a.id, 'Incendio', { aim: { x: p.x, z: p.z } }).ok).toBe(true);
      run(w, 1.2);
      expect([...want].filter((id) => !w.props.broken.has(id)), p.id).toEqual([]);
    }
  });
  it('a hit on any toadstool bursts its ring, and the spores hurt the creature in it', () => {
    const shrooms = DRESSING.filter((p) => p.kind === 'mushroom');
    expect(shrooms.length).toBeGreaterThanOrEqual(12);
    for (const p of shrooms) {
      const w = mk();
      const a = wiz(w, `Spore ${p.id}`, { x: p.x, z: p.z + 8 });
      const c = mob(w, 'spider', p.x + 1, p.z);
      touch(w, p, 'arcane', a.id);
      expect(c.hp, p.id).toBeLessThan(1000);
      const ring = shrooms.filter((q) => Math.hypot(q.x - p.x, q.z - p.z) <= 3.2 && q.id.split('-')[0] === p.id.split('-')[0]);
      for (const q of ring) expect(w.props.broken.has(q.id), `${q.id} by ${p.id}`).toBe(true);
    }
  });
  it('fire or light lights each lantern; a trio lit together pays', () => {
    expect(DRESSING_GROUPS.length).toBeGreaterThanOrEqual(6);
    for (const g of DRESSING_GROUPS) {
      const ms = PROPS.filter((p) => p.group === g.id);
      expect(ms.length, g.id).toBe(3);
      const w = mk();
      const a = wiz(w, `Lamp ${g.id}`, ms[0]);
      const xp = a.xp;
      touch(w, ms[0], 'fire', a.id); touch(w, ms[1], 'light', a.id); touch(w, ms[2], 'fire', a.id);
      expect(a.xp, g.id).toBeGreaterThan(xp);
    }
  });
  it('a cauldron under fire brews a potion; an ice block always holds something', () => {
    for (const p of DRESSING.filter((q) => q.kind === 'cauldron' || q.kind === 'ice')) {
      const w = mk();
      const a = wiz(w, `Brew ${p.id}`, { x: p.x, z: p.z + 8 });
      touch(w, p, p.kind === 'cauldron' ? 'fire' : 'arcane', a.id);
      expect([...w.loot.items.values()].some((it) => Math.hypot(it.x - p.x, it.z - p.z) < 2 && (p.kind === 'ice' || it.kind === 'potion')), p.id).toBe(true);
    }
  });
  it('every puddle wets who stands in it; then a fire hit there is a reaction', () => {
    const puddles = PROPS.filter((p) => PROP_DEFS[p.kind].wets);
    expect(puddles.length).toBeGreaterThanOrEqual(20);
    for (const p of puddles) {
      expect(inWetZone(p.x + PUDDLE_R * 0.6, p.z), p.id).toBe(true);
      const w = mk();
      const a = wiz(w, `Wet ${p.id}`, { x: p.x, z: p.z + 9 });
      const c = mob(w, 'troll', p.x, p.z);
      c.rootedUntil = 1e9; // (standing in it)
      run(w, 1.1);
      const seen: string[] = [];
      const f = w.fx.bind(w); w.fx = (x: Fx) => { if (x.k === 'react') seen.push(x.h!); f(x); };
      w.damage(a.id, c.id, 10, 'fire');
      expect(seen, p.id).toContain('vaporize');
    }
  });
});

describe('loot', () => {
  it('walking over a drop picks it up; galleons are capped a term; health only fills what is missing', () => {
    const w = mk();
    const a = wiz(w, 'Picker', { x: 0, z: 10 });
    const g = a.galleons;
    for (let i = 0; i < LOOT_GALLEONS_PER_TERM + 15; i++) { drop(w, { x: 0, z: 10 }, 'coin'); run(w, 0.1); }
    expect(a.galleons - g).toBe(LOOT_GALLEONS_PER_TERM);
    a.hp = derived(a, w.rules).maxHp - 5;
    drop(w, a.pos, 'heart'); run(w, 0.1);
    expect(a.hp).toBe(derived(a, w.rules).maxHp);
    // out of reach: it stays
    drop(w, { x: 0, z: 10 + LOOT_PICK_R + 3 }, 'mana'); run(w, 0.5);
    expect(w.loot.items.size).toBe(1);
    // a new term: coins count again
    w.term.n++;
    drop(w, a.pos, 'coin'); run(w, 0.1);
    expect(a.galleons - g).toBe(LOOT_GALLEONS_PER_TERM + 1);
  });
  it('you are told about what lies round you only', () => {
    const w = mk();
    const a = wiz(w, 'Seer', { x: 0, z: 10 });
    drop(w, { x: 5, z: 14 }, 'coin'); drop(w, { x: 80, z: 10 }, 'coin');
    const me = w.privateState(a.id) as unknown as { loot?: number[] };
    expect(me.loot?.length).toBe(4);
  });
});
