/**
 * The features the game is built from (kernel/feature.ts), in the order their hooks run. Add one here and the
 * kernel, the MCP server, the browser socket and the snapshot pick it up.
 */
import { CHAT_FEATURE } from './chat.js';
import { DARK_FEATURE } from './dark.js';
import { DUEL_FEATURE } from './duelclub.js';
import { ENDGAME_FEATURE } from './endgame.js';
import { EXAMS_FEATURE } from './exams-feature.js';
import type { Feature, FeatureSpell } from './feature.js';
import type { World } from './world.js';
import { registerPrims } from '../runes/primitives.js';
import { hookLists } from './feature.js';
import { MARKET_FEATURE } from './market.js';
import { MEMETAGS_FEATURE } from './memetags.js';
import { PROPS_FEATURE } from './props.js';
import { CHEM_FEATURE } from './chem.js';
import { RUNES_FEATURE } from './runes.js';
import { ENCOUNTERS_FEATURE } from './encounters.js';
import { ICE_FEATURE } from './ice.js';
import { LOOT_FEATURE } from './loot.js';
import { FOCUS_FEATURE } from './focus.js';
import { METRICS_FEATURE } from './metrics.js';
import { QD_FEATURE } from './quidditch.js';
import { POSSESS_FEATURE } from './possess.js';
import { QUESTS_FEATURE } from './quests.js';
import { REFLEX_FEATURE } from './reflexes.js';
import { SCENES_FEATURE } from './scenes.js';
import { SEALS_FEATURE } from './seals.js';
import { TRAVEL_FEATURE, TRAVEL_STAMINA_FEATURE } from './travel.js';
import { DA_FEATURE, DARK_LORD_FEATURE, LAWLESS_FEATURE, STUDY_FEATURE } from './unfair.js';
import { WARD_FEATURE } from './ward.js';
import { WARWEEK_FEATURE } from './warweek.js';
import { FATES_FEATURE } from './fates.js';
import { WHEEL_FEATURE } from './wheel.js';

// 不公平，但好玩 first, in its old order (the Dark Mark, the lawless zone, then the DA: the 1 Hz sweep's lines keep
// theirs); the Duelling Club before Quidditch: an NPC in a duel is the duel's, even if it is also on a team
export const FEATURES: readonly Feature[] = [
  DARK_LORD_FEATURE, LAWLESS_FEATURE, DA_FEATURE, STUDY_FEATURE, SEALS_FEATURE,
  CHAT_FEATURE, MARKET_FEATURE, EXAMS_FEATURE, WHEEL_FEATURE, DUEL_FEATURE, QD_FEATURE, WARD_FEATURE, TRAVEL_FEATURE, TRAVEL_STAMINA_FEATURE, QUESTS_FEATURE, ENDGAME_FEATURE, DARK_FEATURE, REFLEX_FEATURE, POSSESS_FEATURE, METRICS_FEATURE, SCENES_FEATURE, MEMETAGS_FEATURE, PROPS_FEATURE, CHEM_FEATURE, RUNES_FEATURE, ICE_FEATURE, ENCOUNTERS_FEATURE, LOOT_FEATURE, FOCUS_FEATURE, WARWEEK_FEATURE, FATES_FEATURE,
];
export const FEATURE_BY_ID: ReadonlyMap<string, Feature> = new Map(FEATURES.map((f) => [f.id, f]));
export const HOOKS = hookLists(FEATURES);
/** Whom `wid`'s actions move right now: a feature's vessel (actAs), else themselves. */
export function actingAs(world: World, wid: string): string {
  for (const f of HOOKS.actAs) { const v = f.actAs(world, wid); if (v && world.wizards.has(v)) return v; }
  return wid;
}
/** Why `wid` may not use MCP tool `tool` right now, else null. */
export const toolBlocked = (world: World, wid: string, tool: string) => { for (const f of HOOKS.toolBlock) { const r = f.toolBlock(world, wid, tool); if (r) return r; } return null; };

/** The features' own Runes primitives (kernel/magic.ts runs them), registered with the checker once. */
export const FEATURE_SPELLS: ReadonlyMap<string, FeatureSpell> = new Map(FEATURES.flatMap((f) => (f.spells ?? []).map((s) => [s.prim.name, s] as const)));
registerPrims([...FEATURE_SPELLS.values()].map((s) => s.prim));

/**
 * 专注力: what each of the kernel's own MCP tools costs in concentration (a feature's tools carry their `cost`).
 * Tools not listed (reading, talking to your human, waiting, identity) are free; so is everything a browser sends.
 */
export const AGENT_TOOL_COST: Readonly<Record<string, number>> = {
  cast: 1, use_item: 1, move_to: 1, dodge: 1, say: 1, set_hotbar: 1, unlearn_spell: 1, equip_item: 1, unequip_item: 1, destroy_item: 1,
  forge_spell: 3, forge_item: 3, decree: 1,
  // 隐藏宝箱: opening one is an action (reading school_events and frog_cards is free)
  open_chest: 1,
};
/** What each feature tool costs. */
export const FEATURE_TOOL_COST: Readonly<Record<string, number>> = Object.fromEntries(FEATURES.flatMap((f) => (f.tools ?? []).map((t) => [t.name, t.cost])));
