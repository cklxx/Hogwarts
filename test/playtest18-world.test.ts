import { expect, test } from 'vitest';
import { World } from '../src/kernel/world.js';
import { SCENES_FEATURE } from '../src/kernel/scenes.js';
import { possessNpc, release } from '../src/kernel/possess.js';
import { GATES, sceneAt } from '../src/shared/scenes.js';
import { PROPS } from '../src/shared/props.js';

for (const held of [false, true]) test(`NPC cannot cross a scene gate (possessed=${held})`, () => {
  const w = new World({ seed: 81, secret: 'scene-regression' });
  w.rules.creatures.spawnMultiplier = 0; w.rules.events.pool = [];
  const a = w.enroll('Human', 'Ravenclaw').wizard, b = w.enroll('Vessel', 'Gryffindor').wizard;
  a.connections = b.connections = 1; b.npc = true;
  const gate = GATES.find(g => g.in === 'castle')!;
  b.pos = { ...gate.at }; w.moved(b);
  if (held) possessNpc(w, a.id, b.handle);
  SCENES_FEATURE.stepLate!(w, 0.05);
  expect(sceneAt(b.pos.x, b.pos.z)?.id).toBe('castle');
});

test('only actual grouped props advertise group rewards in look', () => {
  const w = new World({ seed: 82, secret: 'prop-hints' }), a = w.enroll('Reader', 'Ravenclaw').wizard;
  for (const p of PROPS.filter(p => ['rune', 'brazier', 'basin', 'crystal', 'lantern'].includes(p.kind))) {
    a.pos = { x: p.x, z: p.z }; w.moved(a);
    const entry = (w.look(a.id, 1) as { props?: { id: string; hint: string }[] }).props?.find(x => x.id === p.id);
    expect(entry, p.id).toBeDefined();
    expect(/奖励|pays/.test(entry!.hint), p.id).toBe(!!p.group);
  }
});

test('taking and releasing an NPC clears both bodies’ scene continuations', () => {
  const w = new World({ seed: 83, secret: 'possession-routes' });
  const a = w.enroll('Walker', 'Ravenclaw').wizard, b = w.enroll('Vessel', 'Gryffindor').wizard;
  a.connections = b.connections = 1; b.npc = true;
  const gate = GATES.find(g => g.in === 'castle')!;
  for (const body of [a, b]) {
    body.goal = { ...gate.at }; body.route = [{ ...gate.at }]; body.goalBy = 'agent';
    w.via.set(body.id, { to: { ...gate.out }, by: 'agent', gate });
  }
  possessNpc(w, a.id, b.handle);
  for (const body of [a, b]) {
    expect(body.goal).toBeNull(); expect(body.route).toEqual([]); expect(body.goalBy).toBeNull();
    expect(w.via.has(body.id)).toBe(false);
  }
  b.goal = { ...gate.at }; b.route = [{ ...gate.at }]; b.goalBy = 'agent';
  w.via.set(b.id, { to: { ...gate.out }, by: 'agent', gate });
  release(w, a.id);
  expect(b.goal).toBeNull(); expect(b.route).toEqual([]); expect(b.goalBy).toBeNull();
  expect(w.via.has(b.id)).toBe(false);
});
