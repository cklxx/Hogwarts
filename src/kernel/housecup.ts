import { CUP_MULT_MAX, CUP_SOURCES, type CupSource } from '../shared/constants.js';

/**
 * 学院杯 — the house-point ledger (README 学院杯). Every house point a wizard earns this term, from any source
 * (creatures, duels, events, O.W.L.s, chests, achievements, royalties), goes through cupAward: it is multiplied in
 * the final minute (cupMult, bounded by CUP_MULT_MAX), and a wizard's total for the term never exceeds the cap
 * (rules.terms.wizardPointsCap) and never goes below zero (cupDeduct). A house's points are the sum of its members'
 * ledgers plus the 十分梗 bonus (flags.housePoints, itself capped per house). Mirrored in formal/lean/Hogwarts.lean
 * (`cupMult`, `cupAward`, `cupDeduct`, `cupStep`, `cupRun`: cup_award_capped, cup_award_mono, cup_deduct_nonneg,
 * cup_mult_bounded, cup_term_bounded) and replayed from the vectors in test/formal.test.ts.
 */

export interface CupLedger {
  /** The term these points belong to (a ledger from an older term counts as empty). */
  term: number;
  /** Points added to the House Cup this term: 0 ≤ pts ≤ cap. */
  pts: number;
  /** What they came from (after the multiplier and the cap). */
  src: Partial<Record<CupSource, number>>;
  /** 金色飞贼: snitch points taken this term (≤ SNITCH_CAP_PER_TERM). */
  snitch?: number;
  /** Points lost to Filch this term (shown in the breakdown). */
  lost?: number;
}

export const blankLedger = (term: number): CupLedger => ({ term, pts: 0, src: {} });

/** The multiplier on a point gained with `left` seconds of the term to go: `mult` (clamped to [1, CUP_MULT_MAX]) in the last `finalS` seconds, else 1. */
export function cupMult(left: number, finalS: number, mult: number): number {
  if (!(left <= finalS)) return 1;
  return Math.min(CUP_MULT_MAX, Math.max(1, mult));
}

/**
 * Add n points (n ≤ 0 adds nothing) at multiplier m under the cap: never above the cap, never below where it was
 * (a ledger already over a cap a decree just lowered keeps what it has and gains nothing).
 */
export function cupAward(cur: number, n: number, cap: number, m: number): number {
  if (!(n > 0) || cur >= cap) return cur;
  return Math.min(cap, cur + n * m);
}

/** Take n points away (Filch): never below zero. */
export function cupDeduct(cur: number, n: number): number {
  return Math.max(0, cur - Math.max(0, n));
}

/** One operation on a ledger: an award at multiplier m, or a deduction. */
export type CupOp = { k: 'award'; n: number; m: number } | { k: 'deduct'; n: number };
export function cupStep(cur: number, op: CupOp, cap: number): number {
  return op.k === 'award' ? cupAward(cur, op.n, cap, op.m) : cupDeduct(cur, op.n);
}

/** A whole term of operations from an empty ledger (the Lean `cupRun`). */
export function cupRun(ops: CupOp[], cap: number): number {
  return ops.reduce((c, op) => cupStep(c, op, cap), 0);
}

/**
 * The term's MVP (and the best at one source): most points, then whoever enrolled first, then the registry id —
 * a total order, so the same term always crowns the same wizard.
 */
export interface CupEntry { id: string; name: string; house: string; handle: string; pts: number; createdAt: number }
export function rankEntries(xs: CupEntry[]): CupEntry[] {
  return [...xs].sort((a, b) => b.pts - a.pts || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
export function termBest(xs: CupEntry[]): CupEntry | null {
  const r = rankEntries(xs.filter((x) => x.pts > 0));
  return r[0] ?? null;
}

export const isCupSource = (s: string): s is CupSource => (CUP_SOURCES as readonly string[]).includes(s);
