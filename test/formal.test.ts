/**
 * Ties the formal models to the running code.
 *  1. Conformance: vectors printed by formal/lean/Hogwarts.lean must match the TypeScript functions
 *     (including every agent-link constant and the stat floors of docs/AGENT_LINK.md §B.7/§B.8).
 *  2. The invariants model-checked in formal/tla/Hostility.tla are re-checked against the real
 *     World.canHarm on randomly generated worlds (so the model and the code cannot drift apart) —
 *     with jinx auras on the wizards, whose damage must obey the same relation and the hex floor.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { derived, derivedUncached, hexDotHp, hexHpFloor, hexPrice, hpFloor, moveSlow, stealAmount, yearForXp } from '../src/kernel/progression.js';
import { titleIndex } from '../src/lore/titles.js';
import { World } from '../src/kernel/world.js';
import { mulberry32 } from '../src/shared/map.js';
import type { Creature, Item, Wizard } from '../src/kernel/types.js';
import * as K from '../src/shared/constants.js';
import type { CreatureKind } from '../src/shared/constants.js';

type AgentLinkVectors = {
  constants: Record<string, number>; negLimits: Record<string, number>; jinxDefaults: Record<string, [number, number]>;
  hpFloor: [number, number][]; maxHp: [number, number, number][]; maxMana: [number, number, number][];
  manaRegen: [number, number, number, number][]; speed: [number, number][]; power: [number, number][]; ward: [number, number][];
  moveSlow: [number, number, number][]; hexFloor: [number, number][]; hexDot: [number, number, number, number][]; hexCost: [number, number][];
};
const V = JSON.parse(readFileSync(new URL('../formal/vectors.json', import.meta.url), 'utf8')) as {
  yearForXp: [number, number][]; titleIndex: [number, number, number, number, number][]; steal: [number, number, number][];
  agentLink: AgentLinkVectors;
};

describe('Lean conformance vectors', () => {
  it('yearForXp', () => { for (const [xp, y] of V.yearForXp) expect([xp, yearForXp(xp)]).toEqual([xp, y]); });
  it('titleIndex', () => {
    for (const [year, xp, seals, m, t] of V.titleIndex) expect([year, xp, seals, m, titleIndex({ year, xp, seals, wasMinister: m === 1 })]).toEqual([year, xp, seals, m, t]);
  });
  it('steal', () => { for (const [v, p, s] of V.steal) expect([v, p, stealAmount(v, p)]).toEqual([v, p, s]); });
});

describe('Lean conformance vectors: the agent link (docs/AGENT_LINK.md §A.5, §B.8)', () => {
  const A = V.agentLink;
  const pct = (x: number) => Math.round(x * 100);
  it('every shared constant is the same number in Lean and in src/shared/constants.ts', () => {
    expect(A.constants.PAIR_SPACE).toBe(K.PAIR_ALPHABET.length ** K.PAIR_LEN);
    expect(A.constants).toEqual({
      PAIR_ALPHABET_LEN: K.PAIR_ALPHABET.length, PAIR_LEN: K.PAIR_LEN, PAIR_SPACE: K.PAIR_SPACE, PAIR_TTL_S: K.PAIR_TTL_S,
      PAIR_FAIL_PER_IP_PER_MIN: K.PAIR_FAIL_PER_IP_PER_MIN, PAIR_FAIL_PER_REALM_PER_MIN: K.PAIR_FAIL_PER_REALM_PER_MIN,
      LOGIN_FAIL_PER_IP_PER_MIN: K.LOGIN_FAIL_PER_IP_PER_MIN, HP_FLOOR: K.HP_FLOOR, HP_FLOOR_PCT: pct(K.HP_FLOOR_FRAC),
      MANA_FLOOR: K.MANA_FLOOR, MANA_FLOOR_PCT: pct(K.MANA_FLOOR_FRAC), MANAREGEN_FLOOR_PCT: pct(K.MANAREGEN_FLOOR_FRAC),
      SPEED_FLOOR_PCT: pct(K.SPEED_FLOOR), MOVE_SLOW_FLOOR_PCT: pct(K.MOVE_SLOW_FLOOR), POWER_FLOOR_PCT: pct(K.POWER_FLOOR),
      WARD_MIN_PCT: pct(K.WARD_MIN), WARD_MAX_PCT: pct(K.WARD_MAX), HEX_HP_FLOOR_PCT: pct(K.HEX_HP_FLOOR_FRAC), HEX_MALICE_TAX: K.HEX_MALICE_TAX,
      CURSED_ITEM_BIND_S: K.CURSED_ITEM_BIND_S, HEX_MIN_YEAR: K.HEX_MIN_YEAR, HEX_PAIR_COOLDOWN_S: K.HEX_PAIR_COOLDOWN_S,
      VICTIM_HEX_CAP: K.VICTIM_HEX_CAP, VICTIM_CURSED_ITEMS_MAX: K.VICTIM_CURSED_ITEMS_MAX, VICTIM_BOUND_CAP: K.VICTIM_BOUND_CAP,
      VICTIM_HEX_PER_10MIN: K.VICTIM_HEX_PER_10MIN, HEX_WINDOW_S: K.HEX_WINDOW_S, HEX_RESPITE_S: K.HEX_RESPITE_S,
      SILENCE_MAX_S: K.SILENCE_MAX_S, SILENCE_COOLDOWN_S: K.SILENCE_COOLDOWN_S, FORGE_FAIL_PER_MIN: K.FORGE_FAIL_PER_MIN,
      OWLBOX_MAX: K.OWLBOX_MAX, OWL_MAX_CHARS: K.OWL_MAX_CHARS, OWL_PER_MIN: K.OWL_PER_MIN, ASK_TTL_S: K.ASK_TTL_S, LISTEN_MAX_S: K.LISTEN_MAX_S,
    });
    expect(A.negLimits).toEqual(K.NEG_LIMITS);
    expect(A.jinxDefaults).toEqual(Object.fromEntries(Object.entries(K.JINX_DEFAULTS).map(([k, v]) => [k, [Math.round(v.mag * 10), v.seconds]])));
  });

  /** A wizard wearing exactly one item with these enchantments, in a world with these rules. */
  const wearing = (mods: Item['mods'], opts: { year?: number; core?: string; base?: number; regen?: number } = {}) => {
    const w = new World({ seed: 1, secret: 'x' });
    const x = w.enroll('Vector').wizard;
    x.year = opts.year ?? 1;
    x.wand = { ...x.wand, core: opts.core ?? 'Unicorn hair' };
    x.items = [{ id: 'v', name: 'v', slot: 'amulet', mods, forgedBy: 'x', forgedByName: 'x', createdAt: 0 }];
    x.equipped = { amulet: 'v' };
    if (opts.base !== undefined) w.rules.magic.baseMaxMana = opts.base;
    if (opts.regen !== undefined) w.rules.magic.manaRegen = opts.regen;
    const d = derivedUncached(x, w.rules);
    expect(derived(x, w.rules)).toEqual(d);
    return d;
  };
  it('hp_floor / mana_floor / manaregen_floor: derivedUncached', () => {
    for (const [y, f] of A.hpFloor) expect([y, hpFloor(y)]).toEqual([y, f]);
    for (const [y, m, v] of A.maxHp) expect([y, m, wearing({ maxHp: m }, { year: y }).maxHp]).toEqual([y, m, v]);
    for (const [b, m, v] of A.maxMana) expect([b, m, wearing({ maxMana: m }, { base: b }).maxMana]).toEqual([b, m, v]);
    for (const [r, m, c, v] of A.manaRegen) {
      const d = wearing({ manaRegen: m / 10 }, { regen: r / 10, core: c ? 'Phoenix feather' : 'Unicorn hair' });
      expect([r, m, c, Math.round(d.manaRegen * 10)]).toEqual([r, m, c, v]);
    }
  });
  it('speed_floor / power_pos / ward_bounded / move_floor', () => {
    for (const [m, v] of A.speed) expect([m, pct(wearing({ speed: m }).speedMult)]).toEqual([m, v]);
    for (const [p, v] of A.power) expect([p, pct(wearing({ power: p - (p === 8 ? 8 : 0) }, p === 8 ? { core: 'Dragon heartstring' } : {}).power)]).toEqual([p, v]);
    for (const [x, v] of A.ward) expect([x, pct(wearing({ ward: x }).ward)]).toEqual([x, v]);
    for (const [c, j, v] of A.moveSlow) expect([c, j, pct(moveSlow(c / 100, j / 100))]).toEqual([c, j, v]);
  });
  it('hex_dot_floor / hex_cost_pos', () => {
    for (const [mh, f] of A.hexFloor) expect([mh, hexHpFloor(mh)]).toEqual([mh, f]);
    for (const [hp, mh, d, v] of A.hexDot) expect([hp, mh, d, hexDotHp(hp, mh, d)]).toEqual([hp, mh, d, v]);
    for (const [p, c] of A.hexCost) expect([p, hexPrice(p)]).toEqual([p, c]);
  });
});

