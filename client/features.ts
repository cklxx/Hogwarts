/**
 * The browser's features (client/feature.ts), each the client half of a kernel feature (src/kernel/features.ts).
 * Add one here and main.ts runs its HUD, keys, messages, 3D and rider height.
 */
import type { ClientFeatureFactory } from './feature';
import { duelFeature } from './panels/duel';
import { questsFeature } from './panels/quests';
import { quidditchFeature } from './panels/quidditch';
import { travelFeature } from './panels/travel';

export const CLIENT_FEATURES: readonly ClientFeatureFactory[] = [duelFeature, quidditchFeature, travelFeature, questsFeature];
