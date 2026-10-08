/**
 * The ink set (client/index.html #ink, one hand-drawn symbol per id): which icon stands for a spell, an item,
 * a house or a line of news. Pure strings, no DOM, so test/ink.test.ts can walk every mapping.
 */

/** An inline icon from the sprite. */
export const ic = (id: string, cls = '') => `<svg class="ic${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#i-${id}"/></svg>`;

/** The curriculum (src/lore/spells.ts), each with its own drawing. */
const BUILTIN: Record<string, string> = {
  Stupefy: 'stupefy', Incendio: 'incendio', Aguamenti: 'water', Protego: 'protego', Episkey: 'episkey', Lumos: 'lumos', Tempus: 'tempus', Revelio: 'revelio',
  Ferula: 'ferula', 'Finite Incantatem': 'finite', Serpensortia: 'snake', Rennervate: 'revive', Avis: 'bird', 'Vulnera Sanentur': 'heart',
  'Point Me': 'compass', 'Homenum Revelio': 'figures', Expelliarmus: 'expelliarmus', Glacius: 'ice', Depulso: 'depulso',
  'Expecto Patronum': 'patronus', 'Petrificus Totalus': 'chain', Bombarda: 'burst', 'Lumos Solem': 'light', Reducto: 'lightning',
  Apparition: 'swirl', Confringo: 'burst', Vestimentum: 'robe', Reparifarge: 'robe',
  // year 1 additions
  Rictusempra: 'stupefy', Flipendo: 'depulso', 'Lumos Maxima': 'lumos', Immobulus: 'chain', 'Everte Statum': 'stupefy',
  'Protego Totalum': 'protego', Velocitas: 'swirl', 'Fulgur Minima': 'lightning', Crepitatio: 'burst', 'Nimbus Procella': 'lightning',
  // year 2 additions
  'Incendio Duo': 'incendio', 'Stupefy Duo': 'stupefy', 'Bombarda Minima': 'burst', Fulgur: 'lightning', 'Depulso Maxima': 'depulso',
  'Immobulus Duo': 'chain', 'Protego Duo': 'protego', Sanare: 'episkey', Irradio: 'light', 'Serpensortia Major': 'snake',
  'Glacius Duo': 'ice', Tempestas: 'lightning', 'Everte Statum Duo': 'stupefy',
  // year 3 additions
  'Bombarda Maxima': 'burst', 'Incendio Maxima': 'incendio', 'Glacius Maxima': 'ice', 'Fulgur Maxima': 'lightning',
  'Stupefy Maxima': 'stupefy', 'Immobulus Maxima': 'chain', 'Protego Maxima': 'protego', 'Depulso Horribilis': 'depulso',
  Tonitrus: 'burst', 'Irradio Maxima': 'light', 'Reducto Minima': 'lightning', 'Avis Maxima': 'bird',
  'Serpensortia Maxima': 'snake', Medicus: 'episkey',
  // year 4 additions
  'Incendio Horribilis': 'incendio', 'Glacius Horribilis': 'ice', 'Stupefy Horribilis': 'stupefy', 'Bombarda Horribilis': 'burst',
  'Tonitrus Major': 'burst', 'Fulgur Horribilis': 'lightning', 'Tempestas Major': 'lightning', 'Irradio Horribilis': 'light',
  'Reducto Duo': 'lightning', 'Incarcerous Maxima': 'chain', 'Flipendo Horribilis': 'depulso', 'Protego Horribilis': 'protego',
  'Sanare Maxima': 'episkey', 'Ferula Maxima': 'ferula', 'Avis Horribilis': 'bird', 'Serpensortia Horribilis': 'snake',
  'Velocitas Maxima': 'swirl', 'Expelliarmus Maxima': 'expelliarmus',
  // year 5 additions
  'Reducto Maxima': 'lightning', 'Confringo Duo': 'burst', 'Tonitrus Horribilis': 'burst', Fulmen: 'lightning',
  'Tempestas Horribilis': 'lightning', 'Glacius Suprema': 'ice', 'Aegis': 'protego', 'Stupefy Ultima': 'stupefy', 'Incendio Ultima': 'incendio',
  // year 6 additions
  Fiendfyre: 'burst', 'Glacius Ultima': 'ice', 'Tempestas Ultima': 'lightning', 'Aegis Maxima': 'protego',
  // year 7 additions
  'Confringo Maxima': 'burst', 'Fulmen Ultima': 'lightning', 'Tempestas Maxima': 'lightning',
};
export const ELEMENT_ICON: Record<string, string> = { arcane: 'arcane', fire: 'fire', ice: 'ice', lightning: 'lightning', light: 'light' };
/** What a written spell does, most telling first: the first effect in this list names its icon. */
const EFFECT_ICON: [string, string][] = [
  ['disarm', 'expelliarmus'], ['revive', 'revive'], ['patronus', 'patronus'], ['cleanse', 'finite'], ['summon', 'snake'], ['glamour', 'robe'],
  ['apparate', 'swirl'], ['storm', 'lightning'], ['chain', 'lightning'], ['nova', 'burst'], ['bolt', 'bolt'], ['root', 'chain'], ['push', 'depulso'],
  ['shield', 'protego'], ['heal', 'episkey'], ['regen', 'ferula'], ['mend', 'heart'], ['haste', 'swirl'], ['reveal', 'eye'], ['light', 'lumos'],
];
/** The element a Runes source names (`:fire` …), if any. */
export function elementOf(source: string | undefined): string | null {
  const m = /:(fire|ice|lightning|light|arcane)\b/.exec(source ?? '');
  return m ? m[1] : null;
}
/**
 * The icon of a spell: the curriculum by name; a written spell by what it does (a bolt by its element, a summon by
 * its creature); a spell whose effects are not known yet gets a wand, one with no effect at all a scroll.
 */
