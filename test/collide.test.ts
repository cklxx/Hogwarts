/**
 * Collision: the layout (src/shared/layout.ts) is solid for walkers, bolts and the A* grid; wizards and
 * creatures do not stand in each other; Ministers' statues come and go with the decree list; the world ends
 * where the Highlands begin to climb.
 */
import { sceneAt } from '../src/shared/scenes.js';
import { describe, expect, it } from 'vitest';
import { heightAt } from '../client/terrain.js';
import { STATIC_SOLIDS, Solids } from '../src/kernel/physics.js';
import { clearLine, findPath, walkableAt } from '../src/kernel/pathfind.js';
import { World } from '../src/kernel/world.js';
import { CREATURES } from '../src/kernel/creatures.js';
import { SEP_CELL } from '../src/kernel/separation.js';
import type { Creature, Wizard } from '../src/kernel/types.js';
import { BOLT_HEIGHT, STATIC_COLLIDERS, TRUNK, WORLD_EDGE, colliderOf, signedDistance, statueCollider, type Collider } from '../src/shared/layout.js';
import { OBSTACLES, WORLD_HALF, mulberry32 } from '../src/shared/map.js';

function mkWorld() {
  const world = new World({ seed: 7 });
  world.rules.creatures.spawnMultiplier = 0;
  return world;
}
function join(world: World, name: string) {
  const { wizard } = world.enroll(name);
  wizard.connections = 1;
  return wizard;
}
function addCreature(world: World, kind: Creature['kind'], x: number, z: number, id = `c_${kind}_${x}_${z}`): Creature {
  const c: Creature = { id, kind, pos: { x, z }, home: { x, z }, hp: 1000, maxHp: 1000, facing: 0, target: null, attackCd: 99, rootedUntil: 0, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
  world.creatures.set(c.id, c);
  return c;
}
const centre = (c: Collider) => (c.kind === 'box' ? { x: (c.x0 + c.x1) / 2, z: (c.z0 + c.z1) / 2 } : { x: c.x, z: c.z });
const extent = (c: Collider) => (c.kind === 'disc' ? c.r : c.kind === 'box' ? Math.max(c.x1 - c.x0, c.z1 - c.z0) / 2 : Math.max(c.hx, c.hz));
/** How deep a walker of radius r at p is inside any collider (0 = touching nothing). */
function penetration(p: { x: number; z: number }, r: number, cs: readonly Collider[] = STATIC_COLLIDERS) {
  let worst = 0;
  for (const c of cs) worst = Math.max(worst, r - signedDistance(c, p.x, p.z));
  return worst;
}
const label = (c: Collider) => `${c.label ?? c.style} ${c.kind} at (${centre(c).x.toFixed(1)}, ${centre(c).z.toFixed(1)})`;

/** A free spot from which walking straight at the collider's centre meets this collider first. */
function approach(c: Collider): { x: number; z: number } | null {
  const o = centre(c);
  for (const gap of [2.5, 4, 6])
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, d = extent(c) + gap;
      const p = { x: o.x + Math.cos(a) * d, z: o.z + Math.sin(a) * d };
      if (STATIC_SOLIDS.blocked(p, 0.5)) continue;
      if (STATIC_SOLIDS.hitSegment(p.x, p.z, o.x, o.z, -1) !== c) continue;
      // the walker's shoulders must not meet anything else first either (a buttress on the wall, a table)
      const nx = -Math.sin(a) * 0.5, nz = Math.cos(a) * 0.5;
      const side = (s: number) => STATIC_SOLIDS.hitSegment(p.x + nx * s, p.z + nz * s, o.x + nx * s, o.z + nz * s, -1);
      if ([side(1), side(-1)].some((h) => h && h !== c)) continue;
      return p;
    }
  return null;
}

