/**
 * 客户端热更新: a new client build reaches a running page without a reload when only features changed.
 *
 * The build (vite.config.ts featureChunks) writes `hot.json`: each feature's chunk and factory export, and `core` — a
 * hash of everything else (the entry, the shared and vendor chunks, the CSS). When the server says there is a new
 * build (the welcome after a restart, or {t:'build'} pushed when dist/ changes), the page fetches the new manifest:
 *
 * - same `core`, only feature chunks differ → each changed feature is imported from its new file and swapped in place
 *   (FeatureHost.reload: the old one's DOM, listeners and timers undone, the new one built; the socket, the scene,
 *   the world state and every other feature untouched). The new chunk imports the very shared chunk this page runs,
 *   so there is one three.js, one i18n, one of everything.
 * - anything else (`core` changed, a feature added or dropped, a chunk that fails to load) → 'page': the caller falls
 *   back to the reload-when-idle note.
 *
 * In `npm run dev` Vite's HMR does the same for an edited feature module (client/features.ts accepts them).
 */
import type { FeatureFactory, FeatureHost } from './context';

export interface HotManifest { core: string; feats: Record<string, { url: string; export: string; init?: string }> }
export type HotResult = { kind: 'hot'; keys: string[] } | { kind: 'same' } | { kind: 'page'; why: string };

export async function fetchManifest(): Promise<HotManifest | null> {
  try {
    const r = await fetch('/hot.json', { cache: 'no-store' });
    if (!r.ok) return null;
    const m = await r.json() as HotManifest;
    return typeof m?.core === 'string' && m.feats && typeof m.feats === 'object' ? m : null;
  } catch { return null; }
}

/** What to do between two builds (pure: unit-tested). */
export function plan(now: HotManifest | null, next: HotManifest | null): { page: string } | { swap: string[] } {
  if (!now || !next) return { page: 'no manifest' };
  if (now.core !== next.core) return { page: 'core changed' };
  const a = Object.keys(now.feats), b = Object.keys(next.feats);
  if (a.length !== b.length || a.some((k) => !next.feats[k])) return { page: 'features added or removed' };
  return { swap: b.filter((k) => next.feats[k].url !== now.feats[k].url || next.feats[k].export !== now.feats[k].export) };
}

export function createHot(host: FeatureHost, load: (url: string) => Promise<Record<string, unknown>> = (url) => import(/* @vite-ignore */ url)) {
  // what this page runs: written into index.html by the build (vite.config.ts); none in `npm run dev`
  let current: HotManifest | null = null;
  try { current = JSON.parse(document.getElementById('hot-manifest')?.textContent ?? 'null') as HotManifest | null; } catch { current = null; }
  const ready = Promise.resolve();
  let running: Promise<HotResult> | null = null;
  async function update(): Promise<HotResult> {
    await ready;
    const next = await fetchManifest();
    const p = plan(current, next);
    if ('page' in p) return { kind: 'page', why: p.page };
    if (!p.swap.length) { current = next; return { kind: 'same' }; }
    // import them all first: one that fails to load leaves the page as it was
    const mods: [string, FeatureFactory][] = [];
    for (const k of p.swap) {
      const e = next!.feats[k];
      let f: unknown;
      try {
        const mod = await load(e.url);
        if (e.init && typeof mod[e.init] === 'function') (mod[e.init] as () => void)(); // the build's lazy module init (vite.config.ts)
        f = mod[e.export];
      } catch { return { kind: 'page', why: `${k} did not load` }; }
      if (typeof f !== 'function' || !host.has(k)) return { kind: 'page', why: `${k} has no factory` };
      mods.push([k, f as FeatureFactory]);
    }
    for (const [k, f] of mods) host.reload(k, f);
    current = next;
    return { kind: 'hot', keys: p.swap };
  }
  return {
    /** A new build was announced: swap what can be swapped (one update at a time). */
    update: () => (running ??= update().finally(() => { running = null; })),
  };
}
