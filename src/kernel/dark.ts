/**
 * 黑魔法 (a Feature): four Dark Arts as Runes primitives, for a price.
 *
 * - `(sectumsempra target)` — an unseen blade: a bolt that opens a wound bleeding DARK_BLEED a second for up to
 *   DARK_BLEED_S (the 'poison' aura; cleanse closes it).
 * - `(fiendfyre place power)` — cursed fire at a point: DARK_FIRE_PULSES pulses a second apart on everything harmable
 *   within DARK_FIRE_R (World.canHarm decides, as for any area spell).
 * - `(imperio creature secs)` — a wild creature fights for you for up to DARK_IMPERIO_S, then remembers itself.
 *   Never a wizard (nobody's will is taken), a benign creature, a school event's creature or someone's summon.
 * - `(morsmordre)` — the Dark Mark in the sky over you for DARK_MARK_S; the whole school sees it.
 *
 * Every one needs year DARK_YEAR and a broken seal (the Restricted Section), and each one cast deepens your
 * darkness (DARK_COST) and costs your house DARK_CUP points — never below zero (World.cupLose), and nothing in
 * the lawless forest, where there is no Ministry. Darkness fades DARK_FADE a second; at DARK_SHOWN or more everyone
 * sees it on you (the snapshot's `dk`). The Minister can ban any of them by decree (rules.magic.bannedPrimitives)
 * like any other primitive. Nothing here passes World.canHarm or the stat floors (docs/RULES.md).
 */
import { RuneError } from '../runes/parser.js';
import { zhPlace } from '../shared/zh.js';
import type { Prim } from '../runes/primitives.js';
import type { Feature, FeatureSpell } from './feature.js';
import type { Projectile, Wizard } from './types.js';
import type { World } from './world.js';

export const DARK_YEAR = 4, DARK_SEALS = 1;
export const DARK_BLEED = 3, DARK_BLEED_S = 6, DARK_FIRE_R = 4, DARK_FIRE_PULSES = 3, DARK_IMPERIO_S = 15, DARK_MARK_S = 20;
export const DARK_COST: Record<string, number> = { sectumsempra: 8, fiendfyre: 12, imperio: 15, morsmordre: 5 };
export const DARK_CUP: Record<string, number> = { sectumsempra: 2, fiendfyre: 3, imperio: 4, morsmordre: 1 };
export const DARK_FADE = 1 / 15, DARK_SHOWN = 30, DARK_MAX = 100;
const SECTUM_TAG = 'sectumsempra';

declare module './world.js' {
  interface World {
    /** 黑魔法 (this module's Feature): darkness per wizard, cursed fires burning, creatures under the Imperius, Dark Marks in the sky. */
    dark: {
      of: Map<string, number>;
      fires: { owner: string; x: number; z: number; power: number; next: number; left: number }[];
      imperio: Map<string, { owner: string; until: number }>;
      marks: { x: number; z: number; until: number; by: string }[];
    };
  }
}

const a = (name: string, type: Prim['args'][number]['type'], optional = false) => ({ name, type, optional });
const prim = (name: string, args: Prim['args'], doc: string, example: string): Prim =>
  ({ name, kind: 'effect', year: DARK_YEAR, seals: DARK_SEALS, args, doc: `[Dark Arts] ${doc} Deepens your darkness and costs your house points (not in the lawless forest).`, example });

/** The price of one dark act, paid when the cast commits. */
function stain(world: World, w: Wizard, what: string) {
  const d = world.dark.of;
  d.set(w.id, Math.min(DARK_MAX, (d.get(w.id) ?? 0) + DARK_COST[what]));
  if (!world.inLawless(w.pos)) world.cupLose(w, DARK_CUP[what]);
}

