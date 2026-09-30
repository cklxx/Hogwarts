/**
 * The features the game is built from (kernel/feature.ts), in the order their hooks run. Add one here and the
 * kernel, the MCP server, the browser socket and the snapshot pick it up.
 */
import { CHAT_FEATURE } from './chat.js';
import { DARK_FEATURE } from './dark.js';
import { DUEL_FEATURE } from './duelclub.js';
import { EXAMS_FEATURE } from './exams-feature.js';
import type { Feature, FeatureSpell } from './feature.js';
import { registerPrims } from '../runes/primitives.js';
import { hookLists } from './feature.js';
import { MARKET_FEATURE } from './market.js';
import { QD_FEATURE } from './quidditch.js';
import { QUESTS_FEATURE } from './quests.js';
import { TRAVEL_FEATURE } from './travel.js';
import { WARD_FEATURE } from './ward.js';
import { WHEEL_FEATURE } from './wheel.js';

// the Duelling Club before Quidditch: an NPC in a duel is the duel's, even if it is also on a team
export const FEATURES: readonly Feature[] = [CHAT_FEATURE, MARKET_FEATURE, EXAMS_FEATURE, WHEEL_FEATURE, DUEL_FEATURE, QD_FEATURE, WARD_FEATURE, TRAVEL_FEATURE, QUESTS_FEATURE, DARK_FEATURE];
export const FEATURE_BY_ID: ReadonlyMap<string, Feature> = new Map(FEATURES.map((f) => [f.id, f]));
export const HOOKS = hookLists(FEATURES);

/** The features' own Runes primitives (kernel/magic.ts runs them), registered with the checker once. */
export const FEATURE_SPELLS: ReadonlyMap<string, FeatureSpell> = new Map(FEATURES.flatMap((f) => (f.spells ?? []).map((s) => [s.prim.name, s] as const)));
registerPrims([...FEATURE_SPELLS.values()].map((s) => s.prim));

/** What each feature tool costs in concentration (unfair.ts AGENT_TOOL_COST has the kernel's own tools). */
export const FEATURE_TOOL_COST: Readonly<Record<string, number>> = Object.fromEntries(FEATURES.flatMap((f) => (f.tools ?? []).map((t) => [t.name, t.cost])));
