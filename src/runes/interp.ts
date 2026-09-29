import type { EffectPrimitive } from '../shared/constants.js';
import { type Node, RuneError, show } from './parser.js';
import { type ArgType, ELEMENT_SET, PRIM_BY_NAME, isEffect } from './primitives.js';

export type Ref = { $: 'ent'; id: string };
export type Vec = { $: 'vec'; x: number; z: number };
export type Value = number | string | boolean | null | Ref | Vec | Value[];

export const ref = (id: string): Ref => ({ $: 'ent', id });
export const vec = (x: number, z: number): Vec => ({ $: 'vec', x, z });
export const isRef = (v: Value): v is Ref => typeof v === 'object' && v !== null && !Array.isArray(v) && v.$ === 'ent';
export const isVec = (v: Value): v is Vec => typeof v === 'object' && v !== null && !Array.isArray(v) && v.$ === 'vec';

export class Env {
  private vars = new Map<string, Value>();
  constructor(private parent?: Env) {}
  get(name: string, at: Node): Value {
    for (let e: Env | undefined = this; e; e = e.parent) if (e.vars.has(name)) return e.vars.get(name)!;
    throw new RuneError(`unknown name '${name}'`, at.line, at.col);
  }
  def(name: string, v: Value) { this.vars.set(name, v); }
  child() { return new Env(this); }
}

/** Everything the interpreter needs from the world. Effects are *planned*, not applied. */
export interface RuneHost {
  query(name: string, args: Value[], at: Node): Value;
  effect(name: EffectPrimitive, args: Value[], at: Node): void;
  schedule(delay: number, body: Node[], env: Env, at: Node): void;
  rand(): number;
  /** How an entity prints in text. */
  refName?(id: string): string;
}

export const truthy = (v: Value) => !(v === null || v === false || v === 0 || (Array.isArray(v) && v.length === 0));

/**
 * Render a value as text. Output is capped at `budget` characters and stops walking as soon as the
 * budget is spent, so deeply nested lists cannot turn `str`/`say` into an unmetered CPU bomb.
 * `refName` lets the host decide how entities print (wizards must never print their registry id).
 */
export function display(v: Value, refName: (id: string) => string = (id) => `#${id}`, budget = 200): string {
  let out = '';
  const walk = (x: Value) => {
    if (out.length >= budget) return;
    if (x === null) out += 'nil';
    else if (Array.isArray(x)) {
      out += '[';
      for (let i = 0; i < x.length && out.length < budget; i++) { if (i) out += ' '; walk(x[i]); }
      out += ']';
    } else if (isRef(x)) out += refName(x.id);
    else if (isVec(x)) out += `(${x.x.toFixed(1)}, ${x.z.toFixed(1)})`;
    else if (typeof x === 'number') out += Number.isInteger(x) ? String(x) : x.toFixed(2);
    else out += String(x).slice(0, budget);
  };
  walk(v);
  return out.length > budget ? out.slice(0, budget - 1) + '…' : out;
}

export class Interp {
  gasUsed = 0;
  constructor(private host: RuneHost, private gasLimit: number) {}

  private burn(n: number, at: Node) {
    this.gasUsed += n;
    if (this.gasUsed > this.gasLimit) throw new RuneError(`out of gas (${this.gasLimit}) — the spell collapsed`, at.line, at.col);
  }

  run(program: Node[], env: Env): Value {
    let last: Value = null;
    for (const n of program) last = this.eval(n, env);
    return last;
  }

  eval(n: Node, env: Env): Value {
    this.burn(1, n);
    switch (n.t) {
      case 'num': return n.v;
      case 'str': return n.v;
      case 'kw': return n.v;
      case 'sym':
        if (n.v === 'true') return true;
        if (n.v === 'false') return false;
        if (n.v === 'nil') return null;
        if (n.v === 'pi') return Math.PI;
        return env.get(n.v, n);
      case 'list': return this.form(n, env);
    }
  }

