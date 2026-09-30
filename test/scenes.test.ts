/**
 * 场景 (src/shared/scenes.ts, src/kernel/scenes.ts): dense scenes walled in by mist, joined by gates. Everything
 * lives inside a scene; nothing walks or shoots across the mist; a walk into another scene goes by its gate and on,
 * two scenes away included; a route that only passes a gate does not fall through; an old save's wanderer in the
 * mist wakes up in the courtyard.
 */
import { describe, expect, it } from 'vitest';
import { CREATURES } from '../src/kernel/creatures.js';
import { DUEL_ENDS, DUEL_STAGE } from '../src/kernel/duelclub.js';
import { findPath, walkableAt } from '../src/kernel/pathfind.js';
import { STATIC_SOLIDS } from '../src/kernel/physics.js';
import { QD_ENDS, QD_HOOPS } from '../src/kernel/quidditch.js';
import { SCENES_FEATURE } from '../src/kernel/scenes.js';
import { DUNGEON_STAIR, LAKE_EDGE, PITCH, SEVENTH } from '../src/kernel/wheel.js';
import { World } from '../src/kernel/world.js';
import type { Wizard } from '../src/kernel/types.js';
import { CHESTS } from '../src/shared/chests.js';
import { LANDMARKS, SPAWN, ZONES } from '../src/shared/map.js';
import { GATES, GATE_R, HUB, SCENES, routeVia, sceneAt, sceneById } from '../src/shared/scenes.js';
import { FIREPLACES } from '../src/shared/travel.js';

function mk() {
  const w = new World({ seed: 11, secret: 'scenes' });
  w.rules.creatures.spawnMultiplier = 0;
  w.rules.events.pool = [];
  w.term.endsAt = 1e12;
  return w;
}
function wiz(w: World, name: string, at = SPAWN): Wizard {
  const a = w.enroll(name, 'Hufflepuff' as never).wizard;
  a.connections = 1; a.createdAt = -1e6; a.pos = { ...at };
  return a;
}
const run = (w: World, s: number, until?: () => boolean) => { for (let i = 0; i < Math.round(s * 20) && !until?.(); i++) w.tick(); };
/** Inside a scene, clear of its veil by `m`. */
const deepIn = (x: number, z: number, m = 2) => { const s = sceneAt(x, z); return !!s && x - s.box[0] >= m && s.box[2] - x >= m && z - s.box[1] >= m && s.box[3] - z >= m; };

describe('scenes: the map', () => {
  it('every place, chest, fireplace, spawn ring, event spot, duel end and hoop is inside a scene, clear of the veil', () => {
    const pts: [string, number, number][] = [
      ...LANDMARKS.map((l) => [`landmark ${l.id}`, l.x, l.z] as [string, number, number]),
      ...ZONES.filter((z) => z.id !== 'grounds' && z.id !== 'azkaban').map((z) => [`zone ${z.id}`, z.x, z.z] as [string, number, number]),
      ...CHESTS.map((c) => [`chest ${c.id}`, c.x, c.z] as [string, number, number]),
      ...FIREPLACES.map((f) => [`fireplace ${f.id}`, f.x, f.z] as [string, number, number]),
      ...[DUNGEON_STAIR, LAKE_EDGE, PITCH, SEVENTH, DUEL_STAGE, ...DUEL_ENDS, ...QD_ENDS, ...QD_HOOPS.flat()].map((p, i) => [`spot ${i}`, p.x, p.z] as [string, number, number]),
    ];
    for (const [k, c] of Object.entries(CREATURES)) {
      if (!c.spawn.max) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) pts.push([`${k} spawn ring`, c.spawn.x + dx * c.spawn.r, c.spawn.z + dz * c.spawn.r]);
    }
    const out = pts.filter(([, x, z]) => !deepIn(x, z, 1));
    expect(out.map(([n, x, z]) => `${n} (${x}, ${z})`)).toEqual([]);
  });

  it('scenes do not overlap; every gate and where it lets you out stands on open ground in the right scene, reachable from the way in', () => {
    for (const a of SCENES) for (const b of SCENES) if (a !== b) {
      const [ax0, az0, ax1, az1] = a.box, [bx0, bz0, bx1, bz1] = b.box;
      expect(ax1 + 2 < bx0 || bx1 + 2 < ax0 || az1 + 2 < bz0 || bz1 + 2 < az0, `${a.id} / ${b.id}`).toBe(true);
    }
    for (const g of GATES) {
      expect(sceneAt(g.at.x, g.at.z)?.id).toBe(g.in);
      expect(sceneAt(g.out.x, g.out.z)?.id).toBe(g.to);
      for (const p of [g.at, g.out]) {
        expect(walkableAt(p, STATIC_SOLIDS), JSON.stringify(p)).toBe(true);
        const q = { ...p }; STATIC_SOLIDS.resolve(q, 0.5, true);
        expect(Math.hypot(q.x - p.x, q.z - p.z), JSON.stringify(p)).toBeLessThan(0.01);
      }
      // stepping out never lands you on a gate (you would bounce straight back)
      for (const h of GATES) expect(Math.hypot(h.at.x - g.out.x, h.at.z - g.out.z)).toBeGreaterThan(GATE_R + 1);
      const home = g.in === HUB ? SPAWN : sceneById(g.in)!.entry!;
      expect(findPath(home, g.at), `${g.in} -> gate to ${g.to}`).toBeTruthy();
    }
  });

  it('every landmark move_to goes to (4 m south of it) is reachable from where you step into its scene', () => {
    for (const l of LANDMARKS) {
      const s = sceneAt(l.x, l.z + 4)!;
      expect(s, l.id).toBeTruthy();
      expect(findPath(s.entry ?? SPAWN, { x: l.x, z: l.z + 4 }), l.id).toBeTruthy();
    }
  });

  it('nobody walks and no bolt flies across the mist', () => {
    const forest = sceneById('forest')!, lake = sceneById('lake')!;
    expect(findPath(SPAWN, forest.entry!)).toBeNull();
    expect(findPath(SPAWN, lake.entry!)).toBeNull();
    // a bolt from the castle's east edge toward the forest's west edge meets the veil
    expect(STATIC_SOLIDS.hitSegment(70, 10, 86, 10)?.style).toBe('veil');
    // but the camera looks over it (it is mist): no view solid is a veil
    expect(STATIC_SOLIDS.hitSegment(70, 10, 86, 10, 3.5)).toBeNull();
  });

  it('the way to another scene: the gate you are in front of, and from an outer scene to another, home first', () => {
    expect(routeVia(SPAWN, { x: 95, z: 25 })?.to).toBe('forest');
    expect(routeVia(SPAWN, { x: 0, z: -56 })).toBeNull(); // the Great Hall: same scene
    const g = routeVia(sceneById('lake')!.entry!, { x: 95, z: 25 })!;
    expect([g.in, g.to]).toEqual(['lake', HUB]);
  });
});

