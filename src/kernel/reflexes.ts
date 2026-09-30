/**
 * 反射 (a Feature): standing orders an agent leaves with its wand hand, carried out by the kernel the moment they
 * apply — no round trip. An MCP call takes most of a second; a bolt crosses a duel in half of one (playtest round 3:
 * "the warning comes 0.4 s ahead, a tool call takes 1 s: dodging and parrying never work"). `reflexes` sets up to
 * REFLEX_MAX rules "when X, do Y", or a preset; the tick checks them every REFLEX_CHECK_S.
 *
 * Triggers: `incoming` (a hostile spell will reach you within REFLEX_ETA s), `hurt` (you just lost health),
 * `low_hp` (below `below` of your maximum), `enemy_near` (a foe within `range` m: a wild creature, or a wizard you are already fighting), `ally_low` (a housemate within
 * `range` m below `below`). Actions: `dodge` (sideways across the spell, else away from the foe), `cast` a spell of
 * yours (at `target`: self, attacker, nearest_enemy or weakest_ally), `ward`, `say`.
 *
 * Rules are tried in order; the first that applies AND works is the tick's one action — one that applies but cannot
 * act (ward recharging, no target) lets the next rule try, so a list reads as "ward, else dodge". Each rule waits its
 * `cooldown` (at least REFLEX_MIN_CD s) after it acted. Every action is the tool it stands for: the same
 * concentration, spent only when it happened; never while your human steers or has paused you (formal/tla/Control.tla),
 * never while stunned.
 *
 * Seen clearly: every rule counts what it did and says why it last did not (tired, no target, refused and why);
 * every action is a private `reflex` event (in wait, inbox and your human's agent panel); `explain` answers, rule by
 * rule, whether it would act right now. Saved with the world.
 */
import { z } from 'zod';
import { inFight } from './duelclub.js';
import { armWard } from './ward.js';
import type { Feature } from './feature.js';
import type { Wizard } from './types.js';
import type { World } from './world.js';

export const REFLEX_MAX = 6, REFLEX_MIN_CD = 1, REFLEX_ETA = 0.6, REFLEX_CHECK_S = 0.1;
const WHEN = ['incoming', 'hurt', 'low_hp', 'enemy_near', 'ally_low'] as const;
const DO = ['dodge', 'cast', 'ward', 'say'] as const;
const TARGET = ['self', 'attacker', 'nearest_enemy', 'weakest_ally'] as const;
export interface Reflex { when: (typeof WHEN)[number]; do: (typeof DO)[number]; spell?: string; target?: (typeof TARGET)[number]; text?: string; below?: number; range?: number; cooldown?: number; keep?: number }
/** What a rule has done: how often, when last, and (when it applied but did not act) why not. */
interface Stat { n: number; last: number; why: string; whyAt?: number }
type Ctx = { attacker?: string; vx?: number; vz?: number; enemy?: string; ex?: number; ez?: number; ally?: string };

declare module './world.js' {
  interface World {
    /** 反射 (this module's Feature): each wizard's rules, what each rule did, when their health was last seen. */
    reflexes: { of: Map<string, Reflex[]>; stat: Map<string, Stat[]>; hp: Map<string, number>; acc: number };
  }
}

const TOOL: Record<Reflex['do'], string> = { dodge: 'dodge', cast: 'cast', ward: 'ward', say: 'say' };

/**
 * Ready-made strategies, built from the spells this wizard knows (a rule needing one it lacks is left out).
 * The first matching rule that can act wins, so each list reads top-down as "this, else that".
 */
