import { describe, expect, it } from 'vitest';
import { duelJoin, duelRollStepAllowed, DUEL_FEATURE, DUEL_LEASH, DUEL_STAGE } from '../src/kernel/duelclub.js';
import { findPath, walkableAt } from '../src/kernel/pathfind.js';
import { setReflexes } from '../src/kernel/reflexes.js';
import { broom } from '../src/kernel/travel.js';
import type { Vec2 } from '../src/kernel/types.js';
import { DODGE_DIST, World } from '../src/kernel/world.js';
import { sceneAt } from '../src/shared/scenes.js';

function fixture(at: Vec2 = { x: 0, z: -20 }) {
  const w = new World({ seed: 41, secret: 'navigation-regression' });
  w.rules.creatures.spawnMultiplier = 0; w.rules.events.pool = []; w.term.endsAt = 1e12;
  const a = w.enroll('Walker', 'Ravenclaw').wizard;
  a.connections = 1; a.createdAt = -1e6; a.pos = { ...at }; w.moved(a);
  w.tick(); // Initialize this World's statue overlay before installing any controlled dynamic solids.
  return { w, a };
}
function run(w: World, seconds: number) { for (let i = 0; i < seconds * 20; i++) w.tick(); }
function noWalk(w: World, a: ReturnType<typeof fixture>['a']) {
  expect(a.goal).toBeNull(); expect(a.route).toEqual([]); expect(a.goalBy).toBeNull();
  expect(w.via.has(a.id)).toBe(false);
}

describe('navigation: routes belong to the current life and controller', () => {
  it.each(['agent', 'player'] as const)('rejects a new %s route while down, then routes from the respawn scene', (by) => {
    const { w, a } = fixture({ x: 130, z: 38 });
    a.st.stunnedUntil = w.now + 2;
    expect(() => w.setGoal(a.id, { x: 95, z: 34 }, by)).toThrow(/stunned|击晕/);
    noWalk(w, a); run(w, 3);
    expect(sceneAt(a.pos.x, a.pos.z)?.id).toBe('castle');
    const goal = w.setGoal(a.id, { x: 95, z: 34 }, by)!; run(w, 40);
    expect(sceneAt(a.pos.x, a.pos.z)?.id).toBe('forest');
    noWalk(w, a);
    // The hut's blocked cell is adjusted to nearby walkable ground by the existing goal policy.
    expect(Math.hypot(a.pos.x - 95, a.pos.z - 34)).toBeLessThan(4);
    expect(goal.x).toBeGreaterThan(70);
  });
  it('clears a previously accepted route and via when respawning, including stale manual input', () => {
    const { w, a } = fixture({ x: 130, z: 38 });
    w.setGoal(a.id, { x: 0, z: -52 }, 'agent');
    a.st.stunnedUntil = w.now + 0.1; a.input = { dx: 1, dz: 0 };
    run(w, 0.2); noWalk(w, a); expect(a.input).toEqual({ dx: 0, dz: 0 });
  });
  it('a real knock-out immediately cancels the route and scene continuation', () => {
    const { w, a } = fixture({ x: 130, z: 38 });
    w.setGoal(a.id, { x: 0, z: -52 }, 'agent');
    expect(w.via.has(a.id)).toBe(true); w.damage(null, a.id, 1000, 'arcane');
    expect(a.st.stunnedUntil).toBeGreaterThan(w.now); noWalk(w, a);
  });
  it.each(['stop', 'keys', 'pause', 'apparate'] as const)('%s removes the agent continuation as well as the current leg', (action) => {
    const { w, a } = fixture(); w.setGoal(a.id, { x: 95, z: 34 }, 'agent');
    expect(w.via.has(a.id)).toBe(true);
    if (action === 'stop') w.setGoal(a.id, null, 'agent');
    if (action === 'keys') w.setInput(a.id, 1, 0);
    if (action === 'pause') w.setAgentPaused(a.id, true);
    if (action === 'apparate') w.apparate(a, { x: 0, z: -20 });
    noWalk(w, a);
  });
  it('agent stop and pause preserve the human walk and continuation; keys still reclaim them', () => {
    const { w, a } = fixture(); w.setGoal(a.id, { x: 95, z: 34 }, 'player');
    const goal = a.goal, via = w.via.get(a.id);
    w.setGoal(a.id, null, 'agent'); w.setAgentPaused(a.id, true);
    expect(a.goal).toBe(goal); expect(w.via.get(a.id)).toBe(via);
    expect(() => w.setGoal(a.id, { x: 10, z: -20 }, 'agent')).toThrow(/paused/);
    w.setInput(a.id, 1, 0); noWalk(w, a);
  });
  it('rejects an NPC cross-scene route without leaving goal, route or via', () => {
    const { w, a } = fixture(); a.npc = true;
    expect(() => w.setGoal(a.id, { x: 95, z: 34 })).toThrow(/NPC.*mist|NPC.*迷雾/);
    noWalk(w, a);
  });
  it('an unreachable cross-scene request never leaves a half-installed continuation', () => {
    const { w, a } = fixture();
    w.solids.setDynamic([
      { kind: 'box', x0: -3, x1: -2, z0: -23, z1: -17, h: 2, style: 'stone' },
      { kind: 'box', x0: 2, x1: 3, z0: -23, z1: -17, h: 2, style: 'stone' },
      { kind: 'box', x0: -3, x1: 3, z0: -23, z1: -22, h: 2, style: 'stone' },
      { kind: 'box', x0: -3, x1: 3, z0: -18, z1: -17, h: 2, style: 'stone' },
    ]);
    expect(() => w.setGoal(a.id, { x: 95, z: 34 }, 'agent')).toThrow(/no way/);
    noWalk(w, a);
  });
  it('human stop retains the steering grace, while agent stop clears a continuation between legs', () => {
    const { w, a } = fixture(); w.setGoal(a.id, { x: 95, z: 34 }, 'agent');
    a.goal = null; a.route = []; a.goalBy = null;
    w.setGoal(a.id, null, 'agent'); noWalk(w, a);
    w.setGoal(a.id, null, 'player');
    expect(() => w.setGoal(a.id, { x: 10, z: -20 }, 'agent')).toThrow(/human is steering/);
  });
});