describe('the layout is solid', () => {
  it('every collider comes from something drawn: obstacles through colliderOf, trees as their trunks', () => {
    expect(STATIC_COLLIDERS.slice(0, OBSTACLES.length)).toEqual(OBSTACLES.map(colliderOf));
    const trees = OBSTACLES.filter((o) => o.style === 'tree');
    expect(trees.length).toBeGreaterThan(100);
    for (const t of trees) if (t.kind === 'disc') expect(colliderOf(t)).toMatchObject({ kind: 'disc', x: t.x, z: t.z, r: t.r * TRUNK });
  });

  it('walking into each structure stops at its surface (and never inside anything)', () => {
    const w = mkWorld();
    w.flags.willowCalmUntil = 1e9; // (the Whomping Willow would knock the walker back)
    const a = join(w, 'Walker');
    let tested = 0;
    const missing: string[] = [];
    for (const c of STATIC_COLLIDERS) {
      if (c.style === 'veil') continue; // the scenes' veil (test/scenes.test.ts): a wall 100 m long has no single approach
      const start = approach(c);
      if (!start) { missing.push(label(c)); continue; }
      a.pos = { ...start };
      const o = centre(c);
      for (let t = 0; t < 50; t++) {
        const dx = o.x - a.pos.x, dz = o.z - a.pos.z, l = Math.hypot(dx, dz) || 1;
        w.setInput(a.id, dx / l, dz / l);
        w.tick();
        const pen = penetration(a.pos, 0.5);
        if (pen > 0.05) throw new Error(`${label(c)}: walker ${pen.toFixed(3)} m inside something at (${a.pos.x.toFixed(2)}, ${a.pos.z.toFixed(2)})`);
      }
      // it got there and stopped against this collider
      expect(signedDistance(c, a.pos.x, a.pos.z), label(c)).toBeLessThan(0.6);
      tested++;
    }
    w.setInput(a.id, 0, 0);
    // only colliders buried inside others (a buttress in a wing, a tree hemmed in) have no free approach
    expect(missing.length, missing.join('; ')).toBeLessThan(12);
    expect(tested).toBeGreaterThan(STATIC_COLLIDERS.filter((c) => c.style !== 'veil').length - 12);
  });

  it('the lake stops walkers at the waterline; bolts skim over it and over the tables', () => {
    const lake = STATIC_COLLIDERS.find((c) => c.style === 'water')!;
    expect(lake.h).toBeLessThan(BOLT_HEIGHT);
    const p = { x: -118, z: 40 - 20 };
    STATIC_SOLIDS.resolve(p, 0.5);
    expect(signedDistance(lake, p.x, p.z)).toBeCloseTo(0.5, 5);
    expect(STATIC_SOLIDS.hitSegment(-172, 40, -72, 40)).toBeNull(); // (the lake's scene, veil to veil)
    expect(STATIC_SOLIDS.hitSegment(-7.5, -70, -7.5, -44, -1)?.label).toBe('House table');
    expect(STATIC_SOLIDS.hitSegment(-7.5, -70, -7.5, -44)).toBeNull();
  });

  it('segment tests find thin things whatever the step (torch posts, hoops, the mirror)', () => {
    for (const c of STATIC_COLLIDERS.filter((c) => c.label === 'Torch' || c.style === 'hoop' || c.label === 'Mirror of Erised')) {
      const o = centre(c);
      expect(STATIC_SOLIDS.hitSegment(o.x - 5, o.z + 3, o.x + 5, o.z - 3), label(c)).toBe(c); // (from the south: the mirror hangs on a wall)
      expect(STATIC_SOLIDS.hitT).toBeGreaterThan(0);
      expect(STATIC_SOLIDS.hitT).toBeLessThan(0.5);
    }
  });
});

