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
import { scenesFeature } from './scenes3d';
import { uiFeature } from './ui';

// the top stack reads in this order: the Dark Lord's ribbon, the lawless zone, the DA's vote card and joint Patronus
export const CLIENT_FEATURES: readonly ClientFeatureFactory[] = [
  darkLordFeature, lawlessFeature, daFeature, studyFeature, sealsFeature, chatFeature, duelFeature, quidditchFeature, wardFeature, travelFeature, questsFeature, darkFeature, trunkFeature, scenesFeature, uiFeature,
];

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