describe('navigation: collision-reachable first legs and net progress', () => {
  it.each(['tomb', 'thin-column'] as const)('a same-cell goal cannot bypass the rejected first leg: %s', (kind) => {
    const { w } = fixture();
    const from = kind === 'tomb' ? { x: -54.3, z: 27.7 } : { x: 0.45, z: -19.65 };
    const to = kind === 'tomb' ? { x: -54.08, z: 26.08 } : { x: 0.45, z: -18.35 };
    if (kind === 'thin-column') w.solids.setDynamic([{ kind: 'disc', x: 0.2, z: -19, r: 0.05, h: 2, style: 'wood' }]);
    expect(w.solids.blocked(from, 0.5)).toBe(false); expect(w.solids.blocked(to, 0.5)).toBe(false);
    expect(walkableAt(from, w.solids)).toBe(true); expect(walkableAt(to, w.solids)).toBe(true);
    expect(w.solids.hitSegment(from.x, from.z, to.x, to.z, -1, 0.45)).not.toBeNull();
    const route = findPath(from, to, w.solids);
    if (route) {
      let previous = from;
      for (const p of route) {
        expect(w.solids.hitSegment(previous.x, previous.z, p.x, p.z, -1, 0.45)).toBeNull();
        previous = p;
      }
    }
  });
  it('escapes the physically open, coarse-blocked cell behind the mirror', () => {
    const { w, a } = fixture({ x: 30.017, z: -63.5 });
    expect(w.solids.blocked(a.pos, 0.5)).toBe(false); expect(walkableAt(a.pos, w.solids)).toBe(false);
    const route = findPath(a.pos, { x: 0, z: -52 }, w.solids)!;
    expect(route).toBeTruthy();
    expect(w.solids.hitSegment(a.pos.x, a.pos.z, route[0].x, route[0].z, -1, 0.45)).toBeNull();
    w.setGoal(a.id, { x: 0, z: -52 }, 'agent'); run(w, 25);
    noWalk(w, a); expect(Math.hypot(a.pos.x, a.pos.z + 52)).toBeLessThan(1);
  });
  it.each([false, true])('pitch to hall arrives after stop/reissue, broom=%s', (flying) => {
    const { w, a } = fixture({ x: 38.6, z: -134.3 });
    if (flying) broom(w, a.id, true);
    w.setGoal(a.id, { x: 0, z: -52 }, 'agent'); run(w, 4);
    w.setGoal(a.id, null, 'agent'); noWalk(w, a);
    w.setGoal(a.id, { x: 0, z: -52 }, 'agent'); run(w, 30);
    noWalk(w, a); expect(Math.hypot(a.pos.x, a.pos.z + 52)).toBeLessThan(1);
  });
  it('sideways oscillation along an obsolete first leg triggers replanning instead of resetting the timer', () => {
    const { w, a } = fixture({ x: 30.017, z: -63.5 });
    a.route = [{ x: 31, z: -61 }, { x: 13, z: -39 }, { x: 1, z: -37 }, { x: 0, z: -52 }];
    a.goal = a.route.at(-1)!; a.goalBy = 'agent';
    run(w, 25); noWalk(w, a); expect(Math.hypot(a.pos.x, a.pos.z + 52)).toBeLessThan(1);
  });
});

