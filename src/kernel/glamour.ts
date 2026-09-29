import {
  GLAMOUR_MATERIALS, GLAMOUR_MAX_ARGS, GLAMOUR_PARTS, GLAMOUR_PRANK_DEFAULT_S, GLAMOUR_PRANK_MIN_S, GLAMOUR_PRANK_YEAR, MATERIAL_DEFS,
  colourFromText, forbiddenLook, glamourKey, overlayGlamour, type Glamour, type GlamourMaterial, type GlamourPart,
} from '../shared/glamour.js';
import { type Value, isRef } from '../runes/interp.js';
import { type Node, RuneError } from '../runes/parser.js';
import type { Wizard } from './types.js';

/**
 * Transfiguration of self (变形术) — the kernel half of the `glamour` effect. The Runes program hands over
 * its evaluated words (keywords arrive as strings); readGlamour validates and clamps every one of them
 * (the checker already refused bad literals at forge time, but keys, colours and materials may be
 * computed), and the plan is applied only when the whole cast commits (magic.ts).
 */

export interface GlamourRequest {
  reset: boolean;
  /** Colours to set; null puts that part back to the house default. */
  set: Partial<Record<GlamourPart, number | null>>;
  mat?: GlamourMaterial;
  /** The :on value (another wizard to jinx), if any. */
  on?: Value;
  secs?: number;
}

const KEYS = [...GLAMOUR_PARTS, 'material', 'on', 'secs', 'reset'];

