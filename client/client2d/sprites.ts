/**
 * client2d/sprites.ts — procedural pixel-art sprites for the 2D canvas renderer.
 *
 * Every sprite is pre-rendered once onto an offscreen canvas at init; the main
 * loop only calls drawImage (no per-frame canvas ops). Pixel art is authored as
 * string grids so shapes stay reviewable in a diff. Renderers must draw with
 * imageSmoothingEnabled = false to keep pixels sharp (see drawSprite below).
 *
 * Art direction (Stardew-style): soft mid-tone colours, 1px dark-brown outline
 * (#2a1f1a, never pure black), a highlight tone on the upper-left of each mass
 * and a shadow tone on the lower-right. No high-saturation pure colours.
 *
 * Kinds:
 *   wizard-<house>      16x24 hooded figure: face with eyes, house-colour robe,
 *                       trim collar / belt / hem (Gryffindor/Hufflepuff/Ravenclaw/Slytherin)
 *   <creature>          16x16, one per CreatureKind in src/shared/constants.ts (30 wild + 2 summons)
 *   chest / chest-gold  16x12 loot chests
 *   <prop>              16x16 for the common PropKinds (crate/barrel/pumpkin/pot/mushroom/brazier/...)
 *   coin / mana / heart / potion   12x12 pickups (LootKind in src/shared/loot.ts)
 * Unknown kinds fall back to the magenta "missing" tile.
 */

type Palette = Record<string, string>;

const cache = new Map<string, HTMLCanvasElement>();
let built = false;

/** Draw a string-grid sprite into an offscreen canvas. '.' = transparent. */
function px(art: readonly string[], pal: Palette): HTMLCanvasElement {
  const h = art.length;
  const w = Math.max(...art.map((r) => r.length));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  for (let y = 0; y < h; y++) {
    const row = art[y]!;
    for (let x = 0; x < row.length; x++) {
      const col = pal[row[x]!];
      if (col) {
        g.fillStyle = col;
        g.fillRect(x, y, 1, 1);
      }
    }
  }
  return c;
}

function reg(kind: string, art: readonly string[], pal: Palette): void {
  cache.set(kind, px(art, pal));
}

// ---------------------------------------------------------------------------
// Shared art tokens.
// ---------------------------------------------------------------------------

/** Dark-brown outline used by every sprite (never pure black). */
const K = '#2a1f1a';

/** Shared skin tones for humanoid faces. */
const SKIN = '#f0c49a';
const SKIN_HI = '#f9dcb8';

// ---------------------------------------------------------------------------
// Wizards: 16x24 hooded figures. Hood + visible face + eyes; house robe with
// trim collar, belt and hem so the four houses read apart at a glance.
// ---------------------------------------------------------------------------

const WIZARD_BASE: readonly string[] = [
  '.....kkkkkk.....',
  '...kkhhhhhhkk...',
  '..khhhhhhhhhhk..',
  '..khhhhhhhhhhk..',
  '.khhhhhhhhhhhhk.',
  '.khhhsssssshhhk.',
  '.khhhsesseshhhk.',
  '.khhhsssssshhhk.',
  '...kkhhhhhhkk...',
  '....kksssskk....',
  '..kttttttttttk..',
  '.khhhhhhhhhhhhk.',
  '.khhhhhhhhhhhhk.',
  'kkhHhhhhhhhddhkk',
  'kkhHhhhhhhhddhkk',
  '.kshHhhhhhddhsk.',
  '.khhhhhhhhhhhhk.',
  '..kttttttttttk..',
  '.khhhhhhhhhhhhk.',
  '.khhhhhhhhhhhhk.',
  '..kttttttttttk..',
  '...kkk....kkk...',
  '...kkk....kkk...',
  '................',
];

