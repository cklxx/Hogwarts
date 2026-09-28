// The map is the single source of truth for BOTH server collision and client rendering.
// Coordinates: metres on the XZ plane. +X = east, +Z = south (three.js default: -Z is "north").

export interface Box { kind: 'box'; x0: number; z0: number; x1: number; z1: number; h: number; style: Style; label?: string }
export interface Disc { kind: 'disc'; x: number; z: number; r: number; h: number; style: Style; label?: string }
export type Obstacle = Box | Disc;
export type Style = 'stone' | 'tower' | 'wood' | 'tree' | 'water' | 'house' | 'willow' | 'tomb' | 'rock' | 'hoop';

export interface Zone { id: ZoneId; name: string; x: number; z: number; r?: number; box?: [number, number, number, number] }
export type ZoneId =
  | 'grounds' | 'great_hall' | 'courtyard' | 'forest' | 'hogsmeade' | 'lake_shore' | 'dungeons'
  | 'greenhouses' | 'seventh_floor' | 'erised' | 'tomb' | 'willow' | 'azkaban' | 'pitch';

export interface Landmark { id: string; name: string; x: number; z: number; blurb: string }

export const WORLD_HALF = 240;
export const SPAWN = { x: 0, z: -22 };
export const AZKABAN = { x: 0, z: 420 };