export const PRESETS: Record<string, { zh: string; en: string; build(has: (s: string) => boolean): Reflex[] }> = {
  duelist: {
    zh: '决斗：来袭先举铁甲咒（完美格挡），举不起就翻滚；残血自愈；正在交手的敌人进 12 米就昏昏倒地', en: 'duels: meet a bolt with the ward (perfect parry), else roll; heal when low; Stupefy a foe you are fighting within 12 m',
    build: (has) => [{ when: 'incoming', do: 'ward', keep: 0.2 }, { when: 'incoming', do: 'dodge' }, ...(has('Episkey') ? [{ when: 'low_hp', do: 'cast', spell: 'Episkey', target: 'self', below: 0.4 } as Reflex] : []), ...(has('Stupefy') ? [{ when: 'enemy_near', do: 'cast', spell: 'Stupefy', target: 'nearest_enemy', range: 12, cooldown: 1.5, keep: 0.35 } as Reflex] : [])],
  },
  hunter: {
    zh: '打怪：来袭翻滚；残血自愈；挨打就举盔甲护身', en: 'creatures: roll from what flies at you; heal when low; Protego when hit',
    build: (has) => [{ when: 'incoming', do: 'dodge' }, ...(has('Episkey') ? [{ when: 'low_hp', do: 'cast', spell: 'Episkey', target: 'self', below: 0.45 } as Reflex] : []), ...(has('Protego') ? [{ when: 'hurt', do: 'cast', spell: 'Protego', target: 'self', cooldown: 4 } as Reflex] : [])],
  },
  healer: {
    zh: '治疗：自己残血先自愈；队友残血就治最虚弱的；来袭翻滚', en: 'support: yourself first when low; heal the weakest housemate nearby; roll from bolts',
    build: (has) => [...(has('Episkey') ? [{ when: 'low_hp', do: 'cast', spell: 'Episkey', target: 'self', below: 0.35 } as Reflex, { when: 'ally_low', do: 'cast', spell: 'Episkey', target: 'weakest_ally', below: 0.5, range: 15 } as Reflex] : []), { when: 'incoming', do: 'dodge' }],
  },
  survivor: {
    zh: '新手自保：来袭翻滚；残血自愈；快倒了就喊救命', en: 'first-years: roll from bolts; heal when low; call for help when nearly down',
    build: (has) => [{ when: 'incoming', do: 'dodge' }, ...(has('Episkey') ? [{ when: 'low_hp', do: 'cast', spell: 'Episkey', target: 'self', below: 0.4 } as Reflex] : []), { when: 'low_hp', do: 'say', text: 'Help! 救命！', below: 0.2, cooldown: 20 }],
  },
};

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
  world.reflexes.stat.set(wid, clean.map(() => ({ n: 0, last: -1e9, why: '' })));
  return view(world, wid);
}

/** The rules with what each has done, for the agent. */
function view(world: World, wid: string) {
  const rules = world.reflexes.of.get(wid) ?? [], stat = world.reflexes.stat.get(wid) ?? [];
  return {
    reflexes: rules.map((r, i) => {
      const s = stat[i];
      return { ...r, fired: s?.n ?? 0, ...(s && s.n ? { lastFired: `${Math.round(world.now - s.last)} s ago` } : {}), ...(s?.why ? { notActing: `${s.why} (${Math.round(world.now - (s.whyAt ?? world.now))} s ago)` } : {}) };
    }),
    note: rules.length ? 'The kernel runs these for you, tried in order: the first that applies and can act is the tick\'s one action. Each action is a private "reflex" event (wait, inbox). explain: true says, rule by rule, whether it would act right now.' : `No reflexes. Try a preset: ${Object.keys(PRESETS).join(', ')}.`,
  };
}

const d2 = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/** A bolt fired before the bell may land this long after it: not a new fight. */
const BELL_GRACE_S = 3;
/**
 * A wizard, or a wizard's summon, is a reflex's foe only once the fight is on: you are fighting on the duel stage
 * (canHarm leaves only your opponents), or one of you hit the other in the last 30 s (recentHits) and not before your
 * last match together ended. A reflex never starts a fight (playtest round 5: the duelist preset went on Stupefying
 * the opponent after the match, and a passer-by's summon). Wild creatures are always fair game.
 */
