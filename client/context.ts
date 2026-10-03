/**
 * 插件上下文 (after cordis, https://github.com/cordiverse/cordis: a plugin's side effects are recorded on its context,
 * so disposing the context undoes all of them, and a plugin can be replaced while the page keeps running).
 *
 * A client feature (client/feature.ts) is built with a FeatureContext and does every lasting thing through it: an
 * element it puts in the page (`el`, `own`), a listener on something it does not own (`on`), a timer (`timeout`,
 * `interval`), anything else (`effect`, which returns the undo). `dispose()` runs the undos in reverse. Listeners on
 * elements the feature owns go with the element; hooks the host calls (hud, frame, keydown …) need no undo.
 *
 * State survives a swap (cordis keeps state outside the plugin, in what outlives it; here the host does): `keep(name,
 * save, load, version)` hands what `save` returns to the host when the feature goes, and gives it to the next build's
 * `load` under the same key and name — a panel stays open, a reply already fetched stays shown. A new version of the
 * shape (`version` + 1) starts afresh instead of reading the old one. Kept state is plain data (JSON): a reload of the
 * whole page (FeatureHost.persist, when the core changed) carries it over too, through sessionStorage.
 *
 * FeatureHost keeps the running features in one array (main.ts walks it) and swaps one in place: dispose the old
 * context, build the new factory in a fresh one, put its 3D group in the scene. That is the client's hot update
 * (client/hot.ts): a new build that changed only feature chunks reloads those features, not the page.
 */
import type * as THREE from 'three';
import type { ClientDeps, ClientFeature } from './feature';

export type Undo = () => void;
/** A feature's kept state, by name: the data and the version of its shape. */
export type Kept = Map<string, { v: number; data: unknown }>;

export class FeatureContext {
  private undo: Undo[] = [];
  private alive = true;
  /** name -> save, run when the feature goes (or the page reloads) */
  readonly savers = new Map<string, { v: number; save: () => unknown }>();
  constructor(readonly key: string, private readonly kept: Kept = new Map()) {}
  /**
   * State that outlives this build of the feature: `load` gets what the last build's `save` returned (same name and
   * version), now; `save` runs when this build goes. Returns whether there was something to load.
   */
  keep<T>(name: string, save: () => T, load: (s: T) => void, version = 1): boolean {
    this.savers.set(name, { v: version, save });
    const prev = this.kept.get(name);
    if (!prev || prev.v !== version) return false;
    try { load(prev.data as T); return true; } catch (e) { console.warn(`feature ${this.key}: kept state ${name} did not load`, e); return false; }
  }
  /** What every `keep` would hand over now (the host calls it before a swap and a page reload). */
  collect(into: Kept) {
    for (const [name, s] of this.savers) { try { into.set(name, { v: s.v, data: s.save() }); } catch (e) { console.warn(`feature ${this.key}: state ${name} not saved`, e); } }
  }
  get active() { return this.alive; }
  /** Run `fn` now; what it returns (an undo) runs at dispose. Returns a function that undoes it early. */
  effect(fn: () => Undo | void): Undo {
    if (!this.alive) throw new Error(`feature ${this.key} is disposed`);
    const u = fn();
    if (!u) return () => {};
    let done = false;
    const once = () => { if (done) return; done = true; const i = this.undo.indexOf(once); if (i >= 0) this.undo.splice(i, 1); u(); };
    this.undo.push(once);
    return once;
  }
  /** addEventListener on something the feature does not own (document, window, a host element). */
  on<K extends keyof DocumentEventMap>(target: Document, type: K, fn: (e: DocumentEventMap[K]) => void, opts?: AddEventListenerOptions): Undo;
  on<K extends keyof WindowEventMap>(target: Window, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions): Undo;
  on(target: EventTarget, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions): Undo;
  on(target: EventTarget, type: string, fn: (e: never) => void, opts?: AddEventListenerOptions): Undo {
    const f = fn as unknown as EventListener;
    return this.effect(() => { target.addEventListener(type, f, opts); return () => target.removeEventListener(type, f, opts); });
  }
  /** An element the feature owns: removed from the page at dispose. */
  own<T extends Element>(el: T): T {
    this.effect(() => () => el.remove());
    return el;
  }
  /** Make an element (tag, id), place it (`put`), own it. */
  el<K extends keyof HTMLElementTagNameMap>(tag: K, id: string | null, put: (el: HTMLElementTagNameMap[K]) => void): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    if (id) el.id = id;
    put(el);
    return this.own(el);
  }
  timeout(fn: () => void, ms: number): Undo { return this.effect(() => { const t = setTimeout(fn, ms); return () => clearTimeout(t); }); }
  interval(fn: () => void, ms: number): Undo { return this.effect(() => { const t = setInterval(fn, ms); return () => clearInterval(t); }); }
  /** Undo everything, newest first. A second dispose does nothing. */
  dispose() {
    if (!this.alive) return;
    this.alive = false;
    for (const u of this.undo.splice(0).reverse()) { try { u(); } catch (e) { console.error(`dispose ${this.key}:`, e); } }
  }
}

