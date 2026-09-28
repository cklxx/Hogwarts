import type { EffectPrimitive, Element } from '../shared/constants.js';
import { inZone, ZONES } from '../shared/map.js';
import { analyze } from '../runes/checker.js';
import { Env, Interp, type RuneHost, type Value, display, isRef, isVec, ref, vec } from '../runes/interp.js';
import { type Node, RuneError } from '../runes/parser.js';
import { type Caps, EFFECT_COST, capsFor } from '../runes/primitives.js';
import { gasLimit } from './progression.js';
import { dist } from './physics.js';
import type { Pending, Vec2, Wizard } from './types.js';
import type { World } from './world.js';

export interface CastContext {
  target: string | null;
  aim: Vec2;
  spellName: string;
  incantation: string;
  /** Laws are free and run with seventh-year caps. */
  free?: boolean;
  object?: string | null;
  depth?: number;
  dryRun?: boolean;
  /** Item charms get a 20% discount. */
  discount?: number;
}

export interface Planned { prim: EffectPrimitive; cost: number; desc: string; apply: () => void }

export interface CastReport {
  ok: boolean;
  spell: string;
  mana: number;
  effects: string[];
  notes: string[];
  gas: number;
  error?: string;
}

/**
 * Casting is a transaction: the program runs against a read-only view of the world and *plans*
 * effects. Only if it finishes within gas, within the per-cast effect limit, and the caster can pay
 * for the whole plan, is every effect applied. Otherwise the spell fizzles and costs nothing.
 */
