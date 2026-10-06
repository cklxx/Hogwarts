/**
 * 魔法化学 (a Feature; the table is src/shared/chem.ts, the why docs/DESIGN.md §3.1): states that every wizard and
 * creature can be in, and what a hurting spell does to each.
 *
 * - 湿 (wet): standing in a wet zone (the south lawn's dew, the lake shore), out in the rain, or hit by Aguamenti —
 *   for WET_S after the last soaking.
 * - 冻结 (frozen): ice on the wet — held still FREEZE_S (the kernel's root), and the next hurting spell shatters it.
 * - burning and chill are the kernel's own auras (fire and ice already leave them).
 *
 * The `hit` hook sees every direct hit with its element and returns the reaction's damage multiplier; the effects
 * (steam, the arc to the other wet, the slip, the rainbow, the overload blast) happen there, and a `react` fx names
 * it over the target. Aguamenti — `(aguamenti target-or-point)`, a first-year charm — is this feature's primitive.
 */
import type { Prim } from '../runes/primitives.js';
import { isRef } from '../runes/interp.js';
import { interiorAt } from '../shared/layout.js';
import { CONDUCT_R, FREEZE_S, inWetZone, OVERLOAD_R, RAINBOW_HEAL, REACTIONS, reactionOf, SLIP_PUSH, WATER_TAG, WET_S, type ReactionId } from '../shared/chem.js';
import { sceneAt } from '../shared/scenes.js';
import { hasAura } from './auras.js';
import type { Feature, FeatureSpell } from './feature.js';
import type { Creature, Vec2, Wizard } from './types.js';
import type { World } from './world.js';
import { CREATURES } from './creatures.js';
import { splitWaterAssistXp, WATER_ASSIST_MAX, WATER_ASSIST_R, WATER_ASSIST_S } from './water-assist.js';

interface WaterSource { by: string; until: number }
interface PendingWater { by: string; helper: string; at: number }

declare module './world.js' {
  interface World {
    /** 魔法化学 (this module's Feature): until when each entity is wet / frozen; reactions set off, per wizard. */
    chem: { wet: Map<string, number>; frozen: Map<string, number>; reactions: Map<string, number>;
      waterSources: Map<string, WaterSource>; waterAssists: Map<string, Map<string, number>>; pendingWater: Map<string, PendingWater> };
  }
}

/** A conducted arc's damage (lightning), and an overload blast's (fire). */
export const CONDUCT_DMG = 8, OVERLOAD_DMG = 10;

const ent = (world: World, id: string): Wizard | Creature | undefined => world.wizards.get(id) ?? world.creatures.get(id);
export const isWet = (world: World, id: string) => (world.chem.wet.get(id) ?? 0) > world.now;
export const isFrozen = (world: World, id: string) => (world.chem.frozen.get(id) ?? 0) > world.now;
const soak = (world: World, id: string) => {
  world.chem.wet.set(id, world.now + WET_S);
  // Dew and rain cannot keep a player's water provenance alive.
  world.chem.waterSources.delete(id);
};
const root = (e: Wizard | Creature, until: number) => { if ('house' in e) e.st.rootedUntil = Math.max(e.st.rootedUntil, until); else e.rootedUntil = Math.max(e.rootedUntil, until); };

const human = (world: World, w: Wizard | undefined): w is Wizard => !!w && !w.npc && !w.heldBy && !world.possess.of.has(w.id) && w.hp > 0 && world.isActive(w);
const wild = (world: World, c: Creature | undefined): c is Creature => !!c && !c.owner && !c.driver && !world.possess.creatures.has(c.id) && CREATURES[c.kind].faction === 'hostile';
const nearby = (w: Wizard, c: Creature) => sceneAt(w.pos.x, w.pos.z) === sceneAt(c.pos.x, c.pos.z) && Math.hypot(w.pos.x - c.pos.x, w.pos.z - c.pos.z) <= WATER_ASSIST_R;
const naturallyWet = (world: World, c: Creature) => inWetZone(c.pos.x, c.pos.z) || (world.rules.world.weather === 'rain' && !!sceneAt(c.pos.x, c.pos.z) && interiorAt(c.pos.x, c.pos.z) < 0);
const WATER_REACTIONS: readonly ReactionId[] = ['vaporize', 'freeze', 'conduct', 'slip', 'rainbow'];

