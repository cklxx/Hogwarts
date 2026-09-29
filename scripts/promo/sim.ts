/**
 * The film's world, run by the real kernel (src/kernel/world.ts) on a fixed virtual clock.
 *
 * `stage()` enrols the cast through the kernel's own syscalls (enroll, gainXp, forgeSpell, cast) and returns
 * the serialised world: the render script writes it to HOGWARTS_DATA so the real server (which serves the
 * client and answers the login gate) has exactly this cast. `record()` restores that world once per shot,
 * sets the scene, runs the shot's choreography tick by tick (20 Hz, like the server) and records what the
 * server would broadcast every 100 ms — `{t:'snap', s: world.snapshot()}` — as a tape the page plays back
 * in virtual time. No wall clock is involved anywhere, so every render is the same film.
 */
import { TICK, World } from '../../src/kernel/world.js';
import { XP_FOR_YEAR, derived } from '../../src/kernel/progression.js';
import type { Creature, Wizard } from '../../src/kernel/types.js';
import type { CreatureKind, House } from '../../src/shared/constants.js';
import { CREATURES } from '../../src/kernel/creatures.js';

export type V3 = [number, number, number];
export interface Cam { pos: V3; look: V3; fov?: number }

export interface Actor { name: string; house: House; year: number; seals?: number; look?: string }
/** One line of choreography: at shot time `t` (seconds), do something to the world. */
export type Cue = [t: number, act: (s: Stage) => void];

export interface ShotDef {
  id: string;
  /** Seconds on screen (without the cross-fade tail the renderer adds). */
  dur: number;
  /** In-game hour (0..24) the shot is set at. */
  hour: number;
  weather?: 'clear' | 'rain' | 'snow' | 'fog';
  /** Actors on stage: key -> where they stand and which way they face (radians; 0 = -z). */
  cast: Record<string, { x: number; z: number; f?: number }>;
  creatures?: { id: string; kind: CreatureKind; x: number; z: number; f?: number; hp?: number }[];
  /** Rulebook aesthetics in force at the start (a decree cue can change them). */
  aesthetics?: Record<string, unknown>;
  cues?: Cue[];
  /** Camera at shot time t. */
  camera: (t: number) => Cam;
}

/** Everything a cue may touch. Actors are addressed by their key in the cast list. */
export class Stage {
  constructor(readonly world: World, private readonly ids: Record<string, string>) {}
  w(key: string): Wizard { const w = this.world.wizards.get(this.ids[key]); if (!w) throw new Error(`no actor ${key}`); return w; }
  c(id: string): Creature { const c = this.world.creatures.get(id); if (!c) throw new Error(`no creature ${id}`); return c; }
  handle(key: string) { return this.w(key).handle; }
  /** Rest the wand and fill the mana, so choreography never trips on cooldowns. */
  ready(key: string) {
    const w = this.w(key);
    w.cooldowns = {}; w.globalCd = 0;
    w.mana = derived(w, this.world.rules).maxMana;
    return w;
  }
  /** Cast a spell the actor knows, at a creature id or another actor's key (or nothing). */
  cast(key: string, spell: string, at?: string) {
    const w = this.ready(key);
    const target = at === undefined ? null : this.ids[at] ? this.w(at).handle : at;
    const r = this.world.cast(w.id, spell, { target });
    if (!r.ok) throw new Error(`${key} could not cast ${spell}: ${r.error}`);
    return r;
  }
  /** Forge a new spell from Runes source (then cast() it by name). */
  forge(key: string, name: string, source: string) {
    const w = this.ready(key);
    this.world.forgeSpell(w.id, { name, source });
  }
  say(key: string, text: string) { this.world.say(this.w(key), text); }
  /** Walk with the kernel's A* pathfinding, as move_to does for an agent. */
  walkTo(key: string, x: number, z: number, by: 'player' | 'agent' = 'agent') { this.world.setGoal(this.w(key).id, { x, z }, by); }
  /** Hold a direction (like WASD); 0,0 stops. */
  walk(key: string, dx: number, dz: number) { this.world.setInput(this.w(key).id, dx, dz); }
  face(key: string, x: number, z: number) { const w = this.w(key); w.facing = Math.atan2(x - w.pos.x, -(z - w.pos.z)); }
  decree(key: string, patch: Record<string, unknown>, proclamation: string) {
    const w = this.w(key);
    w.decreeCharges = Math.max(1, w.decreeCharges);
    const r = this.world.decree(w.id, patch, proclamation, false);
    if (!r.ok) throw new Error(`decree refused: ${r.errors.join('; ')}`);
  }
}

const DIRECTOR = 'Colin Creevey'; // the boy with the camera; always just behind ours (see record())

