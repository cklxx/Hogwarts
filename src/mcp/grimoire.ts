import { ELEMENTS } from '../shared/constants.js';
import { CREATURES } from '../kernel/creatures.js';
import { MOD_LIMITS, gasLimit, itemBudget, maxNodes, spellbookSize } from '../kernel/progression.js';
import type { Rulebook } from '../kernel/rulebook.js';
import { CURRICULUM } from '../lore/spells.js';
import { PRIMS, SPECIAL_DOCS, capsFor } from '../runes/primitives.js';

/** The spell-language manual, generated from the same tables the interpreter uses. */
export function grimoire(year: number, rb: Rulebook, seals = 0): string {
  const caps = capsFor(year, seals);
  const sig = (p: (typeof PRIMS)[number]) => `(${[p.name, ...p.args.map((a) => (a.optional ? `${a.name}?` : a.name)), ...(p.variadic ? ['...'] : [])].join(' ')})`;
  const section = (kind: 'pure' | 'query' | 'effect') =>
    PRIMS.filter((p) => p.kind === kind)
      .map((p) => {
        const locked = p.year > year ? `  [LOCKED: year ${p.year}]` : (p.seals ?? 0) > seals ? `  [SEALED: break seal ${p.seals} of the Restricted Section]` : '';
        const banned = rb.magic.bannedPrimitives.includes(p.name as never) ? '  [BANNED BY DECREE]' : '';
        const mult = kind === 'effect' && (rb.magic.costMultipliers as Record<string, number>)[p.name] !== 1 ? `  [cost x${(rb.magic.costMultipliers as Record<string, number>)[p.name]}]` : '';
        return `  ${sig(p).padEnd(34)} ${p.doc}${locked}${banned}${mult}`;
      })
      .join('\n');
  return `RUNES — the spell language of this Hogwarts (you are year ${year})

A spell is a small Lisp-like program. The world is its only input/output.
  ; comments start with a semicolon
  (let foes (enemies 20))
  (each f foes (when (< (hp f) 30) (bolt f 12 :ice)))

HOW A CAST WORKS (the rules that keep custom magic fair)
  1. Parse + static check when you forge: unknown names, arity, year-locked words,
     complexity <= ${maxNodes(year, rb)} AST nodes at your year.
  2. The program runs against a read-only view of the world with ${gasLimit(year, rb)} gas
     (1 per evaluation, +2 per query). Effects are PLANNED, not applied.
  3. Mana = ${rb.magic.castOverhead} (overhead) + sum of effect costs x Rulebook multipliers.
  4. All-or-nothing: if it errors, runs out of gas, plans more than ${caps.effectsPerCast} effects,
     or you cannot pay, the spell FIZZLES and costs nothing. Otherwise every effect happens.
  5. Numbers above your year's caps are clamped (you are told in "notes").
  6. Cooldown after a cast = 0.3s + mana/60 seconds. Delayed (after ...) blocks are separate
     transactions, pay no overhead, and fizzle alone.

BINDINGS
  self    you              target  the entity you aimed at (or nil)
  aim     the aimed point  object  (laws only) the other party, e.g. the victim

SPECIAL FORMS
${Object.entries(SPECIAL_DOCS).map(([k, v]) => `  ${k.padEnd(8)} ${v}`).join('\n')}

PURE WORDS
${section('pure')}

QUERIES (read the world)
${section('query')}

EFFECTS (cost mana)
${section('effect')}

YOUR CAPS AT YEAR ${year}${seals ? ` WITH ${seals} SEAL(S) BROKEN` : ''}
  bolt ${caps.boltPower} | heal ${caps.healAmount} | shield ${caps.shieldAmount}/${caps.shieldSecs}s | push ${caps.pushForce}m | haste x${caps.hasteMult.toFixed(1)}
  root ${caps.rootSecs.toFixed(1)}s | nova r${caps.novaRadius} p${caps.novaPower} | effects per cast ${caps.effectsPerCast}
  ranges: bolt/disarm/root ${caps.boltRange}m, heal/shield/haste ${caps.supportRange}m, push ${caps.pushRange}m
  original spells in your book: ${spellbookSize(year)}

ELEMENTS  ${ELEMENTS.map((e) => ':' + e).join(' ')}
CREATURES
${Object.values(CREATURES).map((c) => `  ${c.name.padEnd(16)} hp ${c.hp}, weak to ${Object.entries(c.weak).filter(([, v]) => (v ?? 1) > 1).map(([k, v]) => `${k} x${v}`).join(', ') || '—'}${c.allDamage ? `, takes x${c.allDamage} from non-Patronus magic` : ''}${c.nightOnly ? ', night only' : ''}. ${c.lore}`).join('\n')}

THE STANDARD CURRICULUM (same language — read them as examples)
${CURRICULUM.map((c) => `  y${c.year} ${c.name.padEnd(18)} ${c.source.replace(/\n/g, ' ')}`).join('\n')}

MORE EXAMPLES
  ; Finisher: only spend big when it will stun
  (let t (or target (first (enemies 30))))
  (when t (if (< (hp t) 25) (bolt t 25 :lightning) (bolt t 10)))

  ; Guardian: shield the most hurt ally, else yourself
  (let a (first (allies 20)))
  (if (and a (< (hp a) (hp self))) (shield a 40 5) (shield self 40 5))

  ; Year 2+: a delayed double-tap
  (let t target)
  (when t (bolt t 12) (after 0.6 (when (alive t) (bolt t 12 :fire))))

ITEMS (forge_item)
  Budget = 6 + 4*year enchantment points (yours: ${itemBudget(year)}). Price = 3 Galleons per point (min 5).
${Object.entries(MOD_LIMITS).map(([k, v]) => `  ${k.padEnd(10)} max ${v.max}, ${v.pts} pts per unit — ${v.doc}`).join('\n')}
  charm: optional Runes source (validated at the forger's year, +1 point per 4 nodes). The holder
  invokes it with use_item at 20% mana discount, using the HOLDER's caps.
`;
}
