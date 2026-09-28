import type { CreatureKind } from '../shared/constants.js';
import type { CreatureDef } from './types.js';

export const CREATURES: Record<CreatureKind, CreatureDef> = {
  pixie: {
    kind: 'pixie', name: 'Cornish Pixie', hp: 24, speed: 5.5, damage: 4, range: 1.6, cooldown: 1.0, aggro: 10, radius: 0.35,
    xp: 12, rep: 1, galleons: 1, weak: { ice: 2 }, spawn: { x: 22, z: 28, r: 26, max: 8 },
    lore: 'Electric blue, eight inches high, and mischievous. Lockhart released a cage of them once. Freezing charms work.',
  },
  snare: {
    kind: 'snare', name: "Devil's Snare", hp: 60, speed: 0, damage: 5, range: 3.5, cooldown: 1.2, aggro: 3.5, radius: 1.2,
    xp: 22, rep: 2, galleons: 2, weak: { fire: 2, light: 3 }, spawn: { x: 41, z: -24, r: 12, max: 4 },
    lore: 'Roots anything that lingers. Fire or sunlight.',
  },
  spider: {
    kind: 'spider', name: 'Acromantula', hp: 80, speed: 5, damage: 10, range: 2, cooldown: 1.3, aggro: 16, radius: 0.9,
    xp: 40, rep: 4, galleons: 4, weak: { fire: 1.8 }, spawn: { x: 165, z: 15, r: 70, max: 10 },
    lore: "Aragog's descendants. Hagrid would like you to know they are misunderstood.",
  },
  troll: {
    kind: 'troll', name: 'Mountain Troll', hp: 260, speed: 3, damage: 28, range: 3, cooldown: 2.6, aggro: 14, radius: 1.4,
    xp: 140, rep: 14, galleons: 18, weak: { arcane: 0.6 }, spawn: { x: -50, z: -36, r: 9, max: 2 },
    lore: 'Twelve feet of granite-grey stupidity. Leviosa their clubs.',
  },
  dementor: {
    kind: 'dementor', name: 'Dementor', hp: 150, speed: 4, damage: 6, range: 6, cooldown: 1, aggro: 25, radius: 0.8,
    xp: 90, rep: 10, galleons: 0, weak: {}, allDamage: 0.25, nightOnly: true, spawn: { x: -110, z: 40, r: 72, max: 5 },
    lore: 'They drain the happiness out of the air. Expecto Patronum.',
  },
};