describe('Hostility.tla invariants hold for World.canHarm', () => {
  it('on 3000 random worlds', () => {
    const rnd = mulberry32(2024);
    const rj = mulberry32(88); // jinxes draw from their own stream, so the worlds above are the ones they always were
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
      // jinx auras from the other wizard (or from nobody), random health, sometimes a Langlock
      for (const x of [a, b]) {
        for (const k of ['jelly', 'dance', 'boils', 'bats'] as const) if (rj() < 0.4) w.applyAura(x.id, k, 10, K.JINX_DEFAULTS[k].mag, rj() < 0.8 ? (x === a ? b.id : a.id) : null);
        if (rj() < 0.3) { x.st.silencedUntil = w.now + 3; x.st.silenceBy = 'langlock'; }
        x.hp = 1 + Math.floor(rj() * derived(x, w.rules).maxHp);
      }
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
      // HexDotObeysHostility + hex_dot_floor: a jinx tick hurts exactly when canHarm(src, victim) says so,
      // never below max(1, 25% max health), and never counts as being hurt
      for (const x of [a, b]) {
        for (const au of x.auras.filter((q) => q.k === 'boils' || q.k === 'bats')) {
          const before = x.hp, hurtAt = x.hurtAt, by = x.lastHurtBy, can = w.canHarm(au.src, x.id), wasStunned = x.st.stunnedUntil;
          const dealt = w.damage(au.src, x.id, au.mag * 7, 'arcane', ['hex'], { dot: true, hex: true });
          if (!can) { expect(dealt).toBe(0); expect(x.hp).toBe(before); }
          expect(x.hp).toBeGreaterThanOrEqual(Math.min(before, hexHpFloor(derived(x, w.rules).maxHp)));
          expect(x.hp).toBeGreaterThan(0);
          expect(x.st.stunnedUntil).toBe(wasStunned); // a jinx never knocks anyone out
          expect([x.hurtAt, x.lastHurtBy]).toEqual([hurtAt, by]);
        }
      }
      void sa; void sb;
    }
  });
});

