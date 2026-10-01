/**
 * 场景道具 (a Feature; the data is src/shared/props.ts): what magic does to the things on the ground.
 *
 * A spell touches a prop when a bolt passes within PROP_R of it (the bolt is spent) or an area spell goes off over it
 * (the `blast` hook: a nova, a storm breaking, each place a chain leaps to). Then:
 *  - a breakable breaks (PROP_BREAK_XP to the caster, at most PROP_BREAKS_PER_TERM a term), back in PROP_RESPAWN_S;
 *  - a whizbang touched by fire goes up: a fire blast of its radius that hurts wild creatures (never wizards) and
 *    touches the props round it — a row of barrels goes off one after another; a fire hit on anyone within IGNITE_R
 *    of one sets it off as well (the `hit` hook: a pixie burning among the barrels, a spider by its web);
 *  - an elemental prop woken by its element stays awake `secs` (its quench element puts it out); when all three of a
 *    group are awake at once, each wizard who woke one of them in that time gets PROP_GROUP_XP and PROP_GROUP_GALLEONS,
 *    once per group per term (RULES: rewards are capped).
 *  - a toadstool bursts under any hurting spell (`pop`): spores round it, and the toadstools by it go too;
 *  - a breakable may leave something on the ground (kernel/loot.ts: one in LOOT_PCT, an ice block always); a
 *    cauldron woken by fire brews a potion beside it;
 * State goes out as the snapshot's `props` (only what is not at rest), and MCP look lists the props within 25 m.
 */
import { IGNITE_R, PROP_BREAKS_PER_TERM, PROP_BREAK_XP, PROP_DEFS, PROP_GROUPS, PROP_GROUP_GALLEONS, PROP_GROUP_XP, PROP_R, PROP_RESPAWN_S, PROPS, WHIZBANG_POWER, type Prop } from '../shared/props.js';
import type { Element } from '../shared/constants.js';
import { LOOT_PCT, LOOT_WEIGHTS, type LootKind } from '../shared/loot.js';
import { drop } from './loot.js';
import type { Feature } from './feature.js';
import type { Vec2 } from './types.js';
import type { World } from './world.js';

declare module './world.js' {
  interface World {
    /** 场景道具 (this module's Feature). */
    props: {
      /** Broken props: when each comes back; who broke each and when (an encounter counts them, kernel/encounters.ts). */
      broken: Map<string, number>; who: Map<string, { by: string; at: number }>;
      /** Awake props: until when, and who woke it (wizard id). */
      awake: Map<string, { until: number; by: string }>;
      /** This term's counts: breaks per wizard, groups paid per wizard. */
      term: number; breaks: Map<string, number>; paid: Map<string, Set<string>>;
    };
  }
}

// a grid of the props (8 m cells), so a bolt looks at a handful, not all of them
const CELL = 8;
const grid = new Map<string, Prop[]>();
for (const p of PROPS) { const k = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(p); }
function near(at: Vec2, r: number, out: Prop[] = []) {
  out.length = 0;
  const c0 = Math.floor((at.x - r) / CELL), c1 = Math.floor((at.x + r) / CELL), r0 = Math.floor((at.z - r) / CELL), r1 = Math.floor((at.z + r) / CELL);
  for (let cx = c0; cx <= c1; cx++) for (let cz = r0; cz <= r1; cz++) for (const p of grid.get(`${cx},${cz}`) ?? []) if (Math.hypot(p.x - at.x, p.z - at.z) <= r) out.push(p);
  return out;
}
const members = new Map<string, Prop[]>();
for (const p of PROPS) if (p.group) (members.get(p.group) ?? members.set(p.group, []).get(p.group)!).push(p);

function newTerm(world: World) {
  const s = world.props;
  if (s.term === world.term.n) return;
  s.term = world.term.n; s.breaks.clear(); s.paid.clear();
}

