/**
 * The features the game is built from (kernel/feature.ts), in the order their hooks run. Add one here and the
 * kernel, the MCP server, the browser socket and the snapshot pick it up.
 */
import { DUEL_FEATURE } from './duelclub.js';
import { EXAMS_FEATURE } from './exams-feature.js';
import type { Feature } from './feature.js';
import { hookLists } from './feature.js';
import { MARKET_FEATURE } from './market.js';
import { QD_FEATURE } from './quidditch.js';
import { WARD_FEATURE } from './ward.js';
import { WHEEL_FEATURE } from './wheel.js';

// the Duelling Club before Quidditch: an NPC in a duel is the duel's, even if it is also on a team
export const FEATURES: readonly Feature[] = [MARKET_FEATURE, EXAMS_FEATURE, WHEEL_FEATURE, DUEL_FEATURE, QD_FEATURE, WARD_FEATURE];
export const FEATURE_BY_ID: ReadonlyMap<string, Feature> = new Map(FEATURES.map((f) => [f.id, f]));
export const HOOKS = hookLists(FEATURES);

/** What each feature tool costs in concentration (unfair.ts AGENT_TOOL_COST has the kernel's own tools). */
export const FEATURE_TOOL_COST: Readonly<Record<string, number>> = Object.fromEntries(FEATURES.flatMap((f) => (f.tools ?? []).map((t) => [t.name, t.cost])));