/** The hit hook can react before final multipliers. Commit only after actual direct HP damage, before slay. */
export function confirmWaterAssist(world: World, srcId: string | null, dstId: string, amount: number, direct: boolean): void {
  const p = world.chem.pendingWater.get(dstId);
  world.chem.pendingWater.delete(dstId);
  if (!p || !direct || p.by !== srcId || p.at !== world.now || !Number.isFinite(amount) || amount <= 0) return;
  const c = world.creatures.get(dstId), helper = world.wizards.get(p.helper), actor = srcId ? world.wizards.get(srcId) : undefined;
  if (!wild(world, c) || !human(world, helper) || !human(world, actor) || helper.id === actor.id || !nearby(helper, c) || !nearby(actor, c)) return;
  const assists = world.chem.waterAssists.get(dstId) ?? new Map<string, number>();
  // One entry per wizard/creature; repeating the same cooperation never extends the deadline or adds weight.
  if (!assists.has(helper.id) && assists.size < WATER_ASSIST_MAX) assists.set(helper.id, world.now + WATER_ASSIST_S);
  if (assists.size) world.chem.waterAssists.set(dstId, assists);
}

/** Called on death/removal; transient provenance is never saved or exposed as registry IDs. */
export function clearWaterAssist(world: World, id: string): void {
  world.chem.waterSources.delete(id); world.chem.waterAssists.delete(id); world.chem.pendingWater.delete(id);
}

/** Reallocate only the killer's existing XP budget. Other damage rewards, rep, gold and kill credit stay intact. */
export function waterAssistXp(world: World, c: Creature, killer: Wizard | undefined, xp: number): { killerXp: number; assists: { wizard: Wizard; xp: number }[] } {
  const entries = world.chem.waterAssists.get(c.id);
  clearWaterAssist(world, c.id);
  if (!entries || !wild(world, c) || !human(world, killer)) return { killerXp: xp, assists: [] };
  const helpers = [...entries].filter(([id, until]) => id !== killer.id && until > world.now)
    .map(([id]) => world.wizards.get(id)).filter((w): w is Wizard => human(world, w) && nearby(w, c));
  const { killerXp, shares } = splitWaterAssistXp(xp, helpers.length);
  return { killerXp, assists: shares.map((xp, i) => ({ wizard: helpers[i], xp })).filter((x) => x.xp > 0) };
}

