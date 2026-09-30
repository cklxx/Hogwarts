/** 飞路网 and brooms (src/kernel/travel.ts). */
import { describe, expect, it } from 'vitest';
import { broom, floo, flooStatus } from '../src/kernel/travel.js';
import { walkableAt } from '../src/kernel/pathfind.js';
import { STATIC_SOLIDS } from '../src/kernel/physics.js';
import { BROOM_MULT, FIREPLACES, FLOO_CD_S, FLOO_HURT_S, fireplaceNear } from '../src/shared/travel.js';
import { ZONES, inZone } from '../src/shared/map.js';
import { World } from '../src/kernel/world.js';
import type { Wizard } from '../src/kernel/types.js';

function mk() {
  const w = new World({ seed: 8, secret: 'travel' });
  w.rules.creatures.spawnMultiplier = 0;
  return w;
}
function wiz(w: World, name: string): Wizard {
  const a = w.enroll(name, 'Hufflepuff' as never).wizard;
  a.connections = 1;
  a.createdAt = -1e6;
  return a;
}
const run = (w: World, s: number, each?: () => void) => { for (let i = 0; i < Math.round(s * 20); i++) { each?.(); w.tick(); } };

describe('the Floo Network', () => {
  it('every fireplace stands on open, walkable ground, outside any safe-zone trap, and none is a copy of another', () => {
    expect(new Set(FIREPLACES.map((f) => f.id)).size).toBe(FIREPLACES.length);
    for (const f of FIREPLACES) {
      expect(walkableAt(f, STATIC_SOLIDS), f.id).toBe(true);
      const p = { x: f.x, z: f.z };
      STATIC_SOLIDS.resolve(p, 0.5, true);
      expect(Math.hypot(p.x - f.x, p.z - f.z), `${f.id} is inside a collider`).toBeLessThan(0.01);
      expect(inZone(ZONES.find((z) => z.id === 'azkaban')!, f.x, f.z), f.id).toBe(false);
    }
  });

  it('takes you from one fireplace to another; not away from a fire, not twice within the cooldown, not while hurt', () => {
    const w = mk();
    const a = wiz(w, 'Cedric');
    a.pos = { x: 40, z: 40 };
    expect(() => floo(w, a.id, 'hogsmeade')).toThrow(/not at a fireplace|不在壁炉/);
    const [from, to] = [FIREPLACES[0], FIREPLACES.find((f) => f.id === 'hogsmeade')!];
    a.pos = { x: from.x + 1, z: from.z };
    expect(flooStatus(w, a.id).here).toBe(from.id);
    expect(floo(w, a.id, 'hogsmeade')).toMatchObject({ from: from.id, to: 'hogsmeade' });
    expect(fireplaceNear(a.pos)?.id).toBe(to.id);
    expect(() => floo(w, a.id, from.id)).toThrow(/settled|落定/);
    w.now += FLOO_CD_S + 1;
    a.hurtAt = w.now - 1;
    expect(() => floo(w, a.id, from.id)).toThrow(/hurt|受了伤/);
    w.now += FLOO_HURT_S;
    floo(w, a.id, from.id);
    expect(fireplaceNear(a.pos)?.id).toBe(from.id);
  });
});

describe('brooms', () => {
  it('flies you faster outside, and puts you on your feet when you cast, get hurt or go indoors', () => {
    const w = mk();
    const a = wiz(w, 'Oliver');
    a.pos = { x: 60, z: 40 };
    const walk = (): number => { const x0 = a.pos.x; w.setInput(a.id, 1, 0); run(w, 1); w.setInput(a.id, 0, 0); return a.pos.x - x0; };
    const onFoot = walk();
    a.pos = { x: 60, z: 40 };
    broom(w, a.id, true);
    const riding = walk();
    expect(riding / onFoot).toBeGreaterThan(BROOM_MULT * 0.9);
    expect((w.snapshot() as { tr?: string[] }).tr).toEqual([a.handle]);
    w.cast(a.id, a.spells[0].id, {});
    expect(w.travel.riding.has(a.id)).toBe(false);
    w.now += 10;
    broom(w, a.id, true);
    a.hurtAt = w.now + 0.01;
    run(w, 0.1);
    expect(w.travel.riding.has(a.id)).toBe(false);
    a.pos = { x: 0, z: -30 };
    expect(() => broom(w, a.id, true)).toThrow(/precinct|城堡范围/);
  });
});

describe('the Floo Network in the browser', () => {
  it('offers every other fireplace from the one you stand at, nearest first, and nothing away from a fire', async () => {
    const { flooChoices } = await import('../client/panels/travel.js');
    expect(flooChoices({ x: 500, z: 500 })).toBeNull();
    const c = flooChoices(FIREPLACES[0])!;
    expect(c.at.id).toBe(FIREPLACES[0].id);
    expect(c.to).toHaveLength(FIREPLACES.length - 1);
    expect(c.to.map((f) => f.dist)).toEqual([...c.to.map((f) => f.dist)].sort((a, b) => a - b));
  });
});