/** A spell of `element` from `by` touches prop `p` (depth: how many whizbangs set this off). Returns whether it did anything. */
export function touch(world: World, p: Prop, element: Element, by: string, depth = 0): boolean {
  const s = world.props, def = PROP_DEFS[p.kind];
  if (s.broken.has(p.id)) return false;
  newTerm(world);
  const w = world.wizards.get(by);
  if (def.breaks) {
    s.broken.set(p.id, world.now + PROP_RESPAWN_S);
    s.who.set(p.id, { by, at: world.now });
    world.fx({ k: 'hit', x: p.x, z: p.z, e: element });
    if (w && !w.npc) {
      const n = s.breaks.get(w.id) ?? 0;
      if (n < PROP_BREAKS_PER_TERM) { s.breaks.set(w.id, n + 1); world.gainXp(w, PROP_BREAK_XP); }
    }
    // what it leaves on the ground
    for (let i = 0, n = def.loot ?? (world.funRand() * 100 < LOOT_PCT ? 1 : 0); i < n; i++) drop(world, p, lootKind(world));
    if (def.pop && depth < 6) {
      // 孢子: a burst round it, of its own element — wild creatures only, and the props in it
      world.fx({ k: 'nova', x: p.x, z: p.z, r: def.pop.r, e: def.pop.element });
      for (const e of world.around(p, def.pop.r, (e) => !('house' in e) && world.canHarm(by, e.id), by, 16)) world.damage(by, e.id, def.pop.power, def.pop.element, ['whizbang']);
      for (const q of near(p, def.pop.r, [])) if (q !== p && PROP_DEFS[q.kind].pop) touch(world, q, def.pop.element, by, depth + 1);
    }
    if (def.blast && element === 'fire' && depth < 6) {
      // 韦斯莱烟火: a fire blast round it — wild creatures only, and whatever props stand in it
      world.fx({ k: 'nova', x: p.x, z: p.z, r: def.blast, e: 'fire' });
      world.fx({ k: 'stormhit', x: p.x, z: p.z, r: def.blast, e: 'fire' });
      for (const e of world.around(p, def.blast, (e) => !('house' in e) && world.canHarm(by, e.id), by, 16)) world.damage(by, e.id, def.power ?? WHIZBANG_POWER, 'fire', ['whizbang']);
      for (const q of near(p, def.blast, [])) if (q !== p) touch(world, q, 'fire', by, depth + 1);
    }
    return true;
  }
  if (def.quench === element && s.awake.has(p.id)) { s.awake.delete(p.id); world.fx({ k: 'hit', x: p.x, z: p.z, e: element }); return true; }
  if (def.wakes !== element && def.also !== element) return false;
  if (def.brews && !s.awake.has(p.id)) drop(world, p, 'potion');
  s.awake.set(p.id, { until: world.now + (def.secs ?? 30), by });
  world.fx({ k: 'hit', x: p.x, z: p.z, e: element });
  if (p.group) solve(world, p.group);
  return true;
}

const LOOT_SUM = LOOT_WEIGHTS.reduce((a, [, w]) => a + w, 0);
function lootKind(world: World): LootKind {
  let r = world.funRand() * LOOT_SUM;
  for (const [k, w] of LOOT_WEIGHTS) { r -= w; if (r < 0) return k; }
  return LOOT_WEIGHTS[0][0];
}

/** All three of a group awake: pay each who woke one (once per group per term). */
function solve(world: World, gid: string) {
  const s = world.props, ps = members.get(gid) ?? [];
  if (!ps.length || !ps.every((p) => (s.awake.get(p.id)?.until ?? 0) > world.now)) return;
  const g = PROP_GROUPS.find((x) => x.id === gid)!;
  const c = ps.reduce((a, p) => ({ x: a.x + p.x / ps.length, z: a.z + p.z / ps.length }), { x: 0, z: 0 });
  world.fx({ k: 'nova', x: c.x, z: c.z, r: 5, e: PROP_DEFS[g.kind].wakes ?? 'arcane' });
  for (const wid of new Set(ps.map((p) => s.awake.get(p.id)!.by))) {
    const w = world.wizards.get(wid);
    if (!w || w.npc) continue;
    const paid = s.paid.get(wid) ?? s.paid.set(wid, new Set()).get(wid)!;
    if (paid.has(gid)) { world.emit('system', `${g.en}: awake together again.`, { to: wid, zh: `${g.zh}又一起亮了。（这学期的奖励已经拿过）` }); continue; }
    paid.add(gid);
    world.gainXp(w, PROP_GROUP_XP);
    w.galleons += PROP_GROUP_GALLEONS;
    world.emit('system', `✨ ${g.en}: all three at once. +${PROP_GROUP_XP} XP, +${PROP_GROUP_GALLEONS} galleons.`, { to: wid, zh: `✨ ${g.zh}三个一起亮了！+${PROP_GROUP_XP} 经验，+${PROP_GROUP_GALLEONS} 加隆。` });
  }
  // (the three stay lit until they burn down: the glow is the reward to look at)
}

