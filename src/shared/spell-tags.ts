/** Tags interpreted as engine provenance, emitted by primitives/reactions rather than spell display text. */
export const ENGINE_SPELL_TAGS = ['water', 'conduct', 'overload', 'rune', 'reflected', 'whizbang', 'sectumsempra'] as const;

/** Prefix every user label, including labels already starting with the prefix: this mapping is injective. */
export const userSpellTag = (text: string): string => `user:${text}`;

/** Two data fields stay two tags. User separators can never manufacture a third engine tag. */
export const displaySpellTags = (name: string, incantation: string): string[] => [userSpellTag(incantation), userSpellTag(name)];
