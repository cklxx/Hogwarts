/**
 * 误伤 (playtest round 2): what a spell in flight may strike (formal/tla/Hostility.tla `Allied` / `Strikes`).
 *
 * A straight bolt (aimed at a point) strikes whatever World.canHarm lets it on its way — a housemate too, when the
 * rules have friendly fire on: a skill shot is the caster's risk. A spell with a target — a homing bolt, a disarm,
 * a root, the leaps of a chain — is the caster's choice of foe: it strikes that target, or anyone the caster could
 * have picked as a foe, but passes through an ally who merely stands in the way. Area spells (nova, storm) are the
 * caster's choice of ground and keep hitting whatever canHarm allows.
 *
 * canHarm itself is untouched: this only narrows what a spell *meant for someone else* hits on its way.
 */
import type { World } from './world.js';

const behind = (world: World, id: string) => world.wizards.get(world.credit(id) ?? id);

/**
 * Same side: the wizards behind two entities (a summon counts as its owner) are of one house — and are not the two
 * sides of a Duelling-Club match, where your opponent is your opponent whatever the house. Creatures have no side.
 */
export function allied(world: World, x: string, y: string): boolean {
  const a = behind(world, x), b = behind(world, y);
  if (!a || !b || a.house !== b.house) return false;
  return world.duelOpponent(a.id) !== b.id;
}

/**
 * NPCs pick no fights (npc.ts): a player is an NPC's foe only as the target it chose (its grudge, its duel opponent).
 * So an NPC's spell — or its summon — hunting a creature passes a player by, and its summon never picks a player.
 */
export function spared(world: World, src: string, id: string): boolean {
  const a = behind(world, src), b = behind(world, id);
  return !!a && !!b && a.npc && !b.npc && world.duelOpponent(a.id) !== b.id;
}

/** A spell from `src` meant for `target` (null: a straight shot) may strike `id`: canHarm, and no ally but its target. */
export function strikes(world: World, src: string, target: string | null, id: string): boolean {
  return world.canHarm(src, id) && (!target || target === id || !(allied(world, src, id) || spared(world, src, id)));
}