  private form(n: Extract<Node, { t: 'list' }>, env: Env): Value {
    const [head, ...rest] = n.items;
    if (!head || head.t !== 'sym') throw new RuneError('a form must start with a name', n.line, n.col);
    switch (head.v) {
      case 'do': return this.run(rest, env.child());
      case 'let': {
        const v = this.eval(rest[1], env);
        env.def((rest[0] as { v: string }).v, v);
        return v;
      }
      case 'if': return truthy(this.eval(rest[0], env)) ? this.eval(rest[1], env) : rest[2] ? this.eval(rest[2], env) : null;
      case 'when': return truthy(this.eval(rest[0], env)) ? this.run(rest.slice(1), env.child()) : null;
      case 'unless': return truthy(this.eval(rest[0], env)) ? null : this.run(rest.slice(1), env.child());
      case 'and': {
        let v: Value = true;
        for (const r of rest) { v = this.eval(r, env); if (!truthy(v)) return v; }
        return v;
      }
      case 'or': {
        let v: Value = null;
        for (const r of rest) { v = this.eval(r, env); if (truthy(v)) return v; }
        return v;
      }
      case 'repeat': {
        const times = Math.max(0, Math.min(10, Math.floor(this.num(this.eval(rest[0], env), rest[0]))));
        let v: Value = null;
        for (let i = 0; i < times; i++) {
          const inner = env.child();
          inner.def('i', i);
          v = this.run(rest.slice(1), inner);
        }
        return v;
      }
      case 'each': {
        const xs = this.eval(rest[1], env);
        if (!Array.isArray(xs)) throw new RuneError(`each needs a list, got ${this.show(xs)}`, rest[1].line, rest[1].col);
        let v: Value = null;
        for (const x of xs.slice(0, 16)) {
          const inner = env.child();
          inner.def((rest[0] as { v: string }).v, x);
          v = this.run(rest.slice(2), inner);
        }
        return v;
      }
      case 'min-by':
      case 'max-by': {
        const xs = this.eval(rest[1], env);
        if (!Array.isArray(xs)) throw new RuneError(`${head.v} needs a list, got ${this.show(xs)}`, rest[1].line, rest[1].col);
        let best: Value = null, score = 0;
        for (const x of xs.slice(0, 16)) {
          const inner = env.child();
          inner.def((rest[0] as { v: string }).v, x);
          const k = this.num(this.eval(rest[2], inner), rest[2]);
          if (best === null || (head.v === 'min-by' ? k < score : k > score)) { best = x; score = k; }
        }
        return best;
      }
      case 'after': {
        const secs = this.num(this.eval(rest[0], env), rest[0]);
        this.host.schedule(secs, rest.slice(1), env, n);
        return null;
      }
    }
    const p = PRIM_BY_NAME.get(head.v);
    if (!p) throw new RuneError(`unknown spell word '${head.v}'`, head.line, head.col);
    const args = rest.map((r) => this.eval(r, env));
    p.args.forEach((spec, i) => {
      if (i < args.length) args[i] = this.coerce(args[i], spec.type, rest[i], `${p.name} ${spec.name}`);
    });
    if (p.variadic) for (let i = p.args.length; i < args.length; i++) args[i] = this.coerce(args[i], p.variadic, rest[i], p.name);
    if (p.kind === 'query') {
      this.burn(2, n);
      return this.host.query(p.name, args, n);
    }
    if (p.kind === 'effect' && isEffect(p.name)) {
      this.host.effect(p.name, args, n);
      return true;
    }
    return this.pure(p.name, args, n);
  }

  show(v: Value, budget = 120): string { return display(v, this.host.refName?.bind(this.host), budget); }

  private num(v: Value, at: Node): number {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new RuneError(`expected a number, got ${this.show(v)}`, at.line, at.col);
    return v;
  }

  private coerce(v: Value, type: ArgType, at: Node, what: string): Value {
    const bad = () => new RuneError(`${what}: expected ${type}, got ${this.show(v)} from ${show(at)}`, at.line, at.col);
    switch (type) {
      case 'num': if (typeof v !== 'number' || !Number.isFinite(v)) throw bad(); return v;
      case 'ent': if (!isRef(v)) throw bad(); return v;
      case 'vec': if (!isVec(v)) throw bad(); return v;
      case 'place': if (!isRef(v) && !isVec(v)) throw bad(); return v;
      case 'str': if (typeof v !== 'string') throw bad(); return v;
      case 'list': if (!Array.isArray(v)) throw bad(); return v;
      case 'elem': if (typeof v !== 'string' || !ELEMENT_SET.has(v)) throw new RuneError(`${what}: element must be one of :${[...ELEMENT_SET].join(' :')}`, at.line, at.col); return v;
      case 'any': return v;
    }
  }

  private pure(name: string, a: Value[], at: Node): Value {
    const n = a as number[];
    switch (name) {
      case '+': return n.reduce((s, x) => s + x, 0);
      case '-': return n.length === 1 ? -n[0] : n.slice(1).reduce((s, x) => s - x, n[0]);
      case '*': return n.reduce((s, x) => s * x, 1);
      case '/': return n[1] === 0 ? 0 : n[0] / n[1];
      case 'mod': return n[1] === 0 ? 0 : n[0] % n[1];
      case 'min': return Math.min(...n);
      case 'max': return Math.max(...n);
      case 'abs': return Math.abs(n[0]);
      case 'floor': return Math.floor(n[0]);
      case 'sqrt': return Math.sqrt(Math.max(0, n[0]));
      case 'clamp': return Math.min(n[2], Math.max(n[1], n[0]));
      case '<': return n[0] < n[1];
      case '>': return n[0] > n[1];
      case '<=': return n[0] <= n[1];
      case '>=': return n[0] >= n[1];
      case '=': return eq(a[0], a[1]);
      case 'not': return !truthy(a[0]);
      case 'list': this.burn(a.length, at); return a;
      case 'count': return (a[0] as Value[]).length;
      case 'first': return (a[0] as Value[])[0] ?? null;
      case 'nth': return (a[0] as Value[])[Math.floor(n[1])] ?? null;
      case 'vec': return vec(n[0], n[1]);
      case 'str': {
        let s = '';
        for (const x of a) { if (s.length >= 200) break; s += this.show(x, 200 - s.length); }
        return s.slice(0, 200);
      }
      case 'rand': return this.host.rand();
    }
    throw new RuneError(`no such word '${name}'`, at.line, at.col);
  }
}

function eq(x: Value, y: Value): boolean {
  if (isRef(x) && isRef(y)) return x.id === y.id;
  if (isVec(x) && isVec(y)) return x.x === y.x && x.z === y.z;
  return x === y;
}
