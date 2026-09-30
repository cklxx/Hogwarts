import type * as THREE from 'three';
import type { FeatureContext } from './context';

/**
 * A feature in the browser (the client half of src/kernel/feature.ts): the Duelling Club's slip and G key, Quidditch's
 * slip, P and F keys, balls and brooms, the Dark Mark, Dumbledore's Army (J), 偷师, the Restricted Section (R). main.ts
 * builds each one from CLIENT_FEATURES (client/features.ts) with the same deps and walks them; a feature only fills
 * in what it uses.
 */
export interface ClientDeps {
  send: (o: unknown) => void;
  toast: (t: string) => void;
  /** This feature's field of the latest snapshot (the kernel feature's `wire.key`). */
  wire: <T>(key: string) => T | undefined;
  /** Your own private state (`me`): the kernel's fields and each feature's `view.key`. */
  me: () => Record<string, any> | null;
  /** World time of the latest snapshot (s). */
  now: () => number;
  myHandle: () => string;
  /** You are watching your agent play (V): keys that act must leave it be. */
  observing: () => boolean;
  myHouse: () => string | null;
  myPos: () => { x: number; z: number } | null;
  camYaw: () => number;
  /** A wizard's display name / model position / facing / model root, by handle. */
  nameOf: (handle: string | undefined) => string;
  posOf: (handle: string) => THREE.Vector3 | null;
  facingOf: (handle: string) => number;
  rootOf: (handle: string) => THREE.Object3D | null;
  /** Show this sheet and close the others (controls.ts solo). */
  solo: (el: HTMLElement) => void;
  /** The spellbook: your spells (after the first {t:'book'}), ask for them, open it, put a source in its editor. */
  spells: () => { id: string; name: string; builtin: boolean; source: string }[];
  wantSpells: () => void;
  openBook: () => void;
  loadDraft: (name: string, source: string, note: string) => void;
  /** Cast one of your spells on yourself (Finite Incantatem, Revelio, …) as the hotbar would. */
  castOnSelf: (spell: string) => void;
  /** Every client feature (built once; for the ones that look across the others, like the 界面 layout). */
  features: () => readonly ClientFeature[];
}

/** A piece of the HUD the player may hide or move (client/ui.ts): an element id and its name. */
export interface ClientWidget { id: string; zh: string; en: string }

/** Something to do with F where you stand (controls.ts: the prompt over it). */
export interface ClientAction { label: string; x: number; z: number; y: number; act: () => void }

export interface ClientFeature {
  id: string;
  /** 10 Hz: the HUD. */
  hud?(): void;
  /** Markup for the stack at the top centre of the screen (ribbons, the veto card), or ''. */
  top?(): string;
  /** A key the game has not used: true when this feature took it (one that acts: not while `observing`). */
  keydown?(e: KeyboardEvent): boolean;
  /** Every world event you receive (fresh = just happened; false = the backlog in the welcome). */
  onEvent?(e: { id: number; type: string; text: string; zh?: string; to?: string }, fresh: boolean): void;
  /** Every server message, before anyone handles it (never takes it: to follow replies others asked for). */
  observe?(msg: { t: string; [k: string]: unknown }): void;
  /** A server message: true when it was this feature's. */
  onMessage?(msg: { t: string; [k: string]: unknown }): boolean;
  /** An error the server sent (translated): true when this feature showed it (it asked a moment ago). */
  onError?(text: string): boolean;
  /** Esc: close this feature's panel if it is open (true), topmost first. */
  close?(): boolean;
  /** Open what the next-goal line (client/play.ts GoalAct) points at, if it is this feature's (true). */
  open?(what: string): boolean;
  /** The next-goal line's view of this feature (fields of client/play.ts GoalState). */
  goal?(): Record<string, unknown>;
  /** What F would do right here (a page of a seal at its landmark, a fireplace, …), or null; the first feature with one wins. */
  action?(): ClientAction | null;
  /** A mark beside a wizard's name: text for the 3D name tag, markup for the parchment (`html`), or ''. */
  badge?(handle: string, html?: boolean): string;
  /** Lines for the leaderboard (L), from the kernel's leaderboard (its `view.board` fields). */
  board?(lb: Record<string, any>): string;
  /** Links in the Owl Post menu (Esc). */
  menu?(): string;
  /** Every frame: the feature's things in the 3D world. */
  frame?(dt: number): void;
  /** Something of this feature's on the ground at (x, z) that a click or tap casts the chosen spell at (its point), or
   *  null; `hover`: the pointer is only over it (show what it is). */
  claim?(x: number, z: number, hover: boolean): { x: number; z: number } | null;
  /** Metres above the ground this wizard's model rides now (Quidditch brooms). */
  lift?(handle: string): number;
  /** Added to the scene once. */
  group?: THREE.Object3D;
  /** The HUD elements this feature adds, for the 界面 layout (hide, move). */
  widgets?: readonly ClientWidget[];
}

/** A feature's factory: its lasting side effects go through `ctx` (client/context.ts), so a hot update can undo them. */
export type ClientFeatureFactory = (d: ClientDeps, ctx: FeatureContext) => ClientFeature;
