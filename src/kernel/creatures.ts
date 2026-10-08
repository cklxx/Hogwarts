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
    also: [{ x: 14, z: 139, r: 3.5, max: 5, leash: 3.8 }], // loose from Zonko's, kept in its yard: every spot there is within a spark of a whizbang (src/shared/encounters.ts)
    lore: 'Electric blue, eight inches high, and mischievous. Lockhart released a cage of them once. Freezing charms work.',
  },
  snare: {
    kind: 'snare', name: "Devil's Snare", faction: 'hostile', hp: 60, speed: 0, damage: 5, range: 3.5, cooldown: 1.2, aggro: 3.5, radius: 1.2,
    xp: 10, rep: 1, galleons: 1, weak: { fire: 2, light: 3 }, spawn: { x: 41, z: -26, r: 8, max: 4 },
    ranged: { range: 48, power: 7, cooldown: 2.2, element: 'arcane', kind: 'bolt', provoked: true },
    lore: 'Roots anything that lingers, and flings thorns at whoever burns it from afar. Fire or sunlight.',
  },
  spider: {
    kind: 'spider', name: 'Acromantula', faction: 'hostile', hp: 80, speed: 5, damage: 8, range: 2, cooldown: 1.3, aggro: 16, radius: 0.9,
    xp: 40, rep: 4, galleons: 4, weak: { fire: 1.8 }, spawn: { x: 135, z: 30, r: 14, max: 8 }, bite: { aura: 'poison', secs: 4, mag: 3 },
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
    xp: 90, rep: 10, galleons: 0, weak: {}, allDamage: 0.25, nightOnly: true, flying: true, spawn: { x: -100, z: 30, r: 10, max: 5 }, // inside the lake's scene (src/shared/scenes.ts), over the water
    lore: 'They drain the happiness out of the air. Expecto Patronum.',
  },
  inferius: {
    kind: 'inferius', name: 'Inferius', faction: 'hostile', hp: 90, speed: 2.8, damage: 9, range: 1.8, cooldown: 1.4, aggro: 12, radius: 0.6,
    xp: 55, rep: 6, galleons: 3, weak: { fire: 3, light: 1.5 }, nightOnly: true, spawn: { x: -88, z: 42, r: 8, max: 4 }, bite: { aura: 'chill', secs: 2, mag: 0.4 },
    lore: 'A corpse bewitched to do a Dark wizard\'s bidding. Their hands are cold as the lake. They fear fire and light.',
  },
  unicorn: {
    kind: 'unicorn', name: 'Unicorn', faction: 'benign', hp: 120, speed: 6, damage: 0, range: 0, cooldown: 99, aggro: 5, radius: 0.9,
    xp: 0, rep: -50, galleons: 0, weak: {}, spawn: { x: 120, z: -2, r: 9, max: 2 }, grace: { radius: 8, mag: 2 },
    lore: 'Pure and swift. To stand near one is to heal; to harm one is to live a cursed life from that moment.',
  },
  phoenix: {
    kind: 'phoenix', name: 'Fawkes', faction: 'benign', hp: 999, speed: 7, damage: 0, range: 0, cooldown: 99, aggro: 12, radius: 0.5,
    xp: 0, rep: 0, galleons: 0, weak: {}, invulnerable: true, flying: true, dayOnly: true, rare: 0.04, lifetime: 90, spawn: { x: -20, z: -10, r: 40, max: 1 },
    lore: 'Phoenix tears have healing powers. Fawkes comes to those who show loyalty — and to those badly hurt.',
  },
  // ---- wild: content/10x-expansion (22 new kinds; existing 8 untouched)
  bowtruckle: {
    kind: 'bowtruckle', name: 'Bowtruckle', faction: 'hostile', hp: 20, speed: 6, damage: 3, range: 1.2, cooldown: 0.8, aggro: 6, radius: 0.25,
    xp: 10, rep: 1, galleons: 1, weak: { fire: 1.5 }, spawn: { x: 30, z: -45, r: 8, max: 4 },
    lore: 'A twig-like guardian of wand-wood trees. Small, fast, and fiercely territorial. Fire keeps it off the bark.',
  },
  hinkypunk: {
    kind: 'hinkypunk', name: 'Hinkypunk', faction: 'hostile', hp: 30, speed: 3, damage: 4, range: 2, cooldown: 1.2, aggro: 8, radius: 0.4,
    xp: 14, rep: 1, galleons: 1, weak: { light: 2 }, spawn: { x: -40, z: 60, r: 10, max: 4 },
    lore: 'It dangles a lantern to lure travellers into bogs. Its own light is its undoing — answer with light.',
  },
  redcap: {
    kind: 'redcap', name: 'Red Cap', faction: 'hostile', hp: 35, speed: 4.5, damage: 6, range: 1.5, cooldown: 1.0, aggro: 8, radius: 0.4,
    xp: 16, rep: 2, galleons: 1, weak: { light: 1.5 }, spawn: { x: -45, z: -20, r: 8, max: 3 },
    lore: 'Lurks in dungeons and old battlegrounds, dyeing its cap in blood. Light drives it back into the dark.',
  },
  niffler: {
    kind: 'niffler', name: 'Niffler', faction: 'hostile', hp: 40, speed: 5, damage: 2, range: 1.2, cooldown: 0.9, aggro: 6, radius: 0.35,
    xp: 20, rep: 2, galleons: 8, weak: {}, spawn: { x: 40, z: 40, r: 12, max: 4 },
    lore: 'It loves anything shiny and carries a pouch full of it. Barely fights back — but its pouch is worth the chase.',
  },
  grindylow: {
    kind: 'grindylow', name: 'Grindylow', faction: 'hostile', hp: 55, speed: 4, damage: 7, range: 1.8, cooldown: 1.2, aggro: 10, radius: 0.5,
    xp: 25, rep: 3, galleons: 2, weak: { fire: 2 }, spawn: { x: -70, z: 20, r: 10, max: 4 },
    lore: 'A horned water demon of the Black Lake. It drags swimmers down; heat breaks its grip.',
  },
  erkling: {
    kind: 'erkling', name: 'Erkling', faction: 'hostile', hp: 65, speed: 5, damage: 8, range: 1.6, cooldown: 1.1, aggro: 10, radius: 0.5,
    xp: 30, rep: 3, galleons: 3, weak: { light: 1.5 }, spawn: { x: 100, z: 60, r: 10, max: 4 },
    lore: 'An elfish creature that lures children with its grin. It hates bright light.',
  },
  kelpie: {
    kind: 'kelpie', name: 'Kelpie', faction: 'hostile', hp: 70, speed: 5.5, damage: 8, range: 2, cooldown: 1.3, aggro: 10, radius: 0.7,
    xp: 32, rep: 3, galleons: 3, weak: { fire: 1.5 }, spawn: { x: -60, z: 55, r: 8, max: 3 },
    lore: 'A shape-shifting water horse. Once its bridle is on, it drags you under. Fire startles it off.',
  },
  thestral: {
    kind: 'thestral', name: 'Thestral', faction: 'hostile', hp: 85, speed: 7, damage: 7, range: 2, cooldown: 1.2, aggro: 8, radius: 0.8,
    xp: 38, rep: 4, galleons: 2, weak: { light: 1.5 }, flying: true, spawn: { x: 150, z: -10, r: 10, max: 3 },
    lore: 'Winged and skeletal, visible only to those who have seen death. The herd does not forgive a threat.',
  },
  hippogriff: {
    kind: 'hippogriff', name: 'Hippogriff', faction: 'hostile', hp: 95, speed: 6.5, damage: 10, range: 2.2, cooldown: 1.4, aggro: 10, radius: 0.9,
    xp: 42, rep: 4, galleons: 4, weak: {}, flying: true, spawn: { x: 60, z: -50, r: 10, max: 3 },
    lore: 'Proud and easily insulted. Bow first — or be taloned. Hagrid’s favourite, after Fang.',
  },
  occamy: {
    kind: 'occamy', name: 'Occamy', faction: 'hostile', hp: 90, speed: 7, damage: 9, range: 2, cooldown: 1.2, aggro: 12, radius: 0.7,
    xp: 52, rep: 5, galleons: 5, weak: { ice: 1.5 }, flying: true, spawn: { x: 140, z: -60, r: 10, max: 3 },
    lore: 'A serpentine dragon-relative that grows to fit its space — and its temper grows with it. Chill it down.',
  },
  boggart: {
    kind: 'boggart', name: 'Boggart', faction: 'hostile', hp: 100, speed: 6, damage: 10, range: 2, cooldown: 1.1, aggro: 12, radius: 0.6,
    xp: 55, rep: 6, galleons: 2, weak: { light: 2 }, spawn: { x: -35, z: -45, r: 8, max: 3 },
    lore: 'It becomes your worst fear. Laughter — pure light-hearted light — is the only thing that banishes it.',
  },
  runespoor: {
    kind: 'runespoor', name: 'Runespoor', faction: 'hostile', hp: 105, speed: 5, damage: 11, range: 2, cooldown: 1.2, aggro: 12, radius: 0.7,
    xp: 58, rep: 6, galleons: 5, weak: { fire: 1.5 }, spawn: { x: 120, z: 55, r: 8, max: 3 }, bite: { aura: 'poison', secs: 3, mag: 2 },
    lore: 'Three heads: the planner, the dreamer, the critic. The right head’s fangs are the ones to watch.',
  },
  skrewt: {
    kind: 'skrewt', name: 'Blast-Ended Skrewt', faction: 'hostile', hp: 110, speed: 2.5, damage: 12, range: 2.5, cooldown: 1.6, aggro: 10, radius: 0.8,
    xp: 60, rep: 6, galleons: 4, weak: { ice: 2 }, spawn: { x: 20, z: -60, r: 8, max: 3 },
    ranged: { range: 20, power: 10, cooldown: 3, element: 'fire', kind: 'bolt', provoked: true },
    lore: 'Hagrid’s crossbreed: it explodes from the rear. Do not stand behind it. Ice calms the blast.',
  },
  thunderbird: {
    kind: 'thunderbird', name: 'Thunderbird', faction: 'hostile', hp: 120, speed: 8, damage: 12, range: 2.5, cooldown: 1.4, aggro: 14, radius: 1.0,
    xp: 65, rep: 7, galleons: 6, weak: {}, flying: true, spawn: { x: 80, z: 80, r: 12, max: 3 },
    ranged: { range: 30, power: 12, cooldown: 4, element: 'lightning', kind: 'bolt' },
    lore: 'Its wings beat up storms as it flies. When the sky darkens over the pitch, look up.',
  },
  werewolf: {
    kind: 'werewolf', name: 'Werewolf', faction: 'hostile', hp: 130, speed: 7, damage: 14, range: 2, cooldown: 1.1, aggro: 14, radius: 0.7,
    xp: 70, rep: 7, galleons: 4, weak: { light: 2 }, nightOnly: true, spawn: { x: -120, z: -40, r: 12, max: 3 },
    lore: 'Human by day. On full-moon nights it hunts the grounds — fast, and far stronger than it looks.',
  },
  lethifold: {
    kind: 'lethifold', name: 'Lethifold', faction: 'hostile', hp: 140, speed: 3.5, damage: 13, range: 3, cooldown: 1.3, aggro: 12, radius: 1.2,
    xp: 80, rep: 8, galleons: 0, weak: { light: 3 }, nightOnly: true, spawn: { x: -30, z: -70, r: 8, max: 2 },
    lore: 'A living shroud that smothers sleepers. Only a Patronus drives it off — nothing else even slows it.',
  },
  manticore: {
    kind: 'manticore', name: 'Manticore', faction: 'hostile', hp: 160, speed: 6, damage: 16, range: 2.5, cooldown: 1.5, aggro: 14, radius: 1.0,
    xp: 85, rep: 9, galleons: 10, weak: { fire: 1.5 }, spawn: { x: -140, z: 60, r: 10, max: 2 }, bite: { aura: 'poison', secs: 4, mag: 3 },
    lore: 'A man’s head, a lion’s body, a scorpion’s tail. Its sting is venomous and it knows it.',
  },
  chimera: {
    kind: 'chimera', name: 'Chimera', faction: 'hostile', hp: 180, speed: 5.5, damage: 18, range: 3, cooldown: 1.6, aggro: 14, radius: 1.2,
    xp: 95, rep: 10, galleons: 12, weak: { ice: 1.5 }, spawn: { x: 160, z: 80, r: 10, max: 2 },
    ranged: { range: 24, power: 14, cooldown: 4, element: 'fire', kind: 'bolt' },
    lore: 'Lion, goat, dragon — one bad temper in three parts. Its dragon head breathes fire; ice answers.',
  },
  aragog: {
    kind: 'aragog', name: 'Aragog', faction: 'hostile', hp: 200, speed: 5, damage: 20, range: 3, cooldown: 1.5, aggro: 16, radius: 1.4,
    xp: 100, rep: 10, galleons: 12, weak: { fire: 2 }, spawn: { x: 170, z: 40, r: 12, max: 2 }, bite: { aura: 'poison', secs: 5, mag: 4 },
    ranged: { range: 16, power: 0, cooldown: 6, element: 'arcane', kind: 'root', secs: 1.5 },
    lore: 'King of the acromantulas, deep in the forest. His children do not share Hagrid’s fondness for you.',
  },
  basilisk: {
    kind: 'basilisk', name: 'Basilisk', faction: 'hostile', hp: 220, speed: 5.5, damage: 22, range: 3.5, cooldown: 1.8, aggro: 18, radius: 1.2,
    xp: 110, rep: 12, galleons: 15, weak: { light: 1.5 }, spawn: { x: 185, z: -25, r: 10, max: 1 },
    ranged: { range: 20, power: 0, cooldown: 8, element: 'arcane', kind: 'root', secs: 2 },
    lore: 'The King of Serpents. Its gaze petrifies — do not look it in the eye. Fifty feet of nightmare.',
  },
  nundu: {
    kind: 'nundu', name: 'Nundu', faction: 'hostile', hp: 240, speed: 6, damage: 24, range: 3, cooldown: 1.7, aggro: 16, radius: 1.3,
    xp: 115, rep: 12, galleons: 15, weak: {}, allDamage: 0.8, spawn: { x: -160, z: -60, r: 12, max: 1 }, bite: { aura: 'poison', secs: 5, mag: 5 },
    lore: 'Its breath alone fells a village. It takes a hundred wizards to subdue one — you are not a hundred wizards.',
  },
  dragon: {
    kind: 'dragon', name: 'Hungarian Horntail', faction: 'hostile', hp: 260, speed: 7, damage: 26, range: 4, cooldown: 2.0, aggro: 18, radius: 1.6,
    xp: 120, rep: 14, galleons: 20, weak: { ice: 1.5 }, flying: true, rare: 0.3, spawn: { x: 200, z: 0, r: 15, max: 1 },
    ranged: { range: 40, power: 20, cooldown: 5, element: 'fire', kind: 'bolt' },
    lore: 'The Triwizard Tournament’s first task, now loose. Forty feet of armoured, fire-breathing pride. Ice bites deepest.',
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
