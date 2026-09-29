import { HOUSE_COLORS } from './constants.js';

/**
 * Transfiguration of self (变形术): the vocabulary of the `glamour` effect, shared by the checker, the
 * kernel, the grimoire and the 3D client. A wizard's look changes ONLY through a spell — there is no
 * menu and no MCP tool that sets it — so everything here is data a Runes program names.
 */

/** Cloth presets, each with the year (and Restricted-Section seals) it takes and its extra mana. */
export const GLAMOUR_MATERIALS = ['plain', 'velvet', 'silk', 'scales', 'mirror', 'flame', 'starlight', 'ghost'] as const;
export type GlamourMaterial = (typeof GLAMOUR_MATERIALS)[number];

export const MATERIAL_DEFS: Record<GlamourMaterial, { year: number; seals: number; cost: number; doc: string; zh: string }> = {
  plain: { year: 1, seals: 0, cost: 0, doc: 'ordinary wool', zh: '普通呢料' },
  velvet: { year: 1, seals: 0, cost: 4, doc: 'velvet with a soft sheen', zh: '天鹅绒，柔和的绒光' },
  silk: { year: 2, seals: 0, cost: 6, doc: 'acromantula silk: sheen and a lacquered gloss', zh: '八眼巨蛛丝：绒光加一层清漆般的光泽' },
  scales: { year: 3, seals: 0, cost: 8, doc: 'dragon-hide scales that shift colour (iridescence)', zh: '龙皮鳞片，随角度变色' },
  mirror: { year: 4, seals: 0, cost: 10, doc: 'polished like the Mirror of Erised (metal)', zh: '像厄里斯魔镜一样锃亮（金属）' },
  flame: { year: 4, seals: 1, cost: 14, doc: '[First Seal] robes of living fire that flicker (they do not burn)', zh: '【第一道封印】跳动的火焰长袍（不烫人）' },
  starlight: { year: 5, seals: 0, cost: 14, doc: 'the night sky of the Great Hall ceiling, sparkling', zh: '礼堂天花板的夜空，星光闪烁' },
  ghost: { year: 6, seals: 0, cost: 16, doc: 'translucent, like Nearly Headless Nick', zh: '半透明，像差点没头的尼克' },
};

/** The parts a glamour can colour. */
export const GLAMOUR_PARTS = ['robe', 'trim', 'hat', 'skin', 'glow'] as const;
export type GlamourPart = (typeof GLAMOUR_PARTS)[number];
export const PART_DOCS: Record<GlamourPart, { doc: string; zh: string }> = {
  robe: { doc: 'the robe and sleeves', zh: '长袍和袖子' },
  trim: { doc: 'lining, front edges, hem and hat band', zh: '衬里、襟边、下摆和帽带' },
  hat: { doc: 'the pointed hat', zh: '尖顶帽' },
  skin: { doc: 'face and hands', zh: '脸和手' },
  glow: { doc: 'the light at your wand tip', zh: '杖尖的光' },
};

/** A wizard's chosen look. Unset parts show the house defaults. */
export interface Glamour {
  mat: GlamourMaterial;
  robe?: number;
  trim?: number;
  hat?: number;
  skin?: number;
  glow?: number;
}

/** Looks nothing can transfigure you into: [the words, the lore refusal]. */
export const FORBIDDEN_LOOKS: { words: string[]; en: string; zh: string }[] = [
  {
    words: ['invisible', 'invisibility', 'invisibility-shimmer', 'invisibility-cloak', 'cloak', 'cloak-of-invisibility', 'hallows', 'deathly-hallows', 'hallow'],
    en: 'The Cloak of Invisibility is one of the three Deathly Hallows: it cannot be forged, conjured or transfigured — only inherited.',
    zh: '隐形衣是三件死亡圣器之一：不能锻造、不能变出、也不能变形得来——只能继承。',
  },
  {
    words: ['metamorphmagus', 'metamorph', 'tonks'],
    en: 'A Metamorphmagus is born, not made. Change your robes; your face stays your own.',
    zh: '易容马格斯是天生的，学不来。换换袍子吧，脸还是你自己的。',
  },
  {
    words: ['polyjuice', 'polyjuice-potion', 'disguise', 'someone-else'],
    en: 'Polyjuice is a potion, not a charm, and it takes a month to brew. Glamour changes your look, never who you are.',
    zh: '复方汤剂是魔药不是咒语，还得熬一个月。变形术只改变样子，不会让你变成别人。',
  },
  {
    words: ['dementor', 'death-eater', 'dark-mark', 'voldemort'],
    en: 'The Ministry takes a very dim view of dressing up as that. Try another look.',
    zh: '魔法部非常不赞成打扮成那个样子。换一个吧。',
  },
];
export function forbiddenLook(word: string) {
  const w = word.toLowerCase();
  return FORBIDDEN_LOOKS.find((f) => f.words.includes(w)) ?? null;
}

