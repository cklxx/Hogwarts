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
  /** Broken Restricted-Section seals required. */
  seals?: number;
  args: ArgSpec[];
  variadic?: ArgType;
  doc: string;
  example?: string;
}

const a = (name: string, type: ArgType, optional = false): ArgSpec => ({ name, type, optional });

/** Per-year hard caps. Requests above a cap are clamped (and reported), never refused. */
export function capsFor(year: number, seals = 0) {
  const m = 1 + 0.2 * seals;
  return {
    boltPower: Math.floor((10 + 6 * year) * m),
    healAmount: Math.floor((10 + 6 * year) * m),
    shieldAmount: Math.floor((15 + 10 * year) * m),
    shieldSecs: 8,
    pushForce: 12 + 2 * year,
    hasteMult: Math.min(2, 1.3 + 0.1 * year),
    hasteSecs: 6,
    rootSecs: Math.min(3, 1 + 0.3 * year),
    novaRadius: Math.min(10, 3 + year),
    novaPower: Math.floor((8 + 4 * year) * m),
    regenRate: Math.floor((2 + year) * m),
    regenSecs: 8,
    mendRadius: Math.min(8, 4 + Math.floor(year / 2)),
    mendAmount: Math.floor((10 + 6 * year) * m * 0.6),
    reviveRange: 6,
    summonSecs: 30,
    chainPower: Math.floor((10 + 5 * year) * m),
    chainJumps: 3,
    stormRadius: 10,
    stormPower: Math.floor((12 + 5 * year) * m),
    stormRange: 40,
    patronusSecs: 10,
    apparateRange: 30,
    lightSecs: 60,
    effectsPerCast: 3 + year + seals,
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
  reveal: () => 10,
  regen: ({ rate, secs }) => rate * secs * 0.9,
  mend: ({ amount, radius }) => amount * (1 + 0.3 * radius) * 1.2,
  revive: () => 35,
  cleanse: () => 15,
  summon: ({ base, secs }) => base + secs * 0.5,
  chain: ({ power }) => power * 2.2,
  storm: ({ power, radius }) => power * (1 + 0.4 * radius),
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
  { name: 'fallen', kind: 'query', year: 1, args: [a('radius', 'num')], doc: 'Stunned wizards within radius, nearest first (for revive).' },
  { name: 'summons', kind: 'query', year: 1, args: [], doc: 'Your conjured creatures.' },
  { name: 'afflicted', kind: 'query', year: 1, args: [a('e', 'ent')], doc: 'Is it rooted, disarmed, poisoned, burning, chilled or cursed?' },
  { name: 'night', kind: 'query', year: 1, args: [], doc: 'Is it night?' },
  // ---- effects (cost mana; planned then committed atomically) ----
  { name: 'bolt', kind: 'effect', year: 1, args: [a('at', 'place'), a('power', 'num'), a('element', 'elem', true)], doc: 'Fire a bolt at an entity (homing) or point. Damage = power. Cost: power (x1.1 if elemental). Cap: 10+6*year.', example: '(bolt target 16 :fire)' },
  { name: 'heal', kind: 'effect', year: 1, args: [a('who', 'ent'), a('amount', 'num')], doc: 'Heal a wizard within 20m. Cost: 1.3*amount. Cap: 10+6*year.', example: '(heal self 20)' },
  { name: 'shield', kind: 'effect', year: 1, args: [a('who', 'ent'), a('amount', 'num'), a('secs', 'num')], doc: 'Absorb damage for secs (<=8). Cost: 0.6*amount + secs. Cap: 15+10*year.', example: '(shield self 30 4)' },
  { name: 'light', kind: 'effect', year: 1, args: [a('secs', 'num', true)], doc: 'Lumos. Your wand glows. Cost 1.' },
  { name: 'say', kind: 'effect', year: 1, args: [a('text', 'any')], doc: 'Speak (shows over your head). Free.' },
  { name: 'regen', kind: 'effect', year: 2, args: [a('who', 'ent'), a('rate', 'num'), a('secs', 'num')], doc: 'Heal a wizard rate HP/s for secs (<=8). Cost: 0.9*rate*secs. Cap: 2+year per second.', example: '(regen self 4 6)' },
  { name: 'cleanse', kind: 'effect', year: 2, args: [a('who', 'ent')], doc: 'Finite Incantatem: end roots, disarms, poison, burning, chill and curses on a wizard or your summon within 20m. Cost 15.', example: '(cleanse self)' },
  { name: 'summon', kind: 'effect', year: 2, args: [a('kind', 'str'), a('secs', 'num', true)], doc: 'Conjure a creature that fights what you may harm: :serpent (y2, cost 30) or :birds (y3, cost 40), for secs (<=30, +0.5 mana/s). At most Rulebook maxSummons at once; a new one dismisses the oldest.', example: '(summon :serpent 20)' },
  { name: 'revive', kind: 'effect', year: 3, args: [a('who', 'ent')], doc: 'Rennervate: a stunned wizard within 6m gets up where they fell at 30% health. Cost 35.', example: '(revive (first (fallen 6)))' },
  { name: 'mend', kind: 'effect', year: 4, args: [a('radius', 'num'), a('amount', 'num')], doc: 'Heal your house, yourself and your summons within radius (<=4+year/2, max 8). Cost: 1.2*amount*(1+0.3*radius).', example: '(mend 6 30)' },
  { name: 'push', kind: 'effect', year: 2, args: [a('who', 'ent'), a('force', 'num')], doc: 'Knock a target within 15m away from you by force metres. Cost: 1.5*force. Cap: 12+2*year.', example: '(push target 8)' },
  { name: 'haste', kind: 'effect', year: 2, args: [a('who', 'ent'), a('mult', 'num'), a('secs', 'num')], doc: 'Speed multiplier for secs (<=6). Cost: (mult-1)*secs*12. Cap: 1.3+0.1*year (max 2).' },
  { name: 'disarm', kind: 'effect', year: 2, args: [a('at', 'ent')], doc: 'Expelliarmus: a bolt that stops the target casting for 2s. Cost 20. Whoever disarms the master of the Elder Wand becomes its master.' },
  { name: 'root', kind: 'effect', year: 3, args: [a('at', 'ent'), a('secs', 'num')], doc: 'A bolt that roots the target. Cost: 12*secs. Cap: 1+0.3*year (max 3).' },
  { name: 'nova', kind: 'effect', year: 3, args: [a('radius', 'num'), a('power', 'num'), a('element', 'elem', true)], doc: 'Damage everything harmable around you. Cost: power*(1+0.35*radius). Caps: radius 3+year (max 10), power 8+4*year.' },
  { name: 'patronus', kind: 'effect', year: 3, args: [a('secs', 'num')], doc: 'Expecto Patronum: a silver guardian that burns Dementors near you. Cost: 20+3*secs.' },
  { name: 'reveal', kind: 'effect', year: 1, args: [a('charm', 'str')], doc: 'Unlock a corner of your sight for good: :tempus (clock, y1), :revelio (your own measure, y1), :point-me (radar, y2), :homenum (who is near, y3). Cost 10.', example: '(reveal :tempus)' },
  { name: 'chain', kind: 'effect', year: 4, seals: 2, args: [a('at', 'ent'), a('power', 'num'), a('element', 'elem', true)], doc: '[Second Seal] Lightning that strikes a foe then leaps to up to 3 more within 8m, losing 30% each jump. Cost: 2.2*power.', example: '(chain target 20 :lightning)' },
  { name: 'storm', kind: 'effect', year: 7, seals: 4, args: [a('at', 'place'), a('radius', 'num'), a('power', 'num'), a('element', 'elem', true)], doc: '[Fourth Seal] A tempest gathers at a point (<=40m) and breaks 1.5s later on everything harmable within radius (<=10). Cost: power*(1+0.4*radius).', example: '(storm aim 8 40 :lightning)' },
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