/** Read a colour value: "#rgb"/"#rrggbb"/a name, a 24-bit number, or (list r g b) with 0..255 parts. */
function colour(v: Value, part: string, at: Node, notes: string[]): number | null {
  if (v === null) return null;
  if (typeof v === 'string') {
    const c = colourFromText(v);
    if (c === null) throw new RuneError(`glamour :${part}: "${v.slice(0, 24)}" is not a colour — use "#rrggbb", "#rgb" or a name like :gold`, at.line, at.col);
    return c;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    const c = Math.max(0, Math.min(0xffffff, Math.round(v)));
    if (c !== v) notes.push(`glamour :${part} ${v} clamped to ${c} (0..16777215)`);
    return c;
  }
  if (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    const rgb = (v as number[]).map((x) => Math.max(0, Math.min(255, Math.round(x))));
    if (rgb.some((x, i) => x !== (v as number[])[i])) notes.push(`glamour :${part} [${(v as number[]).map((x) => +x.toFixed(2)).join(' ')}] clamped to [${rgb.join(' ')}] (0..255)`);
    return (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
  }
  throw new RuneError(`glamour :${part}: expected a colour ("#7a1f2b", :gold or (list r g b)), got ${Array.isArray(v) ? 'a list' : typeof v}`, at.line, at.col);
}

export function readGlamour(args: Value[], at: Node, notes: string[]): GlamourRequest {
  if (!args.length) throw new RuneError(`(glamour :key value ...) needs at least one key: :${KEYS.join(' :')}`, at.line, at.col);
  if (args.length > GLAMOUR_MAX_ARGS) throw new RuneError(`glamour takes at most ${GLAMOUR_MAX_ARGS} words`, at.line, at.col);
  const req: GlamourRequest = { reset: false, set: {} };
  for (let i = 0; i < args.length;) {
    const k = args[i];
    if (typeof k !== 'string') throw new RuneError(`glamour: expected a key like :robe at word ${i + 1}`, at.line, at.col);
    const bad = forbiddenLook(k);
    if (bad) throw new RuneError(`${bad.en} ${bad.zh}`, at.line, at.col);
    if (k === 'reset') { req.reset = true; i++; continue; }
    if (!KEYS.includes(k)) throw new RuneError(`glamour: unknown key :${k.slice(0, 24)} — use :${KEYS.join(' :')}`, at.line, at.col);
    if (i + 1 >= args.length) throw new RuneError(`glamour: :${k} needs a value`, at.line, at.col);
    const v = args[i + 1];
    if (k === 'material') {
      if (typeof v !== 'string') throw new RuneError(`glamour :material: expected one of :${GLAMOUR_MATERIALS.join(' :')}`, at.line, at.col);
      const no = forbiddenLook(v);
      if (no) throw new RuneError(`${no.en} ${no.zh}`, at.line, at.col);
      if (!(GLAMOUR_MATERIALS as readonly string[]).includes(v)) throw new RuneError(`glamour: no such material :${v.slice(0, 24)} — one of :${GLAMOUR_MATERIALS.join(' :')}`, at.line, at.col);
      req.mat = v as GlamourMaterial;
    } else if (k === 'on') {
      if (!isRef(v)) throw new RuneError('glamour :on needs a wizard (e.g. target)', at.line, at.col);
      req.on = v;
    } else if (k === 'secs') {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new RuneError('glamour :secs needs a number', at.line, at.col);
      req.secs = v;
    } else req.set[k as GlamourPart] = colour(v, k, at, notes);
    i += 2;
  }
  return req;
}

/** Year and seals a material asks of the caster (laws are exempt). */
export function materialRefusal(mat: GlamourMaterial, year: number, seals: number): string | null {
  const d = MATERIAL_DEFS[mat];
  if (d.year > year) return `:${mat} is year-${d.year} transfiguration (you are year ${year}) — ${MATERIAL_DEFS[mat].zh}是 ${d.year} 年级的变形术`;
  if (d.seals > seals) return `:${mat} lies behind seal ${d.seals} of the Restricted Section; you have broken ${seals} — 需要禁书区第 ${d.seals} 道封印`;
  return null;
}

export const prankRefusal = (year: number) => (year < GLAMOUR_PRANK_YEAR ? `glamour :on someone else is year-${GLAMOUR_PRANK_YEAR} magic (a Colour-Change jinx)` : null);

/** Your own new look after a glamour: reset (optionally) to the house look, then lay the request over it. */
export function nextLook(cur: Glamour | null, req: GlamourRequest): Glamour | null {
  const base = req.reset ? null : cur;
  const g: Glamour = { ...(base ?? {}), mat: req.mat ?? base?.mat ?? 'plain' };
  for (const p of GLAMOUR_PARTS) {
    if (!(p in req.set)) continue;
    const v = req.set[p];
    if (v === null || v === undefined) delete g[p];
    else g[p] = v;
  }
  return glamourKey(g) ? g : null;
}

/** The look a jinx lays over its victim (only what the caster named). */
export function jinxLayer(req: GlamourRequest): Glamour {
  const g: Glamour = { mat: req.mat ?? 'plain' };
  for (const p of GLAMOUR_PARTS) { const v = req.set[p]; if (typeof v === 'number') g[p] = v; }
  return g;
}

export const prankSecs = (req: GlamourRequest) => req.secs ?? GLAMOUR_PRANK_DEFAULT_S;
export const PRANK_MIN_S = GLAMOUR_PRANK_MIN_S;

/** Mana inputs for EFFECT_COST.glamour. */
export function glamourCostArgs(req: GlamourRequest, other: boolean, secs: number) {
  return {
    parts: Object.values(req.set).filter((v) => typeof v === 'number').length,
    tier: req.mat ? MATERIAL_DEFS[req.mat].cost : 0,
    other: other ? 1 : 0,
    secs: other ? secs : 0,
  };
}

/** What everyone sees: your own look with an unexpired jinx laid over it. */
export function lookOf(w: Wizard, now: number): Glamour | null {
  const j = w.jinxLook;
  return overlayGlamour(w.look ?? null, j && j.until > now ? j.look : null);
}

/** A short description for the cast report. */
export function describeGlamour(req: GlamourRequest) {
  const bits: string[] = [];
  if (req.reset) bits.push('reset');
  if (req.mat) bits.push(req.mat);
  for (const p of GLAMOUR_PARTS) if (p in req.set) { const v = req.set[p]; bits.push(`${p} ${typeof v === 'number' ? '#' + v.toString(16).padStart(6, '0') : 'default'}`); }
  return bits.join(', ') || 'no change';
}