describe('the edge of the world', () => {
  it('walkers stop where the Highlands begin to climb, never on a mountainside', () => {
    const w = mkWorld();
    const a = join(w, 'Rambler');
    for (const [tx, tz] of [[240, 240], [-240, 240], [240, -240], [-240, -240], [0, 260], [260, 0]]) {
      a.pos = { x: tx * 0.5, z: tz * 0.5 };
      w.solids.resolve(a.pos, 0.5);
      for (let t = 0; t < 900; t++) {
        const dx = tx - a.pos.x, dz = tz - a.pos.z, l = Math.hypot(dx, dz) || 1;
        w.setInput(a.id, dx / l, dz / l);
        w.tick();
      }
      expect(Math.abs(a.pos.x)).toBeLessThanOrEqual(WORLD_HALF);
      expect(Math.abs(a.pos.z)).toBeLessThanOrEqual(WORLD_HALF);
      expect(Math.hypot(a.pos.x - WORLD_EDGE.x, a.pos.z - WORLD_EDGE.z)).toBeLessThanOrEqual(WORLD_EDGE.r + 1e-9);
      expect(heightAt(a.pos.x, a.pos.z)).toBeLessThan(4);
    }
  });

  it('everywhere a walker can stand, the drawn ground is low and gentle', () => {
    let maxH = -Infinity, maxSlope = 0;
    for (let x = -WORLD_HALF; x <= WORLD_HALF; x += 3)
      for (let z = -WORLD_HALF; z <= WORLD_HALF; z += 3) {
        if (Math.hypot(x - WORLD_EDGE.x, z - WORLD_EDGE.z) > WORLD_EDGE.r) continue;
        const h = heightAt(x, z);
        maxH = Math.max(maxH, h);
        maxSlope = Math.max(maxSlope, Math.hypot(heightAt(x + 1, z) - heightAt(x - 1, z), heightAt(x, z + 1) - heightAt(x, z - 1)) / 2);
      }
    expect(maxH).toBeLessThan(5);
    expect(maxSlope).toBeLessThan(0.45); // < 25 degrees (the mountainsides beyond reach exceed 0.7)
  });
});

describe('pathfinding goes round everything', () => {
  it('no route crosses a collider, and walkers following routes arrive (never stuck)', () => {
    const w = mkWorld();
    const a = join(w, 'Pathfinder');
    const rnd = mulberry32(2024);
    // two points of one scene (src/shared/scenes.ts: between scenes the walk goes by a gate, test/scenes.test.ts)
    const pick = (same?: { x: number; z: number }) => {
      for (;;) {
        const p = { x: (rnd() * 2 - 1) * 230, z: (rnd() * 2 - 1) * 230 };
        const s = sceneAt(p.x, p.z);
        if (!s || (same && s !== sceneAt(same.x, same.z))) continue;
        if (!STATIC_SOLIDS.blocked(p, 0.5) && walkableAt(p)) return p;
      }
    };
    let walks = 0, routes = 0;
    for (let n = 0; n < 60; n++) {
      const from = pick(), to = pick(from);
      const route = findPath(from, to);
      if (!route) continue; // (the far side of the lake from a pocket in the forest, say)
      routes++;
      let prev = from;
      for (const wp of route) {
        const hit = STATIC_SOLIDS.hitSegment(prev.x, prev.z, wp.x, wp.z, -1);
        expect(hit, `leg (${prev.x.toFixed(1)},${prev.z.toFixed(1)}) -> (${wp.x.toFixed(1)},${wp.z.toFixed(1)}) crosses ${hit && label(hit)}`).toBeNull();
        prev = wp;
      }
      if (n % 4) continue;
      // walk a quarter of them for real
      a.pos = { ...from };
      w.setGoal(a.id, to);
      const goal = a.goal!;
      let len = 0;
      prev = from;
      for (const wp of a.route) { len += Math.hypot(wp.x - prev.x, wp.z - prev.z); prev = wp; }
      for (let t = 0; t < (len / 7 + 6) / 0.05 && a.goal; t++) {
        w.tick();
        expect(penetration(a.pos, 0.5)).toBeLessThan(0.05);
      }
      expect(Math.hypot(a.pos.x - goal.x, a.pos.z - goal.z), `from (${from.x.toFixed(1)},${from.z.toFixed(1)}) to (${to.x.toFixed(1)},${to.z.toFixed(1)})`).toBeLessThan(1.2);
      walks++;
    }
    expect(routes).toBeGreaterThan(40);
    expect(walks).toBeGreaterThan(8);
  });

  it('a walker that starts inside a collider is put outside it and still gets a route', () => {
    const w = mkWorld();
    const a = join(w, 'Ghost');
    a.pos = { x: 41, z: -40 }; // inside Greenhouse Three
    w.setGoal(a.id, { x: 0, z: -22 });
    expect(a.route.length).toBeGreaterThan(0);
    for (let t = 0; t < 30 / 0.05 && a.goal; t++) w.tick();
    expect(penetration(a.pos, 0.5)).toBeLessThan(0.05);
    expect(Math.hypot(a.pos.x, a.pos.z + 22)).toBeLessThan(1.2);
  });
});

