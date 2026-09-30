/// <reference types="vite/client" />
/**
 * The browser's features (client/feature.ts), each the client half of a kernel feature (src/kernel/features.ts).
 * Add one here and main.ts runs its HUD, keys, messages, panels, 3D and rider height.
 */
import type { ClientFeature, ClientFeatureFactory } from './feature';
import { chatFeature } from './panels/chat';
import { daFeature } from './panels/da';
import { darkFeature } from './panels/dark';
import { darkLordFeature } from './panels/darkmark';
import { duelFeature } from './panels/duel';
import { lawlessFeature } from './panels/lawless';
import { questsFeature } from './panels/quests';
import { quidditchFeature } from './panels/quidditch';
import { sealsFeature } from './panels/seals';
import { studyFeature } from './panels/study';
import { travelFeature } from './panels/travel';
import { trunkFeature } from './panels/trunk';
import { wardFeature } from './panels/ward';
import { propsFeature } from './props3d';
import { scenesFeature } from './scenes3d';
import { uiFeature } from './ui';

/**
 * Each feature under the module it lives in (the key a hot update names: client/hot.ts, vite.config.ts featureChunks).
 * The top stack reads in this order: the Dark Lord's ribbon, the lawless zone, the DA's vote card and joint Patronus.
 */
export const CLIENT_FEATURES: readonly (readonly [string, ClientFeatureFactory])[] = [
  ['panels/darkmark', darkLordFeature], ['panels/lawless', lawlessFeature], ['panels/da', daFeature], ['panels/study', studyFeature],
  ['panels/seals', sealsFeature], ['panels/chat', chatFeature], ['panels/duel', duelFeature], ['panels/quidditch', quidditchFeature],
  ['panels/ward', wardFeature], ['panels/travel', travelFeature], ['panels/quests', questsFeature], ['panels/dark', darkFeature],
  ['panels/trunk', trunkFeature], ['scenes3d', scenesFeature], ['props3d', propsFeature], ['ui', uiFeature],
];

/** npm run dev: an edited feature module arrives here (Vite HMR); main.ts swaps it in (FeatureHost.reload). */
let featureHot: ((key: string, mk: ClientFeatureFactory) => void) | null = null;
export const setFeatureHot = (f: typeof featureHot) => { featureHot = f; };
if (import.meta.hot) {
  // (the literal list Vite needs, in CLIENT_FEATURES' order)
  import.meta.hot.accept([
    './panels/darkmark', './panels/lawless', './panels/da', './panels/study', './panels/seals', './panels/chat', './panels/duel', './panels/quidditch',
    './panels/ward', './panels/travel', './panels/quests', './panels/dark', './panels/trunk', './scenes3d', './props3d', './ui',
  ], (mods) => {
    mods.forEach((m, i) => {
      if (!m) return;
      const [key, old] = CLIENT_FEATURES[i];
      const mk = (m as Record<string, unknown>)[old.name];
      if (typeof mk === 'function') featureHot?.(key, mk as ClientFeatureFactory);
    });
  });
}

/** The stack at the top centre, under the target frame (#pn-top): every feature's `top`, in order. */
export function renderTop(feats: readonly ClientFeature[]) {
  const hud = document.getElementById('hud');
  if (!hud) return;
  let el = document.getElementById('pn-top');
  if (!el) { el = document.createElement('div'); el.id = 'pn-top'; hud.append(el); }
  const html = feats.map((f) => f.top?.() ?? '').join('');
  if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; }
  el.hidden = !html;
}