function fighting(world: World, w: Wizard, id: string) {
  const who = world.credit(id)!;
  if (!world.wizards.has(who) || inFight(world.duel, w.id)) return true;
  // ponytail: DuelResult keeps the two leaders only, so a 2v2 partner's hits from the match still count
  const bell = world.duel.last.reduce((t, r) => ((r.a === w.id && r.b === who) || (r.a === who && r.b === w.id) ? Math.max(t, r.at + BELL_GRACE_S) : t), -Infinity);
  const since = (h: { secondsAgo: number }) => world.now - h.secondsAgo > bell;
  return world.recentHits(who).some((h) => h.target === w.id && since(h)) || world.recentHits(w.id).some((h) => (h.target === who || h.target === id) && since(h));
}
function nearestEnemy(world: World, w: Wizard, range: number) {
  return world.around(w.pos, range, (e) => world.canHarm(w.id, e.id) && !world.isBenign(e.id) && fighting(world, w, e.id), w.id, 8)[0];
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
function applies(world: World, w: Wizard, r: Reflex, hurt: boolean): Ctx | null {
  const range = r.range ?? 12;
  switch (r.when) {
    case 'incoming': {
      if ((world.wards.get(w.id)?.until ?? 0) > world.now) return null; // a ward is up: it meets the bolt (a roll now would only dodge the parry)
      const t = world.threats(w.id).find((x) => x.eta <= REFLEX_ETA);
      return t ? { attacker: t.owner, vx: t.vx, vz: t.vz } : null;
    }
    case 'hurt': return hurt ? {} : null;
    case 'low_hp': return w.hp / world.derivedOf(w).maxHp < (r.below ?? 0.35) ? {} : null;
    case 'enemy_near': { const e = nearestEnemy(world, w, range); return e ? { enemy: e.id, ex: e.pos.x, ez: e.pos.z } : null; }
    case 'ally_low': { const a = weakestAlly(world, w, range); return a && a.frac < (r.below ?? 0.4) ? { ally: a.w.id } : null; }
  }
}

/** Do it: what happened (to say), or why not (thrown, or returned as `no`). */
function act(world: World, w: Wizard, r: Reflex, ctx: Ctx): { ok: true; did: string; zh: string } | { ok: false; no: string } {
  switch (r.do) {
    case 'dodge': {
      // across the spell's path (left of its flight), else straight away from the foe, else forward
      const [dx, dz] = ctx.vx !== undefined ? [-(ctx.vz ?? 0), ctx.vx] : ctx.ex !== undefined ? [w.pos.x - ctx.ex, w.pos.z - (ctx.ez ?? 0)] : [Math.sin(w.facing), -Math.cos(w.facing)];
      const res = world.dodge(w.id, dx, dz, 'agent');
      return res.ok ? { ok: true, did: 'rolled aside', zh: '翻滚躲开' } : { ok: false, no: res.error };
    }
    case 'ward': armWard(world, w.id, undefined, 'agent'); return { ok: true, did: 'raised the ward', zh: '举起了铁甲咒' };
    case 'say': world.say(w, r.text!, 'mcp'); return { ok: true, did: `said "${r.text}"`, zh: `说：「${r.text}」` };
    case 'cast': {
      const tg = r.target ?? 'nearest_enemy';
      const target = tg === 'self' ? w.id : tg === 'attacker' ? ctx.attacker ?? ctx.enemy : tg === 'weakest_ally' ? ctx.ally ?? weakestAlly(world, w, r.range ?? 15)?.w.id : ctx.enemy ?? nearestEnemy(world, w, r.range ?? 20)?.id;
      if (!target) return { ok: false, no: `no ${tg.replace('_', ' ')} in reach` };
      // a wizard is named by handle, as a player would (cast takes a registry id only from NPCs: playtest round 4 —
      // every duelist reflex aimed at a wizard used to fail with "no such target")
      const rep = world.cast(w.id, r.spell!, { target: target === w.id ? w.id : world.wizards.get(target)?.handle ?? target });
      const who = world.entity(target)?.name ?? target;
      return rep.ok ? { ok: true, did: `cast ${rep.spell}${target === w.id ? '' : ` at ${who}`}`, zh: `${target === w.id ? '' : `对 ${who} `}施放了 ${rep.spell}` } : { ok: false, no: rep.error ?? 'refused' };
    }
  }
}

const TRIGGER_ZH: Record<Reflex['when'], string> = { incoming: '咒语来袭', hurt: '挨打', low_hp: '残血', enemy_near: '敌人靠近', ally_low: '队友残血' };

function step(world: World, dt: number) {
  const R = world.reflexes;
  if (!R.of.size) return;
  R.acc += dt;
  if (R.acc < REFLEX_CHECK_S) return;
  R.acc = 0;
  for (const [wid, rules] of R.of) {
    const w = world.wizards.get(wid);
    if (!w || (w.npc && !w.heldBy)) { R.of.delete(wid); R.stat.delete(wid); continue; } // gone, or an NPC its possessor gave back (possess.ts)
    const hp0 = R.hp.get(wid) ?? w.hp, hurt = w.hp < hp0 - 0.5;
    R.hp.set(wid, w.hp);
    if (!world.isActive(w) || w.agentPaused || world.playerSteering(w)) continue; // your human first (Control.tla)
    let stat = R.stat.get(wid);
    if (!stat || stat.length !== rules.length) { stat = rules.map(() => ({ n: 0, last: -1e9, why: '' })); R.stat.set(wid, stat); }
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i], s = stat[i];
      if (world.now - s.last < (r.cooldown ?? 2)) continue;
      const ctx = applies(world, w, r, hurt);
      if (!ctx) continue;
      if (r.keep && w.mana < r.keep * world.derivedOf(w).maxMana) { s.why = `saving mana: acts only above ${Math.round(r.keep * 100)} % (keep)`; s.whyAt = world.now; continue; }
      if (world.rules.agents.concentration && world.focusState(wid).cur < 1) { s.why = 'your wand hand is tired (concentration): it acts again when rested'; s.whyAt = world.now; break; }
      let res: ReturnType<typeof act>;
      try { res = act(world, w, r, ctx); } catch (e) { res = { ok: false, no: (e as Error).message }; }
      if (!res.ok) { s.why = res.no.slice(0, 160); s.whyAt = world.now; continue; } // refused (recharging, no target, a wall…): costs nothing, the next rule may act
      s.n++; s.last = world.now; s.why = '';
      world.spendConcentration(wid, TOOL[r.do]); // paid like the tool, only when it happened
      world.noteAgentCall(wid, `reflex:${r.do}`, true, r.spell); // your human's agent panel
      world.emit('reflex', `Reflex #${i + 1} (${r.when}): ${res.did}.`, { to: wid, zh: `反射 #${i + 1}（${TRIGGER_ZH[r.when]}）：${res.zh}。` });
      break;
    }
  }
}

