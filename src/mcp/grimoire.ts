import { WARD_CD_S, WARD_MANA, WARD_MAX_S, ELEMENTS, HP_FLOOR, HP_FLOOR_FRAC, MANAREGEN_FLOOR_FRAC, MANA_FLOOR, MANA_FLOOR_FRAC, POWER_FLOOR, SPEED_FLOOR, WARD_MAX, WARD_MIN } from '../shared/constants.js';
import { CREATURES } from '../kernel/creatures.js';
import { MOD_LIMITS, gasLimit, itemBudget, maxNodes, spellbookSize } from '../kernel/progression.js';
import type { Rulebook } from '../kernel/rulebook.js';
import { CURRICULUM } from '../lore/spells.js';
import { PRIMS, SPECIAL_DOCS, capsFor } from '../runes/primitives.js';
import { GLAMOUR_MATERIALS, GLAMOUR_PARTS, GLAMOUR_PRANK_MAX_S, GLAMOUR_PRANK_YEAR, MATERIAL_DEFS, NAMED_COLOURS, PART_DOCS } from '../shared/glamour.js';

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
     transactions: each pays its own overhead when it fires, and fizzles alone. simulate_spell
     plans them too, as lines "t+1.5s: ..." checked against the mana you will have left.

IN FLIGHT
  A spell with a target (bolt / disarm / root at \`target\`, a chain's leaps) strikes that target or a foe
  in its path, and flies through a housemate who stands in the way. A bolt aimed at a point (\`aim\`) and
  the area spells (nova, storm) hit whatever they may harm — housemates too while friendly fire is on.
  A Protego raised <= 0.35 s before a bolt lands sends it back. Too slow over MCP? The \`ward\` tool arms
  it for up to ${WARD_MAX_S}s: the first hostile bolt or disarm meets a Protego raised that instant
  (${WARD_MANA} mana when armed, one every ${WARD_CD_S}s, no other spell while it is up).

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

TRANSFIGURATION OF SELF (glamour) — the ONLY way your look changes is a spell you (or your agent) write
  parts    ${GLAMOUR_PARTS.map((p) => `:${p} ${PART_DOCS[p].doc}`).join(' | ')}
  colours  "#7a1f2b" or "#b5f" (strings), (list 122 31 43) (0..255, clamped), or a name:
           ${Object.keys(NAMED_COLOURS).map((c) => ':' + c).join(' ')}
           nil puts one part back to your house default; :reset puts everything back first.
  materials
${GLAMOUR_MATERIALS.map((m) => { const d = MATERIAL_DEFS[m]; const lock = d.year > year ? `  [LOCKED: year ${d.year}]` : d.seals > seals ? `  [SEALED: seal ${d.seals}]` : ''; return `    :${m.padEnd(10)} y${d.year}${d.seals ? ` + seal ${d.seals}` : ''}, +${d.cost} mana — ${d.doc}${lock}`; }).join('\n')}
  Your own look lasts until you change it. From year ${GLAMOUR_PRANK_YEAR}, :on <wizard> :secs n (<=${GLAMOUR_PRANK_MAX_S}) lays a
  Colour-Change jinx on someone you may duel (PvP rules, outside safe zones); Finite Incantatem ends it.
  The Cloak of Invisibility is a Deathly Hallow: no spell forges it.

  ; Vestimentum, your way: burgundy velvet, gold trim, a charcoal hat
  (glamour :robe "#7a1f2b" :trim :gold :hat "#222" :material :velvet)
  ; year 5: the Great Hall's night sky, with a pale blue wand-light
  (glamour :robe :midnight :trim :silver :glow "#9fd8ff" :material :starlight)
  ; year 2 prank: a duelling rival goes pink for 30s
  (when target (glamour :on target :robe :pink :hat :pink :secs 30))
  ; Reparifarge: back to your house look
  (glamour :reset)
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
  Attribute floors (属性的下限): whatever you wear, max health stays >= max(${HP_FLOOR}, ${HP_FLOOR_FRAC * 100}% of your year's base),
  max mana >= max(${MANA_FLOOR}, ${MANA_FLOOR_FRAC * 100}%), mana regen >= ${MANAREGEN_FLOOR_FRAC * 100}% of the rule, speed >= ${SPEED_FLOOR * 100}%, power >= ${POWER_FLOOR * 100}%,
  ward within ${WARD_MIN * 100}%..+${WARD_MAX * 100}%.
`;
}
