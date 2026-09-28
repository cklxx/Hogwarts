/**
 * What a spell is *for*, read off the effect primitives it uses (Spell.effects).
 * The browser uses it to pick a sensible target when a spell key is pressed with nothing selected:
 *   harm — aims at a foe (bolt, disarm, root, push, chain, storm, nova)
 *   help — aims at a friend or yourself (heal, regen, shield, cleanse, revive, haste, mend)
 *   self — needs no target at all (light, reveal, summon, patronus, apparate, say)
 * A spell that both harms and helps counts as harm: its target is the foe, its help usually lands on `self`.
 */
export type SpellKind = 'harm' | 'help' | 'self';

export const HARM_EFFECTS: readonly string[] = ['bolt', 'disarm', 'root', 'push', 'chain', 'storm', 'nova'];
export const HELP_EFFECTS: readonly string[] = ['heal', 'regen', 'shield', 'cleanse', 'revive', 'haste', 'mend'];

export function spellKind(effects: readonly string[]): SpellKind {
  if (effects.some((e) => HARM_EFFECTS.includes(e))) return 'harm';
  if (effects.some((e) => HELP_EFFECTS.includes(e))) return 'help';
  return 'self';
}