const SPELLS: FeatureSpell[] = [
  {
    prim: prim('sectumsempra', [a('at', 'ent')], `An unseen blade: a bolt that opens a wound bleeding ${DARK_BLEED} a second for ${DARK_BLEED_S} s (cleanse closes it). Cost 26.`, '(sectumsempra target)'),
    cost: () => 26,
    plan(api, args, at) {
      const t = api.harmable(args[0], at, api.caps.boltRange);
      return {
        cost: {}, desc: `sectumsempra ${t.name}`,
        apply: () => { api.world.spawnProjectile(api.caster, 'bolt', t.pos, t.id, 6, 'arcane', 0, [...api.tags, SECTUM_TAG]); stain(api.world, api.caster, 'sectumsempra'); },
      };
    },
  },
  {
    prim: prim('fiendfyre', [a('at', 'place'), a('power', 'num')], `Cursed fire at a point within 20 m: ${DARK_FIRE_PULSES} pulses a second apart on everything harmable within ${DARK_FIRE_R} m. Cost: 1.6*power*pulses; power ≤ 6+3*year.`, '(fiendfyre aim 12)'),
    cost: ({ power }) => 1.6 * power * DARK_FIRE_PULSES,
    plan(api, args, at) {
      const p = api.posOf(args[0], at), w = api.caster;
      if (Math.hypot(p.x - w.pos.x, p.z - w.pos.z) > 20) throw new RuneError('fiendfyre: too far (20 m at most)', at.line, at.col);
      const power = api.clamp('fiendfyre power', Math.max(0, Number(args[1]) || 0), 6 + 3 * w.year);
      return {
        cost: { power }, desc: `fiendfyre ${Math.round(power)} ×${DARK_FIRE_PULSES}`,
        apply: () => { api.world.dark.fires.push({ owner: w.id, x: p.x, z: p.z, power, next: api.world.now, left: DARK_FIRE_PULSES }); stain(api.world, w, 'fiendfyre'); },
      };
    },
  },
  {
    prim: prim('imperio', [a('at', 'ent'), a('secs', 'num')], `A wild creature fights for you for up to ${DARK_IMPERIO_S} s, then remembers itself. Never a wizard, a benign creature, a school event's creature or a summon. Cost: 20+2*secs.`, '(imperio (nearest-enemy) 10)'),
    cost: ({ secs }) => 20 + 2 * secs,
    plan(api, args, at) {
      const world = api.world, w = api.caster;
      const t = api.harmable(args[0], at, api.caps.boltRange);
      const c = world.creatures.get(t.id);
      if (!c) throw new RuneError('imperio: only a creature (nobody takes a wizard\'s will here)', at.line, at.col);
      if (c.owner || c.ev || world.isBenign(c.id)) throw new RuneError('imperio: not a summon, a benign creature or a school event\'s creature', at.line, at.col);
      if (!world.canHarm(w.id, c.id)) throw new RuneError('imperio: you cannot reach its mind here', at.line, at.col);
      const secs = api.clamp('imperio secs', Math.max(1, Number(args[1]) || 0), DARK_IMPERIO_S);
      return {
        cost: { secs }, desc: `imperio ${t.name} ${Math.round(secs)}s`,
        apply: () => {
          if (!world.creatures.has(c.id) || c.owner) return;
          c.owner = w.id; c.target = null; c.until = world.now + secs + 5; // the step hands it back at `until` below, before the summons' own end
          world.dark.imperio.set(c.id, { owner: w.id, until: world.now + secs });
          stain(world, w, 'imperio');
        },
      };
    },
  },
  {
    prim: prim('morsmordre', [], `The Dark Mark in the sky over you for ${DARK_MARK_S} s: the whole school sees it. Cost 12.`, '(morsmordre)'),
    cost: () => 12,
    plan(api) {
      const world = api.world, w = api.caster;
      return {
        cost: {}, desc: 'morsmordre',
        apply: () => {
          world.dark.marks = [...world.dark.marks.filter((m) => m.until > world.now), { x: w.pos.x, z: w.pos.z, until: world.now + DARK_MARK_S, by: w.handle }].slice(-4);
          world.emit('dark', `The Dark Mark hangs in the sky over ${world.placeName(w.pos)}.`, { who: [w.id], zh: `黑魔标记悬在${zhPlace(world.placeName(w.pos))}上空。` });
          stain(world, w, 'morsmordre');
        },
      };
    },
  },
];

function step(world: World, dt: number) {
  const d = world.dark;
  if (d.of.size) for (const [id, v] of d.of) { const n = v - DARK_FADE * dt; if (n <= 0) d.of.delete(id); else d.of.set(id, n); }
  for (const f of d.fires) {
    if (world.now < f.next) continue;
    f.next = world.now + 1; f.left--;
    world.fx({ k: 'nova', x: f.x, z: f.z, r: DARK_FIRE_R, e: 'fire' });
    for (const e of world.around({ x: f.x, z: f.z }, DARK_FIRE_R, (x) => world.canHarm(f.owner, x.id), f.owner, 16)) world.damage(f.owner, e.id, f.power, 'fire', ['fiendfyre']);
  }
  if (d.fires.length) d.fires = d.fires.filter((f) => f.left > 0);
  for (const [id, m] of d.imperio) {
    const c = world.creatures.get(id);
    if (!c) { d.imperio.delete(id); continue; }
    if (world.now >= m.until || c.owner !== m.owner) { if (c.owner === m.owner) { c.owner = null; c.until = 0; c.target = null; } d.imperio.delete(id); }
  }
  if (d.marks.length && d.marks[0].until <= world.now) d.marks = d.marks.filter((m) => m.until > world.now);
}

export const DARK_FEATURE: Feature = {
  id: 'dark',
  init(world) { world.dark = { of: new Map(), fires: [], imperio: new Map(), marks: [] }; },
  spells: SPELLS,
  stepLate: step,
  // who wears their darkness openly, and the Dark Marks in the sky
  wire: {
    key: 'dk',
    get(world) {
      const d = world.dark;
      const shown = [...d.of].filter(([, v]) => v >= DARK_SHOWN).map(([id]) => world.wizards.get(id)?.handle ?? '');
      return shown.length || d.marks.length ? { w: shown, m: d.marks.map((m) => [Math.round(m.x), Math.round(m.z), Math.ceil(m.until - world.now)]) } : undefined;
    },
  },
  hit(world, p: Projectile, id) { if (p.tags.includes(SECTUM_TAG)) world.applyAura(id, 'poison', DARK_BLEED_S, DARK_BLEED, p.owner); },
  tools: [{
    name: 'darkness', title: 'Your darkness', cost: 0, readOnly: true,
    description: `黑魔法: how dark you are (0–${DARK_MAX}; others see it from ${DARK_SHOWN}; it fades ${Math.round(DARK_FADE * 60)} a minute) and the Dark Arts (year ${DARK_YEAR}, a broken seal): sectumsempra, fiendfyre, imperio, morsmordre — Runes primitives, see the grimoire. Each costs your house points outside the lawless forest.`,
    input: {},
    run: (world, wid) => ({ darkness: Math.round(world.dark.of.get(wid) ?? 0), shownFrom: DARK_SHOWN, max: DARK_MAX, costs: DARK_COST, housePoints: DARK_CUP, needs: { year: DARK_YEAR, seals: DARK_SEALS } }),
  }],
};
