import { EFFECT_PRIMITIVES, ELEMENTS, type EffectPrimitive } from '../shared/constants.js';

/**
 * One table drives everything about the spell language: the static checker, the interpreter's
 * argument validation, mana costs, year gating, and the grimoire docs agents read over MCP.
 */

export type ArgType = 'num' | 'ent' | 'place' | 'vec' | 'str' | 'elem' | 'list' | 'any';
export interface ArgSpec { name: string; type: ArgType; optional?: boolean }
export interface Prim {
  name: string;
  kind: 'pure' | 'query' | 'effect';
  year: number;
  args: ArgSpec[];
  variadic?: ArgType;
  doc: string;
  example?: string;
}

const a = (name: string, type: ArgType, optional = false): ArgSpec => ({ name, type, optional });

/** Per-year hard caps. Requests above a cap are clamped (and reported), never refused. */
export function capsFor(year: number) {
  return {
    boltPower: 10 + 6 * year,
    healAmount: 10 + 6 * year,
    shieldAmount: 15 + 10 * year,
    shieldSecs: 8,
    pushForce: 12 + 2 * year,
    hasteMult: Math.min(2, 1.3 + 0.1 * year),
    hasteSecs: 6,
    rootSecs: Math.min(3, 1 + 0.3 * year),
    novaRadius: Math.min(10, 3 + year),
    novaPower: 8 + 4 * year,
    patronusSecs: 10,
    apparateRange: 30,
    lightSecs: 60,
    effectsPerCast: 3 + year,
    supportRange: 20,
    pushRange: 15,
    boltRange: 45,
    afterDelay: 5,
    afterPerCast: 3,
  };
}
export type Caps = ReturnType<typeof capsFor>;

/** Base mana of each effect, before the Rulebook's cost multipliers. */
export const EFFECT_COST: Record<EffectPrimitive, (x: Record<string, number>) => number> = {
  bolt: ({ power, elemental }) => power * (elemental ? 1.1 : 1),
  heal: ({ amount }) => amount * 1.3,
  shield: ({ amount, secs }) => amount * 0.6 + secs,
  push: ({ force }) => force * 1.5,
  haste: ({ mult, secs }) => (mult - 1) * secs * 12,
  root: ({ secs }) => secs * 12,
  nova: ({ power, radius }) => power * (1 + radius * 0.35),
  disarm: () => 20,
  patronus: ({ secs }) => 20 + secs * 3,
  apparate: () => 30,
  light: () => 1,
  say: () => 0,
};