describe('Ministers\' statues are solid, and only while they stand', () => {
  it('rise with a decree, block walkers and routes, and fall with the list', () => {
    const w = mkWorld();
    const m = join(w, 'Minister Fudge');
    const walker = join(w, 'Walker');
    m.reputation = 500;
    w.forceEndTerm();
    expect(w.solids.dynamic).toHaveLength(0);
    const r = w.decree(m.id, { combat: { damageMultiplier: 2 } }, 'Statues for all', false);
    expect(r.ok).toBe(true);
    w.tick();
    expect(w.solids.dynamic).toEqual([statueCollider(0)]);
    const s = statueCollider(0);
    const o = centre(s);
    // walking into it stops
    walker.pos = { x: o.x - 4, z: o.z };
    for (let t = 0; t < 40; t++) { w.setInput(walker.id, 1, 0); w.tick(); }
    expect(signedDistance(s, walker.pos.x, walker.pos.z)).toBeGreaterThan(0.45);
    expect(signedDistance(s, walker.pos.x, walker.pos.z)).toBeLessThan(0.6);
    w.setInput(walker.id, 0, 0);
    // routes go round it (the static world alone would go straight through)
    const from = { x: o.x - 4, z: o.z }, to = { x: o.x + 4, z: o.z };
    expect(clearLine(from, to)).toBe(true);
    expect(clearLine(from, to, w.solids)).toBe(false);
    const route = findPath(from, to, w.solids)!;
    let prev = from;
    for (const wp of route) { expect(w.solids.hitSegment(prev.x, prev.z, wp.x, wp.z, -1)).toBeNull(); prev = wp; }
    // bolts stop on it
    expect(w.solids.hitSegment(from.x, from.z, to.x, to.z)).toBe(w.solids.dynamic[0]);
    // a statue rising on top of someone shoves them out
    walker.pos = { ...o };
    w.flags.statues = [...w.flags.statues, { ...w.flags.statues[0], name: 'Umbridge' }];
    w.tick();
    expect(w.solids.dynamic).toHaveLength(2);
    expect(signedDistance(s, walker.pos.x, walker.pos.z)).toBeGreaterThan(0.45);
    // the statues fall (a veto replaces the list): nothing there any more
    w.flags.statues = [];
    w.tick();
    expect(w.solids.dynamic).toHaveLength(0);
    walker.pos = { x: o.x - 4, z: o.z };
    for (let t = 0; t < 40; t++) { w.setInput(walker.id, 1, 0); w.tick(); }
    expect(walker.pos.x).toBeGreaterThan(o.x + 2);
    expect(clearLine(from, to, w.solids)).toBe(true);
  });

  it('restored worlds rebuild their statues', () => {
    const w = mkWorld();
    w.flags.statues = [{ name: 'Fudge', house: 'Slytherin', term: 1, inscription: 'x' }, { name: 'Scrimgeour', house: 'Gryffindor', term: 2, inscription: 'y' }];
    const w2 = World.restore(JSON.parse(JSON.stringify(w.serialize())));
    w2.tick();
    expect(w2.solids.dynamic).toEqual([statueCollider(0), statueCollider(1)]);
  });
});

