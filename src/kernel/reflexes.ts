/**
 * 反射 (a Feature): standing orders an agent leaves with its wand hand, carried out by the kernel the moment they
 * apply — no round trip. An MCP call takes most of a second; a bolt crosses a duel in half of one. `reflexes` sets
 * up to REFLEX_MAX rules "when X, do Y"; the tick checks them for their wizard and runs at most one a tick.
 *
 * Triggers: `incoming` (a hostile spell will reach you within REFLEX_ETA s), `hurt` (you just lost health),
 * `low_hp` (below `below` of your maximum), `enemy_near` (a foe within `range` m), `ally_low` (a housemate within
 * `range` m below `below`). Actions: `dodge` (sideways across the spell, else away from the foe), `cast` a spell of
 * yours (at `target`: self, attacker, nearest_enemy or weakest_ally), `ward`, `say`.
 *
 * Every action is the tool it stands for: it spends the same concentration when it happens (a tired hand skips it), and it yields
 * like any agent action — never while your human steers or has paused you (formal/tla/Control.tla), never while you
 * are stunned. Each rule waits its `cooldown` (at least REFLEX_MIN_CD s) between firings. Not saved: after a restart
 * the agent sets them again (reflexes with no rules shows what is set).
 */
import { z } from 'zod';
import { armWard } from './ward.js';
import type { Feature } from './feature.js';
import type { Wizard } from './types.js';
import type { World } from './world.js';

export const REFLEX_MAX = 6, REFLEX_MIN_CD = 1, REFLEX_ETA = 0.6, REFLEX_CHECK_S = 0.1;
const WHEN = ['incoming', 'hurt', 'low_hp', 'enemy_near', 'ally_low'] as const;
const DO = ['dodge', 'cast', 'ward', 'say'] as const;
const TARGET = ['self', 'attacker', 'nearest_enemy', 'weakest_ally'] as const;
export interface Reflex { when: (typeof WHEN)[number]; do: (typeof DO)[number]; spell?: string; target?: (typeof TARGET)[number]; text?: string; below?: number; range?: number; cooldown?: number }

declare module './world.js' {
  interface World {
    /** 反射 (this module's Feature): each wizard's rules, when each rule last fired, when their health was last seen. */
    reflexes: { of: Map<string, Reflex[]>; fired: Map<string, number>; hp: Map<string, number>; acc: number };
  }
}

const TOOL: Record<Reflex['do'], string> = { dodge: 'dodge', cast: 'cast', ward: 'ward', say: 'say' };

/** Set (or with [] clear) this wizard's rules; returns them as the kernel will run them. */
export function setReflexes(world: World, wid: string, rules: Reflex[]) {
  const w = world.need(wid);
  if (rules.length > REFLEX_MAX) throw new Error(`At most ${REFLEX_MAX} reflexes. 最多 ${REFLEX_MAX} 条。`);
  for (const r of rules) {
    if (r.do === 'cast' && (!r.spell || !world.findSpell(w, r.spell))) throw new Error(`cast needs a spell you know (spell: "${r.spell ?? ''}"). cast 需要一个你会的咒语。`);
    if (r.do === 'say' && !r.text) throw new Error('say needs text. say 需要 text。');
  }
  const clean = rules.map((r) => ({ ...r, cooldown: Math.max(REFLEX_MIN_CD, r.cooldown ?? 2) }));
  if (clean.length) world.reflexes.of.set(wid, clean); else world.reflexes.of.delete(wid);
  for (const k of [...world.reflexes.fired.keys()]) if (k.startsWith(`${wid}:`)) world.reflexes.fired.delete(k);
  return { reflexes: clean, note: clean.length ? 'The kernel now runs these for you, at most one a tick, each after its cooldown; they spend concentration like the tools and yield to your human.' : 'No reflexes.' };
}

const d2 = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

function nearestEnemy(world: World, w: Wizard, range: number) {
  return world.around(w.pos, range, (e) => world.canHarm(w.id, e.id) && !world.isBenign(e.id), w.id, 8).sort((a, b) => d2(a.pos, w.pos) - d2(b.pos, w.pos))[0];
}
function weakestAlly(world: World, w: Wizard, range: number) {
  let best: Wizard | undefined, frac = 2;
  for (const x of world.nearWizards(w.pos, range)) {
    if (x === w || x.house !== w.house || !world.isActive(x) || d2(x.pos, w.pos) > range) continue;
    const f = x.hp / world.derivedOf(x).maxHp;
    if (f < frac) { frac = f; best = x; }
  }
  return best ? { w: best, frac } : null;
}

/** Does this rule apply right now? Returns what it needs (an attacker, a foe, an ally), or null. */
function applies(world: World, w: Wizard, r: Reflex, hurt: boolean) {
  const range = r.range ?? 12;
  switch (r.when) {
    case 'incoming': { const t = world.threats(w.id).find((x) => x.eta <= REFLEX_ETA); return t ? { attacker: t.owner, vx: t.vx, vz: t.vz } : null; }
    case 'hurt': return hurt ? {} : null;
    case 'low_hp': return w.hp / world.derivedOf(w).maxHp < (r.below ?? 0.35) ? {} : null;
    case 'enemy_near': { const e = nearestEnemy(world, w, range); return e ? { enemy: e.id, ex: e.pos.x, ez: e.pos.z } : null; }
    case 'ally_low': { const a = weakestAlly(world, w, range); return a && a.frac < (r.below ?? 0.4) ? { ally: a.w.id } : null; }
  }
}

