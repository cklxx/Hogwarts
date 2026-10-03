/**
 * 场景道具 (the owner, 2026-09-30: 「屏幕内有用的东西太少……场景物品更加丰富……魔法千变万化但没有好的 showcase」):
 * things on the ground that magic does something to. Crates, barrels, pumpkins and pots break under any hurting spell
 * (a little experience, back in a minute); a Weasley whizbang barrel goes up when fire touches it and sets off what
 * stands near. Braziers take fire, rune stones lightning, basins ice, crystals light: each wakes for a while, and three
 * of a kind woken together (a group) answer with a reward — one clever spell (a fire nova in their middle) does what
 * three bolts do. Shared by the kernel (src/kernel/props.ts: state, rewards) and the browser (client/props3d.ts).
 */
import type { Element } from './constants.js';
import { DRESSING, DRESSING_GROUPS } from './dressing.js';

export type PropKind = 'crate' | 'barrel' | 'pumpkin' | 'pot' | 'whizbang' | 'web' | 'hay' | 'bush' | 'mushroom' | 'ice' | 'brazier' | 'rune' | 'basin' | 'crystal' | 'lantern' | 'cauldron' | 'puddle' | 'lamppost' | 'signpost' | 'bench';
export interface PropDef {
  zh: string; en: string;
  /** Any hurting spell breaks it (back after PROP_RESPAWN_S). */
  breaks?: boolean;
  /** The element that wakes it (or `also`; then it stays awake `secs`). */
  wakes?: Element; also?: Element;
  secs?: number;
  /** The element that puts it out again (a brazier under ice, a basin under fire). */
  quench?: Element;
  /** Fire sets it off: a fire blast of this radius (WHIZBANG_POWER unless `power`) that touches the props in it. */
  blast?: number; power?: number;
  /** Any hurting spell bursts it: a blast of r, `power` of `element` to wild creatures, touching the props in it. */
  pop?: { r: number; power: number; element: Element };
  /** Breaking it always drops this many things (kernel/loot.ts); other breakables drop one now and then. */
  loot?: number;
  /** Woken, it brews a potion (a drop beside it), once a waking. */
  brews?: boolean;
  /** It wets whoever stands within PUDDLE_R (src/shared/chem.ts: a wet zone of its own). */
  wets?: boolean;
  /** Hint for the look-over (MCP look, the hover line). */
  hintZh: string; hintEn: string;
}
export const PROP_DEFS: Record<PropKind, PropDef> = {
  crate: { zh: '木箱', en: 'crate', breaks: true, hintZh: '任何攻击咒都能打碎', hintEn: 'any hurting spell breaks it' },
  barrel: { zh: '木桶', en: 'barrel', breaks: true, hintZh: '任何攻击咒都能打碎', hintEn: 'any hurting spell breaks it' },
  pumpkin: { zh: '南瓜', en: 'pumpkin', breaks: true, hintZh: '海格的南瓜，打碎它', hintEn: "Hagrid's pumpkin: smash it" },
  pot: { zh: '陶罐', en: 'pot', breaks: true, hintZh: '任何攻击咒都能打碎', hintEn: 'any hurting spell breaks it' },
  whizbang: { zh: '韦斯莱烟火桶', en: 'Weasley whizbang barrel', breaks: true, blast: 4, hintZh: '火一碰就炸，炸到旁边的东西和魔物', hintEn: 'fire sets it off: it blasts what stands near' },
  // (a web's blast is its fire running along the strands: the webs it touches burn too, a cluster at once)
  web: { zh: '蛛网', en: 'spider web', breaks: true, blast: 2.6, power: 8, hintZh: '火一碰，连着的蛛网一起烧；任何攻击咒能打掉一片', hintEn: 'fire runs along to the webs it touches; any hurting spell tears one' },
  // (hay and bushes burn like the webs: fire runs from one to the next)
  hay: { zh: '干草堆', en: 'hay bale', breaks: true, blast: 2.4, power: 6, hintZh: '火一碰就烧，连着旁边的干草和灌木', hintEn: 'fire sets it alight, and the hay and bushes by it' },
  bush: { zh: '灌木', en: 'bush', breaks: true, blast: 2.4, power: 6, hintZh: '火一碰就烧，连着旁边的灌木和干草', hintEn: 'fire sets it alight, and the bushes and hay by it' },
  mushroom: { zh: '毒蘑菇', en: 'toadstool', breaks: true, pop: { r: 3, power: 8, element: 'arcane' }, hintZh: '一打就炸出孢子，伤到旁边的魔物，连着炸旁边的蘑菇', hintEn: 'any hit bursts it: spores hurt the creatures round it, and burst the toadstools by it' },
  ice: { zh: '冰块', en: 'ice block', breaks: true, loot: 1, hintZh: '打碎它：里面一定冻着东西', hintEn: 'break it: something is always frozen inside' },
  brazier: { zh: '火盆', en: 'brazier', wakes: 'fire', secs: 40, quench: 'ice', hintZh: '用火点燃；三个同时燃着有奖励', hintEn: 'light it with fire; all three lit at once pays' },
  rune: { zh: '符文石', en: 'rune stone', wakes: 'lightning', secs: 30, hintZh: '用雷电充能；三块同时亮着有奖励', hintEn: 'charge it with lightning; all three at once pays' },
  basin: { zh: '水盆', en: 'basin', wakes: 'ice', secs: 35, quench: 'fire', hintZh: '用冰冻住；三个同时冻着有奖励', hintEn: 'freeze it with ice; all three at once pays' },
  crystal: { zh: '光之水晶', en: 'light crystal', wakes: 'light', secs: 35, hintZh: '用光照亮；三颗同时亮着有奖励', hintEn: 'light it with light; all three at once pays' },
  lantern: { zh: '灯笼', en: 'lantern', wakes: 'fire', also: 'light', secs: 60, quench: 'ice', hintZh: '用火或光点亮；三盏一起亮有奖励', hintEn: 'light it with fire or light; three lit at once pays' },
  cauldron: { zh: '坩埚', en: 'cauldron', wakes: 'fire', secs: 20, brews: true, hintZh: '用火煮：煮出一瓶药水', hintEn: 'heat it with fire: it brews a potion' },
  puddle: { zh: '水洼', en: 'puddle', wets: true, hintZh: '站进去就湿了：湿的挨雷会导电，挨冰会冻住，挨火会蒸发', hintEn: 'step in and you are wet: then lightning conducts, ice freezes, fire steams' },
  lamppost: { zh: '路灯', en: 'lamppost', hintZh: '夜里会自己亮起', hintEn: 'lights itself at night' },
  signpost: { zh: '路牌', en: 'signpost', hintZh: '指着附近的地名', hintEn: 'points to nearby places' },
  bench: { zh: '长椅', en: 'bench', hintZh: '坐下歇会儿', hintEn: 'sit and rest a while' },
};

