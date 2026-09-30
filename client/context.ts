/**
 * 插件上下文 (after cordis, https://github.com/cordiverse/cordis: a plugin's side effects are recorded on its context,
 * so disposing the context undoes all of them, and a plugin can be replaced while the page keeps running).
 *
 * A client feature (client/feature.ts) is built with a FeatureContext and does every lasting thing through it: an
 * element it puts in the page (`el`, `own`), a listener on something it does not own (`on`), a timer (`timeout`,
 * `interval`), anything else (`effect`, which returns the undo). `dispose()` runs the undos in reverse. Listeners on
 * elements the feature owns go with the element; hooks the host calls (hud, frame, keydown …) need no undo.
 *
 * FeatureHost keeps the running features in one array (main.ts walks it) and swaps one in place: dispose the old
 * context, build the new factory in a fresh one, put its 3D group in the scene. That is the client's hot update
 * (client/hot.ts): a new build that changed only feature chunks reloads those features, not the page.
 */
import type * as THREE from 'three';
import type { ClientDeps, ClientFeature } from './feature';

export type Undo = () => void;

export class FeatureContext {
  private undo: Undo[] = [];
  private alive = true;
  constructor(readonly key: string) {}
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

export class FeatureHost {
  /** The running features, in their order (main.ts walks this very array: a swap keeps its place). */
  readonly list: ClientFeature[] = [];
  private readonly ctxs: FeatureContext[] = [];
  private readonly keys: string[] = [];
  constructor(private readonly deps: ClientDeps, private readonly scene: THREE.Object3D) {}
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
    this.ctxs[i].dispose();
    const { f, ctx } = this.build(key, factory);
    this.list[i] = f; this.ctxs[i] = ctx;
    return true;
  }
  has(key: string) { return this.keys.includes(key); }
  private build(key: string, factory: FeatureFactory) {
    const ctx = new FeatureContext(key);
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
