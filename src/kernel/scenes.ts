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
 */
import { SPAWN } from '../shared/map.js';
import { GATES, GATE_COOLDOWN_S, GATE_R, gateAt, sceneAt, sceneById, type Gate } from '../shared/scenes.js';
import { CREATURES } from './creatures.js';
import { inMatch } from './duelclub.js';
import type { Feature } from './feature.js';
import { qdOnTeam } from './quidditch.js';
import type { World } from './world.js';

declare module './world.js' {
  interface World {
    /** 场景之门 (this module's Feature): when each wizard last went through a gate. */
    gates: { at: Map<string, number> };
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
  w.goal = null; w.route = []; w.goalBy = null;
  world.moved(w);
  world.fx({ k: 'apparate', x: w.pos.x, z: w.pos.z, h: w.handle });
  const to = sceneById(g.to)!;
  if (!w.npc) world.emit('system', `Through the mist: ${to.en}.`, { to: wid, zh: `穿过迷雾：来到${to.zh}。` });
  // a walk that was on its way through this gate goes on from here (maybe to the next gate)
  if (via && via.gate === g) { try { world.setGoal(wid, via.to, via.by); } catch { /* the far side is blocked: stand here */ } }
}

function stepLate(world: World) {
  for (const w of world.wizards.values()) {
    if (!world.isActive(w) || w.st.jailedUntil > 0) continue;
    const g = gateAt(w.pos.x, w.pos.z);
    if (!g) continue;
    if (world.now - (world.gates.at.get(w.id) ?? -1e9) < GATE_COOLDOWN_S) continue;
    if (inMatch(world.duel, w.id) || qdOnTeam(world, w.id)) continue;
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
    w.pos = { ...SPAWN }; w.goal = null; w.route = []; w.goalBy = null;
    world.via.delete(w.id);
    world.moved(w);
  }
  for (const c of world.creatures.values()) {
    const sp = CREATURES[c.kind].spawn;
    if (c.owner || c.ev || !sp.max) continue;
    if (Math.hypot(c.home.x - sp.x, c.home.z - sp.z) > sp.r + 1 || !sceneAt(c.pos.x, c.pos.z)) world.creatures.delete(c.id);
  }
}

export const SCENES_FEATURE: Feature = {
  id: 'scenes',
  init(world) { world.gates = { at: new Map() }; },
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