export interface Prop { id: string; kind: PropKind; x: number; z: number; group?: string }
export interface PropGroup { id: string; zh: string; en: string; kind: PropKind }

/** Back this long after breaking. */
export const PROP_RESPAWN_S = 60;
/** A spell passing this near a prop touches it (a bolt's own reach is 0.45 past its target's radius). */
export const PROP_R = 0.8;
/** Breaking pays this much experience, at most PROP_BREAKS_PER_TERM times a term (RULES: rewards are capped). */
export const PROP_BREAK_XP = 2, PROP_BREAKS_PER_TERM = 50;
/** Waking a prop (lighting a brazier, freezing a basin…) pays this much experience. */
/** A group woken together pays each wizard who woke one of its three (within its window) this, once a term. */
export const PROP_GROUP_XP = 25, PROP_GROUP_GALLEONS = 2;
/** A whizbang's blast hurts wild creatures this much (fire). */
export const WHIZBANG_POWER = 18;
/** A fire hit on anyone standing this near a prop that fire sets off (a whizbang, a web) sets it off too: sparks.
 *  (A whizbang's own reach: every spot Zonko's pixies are born on is within it of a barrel, kernel/creatures.ts.) */
export const IGNITE_R = 4;

const HAND_GROUPS: readonly PropGroup[] = [
  { id: 'dungeon-fire', zh: '地窖火盆', en: 'the dungeon braziers', kind: 'brazier' },
  { id: 'willow-runes', zh: '打人柳旁的符文石', en: 'the rune stones by the Willow', kind: 'rune' },
  { id: 'tomb-light', zh: '白色墓前的水晶', en: 'the crystals by the white tomb', kind: 'crystal' },
  { id: 'clock-ice', zh: '钟楼下的水盆', en: 'the basins under the Clock Tower', kind: 'basin' },
  { id: 'lake-ice', zh: '湖边的水盆', en: 'the lakeside basins', kind: 'basin' },
  { id: 'forest-runes', zh: '禁林的符文石', en: 'the forest rune stones', kind: 'rune' },
  { id: 'glade-light', zh: '独角兽林间的水晶', en: 'the crystals of the unicorn glade', kind: 'crystal' },
  { id: 'village-fire', zh: '霍格莫德广场的火盆', en: 'the Hogsmeade square braziers', kind: 'brazier' },
  { id: 'pitch-fire', zh: '球场看台的火盆', en: 'the pitch braziers', kind: 'brazier' },
];

