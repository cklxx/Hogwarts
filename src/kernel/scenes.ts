/**
 * 场景之门 (a Feature; the map is src/shared/scenes.ts): walk into a gate and you step out at the other end — the
 * castle courtyard has one to every other scene, every other scene one home. A walk into another scene
 * (World.setGoal: to the gate first, `world.via`) goes on from the far side by itself, so `move_to` and the browser's
 * 带我去 cross scenes the way they cross a room.
 *
 * A walk along a route goes through a gate only when it is headed there (or beyond); by hand, stepping in is enough.
 * Not through a gate: in a duel or on a Quidditch team (the match holds you), stunned, or jailed. A second's grace
 * after each crossing (you step out beside the far gate, never on it). Loading a save from the open grounds brings
 * whoever stood in the mist back to the courtyard.
 *
 * The veil itself is a way through (边缘出口, src/shared/scenes.ts): a wizard walking by hand who keeps pressing into
 * it for EDGE_HOLD_S comes out in the scene that lies that way (or, from an outer scene's far edges, in the courtyard).
 */
import { SPAWN } from '../shared/map.js';
import { EDGE_HOLD_S, edgeOut, edgeTo, GATES, GATE_COOLDOWN_S, GATE_R, gateAt, pressing, sceneAt, sceneById, type Gate } from '../shared/scenes.js';
import { CREATURES } from './creatures.js';
import { inMatch } from './duelclub.js';
import type { Feature } from './feature.js';
import { qdOnTeam } from './quidditch.js';
import type { Wizard } from './types.js';
import type { World } from './world.js';

declare module './world.js' {
  interface World {
    /** 场景之门 (this module's Feature): when each wizard last went through a gate; since when each has pressed into the veil. */
    gates: { at: Map<string, number>; press: Map<string, number> };
  }
}

/** The gates out of a scene: where each stands and where it goes. */
export const gatesFrom = (id: string) => GATES.filter((g) => g.in === id).map((g) => ({ to: g.to, zh: sceneById(g.to)!.zh, en: sceneById(g.to)!.en, x: g.at.x, z: g.at.z }));

function cross(world: World, wid: string, g: Gate) {
  const w = world.need(wid);
  const via = world.via.get(wid);
  world.via.delete(wid);
  world.gates.at.set(wid, world.now);
  world.fx({ k: 'apparate', x: w.pos.x, z: w.pos.z, h: w.handle });
  w.pos = { ...g.out };
  world.solids.resolve(w.pos, 0.5, true);
  world.stopWalk(w);
  world.moved(w);
  world.fx({ k: 'apparate', x: w.pos.x, z: w.pos.z, h: w.handle });
  const to = sceneById(g.to)!;
  if (!w.npc) world.emit('system', `Through the mist: ${to.en}.`, { to: wid, zh: `穿过迷雾：来到${to.zh}。` });
  // a walk that was on its way through this gate goes on from here (maybe to the next gate)
  if (via && via.gate === g && Math.hypot(via.to.x - w.pos.x, via.to.z - w.pos.z) > GATE_R) { try { world.setGoal(wid, via.to, via.by); } catch { /* the far side is blocked: stand here */ } }
}

/** Walking by hand into the veil: since when, or null. */
function pressedEdge(world: World, w: Wizard) {
  const s = sceneAt(w.pos.x, w.pos.z);
  const side = !w.npc && !w.goal && s ? pressing(s, w.pos, { x: w.input.dx, z: w.input.dz }) : null;
  if (!s || !side) { world.gates.press.delete(w.id); return null; }
  const since = world.gates.press.get(w.id) ?? world.now;
  world.gates.press.set(w.id, since);
  return world.now - since >= EDGE_HOLD_S - 1e-9 ? { at: { ...w.pos }, in: s.id, to: edgeTo(s, side), out: edgeOut(s, side, w.pos) } as Gate : null;
}

function stepLate(world: World) {
  for (const w of world.wizards.values()) {
    if (w.npc || !world.isActive(w) || w.st.jailedUntil > 0) { world.gates.press.delete(w.id); continue; }
    if (world.now - (world.gates.at.get(w.id) ?? -1e9) < GATE_COOLDOWN_S) continue;
    if (inMatch(world.duel, w.id) || qdOnTeam(world, w.id)) continue;
    const edge = pressedEdge(world, w);
    if (edge) { world.gates.press.delete(w.id); cross(world, w.id, edge); continue; }
    // a walk to an edge crossing (World.setGoal, edgeHop): through it on arrival
    const v = world.via.get(w.id);
    if (v && !GATES.includes(v.gate) && Math.hypot(w.pos.x - v.gate.at.x, w.pos.z - v.gate.at.z) <= GATE_R) { cross(world, w.id, v.gate); continue; }
    const g = gateAt(w.pos.x, w.pos.z);
    if (!g) continue;
    // a walk that only passes by (a route over the courtyard) does not fall through: only one aimed at this gate,
    // or at a place beyond it; walking in by hand (the stick, WASD) always does
    if (w.goal && world.via.get(w.id)?.gate !== g && Math.hypot(w.goal.x - g.at.x, w.goal.z - g.at.z) > GATE_R) continue;
    cross(world, w.id, g);
  }
}

/** A save from the open grounds: whoever stood in what is now mist goes to the courtyard; a wild creature whose
 *  home is no longer where its kind lives (the lake's dementors were drawn in) is let go. */
function migrate(world: World) {
  for (const w of world.wizards.values()) {
    if (w.st.jailedUntil > 0 || sceneAt(w.pos.x, w.pos.z)) continue;
    w.pos = { ...SPAWN }; world.stopWalk(w);
    world.via.delete(w.id);
    world.moved(w);
  }
  for (const c of world.creatures.values()) {
    const def = CREATURES[c.kind];
    if (c.owner || c.ev || !def.spawn.max) continue;
    if ([def.spawn, ...(def.also ?? [])].every((sp) => Math.hypot(c.home.x - sp.x, c.home.z - sp.z) > sp.r + 1) || !sceneAt(c.pos.x, c.pos.z)) world.creatures.delete(c.id);
  }
}

export const SCENES_FEATURE: Feature = {
  id: 'scenes',
  init(world) { world.gates = { at: new Map(), press: new Map() }; },
  stepLate,
  load: (world) => migrate(world),
  view: {
    key: 'scene',
    // where you are and the ways out (the MCP `look`/`whoami` and the browser read it)
    me: (world, w) => {
      const s = sceneAt(w.pos.x, w.pos.z);
      return s ? { id: s.id, zh: s.zh, en: s.en, gates: gatesFrom(s.id) } : null;
    },
  },
};