/** Rule by rule: would it act right now, and if not, why. */
function explain(world: World, wid: string) {
  const w = world.need(wid), rules = world.reflexes.of.get(wid) ?? [], stat = world.reflexes.stat.get(wid) ?? [];
  const blocked = !world.isActive(w) ? 'you are down (stunned or in Azkaban)' : w.agentPaused ? 'your human paused you' : world.playerSteering(w) ? 'your human is steering' : world.rules.agents.concentration && world.focusState(wid).cur < 1 ? 'your wand hand is tired (concentration)' : null;
  return rules.map((r, i) => {
    const cd = Math.max(0, (r.cooldown ?? 2) - (world.now - (stat[i]?.last ?? -1e9)));
    const ctx = applies(world, w, r, false);
    const saving = r.keep && w.mana < r.keep * world.derivedOf(w).maxMana;
    const state = blocked ? `waits: ${blocked}` : saving ? `saving mana: acts only above ${Math.round(r.keep! * 100)} % (keep)` : cd > 0 ? `cooling down: ${cd.toFixed(1)} s` : !ctx ? (r.when === 'hurt' ? 'waits for you to be hit' : `waits: no ${r.when.replace('_', ' ')} now`) : 'would act now';
    return { rule: i + 1, when: r.when, do: r.do, ...(r.spell ? { spell: r.spell } : {}), state };
  });
}