export const PRIMS: Prim[] = [
  // ---- pure ----
  { name: '+', kind: 'pure', year: 1, args: [], variadic: 'num', doc: 'Sum.' },
  { name: '-', kind: 'pure', year: 1, args: [a('x', 'num')], variadic: 'num', doc: 'Subtract, or negate one number.' },
  { name: '*', kind: 'pure', year: 1, args: [], variadic: 'num', doc: 'Product.' },
  { name: '/', kind: 'pure', year: 1, args: [a('x', 'num'), a('y', 'num')], doc: 'Divide (x/0 = 0).' },
  { name: 'mod', kind: 'pure', year: 1, args: [a('x', 'num'), a('y', 'num')], doc: 'Remainder.' },
  { name: 'min', kind: 'pure', year: 1, args: [a('x', 'num')], variadic: 'num', doc: 'Minimum.' },
  { name: 'max', kind: 'pure', year: 1, args: [a('x', 'num')], variadic: 'num', doc: 'Maximum.' },
  { name: 'abs', kind: 'pure', year: 1, args: [a('x', 'num')], doc: 'Absolute value.' },
  { name: 'floor', kind: 'pure', year: 1, args: [a('x', 'num')], doc: 'Round down.' },
  { name: 'sqrt', kind: 'pure', year: 1, args: [a('x', 'num')], doc: 'Square root.' },
  { name: 'clamp', kind: 'pure', year: 1, args: [a('x', 'num'), a('lo', 'num'), a('hi', 'num')], doc: 'Clamp x into [lo, hi].' },
  { name: '<', kind: 'pure', year: 1, args: [a('x', 'num'), a('y', 'num')], doc: 'Less than.' },
  { name: '>', kind: 'pure', year: 1, args: [a('x', 'num'), a('y', 'num')], doc: 'Greater than.' },
  { name: '<=', kind: 'pure', year: 1, args: [a('x', 'num'), a('y', 'num')], doc: 'Less or equal.' },
  { name: '>=', kind: 'pure', year: 1, args: [a('x', 'num'), a('y', 'num')], doc: 'Greater or equal.' },
  { name: '=', kind: 'pure', year: 1, args: [a('x', 'any'), a('y', 'any')], doc: 'Equality (entities compare by id).' },
  { name: 'not', kind: 'pure', year: 1, args: [a('x', 'any')], doc: 'Logical not (nil, false, 0 and empty list are falsy).' },
  { name: 'list', kind: 'pure', year: 1, args: [], variadic: 'any', doc: 'Make a list.' },
  { name: 'count', kind: 'pure', year: 1, args: [a('xs', 'list')], doc: 'Length of a list.' },
  { name: 'first', kind: 'pure', year: 1, args: [a('xs', 'list')], doc: 'First element or nil. Query lists are sorted nearest-first.' },
  { name: 'nth', kind: 'pure', year: 1, args: [a('xs', 'list'), a('i', 'num')], doc: 'i-th element (0-based) or nil.' },
  { name: 'vec', kind: 'pure', year: 1, args: [a('x', 'num'), a('z', 'num')], doc: 'A point on the ground.' },
  { name: 'str', kind: 'pure', year: 1, args: [], variadic: 'any', doc: 'Concatenate into a string.' },
  { name: 'rand', kind: 'pure', year: 1, args: [], doc: 'Uniform random number in [0,1).' },
  // ---- queries (read the world, cost 3 gas) ----
  { name: 'enemies', kind: 'query', year: 1, args: [a('radius', 'num')], doc: 'Things you may harm within radius of you (creatures + duel-able wizards), nearest first, max 8.' },
  { name: 'allies', kind: 'query', year: 1, args: [a('radius', 'num')], doc: 'Wizards of your house within radius (excluding you), nearest first, max 8.' },
  { name: 'creatures', kind: 'query', year: 1, args: [a('radius', 'num')], doc: 'Creatures within radius, nearest first, max 8.' },
  { name: 'wizards', kind: 'query', year: 1, args: [a('radius', 'num')], doc: 'Other wizards within radius, nearest first, max 8.' },
  { name: 'hp', kind: 'query', year: 1, args: [a('e', 'ent')], doc: 'Current health.' },
  { name: 'max-hp', kind: 'query', year: 1, args: [a('e', 'ent')], doc: 'Maximum health.' },
  { name: 'mana', kind: 'query', year: 1, args: [], doc: 'Your current mana (before this spell is paid for).' },
  { name: 'pos', kind: 'query', year: 1, args: [a('e', 'ent')], doc: 'Position vector of an entity.' },
  { name: 'dist', kind: 'query', year: 1, args: [a('a', 'place'), a('b', 'place')], doc: 'Distance between entities/points.' },
  { name: 'ahead', kind: 'query', year: 1, args: [a('d', 'num')], doc: 'The point d metres from you toward your aim.' },
  { name: 'name', kind: 'query', year: 1, args: [a('e', 'ent')], doc: 'Display name.' },
  { name: 'house', kind: 'query', year: 1, args: [a('e', 'ent')], doc: 'House of a wizard, or nil.' },
  { name: 'kind', kind: 'query', year: 1, args: [a('e', 'ent')], doc: '"wizard", "pixie", "snare", "spider", "troll" or "dementor".' },
  { name: 'year', kind: 'query', year: 1, args: [a('e', 'ent')], doc: 'School year of a wizard (creatures: 0).' },
  { name: 'alive', kind: 'query', year: 1, args: [a('e', 'ent')], doc: 'Is it still standing?' },
  { name: 'zone', kind: 'query', year: 1, args: [a('e', 'place')], doc: 'Most specific zone id at that place, e.g. "forest".' },
  { name: 'hour', kind: 'query', year: 1, args: [], doc: 'Hour of day, 0..24.' },
  { name: 'night', kind: 'query', year: 1, args: [], doc: 'Is it night?' },
  // ---- effects (cost mana; planned then committed atomically) ----
  { name: 'bolt', kind: 'effect', year: 1, args: [a('at', 'place'), a('power', 'num'), a('element', 'elem', true)], doc: 'Fire a bolt at an entity (homing) or point. Damage = power. Cost: power (x1.1 if elemental). Cap: 10+6*year.', example: '(bolt target 16 :fire)' },
  { name: 'heal', kind: 'effect', year: 1, args: [a('who', 'ent'), a('amount', 'num')], doc: 'Heal a wizard within 20m. Cost: 1.3*amount. Cap: 10+6*year.', example: '(heal self 20)' },
  { name: 'shield', kind: 'effect', year: 1, args: [a('who', 'ent'), a('amount', 'num'), a('secs', 'num')], doc: 'Absorb damage for secs (<=8). Cost: 0.6*amount + secs. Cap: 15+10*year.', example: '(shield self 30 4)' },
  { name: 'light', kind: 'effect', year: 1, args: [a('secs', 'num', true)], doc: 'Lumos. Your wand glows. Cost 1.' },
  { name: 'say', kind: 'effect', year: 1, args: [a('text', 'any')], doc: 'Speak (shows over your head). Free.' },
  { name: 'push', kind: 'effect', year: 2, args: [a('who', 'ent'), a('force', 'num')], doc: 'Knock a target within 15m away from you by force metres. Cost: 1.5*force. Cap: 12+2*year.', example: '(push target 8)' },
  { name: 'haste', kind: 'effect', year: 2, args: [a('who', 'ent'), a('mult', 'num'), a('secs', 'num')], doc: 'Speed multiplier for secs (<=6). Cost: (mult-1)*secs*12. Cap: 1.3+0.1*year (max 2).' },
  { name: 'disarm', kind: 'effect', year: 2, args: [a('at', 'ent')], doc: 'Expelliarmus: a bolt that stops the target casting for 2s. Cost 20. Whoever disarms the master of the Elder Wand becomes its master.' },
  { name: 'root', kind: 'effect', year: 3, args: [a('at', 'ent'), a('secs', 'num')], doc: 'A bolt that roots the target. Cost: 12*secs. Cap: 1+0.3*year (max 3).' },
  { name: 'nova', kind: 'effect', year: 3, args: [a('radius', 'num'), a('power', 'num'), a('element', 'elem', true)], doc: 'Damage everything harmable around you. Cost: power*(1+0.35*radius). Caps: radius 3+year (max 10), power 8+4*year.' },
  { name: 'patronus', kind: 'effect', year: 3, args: [a('secs', 'num')], doc: 'Expecto Patronum: a silver guardian that burns Dementors near you. Cost: 20+3*secs.' },
  { name: 'apparate', kind: 'effect', year: 6, args: [a('to', 'place')], doc: 'Teleport up to 30m. Cost 30. Blocked on Hogwarts grounds unless the Rulebook allows it.' },
];

export const PRIM_BY_NAME = new Map(PRIMS.map((p) => [p.name, p]));
export const SPECIAL_FORMS = ['do', 'let', 'if', 'when', 'unless', 'and', 'or', 'repeat', 'each', 'after'] as const;
export const CONSTANTS = ['self', 'target', 'aim', 'object', 'true', 'false', 'nil', 'pi'] as const;
export const ELEMENT_SET = new Set<string>(ELEMENTS);
export const isEffect = (name: string): name is EffectPrimitive => (EFFECT_PRIMITIVES as readonly string[]).includes(name);

export const SPECIAL_DOCS: Record<string, string> = {
  do: '(do e1 e2 ...) evaluate in order, return last.',
  let: '(let name expr) bind name in the current block.',
  if: '(if cond then else?)',
  when: '(when cond body...)',
  unless: '(unless cond body...)',
  and: '(and a b ...) short-circuit.',
  or: '(or a b ...) short-circuit.',
  repeat: '(repeat n body...) n is clamped to 10. `i` is bound to the iteration index.',
  each: '(each x list body...) iterate (at most 16 items).',
  after: '(after secs body...) [year 2] run body later (<=5s, <=3 per cast). Each delayed body is its own atomic cast.',
};