function act(world: World, w: Wizard, r: Reflex, ctx: { attacker?: string; vx?: number; vz?: number; enemy?: string; ex?: number; ez?: number; ally?: string }): boolean {
  switch (r.do) {
    case 'dodge': {
      // across the spell's path (left of its flight), else straight away from the foe, else forward
      const [dx, dz] = ctx.vx !== undefined ? [-(ctx.vz ?? 0), ctx.vx] : ctx.ex !== undefined ? [w.pos.x - ctx.ex, w.pos.z - (ctx.ez ?? 0)] : [Math.sin(w.facing), -Math.cos(w.facing)];
      return world.dodge(w.id, dx, dz, 'agent').ok;
    }
    case 'ward': return !!armWard(world, w.id, undefined, 'agent');
    case 'say': world.say(w, r.text!, 'mcp'); return true;
    case 'cast': {
      const tg = r.target ?? 'nearest_enemy';
      const target = tg === 'self' ? w.id : tg === 'attacker' ? ctx.attacker ?? ctx.enemy : tg === 'weakest_ally' ? ctx.ally ?? weakestAlly(world, w, r.range ?? 15)?.w.id : ctx.enemy ?? nearestEnemy(world, w, r.range ?? 20)?.id;
      if (!target) return false;
      return world.cast(w.id, r.spell!, { target }).ok;
    }
  }
}

function step(world: World, dt: number) {
  const R = world.reflexes;
  if (!R.of.size) return;
  R.acc += dt;
  if (R.acc < REFLEX_CHECK_S) return;
  R.acc = 0;
  for (const [wid, rules] of R.of) {
    const w = world.wizards.get(wid);
    if (!w || (w.npc && !w.heldBy)) { R.of.delete(wid); continue; } // gone, or an NPC its possessor gave back (possess.ts)
    const hp0 = R.hp.get(wid) ?? w.hp, hurt = w.hp < hp0 - 0.5;
    R.hp.set(wid, w.hp);
    if (!world.isActive(w) || w.agentPaused || world.playerSteering(w)) continue; // your human first (Control.tla)
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i], key = `${wid}:${i}`;
      if (world.now - (R.fired.get(key) ?? -1e9) < (r.cooldown ?? 2)) continue;
      const ctx = applies(world, w, r, hurt);
      if (!ctx) continue;
      if (world.rules.agents.concentration && world.focusState(wid).cur < 1) break; // a tired wand hand
      R.fired.set(key, world.now);
      let done = false;
      try { done = act(world, w, r, ctx); } catch { /* refused (recharging, silenced…): it just does not happen, and costs nothing */ }
      if (done) { world.spendConcentration(wid, TOOL[r.do]); break; } // paid like the tool, only when it happened
    }
  }
}

export const REFLEX_FEATURE: Feature = {
  id: 'reflexes',
  init(world) { world.reflexes = { of: new Map(), fired: new Map(), hp: new Map(), acc: 0 }; },
  step,
  tools: [{
    name: 'reflexes', title: 'Reflexes: standing orders', cost: 0,
    description: `反射: rules the kernel runs for you the instant they apply (an MCP round trip is too slow for a duel). rules = up to ${REFLEX_MAX} of {when, do, …}; [] clears; no rules shows what is set. when: incoming (a hostile spell reaches you within ${REFLEX_ETA}s) | hurt | low_hp (below, default 0.35 of max) | enemy_near (range, default 12 m) | ally_low (a housemate within range below "below"). do: dodge | cast (spell = one of yours; target = self | attacker | nearest_enemy | weakest_ally) | ward | say (text). cooldown ≥ ${REFLEX_MIN_CD}s (default 2). First matching rule wins, one action a tick; each spends concentration like the tool and yields to your human. Example: [{"when":"incoming","do":"dodge"},{"when":"low_hp","do":"cast","spell":"Episkey","target":"self"},{"when":"enemy_near","do":"cast","spell":"Stupefy","cooldown":1.5}].`,
    input: {
      rules: z.array(z.object({
        when: z.enum(WHEN), do: z.enum(DO), spell: z.string().max(60).optional(), target: z.enum(TARGET).optional(), text: z.string().max(200).optional(),
        below: z.number().min(0.05).max(0.95).optional(), range: z.number().min(1).max(30).optional(), cooldown: z.number().min(REFLEX_MIN_CD).max(60).optional(),
      })).max(REFLEX_MAX).optional(),
    },
    run: (world, wid, a) => (Array.isArray(a.rules) ? setReflexes(world, wid, a.rules as Reflex[]) : { reflexes: world.reflexes.of.get(wid) ?? [] }),
  }],
};