/** House robe colours: base / highlight / shadow + trim / trim highlight. */
const WIZARD_TRIMS: Record<string, { h: string; H: string; d: string; t: string; T: string }> = {
  gryffindor: { h: '#a83a32', H: '#cf6a5e', d: '#732420', t: '#d9a441', T: '#f2cd7d' },
  slytherin: { h: '#2e7a3c', H: '#57a866', d: '#1e5427', t: '#c3ccd4', T: '#eef2f5' },
  ravenclaw: { h: '#3a5cad', H: '#6f92d6', d: '#26427e', t: '#c08a4a', T: '#e0b075' },
  hufflepuff: { h: '#d9a441', H: '#f2cd7d', d: '#9c7226', t: '#4a4038', T: '#6f6257' },
};

function buildWizards(): void {
  for (const [house, c] of Object.entries(WIZARD_TRIMS)) {
    reg(`wizard-${house}`, WIZARD_BASE, {
      k: K, h: c.h, H: c.H, d: c.d, t: c.t, T: c.T,
      s: SKIN, S: SKIN_HI, e: K,
    });
  }
  // generic / unknown house
  reg('wizard', WIZARD_BASE, {
    k: K, h: '#6b5b9e', H: '#8f81c2', d: '#483d6e', t: '#c3ccd4', T: '#eef2f5',
    s: SKIN, S: SKIN_HI, e: K,
  });
}

// ---------------------------------------------------------------------------
// Creatures: 16x16, silhouette-first. One per CreatureKind.
// ---------------------------------------------------------------------------