describe('bodies do not overlap', () => {
  it('the separation grid is wide enough for the largest walkers', () => {
    const biggest = Math.max(...Object.values(CREATURES).filter((d) => !d.flying).map((d) => d.radius));
    expect(2 * biggest).toBeLessThanOrEqual(SEP_CELL);
  });

  const near = (a: { pos: { x: number; z: number } }, b: { pos: { x: number; z: number } }) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);

  it('two wizards on one spot ease apart over a few ticks (safe zones too)', () => {
    const w = mkWorld();
    for (const at of [{ x: 30, z: 10 }, { x: 0, z: -56 }]) { // open grounds; the Great Hall (a safe zone)
      const a = join(w, `A${at.x}`), b = join(w, `B${at.x}`);
      a.pos = { ...at }; b.pos = { ...at };
      w.tick();
      const d1 = near(a, b);
      expect(d1).toBeGreaterThan(0);
      expect(d1).toBeLessThan(1); // soft: not popped apart in one tick
      for (let t = 0; t < 20; t++) w.tick();
      expect(near(a, b)).toBeGreaterThan(0.97);
      // equal masses share the push evenly (each pair is settled once, for both at the same time)
      expect(Math.hypot(a.pos.x - at.x, a.pos.z - at.z)).toBeCloseTo(Math.hypot(b.pos.x - at.x, b.pos.z - at.z), 6);
      a.pos = { x: 500, z: 500 }; b.pos = { x: 510, z: 510 };
    }
  });

  it('a wizard walking into another pushes through slowly, never through them', () => {
    const w = mkWorld();
    const a = join(w, 'Pusher'), b = join(w, 'Stander');
    a.pos = { x: 20, z: 10 }; b.pos = { x: 23, z: 10 };
    let minD = Infinity;
    for (let t = 0; t < 30; t++) { w.setInput(a.id, 1, 0); w.tick(); minD = Math.min(minD, near(a, b)); }
    expect(a.pos.x).toBeLessThan(b.pos.x);
    expect(minD).toBeGreaterThan(0.85);
    expect(b.pos.x).toBeGreaterThan(23.5); // shoved along
  });

  it('mass by size: a troll barely moves for a pixie; the snare and the rooted do not budge; flyers pass over', () => {
    const w = mkWorld();
    const troll = addCreature(w, 'troll', 30, 30), pixie = addCreature(w, 'pixie', 30.5, 30);
    for (const c of [troll, pixie]) c.auras = [{ k: 'chill', mag: 1, until: 1e9, src: null }]; // frozen still: only shoves move them
    for (let t = 0; t < 20; t++) w.tick();
    expect(near(troll, pixie)).toBeGreaterThan(1.7);
    const trollMoved = Math.hypot(troll.pos.x - 30, troll.pos.z - 30), pixieMoved = Math.hypot(pixie.pos.x - 30.5, pixie.pos.z - 30);
    expect(pixieMoved).toBeGreaterThan(trollMoved * 8);

    const snare = addCreature(w, 'snare', 60, 30);
    const a = join(w, 'Gardener');
    a.pos = { x: 60.5, z: 30 };
    for (let t = 0; t < 20; t++) w.tick();
    expect(snare.pos).toEqual({ x: 60, z: 30 });
    expect(near(a, snare)).toBeGreaterThan(1.65);

    const b = join(w, 'Rooted'), c = join(w, 'Nudger');
    b.pos = { x: 80, z: 30 }; c.pos = { x: 80.2, z: 30 };
    b.st.rootedUntil = w.now + 100;
    for (let t = 0; t < 20; t++) w.tick();
    expect(b.pos).toEqual({ x: 80, z: 30 });
    expect(near(b, c)).toBeGreaterThan(0.97);

    const phoenix = addCreature(w, 'phoenix', 100, 30), d = join(w, 'Friend');
    d.pos = { x: 100.1, z: 30 };
    const pp = { ...phoenix.pos };
    w.tick();
    expect(d.pos).toEqual({ x: 100.1, z: 30 });
    expect(Math.hypot(phoenix.pos.x - pp.x, phoenix.pos.z - pp.z)).toBeLessThan(1); // (it wanders on its own)
  });

  it('nobody is shoved into a wall, and wild creatures are never shoved into a safe zone', () => {
    const w = mkWorld();
    const pixie = addCreature(w, 'pixie', 13 + 0.35 + 0.01, -44); // against the Great Hall's east wall, outside
    const a = join(w, 'Shover');
    a.pos = { x: pixie.pos.x + 0.3, z: -44 };
    for (let t = 0; t < 30; t++) { w.setInput(a.id, -1, 0); w.tick(); expect(penetration(pixie.pos, 0.35)).toBeLessThan(0.05); }
    expect(w.inSafe(pixie.pos)).toBe(false);
  });

  it('a crowd of 200 on the spawn spreads out to (nearly) no overlap', () => {
    const w = mkWorld();
    const ws: Wizard[] = [];
    for (let i = 0; i < 200; i++) { const x = join(w, `Crowd ${i}`); x.pos = { x: 30 + (i % 7) * 0.1, z: 10 + Math.floor(i / 7) * 0.1 }; ws.push(x); }
    for (let t = 0; t < 200; t++) w.tick();
    let worst = 0;
    for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) worst = Math.max(worst, 1 - near(ws[i], ws[j]));
    expect(worst).toBeLessThan(0.1);
  });
});

