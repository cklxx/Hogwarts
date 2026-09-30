import type { CreatureKind } from '../shared/constants.js';
import type { CreatureDef } from './types.js';

/**
 * Every creature, wild or conjured. `faction` decides who it fights:
 *   hostile  — attacks wizards and their summons
 *   benign   — never attacks; unicorns heal those near them (harming one curses you), the phoenix weeps
 *   summon   — fights for its owner, against exactly what its owner may harm
 */
export const CREATURES: Record<CreatureKind, CreatureDef> = {
  pixie: {
    kind: 'pixie', name: 'Cornish Pixie', faction: 'hostile', hp: 24, speed: 5.5, damage: 4, range: 1.6, cooldown: 1.0, aggro: 7, radius: 0.35,
    xp: 12, rep: 1, galleons: 1, weak: { ice: 2 }, spawn: { x: 12, z: 10, r: 18, max: 6 }, // the lawn just south of the courtyard: a first-year's first target is ~20 m away (it was ~60), and not a swarm
    lore: 'Electric blue, eight inches high, and mischievous. Lockhart released a cage of them once. Freezing charms work.',
  },
  snare: {
    kind: 'snare', name: "Devil's Snare", faction: 'hostile', hp: 60, speed: 0, damage: 5, range: 3.5, cooldown: 1.2, aggro: 3.5, radius: 1.2,
    xp: 10, rep: 1, galleons: 1, weak: { fire: 2, light: 3 }, spawn: { x: 41, z: -24, r: 12, max: 4 },
    ranged: { range: 48, power: 7, cooldown: 2.2, element: 'arcane', kind: 'bolt', provoked: true },
    lore: 'Roots anything that lingers, and flings thorns at whoever burns it from afar. Fire or sunlight.',
  },
  spider: {
    kind: 'spider', name: 'Acromantula', faction: 'hostile', hp: 80, speed: 5, damage: 8, range: 2, cooldown: 1.3, aggro: 16, radius: 0.9,
    xp: 40, rep: 4, galleons: 4, weak: { fire: 1.8 }, spawn: { x: 185, z: 18, r: 48, max: 10 }, bite: { aura: 'poison', secs: 4, mag: 3 },
    ranged: { range: 16, power: 0, cooldown: 6, element: 'arcane', kind: 'root', secs: 1.2 },
    lore: "Aragog's descendants. Their bite is venomous. Hagrid would like you to know they are misunderstood.",
  },
  troll: {
    kind: 'troll', name: 'Mountain Troll', faction: 'hostile', hp: 260, speed: 3, damage: 28, range: 3, cooldown: 2.6, aggro: 14, radius: 1.4,
    xp: 140, rep: 14, galleons: 18, weak: { arcane: 0.6 }, spawn: { x: -50, z: -36, r: 9, max: 2 },
    ranged: { range: 32, power: 16, cooldown: 4.5, element: 'arcane', kind: 'bolt', provoked: true },
    lore: 'Twelve feet of granite-grey stupidity; hurt one and it throws rocks. Leviosa their clubs.',
  },
  dementor: {
    kind: 'dementor', name: 'Dementor', faction: 'hostile', hp: 150, speed: 4, damage: 6, range: 6, cooldown: 1, aggro: 25, radius: 0.8,
    xp: 90, rep: 10, galleons: 0, weak: {}, allDamage: 0.25, nightOnly: true, flying: true, spawn: { x: -110, z: 40, r: 72, max: 5 },
    lore: 'They drain the happiness out of the air. Expecto Patronum.',
  },
  inferius: {
    kind: 'inferius', name: 'Inferius', faction: 'hostile', hp: 90, speed: 2.8, damage: 9, range: 1.8, cooldown: 1.4, aggro: 12, radius: 0.6,
    xp: 55, rep: 6, galleons: 3, weak: { fire: 3, light: 1.5 }, nightOnly: true, spawn: { x: -110, z: 40, r: 64, max: 4 }, bite: { aura: 'chill', secs: 2, mag: 0.4 },
    lore: 'A corpse bewitched to do a Dark wizard\'s bidding. Their hands are cold as the lake. They fear fire and light.',
  },
  unicorn: {
    kind: 'unicorn', name: 'Unicorn', faction: 'benign', hp: 120, speed: 6, damage: 0, range: 0, cooldown: 99, aggro: 5, radius: 0.9,
    xp: 0, rep: -50, galleons: 0, weak: {}, spawn: { x: 175, z: 5, r: 55, max: 2 }, grace: { radius: 8, mag: 2 },
    lore: 'Pure and swift. To stand near one is to heal; to harm one is to live a cursed life from that moment.',
  },
  phoenix: {
    kind: 'phoenix', name: 'Fawkes', faction: 'benign', hp: 999, speed: 7, damage: 0, range: 0, cooldown: 99, aggro: 12, radius: 0.5,
    xp: 0, rep: 0, galleons: 0, weak: {}, invulnerable: true, flying: true, dayOnly: true, rare: 0.04, lifetime: 90, spawn: { x: -20, z: -10, r: 40, max: 1 },
    lore: 'Phoenix tears have healing powers. Fawkes comes to those who show loyalty — and to those badly hurt.',
  },
  // ---- conjured (summon primitive)
  serpent: {
    kind: 'serpent', name: 'Conjured Serpent', faction: 'summon', hp: 45, speed: 6, damage: 7, range: 1.8, cooldown: 1.1, aggro: 10, radius: 0.5,
    xp: 0, rep: 0, galleons: 0, weak: { fire: 1.5 }, spawn: { x: 0, z: 0, r: 0, max: 0 },
    lore: 'Serpensortia! As Draco conjured in the Duelling Club.',
  },
  birds: {
    kind: 'birds', name: 'Conjured Birds', faction: 'summon', hp: 25, speed: 9, damage: 4, range: 2, cooldown: 0.6, aggro: 12, radius: 0.5,
    xp: 0, rep: 0, galleons: 0, weak: { lightning: 1.5 }, flying: true, spawn: { x: 0, z: 0, r: 0, max: 0 },
    lore: 'Avis — and then Oppugno! Ask Ron how it feels.',
  },
};
