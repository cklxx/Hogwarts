import { describe, expect, it } from 'vitest';
import { World } from '../src/kernel/world.js';
import type { Vec2, Wizard } from '../src/kernel/types.js';
import { floo } from '../src/kernel/travel.js';
import { duelJoin, stepDuelClub } from '../src/kernel/duelclub.js';
import { QD_CALL_S, QD_START_FRAC, qdJoin, qdChase, qdLeave, stepQuidditch } from '../src/kernel/quidditch.js';
import { freeze, ICE_FEATURE, onIce } from '../src/kernel/ice.js';
import { ICE_S, LAKE_WATER, overWater } from '../src/shared/ice.js';

function fixture(at: Vec2 = { x: 0, z: -20 }) {
  const world = new World({ seed: 41, secret: 'route-reset-test' });
  world.rules.creatures.spawnMultiplier = 0;
  world.rules.events.pool = [];
  const a = world.enroll('Route Reset', 'Gryffindor').wizard;
  a.connections = 1; a.createdAt = -1e6; a.pos = { ...at }; world.moved(a);
  return { world, a };
}
function route(world: World, a: Wizard, to: Vec2 = { x: 95, z: 34 }, by: 'player' | 'agent' = 'agent') {
  world.setGoal(a.id, to, by);
  expect(world.via.has(a.id)).toBe(true);
}
function stopped(world: World, a: Wizard) {
  expect(a.goal).toBeNull(); expect(a.route).toEqual([]); expect(a.goalBy).toBeNull();
  expect(world.via.has(a.id)).toBe(false);
}
function calledMatch() {
  const f = fixture();
  const whistle = f.world.term.startedAt + QD_START_FRAC * (f.world.term.endsAt - f.world.term.startedAt);
  f.world.now = whistle - QD_CALL_S + 1;
  stepQuidditch(f.world, 0.05);
  expect(f.world.qd.match?.phase).toBe('call');
  return { ...f, whistle };
}
function playingMatch() {
  const f = calledMatch(); f.world.now = f.whistle;
  stepQuidditch(f.world, 0.05);
  expect(f.world.qd.match?.phase).toBe('play');
  return f;
}

describe('route reset APIs also cancel a cross-scene continuation', () => {
  it('Floo arrival clears the previous walk and continuation', () => {
    const { world, a } = fixture({ x: 0, z: -48 });
    route(world, a);
    expect(floo(world, a.id, 'hagrid').to).toBe('hagrid');
    stopped(world, a);
  });
  it('starting a real duel clears both contestants’ pending walks', () => {
    const { world, a } = fixture();
    const b = world.enroll('Route Rival', 'Slytherin').wizard;
    b.connections = 1; b.pos = { x: 2, z: -20 };
    route(world, a); route(world, b);
    duelJoin(world, a.id); duelJoin(world, b.id); stepDuelClub(world);
    expect(world.duel.match?.sides.flat()).toContain(a.id);
    stopped(world, a); stopped(world, b);
  });
  it('joining a match already in play clears the route before placing the player on the pitch', () => {
    const { world, a } = playingMatch(); route(world, a);
    qdJoin(world, a.id);
    expect(world.qd.match?.roster[a.id]).toBeDefined();
    expect(a.pos.z).toBeLessThan(-100);
    stopped(world, a);
  });
  it('the whistle clears the waiting player’s route before taking the pitch', () => {
    const { world, a, whistle } = calledMatch();
    qdJoin(world, a.id); route(world, a);
    world.now = whistle; stepQuidditch(world, 0.05);
    expect(world.qd.match?.phase).toBe('play');
    stopped(world, a);
  });
  it.each(['chase off', 'leave', 'match end'] as const)('%s clears an agent route with a pending scene crossing', (action) => {
    const { world, a } = playingMatch();
    qdJoin(world, a.id); qdChase(world, a.id, true);
    route(world, a, { x: 0, z: -52 });
    if (action === 'chase off') qdChase(world, a.id, false);
    else if (action === 'leave') qdLeave(world, a.id);
    else {
      world.now = world.qd.match!.until;
      stepQuidditch(world, 0.05);
      expect(world.qd.match?.phase).toBe('done');
    }
    stopped(world, a);
  });
  it('stopping chase or leaving preserves an explicitly controlled human route', () => {
    const { world, a } = playingMatch();
    qdJoin(world, a.id); qdChase(world, a.id, true);
    route(world, a, { x: 0, z: -52 }, 'player');
    const goal = a.goal, continuation = world.via.get(a.id);
    qdChase(world, a.id, false); qdLeave(world, a.id);
    expect(a.goal).toBe(goal); expect(world.via.get(a.id)).toBe(continuation);
  });
  it('spell ice melting clears a route before sending the walker back to shore', () => {
    const { world, a } = fixture({ x: -87, z: 40 });
    route(world, a, { x: 95, z: 34 });
    freeze(world, LAKE_WATER, 4);
    a.pos = { ...LAKE_WATER }; world.moved(a);
    expect(onIce(world, a.pos.x, a.pos.z)).toBe(true);
    world.now += ICE_S + 1; ICE_FEATURE.sweep!(world);
    expect(overWater(a.pos.x, a.pos.z)).toBe(false);
    stopped(world, a);
  });
});