function buildCreatures(): void {
  // pixie: soft blue body, pale wings, gold sparkle
  reg('pixie', [
    '................',
    '..ww........ww..',
    '..www..bb..www..',
    '...wwwbbbbwww...',
    '....wwbyybww....',
    '.....bbbbbb.....',
    '......bbbb......',
    '.....bb..bb.....',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, b: '#4a7bd4', B: '#7fa5e8', y: '#ffd94d', w: '#d8e6f8' });

  // snare: dark green tentacle mound, lighter tips
  reg('snare', [
    '................',
    '................',
    '.....kk..kk.....',
    '....kggkggk.....',
    '....kgggggk.....',
    '..kkggggggggk...',
    '.kgGgggggggGgk..',
    '.kggggggggggk...',
    '..kgggggggggk...',
    '...kgggggggk....',
    '....kkggggkk....',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, g: '#2e7a3a', G: '#5fae6a' });

  // spider: dark brown body, 8 thin legs, red eyes
  reg('spider', [
    '................',
    '..k..........k..',
    '.k.k........k.k.',
    '.k..k..dd..k..k.',
    '..k..kddddk..k..',
    '...k.kdrrdk.k...',
    '....kkddddkk....',
    '.k..kddddddk..k.',
    '..k.kdDDDDdk.k..',
    '..k.kdDDDDdk.k..',
    '.k..kddddddk..k.',
    '....kkddddkk....',
    '...k.kdDDdk.k...',
    '.k..k..dd..k..k.',
    '.k.k........k.k.',
    '..k..........k..',
  ], { k: K, d: '#4a3a30', D: '#63503f', r: '#d43a2a' });

  // aragog: bulkier, darker spider, red eyes, pale fangs
  reg('aragog', [
    '................',
    'k..............k',
    '.k....dddd....k.',
    '..k..dddddd..k..',
    '...kddddddddk...',
    '...kdrrddrrdk...',
    '...kddddddddk...',
    '..kddddddddddk..',
    '..kdwddddddwdk..',
    '..kddddddddddk..',
    '...kddddddddk...',
    '...k.kddddk.k...',
    '..k...dddd...k..',
    '.k....dddd....k.',
    'k..............k',
    '................',
  ], { k: K, d: '#2e2420', r: '#e03a2a', w: '#e8dcc8' });

  // troll: grey brute, heavy brow, small eyes, thick arms
  reg('troll', [
    '................',
    '.....kkkkkk.....',
    '....kgGgggGk....',
    '...kggggggggk...',
    '...kggggggggk...',
    '...kgekggkegk...',
    '...kggggggggk...',
    '....kggggggk....',
    '..kggggggggggk..',
    '.kggggggggggggk.',
    '.kddkggggggkddk.',
    '.kddkggggggkddk.',
    '...kkk....kkk...',
    '................',
    '................',
    '................',
  ], { k: K, g: '#8a8f98', G: '#a8adb5', d: '#6a6f78', e: K });

  // dementor: dark slate floating cloak, black void where the face would be,
  // tattered hem
  reg('dementor', [
    '................',
    '.....kkkkkk.....',
    '....kggggggk....',
    '...kggggggggk...',
    '...kggVVVgggk...',
    '...kggVVVgggk...',
    '...kggggggggk...',
    '....kggggggk....',
    '...kggggggggk...',
    '..kggggggggggk..',
    '..kggkggggkggk..',
    '..kggggggggggk..',
    '...kggkggkggk...',
    '...k.k....k.k...',
    '................',
    '................',
  ], { k: K, g: '#3f4450', G: '#5a6170', V: '#0d0f14' });

  // lethifold: darker cloak, subtle ripple folds, no face at all.
  // L = cool rim light on the upper-left so it lifts off dark forest ground.
  reg('lethifold', [
    '................',
    '......kkkk......',
    '....kLggggkk....',
    '...Lggggggggk...',
    '...LggGgggGgk...',
    '...kggggggggk...',
    '....kggggggk....',
    '....kggggggk....',
    '...kggggggggk...',
    '...kggGgggGgk...',
    '...kggggggggk...',
    '....kggggggk....',
    '...kg.kkgk.gk...',
    '................',
    '................',
    '................',
  ], { k: K, g: '#2a2d38', G: '#4a5060', L: '#6a7386' });

  // inferius: pale corpse, sunken eyes, tattered blue-grey shroud
  reg('inferius', [
    '................',
    '.....kkkkkk.....',
    '....kppppppk....',
    '....kPppppPk....',
    '....kpkppkpk....',
    '....kppppppk....',
    '.....kppppk.....',
    '...kkbbbbbbkk...',
    '..kbbbbbbbbbbk..',
    '..kbpbbbbbbpbk..',
    '..kbbbbbbbbbbk..',
    '...kbbbk.kbbk...',
    '...kbb.....bk...',
    '................',
    '................',
    '................',
  ], { k: K, p: '#c9cfd4', P: '#eef2f5', b: '#5a6b7a' });

  // unicorn: warm-white horse, gold horn, pale mane and tail
  reg('unicorn', [
    '................',
    '........yy......',
    '.......kyk......',
    '......kwwk......',
    '.....kwwwwk.....',
    '.....kwkwk......',
    '....kwwwwwwk....',
    '..kkwwwwwwwwk...',
    '.kwwwwwwwwwwkWk.',
    '.kwWwwwwwwWwkWk.',
    '..kwk...kwk.....',
    '..kwk...kwk.....',
    '..kkk...kkk.....',
    '................',
    '................',
    '................',
  ], { k: K, w: '#f0ece4', W: '#ffffff', y: '#e8b83d' });

  // thestral: dark skeletal winged horse, bat wings raised, pale eyes
  reg('thestral', [
    '................',
    '....kkk.kkk.....',
    '...kdddkdddk....',
    '...kdddkdddk....',
    '.....kdddk......',
    '.....kdwdk......',
    '....kdddddk.....',
    '..kkdddddddk....',
    '.kdddddddddk....',
    '.kddkddkddkdk...',
    '..kdk...kdk.....',
    '..kk....kk......',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, d: '#232327', w: '#e8e8e8' });

  // hippogriff: eagle head with gold beak, feathered brown fore, horse hind
  reg('hippogriff', [
    '................',
    '.......yy.......',
    '......kyyk......',
    '......kbbk......',
    '.....kbbkbk.....',
    '.....kbbbbk.....',
    '....kbbbbbbk....',
    '..kkbbbbbbbkk...',
    '.kbbbbbbbbbbk...',
    '.kbBbbbbbbBbk...',
    '..kbk...kbk.....',
    '..kbk...kbk.....',
    '..kkk...kkk.....',
    '................',
    '................',
    '................',
  ], { k: K, b: '#8a5c30', B: '#bd8f52', y: '#e8a93d' });

  // phoenix: red body, orange flame wings, gold beak
  reg('phoenix', [
    '................',
    '.....kk.........',
    '....krrk........',
    '....krkrk..oo...',
    '....krrky.ooo...',
    '.....krrkoooo...',
    '....krrrrkoo....',
    '...krrorrooo....',
    '...kroorro......',
    '....krr.........',
    '....kr.r........',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, r: '#d43a1e', o: '#f08a2a', y: '#e8b83d' });

  // thunderbird: yellow body, blue wing bands, fanned tail
  reg('thunderbird', [
    '................',
    '..y........y....',
    '..kyk....kyk....',
    '...kyyyyyyk.....',
    '....kykyyk......',
    '.....kyyyk......',
    '....kybybyk.....',
    '...kybbybbk.....',
    '..kyy....yyk....',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, y: '#f0c93d', b: '#4a7bd4' });

  // bowtruckle: small twig figure with leaf fingers
  reg('bowtruckle', [
    '................',
    '......gg........',
    '.....kggk.......',
    '......kbk.......',
    '.....kbkbk......',
    '......kbk.......',
    '.....kbbbk......',
    '......kbk.......',
    '.....kbkbk......',
    '.....k.k.k......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, b: '#6b4a2a', g: '#4a7a3a' });

  // hinkypunk: dark wisp holding a glowing lantern
  reg('hinkypunk', [
    '................',
    '................',
    '.....kkkk.......',
    '....kdddddk.....',
    '....kdyyddk.....',
    '....kdyYyddk....',
    '....kdddddk.....',
    '.....kdddk......',
    '......kdk.......',
    '.....kYYYk......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, d: '#3a3a4a', y: '#ffe98a', Y: '#fff8dc' });

  // redcap: red cap, dark squat body
  reg('redcap', [
    '................',
    '.....kkkk.......',
    '....krrrrk......',
    '...krrrrrrk.....',
    '...krrRRrrk.....',
    '....krrrrk......',
    '.....kddk.......',
    '....kddddk......',
    '....kdkkdk......',
    '....kddddk......',
    '.....kddk.......',
    '.....kdk........',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, r: '#b83a34', R: '#e06a5e', d: '#3a3a42' });

  // niffler: dark round body, long snout, gold pouch
  reg('niffler', [
    '................',
    '................',
    '................',
    '.....kkkk.......',
    '....kddddk......',
    '...kddddddk.....',
    '...kddkdddk.....',
    '..kkddddddk.....',
    '.kppddddddk.....',
    '.kppddddddk.....',
    '..kkdyyddk......',
    '....kdyydk......',
    '.....kkkk.......',
    '................',
    '................',
    '................',
  ], { k: K, d: '#3a3a4a', p: '#9a7a64', y: '#e8b83d' });

  // grindylow: green water demon, pale horns, sharp teeth
  reg('grindylow', [
    '................',
    '....y....y......',
    '.....kddk.......',
    '....kddddk......',
    '....kdkkdk......',
    '....kddddk......',
    '.....kwwk.......',
    '....kddddk......',
    '.....kddk.......',
    '....kdk.kdk.....',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, d: '#3a8a5c', y: '#e8e8e8', w: '#f4f4f4' });

  // erkling: green goblin, big pointed ears, sly grin
  reg('erkling', [
    '................',
    '................',
    '..k........k....',
    '..kdk....kdk....',
    '...kddddddk.....',
    '...kdkkkdk......',
    '...kddddddk.....',
    '....kddddk......',
    '....kdkkdk......',
    '.....kddk.......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, d: '#55a047' });

  // kelpie: dark water horse, seaweed mane
  reg('kelpie', [
    '................',
    '................',
    '.......kk.......',
    '......kbbk......',
    '......kbkb......',
    '.....kbbbbk.....',
    '....kgbbbbk.....',
    '..kkgbbbbbbk....',
    '.kgbbbbbbbbk....',
    '.kgbBbbBbbbk....',
    '..kbk...kbk.....',
    '..kbk...kbk.....',
    '..kkk...kkk.....',
    '................',
    '................',
    '................',
  ], { k: K, b: '#265063', B: '#4a7a8a', g: '#3a7a5a' });

  // occamy: teal serpent-bird — S-curved body, feathered wing, head with eye
  reg('occamy', [
    '................',
    '...kkkk.........',
    '..kttttkk.......',
    '..ktetttkwwk....',
    '..kTttttkwwwwk..',
    '...kttttkwwkwk..',
    '...ktttkwkwk....',
    '....ktttk.......',
    '....ktttk.......',
    '...ktttk........',
    '...kttk.........',
    '....kk..........',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, t: '#359a92', T: '#6ac4bc', w: '#d9efe9', e: K });

  // boggart: dark purple shifting blob, pale swirling face
  reg('boggart', [
    '................',
    '................',
    '....kkkkkk......',
    '...kddddddk.....',
    '...kdwwwwdk.....',
    '...kdwkwkdk.....',
    '...kdwwwwdk.....',
    '...kddddddk.....',
    '....kddddk......',
    '...kdk..kdk.....',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, d: '#4a3560', w: '#e8e8f0' });

  // runespoor: three-headed orange snake, dark stripes
  reg('runespoor', [
    '................',
    '...k..k..k......',
    '...kokokok......',
    '...kokokok......',
    '....kokok.......',
    '....koook.......',
    '.....kook.......',
    '.....kook.......',
    '......kok.......',
    '......kk........',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, o: '#d47a2a', O: '#e89a4e' });

  // skrewt: armoured plates, pale joints, red stinger tail
  reg('skrewt', [
    '................',
    '................',
    '.....kkkk.......',
    '....kaaaak......',
    '...kaaaaaak.....',
    '..kaakaaakaak...',
    '..kaaaaaaaaak...',
    '...kaakaaak.....',
    '....kaaaak......',
    '.....kaaak..k...',
    '..........ksk...',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, a: '#8a6238', s: '#d43a2a' });

  // werewolf: grey wolf, pricked ears, snout, clawed paws
  reg('werewolf', [
    '................',
    '....kk..kk......',
    '...kwwkkwwk.....',
    '...kwwwwwwk.....',
    '...kwkwwkwk.....',
    '....kwwwwk......',
    '...kkwwwwkk.....',
    '..kwwwwwwwwk....',
    '..kwWwwwwWwk....',
    '..kwwwwwwwwk....',
    '...kwk..kwk.....',
    '...kkk..kkk.....',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, w: '#82878f', W: '#a8adb5' });

  // manticore: rust-red lion body, dark mane, folded bat wings, scorpion tail
  reg('manticore', [
    '................',
    '................',
    '................',
    '.kwkmmmmmmkwk...',
    '.kwwkmmmmkwwk...',
    '..kwkmrrkmwk....',
    '...kmmRrmmk.....',
    '...kmrermk..k...',
    '...kmrrrrk...k..',
    '....krrrrk...sk.',
    '....krrrrk......',
    '....kk..kk......',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, r: '#b04432', R: '#d4694f', m: '#7e2f22', w: '#6e4a52', e: K, s: '#e04a30' });

  // chimera: lion head and fore, goat-brown mid, snake tail
  reg('chimera', [
    '................',
    '................',
    '.....kkkk.......',
    '....kooook......',
    '...kookokok.....',
    '...kooooook..k..',
    '....kooookggg...',
    '...kooooookgg...',
    '....koo.kok.....',
    '....kk...kk.....',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, o: '#cf9040', g: '#4a7a3a' });

  // basilisk: green serpent, big yellow eyes, pale fangs, coiled tail
  reg('basilisk', [
    '................',
    '....kkkk........',
    '...kggggk.......',
    '...kygygyk......',
    '...kggggk.......',
    '....kwwk........',
    '....kgggk.......',
    '....kggggk......',
    '.....kggggk.....',
    '......kgggk.....',
    '.......kk.......',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, g: '#3a8a3c', y: '#ffe14d', w: '#f4f4f4' });

  // nundu: grey spotted leopard
  reg('nundu', [
    '................',
    '................',
    '................',
    '.....kkkk.......',
    '....knnnnk......',
    '...knnnnnnk.....',
    '...knknknk......',
    '...knnnnnnk.....',
    '....knnnnk......',
    '...knknknknk....',
    '...knnnnnnk.....',
    '....knk.knk.....',
    '....kk...kk.....',
    '................',
    '................',
    '................',
  ], { k: K, n: '#9099a0' });

  // dragon: red body, darker spread wings, gold eyes, curling tail
  reg('dragon', [
    '................',
    '.kk........kk...',
    '.kdk......kdk...',
    '.kddk.rr.kddk...',
    '..kddkrrrrkddk..',
    '...kddrrrrddk...',
    '....kdryyrdk....',
    '....kdrrrrdk....',
    '.....kdrrdk.....',
    '.....kdrrdk.....',
    '......kddk......',
    '......kdk.......',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, r: '#c04534', d: '#a03828', y: '#ffe14d' });

  // serpent (summon): simple green snake, raised head
  reg('serpent', [
    '................',
    '................',
    '....kk..........',
    '...kggk.........',
    '...kgkgk........',
    '...kgggk........',
    '....kgggk.......',
    '.....kgggk......',
    '......kggk......',
    '.......kk.......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, g: '#43a047' });

  // birds (summon): two small blue birds with gold beaks
  reg('birds', [
    '................',
    '................',
    '..kk......kk....',
    '.kbbk....kbbk...',
    '.kbkbk...kbkbk..',
    '.kbbbk...kbbbk..',
    '..kwk.....kwk...',
    '...k.......k....',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, b: '#5f97dd', w: '#e8a93d' });
}

// ---------------------------------------------------------------------------
// Chests: 16x12.
// ---------------------------------------------------------------------------

function buildChests(): void {
  // plain wooden chest: highlight plank, metal bands, keyhole
  reg('chest', [
    '................',
    '................',
    '..kkkkkkkkkkkk..',
    '..kbBbbbbbbBbk..',
    '..kbybbbbbybbk..',
    '..kbbbbbbbbbbk..',
    '..kbbbbbyybbbk..',
    '..kbbbyyyyybbk..',
    '..kbbbyykkybbk..',
    '..kbbbyyyyybbk..',
    '..kbbbbbbbbbbk..',
    '..kkkkkkkkkkkk..',
  ], { k: K, b: '#7a5230', B: '#a87c48', y: '#c99a2e' });
  // ornate gold chest: bright gold, darker trim, pale lock plate
  reg('chest-gold', [
    '................',
    '................',
    '..kkkkkkkkkkkk..',
    '..kyyyyyyyyyyk..',
    '..kyoyyyyyyoyk..',
    '..kyyyyyyyyyyk..',
    '..kyyyyywwyyyk..',
    '..kyywwwwwwyyk..',
    '..kyywwkkwwyyk..',
    '..kyywwwwwwyyk..',
    '..kyyyyyyyyyyk..',
    '..kkkkkkkkkkkk..',
  ], { k: K, y: '#d4a017', o: '#a87810', w: '#ffe98a' });
}

// ---------------------------------------------------------------------------
// Props: 16x16, common PropKinds from src/shared/props.ts.
// ---------------------------------------------------------------------------

function buildProps(): void {
  // crate: wooden box with cross brace
  reg('crate', [
    '................',
    '................',
    '...kkkkkkkkkk...',
    '...kbbbbbbbbk...',
    '...kbBbbbbBbk...',
    '...kbkbbbbkbk...',
    '...kbbkbbkbbk...',
    '...kbbbkkbbbk...',
    '...kbbkbbkbbk...',
    '...kbkbbbbkbk...',
    '...kbbbbbbbbk...',
    '...kkkkkkkkkk...',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, b: '#8a6238', B: '#bd8f52' });

  // barrel: wood staves with dark metal bands
  reg('barrel', [
    '................',
    '................',
    '....kkkkkkkk....',
    '...kbbbbbbbbk...',
    '...kbBbbbbBbk...',
    '...kssssssssk...',
    '...kbbbbbbbbk...',
    '...kbBbbbbBbk...',
    '...kbbbbbbbbk...',
    '...kssssssssk...',
    '...kbbbbbbbbk...',
    '....kkkkkkkk....',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, b: '#7a5230', B: '#a87c48', s: '#4a4a52' });

  // pumpkin: ridged orange pumpkin, green stem
  reg('pumpkin', [
    '................',
    '.......kk.......',
    '......kggk......',
    '....kkooooook...',
    '..kooooooooook..',
    '..kokooookokook.',
    '..koOooooooOook.',
    '..kokooookokook.',
    '..kooooooooook..',
    '...kooooooook...',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, o: '#dd7a35', O: '#f5a55e', g: '#3a7b2a' });

  // pot: clay pot with rim
  reg('pot', [
    '................',
    '................',
    '....kkkkkkkk....',
    '...kppppppppk...',
    '...kpPppppPpk...',
    '....kppppppk....',
    '....kppppppk....',
    '....kpPppPpk....',
    '.....kppppk.....',
    '.....kkkkkk.....',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, p: '#a86a42', P: '#d89a68' });

  // mushroom: red cap with white dots, cream stem
  reg('mushroom', [
    '................',
    '................',
    '.....kkkkkk.....',
    '....krrrrrrk....',
    '...krwrrrrwrk...',
    '...krrrrrrrrk...',
    '....krrrrrrk....',
    '.....krrrrk.....',
    '......kssk......',
    '......kssk......',
    '.....kksskk.....',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, r: '#c14a44', w: '#f4f4f4', s: '#e8dcc8' });

  // brazier: fire bowl on a stand
  reg('brazier', [
    '................',
    '......kyk.......',
    '.....kyoyk......',
    '......kyk.......',
    '....kkbbbkk.....',
    '...kbbbbbbbk....',
    '....kbbbbbk.....',
    '.....kbkb.......',
    '.....kbkb.......',
    '....kkbbkk......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, y: '#ffe14d', o: '#ff7a2a', b: '#5a5650' });

  // crystal: blue crystal cluster, white facet glints
  reg('crystal', [
    '................',
    '.......kk.......',
    '......kcck......',
    '......kwcck.....',
    '.....kcccck.....',
    '....kccwccck....',
    '....kcccccck....',
    '.....kcccck.....',
    '.....kcccck.....',
    '......kkkk......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, c: '#6ec8f0', w: '#ffffff' });

  // lantern: dark frame, warm glowing panes
  reg('lantern', [
    '................',
    '................',
    '......kk........',
    '.....kkkk.......',
    '.....kyyk.......',
    '.....kyYyk......',
    '.....kyyk.......',
    '.....kyyk.......',
    '.....kkkk.......',
    '......kk........',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, y: '#ffe98a', Y: '#fff8dc' });

  // cauldron: dark iron pot, bubbling green brew
  reg('cauldron', [
    '................',
    '................',
    '....kkkkkkkk....',
    '...kgGGgggggk...',
    '...kkkkkkkkkk...',
    '...kkkkkkkkkk...',
    '....kkkkkkkk....',
    '....kk..kk......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, g: '#58d86e', G: '#a8f0b8' });

  // bench: wooden bench
  reg('bench', [
    '................',
    '................',
    '................',
    '................',
    '...kkkkkkkkkk...',
    '...kbbbbbbbbk...',
    '...kbBbbbbBbk...',
    '....kbk..kbk....',
    '....kbk..kbk....',
    '....kkk..kkk....',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, b: '#7a5230', B: '#a87c48' });

  // rune stone: grey stone with glowing blue rune
  reg('rune', [
    '................',
    '................',
    '......kkkk......',
    '.....kssssk.....',
    '.....kswssk.....',
    '.....kswssk.....',
    '.....kssssk.....',
    '......kkkk......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, s: '#8a8f98', w: '#6a86ff' });

  // web: spider web
  reg('web', [
    '................',
    '................',
    '..w..w..w..w....',
    '...w.w.w.w......',
    '....wwwwww......',
    '..wwwwwwwwww....',
    '....wwwwww......',
    '...w.w.w.w......',
    '..w..w..w..w....',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { w: '#a8a8c4' });

  // tombstone: grey stone with carved marks, highlight edge
  reg('tombstone', [
    '................',
    '................',
    '.....kkkkkk.....',
    '....kssssssk....',
    '...kSSssssssk...',
    '...kssksskssk...',
    '...kssssssssk...',
    '...kssksskssk...',
    '...kssssssssk...',
    '...kssssssssk...',
    '..kkkkkkkkkkkk..',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { k: K, s: '#8a8d94', S: '#b8bcc2' });
}

// ---------------------------------------------------------------------------
// Pickups: 12x12, LootKind from src/shared/loot.ts.
// ---------------------------------------------------------------------------

function buildLoot(): void {
  // coin: gold galleon with pale glint
  reg('coin', [
    '............',
    '............',
    '....kkkk....',
    '...kyyyyk...',
    '..kyywwyyk..',
    '..kyyyyyyk..',
    '..kyyyyyyk..',
    '..kyywwyyk..',
    '...kyyyyk...',
    '....kkkk....',
    '............',
    '............',
  ], { k: K, y: '#f0c93d', w: '#fff4c8' });

  // mana: blue orb with pale glint
  reg('mana', [
    '............',
    '............',
    '....kkkk....',
    '...kbbbbk...',
    '..kbwbbbbk..',
    '..kwbbbbbk..',
    '..kbbbbbbk..',
    '..kbbbbbbk..',
    '...kbbbbk...',
    '....kkkk....',
    '............',
    '............',
  ], { k: K, b: '#4a7bd4', w: '#cfe4ff' });

  // heart: red heart with pale glint
  reg('heart', [
    '............',
    '............',
    '...kk..kk...',
    '..krrkkrrk..',
    '..krwrrrrk..',
    '..krrrrrrk..',
    '...krrrrk...',
    '....krrk....',
    '.....kk.....',
    '............',
    '............',
    '............',
  ], { k: K, r: '#d94a55', w: '#ffd8dc' });

  // potion: corked bottle, magenta brew, pale glint
  reg('potion', [
    '............',
    '............',
    '.....kk.....',
    '.....kk.....',
    '....kppk....',
    '...kpwppk...',
    '...kppppk...',
    '...kppppk...',
    '....kppk....',
    '....kkkk....',
    '............',
    '............',
  ], { k: K, p: '#c04a92', w: '#f4c8e8' });

  // herb: green sprig with light leaf tips
  reg('herb', [
    '............',
    '............',
    '.....kk.....',
    '....kggk....',
    '...kgGGgk...',
    '....kggk....',
    '.....kk.....',
    '.....kk.....',
    '............',
    '............',
    '............',
    '............',
  ], { k: K, g: '#4a9a4a', G: '#7cc47c' });
}

// ---------------------------------------------------------------------------
// Fallback + public API
// ---------------------------------------------------------------------------

function buildMissing(): void {
  // magenta/black checker = classic missing texture
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 16;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      g.fillStyle = (x + y) % 2 === 0 ? '#ff00ff' : '#000000';
      g.fillRect(x, y, 1, 1);
    }
  }
  cache.set('missing', c);
}

function build(): void {
  if (built) return;
  buildMissing();
  buildWizards();
  buildCreatures();
  buildChests();
  buildProps();
  buildLoot();
  built = true;
}

/**
 * Get a pre-rendered sprite canvas. Unknown kinds return the magenta
 * "missing" tile (and warn once per kind).
 */
const warned = new Set<string>();
export function getSprite(kind: string): HTMLCanvasElement {
  build();
  const s = cache.get(kind);
  if (s) return s;
  if (!warned.has(kind)) {
    warned.add(kind);
    console.warn(`[sprites] unknown kind "${kind}", using fallback`);
  }
  return cache.get('missing')!;
}

/**
 * Draw a sprite centered-ish at (x, y) scaled to w×h, keeping pixels sharp.
 * x, y = top-left corner in canvas pixels.
 */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  kind: string,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(getSprite(kind), x, y, w, h);
}

/** All registered sprite kinds (useful for preloading / tests). */
export function spriteKinds(): string[] {
  build();
  return [...cache.keys()];
}
