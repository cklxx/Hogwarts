/**
 * The browser's features (client/feature.ts), each the client half of a kernel feature (src/kernel/features.ts).
 * Add one here and main.ts runs its HUD, keys, messages, 3D and rider height.
 */
import type { ClientFeatureFactory } from './feature';
import { chatFeature } from './panels/chat';
import { duelFeature } from './panels/duel';
import { quidditchFeature } from './panels/quidditch';

export const CLIENT_FEATURES: readonly ClientFeatureFactory[] = [chatFeature, duelFeature, quidditchFeature];