/** Named colours (keywords or strings). House names give the house colour. */
export const NAMED_COLOURS: Record<string, number> = {
  black: 0x111114, white: 0xf4f1ea, ivory: 0xfff4d6, grey: 0x7a7a80, gray: 0x7a7a80, silver: 0xc0c6cc,
  gold: 0xd4af37, bronze: 0xb0793a, copper: 0xb8643a, crimson: 0x9e1b32, scarlet: 0xd1231f, red: 0xc02020,
  rose: 0xe8a0b4, pink: 0xff69b4, plum: 0x5e2750, purple: 0x6a2c91, violet: 0x8f5fd7, lavender: 0xb9a3e3,
  midnight: 0x191970, navy: 0x1b2a55, blue: 0x2a5bd7, sapphire: 0x0f52ba, sky: 0x87ceeb, teal: 0x1f7a7a,
  emerald: 0x1f8a4c, green: 0x2a8a3e, mint: 0x98e0b0, olive: 0x6b6b2a, yellow: 0xecc93a, amber: 0xffbf00,
  orange: 0xe8741e, brown: 0x6b4526, tan: 0xc9a27a, peach: 0xf2c8a0, snow: 0xfffafa, ash: 0x5a5a60,
  // Hogwarts things
  gryffindor: HOUSE_COLORS.Gryffindor, hufflepuff: HOUSE_COLORS.Hufflepuff, ravenclaw: HOUSE_COLORS.Ravenclaw, slytherin: HOUSE_COLORS.Slytherin,
  lumos: 0xfff2a0, patronus: 0xdfefff, 'avada-green': 0x3cff5a, 'weasley-orange': 0xe8741e, 'hagrid-brown': 0x5a3a1e,
  'dumbledore-purple': 0x6a2c91, 'lockhart-lilac': 0xc8a2c8, 'umbridge-pink': 0xf4a6c0, 'snape-black': 0x0c0c10,
};

/** Parse a colour from text: "#rgb", "#rrggbb", "rrggbb" or a named colour. Null if it is not one. */
export function colourFromText(s: string): number | null {
  const t = s.trim().toLowerCase();
  if (t in NAMED_COLOURS) return NAMED_COLOURS[t];
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(t);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return parseInt(h, 16);
}

/** Longest a Colour-Change jinx on someone else lasts. */
export const GLAMOUR_PRANK_MAX_S = 60;
export const GLAMOUR_PRANK_MIN_S = 5;
export const GLAMOUR_PRANK_DEFAULT_S = 30;
/** Casting a glamour on someone else is year-2 magic (like the other jinxes). */
export const GLAMOUR_PRANK_YEAR = 2;
/** Most key/value words one glamour form takes. */
export const GLAMOUR_MAX_ARGS = 16;

const hex6 = (n: number | undefined) => (n === undefined ? '' : n.toString(16).padStart(6, '0'));

/**
 * The compact wire form of a look (the wizard snapshot entry's `g`): "mat:robe:trim:hat:skin:glow"
 * with hex colours and empty fields for house defaults, e.g. "velvet:7a1f2b:d4af37:::". It doubles as
 * the client's material-cache key. Undefined for the plain house look (nothing on the wire).
 */
export function glamourKey(g: Glamour | null | undefined): string | undefined {
  if (!g) return undefined;
  const key = [g.mat, ...GLAMOUR_PARTS.map((p) => hex6(g[p]))].join(':');
  return key === 'plain:::::' ? undefined : key;
}

export function parseGlamourKey(key: string | undefined | null): Glamour | null {
  if (!key) return null;
  const [mat, ...parts] = key.split(':');
  if (!(GLAMOUR_MATERIALS as readonly string[]).includes(mat)) return null;
  const g: Glamour = { mat: mat as GlamourMaterial };
  GLAMOUR_PARTS.forEach((p, i) => {
    const v = parts[i];
    if (v && /^[0-9a-f]{6}$/.test(v)) g[p] = parseInt(v, 16);
  });
  return g;
}

/** Layer `top` over `base` (a jinx's colours over the victim's own look). */
export function overlayGlamour(base: Glamour | null, top: Glamour | null): Glamour | null {
  if (!top) return base;
  if (!base) return top;
  const out: Glamour = { ...base, mat: top.mat === 'plain' ? base.mat : top.mat };
  for (const p of GLAMOUR_PARTS) if (top[p] !== undefined) out[p] = top[p];
  return out;
}

/** Sanitise a stored look (saves are data from disk): unknown material → plain, colours clamped to 24 bits. */
export function cleanGlamour(x: unknown): Glamour | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const mat = (GLAMOUR_MATERIALS as readonly string[]).includes(String(o.mat)) ? (o.mat as GlamourMaterial) : 'plain';
  const g: Glamour = { mat };
  for (const p of GLAMOUR_PARTS) {
    const v = o[p];
    if (typeof v === 'number' && Number.isFinite(v)) g[p] = Math.max(0, Math.min(0xffffff, Math.round(v)));
  }
  return glamourKey(g) ? g : null;
}
