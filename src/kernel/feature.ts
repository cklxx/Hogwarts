/**
 * 功能插件 (Feature): a self-contained piece of the game — the Duelling Club, Quidditch, the event wheel — that plugs
 * into the kernel, the MCP server, the browser socket and the client through one interface instead of hooks
 * scattered across world.ts, mcp/server.ts, server/main.ts and client/main.ts.
 *
 * A feature adds its own state to World by declaration merging and sets it in `init`:
 *
 *   declare module './world.js' { interface World { duel: DuelClub } }
 *   export const DUEL_FEATURE: Feature = { id: 'duel', init: (w) => { w.duel = newDuelClub(); }, step: stepDuelClub, … };
 *
 * and is listed once in features.ts. Everything here is optional; a hook costs nothing when a feature leaves it out
 * (World keeps one list per hook, built once).
 */
import type { z } from 'zod';
import type { Line } from '../lore/memes.js';
import type { UiCharm } from '../shared/constants.js';
import type { Rulebook } from './rulebook.js';
import type { Projectile, Wizard } from './types.js';
import type { World } from './world.js';

/** An MCP tool a feature brings (mcp/server.ts registers them all; `me` sessions only). */
export interface FeatureTool {
  name: string;
  title: string;
  description: string;
  input: Record<string, z.ZodTypeAny>;
  /** Concentration it spends (rules.agents); 0 for reading. */
  cost: number;
  /** Changes nothing (MCP readOnlyHint). */
  readOnly?: boolean;
  /** Works for a session with no wizard bound yet (`wid` is then null). */
  anonymous?: boolean;
  run(world: World, wid: string, args: Record<string, unknown>): unknown;
  /** For an `anonymous` tool: the call when no wizard is bound. */
  runAnon?(world: World, wid: string | null, args: Record<string, unknown>): unknown;
}

export interface Feature {
  id: string;
  /** Set up this feature's state on a new World (and on a restored one, before `load`). */
  init?(world: World): void;
  /** Every tick (20 Hz), after the NPCs think and before spells and creatures move. */
  step?(world: World, dt: number): void;
  /** Every tick, at its end: after creatures and housekeeping, just before the term clock. */
  stepLate?(world: World, dt: number): void;
  /** Once a second, in the kernel's housekeeping (after curses wear off and questions expire, before the flavour lines). */
  sweep?(world: World): void;
  /** Its field of the snapshot every client gets (`key`: undefined leaves it out of this snapshot). */
  wire?: { key: string; get(world: World): unknown };
  /**
   * Its field (`key`) of the views of one wizard: `me` — your own, in the browser's private state (resent whenever
   * it changes, so keep it steady) and in MCP whoami (`whoami` instead, when that may say more); `look` — what
   * anyone sees of wizard `x` in MCP look; `board` — fields it adds to the leaderboard. undefined leaves a key out.
   */
  view?: {
    key: string;
    me?(world: World, w: Wizard): unknown;
    whoami?(world: World, w: Wizard): unknown;
    look?(world: World, x: Wizard): unknown;
    board?(world: World): Record<string, unknown>;
  };
  /** What survives a restart (world.json `features[id]`); `load` gets it back (or undefined for an old save). */
  save?(world: World): unknown;
  load?(world: World, data: unknown, legacy: Record<string, unknown>): void;
  /** Movement: a multiplier on this wizard's speed (0 holds them still). */
  moveMult?(world: World, w: Wizard): number;
  /** Casting: a reason this wizard may not cast right now (both languages), else null. */
  castBlock?(world: World, w: Wizard): string | null;
  /** Healing and shielding: true when `src` may not help `dst` right now. */
  helpBlock?(world: World, src: Wizard, dst: Wizard): boolean;
  /** A spell in flight, every tick. */
  bolt?(world: World, p: Projectile): void;
  /**
   * A spell landing on `dstId` — its damage (`dmg`; not damage over time), or a root or disarm — from `by` (the
   * attacker, or a summon's owner; `src` when a wizard cast it themselves): a multiplier on the damage (1 for none).
   */
  hit?(world: World, by: string | null, src: Wizard | undefined, dstId: string, tags: readonly string[], dmg: boolean): number;
  /**
   * A price on this wizard's head: a stun by another wizard takes the larger share of their reputation
   * (progression.ts stealPct, the Dark Lord's) and is announced ('dark') with a line from the pool ({name}, {k}, {n}).
   */
  bounty?(world: World, w: Wizard): readonly Line[] | null;
  /** The Rulebook was replaced: by `minister`'s decree, or (null) put back by a veto. */
  rules?(world: World, before: Rulebook, minister: Wizard | null): void;
  /** A reveal charm cast on yourself (Revelio): what it also shows you. */
  reveal?(world: World, w: Wizard, charm: UiCharm): void;
  /** A hostile bolt or disarm reaching wizard `w` without a perfect Protego: true to meet it with one now (it is sent back). */
  parry?(world: World, w: Wizard, p: Projectile): boolean;
  /** An NPC thinking (twice a second): true when this feature drove it (the NPC's own brain then rests). */
  npc?(world: World, w: Wizard): boolean;
  /** MCP tools. */
  tools?: FeatureTool[];
  /** Browser messages {t: id, …}: the reply is sent back as {t: id, r}. */
  ws?(world: World, wid: string, msg: Record<string, unknown>): unknown;
}

/** The hooks, one list each, so a tick only walks the features that have them. */
export function hookLists(fs: readonly Feature[]) {
  const has = <K extends keyof Feature>(k: K) => fs.filter((f) => f[k] !== undefined) as (Feature & Required<Pick<Feature, K>>)[];
  const view = <K extends keyof NonNullable<Feature['view']>>(k: K) => fs.filter((f) => f.view?.[k] !== undefined) as (Feature & { view: Required<Pick<NonNullable<Feature['view']>, K | 'key'>> })[];
  return {
    step: has('step'), stepLate: has('stepLate'), sweep: has('sweep'), load: has('load'), wire: has('wire'), save: has('save'), moveMult: has('moveMult'),
    castBlock: has('castBlock'), helpBlock: has('helpBlock'), bolt: has('bolt'), parry: has('parry'), hit: has('hit'), bounty: has('bounty'), rules: has('rules'), reveal: has('reveal'),
    npc: has('npc'), me: view('me'), whoami: fs.filter((f) => f.view?.me || f.view?.whoami) as (Feature & { view: NonNullable<Feature['view']> })[],
    look: view('look'), board: view('board'),
  };
}
