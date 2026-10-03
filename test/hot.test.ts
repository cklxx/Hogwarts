/**
 * 客户端热更新 (client/context.ts, client/hot.ts, vite.config.ts featureChunks): a feature's side effects are undone
 * with its context; the host swaps a feature in place; a new build swaps only when nothing but features changed; the
 * dev HMR list matches the registry.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { FeatureContext, FeatureHost, KEPT_KEY } from '../client/context.js';
import { plan, type HotManifest } from '../client/hot.js';
import type { ClientDeps } from '../client/feature.js';

const fakeEl = () => { const e = { gone: false, remove() { e.gone = true; } }; return e as unknown as Element & { gone: boolean }; };

describe('a feature context undoes what it did', () => {
  it('listeners, owned elements, timers and effects go at dispose (newest first); an early undo runs once', () => {
    const ctx = new FeatureContext('panels/x');
    const bus = new EventTarget();
    let hits = 0, ticks = 0;
    const order: string[] = [];
    ctx.on(bus, 'ping', () => { hits++; });
    const el = ctx.own(fakeEl());
    vi.useFakeTimers();
    ctx.interval(() => { ticks++; }, 10);
    ctx.effect(() => () => order.push('a'));
    ctx.effect(() => () => order.push('b'));
    const early = ctx.effect(() => () => order.push('early'));
    early(); early();
    bus.dispatchEvent(new Event('ping'));
    vi.advanceTimersByTime(35);
    expect([hits, ticks]).toEqual([1, 3]);
    ctx.dispose();
    bus.dispatchEvent(new Event('ping'));
    vi.advanceTimersByTime(50);
    vi.useRealTimers();
    expect([hits, ticks, el.gone]).toEqual([1, 3, true]);
    expect(order).toEqual(['early', 'b', 'a']);
    expect(ctx.active).toBe(false);
    expect(() => ctx.effect(() => {})).toThrow(/disposed/);
    ctx.dispose(); // twice: nothing
  });
});

describe('the host swaps a feature in place', () => {
  it('same slot in the list, the old one undone, its 3D group out of the scene and the new one in', () => {
    const scene = { kids: new Set<unknown>(), add(o: unknown) { this.kids.add(o); }, remove(o: unknown) { this.kids.delete(o); } };
    const host = new FeatureHost({} as ClientDeps, scene as never);
    const bus = new EventTarget();
    let v1 = 0, v2 = 0;
    const g1 = { name: 'g1' }, g2 = { name: 'g2' };
    host.add('panels/a', () => ({ id: 'a' }));
    host.add('panels/b', (_d, ctx) => { ctx.on(bus, 'x', () => { v1++; }); return { id: 'b', group: g1 as never }; });
    host.add('panels/c', () => ({ id: 'c' }));
    const list = host.list;
    expect(scene.kids.has(g1)).toBe(true);
    expect(host.reload('panels/b', (_d, ctx) => { ctx.on(bus, 'x', () => { v2++; }); return { id: 'b2', group: g2 as never }; })).toBe(true);
    expect(host.list).toBe(list);
    expect(list.map((f) => f.id)).toEqual(['a', 'b2', 'c']);
    bus.dispatchEvent(new Event('x'));
    expect([v1, v2]).toEqual([0, 1]);
    expect([scene.kids.has(g1), scene.kids.has(g2)]).toEqual([false, true]);
    expect(host.reload('panels/nope', () => ({ id: 'n' }))).toBe(false);
  });

  it('a feature that throws while starting leaves nothing and does not take the others down', () => {
    const host = new FeatureHost({} as ClientDeps, { add() {}, remove() {} } as never);
    const el = fakeEl();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    host.add('panels/bad', (_d, ctx) => { ctx.own(el); throw new Error('boom'); });
    spy.mockRestore();
    expect(el.gone).toBe(true);
    expect(host.list.map((f) => f.id)).toEqual(['panels/bad']);
  });
});

describe('a new build: swap or reload', () => {
  const m = (core: string, feats: Record<string, string>): HotManifest => ({ core, feats: Object.fromEntries(Object.entries(feats).map(([k, url]) => [k, { url, export: `${k}Feature` }])) });
  it('only feature chunks changed → those; the core changed, a feature came or went, no manifest → the page', () => {
    const a = m('c1', { chat: '/a/chat-1.js', duel: '/a/duel-1.js' });
    expect(plan(a, m('c1', { chat: '/a/chat-2.js', duel: '/a/duel-1.js' }))).toEqual({ swap: ['chat'] });
    expect(plan(a, a)).toEqual({ swap: [] });
    expect(plan(a, m('c2', { chat: '/a/chat-1.js', duel: '/a/duel-1.js' }))).toEqual({ page: 'core changed' });
    expect(plan(a, m('c1', { chat: '/a/chat-1.js' }))).toHaveProperty('page');
    expect(plan(a, m('c1', { chat: '/a/chat-1.js', duel: '/a/duel-1.js', quidditch: '/a/q.js' }))).toHaveProperty('page');
    expect(plan(null, a)).toHaveProperty('page');
  });
});

describe('the registry and the dev HMR list agree', () => {
  it("features.ts's accept list names CLIENT_FEATURES' modules in their order, and the build reads the same keys", () => {
    const src = readFileSync('client/features.ts', 'utf8');
    const keys = [...src.matchAll(/\['([\w/]+)', \w+\]/g)].map((x) => x[1]);
    const accepted = [...src.slice(src.indexOf('import.meta.hot.accept(')).matchAll(/'\.\/([\w/]+)'/g)].map((x) => x[1]);
    expect(keys.length).toBeGreaterThan(10);
    expect(accepted).toEqual(keys);
  });
});

describe('state survives a swap and a page reload (FeatureContext.keep)', () => {
  const noScene = { add() {}, remove() {} } as never;
  const counter = (version = 1) => (_d: ClientDeps, ctx: FeatureContext) => {
    let n = 0, open = false;
    ctx.keep('view', () => ({ n, open }), (s) => { n = s.n; open = s.open; }, version);
    return { id: 'c', hud() { n++; }, badge: () => `${n}${open ? '+' : ''}`, open(what: string) { open = what === 'on'; return true; } };
  };
  it('a swap hands the old build state to the new one; a new version of the shape starts afresh', () => {
    const host = new FeatureHost({} as ClientDeps, noScene, null);
    host.add('panels/c', counter());
    const f = () => host.list[0];
    f().hud!(); f().hud!(); f().open!('on');
    expect(f().badge!('x')).toBe('2+');
    host.reload('panels/c', counter());
    expect(f().badge!('x')).toBe('2+');
    f().hud!();
    host.reload('panels/c', counter(2)); // the shape changed: nothing carried over
    expect(f().badge!('x')).toBe('0');
  });

  it('persist() before a page reload; the next page (a new host) reads it once, then it is gone', () => {
    const store = new Map<string, string>();
    const session = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
    const a = new FeatureHost({} as ClientDeps, noScene, session);
    a.add('panels/c', counter());
    a.list[0].hud!(); a.list[0].hud!(); a.list[0].hud!();
    a.persist();
    expect(store.has(KEPT_KEY)).toBe(true);
    const b = new FeatureHost({} as ClientDeps, noScene, session);
    b.add('panels/c', counter());
    expect(b.list[0].badge!('x')).toBe('3');
    expect(store.has(KEPT_KEY)).toBe(false);
    const c = new FeatureHost({} as ClientDeps, noScene, session);
    c.add('panels/c', counter());
    expect(c.list[0].badge!('x')).toBe('0');
  });

  it('a save that throws loses only that state; a load that throws starts it afresh', () => {
    const host = new FeatureHost({} as ClientDeps, noScene, null);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let got = 'none';
    host.add('panels/d', (_d, ctx) => { ctx.keep('bad', () => { throw new Error('no'); }, () => {}); ctx.keep('good', () => 'kept', () => {}); return { id: 'd' }; });
    host.reload('panels/d', (_d, ctx) => { ctx.keep('good', () => '', (s) => { got = s; }); ctx.keep('bad', () => 1, () => { throw new Error('boom'); }); return { id: 'd2' }; });
    warn.mockRestore();
    expect(got).toBe('kept');
    expect(host.list[0].id).toBe('d2');
  });
});
