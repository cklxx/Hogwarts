import { type Node, RuneError, parse } from './parser.js';
import { CONSTANTS, type Gate, PRIM_BY_NAME, SPECIAL_FORMS } from './primitives.js';

export interface Analysis {
  program: Node[];
  nodes: number;
  primitives: string[];
  effects: string[];
  minYear: number;
  minSeals: number;
  usesAfter: boolean;
}

export interface CheckLimits { year: number; maxNodes: number; banned?: readonly string[]; seals?: number }

const SPECIAL = new Set<string>(SPECIAL_FORMS);

/** Parse + static checks. Throws RuneError with a position on the first problem. */
export function analyze(source: string, limits?: CheckLimits): Analysis {
  const program = parse(source);
  let nodes = 0;
  let minYear = 1;
  let minSeals = 0;
  let usesAfter = false;
  const prims = new Set<string>();
  /** Requirements found in literal arguments (e.g. a year-6 glamour material). */
  const gates: Gate[] = [];

  const walk = (n: Node, scope: Set<string>) => {
    nodes++;
    if (n.t === 'sym') {
      if (!scope.has(n.v) && !(CONSTANTS as readonly string[]).includes(n.v)) {
        const hint = PRIM_BY_NAME.has(n.v) ? ` — did you mean (${n.v} ...)?` : '';
        throw new RuneError(`unknown name '${n.v}'${hint}`, n.line, n.col);
      }
      return;
    }
    if (n.t !== 'list') return;
    if (!n.items.length) throw new RuneError('empty form ()', n.line, n.col);
    const [head, ...rest] = n.items;
    if (head.t !== 'sym') throw new RuneError('a form must start with a name', head.line, head.col);
    nodes++;
    const name = head.v;
    if (SPECIAL.has(name)) {
      switch (name) {
        case 'let': {
          if (rest.length !== 2 || rest[0].t !== 'sym') throw new RuneError('(let name expr)', n.line, n.col);
          walk(rest[1], scope);
          scope.add(rest[0].v);
          return;
        }
        case 'if':
          if (rest.length < 2 || rest.length > 3) throw new RuneError('(if cond then else?)', n.line, n.col);
          rest.forEach((r) => walk(r, scope));
          return;
        case 'repeat': {
          if (rest.length < 2) throw new RuneError('(repeat n body...)', n.line, n.col);
          walk(rest[0], scope);
          const inner = new Set(scope).add('i');
          rest.slice(1).forEach((r) => walk(r, inner));
          return;
        }
        case 'each': {
          if (rest.length < 3 || rest[0].t !== 'sym') throw new RuneError('(each x list body...)', n.line, n.col);
          walk(rest[1], scope);
          const inner = new Set(scope).add(rest[0].v);
          rest.slice(2).forEach((r) => walk(r, inner));
          return;
        }
        case 'after': {
          usesAfter = true;
          minYear = Math.max(minYear, 2);
          if (rest.length < 2) throw new RuneError('(after secs body...)', n.line, n.col);
          walk(rest[0], scope);
          const inner = new Set(scope);
          rest.slice(1).forEach((r) => walk(r, inner));
          return;
        }
        case 'when':
        case 'unless':
          if (rest.length < 2) throw new RuneError(`(${name} cond body...)`, n.line, n.col);
          rest.forEach((r) => walk(r, scope));
          return;
        default: {
          // do/and/or: `do` opens a lexical block for its lets
          const inner = name === 'do' ? new Set(scope) : scope;
          rest.forEach((r) => walk(r, inner));
          return;
        }
      }
    }
    const p = PRIM_BY_NAME.get(name);
    if (!p) throw new RuneError(`unknown spell word '${name}'`, head.line, head.col);
    const required = p.args.filter((x) => !x.optional).length;
    if (rest.length < required || (!p.variadic && rest.length > p.args.length)) {
      const sig = p.args.map((x) => (x.optional ? `${x.name}?` : x.name)).join(' ') + (p.variadic ? ' ...' : '');
      throw new RuneError(`(${name} ${sig}) takes ${p.variadic ? 'at least ' : ''}${required}${p.args.length !== required ? '-' + p.args.length : ''} argument(s), got ${rest.length}`, n.line, n.col);
    }
    prims.add(name);
    minYear = Math.max(minYear, p.year);
    minSeals = Math.max(minSeals, p.seals ?? 0);
    for (const g of p.check?.(rest, n) ?? []) {
      gates.push(g);
      minYear = Math.max(minYear, g.year);
      minSeals = Math.max(minSeals, g.seals);
    }
    rest.forEach((r) => walk(r, scope));
  };

  const top = new Set<string>();
  program.forEach((n) => walk(n, top));

  const primitives = [...prims].sort();
  const effects = primitives.filter((p) => PRIM_BY_NAME.get(p)!.kind === 'effect');
  if (limits) {
    if (minYear > limits.year) {
      const blockers = [...primitives.filter((p) => PRIM_BY_NAME.get(p)!.year > limits.year), ...gates.filter((g) => g.year > limits.year).map((g) => g.what)];
      throw new RuneError(`this spell needs year ${minYear} magic (${usesAfter && limits.year < 2 ? 'after, ' : ''}${blockers.join(', ')}); you are year ${limits.year}`);
    }
    if (minSeals > (limits.seals ?? 0)) {
      const blockers = [...primitives.filter((p) => (PRIM_BY_NAME.get(p)!.seals ?? 0) > (limits.seals ?? 0)), ...gates.filter((g) => g.seals > (limits.seals ?? 0)).map((g) => g.what)];
      throw new RuneError(`${blockers.join(', ')} lies behind seal ${minSeals} of the Restricted Section; you have broken ${limits.seals ?? 0}`);
    }
    if (nodes > limits.maxNodes) throw new RuneError(`spell too complex: ${nodes} nodes > your limit ${limits.maxNodes}`);
    const banned = effects.filter((e) => limits.banned?.includes(e));
    if (banned.length) throw new RuneError(`banned by Ministry decree: ${banned.join(', ')}`);
  }
  return { program, nodes, primitives, effects, minYear, minSeals, usesAfter };
}
