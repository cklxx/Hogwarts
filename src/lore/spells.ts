/** The standard curriculum. Written in Runes — exactly the same language agents use. */
export interface Curriculum { year: number; name: string; incantation: string; source: string; note: string }

export const CURRICULUM: Curriculum[] = [
  { year: 1, name: 'Stupefy', incantation: 'Stupefy!', note: 'Stunning Spell', source: '(bolt (or target aim) 14)' },
  { year: 1, name: 'Incendio', incantation: 'Incendio!', note: 'Fire. Spiders and Devil\'s Snare hate it.', source: '(bolt (or target aim) 12 :fire)' },
  { year: 1, name: 'Aguamenti', incantation: 'Aguamenti!', note: 'Water. It hurts nothing but soaks: then fire vaporizes, ice freezes, lightning conducts, a stunner makes it slip. Puts out fire.', source: '(aguamenti (or target aim))' },
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
  // ---- year 1 additions (10): basic tools ----
  { year: 1, name: 'Rictusempra', incantation: 'Rictusempra!', note: 'Tickling Charm: the victim doubles over with helpless laughter.', source: '(bolt (or target aim) 13)' },
  { year: 2, name: 'Flipendo', incantation: 'Flipendo!', note: 'Knockback Jinx: flings the target backwards.', source: '(let t (or target (first (enemies 12))))\n(when t (push t 6))' },
  { year: 1, name: 'Lumos Maxima', incantation: 'Lumos Maxima!', note: 'A far brighter wand-light that burns twice as long.', source: '(light 60)' },
  { year: 3, name: 'Immobulus', incantation: 'Immobulus!', note: 'Freezing Charm: holds the target perfectly still, briefly.', source: '(let t (or target (first (enemies 20))))\n(when t (root t 1.2))' },
  { year: 1, name: 'Everte Statum', incantation: 'Everte Statum!', note: 'A duellist opener: trips the foe, then stings.', source: '(bolt (or target aim) 12)' },
  { year: 1, name: 'Protego Totalum', incantation: 'Protego Totalum!', note: 'A fuller Shield Charm: the same strength, held longer.', source: '(shield self 25 6)' },
  { year: 2, name: 'Velocitas', incantation: 'Velocitas!', note: 'Quickening Charm: your feet fly for a few seconds.', source: '(haste self 1.3 5)' },
  { year: 4, name: 'Fulgur Minima', incantation: 'Fulgur Minima!', note: 'A small lightning arc that leaps between foes.', source: '(chain (or target (first (enemies 20))) 12)' },
  { year: 3, name: 'Crepitatio', incantation: 'Crepitatio!', note: 'A popping burst of sparks all around you.', source: '(nova 4 10 :fire)' },
  { year: 7, name: 'Nimbus Procella', incantation: 'Nimbus Procella!', note: 'Calls a small crackling storm down on a spot.', source: '(storm (or target aim) 4 12 :lightning)' },
  // ---- year 2 additions (13) ----
  { year: 2, name: 'Incendio Duo', incantation: 'Incendio Duo!', note: 'A stronger conjured flame.', source: '(bolt (or target aim) 20 :fire)' },
  { year: 2, name: 'Stupefy Duo', incantation: 'Stupefy Duo!', note: 'A harder stunning spell.', source: '(bolt (or target aim) 20)' },
  { year: 3, name: 'Bombarda Minima', incantation: 'Bombarda Minima!', note: 'A small, sharp explosion.', source: '(nova 4 14 :fire)' },
  { year: 4, name: 'Fulgur', incantation: 'Fulgur!', note: 'Lightning that arcs from foe to foe.', source: '(chain (or target (first (enemies 22))) 18)' },
  { year: 2, name: 'Depulso Maxima', incantation: 'Depulso Maxima!', note: 'Banishes the target clean across the room.', source: '(let t (or target (first (enemies 15))))\n(when t (push t 10))' },
  { year: 3, name: 'Immobulus Duo', incantation: 'Immobulus Duo!', note: 'A longer freezing charm.', source: '(let t (or target (first (enemies 22))))\n(when t (root t 1.5))' },
  { year: 2, name: 'Protego Duo', incantation: 'Protego Duo!', note: 'A sturdier shield for harder hits.', source: '(shield self 35 6)' },
  { year: 2, name: 'Sanare', incantation: 'Sanare!', note: 'Mends deeper cuts and worse bruises.', source: '(heal self 22)' },
  { year: 2, name: 'Irradio', incantation: 'Irradio!', note: 'A searing ray of pure light.', source: '(bolt (or target aim) 20 :light)' },
  { year: 2, name: 'Serpensortia Major', incantation: 'Serpensortia Major!', note: 'Conjures a larger, angrier serpent.', source: '(summon :serpent 25)' },
  { year: 2, name: 'Glacius Duo', incantation: 'Glacius Duo!', note: 'A deeper, biting frost.', source: '(bolt (or target aim) 20 :ice)' },
  { year: 7, name: 'Tempestas', incantation: 'Tempestas!', note: 'A fiercer crackling storm.', source: '(storm (or target aim) 5 18 :lightning)' },
  { year: 2, name: 'Everte Statum Duo', incantation: 'Everte Statum Duo!', note: 'A harder trip-and-blast for serious duels.', source: '(bolt (or target aim) 18)' },
  // ---- year 3 additions (14) ----
  { year: 3, name: 'Bombarda Maxima', incantation: 'Bombarda Maxima!', note: 'A proper explosion. Mind the walls.', source: '(nova 6 20 :fire)' },
  { year: 3, name: 'Incendio Maxima', incantation: 'Incendio Maxima!', note: 'A roaring jet of flame.', source: '(bolt (or target aim) 26 :fire)' },
  { year: 3, name: 'Glacius Maxima', incantation: 'Glacius Maxima!', note: 'Frost that bites to the bone.', source: '(bolt (or target aim) 26 :ice)' },
  { year: 4, name: 'Fulgur Maxima', incantation: 'Fulgur Maxima!', note: 'A great arc of lightning.', source: '(chain (or target (first (enemies 25))) 24)' },
  { year: 3, name: 'Stupefy Maxima', incantation: 'Stupefy Maxima!', note: 'A stunning spell few can shrug off.', source: '(bolt (or target aim) 26)' },
  { year: 3, name: 'Immobulus Maxima', incantation: 'Immobulus Maxima!', note: 'Holds the target fast and long.', source: '(let t (or target (first (enemies 25))))\n(when t (root t 1.9))' },
  { year: 3, name: 'Protego Maxima', incantation: 'Protego Maxima!', note: 'A shield wall of solid air.', source: '(shield self 45 7)' },
  { year: 3, name: 'Depulso Horribilis', incantation: 'Depulso Horribilis!', note: 'Hurls the target like a rag doll.', source: '(let t (or target (first (enemies 18))))\n(when t (push t 14))' },
  { year: 3, name: 'Tonitrus', incantation: 'Tonitrus!', note: 'A thunderclap made solid.', source: '(nova 6 18 :lightning)' },
  { year: 3, name: 'Irradio Maxima', incantation: 'Irradio Maxima!', note: 'A blinding shaft of sunlight.', source: '(bolt (or target aim) 26 :light)' },
  { year: 3, name: 'Reducto Minima', incantation: 'Reducto Minima!', note: 'A lesser reductor: still blasts things apart.', source: '(bolt (or target aim) 26 :lightning)' },
  { year: 3, name: 'Avis Maxima', incantation: 'Avis Maxima! Oppugno!', note: 'A greater flock, twice as fierce.', source: '(summon :birds 25)' },
  { year: 3, name: 'Serpensortia Maxima', incantation: 'Serpensortia Maxima!', note: 'A great serpent that fears nothing.', source: '(summon :serpent 28)' },
  { year: 3, name: 'Medicus', incantation: 'Medicus!', note: 'Battlefield medicine in a single word.', source: '(heal self 28)' },
  // ---- year 4 additions (18) ----
  { year: 4, name: 'Incendio Horribilis', incantation: 'Incendio Horribilis!', note: 'A white-hot lance of flame.', source: '(bolt (or target aim) 32 :fire)' },
  { year: 4, name: 'Glacius Horribilis', incantation: 'Glacius Horribilis!', note: 'Cold that freezes blood mid-beat.', source: '(bolt (or target aim) 32 :ice)' },
  { year: 4, name: 'Stupefy Horribilis', incantation: 'Stupefy Horribilis!', note: 'A stunner that drops trolls.', source: '(bolt (or target aim) 32)' },
  { year: 4, name: 'Bombarda Horribilis', incantation: 'Bombarda Horribilis!', note: 'An explosion that shakes the castle.', source: '(nova 7 24 :fire)' },
  { year: 4, name: 'Tonitrus Major', incantation: 'Tonitrus Major!', note: 'Thunder you can stand inside.', source: '(nova 7 22 :lightning)' },
  { year: 4, name: 'Fulgur Horribilis', incantation: 'Fulgur Horribilis!', note: 'Lightning that refuses to stop.', source: '(chain (or target (first (enemies 28))) 30)' },
  { year: 7, name: 'Tempestas Major', incantation: 'Tempestas Major!', note: 'A storm that answers only to you.', source: '(storm (or target aim) 7 30 :lightning)' },
  { year: 4, name: 'Irradio Horribilis', incantation: 'Irradio Horribilis!', note: 'Sunlight focused to a killing point.', source: '(bolt (or target aim) 32 :light)' },
  { year: 4, name: 'Reducto Duo', incantation: 'Reducto Duo!', note: 'A near-full reductor.', source: '(bolt (or target aim) 32 :lightning)' },
  { year: 4, name: 'Incarcerous Maxima', incantation: 'Incarcerous Maxima!', note: 'Iron ropes. No struggling free.', source: '(let t (or target (first (enemies 28))))\n(when t (root t 2.2))' },
  { year: 4, name: 'Flipendo Horribilis', incantation: 'Flipendo Horribilis!', note: 'A knockback jinx with siege-engine force.', source: '(let t (or target (first (enemies 18))))\n(when t (push t 16))' },
  { year: 4, name: 'Protego Horribilis', incantation: 'Protego Horribilis!', note: 'A dome that turns aside curses.', source: '(shield self 55 7)' },
  { year: 4, name: 'Sanare Maxima', incantation: 'Sanare Maxima!', note: 'Closes wounds as fast as they open.', source: '(heal self 34)' },
  { year: 4, name: 'Ferula Maxima', incantation: 'Ferula Maxima!', note: 'Bandages that knit flesh while you fight.', source: '(regen (or (first (allies 8)) self) 6 8)' },
  { year: 4, name: 'Avis Horribilis', incantation: 'Avis Horribilis! Oppugno!', note: 'A storm of beaks and talons.', source: '(summon :birds 28)' },
  { year: 4, name: 'Serpensortia Horribilis', incantation: 'Serpensortia Horribilis!', note: 'A serpent the size of a carriage.', source: '(summon :serpent 30)' },
  { year: 4, name: 'Velocitas Maxima', incantation: 'Velocitas Maxima!', note: 'You move like a blur.', source: '(haste self 1.6 6)' },
  { year: 4, name: 'Expelliarmus Maxima', incantation: 'Expelliarmus Maxima!', note: 'Strips the wand from across the hall.', source: '(let t (or target (first (enemies 30))))\n(when t (disarm t))' },
  // ---- year 5 additions (9) ----
  { year: 5, name: 'Reducto Maxima', incantation: 'Reducto Maxima!', note: 'The full reductor: nothing solid survives.', source: '(bolt (or target aim) 40 :lightning)' },
  { year: 5, name: 'Confringo Duo', incantation: 'Confringo Duo!', note: 'A blasting curse, barely contained.', source: '(nova 8 28 :fire)' },
  { year: 5, name: 'Tonitrus Horribilis', incantation: 'Tonitrus Horribilis!', note: 'The sky itself objects.', source: '(nova 8 26 :lightning)' },
  { year: 5, name: 'Fulmen', incantation: 'Fulmen!', note: 'A lightning bolt with a grudge.', source: '(chain (or target (first (enemies 30))) 35)' },
  { year: 7, name: 'Tempestas Horribilis', incantation: 'Tempestas Horribilis!', note: 'A thunderstorm on demand.', source: '(storm (or target aim) 8 36 :lightning)' },
  { year: 5, name: 'Glacius Suprema', incantation: 'Glacius Suprema!', note: 'Absolute zero, weaponised.', source: '(bolt (or target aim) 38 :ice)' },
  { year: 5, name: 'Aegis', incantation: 'Aegis!', note: 'An aegis of solid air. Nothing passes.', source: '(shield self 65 7)' },
  { year: 5, name: 'Stupefy Ultima', incantation: 'Stupefy Ultima!', note: 'An almost irresistible stunning spell.', source: '(bolt (or target aim) 38)' },
  { year: 5, name: 'Incendio Ultima', incantation: 'Incendio Ultima!', note: 'Fiendfyre’s lesser cousin.', source: '(bolt (or target aim) 38 :fire)' },
  // ---- year 6 additions (4) ----
  { year: 6, name: 'Fiendfyre', incantation: 'Fiendfyre!', note: 'Cursed fire that hungers. Cast it only if you can master it.', source: '(nova 9 32 :fire)' },
  { year: 6, name: 'Glacius Ultima', incantation: 'Glacius Ultima!', note: 'The cold between the stars.', source: '(bolt (or target aim) 44 :ice)' },
  { year: 7, name: 'Tempestas Ultima', incantation: 'Tempestas Ultima!', note: 'Weather as a weapon.', source: '(storm (or target aim) 9 42 :lightning)' },
  { year: 6, name: 'Aegis Maxima', incantation: 'Aegis Maxima!', note: 'A fortress no curse can breach.', source: '(shield self 75 8)' },
  // ---- year 7 additions (3) ----
  { year: 7, name: 'Confringo Maxima', incantation: 'Confringo Maxima!', note: 'The Blasting Curse at full power. Cities fear it.', source: '(nova 10 36 :fire)' },
  { year: 7, name: 'Fulmen Ultima', incantation: 'Fulmen Ultima!', note: 'Lightning that hunts its victims.', source: '(chain (or target (first (enemies 32))) 45)' },
  { year: 7, name: 'Tempestas Maxima', incantation: 'Tempestas Maxima!', note: 'A true thunderstorm, called by name.', source: '(storm (or target aim) 10 46 :lightning)' },
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
