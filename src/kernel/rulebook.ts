import { z } from 'zod';
import { CREATURE_KINDS, EFFECT_PRIMITIVES, ELEMENTS, type CreatureKind, type EffectPrimitive, type Element } from '../shared/constants.js';

/**
 * The Rulebook is ALL the policy of the world. The kernel is pure mechanism and reads every tunable
 * from here, so a Minister's decree (a patch to this document) really can change "the rules of the world".
 * The schema's bounds are the constitution: no decree can push a number outside them.
 */

const num = (min: number, max: number, def: number, describe: string) => z.number().min(min).max(max).default(def).describe(describe);

const costMultipliers = z
  .object(Object.fromEntries(EFFECT_PRIMITIVES.map((p) => [p, z.number().min(0.25).max(4).default(1)])) as Record<EffectPrimitive, z.ZodDefault<z.ZodNumber>>)
  .prefault({})
  .describe('Mana cost multiplier per spell primitive');

const elementMultipliers = z
  .object(Object.fromEntries(ELEMENTS.map((e) => [e, z.number().min(0.25).max(3).default(1)])) as Record<Element, z.ZodDefault<z.ZodNumber>>)
  .prefault({})
  .describe('Global damage multiplier per element');

const creatureToggles = z
  .object(Object.fromEntries(CREATURE_KINDS.map((k) => [k, z.boolean().default(true)])) as Record<CreatureKind, z.ZodDefault<z.ZodBoolean>>)
  .prefault({})
  .describe('Which creatures may spawn');

export const LAW_TRIGGERS = ['kill', 'respawn', 'cast', 'pulse'] as const;
export type LawTrigger = (typeof LAW_TRIGGERS)[number];

export const LawSchema = z.object({
  name: z.string().min(1).max(60),
  on: z.enum(LAW_TRIGGERS).describe('kill: subject=killer, object=victim. respawn: subject=wizard. cast: subject=caster. pulse: every 10s for each online wizard.'),
  source: z.string().min(1).max(2000).describe('A Runes program. `self` is the subject; `object` is bound for kill.'),
});
export type Law = z.infer<typeof LawSchema>;

export const RulebookSchema = z.object({
  physics: z
    .object({
      moveSpeed: num(2, 20, 7, 'Base walking speed (m/s)'),
      projectileSpeed: num(8, 80, 32, 'Speed of bolts (m/s)'),
    })
    .prefault({}),
  combat: z
    .object({
      pvp: z.boolean().default(true).describe('May wizards harm each other at all'),
      friendlyFire: z.boolean().default(true).describe('May wizards of the same house harm each other'),
      damageMultiplier: num(0.25, 4, 1, 'Global damage multiplier'),
      healingMultiplier: num(0, 4, 1, 'Global healing multiplier'),
      elementMultipliers,
      respawnSeconds: num(1, 30, 5, 'Seconds a stunned wizard waits in the Hospital Wing'),
      safeZones: z.array(z.enum(['great_hall', 'courtyard', 'hogsmeade', 'greenhouses'])).max(4).default(['great_hall']).describe('Zones where nobody can be harmed'),
    })
    .prefault({}),
  magic: z
    .object({
      baseMaxMana: num(50, 400, 100, 'Mana of a first year'),
      manaPerYear: num(0, 60, 20, 'Extra max mana per school year'),
      manaRegen: num(1, 40, 7, 'Mana regenerated per second'),
      castOverhead: num(0, 20, 2, 'Flat mana cost of any cast'),
      costMultipliers,
      bannedPrimitives: z.array(z.enum(EFFECT_PRIMITIVES)).max(8).default([]).describe('Primitives outlawed by the Ministry'),
      apparitionOnGrounds: z.boolean().default(false).describe('"You cannot Apparate inside Hogwarts grounds" (Hogwarts: A History)'),
      unforgivablesBanned: z.boolean().default(true).describe('Casting an Unforgivable Curse earns a stay in Azkaban'),
      nodesPerYear: num(10, 80, 25, 'Extra spell complexity (AST nodes) per year; base 40'),
      gasPerYear: num(20, 400, 60, 'Extra runtime gas per year; base 150'),
    })
    .prefault({}),
  progression: z
    .object({
      xpMultiplier: num(0.1, 10, 1, 'XP multiplier'),
      creatureRepMultiplier: num(0, 10, 1, 'Reputation from creatures multiplier'),
      duelRepBase: num(0, 100, 10, 'Reputation for stunning another wizard'),
      duelRepStealPct: num(0, 50, 10, 'Percent of the victim reputation transferred to the victor'),
      galleonMultiplier: num(0, 10, 1, 'Galleons dropped multiplier'),
    })
    .prefault({}),
  creatures: z
    .object({
      enabled: creatureToggles,
      spawnMultiplier: num(0, 3, 1, 'Population multiplier'),
      statMultiplier: num(0.5, 3, 1, 'Creature HP and damage multiplier'),
    })
    .prefault({}),
  world: z
    .object({
      dayLengthSeconds: num(120, 7200, 900, 'Real seconds per in-game day'),
      weather: z.enum(['clear', 'rain', 'snow', 'fog']).default('clear'),
      eternalNight: z.boolean().default(false).describe('Dementors roam forever'),
    })
    .prefault({}),
  terms: z
    .object({
      lengthSeconds: num(120, 86400, 900, 'Length of a school term; at its end the House Cup is awarded and a Minister chosen'),
      reputationDecay: num(0, 1, 0.5, 'Fraction of reputation that survives the end of term'),
      ministerMinReputation: num(0, 100000, 100, 'Minimum reputation to be appointed Minister for Magic'),
    })
    .prefault({}),
  laws: z.array(LawSchema).max(5).default([]).describe('Standing laws: Runes programs the world runs on events'),
  proclamation: z.string().max(280).default('Draco dormiens nunquam titillandus.'),
});