export function spellIcon(name: string, effects?: readonly string[] | null, source?: string): string {
  const b = BUILTIN[name];
  if (b) return b;
  if (!effects) return 'wand';
  if (!effects.length) return 'scroll';
  for (const [e, icon] of EFFECT_ICON) {
    if (!effects.includes(e)) continue;
    if (icon === 'bolt' || icon === 'burst') { const el = elementOf(source); return el && el !== 'arcane' ? ELEMENT_ICON[el] : icon === 'bolt' ? 'stupefy' : 'burst'; }
    if (icon === 'snake' && /:birds\b/.test(source ?? '')) return 'bird';
    return icon;
  }
  return 'wand';
}

export const ITEM_ICON: Record<string, string> = { wand: 'wand', robe: 'robe', amulet: 'amulet', trinket: 'ring', broom: 'broom' };
export const itemIcon = (slot: string) => ITEM_ICON[slot] ?? 'trunk';

export const HOUSE_ICON: Record<string, string> = { Gryffindor: 'gryffindor', Hufflepuff: 'hufflepuff', Ravenclaw: 'ravenclaw', Slytherin: 'slytherin' };
export const houseIcon = (house: string) => HOUSE_ICON[house] ?? 'seal';

/** A line of news in the feed, by its event type (World.emit). */
const FEED_ICON: Record<string, string> = {
  chat: 'quill', combat: 'stupefy', creature: 'target', curse: 'finite', da: 'patronus', dark: 'darkmark', decree: 'seal', egg: 'star',
  elder: 'wand', forge: 'scroll', level: 'star', system: 'owl', term: 'hourglass', achievement: 'cup', azkaban: 'chain', owl: 'letter', market: 'coin',
};
export const feedIcon = (type: string) => FEED_ICON[type] ?? 'quill';

/** Latin names get the italic Latin face; anything with CJK in it stays upright (Chinese never slants). */
export const isLatin = (s: string) => !/[⺀-鿿豈-﫿＀-￯]/.test(s);