/** Set off reaction `r` on `e` (hit by `by`, a spell of `element`). */
function react(world: World, r: ReactionId, e: Wizard | Creature, by: string | null, src: Wizard | undefined) {
  const c = world.chem, now = world.now;
  switch (r) {
    case 'vaporize': c.wet.delete(e.id); break;
    case 'freeze': c.wet.delete(e.id); c.frozen.set(e.id, now + FREEZE_S); root(e, now + FREEZE_S); break;
    case 'shatter': c.frozen.delete(e.id); if ('house' in e) e.st.rootedUntil = Math.min(e.st.rootedUntil, now); else e.rootedUntil = Math.min(e.rootedUntil, now); break;
    case 'melt': e.auras = e.auras.filter((x) => x.k !== 'chill'); break;
    case 'douse': e.auras = e.auras.filter((x) => x.k !== 'burn'); break;
    case 'slip': {
      c.wet.delete(e.id);
      const from = src?.pos ?? (by ? ent(world, by)?.pos : undefined);
      if (from) world.knock(from, e.id, SLIP_PUSH);
      root(e, now + 0.6);
      break;
    }
    case 'conduct': {
      c.wet.delete(e.id);
      const pts: number[] = [e.pos.x, e.pos.z];
      for (const o of world.around(e.pos, CONDUCT_R, (x) => x.id !== e.id && isWet(world, x.id) && world.canHarm(by, x.id), by ?? undefined, 6)) {
        c.wet.delete(o.id);
        c.waterSources.delete(o.id);
        pts.push(o.pos.x, o.pos.z, e.pos.x, e.pos.z);
        world.damage(by, o.id, CONDUCT_DMG, 'lightning', ['conduct']);
      }
      if (pts.length > 2) world.fx({ k: 'chain', x: e.pos.x, z: e.pos.z, e: 'lightning', pts });
      break;
    }
    case 'overload': {
      e.auras = e.auras.filter((x) => x.k !== 'burn');
      world.fx({ k: 'nova', x: e.pos.x, z: e.pos.z, r: OVERLOAD_R, e: 'fire' });
      for (const o of world.around(e.pos, OVERLOAD_R, (x) => x.id !== e.id && world.canHarm(by, x.id), by ?? undefined, 8)) {
        world.damage(by, o.id, OVERLOAD_DMG, 'fire', ['overload']);
        world.knock(e.pos, o.id, 2);
      }
      break;
    }
    case 'rainbow': {
      c.wet.delete(e.id);
      if (src) for (const w of world.around(src.pos, 6, (x) => world.wizards.get(x.id)?.house === src.house, undefined, 8)) {
        const t = world.wizards.get(w.id);
        if (t) world.heal(src, t, RAINBOW_HEAL);
      }
      break;
    }
  }
  world.fx({ k: 'react', x: e.pos.x, z: e.pos.z, h: r });
  if (by && world.wizards.has(by)) c.reactions.set(by, (c.reactions.get(by) ?? 0) + 1);
}

const argOf = (name: string, type: Prim['args'][number]['type'], optional = false) => ({ name, type, optional });
const prim = (name: string, args: Prim['args'], doc: string, example: string): Prim => ({ name, kind: 'effect', year: 1, args, doc, example });
const SPELLS: FeatureSpell[] = [{
  aims: 'harm',
  prim: prim('aguamenti', [argOf('at', 'place')], 'A jet of water at an entity (homing) or a point: it hurts nothing, it soaks (wet for 8 s — then fire vaporizes, ice freezes, lightning conducts, a stunner slips it) and puts out a fire. Cost 6.', '(aguamenti (or target aim))'),
  cost: () => 6,
  plan(api, args, at) {
    const v = args[0];
    let to: Vec2, homing: string | null = null, name = 'there';
    if (isRef(v)) { const t = api.harmable(v, at, api.caps.boltRange); to = t.pos; homing = t.id; name = t.name; } else to = api.posOf(v, at);
    return { cost: {}, desc: `aguamenti ${name}`, apply: () => { api.world.spawnProjectile(api.caster, 'bolt', to, homing, 1, 'arcane', 0, [...api.tags, WATER_TAG]); } };
  },
}];