/** Deterministic PRNG so server and client generate the same forest. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const box = (x0: number, z0: number, x1: number, z1: number, h: number, style: Style = 'stone', label?: string): Box =>
  ({ kind: 'box', x0, z0, x1, z1, h, style, label });
const disc = (x: number, z: number, r: number, h: number, style: Style, label?: string): Disc =>
  ({ kind: 'disc', x, z, r, h, style, label });

function buildObstacles(): Obstacle[] {
  const o: Obstacle[] = [
    // --- The castle ---
    box(-30, -112, 30, -72, 26, 'stone', 'Castle Keep'),
    // Great Hall: open-roofed enclosure with a door on the south wall (x in [-3,3]).
    box(-13, -72, -12, -40, 14, 'stone'),
    box(12, -72, 13, -40, 14, 'stone'),
    box(-13, -41, -3, -40, 14, 'stone'),
    box(3, -41, 13, -40, 14, 'stone'),
    box(-62, -104, -13, -64, 18, 'stone', 'West Wing'),
    box(13, -104, 62, -64, 18, 'stone', 'East Wing'),
    disc(-56, -108, 7, 48, 'tower', 'Astronomy Tower'),
    disc(56, -108, 6, 38, 'tower', 'Gryffindor Tower'),
    disc(-66, -70, 5, 34, 'tower', 'Ravenclaw Tower'),
    disc(66, -70, 5, 30, 'tower', 'Clock Tower'),
    disc(-20, -118, 4, 32, 'tower'),
    disc(20, -118, 4, 32, 'tower'),
    // Courtyard pillars
    disc(-18, -30, 1.2, 8, 'stone'), disc(18, -30, 1.2, 8, 'stone'),
    disc(-18, -12, 1.2, 8, 'stone'), disc(18, -12, 1.2, 8, 'stone'),
    // Greenhouses
    box(32, -44, 50, -36, 4, 'house', 'Greenhouse Three'),
    // --- The grounds ---
    disc(-110, 40, 55, 0, 'water', 'The Black Lake'),
    disc(-52, 28, 1.6, 2, 'tomb', "Dumbledore's Tomb"),
    disc(45, 0, 3, 14, 'willow', 'Whomping Willow'),
    disc(95, 30, 5, 7, 'wood', "Hagrid's Hut"),
    // Quidditch hoops
    disc(40, -178, 0.5, 16, 'hoop'), disc(34, -178, 0.5, 13, 'hoop'), disc(46, -178, 0.5, 13, 'hoop'),
    disc(40, -122, 0.5, 16, 'hoop'), disc(34, -122, 0.5, 13, 'hoop'), disc(46, -122, 0.5, 13, 'hoop'),
    // --- Hogsmeade ---
    box(-30, 150, -16, 162, 9, 'house', 'The Three Broomsticks'),
    box(14, 150, 28, 160, 8, 'house', 'Honeydukes'),
    box(-28, 178, -16, 188, 8, 'house', "Zonko's Joke Shop"),
    box(16, 178, 30, 190, 9, 'house', 'Hog\'s Head'),
    box(58, 196, 70, 208, 12, 'wood', 'Shrieking Shack'),
    // --- Azkaban (a rock in the North Sea) ---
    disc(AZKABAN.x + 9, AZKABAN.z, 2, 30, 'rock', 'Azkaban'),
  ];
  // The Forbidden Forest: deterministic trees, leaving a trail open toward Aragog's hollow.
  const rnd = mulberry32(1998);
  for (let i = 0; i < 170; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * 85;
    const x = 165 + Math.cos(a) * d;
    const z = 15 + Math.sin(a) * d;
    if (Math.abs(z - 15) < 5 && x < 200) continue; // the trail
    if (Math.hypot(x - 95, z - 30) < 12) continue; // Hagrid's garden
    if (Math.abs(x) > WORLD_HALF - 4 || Math.abs(z) > WORLD_HALF - 4) continue;
    o.push(disc(x, z, 0.9 + rnd() * 0.8, 10 + rnd() * 10, 'tree'));
  }
  return o;
}

export const OBSTACLES: Obstacle[] = buildObstacles();

export const ZONES: Zone[] = [
  { id: 'great_hall', name: 'The Great Hall', x: 0, z: -56, box: [-12, -72, 12, -41] },
  { id: 'courtyard', name: 'The Courtyard', x: 0, z: -22, box: [-25, -40, 25, -5] },
  { id: 'seventh_floor', name: 'Seventh-Floor Corridor', x: -32, z: -58, box: [-44, -63, -20, -52] },
  { id: 'erised', name: 'The Mirror of Erised', x: 30, z: -60, r: 2.5 },
  { id: 'greenhouses', name: 'Greenhouses', x: 41, z: -30, r: 16 },
  { id: 'dungeons', name: 'Dungeon Stair', x: -50, z: -36, r: 12 },
  { id: 'tomb', name: "Dumbledore's Tomb", x: -52, z: 28, r: 5 },
  { id: 'willow', name: 'Whomping Willow', x: 45, z: 0, r: 8 },
  { id: 'lake_shore', name: 'Black Lake Shore', x: -110, z: 40, r: 75 },
  { id: 'forest', name: 'The Forbidden Forest', x: 165, z: 15, r: 88 },
  { id: 'pitch', name: 'Quidditch Pitch', x: 40, z: -150, r: 35 },
  { id: 'hogsmeade', name: 'Hogsmeade', x: 0, z: 172, r: 45 },
  { id: 'grounds', name: 'Hogwarts Grounds', x: 0, z: -30, r: 150 },
  { id: 'azkaban', name: 'Azkaban', x: AZKABAN.x, z: AZKABAN.z, r: 30 },
];

export const LANDMARKS: Landmark[] = [
  { id: 'courtyard', name: 'The Courtyard', x: 0, z: -22, blurb: 'Where every new student arrives. Duels are frequent.' },
  { id: 'great_hall', name: 'The Great Hall', x: 0, z: -56, blurb: 'Its ceiling is bewitched to look like the sky outside. No duelling at dinner.' },
  { id: 'seventh_floor', name: 'Seventh-Floor Corridor', x: -32, z: -58, blurb: 'Opposite a tapestry of Barnabas the Barmy trying to teach trolls ballet.' },
  { id: 'erised', name: 'A disused classroom', x: 30, z: -60, blurb: 'Erised stra ehru oyt ube cafru oyt on wohsi.' },
  { id: 'greenhouses', name: 'Greenhouses', x: 41, z: -30, blurb: "Professor Sprout's domain. Mind the Devil's Snare." },
  { id: 'dungeons', name: 'Dungeon Stair', x: -50, z: -36, blurb: 'Trolls in the dungeon! (Thought you ought to know.)' },
  { id: 'tomb', name: "Dumbledore's Tomb", x: -52, z: 28, blurb: 'A white marble tomb by the lake. Something powerful may rest here.' },
  { id: 'willow', name: 'Whomping Willow', x: 45, z: 0, blurb: 'Planted the year Remus Lupin arrived. It hits back.' },
  { id: 'hagrid', name: "Hagrid's Hut", x: 95, z: 30, blurb: 'Rock cakes available. Teeth not guaranteed.' },
  { id: 'forest', name: 'The Forbidden Forest', x: 165, z: 15, blurb: 'Forbidden to all students. Acromantulas.' },
  { id: 'lake', name: 'The Black Lake', x: -110, z: 40, blurb: 'Home to a giant squid, grindylows and merpeople. Dementors drift here at night.' },
  { id: 'pitch', name: 'Quidditch Pitch', x: 40, z: -150, blurb: 'Six hoops, fifty feet high.' },
  { id: 'hogsmeade', name: 'Hogsmeade', x: 0, z: 172, blurb: 'The only all-wizarding village in Britain. Outside the anti-Apparition wards.' },
  { id: 'shack', name: 'Shrieking Shack', x: 64, z: 202, blurb: 'The most haunted building in Britain. (It is not haunted.)' },
];

export function inZone(z: Zone, x: number, zz: number): boolean {
  if (z.box) return x >= z.box[0] && x <= z.box[2] && zz >= z.box[1] && zz <= z.box[3];
  return Math.hypot(x - z.x, zz - z.z) <= (z.r ?? 0);
}

export function zonesAt(x: number, z: number): ZoneId[] {
  return ZONES.filter((zn) => inZone(zn, x, z)).map((zn) => zn.id);
}

export function landmarkById(id: string): Landmark | undefined {
  const q = id.toLowerCase();
  return LANDMARKS.find((l) => l.id === q || l.name.toLowerCase().includes(q));
}
