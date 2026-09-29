/** The standard curriculum. Written in Runes — exactly the same language agents use. */
export interface Curriculum { year: number; name: string; incantation: string; source: string; note: string }

export const CURRICULUM: Curriculum[] = [
  { year: 1, name: 'Stupefy', incantation: 'Stupefy!', note: 'Stunning Spell', source: '(bolt (or target aim) 14)' },
  { year: 1, name: 'Incendio', incantation: 'Incendio!', note: 'Fire. Spiders and Devil\'s Snare hate it.', source: '(bolt (or target aim) 12 :fire)' },
  { year: 1, name: 'Protego', incantation: 'Protego!', note: 'Shield Charm', source: '(shield self 25 4)' },
  { year: 1, name: 'Episkey', incantation: 'Episkey!', note: 'Heals minor injuries', source: '(heal self 16)' },
  { year: 1, name: 'Lumos', incantation: 'Lumos!', note: 'Wand-lighting Charm', source: '(light 30)' },
  { year: 1, name: 'Tempus', incantation: 'Tempus!', note: 'Shows the time. Cast once to unlock the clock in the top-right corner.', source: '(reveal :tempus)' },
  { year: 1, name: 'Revelio', incantation: 'Revelio!', note: 'Reveals your own measure (top-left corner).', source: '(reveal :revelio)' },
  { year: 2, name: 'Ferula', incantation: 'Ferula!', note: 'Conjures bandages: steady healing over time.', source: '(regen (or (first (allies 8)) self) 4 6)' },
  { year: 2, name: 'Finite Incantatem', incantation: 'Finite Incantatem!', note: 'Ends the spells on you: roots, disarms, venom, fire, frost, curses.', source: '(cleanse self)' },
  { year: 2, name: 'Serpensortia', incantation: 'Serpensortia!', note: 'Conjures a serpent that fights for you.', source: '(summon :serpent 20)' },
  { year: 3, name: 'Rennervate', incantation: 'Rennervate!', note: 'Revives a stunned wizard where they fell.', source: '(let t (or target (first (fallen 6))))\n(when t (revive t))' },
  { year: 3, name: 'Avis', incantation: 'Avis! Oppugno!', note: 'Conjures a flock of birds, then sends them at your foes.', source: '(summon :birds 20)' },
  { year: 4, name: 'Vulnera Sanentur', incantation: 'Vulnera Sanentur!', note: 'A healing song: mends your house around you.', source: '(mend 6 30)' },
  { year: 2, name: 'Point Me', incantation: 'Point Me!', note: 'The Four-Point Spell. Unlocks the radar (bottom-left corner).', source: '(reveal :point-me)' },
  { year: 3, name: 'Homenum Revelio', incantation: 'Homenum Revelio!', note: 'Reveals who is near (bottom-right corner).', source: '(reveal :homenum)' },
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
  // Transfiguration of self (变形术): the only way a wizard's look ever changes is a spell like these
  { year: 1, name: 'Vestimentum', incantation: 'Vestimentum!', note: 'Transfigures your robes: velvet in your house colour with gold trim. Rewrite it to wear anything (see glamour in the grimoire).', source: '(glamour :robe (house self) :trim :gold :material :velvet)' },
  { year: 1, name: 'Reparifarge', incantation: 'Reparifarge!', note: 'Untransfiguration: your robes, hat and wand-light return to your house look.', source: '(glamour :reset)' },
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
