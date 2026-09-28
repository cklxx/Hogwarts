/** The standard curriculum. Written in Runes — exactly the same language agents use. */
export interface Curriculum { year: number; name: string; incantation: string; source: string; note: string }

export const CURRICULUM: Curriculum[] = [
  { year: 1, name: 'Stupefy', incantation: 'Stupefy!', note: 'Stunning Spell', source: '(bolt (or target aim) 14)' },
  { year: 1, name: 'Incendio', incantation: 'Incendio!', note: 'Fire. Spiders and Devil\'s Snare hate it.', source: '(bolt (or target aim) 12 :fire)' },
  { year: 1, name: 'Protego', incantation: 'Protego!', note: 'Shield Charm', source: '(shield self 25 4)' },
  { year: 1, name: 'Episkey', incantation: 'Episkey!', note: 'Heals minor injuries', source: '(heal self 16)' },
  { year: 1, name: 'Lumos', incantation: 'Lumos!', note: 'Wand-lighting Charm', source: '(light 30)' },
  { year: 2, name: 'Expelliarmus', incantation: 'Expelliarmus!', note: 'Disarming Charm. It has a history with the Elder Wand.', source: '(let t (or target (first (enemies 25))))\n(when t (disarm t))' },
  { year: 2, name: 'Glacius', incantation: 'Glacius!', note: 'Freezing charm. Pixies are weak to ice.', source: '(bolt (or target aim) 18 :ice)' },
  { year: 2, name: 'Depulso', incantation: 'Depulso!', note: 'Banishing Charm', source: '(let t (or target (first (enemies 15))))\n(when t (push t 8))' },
  { year: 3, name: 'Expecto Patronum', incantation: 'Expecto Patronum!', note: 'The only defence against Dementors.', source: '(patronus 8)' },
  { year: 3, name: 'Petrificus Totalus', incantation: 'Petrificus Totalus!', note: 'Full Body-Bind Curse', source: '(let t (or target (first (enemies 25))))\n(when t (root t 1.8))' },
  { year: 3, name: 'Bombarda', incantation: 'Bombarda!', note: 'Exploding Charm', source: '(nova 5 16 :fire)' },
  { year: 4, name: 'Lumos Solem', incantation: 'Lumos Solem!', note: 'Sunlight. Devil\'s Snare cannot stand it.', source: '(bolt (or target aim) 30 :light)' },
  { year: 5, name: 'Reducto', incantation: 'Reducto!', note: 'Reductor Curse', source: '(bolt (or target aim) 36 :lightning)' },
  { year: 6, name: 'Apparition', incantation: '*crack*', note: 'Destination, Determination, Deliberation. Not on the grounds.', source: '(apparate (ahead 25))' },
  { year: 7, name: 'Confringo', incantation: 'Confringo!', note: 'Blasting Curse', source: '(nova 8 34 :fire)' },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

export type Unforgivable = 'Avada Kedavra' | 'Crucio' | 'Imperio';
export function unforgivable(...texts: string[]): Unforgivable | null {
  const t = texts.map(norm).join('|');
  if (t.includes('avadakedavra')) return 'Avada Kedavra';
  if (t.includes('crucio')) return 'Crucio';
  if (t.includes('imperio')) return 'Imperio';
  return null;
}

export const isLeviosa = (s: string) => norm(s).includes('wingardiumleviosa') && !norm(s).includes('leviosar');
export const isLeviosar = (s: string) => norm(s).includes('leviosar');