export type FeatureFactory = (d: ClientDeps, ctx: FeatureContext) => ClientFeature;

/** Where the kept state waits across a page reload (this tab only; read once, then removed). */
export const KEPT_KEY = 'hw-feature-state';

export class FeatureHost {
  /** The running features, in their order (main.ts walks this very array: a swap keeps its place). */
  readonly list: ClientFeature[] = [];
  private readonly ctxs: FeatureContext[] = [];
  private readonly keys: string[] = [];
  /** Kept state by feature key (client/context.ts keep). */
  private readonly kept = new Map<string, Kept>();
  constructor(private readonly deps: ClientDeps, private readonly scene: THREE.Object3D, private readonly session: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = typeof sessionStorage === 'undefined' ? null : sessionStorage) {
    // a page reload by the hot update (the core changed) left the features' state here
    try {
      const raw = this.session?.getItem(KEPT_KEY);
      this.session?.removeItem(KEPT_KEY);
      if (raw) for (const [key, byName] of Object.entries(JSON.parse(raw) as Record<string, Record<string, { v: number; data: unknown }>>)) this.kept.set(key, new Map(Object.entries(byName)));
    } catch { /* private mode, or garbage: start afresh */ }
  }
  /** Before a page reload: every feature's kept state into sessionStorage, for the next page's features. */
  persist() {
    const out: Record<string, Record<string, { v: number; data: unknown }>> = {};
    this.ctxs.forEach((c, i) => { const m: Kept = new Map(); c.collect(m); if (m.size) out[this.keys[i]] = Object.fromEntries(m); });
    try { this.session?.setItem(KEPT_KEY, JSON.stringify(out)); } catch { /* private mode: the page starts afresh */ }
  }
  /** Build and start a feature under `key` (its module: 'panels/chat'). */
  add(key: string, factory: FeatureFactory) {
    const { f, ctx } = this.build(key, factory);
    this.list.push(f); this.ctxs.push(ctx); this.keys.push(key);
    return f;
  }
  /** Replace the feature built from `key` with `factory`'s: the old one's effects undone, the new one in its place. */
  reload(key: string, factory: FeatureFactory): boolean {
    const i = this.keys.indexOf(key);
    if (i < 0) return false;
    const kept = this.kept.get(key) ?? new Map();
    this.kept.set(key, kept);
    this.ctxs[i].collect(kept); // the old build hands its state over, then goes
    this.ctxs[i].dispose();
    const { f, ctx } = this.build(key, factory);
    this.list[i] = f; this.ctxs[i] = ctx;
    return true;
  }
  has(key: string) { return this.keys.includes(key); }
  private build(key: string, factory: FeatureFactory) {
    const ctx = new FeatureContext(key, this.kept.get(key));
    try {
      const f = factory(this.deps, ctx);
      if (f.group) { const g = f.group; ctx.effect(() => { this.scene.add(g); return () => { this.scene.remove(g); }; }); }
      return { f, ctx };
    } catch (e) {
      // a feature that throws while starting leaves nothing behind (and does not take the page down)
      ctx.dispose();
      console.error(`feature ${key} failed to start:`, e);
      return { f: { id: key } as ClientFeature, ctx: new FeatureContext(key) };
    }
  }
}