export const CHEM_FEATURE: Feature = {
  id: 'chem',
  spells: SPELLS,
  init(world) { world.chem = { wet: new Map(), frozen: new Map(), reactions: new Map(), waterSources: new Map(), waterAssists: new Map(), pendingWater: new Map() }; },
  // a hurting spell on a target in a state: its reaction (the multiplier), and Aguamenti's soaking (it hurts nothing)
  hit(world, by, src, dstId, tags, dmg, element) {
    const e = ent(world, dstId);
    if (!e || !element) return 1;
    const water = tags.includes(WATER_TAG);
    const st = { wet: isWet(world, e.id), frozen: isFrozen(world, e.id), burning: hasAura(e.auras, 'burn', world.now), chilled: hasAura(e.auras, 'chill', world.now) };
    if (water) {
      const r = reactionOf(element, st, true);
      const previous = world.chem.waterSources.get(e.id);
      soak(world, e.id);
      const c = world.creatures.get(e.id);
      if (wild(world, c) && !naturallyWet(world, c) && human(world, src) && by === src.id && nearby(src, c)) {
        // Repeated jets refresh wetness, but cannot steal a still-live teammate's provenance.
        world.chem.waterSources.set(e.id, previous && previous.until > world.now && previous.by !== src.id ? previous : { by: src.id, until: world.now + WET_S });
      }
      if (r) react(world, r, e, by, src);
      return 0;
    }
    if (!dmg || tags.includes('conduct') || tags.includes('overload')) return 1;
    const r = reactionOf(element, st);
    if (!r) return 1;
    if (WATER_REACTIONS.includes(r)) {
      const source = world.chem.waterSources.get(e.id);
      world.chem.waterSources.delete(e.id);
      if (source && source.until > world.now && human(world, src) && by === src.id && source.by !== src.id) {
        world.chem.pendingWater.set(e.id, { by: src.id, helper: source.by, at: world.now });
      }
    }
    react(world, r, e, by, src);
    return REACTIONS[r].mult;
  },
  // once a second: the wet zones and the rain soak whoever is in them (outdoors)
  sweep(world) {
    const rain = world.rules.world.weather === 'rain';
    const each = (e: Wizard | Creature) => {
      const { x, z } = e.pos;
      if (inWetZone(x, z) || (rain && sceneAt(x, z) && interiorAt(x, z) < 0)) soak(world, e.id);
    };
    for (const w of world.wizards.values()) if (world.isActive(w)) each(w);
    for (const c of world.creatures.values()) if (c.hp > 0) each(c);
    for (const [id, t] of world.chem.wet) if (t <= world.now || !ent(world, id)) world.chem.wet.delete(id);
    for (const [id, t] of world.chem.frozen) if (t <= world.now || !ent(world, id)) world.chem.frozen.delete(id);
    for (const [id, s] of world.chem.waterSources) if (s.until <= world.now || !world.creatures.has(id)) world.chem.waterSources.delete(id);
    for (const [id, assists] of world.chem.waterAssists) {
      for (const [by, until] of assists) if (until <= world.now || !world.wizards.has(by)) assists.delete(by);
      if (!assists.size || !world.creatures.has(id)) world.chem.waterAssists.delete(id);
    }
    for (const [id, p] of world.chem.pendingWater) if (p.at < world.now || !world.creatures.has(id)) world.chem.pendingWater.delete(id);
  },
  // the browser: who is wet or frozen (handles for wizards, ids for creatures); in the rain everyone outdoors is,
  // and the client knows the weather, so it lists only the rest
  wire: {
    key: 'chem',
    get(world) {
      const c = world.chem;
      if (!c.wet.size && !c.frozen.size) return undefined;
      const rain = world.rules.world.weather === 'rain';
      const out: Record<string, string> = {};
      for (const id of c.wet.keys()) {
        const e = ent(world, id);
        if (!e || !isWet(world, id) || (rain && !inWetZone(e.pos.x, e.pos.z))) continue;
        out['house' in e ? e.handle : e.id] = 'w';
      }
      for (const id of c.frozen.keys()) { const e = ent(world, id); if (e && isFrozen(world, id)) out['house' in e ? e.handle : e.id] = 'f'; }
      return Object.keys(out).length ? out : undefined;
    },
  },
  // MCP look: which foes round you are wet or frozen, and what each element would do to them
  view: {
    key: 'chem',
    here(world, w) {
      const near = world.around(w.pos, 25, (x) => isWet(world, x.id) || isFrozen(world, x.id), w.id, 12);
      if (!near.length) return undefined;
      return {
        states: near.map((x) => ({ id: world.wizards.get(x.id)?.handle ?? x.id, state: isFrozen(world, x.id) ? 'frozen' : 'wet' })),
        reactions: 'wet: fire → 蒸发 vaporize ×1.5, ice → 冻结 freeze, lightning → 感电 conduct (arcs to the other wet), a stunner → 滑倒 slip, light → 彩虹 rainbow heal; frozen: any hit → 碎冰 shatter ×2',
      };
    },
  },
};
