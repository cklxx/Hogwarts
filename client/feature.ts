import type * as THREE from 'three';

/**
 * A feature in the browser (the client half of src/kernel/feature.ts): the Duelling Club's slip and G key, Quidditch's
 * slip, P and F keys, balls and brooms. main.ts builds each one from CLIENT_FEATURES (client/features.ts) with the
 * same deps and walks them; a feature only fills in what it uses.
 */
export interface ClientDeps {
  send: (o: unknown) => void;
  toast: (t: string) => void;
  /** This feature's field of the latest snapshot (the kernel feature's `wire.key`). */
  wire: <T>(key: string) => T | undefined;
  myHandle: () => string;
  myHouse: () => string | null;
  myPos: () => { x: number; z: number } | null;
  camYaw: () => number;
  /** A wizard's display name / model position / facing, by handle. */
  nameOf: (handle: string | undefined) => string;
  posOf: (handle: string) => THREE.Vector3 | null;
  facingOf: (handle: string) => number;
}

export interface ClientFeature {
  id: string;
  /** 10 Hz: the HUD. */
  hud?(): void;
  /** A key the game has not used: true when this feature took it. */
  keydown?(e: KeyboardEvent): boolean;
  /** Every world event you receive (fresh = just happened; false = the backlog in the welcome). */
  onEvent?(e: { id: number; type: string; text: string; zh?: string }, fresh: boolean): void;
  /** A server message: true when it was this feature's. */
  onMessage?(msg: { t: string; [k: string]: unknown }): boolean;
  /** What F would do right here (a fireplace, …), or null; the first feature with one wins. */
  action?(): { label: string; x: number; z: number; y: number; act: () => void } | null;
  /** Every frame: the feature's things in the 3D world. */
  frame?(dt: number): void;
  /** Metres above the ground this wizard's model rides now (Quidditch brooms). */
  lift?(handle: string): number;
  /** Added to the scene once. */
  group?: THREE.Object3D;
}

export type ClientFeatureFactory = (d: ClientDeps) => ClientFeature;
