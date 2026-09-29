/** set! (Runes special form, year 4): an accumulator — rebind an existing name in the nearest block that has it. */
import { describe, expect, it } from 'vitest';
import { tr } from '../client/i18n';
import { analyze } from '../src/runes/checker.js';
import { Env, Interp, type RuneHost, type Value } from '../src/runes/interp.js';
import { World } from '../src/kernel/world.js';
import type { Creature } from '../src/kernel/types.js';

/** A host that only says things: `(say x)` records x. */
function run(src: string, gas = 1000) {
  const said: Value[] = [];
  const host: RuneHost = { query: () => null, effect: (_n, a) => { said.push(a[0]); }, schedule: () => {}, rand: () => 0.5 };
  const i = new Interp(host, gas);
  const last = i.run(analyze(src).program, new Env());
  return { said, last, gas: i.gasUsed };
}
const errOf = (f: () => unknown) => { try { f(); } catch (e) { return (e as Error).message; } throw new Error('did not throw'); };

describe('set!', () => {
  it('is fourth-year magic, like min-by (the third-year weakest-link has "no accumulator")', () => {
    expect(analyze('(let n 0) (set! n 1)').minYear).toBe(4);
    expect(errOf(() => analyze('(let n 0) (set! n 1)', { year: 3, maxNodes: 999 }))).toMatch(/needs year 4 magic \(set!\); you are year 3/);
    expect(analyze('(let n 0) (set! n 1)', { year: 4, maxNodes: 999 }).minYear).toBe(4);
    // after keeps its own year, and the error names every late form
    expect(errOf(() => analyze('(let n 0) (after 1 (set! n 1))', { year: 1, maxNodes: 999 }))).toMatch(/needs year 4 magic \(after, set!\)/);
  });

  it('rebinds the nearest binding and returns the new value', () => {
    expect(run('(let n 1) (set! n (+ n 41))').last).toBe(42);
    // an accumulator over a loop: the outer n, not a copy per iteration
    expect(run('(let n 0) (repeat 4 (set! n (+ n i))) (say n)').said).toEqual([6]);
    expect(run('(let best 99) (each x (list 5 3 8) (when (< x best) (set! best x))) (say best)').said).toEqual([3]);
    // the nearest block wins: a do's own let shadows the outer one, which stays as it was
    expect(run('(let n 1) (do (let n 10) (set! n 20) (say n)) (say n)').said).toEqual([20, 1]);
    // loop variables are bindings too (each iteration has its own)
    expect(run('(repeat 2 (set! i (* i 10)) (say i))').said).toEqual([0, 10]);
  });

  it('costs gas like any other form (1 for the form, plus its expression)', () => {
    const a = run('(let n 0) (let m 0)').gas;
    const b = run('(let n 0) (set! n 0)').gas;
    expect(b).toBe(a);
  });

  it('refuses built-ins and unbound names, with a position, in both languages', () => {
    for (const name of ['self', 'target', 'aim', 'object', 'pi', 'nil', 'bolt', 'each']) {
      const m = errOf(() => analyze(`(set! ${name} 1)`));
      expect(m, name).toMatch(new RegExp(`set! cannot change '${name}': it is built in.*\\(line 1, col 7\\)`));
      expect(tr(m)).toMatch(/set! 不能改.*内置.*（第 1 行，第 7 列）/);
    }
    const u = errOf(() => analyze('(let n 0)\n(set! m 1)'));
    expect(u).toMatch(/set! needs an existing binding: 'm' is unbound.*\(line 2, col 7\)/);
    expect(tr(u)).toMatch(/set! 只能改已有的名字：「m」还没定义/);
    // a let later in the spell does not count, nor one inside a block that has closed
    expect(() => analyze('(set! n 1) (let n 0)')).toThrow(/unbound/);
    expect(() => analyze('(do (let n 0)) (set! n 1)')).toThrow(/unbound/);
    expect(errOf(() => analyze('(set! 3 4)'))).toMatch(/^\(set! name expr\)/);
    expect(tr(errOf(() => analyze('(set! n)')))).toMatch(/写法不对，应该是 \(set! name expr\)/);
  });

  it('works in a real cast: the weakest foe with an accumulator; a delayed block sees the latest value', () => {
    const w = new World({ seed: 5, secret: 'set' });
    w.rules.creatures.spawnMultiplier = 0;
    const me = w.enroll('Accumulator').wizard;
    me.connections = 1; me.year = 4; me.pos = { x: 60, z: 60 };
    const mob = (id: string, x: number, z: number, hp: number) => {
      const c: Creature = { id, kind: 'pixie', pos: { x, z }, home: { x, z }, hp, maxHp: 100, facing: 0, target: null, attackCd: 1e9, rootedUntil: 1e9, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
      w.creatures.set(id, c);
    };
    mob('c_a', 60, 64, 40); mob('c_b', 60, 72, 12); mob('c_c', 66, 60, 90);
    const r = w.simulate(me.id, '(let t nil) (each e (enemies 30) (when (or (not t) (< (hp e) (hp t))) (set! t e))) (say (str (hp t)))');
    expect(r.ok, r.error).toBe(true);
    expect(r.effects[0]).toMatch(/say "12"/);
    // a delayed block closes over the cast's bindings: it sees the value the cast left (simulate plans it)
    expect(w.simulate(me.id, '(let n 1) (after 1 (say (str n))) (set! n 2)').effects).toEqual(['t+1s: say "2" (0 mana)']);
  });
});