function duel() {
  const { w, a } = fixture(); const b = w.enroll('Opponent', 'Slytherin').wizard;
  b.connections = 1; b.createdAt = -1e6;
  duelJoin(w, a.id); duelJoin(w, b.id); run(w, 5.25);
  a.pos = { x: 0.7, z: -40.2 }; b.pos = { x: 1.72, z: -34.2 }; w.moved(a); w.moved(b);
  return { w, a, b };
}
function safeRoll(w: World, a: ReturnType<typeof fixture>['a'], dt = 0.05) {
  for (let i = 0; i < Math.ceil(0.4 / dt); i++) {
    w.tick(dt); expect(w.inSafe(a.pos)).toBe(false);
    expect(Math.hypot(a.pos.x - DUEL_STAGE.x, a.pos.z - DUEL_STAGE.z)).toBeLessThanOrEqual(DUEL_LEASH);
    expect(w.duel.match).not.toBeNull();
  }
}
describe('duel rolls: resolved collision paths stay legal', () => {
  it.each([0.025, 0.05, 0.12])('manual wall-jamb roll stays legal at dt=%s', (dt) => {
    const { w, a } = duel(); expect(w.dodge(a.id, 1, -0.17, 'agent').ok).toBe(true); safeRoll(w, a, dt);
  });
  it('real incoming triggers an automatic safe roll at the same wall jamb', () => {
    const { w, a, b } = duel(); setReflexes(w, a.id, [{ when: 'incoming', do: 'dodge' }]);
    expect(w.cast(b.id, 'Stupefy', { target: a.handle }).ok).toBe(true); safeRoll(w, a);
    expect(w.reflexes.stat.get(a.id)?.[0].n).toBe(1);
  });
  it('rejects a continuous segment through a safe corner even when both endpoints are outside', () => {
    const { w, a } = duel(); a.pos = { x: 11.7, z: -39.5 }; w.moved(a);
    const l = Math.hypot(0.1, -1), dx = 0.1 / l, dz = -1 / l;
    expect(w.inSafe(a.pos)).toBe(false);
    expect(w.inSafe({ x: a.pos.x + dx * DODGE_DIST, z: a.pos.z + dz * DODGE_DIST })).toBe(false);
    expect(DUEL_FEATURE.dodgeDir!(w, a, dx, dz)).not.toBeNull();
    expect(duelRollStepAllowed(w, a, a.pos, { x: a.pos.x + dx * DODGE_DIST, z: a.pos.z + dz * DODGE_DIST })).toBe(false);
  });
  it('holds position when every proposed direction is collision-resolved into a safe zone', () => {
    const { w, a } = duel(); const original = w.solids.resolve;
    w.solids.resolve = (p) => { p.x = 0; p.z = -52; };
    try { expect(DUEL_FEATURE.dodgeDir!(w, a, 1, -0.17)).toEqual([0, 0]); }
    finally { w.solids.resolve = original; }
  });
  it('rechecks a real collider added after choosing the roll, without forfeiting the match', () => {
    const { w, a } = duel(); a.pos = { x: 0, z: -40.2 }; w.moved(a);
    w.dodge(a.id, 1, 0, 'agent');
    // A new solid straddles the stage/Hall boundary. Its shallow face pushes north into the Hall.
    w.solids.setDynamic([{ kind: 'box', x0: 0.1, x1: 2, z0: -41, z1: -40, h: 2, style: 'stone' }]);
    safeRoll(w, a, 0.12);
  });
  it('preserves ordinary non-duel rolls and the existing stage-edge redirect', () => {
    const { w, a } = fixture(); w.dodge(a.id, 1, 0); run(w, 0.4);
    expect(a.pos.x).toBeGreaterThan(3); expect(a.st.dashDx).toBe(1);
    const d = duel(); d.a.pos = { x: DUEL_STAGE.x + DUEL_LEASH - 2, z: DUEL_STAGE.z }; d.w.moved(d.a);
    d.w.dodge(d.a.id, 1, 0); safeRoll(d.w, d.a);
    expect(d.a.pos.x).toBeLessThan(DUEL_STAGE.x + DUEL_LEASH - 2);
  });
});
