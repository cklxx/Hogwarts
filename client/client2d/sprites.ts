/**
 * client2d/sprites.ts — procedural pixel-art sprites for the 2D canvas renderer.
 *
 * Every sprite is pre-rendered once onto an offscreen canvas at init; the main
 * loop only calls drawImage (no per-frame canvas ops). Pixel art is authored as
 * string grids so shapes stay reviewable in a diff. Renderers must draw with
 * imageSmoothingEnabled = false to keep pixels sharp (see drawSprite below).
 *
 * Kinds:
 *   wizard-<house>      16x24 robed figure, house colours (Gryffindor/Hufflepuff/Ravenclaw/Slytherin)
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
// Wizards: 16x24 robed figures, house primary + trim colours.
// Primary colours from HOUSE_COLORS (src/shared/constants.ts).
// ---------------------------------------------------------------------------

const WIZARD_BASE: readonly string[] = [
  '.......hh.......',
  '......hhhh......',
  '......hhhh......',
  '.....hhhhhh.....',
  '.....hhhhhh.....',
  '....hhhhhhhh....',
  '.....ssssss.....',
  '.....skssks.....',
  '.....ssssss.....',
  '......ssss......',
  '....tttttttt....',
  '...hhhhhhhhhh...',
  '...hthhhhhhth...',
  '...hhhhhhhhhh...',
  '...hhhhhhhhhh...',
  '...hhhhhhhhhh...',
  '...hhhhhhhhhh...',
  '...hhhhhhhhhh...',
  '...hhhhhhhhhh...',
  '...hhhhhhhhhh...',
  '....hhhhhhhh....',
  '....kk....kk....',
  '....kk....kk....',
  '................',
];

const WIZARD_TRIMS: Record<string, { h: string; t: string }> = {
  gryffindor: { h: '#ae0001', t: '#d4a017' }, // red + gold
  slytherin: { h: '#2a8a3e', t: '#c0c0c0' }, // green + silver
  ravenclaw: { h: '#2a5bd7', t: '#b87333' }, // blue + copper
  hufflepuff: { h: '#ecb939', t: '#222222' }, // yellow + black
};

function buildWizards(): void {
  const skin = { s: '#f2c89b', k: '#1a1a1a' };
  for (const [house, c] of Object.entries(WIZARD_TRIMS)) {
    reg(`wizard-${house}`, WIZARD_BASE, { ...skin, h: c.h, t: c.t });
  }
  // generic / unknown house
  reg('wizard', WIZARD_BASE, { ...skin, h: '#5a4a8a', t: '#c0c0c0' });
}

// ---------------------------------------------------------------------------
// Creatures: 16x16, silhouette-first. One per CreatureKind.
// ---------------------------------------------------------------------------

const K = '#1a1a1a'; // near-black outline/body

function buildCreatures(): void {
  // pixie: electric blue, wings
  reg('pixie', [
    '................',
    '..w........w....',
    '..ww..bb..ww....',
    '...wwbbbbww.....',
    '....wbyybw......',
    '.....bbbb.......',
    '......bb........',
    '.....b..b.......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { b: '#3a7bff', y: '#ffe14d', w: '#cfe4ff' });

  // snare: dark green tentacle mound
  reg('snare', [
    '................',
    '................',
    '.....g..g.......',
    '....ggg.gg......',
    '....gggggg......',
    '..gggggggggg....',
    '.gggggggggggg...',
    '.gggggggggggg...',
    '..gggggggggg....',
    '...gggggggg.....',
    '....gggggg......',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { g: '#1e6b2a' });

  // spider: black, 8 legs
  reg('spider', [
    '................',
    '................',
    '.k..........k...',
    '..k..kkkk..k....',
    '...k.kkkk.k.....',
    '....kkkkkk......',
    '.k..kkkkkk..k...',
    '..kkkkkkkkkk....',
    '..kkkkkkkkkk....',
    '.k..kkkkkk..k...',
    '....kkkkkk......',
    '...k.kkkk.k.....',
    '..k..kkkk..k....',
    '.k..........k...',
    '................',
    '................',
  ], { k: K });

  // aragog: bigger, darker spider with red eyes
  reg('aragog', [
    'k............k..',
    '.k....kkkk..k...',
    '..k.kkkkkkkk....',
    '..kkkkkkkkkkk...',
    '.kkkrkkkkrkkkk..',
    '.kkkkkkkkkkkkk..',
    '..kkkkkkkkkkk...',
    '.k.kkkkkkkkk.k..',
    'k..kkkkkkkkk..k.',
    '...kk.kkkk.k....',
    '..k...kkkk...k..',
    '.k....kkkk....k.',
    '................',
    '................',
    '................',
    '................',
  ], { k: '#0d0d0d', r: '#ff2a2a' });

  // troll: grey brute
  reg('troll', [
    '................',
    '.....gggggg.....',
    '....gggggggg....',
    '....gkggkggg....',
    '....gggggggg....',
    '.....gggggg.....',
    '..ggggggggggg...',
    '..ggggggggggg...',
    '..ggggggggggg...',
    '...ggggggggg....',
    '...ggg...ggg....',
    '...ggg...ggg....',
    '................',
    '................',
    '................',
    '................',
  ], { g: '#8a8f98', k: K });

  // dementor: grey floating cloak
  reg('dementor', [
    '................',
    '.....gggggg.....',
    '....gggggggg....',
    '....ggkggkgg....',
    '....gggggggg....',
    '....gggggggg....',
    '.....gggggg.....',
    '.....gggggg.....',
    '....gggggggg....',
    '....gggggggg....',
    '...gggggggggg...',
    '...gg.gggg.gg...',
    '................',
    '................',
    '................',
    '................',
  ], { g: '#5a5f6b', k: '#0a0a0a' });

  // lethifold: darker cloak, no face
  reg('lethifold', [
    '................',
    '......kkkk......',
    '....kkkkkkkk....',
    '....kkkkkkkk....',
    '....kkkkkkkk....',
    '.....kkkkkk.....',
    '.....kkkkkk.....',
    '....kkkkkkkk....',
    '....kkkkkkkk....',
    '...kkkkkkkkkk...',
    '...kkk.kkkk.....',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { k: '#050505' });

  // inferius: pale corpse
  reg('inferius', [
    '................',
    '.....pppppp.....',
    '....pppppppp....',
    '....pkkppkpp....',
    '....pppppppp....',
    '.....pppppp.....',
    '....pppppppp....',
    '....pbppbppp....',
    '....pppppppp....',
    '....pppppppp....',
    '.....pp..pp.....',
    '.....pp..pp.....',
    '................',
    '................',
    '................',
    '................',
  ], { p: '#b9c4c9', k: K, b: '#4a6b8a' });

  // unicorn: white horse + gold horn
  reg('unicorn', [
    '................',
    '........y.......',
    '.......yw.......',
    '......wwww......',
    '......wkw.......',
    '......wwww......',
    '.....wwwwww.....',
    '..wwwwwwwwww....',
    '.wwwwwwwwwwww...',
    '.wwwwwwwwwwww...',
    '..www.www.www...',
    '..ww..ww...ww...',
    '................',
    '................',
    '................',
    '................',
  ], { w: '#f4f4f4', k: K, y: '#ffd94d' });

  // thestral: black skeletal winged horse
  reg('thestral', [
    '................',
    '....kkk...kk....',
    '....kkkkkkkk....',
    '.....krkk.......',
    '.....kkkk.......',
    '...kkkkkkkk.....',
    '.kkkkkkkkkkkk...',
    '.kkkkkkkkkkkk...',
    '..kkk.kkk.kk....',
    '..kk..kk...k....',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { k: '#111114', r: '#e8e8e8' });

  // hippogriff: brown eagle-horse
  reg('hippogriff', [
    '................',
    '.......yy.......',
    '......bbbb......',
    '......bkb.......',
    '......bbbb......',
    '.....bbbbbb.....',
    '..bbbbbbbbbb....',
    '.bbbbbbbbbbbb...',
    '.bbbbbbbbbbbb...',
    '..bbb.bbb.bb....',
    '..bb...bb.......',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { b: '#8a5a2a', k: K, y: '#e8a93d' });

  // phoenix: red-orange bird
  reg('phoenix', [
    '................',
    '.....rr.........',
    '....rrrr..oo....',
    '....rkrroooo....',
    '....rrrroooo....',
    '.....rroooo.....',
    '......roo.......',
    '.....rrr........',
    '....rr.rr.......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { r: '#e83a1a', o: '#ff9a2a', k: K });

  // thunderbird: yellow-blue lightning bird
  reg('thunderbird', [
    '................',
    '..y........y....',
    '..yy..yy..yy....',
    '...yyyyyyyy.....',
    '....ykyyy.......',
    '.....yyy........',
    '....yyyyy.......',
    '...yybybyy......',
    '..yy.....yy.....',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { y: '#ffe14d', b: '#3a7bff', k: K });

  // bowtruckle: brown twig
  reg('bowtruckle', [
    '................',
    '......b.........',
    '.....bb.........',
    '....bbkb........',
    '.....bb.........',
    '....bbbb........',
    '.....bb.........',
    '....b..b........',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { b: '#6b4a2a', k: K });

  // hinkypunk: dark wisp with lantern
  reg('hinkypunk', [
    '................',
    '................',
    '.....kkkk.......',
    '....kkkkkk......',
    '....kkyykk......',
    '....kkyykk......',
    '....kkkkkk......',
    '.....kkkk.......',
    '......kk........',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { k: '#2a2a3a', y: '#ffe98a' });

  // redcap: red cap, dark body
  reg('redcap', [
    '................',
    '.....rrrr.......',
    '....rrrrrr......',
    '....rrrrrr......',
    '.....kkkk.......',
    '.....kkkk.......',
    '....kkkkkk......',
    '....kkkkkk......',
    '.....k..k.......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { r: '#c81a1a', k: '#2a2a2a' });

  // niffler: dark with gold pouch
  reg('niffler', [
    '................',
    '................',
    '.....kkkk.......',
    '....kkkkkk......',
    '....kkkkkk......',
    '.....kkkk.......',
    '....kyyyk.......',
    '....kyyyk.......',
    '.....kkkk.......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { k: '#3a3a4a', y: '#ffd94d' });

  // grindylow: green horned water demon
  reg('grindylow', [
    '................',
    '....y....y......',
    '.....gggg.......',
    '....gggggg......',
    '....gkggkg......',
    '....gggggg......',
    '.....gggg.......',
    '....gggggg......',
    '.....g..g.......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { g: '#2a8a5a', k: K, y: '#e8e8e8' });

  // erkling: green goblin
  reg('erkling', [
    '................',
    '................',
    '.....gggg.......',
    '....gggggg......',
    '....gkggkg......',
    '....gggggg......',
    '.....gggg.......',
    '....gggggg......',
    '.....g..g.......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { g: '#4a9a3a', k: K });

  // kelpie: dark water horse
  reg('kelpie', [
    '................',
    '.......bb.......',
    '......bbbb......',
    '......bkb.......',
    '......bbbb......',
    '.....bbbbbb.....',
    '..bbbbbbbbbb....',
    '.bbbbbbbbbbbb...',
    '..bbb.bbb.......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { b: '#1a3a4a', k: K });

  // occamy: teal serpent-bird
  reg('occamy', [
    '................',
    '.....tt.........',
    '....tttt........',
    '....tkt.........',
    '....tttt........',
    '.....ttt........',
    '.....tttt.......',
    '......tttt......',
    '.......ttt......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { t: '#2a9a9a', k: K });

  // boggart: shifting dark blob with ?
  reg('boggart', [
    '................',
    '................',
    '....kkkkkk......',
    '...kkkkkkkk.....',
    '...kkwwwwkk.....',
    '...kkwkwkk......',
    '...kkwwwwkk.....',
    '...kkkkkkkk.....',
    '....kkkkkk......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { k: '#3a2a4a', w: '#e8e8e8' });

  // runespoor: three-headed snake
  reg('runespoor', [
    '................',
    '...g..g..g......',
    '...gg.gg.gg.....',
    '...gggggggg.....',
    '....gggggg......',
    '....gggggg......',
    '.....gggg.......',
    '.....gggg.......',
    '......gg........',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { g: '#3a7b3a' });

  // skrewt: armoured scorpion
  reg('skrewt', [
    '................',
    '................',
    '.....aaaa.......',
    '....aaaaaa......',
    '...aaaaaaaa.....',
    '..aaaaaaaaaa....',
    '..aakaaakaak....',
    '..aaaaaaaaaa....',
    '...aa.aa.aa.....',
    '.........s......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { a: '#7a5a3a', k: K, s: '#c81a1a' });

  // werewolf: grey wolf humanoid
  reg('werewolf', [
    '................',
    '....w....w......',
    '....wwwwww......',
    '....wkwkw.......',
    '....wwwwww......',
    '.....wwww.......',
    '....wwwwww......',
    '....wwwwww......',
    '.....w..w.......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { w: '#7a7f8a', k: K });

  // manticore: red lion-scorpion
  reg('manticore', [
    '................',
    '.....rrrr.......',
    '....rrrrrr......',
    '....rkrkrr......',
    '....rrrrrr......',
    '.....rrrr.......',
    '....rrrrrr......',
    '...rrrrrrrr.s...',
    '....rr..rr..s...',
    '.............s..',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { r: '#a83a2a', k: K, s: '#5a2a1a' });

  // chimera: three-part beast (lion head, goat body, snake tail)
  reg('chimera', [
    '................',
    '.....oooo.......',
    '....oooooo......',
    '....okokoo..g...',
    '....ooooooggg...',
    '.....ooooggg....',
    '....oooooogg....',
    '.....oo..o......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { o: '#c88a3a', k: K, g: '#4a7a3a' });

  // basilisk: green giant serpent
  reg('basilisk', [
    '................',
    '....gggg........',
    '...gggggg.......',
    '...gygygg.......',
    '...gggggg.......',
    '....gggg........',
    '....ggggg.......',
    '.....ggggg......',
    '......gggg......',
    '.......gg.......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { g: '#2a7b2a', y: '#ffe14d' });

  // nundu: grey leopard
  reg('nundu', [
    '................',
    '................',
    '.....nnnn.......',
    '....nnnnnn......',
    '....nknknn......',
    '....nnnnnn......',
    '.....nnnn.......',
    '....nnnnnn......',
    '.....nn.nn......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { n: '#8a8a8a', k: K });

  // dragon: red, wings spread
  reg('dragon', [
    '................',
    '.rr........rr...',
    '.rrr......rrr...',
    '.rrrr.rr.rrrr...',
    '..rrrrrrrrrr....',
    '...rrrrrrrr.....',
    '....rryyrr......',
    '....rrrrrr......',
    '.....rrrr.......',
    '.....rrrr.......',
    '......rr........',
    '......rr........',
    '................',
    '................',
    '................',
    '................',
  ], { r: '#c81a1a', y: '#ffe14d' });

  // serpent (summon): simple green snake
  reg('serpent', [
    '................',
    '................',
    '....gg..........',
    '...gggg.........',
    '...gkgg.........',
    '...gggg.........',
    '....gggg........',
    '.....gggg.......',
    '......ggg.......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { g: '#3a9a3a', k: K });

  // birds (summon): small blue birds
  reg('birds', [
    '................',
    '................',
    '..b......b......',
    '.bbb....bbb.....',
    '.bkb....bkb.....',
    '.bbb....bbb.....',
    '..b......b......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { b: '#5a9ae8', k: K });
}

// ---------------------------------------------------------------------------
// Chests: 16x12.
// ---------------------------------------------------------------------------

function buildChests(): void {
  // plain wooden chest
  reg('chest', [
    '................',
    '................',
    '..bbbbbbbbbbbb..',
    '..bybbbbbbbybb..',
    '..bbbbbbbbbbbb..',
    '..bbbbyyybbbbb..',
    '..bbbyyyyyybbb..',
    '..bbbyykkybbb...',
    '..bbbyyyyyybbb..',
    '..bbbbbbbbbbbb..',
    '..bbbbbbbbbbbb..',
    '................',
  ], { b: '#7a5230', y: '#d4a017', k: K });
  // ornate gold chest
  reg('chest-gold', [
    '................',
    '................',
    '..yyyyyyyyyyyy..',
    '..yoyyyyyyyoyy..',
    '..yyyyyyyyyyyy..',
    '..yyyywwyyyyyy..',
    '..yywwwwwwyyyy..',
    '..yywwkkwwyyyy..',
    '..yywwwwwwyyyy..',
    '..yyyyyyyyyyyy..',
    '..yyyyyyyyyyyy..',
    '................',
  ], { y: '#d4a017', o: '#a87810', w: '#ffe98a', k: K });
}

// ---------------------------------------------------------------------------
// Props: 16x16, common PropKinds from src/shared/props.ts.
// ---------------------------------------------------------------------------

function buildProps(): void {
  // crate: wooden box
  reg('crate', [
    '................',
    '................',
    '...bbbbbbbbbb...',
    '...bkkkkkkkkb...',
    '...bkbkkkkbkb...',
    '...bkkbbbbkkb...',
    '...bkkbbbbkkb...',
    '...bkbkkkkbkb...',
    '...bkkkkkkkkb...',
    '...bbbbbbbbbb...',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { b: '#8a6238', k: '#5a3e22' });

  // barrel
  reg('barrel', [
    '................',
    '................',
    '....bbbbbbbb....',
    '...bbbbbbbbbb...',
    '...bbssssssbb...',
    '...bbbbbbbbbb...',
    '...bbbbbbbbbb...',
    '...bbssssssbb...',
    '...bbbbbbbbbb...',
    '....bbbbbbbb....',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { b: '#7a5230', s: '#4a3018' });

  // pumpkin
  reg('pumpkin', [
    '................',
    '................',
    '.......g........',
    '....oooooooo....',
    '...oooooooooo...',
    '...okokookoo....',
    '...oooooooooo...',
    '...oooooooooo...',
    '....oooooooo....',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { o: '#e8762a', k: K, g: '#3a7b2a' });

  // pot: clay pot
  reg('pot', [
    '................',
    '................',
    '....pppppppp....',
    '....pppppppp....',
    '.....pppppp.....',
    '.....pppppp.....',
    '.....pppppp.....',
    '......pppp......',
    '......pppp......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { p: '#a85a32' });

  // mushroom
  reg('mushroom', [
    '................',
    '................',
    '.....rrrrrr.....',
    '....rwwrrwrr....',
    '....rrrrrrrr....',
    '.....rrrrrr.....',
    '.......ss.......',
    '.......ss.......',
    '.......ss.......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { r: '#c83a3a', w: '#f4f4f4', s: '#e8dcc8' });

  // brazier: fire bowl
  reg('brazier', [
    '................',
    '................',
    '......yy........',
    '.....yory.......',
    '......yy........',
    '....bbbbbb......',
    '.....bbbb.......',
    '......bb........',
    '......bb........',
    '.....bbbb.......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { y: '#ffe14d', o: '#ff7a2a', r: '#e83a1a', b: '#5a5a5a' });

  // crystal
  reg('crystal', [
    '................',
    '.......cc.......',
    '......cccc......',
    '......cwwc......',
    '.....cccccc.....',
    '.....cwwccc.....',
    '......cccc......',
    '......cccc......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { c: '#7ad4ff', w: '#ffffff' });

  // lantern
  reg('lantern', [
    '................',
    '................',
    '......kk........',
    '.....kkkk.......',
    '.....kyyk.......',
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
    '................',
  ], { k: K, y: '#ffe98a' });

  // cauldron
  reg('cauldron', [
    '................',
    '................',
    '.....kkkkkk.....',
    '....kggggk......',
    '....kkkkkk......',
    '....kkkkkk......',
    '.....kkkk.......',
    '.....k..k.......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { k: '#2a2a2a', g: '#5aff7a' });

  // bench
  reg('bench', [
    '................',
    '................',
    '................',
    '................',
    '...bbbbbbbbbb...',
    '...bbbbbbbbbb...',
    '....b......b....',
    '....b......b....',
    '....b......b....',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { b: '#7a5230' });

  // rune stone
  reg('rune', [
    '................',
    '................',
    '......ssss......',
    '.....ssssss.....',
    '.....swwsss.....',
    '.....swssss.....',
    '.....ssssss.....',
    '......ssss......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { s: '#8a8f98', w: '#5a7bff' });

  // web (spider web prop)
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
  ], { w: '#d8d8e8' });

  // tombstone: grey stone (战后世界 kernel/aftermath.ts)
  reg('tombstone', [
    '................',
    '................',
    '.....gggggg.....',
    '....gggggggg....',
    '....ggkggkgg....',
    '....gggggggg....',
    '....ggkggkgg....',
    '....gggggggg....',
    '....gggggggg....',
    '.....gggggg.....',
    '...gggggggggg...',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { g: '#8a8d94', k: K });
}

// ---------------------------------------------------------------------------
// Pickups: 12x12, LootKind from src/shared/loot.ts.
// ---------------------------------------------------------------------------

function buildLoot(): void {
  // coin: gold galleon
  reg('coin', [
    '............',
    '............',
    '....yyyy....',
    '...yyyyyy...',
    '...ywyyyy...',
    '...yyyyyy...',
    '...yyyyyy...',
    '....yyyy....',
    '............',
    '............',
    '............',
    '............',
  ], { y: '#ffd94d', w: '#fff4c8' });

  // mana: blue orb
  reg('mana', [
    '............',
    '............',
    '....bbbb....',
    '...bwwbbb...',
    '...wbbbbb...',
    '...bbbbbb...',
    '...bbbbbb...',
    '....bbbb....',
    '............',
    '............',
    '............',
    '............',
  ], { b: '#3a7bff', w: '#cfe4ff' });

  // heart: red heart
  reg('heart', [
    '............',
    '............',
    '...rr..rr...',
    '...rrrrrr...',
    '...rrrrrr...',
    '....rrrr....',
    '.....rr.....',
    '............',
    '............',
    '............',
    '............',
    '............',
  ], { r: '#e83a4a' });

  // potion: bottle
  reg('potion', [
    '............',
    '............',
    '.....kk.....',
    '.....kk.....',
    '....pppp....',
    '....pwwp....',
    '....pppp....',
    '....pppp....',
    '.....pp.....',
    '............',
    '............',
    '............',
  ], { k: '#8a6238', p: '#c83a8a', w: '#f4c8e8' });

  // herb: green sprig
  reg('herb', [
    '............',
    '............',
    '.....g......',
    '....ggg.....',
    '...ggggg....',
    '....ggg.....',
    '.....g......',
    '............',
    '............',
    '............',
    '............',
    '............',
  ], { g: '#3a9a3a' });
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
