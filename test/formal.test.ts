/**
 * Ties the formal models to the running code.
 *  1. Conformance: vectors printed by formal/lean/Hogwarts.lean must match the TypeScript functions
 *     (including every agent-link constant and the stat floors of docs/AGENT_LINK.md §B.7/§B.8).
 *  2. The invariants model-checked in formal/tla/Hostility.tla are re-checked against the real
 *     World.canHarm on randomly generated worlds (so the model and the code cannot drift apart) —
 *     with jinx auras on the wizards, whose effects must obey World.jinxBites (canHarm(null, victim) and
 *     the PvP rules, implied by canHarm(sender, victim)), the tick cap and the hex floor.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  darkLordTakes, derived, derivedUncached, duelSteal, electMinister, focusAfter, hexDotHp, hexHpFloor, hexPrice, hexTickDmg, hpFloor, jointPct, moveSlow, stealAmount, stealPct,
  stealTier, stunPaysRep, vetoPasses, yearForXp,
} from '../src/kernel/progression.js';
import { strikes } from '../src/kernel/allies.js';
import { titleIndex } from '../src/lore/titles.js';
import { World } from '../src/kernel/world.js';
import { royaltyGrant, royaltyStep } from '../src/kernel/market.js';
import { cupAward, cupDeduct, cupMult, cupRun, type CupOp } from '../src/kernel/housecup.js';
import { DUEL_TERM_CAP, DUEL_WIN_REP, duelStep } from '../src/kernel/duelclub.js';
import { QD_CATCH_REP, QD_CUP_MAX, QD_GOALS_PAID, QD_GOAL_REP, QD_REP_MAX, QD_WIN_REP, qdCup, qdRep } from '../src/kernel/quidditch.js';
import { MEME } from '../src/lore/memes.js';
import { applyPatch, defaultRulebook } from '../src/kernel/rulebook.js';
import { mulberry32 } from '../src/shared/map.js';
import type { Creature, Item, Wizard } from '../src/kernel/types.js';
import * as K from '../src/shared/constants.js';
import type { CreatureKind } from '../src/shared/constants.js';

type AgentLinkVectors = {
  constants: Record<string, number>; negLimits: Record<string, number>; jinxDefaults: Record<string, [number, number]>;
  hpFloor: [number, number][]; maxHp: [number, number, number][]; maxMana: [number, number, number][];
  manaRegen: [number, number, number, number][]; speed: [number, number][]; power: [number, number][]; ward: [number, number][];
  moveSlow: [number, number, number][]; hexFloor: [number, number][]; hexDot: [number, number, number, number][]; hexCost: [number, number][];
  hexTick: [number, number, number][]; longestHex: number;
};
type UnfairVectors = {
  constants: Record<string, number>; stealTiers: [number, number][]; stealTier: [number, number, number][];
  stealPct: [number, number, number, number, number, number][]; darkLordTakes: [number, number, number][]; jointPct: [number, number][];
  vetoPasses: [number, number, number][]; focusAfter: [number, number, number, number, number][];
};
type MarketVectors = {
  constants: Record<string, number>; royaltyGrant: [number, number, number, number][];
  days: { cap: number; casts: [number, number, number, number, number][]; earned: number[]; given: [number, number, number, number][] }[];
};
type CupVectors = {
  constants: Record<string, number>; cupMult: [number, number, number, number][]; cupAward: [number, number, number, number, number][];
  cupDeduct: [number, number, number][]; terms: { cap: number; ops: [number, number, number][]; final: number }[];
};
type DuelVectors = {
  constants: Record<string, number>; step: [number, number, number, number, number][];
  terms: { cap: number; fresh: number[]; wins: number; rep: number }[];
};
const V = JSON.parse(readFileSync(new URL('../formal/vectors.json', import.meta.url), 'utf8')) as {
  yearForXp: [number, number][]; titleIndex: [number, number, number, number, number][]; steal: [number, number, number][];
  agentLink: AgentLinkVectors; unfair: UnfairVectors; market: MarketVectors; cup: CupVectors; duel: DuelVectors;
  quidditch: { constants: Record<string, number>; rep: [number, number, number, number][]; cup: [number, number][] };
  minister: [[number, number][], number, number][]; bully: { BULLY_YEAR_GAP: number; pays: [number, number, number][] };
};

describe('Lean conformance vectors: 魔法部长 (elect_never_npc, elect_top_player, elect_vacant) and 以大欺小 (stun_pays_*)', () => {
  it('electMinister picks what Lean picks, and never an NPC', () => {
    expect(V.minister.length).toBeGreaterThan(30);
    for (const [cs, bar, out] of V.minister) {
      const got = electMinister(cs.map(([r, n]) => ({ reputation: r, npc: n === 1 })), bar);
      expect([cs, bar, got]).toEqual([cs, bar, out]);
      if (got >= 0) expect(cs[got][1]).toBe(0); // the theorem, on the vector
    }
    expect(V.minister.some(([cs, , out]) => out >= 0 && cs.some(([r, n]) => n === 1 && r > cs[out][0]))).toBe(true); // an NPC out-ranked the Minister
  });
  it('stunPaysRep and BULLY_YEAR_GAP agree with Lean', () => {
    expect(V.bully.BULLY_YEAR_GAP).toBe(K.BULLY_YEAR_GAP);
    for (const [k, v, p] of V.bully.pays) expect([k, v, stunPaysRep(k, v) ? 1 : 0]).toEqual([k, v, p]);
  });
});

describe('Lean conformance vectors: 魁地奇 (qd_rep_bounded, qd_rep_mono, qd_cup_bounded, qd_cup_mono)', () => {
  it('the constants, qdRep and qdCup agree with Lean', () => {
    expect(V.quidditch.constants).toEqual({ QD_GOAL_REP, QD_GOALS_PAID, QD_CATCH_REP, QD_WIN_REP, QD_CUP_MAX, QD_REP_MAX });
    for (const [g, c, w, r] of V.quidditch.rep) {
      expect([g, c, w, qdRep(g, c === 1, w === 1)]).toEqual([g, c, w, r]);
      expect(r).toBeLessThanOrEqual(QD_REP_MAX);
    }
    for (const [sc, p] of V.quidditch.cup) { expect([sc, qdCup(sc)]).toEqual([sc, p]); expect(p).toBeLessThanOrEqual(QD_CUP_MAX); }
  });
});

describe('Lean conformance vectors: 决斗俱乐部 (duel_step_capped, duel_step_pay, duel_club_term_bounded)', () => {
  it('the constants, the step, and whole terms of matches agree with Lean', () => {
    expect(V.duel.constants).toEqual({ DUEL_WIN_REP, DUEL_TERM_CAP });
    for (const [w, c, f, w2, r] of V.duel.step) expect([w, c, f, ...duelStep(w, c, f === 1)]).toEqual([w, c, f, w2, r]);
    for (const t of V.duel.terms) {
      let wins = 0, rep = 0;
      for (const f of t.fresh) { const [w2, r] = duelStep(wins, t.cap, f === 1); wins = w2; rep += r; }
      expect({ wins, rep }).toEqual({ wins: t.wins, rep: t.rep });
      expect(rep).toBeLessThanOrEqual(t.cap * DUEL_WIN_REP); // the theorem, on the vector
    }
  });
});

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
      PLAYER_GRACE_S: K.PLAYER_GRACE_S,
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
  it('hex_tick_capped / hexes_leave_gaps', () => {
    for (const [r, s, v] of A.hexTick) expect([r, s, hexTickDmg(r, s)]).toEqual([r, s, v]);
    const longest = Math.max(K.SILENCE_MAX_S, ...Object.values(K.JINX_DEFAULTS).map((j) => j.seconds));
    expect(A.longestHex).toBe(longest);
    expect(K.VICTIM_HEX_PER_10MIN * longest).toBeLessThan(K.HEX_WINDOW_S);
  });
});

describe('Lean conformance vectors: 不公平，但好玩 (duel_steal_cap, duel_conserves_curve, dark_lord_no_flap, joint_bounded …)', () => {
  const U = V.unfair;
  it('every constant is the same number in Lean and in src/shared/constants.ts', () => {
    expect(U.constants).toEqual({
      STEAL_CAP_PCT: K.STEAL_CAP_PCT, STEAL_DARK_LORD_PCT: K.STEAL_DARK_LORD_PCT, STEAL_BASE_PCT: K.STEAL_BASE_PCT,
      DARK_LORD_MIN_REP: K.DARK_LORD_MIN_REP, DARK_LORD_SEEN_S: K.DARK_LORD_SEEN_S, DARK_LORD_HYSTERESIS_PCT: K.DARK_LORD_HYSTERESIS_PCT,
      DARK_LORD_POWER_PCT: K.DARK_LORD_POWER_PCT, DARK_LORD_BROADCAST_S: K.DARK_LORD_BROADCAST_S, DA_REP_CEILING: K.DA_REP_CEILING,
      DA_MAX_MEMBERS: K.DA_MAX_MEMBERS, DA_QUORUM: K.DA_QUORUM, DA_VETO_WINDOW_S: K.DA_VETO_WINDOW_S, DA_VETOES_PER_TERM: K.DA_VETOES_PER_TERM,
      DA_JOINT_MIN: K.DA_JOINT_MIN, DA_JOINT_WINDOW_S: K.DA_JOINT_WINDOW_S, DA_JOINT_PCT: K.DA_JOINT_PCT, STUDY_DELAY_S: K.STUDY_DELAY_S,
      STUDY_MEMORY_S: K.STUDY_MEMORY_S, STUDY_KEEP: K.STUDY_KEEP, STUDIED_KEEP: K.STUDIED_KEEP, LAWLESS_MULT: K.LAWLESS_MULT,
    });
    expect(U.stealTiers).toEqual(K.STEAL_TIERS.map((t) => [...t]));
  });
  it('stealTier / stealPct / duelSteal (the steal curve)', () => {
    for (const [r, d, t] of U.stealTier) expect([r, d, stealTier(r, d === 1)]).toEqual([r, d, t]);
    for (const [r, d, b, m, p, s] of U.stealPct) expect([r, d, b, m, stealPct(r, d === 1, b, m), duelSteal(r, d === 1, b, m)]).toEqual([r, d, b, m, p, s]);
    // and the proved shape, on the vectors themselves: ≤ 30 %, monotone in the victim's reputation, conserving
    for (const [r, d, b, m, , s] of U.stealPct) {
      expect(s * 100).toBeLessThanOrEqual(r * K.STEAL_CAP_PCT);
      const richer = U.stealPct.filter((x) => x[1] === d && x[2] === b && x[3] === m && x[0] >= r);
      for (const x of richer) expect(x[5]).toBeGreaterThanOrEqual(s);
      expect(stealAmount(r, stealPct(r, d === 1, b, m))).toBe(s);
    }
  });
  it('darkLordTakes / jointPct / vetoPasses / focusAfter', () => {
    for (const [h, c, t] of U.darkLordTakes) expect([h, c, darkLordTakes(h, c) ? 1 : 0]).toEqual([h, c, t]);
    for (const [n, p] of U.jointPct) expect([n, jointPct(n)]).toEqual([n, p]);
    for (const [n, v, p] of U.vetoPasses) expect([n, v, vetoPasses(n, v) ? 1 : 0]).toEqual([n, v, p]);
    for (const [p, m, r, d, f] of U.focusAfter) expect([p, m, r, d, focusAfter(p, m, r, d)]).toEqual([p, m, r, d, f]);
  });
});

describe('Lean conformance vectors: 咒语集市 royalties (royalty_day_capped, royalty_per_pair, royalty_not_self, royalty_npc)', () => {
  const M = V.market;
  it('every constant is the same number in Lean and in src/shared/constants.ts', () => {
    expect(M.constants).toEqual({
      MARKET_AUTHOR_TENTHS: K.MARKET_AUTHOR_TENTHS, MARKET_PARENT_TENTHS: K.MARKET_PARENT_TENTHS, MARKET_DAY_S: K.MARKET_DAY_S,
      MARKET_CAP_DEFAULT: K.MARKET_CAP_DEFAULT, MARKET_CAP_MAX: K.MARKET_CAP_MAX, MARKET_ANNOUNCE_S: K.MARKET_ANNOUNCE_S,
      MARKET_MAX_VERSIONS: K.MARKET_MAX_VERSIONS, MARKET_MAX_PER_AUTHOR: K.MARKET_MAX_PER_AUTHOR, MARKET_BAN_MAX: K.MARKET_BAN_MAX,
      MARKET_PROMOTE_MAX: K.MARKET_PROMOTE_MAX,
    });
    // the rulebook's defaults and bounds are the proved ones
    const rb = defaultRulebook();
    expect(rb.market.dailyCap).toBe(K.MARKET_CAP_DEFAULT);
    expect(applyPatch(rb, { market: { dailyCap: K.MARKET_CAP_MAX } }).ok).toBe(true);
    expect(applyPatch(rb, { market: { dailyCap: K.MARKET_CAP_MAX + 1 } }).ok).toBe(false);
  });
  it('royaltyGrant', () => { for (const [e, sh, c, g] of M.royaltyGrant) expect([e, sh, c, royaltyGrant(e, sh, c)]).toEqual([e, sh, c, g]); });
  it('whole days of casts replayed through royaltyStep give the same ledger', () => {
    expect(M.days.length).toBeGreaterThan(5);
    for (const day of M.days) {
      const L = { paid: {} as Record<string, number>, earned: {} as Record<string, number> };
      const pgiven = new Map<string, number>();
      for (const [s, c, a, p, npc] of day.casts) {
        const r = royaltyStep(L, { spell: `s${s}`, caster: `w${c}`, author: `w${a}`, parent: p < 0 ? null : `w${p}`, npc: npc === 1 }, day.cap);
        if (r.parent) pgiven.set(`${s}|${c}`, (pgiven.get(`${s}|${c}`) ?? 0) + r.parent);
      }
      expect(day.earned.map((_, i) => L.earned[`w${i}`] ?? 0)).toEqual(day.earned);
      const given: [number, number, number, number][] = [];
      for (let s = 0; s < 6; s++) for (let c = 0; c < 7; c++) {
        const g = L.paid[`s${s}|w${c}`] ?? 0, pg = pgiven.get(`${s}|${c}`) ?? 0;
        if (g + pg > 0) given.push([s, c, g, pg]);
      }
      expect(given).toEqual(day.given);
      // and the proved bounds, on the vectors themselves
      for (const e of day.earned) expect(e).toBeLessThanOrEqual(day.cap);
      for (const [, , g, pg] of day.given) { expect(g).toBeLessThanOrEqual(K.MARKET_AUTHOR_TENTHS); expect(pg).toBeLessThanOrEqual(K.MARKET_PARENT_TENTHS); }
    }
  });
});

describe('Lean conformance vectors: 学院杯 house points (cup_term_bounded, cup_award_capped, cup_deduct_nonneg, cup_mult_bounded)', () => {
  const C = V.cup;
  it('every constant is the same number in Lean and in src/shared/constants.ts', () => {
    expect(C.constants).toEqual({
      CUP_FINAL_S: K.CUP_FINAL_S, CUP_MULT_DEFAULT: K.CUP_MULT_DEFAULT, CUP_MULT_MAX: K.CUP_MULT_MAX, CUP_CAP_DEFAULT: K.CUP_CAP_DEFAULT,
      CUP_CAP_MIN: K.CUP_CAP_MIN, CUP_CAP_MAX: K.CUP_CAP_MAX, SNITCH_POINTS: K.SNITCH_POINTS, SNITCH_CAP_PER_TERM: K.SNITCH_CAP_PER_TERM,
      CURFEW_PENALTY: K.CURFEW_PENALTY, EVENT_MAX_S: K.EVENT_MAX_S, EVENT_INTERVAL_MIN: K.EVENT_INTERVAL_MIN, EVENT_INTERVAL_DEFAULT: K.EVENT_INTERVAL_DEFAULT,
      EVENT_INTERVAL_MAX: K.EVENT_INTERVAL_MAX, TEN_POINTS_CAP: MEME.HOUSE_POINTS_CAP,
    });
    // the rulebook's defaults and bounds are the proved ones
    const rb = defaultRulebook();
    expect(rb.terms.finalMinuteMultiplier).toBe(K.CUP_MULT_DEFAULT);
    expect(rb.terms.wizardPointsCap).toBe(K.CUP_CAP_DEFAULT);
    expect(rb.events.intervalSeconds).toBe(K.EVENT_INTERVAL_DEFAULT);
    expect(applyPatch(rb, { terms: { finalMinuteMultiplier: K.CUP_MULT_MAX } }).ok).toBe(true);
    expect(applyPatch(rb, { terms: { finalMinuteMultiplier: K.CUP_MULT_MAX + 0.01 } }).ok).toBe(false);
    expect(applyPatch(rb, { terms: { wizardPointsCap: K.CUP_CAP_MIN - 1 } }).ok).toBe(false);
    expect(applyPatch(rb, { terms: { wizardPointsCap: K.CUP_CAP_MAX } }).ok).toBe(true);
  });
  it('cupMult / cupAward / cupDeduct', () => {
    for (const [l, f, m, v] of C.cupMult) expect([l, f, m, cupMult(l, f, m)]).toEqual([l, f, m, v]);
    for (const [c, n, cap, m, v] of C.cupAward) expect([c, n, cap, m, cupAward(c, n, cap, m)]).toEqual([c, n, cap, m, v]);
    for (const [c, n, v] of C.cupDeduct) expect([c, n, cupDeduct(c, n)]).toEqual([c, n, v]);
  });
  it('whole terms replayed through cupRun give the same ledger, within [0, cap]', () => {
    expect(C.terms.length).toBeGreaterThanOrEqual(4);
    for (const t of C.terms) {
      const ops: CupOp[] = t.ops.map(([k, n, m]) => (k === 1 ? { k: 'deduct', n } : { k: 'award', n, m }));
      expect(cupRun(ops, t.cap)).toBe(t.final);
      expect(t.final).toBeGreaterThanOrEqual(0);
      expect(t.final).toBeLessThanOrEqual(t.cap);
    }
  });
});

describe('Hostility.tla invariants hold for World.canHarm', () => {
  it('on 3000 random worlds', () => {
    const rnd = mulberry32(2024);
    const rj = mulberry32(88); // jinxes draw from their own stream, so the worlds above are the ones they always were
    const rd = mulberry32(3141); // and duels from theirs
    const rs = mulberry32(2718); // and the NPC flag of the strikes check from its own
    const seen = { bit: 0, spared: 0, senderElsewhere: 0, capped: 0, duels: 0, strays: 0 }; // each branch below must actually be exercised
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
      // jinx auras from the other wizard (or from nobody), random health, sometimes a Langlock, a shield, or
      // a cursed ward (−20%) that would amplify damage if nothing capped a jinx tick
      for (const x of [a, b]) {
        const other = x === a ? b.id : a.id;
        for (const k of ['jelly', 'dance', 'boils', 'bats'] as const) if (rj() < 0.4) w.applyAura(x.id, k, 10, K.JINX_DEFAULTS[k].mag, rj() < 0.8 ? other : null);
        if (rj() < 0.3) { x.st.silencedUntil = w.now + 3; x.st.silenceBy = 'langlock'; x.st.silenceSrc = rj() < 0.8 ? other : null; }
        if (rj() < 0.15) { x.st.shield = 5; x.st.shieldUntil = w.now + 3; }
        if (rj() < 0.3) { x.items = [{ id: 'curse', name: 'Cursed Robe', slot: 'robe', mods: { ward: -20 }, forgedBy: other, forgedByName: 'x', createdAt: 0, cursed: true }]; x.equipped = { robe: 'curse' }; }
        x.hp = 1 + Math.floor(rj() * derived(x, w.rules).maxHp);
      }
      const ids = [a.id, b.id, 'sa', 'sb', 'pixie', 'unicorn', 'phoenix'];
      const owner: Record<string, string> = { sa: a.id, sb: b.id };
      const safe = (id: string) => w.inSafe(w.entity(id)!.pos);
      // 决斗俱乐部: sometimes a and b are fighting a match (only ever while PvP is on: duelClosed)
      const duel = w.rules.combat.pvp && rd() < 0.35;
      if (duel) w.duel.match = { id: 1, a: a.id, b: b.id, phase: 'fight', at: 0, npc: false, stats: {} };
      if (duel) {
        const inPlay = (x: Wizard) => x.hp > 0 && !x.st.stunnedUntil && !safe(x.id);
        if (inPlay(a) && inPlay(b)) { expect(w.canHarm(a.id, b.id)).toBe(true); expect(w.canHarm(b.id, a.id)).toBe(true); } // DuelMutual
        for (const c of ['pixie', 'unicorn', 'phoenix']) for (const e of [a.id, b.id, 'sa', 'sb']) { expect(w.canHarm(c, e)).toBe(false); expect(w.canHarm(e, c)).toBe(false); } // DuelIsolated
        seen.duels++;
      }
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
      // 误伤 (Hostility.tla Allied / Strikes, allies.ts): a spell meant for t strikes e iff canHarm, and e is t, or it is a
      // straight shot, or e is no ally of the caster — and, beyond the model, an NPC's spell passes players by
      const behindOf = (id: string) => owner[id] ?? (id === a.id || id === b.id ? id : null);
      const alliedM = (x: string, y: string) => {
        const bx = behindOf(x), by = behindOf(y);
        if (!bx || !by) return false;
        const hx = w.wizards.get(bx)!.house, hy = w.wizards.get(by)!.house;
        return hx === hy && !(duel && bx !== by);
      };
      const npcB = rs() < 0.3;
      b.npc = npcB;
      for (const s of ids) for (const t of [null, ...ids]) for (const e of ids) {
        const bs = behindOf(s), be = behindOf(e);
        const spares = npcB && bs === b.id && be === a.id && !duel;
        const want = w.canHarm(s, e) && (!t || t === e || !(alliedM(s, e) || spares));
        expect(strikes(w, s, t, e)).toBe(want);
        if (!w.rules.combat.friendlyFire && !spares) expect(strikes(w, s, t, e)).toBe(w.canHarm(s, e)); // FriendlyFireOffUnchanged
        if (alliedM(s, e) && t !== e && t !== null) { expect(strikes(w, s, t, e)).toBe(false); seen.strays++; } // NoAllyStray
      }
      b.npc = false;
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
      // HexDotObeysHostility + hex_dot_floor + hex_tick_capped. A jinx acts exactly when jinxBites(src, victim)
      // says so: canHarm(null, victim) (in play, not in a safe zone) and the PvP rules between sender and
      // victim, wherever the sender stands. So canHarm(src, victim) ⇒ jinxBites, and !jinxBites ⇒ nothing
      // (Jelly-Legs, Tarantallegra and the silence ask the same relation). When it bites, a victim above the
      // floor and without a shield always loses health; never more than the tick's rate, never below
      // max(1, 25% max health), and it never counts as being hurt.
      for (const x of [a, b]) {
        // (in a Duelling-Club match only the opponent's jinxes and silences act on a duelist, whatever the houses)
        const opp = duel ? (x === a ? b.id : a.id) : undefined;
        const pvpOk = (src: string | null) => { const s = src ? w.wizards.get(src) : undefined; if (opp !== undefined) return !s || s.id === opp; return !s || (s !== x && w.rules.combat.pvp && (s.house !== x.house || w.rules.combat.friendlyFire)); };
        for (const au of x.auras) {
          const bites = w.jinxBites(au.src, x.id);
          expect(bites).toBe(w.canHarm(null, x.id) && pvpOk(au.src));
          if (au.src && w.canHarm(au.src, x.id)) expect(bites).toBe(true);
        }
        if (x.st.silencedUntil > w.now) expect(w.silenced(x)).toBe(!safe(x.id) && pvpOk(x.st.silenceSrc ?? null));
        for (const au of x.auras.filter((q) => q.k === 'boils' || q.k === 'bats')) {
          const before = x.hp, hurtAt = x.hurtAt, by = x.lastHurtBy, bites = w.jinxBites(au.src, x.id), wasStunned = x.st.stunnedUntil;
          const floor = hexHpFloor(derived(x, w.rules).maxHp), shielded = x.st.shieldUntil > w.now && x.st.shield > 0;
          const rate = au.mag * 0.35;
          const dealt = w.damage(au.src, x.id, rate, 'arcane', ['hex'], { dot: true, hex: true });
          if (!bites) { expect(dealt).toBe(0); expect(x.hp).toBe(before); seen.spared++; }
          if (bites && before > floor && !shielded) { expect(dealt).toBeGreaterThan(0); expect(x.hp).toBeLessThan(before); seen.bit++; }
          if (bites && au.src && !w.canHarm(au.src, x.id)) seen.senderElsewhere++; // the sender in a safe zone: still bites
          if (bites && !shielded && before - rate > floor && derived(x, w.rules).ward < 0) { expect(dealt).toBeCloseTo(rate, 9); seen.capped++; }
          expect(dealt).toBeLessThanOrEqual(rate + 1e-9);
          expect(before - x.hp).toBeLessThanOrEqual(rate + 1e-9);
          expect(x.hp).toBeGreaterThanOrEqual(Math.min(before, floor));
          expect(x.hp).toBeGreaterThan(0);
          expect(x.st.stunnedUntil).toBe(wasStunned); // a jinx never knocks anyone out
          expect([x.hurtAt, x.lastHurtBy]).toEqual([hurtAt, by]);
        }
      }
      void sa; void sb;
    }
    expect(Math.min(seen.bit, seen.spared, seen.senderElsewhere, seen.capped, seen.duels, seen.strays)).toBeGreaterThan(20);
  }, 90_000); // heavy: ~5–7 s on an idle box, several times that under a loaded CI runner
});