describe('scenes: walking', () => {
  it("move_to Hagrid's hut from the courtyard: to the gate, through, and on to the hut", () => {
    const w = mk();
    const a = wiz(w, 'Hannah');
    const hut = { x: 92, z: 22 };
    w.setGoal(a.id, hut, 'agent');
    expect(Math.hypot(a.goal!.x - GATES.find((g) => g.to === 'forest')!.at.x, a.goal!.z + 22)).toBeLessThan(1.5);
    run(w, 40, () => !a.goal && sceneAt(a.pos.x, a.pos.z)?.id === 'forest');
    expect(sceneAt(a.pos.x, a.pos.z)?.id).toBe('forest');
    expect(Math.hypot(a.pos.x - hut.x, a.pos.z - hut.z)).toBeLessThan(1.2);
    expect(w.events.some((e) => e.to === a.id && /禁林/.test(e.zh ?? ''))).toBe(true);
  });

  it('two scenes away (the lake to Hogsmeade): home through one gate, out through another', () => {
    const w = mk();
    const a = wiz(w, 'Ernie', sceneById('lake')!.entry!);
    const street = { x: 2, z: 142 };
    w.setGoal(a.id, street);
    run(w, 60, () => !a.goal && sceneAt(a.pos.x, a.pos.z)?.id === 'hogsmeade');
    expect(sceneAt(a.pos.x, a.pos.z)?.id).toBe('hogsmeade');
    expect(Math.hypot(a.pos.x - street.x, a.pos.z - street.z)).toBeLessThan(1.2);
  });

  it('a route that only passes a gate does not fall through; walking into it by hand does', () => {
    const w = mk();
    const a = wiz(w, 'Justin', { x: 23, z: -28 });
    const g = GATES.find((x) => x.in === HUB && x.to === 'forest')!;
    // along the courtyard's east side, over the forest gate, to the pitch gate's far side
    w.setGoal(a.id, { x: 23, z: -14 });
    run(w, 5, () => !a.goal);
    expect(sceneAt(a.pos.x, a.pos.z)?.id).toBe(HUB);
    // the stick, straight into it
    a.pos = { x: g.at.x - 3, z: g.at.z };
    w.now += 5;
    for (let i = 0; i < 40 && sceneAt(a.pos.x, a.pos.z)?.id === HUB; i++) { w.setInput(a.id, 1, 0); w.tick(); }
    expect(sceneAt(a.pos.x, a.pos.z)?.id).toBe('forest');
  });

  it('a walk into the mist is refused with the scenes named; a duellist does not leave through a gate', () => {
    const w = mk();
    const a = wiz(w, 'Susan');
    expect(() => w.setGoal(a.id, { x: 0, z: 90 })).toThrow(/雾|mist/);
  });

  it('an old save: whoever stood in what is now mist wakes in the courtyard; wild creatures left homeless go', () => {
    const w = mk();
    const a = wiz(w, 'Zacharias', { x: 0, z: 90 }); // the old road to Hogsmeade
    const b = wiz(w, 'Megan', { x: 95, z: 25 }); // Hagrid's: a scene, stays
    w.creatures.set('d1', { id: 'd1', kind: 'dementor', pos: { x: -60, z: 40 }, home: { x: -60, z: 40 }, hp: 1, maxHp: 1, facing: 0, target: null, attackCd: 0, rootedUntil: 0, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 });
    SCENES_FEATURE.load!(w, undefined, {});
    expect(a.pos).toEqual(SPAWN);
    expect(b.pos).toEqual({ x: 95, z: 25 });
    expect(w.creatures.has('d1')).toBe(false);
  });
});