export const REFLEX_FEATURE: Feature = {
  id: 'reflexes',
  init(world) { world.reflexes = { of: new Map(), stat: new Map(), hp: new Map(), acc: 0 }; },
  step,
  save: (world) => Object.fromEntries(world.reflexes.of),
  load(world, data) {
    if (!data || typeof data !== 'object') return;
    // (features load before the wizards do: a rule for a wizard no longer here is dropped by the first step, and
    // one naming a spell forgotten since simply says so when it applies)
    for (const [wid, rules] of Object.entries(data as Record<string, Reflex[]>)) if (Array.isArray(rules)) world.reflexes.of.set(wid, rules.slice(0, REFLEX_MAX));
  },
  view: { key: 'reflexes', whoami: (world, w) => { const n = world.reflexes.of.get(w.id)?.length ?? 0; return n ? `${n} set (reflexes shows them and what they did)` : 'none: reflexes react for you faster than any tool call (try preset "duelist" or "hunter")'; } },
  tools: [{
    name: 'reflexes', title: 'Reflexes: standing orders', cost: 0,
    description: `反射: rules the kernel runs for you the instant they apply — an MCP round trip is too slow to dodge or parry. Easiest: preset = ${Object.entries(PRESETS).map(([k, p]) => `${k} (${p.en})`).join('; ')}. Or rules = up to ${REFLEX_MAX} of {when, do, …}, tried in order (the first that applies and can act wins; one that cannot, e.g. ward recharging, lets the next try); [] clears. when: incoming (a hostile spell reaches you within ${REFLEX_ETA}s) | hurt | low_hp (below, default 0.35 of max) | enemy_near (range, default 12 m; a wizard or their summon only once you are fighting: a duel, or a hit either way in the last 30 s — a reflex never starts a fight) | ally_low (a housemate within range below "below"). do: dodge | cast (spell = one of yours; target = self | attacker | nearest_enemy | weakest_ally) | ward (perfect parry) | say (text). cooldown ≥ ${REFLEX_MIN_CD}s (default 2); keep = a share of your mana the rule leaves alone (e.g. 0.35: it acts only above 35 %, so a heal stays affordable). Each action spends concentration like the tool, yields to your human, and is a private "reflex" event (wait, inbox). No arguments: the rules, how often each fired and why one is not acting; explain: true — would each act right now. Saved with the world.`,
    input: {
      preset: z.enum(Object.keys(PRESETS) as [string, ...string[]]).optional(),
      rules: z.array(z.object({
        when: z.enum(WHEN), do: z.enum(DO), spell: z.string().max(60).optional(), target: z.enum(TARGET).optional(), text: z.string().max(200).optional(),
        below: z.number().min(0.05).max(0.95).optional(), range: z.number().min(1).max(30).optional(), cooldown: z.number().min(REFLEX_MIN_CD).max(60).optional(),
        keep: z.number().min(0).max(0.9).optional(),
      })).max(REFLEX_MAX).optional(),
      explain: z.boolean().optional(),
    },
    run(world, wid, a) {
      if (typeof a.preset === 'string') {
        const w = world.need(wid);
        return { preset: a.preset, ...setReflexes(world, wid, PRESETS[a.preset].build((s) => !!world.findSpell(w, s))) };
      }
      if (Array.isArray(a.rules)) return setReflexes(world, wid, a.rules as Reflex[]);
      return { ...view(world, wid), ...(a.explain ? { now: explain(world, wid) } : {}) };
    },
  }],
};