const at = (id: string, kind: PropKind, x: number, z: number, group?: string): Prop => ({ id, kind, x, z, ...(group ? { group } : {}) });
/** The hand-placed props (scripts/dress.ts scatters the rest round them, src/shared/dressing.ts). */
export const HAND_PROPS: readonly Prop[] = [
  // the castle: the south lawn's crates, the greenhouse pots and pumpkins, and four groups
  at('lawn-1', 'crate', -8, 6), at('lawn-2', 'crate', -6.5, 7.5), at('lawn-3', 'barrel', -9.5, 8), at('lawn-4', 'crate', 18, 4), at('lawn-5', 'barrel', 19.5, 5.5),
  at('gh-1', 'pot', 30.5, -37), at('gh-2', 'pot', 35, -34.5), at('gh-3', 'pumpkin', 51.5, -38), at('gh-4', 'pumpkin', 51.5, -36), at('gh-5', 'pot', 30, -22),
  at('dun-1', 'brazier', -40, -27, 'dungeon-fire'), at('dun-2', 'brazier', -37, -23, 'dungeon-fire'), at('dun-3', 'brazier', -43, -23, 'dungeon-fire'),
  at('dun-4', 'pot', -44, -30), at('dun-5', 'pot', -36, -30),
  at('wil-1', 'rune', 30, 10, 'willow-runes'), at('wil-2', 'rune', 33, 13, 'willow-runes'), at('wil-3', 'rune', 27, 13, 'willow-runes'),
  at('tomb-1', 'crystal', -44, 20, 'tomb-light'), at('tomb-2', 'crystal', -41, 23, 'tomb-light'), at('tomb-3', 'crystal', -47, 23, 'tomb-light'),
  at('clk-1', 'basin', 60, -48, 'clock-ice'), at('clk-2', 'basin', 63, -45, 'clock-ice'), at('clk-3', 'basin', 57, -45, 'clock-ice'),
  at('yard-1', 'whizbang', -30, -12), at('yard-2', 'crate', -32, -10), at('yard-3', 'whizbang', 30, -12), at('yard-4', 'crate', 32, -14),
  // the lake: the shore's basins and the boathouse crates
  at('lake-1', 'basin', -80, 45, 'lake-ice'), at('lake-2', 'basin', -77, 48, 'lake-ice'), at('lake-3', 'basin', -83, 48, 'lake-ice'),
  at('lake-4', 'crate', -78, 22), at('lake-5', 'barrel', -76, 24), at('lake-6', 'crate', -79, 5), at('lake-7', 'whizbang', -74, 30),
  // the forest: Hagrid's pumpkin patch, the rune stones on the trail, the glade's crystals
  at('hag-1', 'pumpkin', 100, 24), at('hag-2', 'pumpkin', 102, 26), at('hag-3', 'pumpkin', 99, 25), at('hag-4', 'pumpkin', 104, 23), at('hag-5', 'crate', 91.5, 35.5),
  at('fr-1', 'rune', 125, 10, 'forest-runes'), at('fr-2', 'rune', 128, 13, 'forest-runes'), at('fr-3', 'rune', 122, 13, 'forest-runes'),
  at('gl-1', 'crystal', 112, -4, 'glade-light'), at('gl-2', 'crystal', 115, -1, 'glade-light'), at('gl-3', 'crystal', 108.5, 0, 'glade-light'),
  at('fr-4', 'pot', 118, 30), at('fr-5', 'crate', 140, 20),
  // the acromantula nest (src/shared/encounters.ts): three clusters of webs, each burning as one
  at('web-1', 'web', 136, 31), at('web-2', 'web', 138, 31.5), at('web-3', 'web', 137, 33.4),
  at('web-4', 'web', 144, 37), at('web-5', 'web', 146, 37.5), at('web-6', 'web', 145, 39.4),
  at('web-7', 'web', 133, 41), at('web-8', 'web', 135, 41.5), at('web-9', 'web', 134, 43.4),
  // the pitch: crates by the stands, braziers at the entrance, whizbangs for the fans
  at('pt-1', 'brazier', 42, -130, 'pitch-fire'), at('pt-2', 'brazier', 45, -127, 'pitch-fire'), at('pt-3', 'brazier', 39, -127, 'pitch-fire'),
  at('pt-4', 'crate', 66, -140), at('pt-5', 'crate', 67, -142), at('pt-6', 'whizbang', 20, -140), at('pt-7', 'whizbang', 21, -143),
  // Hogsmeade: barrels outside the Three Broomsticks, Zonko's whizbangs, braziers in the square
  at('hm-1', 'barrel', -14.5, 160), at('hm-2', 'barrel', -16.5, 163.5), at('hm-3', 'barrel', -18.5, 163.5), at('hm-4', 'whizbang', 15.5, 148.5), at('hm-5', 'whizbang', 17, 148.5),
  at('hm-6', 'brazier', 0, 180, 'village-fire'), at('hm-7', 'brazier', 3, 183, 'village-fire'), at('hm-8', 'brazier', -3, 183, 'village-fire'),
  at('hm-9', 'crate', 30, 145), at('hm-10', 'pot', 40, 190),
  // Zonko's yard (src/shared/encounters.ts): a row of whizbangs close enough that one sets off the next
  at('zk-1', 'whizbang', 8, 139), at('zk-2', 'whizbang', 10.8, 139), at('zk-3', 'whizbang', 13.6, 139), at('zk-4', 'whizbang', 16.4, 139), at('zk-5', 'whizbang', 19.2, 139),
];
/** Every prop (positions checked by test/props.test.ts: open ground inside a scene, out of the safe zones). */
export const PROPS: readonly Prop[] = [...HAND_PROPS, ...DRESSING];
export const PROP_GROUPS: readonly PropGroup[] = [...HAND_GROUPS, ...DRESSING_GROUPS];
export const propById = (id: string) => PROPS.find((p) => p.id === id) ?? null;