describe('bolts stop at walls', () => {
  it('a Stupefy at a troll behind the Three Broomsticks hits the wall, not the troll', () => {
    const w = mkWorld();
    const a = join(w, 'Caster');
    a.year = 3;
    a.pos = { x: -23, z: 146 };
    const troll = addCreature(w, 'troll', -23, 166.5);
    const hp = troll.hp;
    w.cast(a.id, 'Stupefy', { target: troll.id });
    for (let t = 0; t < 40; t++) w.tick();
    expect(troll.hp).toBe(hp);
    // nothing in the way: it lands
    a.pos = { x: -10, z: 150 };
    troll.pos = { x: -10, z: 165 };
    a.globalCd = 0; a.cooldowns = {};
    w.cast(a.id, 'Stupefy', { target: troll.id });
    for (let t = 0; t < 40; t++) w.tick();
    expect(troll.hp).toBeLessThan(hp);
  });

  it('even at the fastest decreed bolt speed, nothing tunnels through a one-metre wall', () => {
    const w = mkWorld();
    w.rules.physics.projectileSpeed = 80;
    const a = join(w, 'Sniper');
    a.year = 3;
    a.pos = { x: 8, z: -30 }; // courtyard, south of the Great Hall's south wall (z -41..-40)
    const troll = addCreature(w, 'troll', 8, -45);
    w.rules.combat.safeZones = [];
    const hp = troll.hp;
    for (let k = 0; k < 6; k++) {
      a.globalCd = 0; a.cooldowns = {}; a.mana = 999;
      w.cast(a.id, 'Stupefy', { aim: { x: 8 + k * 0.05, z: -60 } });
      for (let t = 0; t < 20; t++) w.tick();
    }
    expect(troll.hp).toBe(hp);
  });
});

describe('Solids', () => {
  it('oriented boxes resolve in their own frame', () => {
    const s = new Solids();
    s.setDynamic([{ kind: 'obox', x: 0, z: 0, hx: 3, hz: 0.5, yaw: Math.PI / 4, h: 5, style: 'stone' }]);
    // a point on the rotated long axis, well outside the axis-aligned footprint of the same box
    const p = { x: 2 * Math.SQRT1_2, z: -2 * Math.SQRT1_2 };
    s.resolve(p, 0.5, false);
    const c = s.dynamic[0];
    expect(signedDistance(c, p.x, p.z)).toBeCloseTo(0.5, 6);
    const q = { x: 2.5, z: 2.5 }; // off the rotated box entirely
    s.resolve(q, 0.5, false);
    expect(q).toEqual({ x: 2.5, z: 2.5 });
  });
});
