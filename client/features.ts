/**
 * The browser's features (client/feature.ts), each the client half of a kernel feature (src/kernel/features.ts).
 * Add one here and main.ts runs its HUD, keys, messages, 3D and rider height.
 */
import type { ClientFeatureFactory } from './feature';
import { chatFeature } from './panels/chat';
import { darkFeature } from './panels/dark';
import { duelFeature } from './panels/duel';
import { questsFeature } from './panels/quests';
import { quidditchFeature } from './panels/quidditch';
import { travelFeature } from './panels/travel';
import { wardFeature } from './panels/ward';

export const CLIENT_FEATURES: readonly ClientFeatureFactory[] = [chatFeature, duelFeature, quidditchFeature, wardFeature, travelFeature, questsFeature, darkFeature];
