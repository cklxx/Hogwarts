/**
 * look and cast agree (the 2026-10-01 playtest, again: "look and the cast disagree about where things are"): over 400
 * sampled spots round the castle, every creature look lists is said to be hittable, blocked or not yours to harm
 * exactly as a cast at it then finds. What changes between a look and the next cast is the world moving on.
 */
import { expect, it } from 'vitest';
import { World } from '../src/kernel/world.js';
import { mulberry32 } from '../src/shared/map.js';

it('look’s canHarm / blocked is what a cast at that creature finds, everywhere', () => {
  const w = new World({ seed: 5, secret: 'look' });
  w.rules.creatures.spawnMultiplier = 3; w.rules.events.pool = []; w.term.endsAt = 1e12;
  for (let i = 0; i < 400; i++) w.tick();
  const a = w.enroll('Look Cast', 'Ravenclaw' as never).wizard;
  a.connections = 1; a.createdAt = -1e6;
  const rnd = mulberry32(3);
  let n = 0;
  const off: string[] = [];
  for (let s = 0; s < 400 && n < 600; s++) {
    a.pos = { x: -60 + rnd() * 130, z: -70 + rnd() * 105 }; w.solids.resolve(a.pos, 0.5); w.moved(a);
    const look = w.look(a.id) as unknown as { creatures: { id: string; canHarm: boolean; blocked?: boolean }[] };
    for (const c of look.creatures) {
      a.cooldowns = {}; a.globalCd = 0; a.mana = 1e6;
      const r = w.cast(a.id, 'Stupefy', { target: c.id });
      n++;
      const said = !c.canHarm ? 'no' : c.blocked ? 'blocked' : 'ok';
      const got = r.ok ? 'ok' : /between you/.test(r.error ?? '') ? 'blocked' : /cannot harm/.test(r.error ?? '') ? 'no' : `other: ${r.error}`;
      if (said !== got) off.push(`${c.id} at (${a.pos.x.toFixed(1)}, ${a.pos.z.toFixed(1)}): look ${said}, cast ${got}`);
      w.projectiles.clear();
    }
  }
  expect(n).toBeGreaterThan(300);
  expect(off).toEqual([]);
});