export type Rulebook = z.infer<typeof RulebookSchema>;

export function defaultRulebook(): Rulebook {
  return RulebookSchema.parse({});
}

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain => typeof v === 'object' && v !== null && !Array.isArray(v);

/** RFC 7386 JSON merge patch (arrays replace, null deletes -> falls back to default). */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isPlain(patch)) return patch;
  const out: Plain = isPlain(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = mergePatch(out[k], v);
  }
  return out;
}

export type PatchResult = { ok: true; rulebook: Rulebook; changes: string[] } | { ok: false; errors: string[] };

/** Apply a decree patch. Unknown keys are rejected so typos never silently do nothing. */
export function applyPatch(current: Rulebook, patch: unknown): PatchResult {
  const merged = mergePatch(current, patch);
  const res = RulebookSchema.strict().safeParse(merged);
  if (!res.success) {
    return { ok: false, errors: res.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
  }
  const unknown = findUnknownKeys(patch, RulebookSchema);
  if (unknown.length) return { ok: false, errors: unknown.map((k) => `${k}: unknown rule`) };
  return { ok: true, rulebook: res.data, changes: diff(current, res.data) };
}

function findUnknownKeys(patch: unknown, schema: z.ZodType, prefix = ''): string[] {
  if (!isPlain(patch)) return [];
  let s: z.ZodType = schema;
  while (s instanceof z.ZodDefault || s instanceof z.ZodPrefault || s instanceof z.ZodOptional) s = (s as z.ZodDefault<z.ZodType>).unwrap() as z.ZodType;
  if (!(s instanceof z.ZodObject)) return [];
  const shape = s.shape as Record<string, z.ZodType>;
  const out: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (!(k in shape)) out.push(path);
    else out.push(...findUnknownKeys(v, shape[k], path));
  }
  return out;
}

export function diff(a: unknown, b: unknown, prefix = ''): string[] {
  if (isPlain(a) && isPlain(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) => diff(a[k], b[k], prefix ? `${prefix}.${k}` : k));
  }
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa === sb) return [];
  const short = (s: string | undefined) => (s && s.length > 60 ? s.slice(0, 57) + '...' : s);
  return [`${prefix}: ${short(sa)} -> ${short(sb)}`];
}

/** Human/agent readable description of every rule and its bounds. */
export function describeRulebookSchema(): unknown {
  return z.toJSONSchema(RulebookSchema, { io: 'input' });
}