/** Enrol the cast and dress them (glamour spells, forged and cast like any player's). */
export function stage(actors: Record<string, Actor>) {
  const world = new World({ seed: 1998, secret: 'promo-reel' });
  world.rules.creatures.spawnMultiplier = 0; // every creature on screen is placed by a shot
  world.rules.world.dayLengthSeconds = 7200; // the sun barely moves during a shot
  const ids: Record<string, string> = {};
  const enrol = (key: string, a: Actor) => {
    const w = world.enroll(a.name, a.house).wizard;
    w.connections = 1;
    if (w.year < a.year) world.gainXp(w, XP_FOR_YEAR[a.year] - w.xp);
    w.seals = Math.max(w.seals, a.seals ?? 0);
    ids[key] = w.id;
    return w;
  };
  enrol('director', { name: DIRECTOR, house: 'Gryffindor', year: 1 });
  for (const [key, a] of Object.entries(actors)) enrol(key, a);
  const s = new Stage(world, ids);
  world.tick(TICK);
  for (const [key, a] of Object.entries(actors)) {
    if (!a.look) continue;
    s.forge(key, 'Wardrobe', a.look);
    s.cast(key, 'Wardrobe');
    world.unlearn(ids[key], 'Wardrobe');
  }
  world.now += 60; // out of the fitting room
  world.tick(TICK);
  const director = world.wizards.get(ids.director)!;
  return { save: world.serialize(), ids, token: director.token, handle: director.handle, name: director.name, house: director.house, registry: director.id };
}

export type Staged = ReturnType<typeof stage>;
/** A tape: the messages the page receives, each at a shot time in seconds. */
export type Tape = { t: number; m: string }[];

/**
 * Run one shot from `-preroll` to `dur + tail` seconds and record its broadcasts.
 * Only the actors listed in the shot are online (so only they are on screen), plus the director, who
 * stands just behind the camera: the client centres its grass on "your" wizard.
 */
export function record(staged: Staged, shot: ShotDef, preroll: number, tail: number): Tape {
  const world = World.restore(structuredClone(staged.save), 42);
  world.rules.creatures.spawnMultiplier = 0;
  world.rules.world.weather = shot.weather ?? 'clear';
  Object.assign(world.rules.world.aesthetics, shot.aesthetics ?? {});
  // the clock that gives the shot its hour (the day is 7200 s long: hour = now/7200*24 + 8)
  world.now = ((((shot.hour - 8) % 24) + 24) % 24) / 24 * world.rules.world.dayLengthSeconds + 7200;
  world.term.endsAt = world.now + 86400;
  const s = new Stage(world, staged.ids);
  for (const w of world.wizards.values()) w.connections = 0;
  const director = s.w('director');
  director.connections = 1;
  director.st.jailedUntil = 1e12; // inert: nothing targets it, it never moves by itself
  const place = (t: number) => {
    const c = shot.camera(Math.max(0, t));
    const dx = c.look[0] - c.pos[0], dz = c.look[2] - c.pos[2], l = Math.hypot(dx, dz) || 1;
    director.pos = { x: c.pos[0] - (dx / l) * 3, z: c.pos[2] - (dz / l) * 3 };
  };
  for (const [key, p] of Object.entries(shot.cast)) {
    const w = s.w(key);
    w.connections = 1;
    w.pos = { x: p.x, z: p.z };
    w.facing = p.f ?? 0;
    w.hp = derived(w, world.rules).maxHp;
    w.mana = derived(w, world.rules).maxMana;
    w.createdAt = -1e9;
  }
  for (const c of shot.creatures ?? []) {
    const def = CREATURES[c.kind];
    const hp = c.hp ?? def.hp;
    world.creatures.set(c.id, {
      id: c.id, kind: c.kind, pos: { x: c.x, z: c.z }, home: { x: c.x, z: c.z }, hp, maxHp: def.hp, facing: c.f ?? 0, target: null, attackCd: 1, rootedUntil: 0,
      wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0,
    });
  }
  const cues = [...(shot.cues ?? [])].sort((a, b) => a[0] - b[0]);
  const tape: Tape = [];
  const start = -preroll, end = shot.dur + tail;
  place(start);
  world.drainFx();
  let ci = 0;
  let next = start;
  for (let k = 0; ; k++) {
    const t = start + k * TICK;
    if (t > end + 1e-9) break;
    while (ci < cues.length && cues[ci][0] <= t + 1e-9) cues[ci++][1](s);
    place(t);
    world.tick(TICK);
    if (t + 1e-9 >= next) {
      tape.push({ t, m: JSON.stringify({ t: 'snap', s: world.snapshot() }) });
      next += 0.1;
    }
  }
  return tape;
}

/** The first message on the socket: who "you" are (the director). */
export function welcome(staged: Staged) {
  return JSON.stringify({ t: 'welcome', handle: staged.handle, name: staged.name, house: staged.house, registry: staged.registry, events: [], owls: [], pair: null, mcpUrl: '' });
}
