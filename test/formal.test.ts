/**
 * Ties the formal models to the running code.
 *  1. Conformance: vectors printed by formal/lean/Hogwarts.lean must match the TypeScript functions.
 *  2. The invariants model-checked in formal/tla/Hostility.tla are re-checked against the real
 *     World.canHarm on randomly generated worlds (so the model and the code cannot drift apart).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stealAmount, yearForXp } from '../src/kernel/progression.js';
import { titleIndex } from '../src/lore/titles.js';
import { World } from '../src/kernel/world.js';
import { mulberry32 } from '../src/shared/map.js';
import type { Creature, Wizard } from '../src/kernel/types.js';
import type { CreatureKind } from '../src/shared/constants.js';

const V = JSON.parse(readFileSync(new URL('../formal/vectors.json', import.meta.url), 'utf8')) as {
  yearForXp: [number, number][]; titleIndex: [number, number, number, number, number][]; steal: [number, number, number][];
};

describe('Lean conformance vectors', () => {
  it('yearForXp', () => { for (const [xp, y] of V.yearForXp) expect([xp, yearForXp(xp)]).toEqual([xp, y]); });
  it('titleIndex', () => {
    for (const [year, xp, seals, m, t] of V.titleIndex) expect([year, xp, seals, m, titleIndex({ year, xp, seals, wasMinister: m === 1 })]).toEqual([year, xp, seals, m, t]);
  });
  it('steal', () => { for (const [v, p, s] of V.steal) expect([v, p, stealAmount(v, p)]).toEqual([v, p, s]); });
});

describe('Hostility.tla invariants hold for World.canHarm', () => {
  it('on 3000 random worlds', () => {
    const rnd = mulberry32(2024);
    const SAFE = { x: 0, z: -56 }; // the Great Hall
    for (let trial = 0; trial < 3000; trial++) {
      const w = new World({ seed: trial, secret: 'x' });
      w.rules.creatures.spawnMultiplier = 0;
      w.rules.combat.pvp = rnd() < 0.7;
      w.rules.combat.friendlyFire = rnd() < 0.5;
      const mkW = (name: string): Wizard => {
        const x = w.enroll(name, rnd() < 0.5 ? 'gryffindor' : 'slytherin').wizard;
        x.connections = 1;
        x.pos = rnd() < 0.2 ? { ...SAFE } : { x: 60 + rnd() * 5, z: 60 };
        if (rnd() < 0.2) x.st.stunnedUntil = 1;
        return x;
      };
      const a = mkW('Aa'), b = mkW('Bb');
      const mkC = (id: string, kind: CreatureKind, owner: string | null): Creature => {
        const c: Creature = { id, kind, pos: rnd() < 0.2 ? { ...SAFE } : { x: 62, z: 61 }, home: { x: 62, z: 61 }, hp: rnd() < 0.1 ? 0 : 50, maxHp: 50, facing: 0, target: null, attackCd: 9, rootedUntil: 0, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner, until: owner ? 99 : 0 };
        w.creatures.set(id, c);
        return c;
      };
      const sa = mkC('sa', 'serpent', a.id), sb = mkC('sb', 'birds', b.id);
      mkC('pixie', 'pixie', null); mkC('unicorn', 'unicorn', null); mkC('phoenix', 'phoenix', null);
      const ids = [a.id, b.id, 'sa', 'sb', 'pixie', 'unicorn', 'phoenix'];
      const owner: Record<string, string> = { sa: a.id, sb: b.id };
      const safe = (id: string) => w.inSafe(w.entity(id)!.pos);
      for (const s of ids) {
        expect(w.canHarm(s, s)).toBe(false); // NoSelfHarm
        for (const d of ids) {
          const can = w.canHarm(s, d);
          if (safe(d)) expect(can).toBe(false); // SafeZonesAreSafe
          if (['unicorn', 'phoenix'].includes(s)) expect(can).toBe(false); // BenignNeverAttack
          if (d === 'phoenix') expect(can).toBe(false); // PhoenixUntouchable
          const dw = w.wizards.get(d);
          if (dw && dw.st.stunnedUntil) expect(can).toBe(false); // StunnedUntouchable
          if (s === 'pixie' && can) expect([a.id, b.id, 'sa', 'sb']).toContain(d); // WildOnlyHunts...
          if (!w.rules.combat.pvp && [a.id, b.id].includes(s) && [a.id, b.id].includes(d)) expect(can).toBe(false); // NoPvP
        }
      }
      expect(w.canHarm('sa', a.id)).toBe(false); // SummonLoyal
      expect(w.canHarm('sb', b.id)).toBe(false);
      for (const [s, o] of Object.entries(owner)) {
        for (const d of ids) {
          if (d === o || (owner[d] && owner[d] === o) || d === s) continue;
          const dw = w.wizards.get(d);
          const expected = w.entity(d)!.hp > 0 && !safe(d) && d !== 'phoenix' && !(dw && dw.st.stunnedUntil) && w.canHarm(o, d);
          expect(w.canHarm(s, d)).toBe(expected); // SummonProxy
        }
      }
      void sa; void sb;
    }
  });
});
