import type { House } from '../shared/constants.js';
import type { Wand } from '../kernel/types.js';

const WOODS = ['Holly', 'Yew', 'Vine', 'Willow', 'Ash', 'Hawthorn', 'Cherry', 'Walnut', 'Hornbeam', 'Larch', 'Alder', 'Rowan', 'Cedar', 'Chestnut', 'Ebony', 'Elm', 'Fir', 'Hazel', 'Maple', 'Pear', 'Redwood', 'Sycamore', 'Blackthorn', 'Acacia'];
const CORES = ['Phoenix feather', 'Dragon heartstring', 'Unicorn hair'];
const FLEX = ['unyielding', 'rigid', 'slightly springy', 'supple', 'quite bendy', 'reasonably pliant', 'surprisingly swishy'];

export const CORE_BONUS: Record<string, { power?: number; care?: number; regen?: number; text: string }> = {
  'Phoenix feather': { regen: 1.5, text: '+1.5 mana/s. Phoenix-feather wands are the pickiest and the most independent.' },
  'Dragon heartstring': { power: 8, text: '+8% damage. Powerful, flamboyant, and quick to learn.' },
  'Unicorn hair': { care: 15, text: '+15% healing and shields. The most consistent magic, hardest to turn to the Dark Arts.' },
  'Thestral hair': { power: 25, text: 'The Elder Wand. Death\'s own. +25% damage.' },
};

/** Canon wands and houses. The Sorting Hat and Ollivander both remember. */
export const CANON: Record<string, { house: House; wand: Wand; line: string }> = {
  'harry potter': { house: 'Gryffindor', wand: { wood: 'Holly', core: 'Phoenix feather', length: 11, flexibility: 'nice and supple' }, line: 'Curious... very curious. The phoenix whose tail feather is in your wand gave another feather — just one other.' },
  'hermione granger': { house: 'Gryffindor', wand: { wood: 'Vine', core: 'Dragon heartstring', length: 10.75, flexibility: 'rigid' }, line: 'Vine wood — for those who seek a greater purpose.' },
  'ron weasley': { house: 'Gryffindor', wand: { wood: 'Willow', core: 'Unicorn hair', length: 14, flexibility: 'supple' }, line: 'Another Weasley! Your hand-me-downs are finally over.' },
  'draco malfoy': { house: 'Slytherin', wand: { wood: 'Hawthorn', core: 'Unicorn hair', length: 10, flexibility: 'reasonably springy' }, line: 'The Hat barely touched your head.' },
  'neville longbottom': { house: 'Gryffindor', wand: { wood: 'Cherry', core: 'Unicorn hair', length: 13, flexibility: 'slightly springy' }, line: 'The Hat argued for Hufflepuff. It lost.' },
  'luna lovegood': { house: 'Ravenclaw', wand: { wood: 'Hornbeam', core: 'Unicorn hair', length: 11.5, flexibility: 'slightly springy' }, line: 'Wit beyond measure. And Nargles, probably.' },
  'cedric diggory': { house: 'Hufflepuff', wand: { wood: 'Ash', core: 'Unicorn hair', length: 12.25, flexibility: 'pleasantly springy' }, line: 'A Hufflepuff through and through.' },
  'tom riddle': { house: 'Slytherin', wand: { wood: 'Yew', core: 'Phoenix feather', length: 13.5, flexibility: 'unyielding' }, line: 'Great things. Terrible, yes, but great.' },
  'severus snape': { house: 'Slytherin', wand: { wood: 'Ebony', core: 'Dragon heartstring', length: 13.5, flexibility: 'rigid' }, line: 'Always.' },
  'albus dumbledore': { house: 'Gryffindor', wand: { wood: 'Oak', core: 'Phoenix feather', length: 15, flexibility: 'unyielding', note: 'Not the wand he is famous for.' }, line: 'Nitwit! Blubber! Oddment! Tweak!' },
};

export function canonFor(name: string) {
  const n = name.trim().toLowerCase().replace(/\s+/g, ' ');
  if (CANON[n]) return CANON[n];
  const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '').split('').sort().join('');
  if (letters(name) === letters('Tom Marvolo Riddle') || letters(name) === letters('I am Lord Voldemort')) {
    return { ...CANON['tom riddle'], line: 'TOM MARVOLO RIDDLE... I AM LORD VOLDEMORT. The Hat does not argue.' };
  }
  return undefined;
}

export function ollivander(rand: () => number): Wand {
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  return {
    wood: pick(WOODS),
    core: pick(CORES),
    length: 9 + Math.round(rand() * 22) / 4,
    flexibility: pick(FLEX),
  };
}