export function execute(world: World, w: Wizard, program: Node[], ctx: CastContext, env0?: Env): CastReport {
  const rb = world.rules;
  const caps: Caps = capsFor(ctx.free ? 7 : w.year);
  const plan: Planned[] = [];
  const pendings: Pending[] = [];
  const notes: string[] = [];
  const clampNote = (what: string, asked: number, cap: number) => {
    if (asked > cap) notes.push(`${what} ${fmt(asked)} clamped to your cap ${fmt(cap)}`);
    return Math.min(asked, cap);
  };
  const refName = (id: string) => {
    const wz = world.wizards.get(id);
    return wz ? `@${wz.name}` : `#${id}`;
  };
  const show = (v: Value) => display(v, refName, 120);
  const posOf = (v: Value, at: Node): Vec2 => {
    if (isVec(v)) return { x: v.x, z: v.z };
    if (isRef(v)) {
      const e = world.entity(v.id);
      if (!e) throw new RuneError(`${v.id} is gone`, at.line, at.col);
      return { ...e.pos };
    }
    throw new RuneError(`expected an entity or point, got ${show(v)}`, at.line, at.col);
  };
  const wizardArg = (v: Value, at: Node, range: number) => {
    const id = (v as { id: string }).id;
    const t = world.wizards.get(id);
    if (!t || !world.isActive(t)) throw new RuneError(`${show(v)} is not a wizard in play`, at.line, at.col);
    if (dist(t.pos, w.pos) > range) throw new RuneError(`${t.name} is out of range (${dist(t.pos, w.pos).toFixed(1)}m > ${range}m)`, at.line, at.col);
    return t;
  };
  const harmable = (v: Value, at: Node, range: number) => {
    const id = (v as { id: string }).id;
    const e = world.entity(id);
    if (!e) throw new RuneError(`${show(v)} is gone`, at.line, at.col);
    if (dist(e.pos, w.pos) > range) throw new RuneError(`target out of range (${dist(e.pos, w.pos).toFixed(1)}m > ${range}m)`, at.line, at.col);
    return e;
  };

  const host: RuneHost = {
    refName,
    rand: () => world.rand(),
    query: (name, args, at) => {
      switch (name) {
        case 'enemies': return world.around(w.pos, args[0] as number, (e) => world.canHarm(w.id, e.id), w.id).map((e) => ref(e.id));
        case 'allies': return world.around(w.pos, args[0] as number, (e) => world.wizards.get(e.id)?.house === w.house, w.id).map((e) => ref(e.id));
        case 'creatures': return world.around(w.pos, args[0] as number, (e) => world.creatures.has(e.id), w.id).map((e) => ref(e.id));
        case 'wizards': return world.around(w.pos, args[0] as number, (e) => world.wizards.has(e.id), w.id).map((e) => ref(e.id));
        case 'hp': return world.entity((args[0] as { id: string }).id)?.hp ?? 0;
        case 'max-hp': return world.entity((args[0] as { id: string }).id)?.maxHp ?? 0;
        case 'mana': return w.mana;
        case 'pos': { const p = posOf(args[0], at); return vec(p.x, p.z); }
        case 'dist': return dist(posOf(args[0], at), posOf(args[1], at));
        case 'ahead': {
          const d = args[0] as number;
          const dx = ctx.aim.x - w.pos.x, dz = ctx.aim.z - w.pos.z;
          const len = Math.hypot(dx, dz) || 1;
          const ux = len > 0.01 ? dx / len : Math.sin(w.facing), uz = len > 0.01 ? dz / len : -Math.cos(w.facing);
          return vec(w.pos.x + ux * d, w.pos.z + uz * d);
        }
        case 'name': return world.entity((args[0] as { id: string }).id)?.name ?? null;
        case 'house': return world.wizards.get((args[0] as { id: string }).id)?.house ?? null;
        case 'kind': { const id = (args[0] as { id: string }).id; return world.wizards.has(id) ? 'wizard' : world.creatures.get(id)?.kind ?? null; }
        case 'year': return world.wizards.get((args[0] as { id: string }).id)?.year ?? 0;
        case 'alive': return (world.entity((args[0] as { id: string }).id)?.hp ?? 0) > 0;
        case 'zone': { const p = posOf(args[0], at); return ZONES.find((z) => z.id !== 'grounds' && inZone(z, p.x, p.z))?.id ?? (inZone(ZONES.find((z) => z.id === 'grounds')!, p.x, p.z) ? 'grounds' : 'wilds'); }
        case 'hour': return world.hour();
        case 'night': return world.isNight();
      }
      throw new RuneError(`unknown query ${name}`, at.line, at.col);
    },
    effect: (name, args, at) => {
      if (!ctx.free && rb.magic.bannedPrimitives.includes(name)) throw new RuneError(`'${name}' is banned by Ministry decree`, at.line, at.col);
      if (plan.length >= caps.effectsPerCast) throw new RuneError(`too many effects in one cast (max ${caps.effectsPerCast} at your year)`, at.line, at.col);
      const mult = rb.magic.costMultipliers[name] ?? 1;
      const push = (costArgs: Record<string, number>, desc: string, apply: () => void) => {
        plan.push({ prim: name, cost: EFFECT_COST[name](costArgs) * mult * (ctx.discount ?? 1), desc, apply });
      };
      switch (name) {
        case 'bolt': {
          const power = clampNote('bolt power', Math.max(0, args[1] as number), caps.boltPower);
          const element = ((args[2] as Element) ?? 'arcane') as Element;
          const homing = isRef(args[0]) ? (args[0] as { id: string }).id : null;
          if (homing) harmable(args[0], at, caps.boltRange);
          const to = posOf(args[0], at);
          return push({ power, elemental: element !== 'arcane' ? 1 : 0 }, `bolt ${fmt(power)} ${element}`, () =>
            world.spawnProjectile(w, 'bolt', to, homing, power, element, 0, tagsFor(ctx)));
        }
        case 'disarm': {
          const t = harmable(args[0], at, caps.boltRange);
          return push({}, `disarm ${t.name}`, () => world.spawnProjectile(w, 'disarm', t.pos, t.id, 0, 'arcane', 2, tagsFor(ctx)));
        }
        case 'root': {
          const t = harmable(args[0], at, caps.boltRange);
          const secs = clampNote('root secs', Math.max(0, args[1] as number), caps.rootSecs);
          return push({ secs }, `root ${t.name} ${fmt(secs)}s`, () => world.spawnProjectile(w, 'root', t.pos, t.id, 0, 'arcane', secs, tagsFor(ctx)));
        }
        case 'heal': {
          const t = wizardArg(args[0], at, caps.supportRange);
          const amount = clampNote('heal', Math.max(0, args[1] as number), caps.healAmount);
          return push({ amount }, `heal ${t.name} ${fmt(amount)}`, () => world.heal(w, t, amount));
        }
        case 'shield': {
          const t = wizardArg(args[0], at, caps.supportRange);
          const amount = clampNote('shield', Math.max(0, args[1] as number), caps.shieldAmount);
          const secs = clampNote('shield secs', Math.max(0, args[2] as number), caps.shieldSecs);
          return push({ amount, secs }, `shield ${t.name} ${fmt(amount)} for ${fmt(secs)}s`, () => world.shield(w, t, amount, secs));
        }
        case 'haste': {
          const t = wizardArg(args[0], at, caps.supportRange);
          const m = clampNote('haste', Math.max(1, args[1] as number), caps.hasteMult);
          const secs = clampNote('haste secs', Math.max(0, args[2] as number), caps.hasteSecs);
          return push({ mult: m, secs }, `haste ${t.name} x${fmt(m)} ${fmt(secs)}s`, () => {
            t.st.hasteMult = m;
            t.st.hasteUntil = world.now + secs;
          });
        }
        case 'push': {
          const t = harmable(args[0], at, caps.pushRange);
          if (!world.canHarm(w.id, t.id)) throw new RuneError(`you cannot push ${t.name} here`, at.line, at.col);
          const force = clampNote('push', Math.max(0, args[1] as number), caps.pushForce);
          return push({ force }, `push ${t.name} ${fmt(force)}m`, () => world.knock(w.pos, t.id, force));
        }
        case 'nova': {
          const radius = clampNote('nova radius', Math.max(0, args[0] as number), caps.novaRadius);
          const power = clampNote('nova power', Math.max(0, args[1] as number), caps.novaPower);
          const element = ((args[2] as Element) ?? 'arcane') as Element;
          return push({ power, radius }, `nova r${fmt(radius)} ${fmt(power)} ${element}`, () => world.nova(w, radius, power, element, tagsFor(ctx)));
        }
        case 'patronus': {
          const secs = clampNote('patronus secs', Math.max(0, args[0] as number), caps.patronusSecs);
          return push({ secs }, `patronus ${fmt(secs)}s`, () => {
            w.st.patronusUntil = world.now + secs;
            world.fx({ k: 'patronus', x: w.pos.x, z: w.pos.z, r: 10, h: w.handle });
          });
        }
        case 'apparate': {
          const to = posOf(args[0], at);
          const d = dist(to, w.pos);
          if (d > caps.apparateRange) throw new RuneError(`too far to Apparate (${d.toFixed(1)}m > ${caps.apparateRange}m)`, at.line, at.col);
          if (!rb.magic.apparitionOnGrounds && (world.onGrounds(w.pos) || world.onGrounds(to)))
            throw new RuneError('You cannot Apparate or Disapparate inside Hogwarts grounds. Haven\'t you read Hogwarts: A History?', at.line, at.col);
          return push({}, `apparate ${d.toFixed(1)}m`, () => world.apparate(w, to));
        }
        case 'light': {
          const secs = Math.min(caps.lightSecs, Math.max(1, (args[0] as number) ?? 30));
          return push({}, 'lumos', () => { w.st.lightUntil = world.now + secs; });
        }
        case 'say': {
          const text = show(args[0]);
          return push({}, `say "${text}"`, () => world.say(w, text, 'spell'));
        }
      }
    },
    schedule: (delay, body, env, at) => {
      if (ctx.free) throw new RuneError('laws cannot schedule (after ...) blocks', at.line, at.col);
      if (ctx.depth) throw new RuneError('a delayed block cannot schedule another (after ...)', at.line, at.col);
      if (pendings.length >= caps.afterPerCast) throw new RuneError(`too many (after ...) blocks (max ${caps.afterPerCast})`, at.line, at.col);
      const d = Math.min(caps.afterDelay, Math.max(0.05, delay));
      if (delay > caps.afterDelay) notes.push(`after ${fmt(delay)}s clamped to ${caps.afterDelay}s`);
      pendings.push({ at: world.now + d, casterId: w.id, body, env, depth: (ctx.depth ?? 0) + 1, spellName: ctx.spellName, incantation: ctx.incantation });
    },
  };

  const interp = new Interp(host, ctx.free ? 300 : gasLimit(w.year, rb));
  const env = env0 ?? new Env();
  if (!env0) {
    env.def('self', ref(w.id));
    env.def('target', ctx.target && world.entity(ctx.target) ? ref(ctx.target) : null);
    env.def('aim', vec(ctx.aim.x, ctx.aim.z));
    env.def('object', ctx.object ? ref(ctx.object) : null);
  }
  const report: CastReport = { ok: false, spell: ctx.spellName, mana: 0, effects: [], notes, gas: 0 };
  try {
    interp.run(program, env);
  } catch (e) {
    report.gas = interp.gasUsed;
    report.error = e instanceof RuneError ? e.message : String(e);
    return report;
  }
  report.gas = interp.gasUsed;
  const total = ctx.free ? 0 : round(rb.magic.castOverhead + plan.reduce((s, p) => s + p.cost, 0));
  report.mana = total;
  report.effects = plan.map((p) => `${p.desc} (${fmt(round(p.cost))} mana)`);
  if (pendings.length) report.effects.push(`${pendings.length} delayed block(s)`);
  if (!ctx.free && total > w.mana) {
    report.error = `not enough mana: needs ${fmt(total)}, you have ${fmt(w.mana)}`;
    return report;
  }
  report.ok = true;
  if (ctx.dryRun) return report;
  w.mana -= total;
  for (const p of plan) p.apply();
  world.pending.push(...pendings);
  return report;
}

const tagsFor = (ctx: CastContext) => [ctx.incantation, ctx.spellName].join(' | ').slice(0, 200).split(' | ');
const round = (n: number) => Math.round(n * 10) / 10;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function compileFor(world: World, w: Wizard | null, source: string, year: number) {
  return analyze(source, { year, maxNodes: 40 + world.rules.magic.nodesPerYear * (year - 1), banned: w ? world.rules.magic.bannedPrimitives : [] });
}