const scratch: Prop[] = [];
export const PROPS_FEATURE: Feature = {
  id: 'props',
  init(world) { world.props = { broken: new Map(), who: new Map(), awake: new Map(), term: world.term.n, breaks: new Map(), paid: new Map() }; },
  // a straight bolt passing close touches the nearest prop and is spent on it (one with a target flies past: a fight
  // among the crates is not eaten by them)
  bolt(world, p) {
    if (p.kind !== 'bolt' || p.homing || p.power <= 0 || p.ttl <= 0 || p.tags.includes('water')) return; // (Aguamenti soaks, it breaks nothing)
    for (const q of near(p.pos, PROP_R, scratch)) {
      if (world.props.broken.has(q.id)) continue;
      if (touch(world, q, p.element, p.owner)) { p.ttl = 0; return; }
    }
  },
  // sparks: a direct fire hit on someone by a whizbang or a web sets it off (its own blasts excepted)
  hit(world, by, _src, dstId, tags, dmg, element) {
    if (element !== 'fire' || !dmg || !by || tags.includes('whizbang')) return 1;
    const e = world.wizards.get(dstId) ?? world.creatures.get(dstId);
    if (e) for (const q of near(e.pos, IGNITE_R, [])) if (PROP_DEFS[q.kind].blast) touch(world, q, 'fire', by);
    return 1;
  },
  blast(world, by, at, r, element) {
    for (const q of near(at, r + PROP_R, [])) touch(world, q, element, by);
  },
  sweep(world) {
    const s = world.props;
    for (const [id, t] of s.broken) if (t <= world.now) { s.broken.delete(id); s.who.delete(id); }
    for (const [id, a] of s.awake) if (a.until <= world.now) s.awake.delete(id);
  },
  // the browser: what is not at rest (broken: seconds until back; awake: seconds left)
  wire: {
    key: 'props',
    get(world) {
      const s = world.props;
      if (!s.broken.size && !s.awake.size) return undefined;
      const b: Record<string, number> = {}, a: Record<string, number> = {};
      for (const [id, t] of s.broken) b[id] = Math.ceil(t - world.now);
      for (const [id, x] of s.awake) a[id] = Math.ceil(x.until - world.now);
      return { b, a };
    },
  },
  view: {
    key: 'props',
    // MCP look: the props within 25 m, what each wants, and its state
    here(world, x) {
      const s = world.props, here = near(x.pos, 25, []);
      if (!here.length) return undefined;
      return here.map((p) => {
        const d = PROP_DEFS[p.kind];
        return {
          id: p.id, kind: p.kind, zh: d.zh, x: p.x, z: p.z, ...(p.group ? { group: p.group } : {}),
          state: s.broken.has(p.id) ? 'broken' : s.awake.has(p.id) ? 'awake' : 'rest',
          // how long it stays lit, and how its three stand (the 2026-10-01 playtest: two agents lighting the Willow's
          // stones over chat thought they had 2–3 s; they had 30 — now they can see it)
          ...(s.awake.has(p.id) ? { secondsLeft: Math.ceil(s.awake.get(p.id)!.until - world.now) } : {}),
          ...(p.group ? { groupLit: `${(members.get(p.group) ?? []).filter((q) => (s.awake.get(q.id)?.until ?? 0) > world.now).length}/${(members.get(p.group) ?? []).length}` } : {}),
          ...(d.wakes ? { wakes: d.wakes } : {}), hint: `${d.hintZh} / ${d.hintEn}`,
        };
      });
    },
  },
  save(world) {
    const s = world.props;
    return { term: s.term, breaks: Object.fromEntries(s.breaks), paid: Object.fromEntries([...s.paid].map(([k, v]) => [k, [...v]])) };
  },
  load(world, data) {
    const d = data as { term?: number; breaks?: Record<string, number>; paid?: Record<string, string[]> } | undefined;
    if (!d || typeof d !== 'object') return;
    const s = world.props;
    if (typeof d.term === 'number') s.term = d.term;
    for (const [k, v] of Object.entries(d.breaks ?? {})) if (typeof v === 'number') s.breaks.set(k, v);
    for (const [k, v] of Object.entries(d.paid ?? {})) if (Array.isArray(v)) s.paid.set(k, new Set(v.filter((x) => typeof x === 'string')));
  },
};
