/**
 * client2d/chars.ts — 工业化人物 sprite 系统 v1。
 *
 * 取代 sprites.ts 里 16x24 单面 wizard。新规范：
 *   - 尺寸：学生/教授/商人 24x36（头:身 = 1:2），海格 30x46，家养小精灵 16x28
 *   - 四方向：down / up / left / right（left = right 镜像）
 *   - 行走：每方向 base + w0（跨步）+ w1（并步）
 *   - 全部预渲染到 offscreen canvas，运行时只 drawImage
 *   - 风格：1px #2a1f1a 描边，光源左上，base/shadow/highlight 三层
 *
 * Key 命名：char-{variant}-{house?}-{dir}[-w0|-w1]
 *   variant: student | professor | merchant | hagrid | elf
 *   house（仅 student）: gryffindor | slytherin | ravenclaw | hufflepuff
 */

export const CHAR_OUTLINE = '#2a1f1a';

export type CharDir = 'down' | 'up' | 'left' | 'right';
export type CharVariant = 'student' | 'professor' | 'merchant' | 'hagrid' | 'elf';

interface CharPal {
  robe: string; robeHi: string; robeDark: string;
  trim: string; trimHi: string;
  skin: string; skinHi: string;
  hair: string; hairHi: string;
  boot: string; bootDark: string;
  extra: string; extraHi: string; // variant-specific: beard/apron/coat...
}

const SKIN = '#f0c49a', SKIN_HI = '#f9dcb8';

const HOUSE_ROBES: Record<string, { robe: string; robeHi: string; robeDark: string; trim: string; trimHi: string }> = {
  gryffindor: { robe: '#a83a32', robeHi: '#cf6a5e', robeDark: '#732420', trim: '#d9a441', trimHi: '#f2cd7d' },
  slytherin: { robe: '#2e7a3c', robeHi: '#57a866', robeDark: '#1e5427', trim: '#c3ccd4', trimHi: '#eef2f5' },
  ravenclaw: { robe: '#3a5cad', robeHi: '#6f92d6', robeDark: '#26427e', trim: '#c08a4a', trimHi: '#e0b075' },
  hufflepuff: { robe: '#d9a441', robeHi: '#f2cd7d', robeDark: '#9c7226', trim: '#4a4038', trimHi: '#6f6257' },
};

function studentPal(house: string): CharPal {
  const h = HOUSE_ROBES[house] ?? HOUSE_ROBES['gryffindor']!;
  return {
    robe: h.robe, robeHi: h.robeHi, robeDark: h.robeDark,
    trim: h.trim, trimHi: h.trimHi,
    skin: SKIN, skinHi: SKIN_HI,
    hair: '#4a3220', hairHi: '#6e4f30',
    boot: '#3a2c22', bootDark: '#241a14',
    extra: h.robeDark, extraHi: h.robe,
  };
}

const PROFESSOR_PAL: CharPal = {
  robe: '#2c2c44', robeHi: '#45456a', robeDark: '#1a1a2a',
  trim: '#8a7a4a', trimHi: '#b5a56e',
  skin: SKIN, skinHi: SKIN_HI,
  hair: '#c9c9c9', hairHi: '#efefef',
  boot: '#2a2018', bootDark: '#171008',
  extra: '#b9b9b9', extraHi: '#e8e8e8', // long grey beard
};

const MERCHANT_PAL: CharPal = {
  robe: '#6e5a3a', robeHi: '#93774e', robeDark: '#4a3c26',
  trim: '#d9d9d9', trimHi: '#ffffff',
  skin: SKIN, skinHi: SKIN_HI,
  hair: '#7a4a22', hairHi: '#a06a3a',
  boot: '#3a2c22', bootDark: '#241a14',
  extra: '#8a6a3a', extraHi: '#ab8a4e', // apron
};

const HAGRID_PAL: CharPal = {
  robe: '#5a4a33', robeHi: '#7a6547', robeDark: '#3c3122',
  trim: '#2a2018', trimHi: '#4a3c2a',
  skin: SKIN, skinHi: SKIN_HI,
  hair: '#2e2018', hairHi: '#4a382a',
  boot: '#2a2018', bootDark: '#171008',
  extra: '#2e2018', extraHi: '#4a382a', // beard mass
};

const ELF_PAL: CharPal = {
  robe: '#9a8a72', robeHi: '#b5a58c', robeDark: '#6e6050',
  trim: '#5a4c3c', trimHi: '#7a6c5c',
  skin: '#d8b48e', skinHi: '#f0d0a8',
  hair: '#5a4a3a', hairHi: '#7a6a5a',
  boot: '#4a3c2c', bootDark: '#2e241a',
  extra: '#9a8a72', extraHi: '#b5a58c',
};

// ------------------------------------------------------------------ canvas helpers

const cache = new Map<string, HTMLCanvasElement>();
let built = false;

function cv(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}

/** Fill rect in design px. */
function R(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string): void {
  g.fillStyle = col;
  g.fillRect(x, y, w, h);
}

function flipH(src: HTMLCanvasElement): HTMLCanvasElement {
  const [c, g] = cv(src.width, src.height);
  g.save();
  g.translate(src.width, 0);
  g.scale(-1, 1);
  g.drawImage(src, 0, 0);
  g.restore();
  return c;
}

// ------------------------------------------------------------------ STUDENT 24x36
// 头 y0-11，身体 y12-35。walk: 0=站立 1=跨步 2=并步

function studentFront(p: CharPal, walk: 0 | 1 | 2): HTMLCanvasElement {
  const [c, g] = cv(24, 36);
  const k = CHAR_OUTLINE;
  // -- hood mass
  R(g, 9, 0, 6, 1, k);
  R(g, 7, 1, 10, 1, k); R(g, 8, 1, 8, 1, p.robeDark);
  R(g, 6, 2, 12, 2, k); R(g, 7, 2, 10, 2, p.robe);
  R(g, 5, 3, 14, 2, k); R(g, 6, 3, 12, 2, p.robe);
  R(g, 4, 4, 16, 8, k); R(g, 5, 4, 14, 8, p.robe);
  R(g, 5, 4, 3, 8, p.robeHi); // 左上高光
  // -- hair fringe under hood
  R(g, 8, 5, 8, 2, p.hair); R(g, 8, 5, 8, 1, p.hairHi);
  // -- face
  R(g, 8, 7, 8, 4, p.skin); R(g, 8, 7, 8, 1, p.skinHi);
  R(g, 10, 8, 1, 2, k); R(g, 13, 8, 1, 2, k); // eyes
  R(g, 11, 10, 2, 1, k); // mouth
  // -- hood bottom
  R(g, 5, 11, 14, 2, k); R(g, 6, 11, 12, 1, p.robe);
  // -- shoulders + collar
  R(g, 5, 12, 14, 2, k); R(g, 6, 12, 12, 2, p.robe);
  R(g, 10, 12, 4, 2, p.trim); R(g, 10, 12, 4, 1, p.trimHi);
  // -- torso
  R(g, 4, 14, 16, 9, k); R(g, 5, 14, 14, 9, p.robe);
  R(g, 5, 14, 2, 9, p.robeHi); R(g, 18, 14, 2, 9, p.robeDark);
  R(g, 11, 14, 2, 9, p.trim); // 前襟滚边
  // -- arms (sleeves + hands)
  R(g, 2, 15, 3, 7, k); R(g, 2, 15, 3, 7, p.robe); R(g, 2, 15, 1, 7, p.robeHi);
  R(g, 19, 15, 3, 7, k); R(g, 19, 15, 3, 7, p.robe); R(g, 21, 15, 1, 7, p.robeDark);
  R(g, 2, 21, 3, 2, p.skin); R(g, 19, 21, 3, 2, p.skin);
  // -- robe skirt
  R(g, 3, 22, 18, 6, k); R(g, 4, 22, 16, 6, p.robe);
  R(g, 4, 22, 2, 6, p.robeHi); R(g, 18, 22, 2, 6, p.robeDark);
  R(g, 4, 27, 16, 1, p.trim); // 下摆滚边
  // -- legs (walk variants)
  const legC = p.robeDark;
  if (walk === 0) { R(g, 8, 28, 3, 5, k); R(g, 9, 28, 1, 5, legC); R(g, 13, 28, 3, 5, k); R(g, 14, 28, 1, 5, legC); }
  else if (walk === 1) { R(g, 6, 28, 3, 5, k); R(g, 7, 28, 1, 5, legC); R(g, 15, 28, 3, 5, k); R(g, 16, 28, 1, 5, legC); }
  else { R(g, 10, 28, 3, 5, k); R(g, 11, 28, 1, 5, legC); R(g, 12, 28, 3, 5, k); R(g, 13, 28, 1, 5, legC); }
  // -- boots
  const bx = walk === 1 ? [5, 14] : walk === 2 ? [9, 11] : [7, 12];
  R(g, bx[0], 33, 5, 2, k); R(g, bx[0] + 1, 33, 3, 1, p.boot);
  R(g, bx[1], 33, 5, 2, k); R(g, bx[1] + 1, 33, 3, 1, p.boot);
  return c;
}

function studentBack(p: CharPal, walk: 0 | 1 | 2): HTMLCanvasElement {
  const [c, g] = cv(24, 36);
  const k = CHAR_OUTLINE;
  // -- hood back (full, no face)
  R(g, 9, 0, 6, 1, k);
  R(g, 7, 1, 10, 2, k); R(g, 8, 1, 8, 2, p.robeDark);
  R(g, 6, 3, 12, 3, k); R(g, 7, 3, 10, 3, p.robe);
  R(g, 5, 5, 14, 7, k); R(g, 6, 5, 12, 7, p.robe);
  R(g, 6, 5, 3, 7, p.robeHi);
  R(g, 10, 6, 4, 5, p.robeDark); // 兜帽褶皱
  R(g, 9, 10, 6, 2, p.hair); // 脑后头发
  // -- shoulders
  R(g, 5, 12, 14, 2, k); R(g, 6, 12, 12, 2, p.robe);
  R(g, 10, 12, 4, 1, p.trim); // 颈后搭扣
  // -- torso back + center seam
  R(g, 4, 14, 16, 9, k); R(g, 5, 14, 14, 9, p.robe);
  R(g, 5, 14, 2, 9, p.robeHi); R(g, 11, 14, 2, 9, p.robeDark);
  // -- arms
  R(g, 2, 15, 3, 7, k); R(g, 2, 15, 3, 7, p.robe);
  R(g, 19, 15, 3, 7, k); R(g, 19, 15, 3, 7, p.robe);
  // -- skirt
  R(g, 3, 22, 18, 6, k); R(g, 4, 22, 16, 6, p.robe);
  R(g, 4, 22, 2, 6, p.robeHi);
  // -- legs
  const legC = p.robeDark;
  if (walk === 0) { R(g, 8, 28, 3, 5, k); R(g, 9, 28, 1, 5, legC); R(g, 13, 28, 3, 5, k); R(g, 14, 28, 1, 5, legC); }
  else if (walk === 1) { R(g, 6, 28, 3, 5, k); R(g, 7, 28, 1, 5, legC); R(g, 15, 28, 3, 5, k); R(g, 16, 28, 1, 5, legC); }
  else { R(g, 10, 28, 3, 5, k); R(g, 11, 28, 1, 5, legC); R(g, 12, 28, 3, 5, k); R(g, 13, 28, 1, 5, legC); }
  const bx = walk === 1 ? [5, 14] : walk === 2 ? [9, 11] : [7, 12];
  R(g, bx[0], 33, 5, 2, k); R(g, bx[0] + 1, 33, 3, 1, p.boot);
  R(g, bx[1], 33, 5, 2, k); R(g, bx[1] + 1, 33, 3, 1, p.boot);
  return c;
}

function studentSide(p: CharPal, walk: 0 | 1 | 2): HTMLCanvasElement {
  // facing right
  const [c, g] = cv(24, 36);
  const k = CHAR_OUTLINE;
  // -- hood profile
  R(g, 8, 0, 7, 1, k);
  R(g, 6, 1, 11, 2, k); R(g, 7, 1, 9, 2, p.robeDark);
  R(g, 5, 3, 13, 3, k); R(g, 6, 3, 11, 3, p.robe);
  R(g, 5, 5, 14, 7, k); R(g, 6, 5, 12, 7, p.robe);
  R(g, 6, 5, 3, 7, p.robeHi);
  // -- face profile + nose
  R(g, 9, 6, 7, 5, p.skin); R(g, 9, 6, 7, 1, p.skinHi);
  R(g, 16, 8, 2, 2, p.skin); R(g, 17, 8, 1, 2, k); // nose
  R(g, 13, 7, 1, 2, k); // eye
  R(g, 8, 5, 6, 2, p.hair); // side hair
  R(g, 6, 11, 12, 2, k); R(g, 7, 11, 10, 1, p.robe);
  // -- torso profile (narrower)
  R(g, 7, 12, 10, 2, k); R(g, 8, 12, 8, 2, p.robe);
  R(g, 7, 14, 10, 9, k); R(g, 8, 14, 8, 9, p.robe);
  R(g, 8, 14, 2, 9, p.robeHi);
  R(g, 12, 14, 1, 9, p.trim); // 侧缝滚边
  // -- front arm visible
  R(g, 13, 15, 4, 7, k); R(g, 13, 15, 4, 7, p.robe);
  R(g, 13, 21, 4, 2, p.skin);
  // -- skirt
  R(g, 6, 22, 12, 6, k); R(g, 7, 22, 10, 6, p.robe);
  R(g, 7, 22, 2, 6, p.robeHi);
  // -- legs in profile
  const legC = p.robeDark;
  if (walk === 0) { R(g, 9, 28, 3, 5, k); R(g, 10, 28, 1, 5, legC); R(g, 13, 28, 3, 5, k); R(g, 14, 28, 1, 5, legC); }
  else if (walk === 1) { R(g, 7, 28, 3, 5, k); R(g, 8, 28, 1, 5, legC); R(g, 14, 28, 3, 5, k); R(g, 15, 28, 1, 5, legC); }
  else { R(g, 11, 28, 4, 5, k); R(g, 12, 28, 2, 5, legC); }
  const bx = walk === 1 ? [6, 13] : walk === 2 ? [10, 10] : [8, 12];
  R(g, bx[0], 33, 5, 2, k); R(g, bx[0] + 1, 33, 3, 1, p.boot);
  if (walk !== 2) { R(g, bx[1], 33, 5, 2, k); R(g, bx[1] + 1, 33, 3, 1, p.boot); }
  return c;
}

// ------------------------------------------------------------------ PROFESSOR 24x36
// 尖顶巫师帽 + 长胡子 + 曳地长袍。walk: 袍摆偏移 + 靴尖交替。

function professorFront(p: CharPal, walk: 0 | 1 | 2): HTMLCanvasElement {
  const [c, g] = cv(24, 36);
  const k = CHAR_OUTLINE;
  // -- pointed hat
  R(g, 11, 0, 2, 2, k); R(g, 11, 0, 2, 2, p.robeDark);
  R(g, 10, 2, 4, 2, k); R(g, 10, 2, 4, 2, p.robe);
  R(g, 9, 4, 6, 2, k); R(g, 9, 4, 6, 2, p.robe);
  R(g, 8, 6, 8, 3, k); R(g, 8, 6, 8, 3, p.robe); R(g, 8, 6, 2, 3, p.robeHi);
  R(g, 10, 5, 1, 3, p.robeDark); // 帽褶
  R(g, 6, 9, 12, 2, k); R(g, 6, 9, 12, 2, p.trim); // 帽檐滚边
  // -- face + long beard
  R(g, 8, 10, 8, 4, p.skin); R(g, 8, 10, 8, 1, p.skinHi);
  R(g, 10, 11, 1, 2, k); R(g, 13, 11, 1, 2, k); // eyes (stern)
  R(g, 9, 13, 6, 9, p.extra); R(g, 9, 13, 6, 1, p.extraHi); // beard mass
  R(g, 8, 13, 8, 9, k); // beard outline mass
  R(g, 9, 13, 6, 9, p.extra);
  R(g, 9, 13, 2, 9, p.extraHi);
  R(g, 10, 19, 4, 3, p.extra); // beard tip
  // -- long robe
  R(g, 5, 14, 14, 2, k); R(g, 6, 14, 12, 2, p.robe);
  R(g, 10, 14, 4, 1, p.trim);
  R(g, 4, 16, 16, 16, k); R(g, 5, 16, 14, 16, p.robe);
  R(g, 5, 16, 2, 16, p.robeHi); R(g, 17, 16, 2, 16, p.robeDark);
  R(g, 11, 16, 2, 16, p.trim); // 前襟
  // -- arms (wide sleeves)
  R(g, 2, 17, 3, 8, k); R(g, 2, 17, 3, 8, p.robe);
  R(g, 19, 17, 3, 8, k); R(g, 19, 17, 3, 8, p.robe);
  R(g, 2, 24, 3, 2, p.skin); R(g, 19, 24, 3, 2, p.skin);
  // -- hem + boots peek
  const sway = walk === 1 ? 1 : walk === 2 ? -1 : 0;
  R(g, 3 + sway, 31, 18, 3, k); R(g, 4 + sway, 31, 16, 3, p.robe);
  R(g, 4 + sway, 33, 16, 1, p.trim);
  const bx = walk === 1 ? [7, 13] : walk === 2 ? [10, 10] : [8, 12];
  R(g, bx[0], 34, 4, 2, k); R(g, bx[0] + 1, 34, 2, 1, p.boot);
  if (walk !== 2) { R(g, bx[1], 34, 4, 2, k); R(g, bx[1] + 1, 34, 2, 1, p.boot); }
  return c;
}

function professorBack(p: CharPal, walk: 0 | 1 | 2): HTMLCanvasElement {
  const [c, g] = cv(24, 36);
  const k = CHAR_OUTLINE;
  R(g, 11, 0, 2, 2, k); R(g, 11, 0, 2, 2, p.robeDark);
  R(g, 10, 2, 4, 2, k); R(g, 10, 2, 4, 2, p.robe);
  R(g, 9, 4, 6, 2, k); R(g, 9, 4, 6, 2, p.robe);
  R(g, 8, 6, 8, 3, k); R(g, 8, 6, 8, 3, p.robe); R(g, 8, 6, 2, 3, p.robeHi);
  R(g, 6, 9, 12, 2, k); R(g, 6, 9, 12, 2, p.robeDark);
  R(g, 9, 10, 6, 3, p.hair); // 脑后白发
  R(g, 5, 12, 14, 3, k); R(g, 6, 12, 12, 3, p.robe);
  R(g, 4, 15, 16, 17, k); R(g, 5, 15, 14, 17, p.robe);
  R(g, 5, 15, 2, 17, p.robeHi); R(g, 11, 15, 2, 17, p.robeDark);
  R(g, 2, 16, 3, 8, k); R(g, 2, 16, 3, 8, p.robe);
  R(g, 19, 16, 3, 8, k); R(g, 19, 16, 3, 8, p.robe);
  const sway = walk === 1 ? 1 : walk === 2 ? -1 : 0;
  R(g, 3 + sway, 31, 18, 3, k); R(g, 4 + sway, 31, 16, 3, p.robe);
  const bx = walk === 1 ? [7, 13] : walk === 2 ? [10, 10] : [8, 12];
  R(g, bx[0], 34, 4, 2, k); R(g, bx[0] + 1, 34, 2, 1, p.boot);
  if (walk !== 2) { R(g, bx[1], 34, 4, 2, k); R(g, bx[1] + 1, 34, 2, 1, p.boot); }
  return c;
}

function professorSide(p: CharPal, walk: 0 | 1 | 2): HTMLCanvasElement {
  const [c, g] = cv(24, 36); // facing right
  const k = CHAR_OUTLINE;
  R(g, 11, 0, 2, 2, k);
  R(g, 10, 2, 4, 2, k); R(g, 10, 2, 4, 2, p.robe);
  R(g, 9, 4, 6, 3, k); R(g, 9, 4, 6, 3, p.robe); R(g, 9, 4, 2, 3, p.robeHi);
  R(g, 7, 7, 11, 2, k); R(g, 7, 7, 11, 2, p.robeDark);
  R(g, 6, 9, 12, 2, k); R(g, 6, 9, 12, 2, p.trim);
  R(g, 9, 10, 7, 4, p.skin);
  R(g, 16, 11, 2, 2, p.skin); R(g, 17, 11, 1, 2, k); // nose
  R(g, 13, 11, 1, 2, k); // eye
  R(g, 10, 13, 6, 9, k); R(g, 11, 13, 4, 9, p.extra); // side beard
  R(g, 11, 13, 1, 9, p.extraHi);
  R(g, 7, 14, 10, 2, k); R(g, 8, 14, 8, 2, p.robe);
  R(g, 7, 16, 10, 16, k); R(g, 8, 16, 8, 16, p.robe);
  R(g, 8, 16, 2, 16, p.robeHi);
  R(g, 13, 17, 4, 8, k); R(g, 13, 17, 4, 8, p.robe); // front arm
  R(g, 13, 24, 4, 2, p.skin);
  const sway = walk === 1 ? 1 : walk === 2 ? -1 : 0;
  R(g, 6 + sway, 31, 12, 3, k); R(g, 7 + sway, 31, 10, 3, p.robe);
  const bx = walk === 1 ? [6, 13] : walk === 2 ? [10, 10] : [8, 12];
  R(g, bx[0], 34, 4, 2, k); R(g, bx[0] + 1, 34, 2, 1, p.boot);
  if (walk !== 2) { R(g, bx[1], 34, 4, 2, k); R(g, bx[1] + 1, 34, 2, 1, p.boot); }
  return c;
}

// ------------------------------------------------------------------ MERCHANT 24x36
// 便帽 + 围裙（带口袋）+ 腰包。walk: 腿部摆动。

function merchantFront(p: CharPal, walk: 0 | 1 | 2): HTMLCanvasElement {
  const [c, g] = cv(24, 36);
  const k = CHAR_OUTLINE;
  // -- cap
  R(g, 8, 1, 8, 2, k); R(g, 8, 1, 8, 2, p.robeDark);
  R(g, 7, 3, 10, 2, k); R(g, 7, 3, 10, 2, p.robe); R(g, 7, 3, 3, 2, p.robeHi);
  // -- face + mustache
  R(g, 8, 5, 8, 5, p.skin); R(g, 8, 5, 8, 1, p.skinHi);
  R(g, 10, 6, 1, 2, k); R(g, 13, 6, 1, 2, k);
  R(g, 10, 9, 4, 1, p.hair); // mustache
  R(g, 7, 4, 2, 4, p.hair); R(g, 15, 4, 2, 4, p.hair); // side hair
  R(g, 7, 3, 2, 8, k); R(g, 15, 3, 2, 8, k);
  // -- tunic
  R(g, 5, 11, 14, 2, k); R(g, 6, 11, 12, 2, p.robe);
  R(g, 4, 13, 16, 10, k); R(g, 5, 13, 14, 10, p.robe);
  R(g, 5, 13, 2, 10, p.robeHi);
  // -- apron + pockets
  R(g, 8, 14, 8, 10, k); R(g, 9, 14, 6, 10, p.extra);
  R(g, 9, 14, 2, 10, p.extraHi);
  R(g, 9, 19, 6, 1, k); // pocket line
  R(g, 10, 20, 2, 2, p.robeDark); R(g, 13, 20, 2, 2, p.robeDark); // pockets
  // -- belt + pouch
  R(g, 4, 23, 16, 2, k); R(g, 5, 23, 14, 2, p.trim);
  R(g, 15, 23, 4, 4, k); R(g, 16, 23, 2, 4, p.extra); // pouch
  // -- arms
  R(g, 2, 14, 3, 7, k); R(g, 2, 14, 3, 7, p.robe);
  R(g, 19, 14, 3, 7, k); R(g, 19, 14, 3, 7, p.robe);
  R(g, 2, 20, 3, 2, p.skin); R(g, 19, 20, 3, 2, p.skin);
  // -- legs
  const legC = p.robeDark;
  if (walk === 0) { R(g, 8, 25, 3, 7, k); R(g, 9, 25, 1, 7, legC); R(g, 13, 25, 3, 7, k); R(g, 14, 25, 1, 7, legC); }
  else if (walk === 1) { R(g, 6, 25, 3, 7, k); R(g, 7, 25, 1, 7, legC); R(g, 15, 25, 3, 7, k); R(g, 16, 25, 1, 7, legC); }
  else { R(g, 10, 25, 3, 7, k); R(g, 11, 25, 1, 7, legC); R(g, 12, 25, 3, 7, k); R(g, 13, 25, 1, 7, legC); }
  const bx = walk === 1 ? [5, 14] : walk === 2 ? [9, 11] : [7, 12];
  R(g, bx[0], 32, 5, 3, k); R(g, bx[0] + 1, 32, 3, 2, p.boot);
  R(g, bx[1], 32, 5, 3, k); R(g, bx[1] + 1, 32, 3, 2, p.boot);
  return c;
}

function merchantBack(p: CharPal, walk: 0 | 1 | 2): HTMLCanvasElement {
  const [c, g] = cv(24, 36);
  const k = CHAR_OUTLINE;
  R(g, 8, 1, 8, 2, k); R(g, 8, 1, 8, 2, p.robeDark);
  R(g, 7, 3, 10, 2, k); R(g, 7, 3, 10, 2, p.robe);
  R(g, 9, 4, 6, 4, p.hair); // back hair
  R(g, 7, 3, 2, 8, k); R(g, 15, 3, 2, 8, k);
  R(g, 5, 11, 14, 2, k); R(g, 6, 11, 12, 2, p.robe);
  R(g, 4, 13, 16, 10, k); R(g, 5, 13, 14, 10, p.robe);
  R(g, 5, 13, 2, 10, p.robeHi); R(g, 17, 13, 2, 10, p.robeDark);
  R(g, 11, 13, 2, 10, p.robeDark); // back seam
  R(g, 4, 23, 16, 2, k); R(g, 5, 23, 14, 2, p.trim);
  R(g, 2, 14, 3, 7, k); R(g, 2, 14, 3, 7, p.robe);
  R(g, 19, 14, 3, 7, k); R(g, 19, 14, 3, 7, p.robe);
  const legC = p.robeDark;
  if (walk === 0) { R(g, 8, 25, 3, 7, k); R(g, 9, 25, 1, 7, legC); R(g, 13, 25, 3, 7, k); R(g, 14, 25, 1, 7, legC); }
  else if (walk === 1) { R(g, 6, 25, 3, 7, k); R(g, 7, 25, 1, 7, legC); R(g, 15, 25, 3, 7, k); R(g, 16, 25, 1, 7, legC); }
  else { R(g, 10, 25, 3, 7, k); R(g, 11, 25, 1, 7, legC); R(g, 12, 25, 3, 7, k); R(g, 13, 25, 1, 7, legC); }
  const bx = walk === 1 ? [5, 14] : walk === 2 ? [9, 11] : [7, 12];
  R(g, bx[0], 32, 5, 3, k); R(g, bx[0] + 1, 32, 3, 2, p.boot);
  R(g, bx[1], 32, 5, 3, k); R(g, bx[1] + 1, 32, 3, 2, p.boot);
  return c;
}

function merchantSide(p: CharPal, walk: 0 | 1 | 2): HTMLCanvasElement {
  const [c, g] = cv(24, 36); // facing right
  const k = CHAR_OUTLINE;
  R(g, 8, 1, 8, 2, k); R(g, 8, 1, 8, 2, p.robeDark);
  R(g, 7, 3, 11, 2, k); R(g, 7, 3, 11, 2, p.robe);
  R(g, 9, 5, 7, 5, p.skin);
  R(g, 16, 6, 2, 2, p.skin); R(g, 17, 6, 1, 2, k); // nose
  R(g, 13, 6, 1, 2, k); // eye
  R(g, 12, 9, 4, 1, p.hair); // mustache side
  R(g, 8, 4, 2, 5, p.hair);
  R(g, 7, 11, 10, 2, k); R(g, 8, 11, 8, 2, p.robe);
  R(g, 7, 13, 10, 10, k); R(g, 8, 13, 8, 10, p.robe);
  R(g, 8, 13, 2, 10, p.robeHi);
  R(g, 10, 14, 6, 8, k); R(g, 11, 14, 4, 8, p.extra); // apron side
  R(g, 7, 23, 10, 2, k); R(g, 8, 23, 8, 2, p.trim);
  R(g, 13, 14, 4, 7, k); R(g, 13, 14, 4, 7, p.robe); // front arm
  R(g, 13, 20, 4, 2, p.skin);
  const legC = p.robeDark;
  if (walk === 0) { R(g, 9, 25, 3, 7, k); R(g, 10, 25, 1, 7, legC); R(g, 13, 25, 3, 7, k); R(g, 14, 25, 1, 7, legC); }
  else if (walk === 1) { R(g, 7, 25, 3, 7, k); R(g, 8, 25, 1, 7, legC); R(g, 14, 25, 3, 7, k); R(g, 15, 25, 1, 7, legC); }
  else { R(g, 11, 25, 4, 7, k); R(g, 12, 25, 2, 7, legC); }
  const bx = walk === 1 ? [6, 13] : walk === 2 ? [10, 10] : [8, 12];
  R(g, bx[0], 32, 5, 3, k); R(g, bx[0] + 1, 32, 3, 2, p.boot);
  if (walk !== 2) { R(g, bx[1], 32, 5, 3, k); R(g, bx[1] + 1, 32, 3, 2, p.boot); }
  return c;
}

// ------------------------------------------------------------------ HAGRID 30x46
// 半巨人：蓬乱长发 + 大胡子盖脸 + 鼹鼠皮大衣 + 巨靴。

function hagridFront(p: CharPal, walk: 0 | 1 | 2): HTMLCanvasElement {
  const [c, g] = cv(30, 46);
  const k = CHAR_OUTLINE;
  // -- wild hair mass
  R(g, 9, 0, 12, 2, k); R(g, 10, 0, 10, 2, p.hair);
  R(g, 7, 2, 16, 3, k); R(g, 8, 2, 14, 3, p.hair); R(g, 8, 2, 4, 3, p.hairHi);
  R(g, 6, 5, 18, 5, k); R(g, 7, 5, 16, 5, p.hair);
  R(g, 7, 5, 4, 5, p.hairHi);
  // -- eyes peeking through
  R(g, 11, 9, 2, 2, k); R(g, 17, 9, 2, 2, k);
  R(g, 10, 8, 4, 1, p.skin); R(g, 16, 8, 4, 1, p.skin);
  // -- beard mass covering face
  R(g, 8, 10, 14, 14, k); R(g, 9, 10, 12, 14, p.extra);
  R(g, 9, 10, 3, 14, p.extraHi);
  R(g, 12, 14, 6, 2, p.hairHi); // beard streaks
  // -- moleskin coat
  R(g, 6, 22, 18, 3, k); R(g, 7, 22, 16, 3, p.robe);
  R(g, 5, 24, 20, 14, k); R(g, 6, 24, 18, 14, p.robe);
  R(g, 6, 24, 3, 14, p.robeHi); R(g, 21, 24, 3, 14, p.robeDark);
  R(g, 14, 24, 2, 14, p.robeDark); // coat seam
  R(g, 12, 24, 6, 2, p.trim); // collar
  // -- huge arms + hands
  R(g, 2, 25, 4, 10, k); R(g, 2, 25, 4, 10, p.robe);
  R(g, 24, 25, 4, 10, k); R(g, 24, 25, 4, 10, p.robe);
  R(g, 2, 34, 4, 4, p.skin); R(g, 24, 34, 4, 4, p.skin);
  // -- legs (mostly hidden by coat)
  const legC = p.robeDark;
  if (walk === 0) { R(g, 10, 38, 4, 4, k); R(g, 11, 38, 2, 4, legC); R(g, 16, 38, 4, 4, k); R(g, 17, 38, 2, 4, legC); }
  else if (walk === 1) { R(g, 8, 38, 4, 4, k); R(g, 9, 38, 2, 4, legC); R(g, 18, 38, 4, 4, k); R(g, 19, 38, 2, 4, legC); }
  else { R(g, 13, 38, 4, 4, k); R(g, 14, 38, 2, 4, legC); }
  // -- giant boots
  const bx = walk === 1 ? [7, 17] : walk === 2 ? [12, 12] : [9, 15];
  R(g, bx[0], 42, 6, 3, k); R(g, bx[0] + 1, 42, 4, 2, p.boot);
  if (walk !== 2) { R(g, bx[1], 42, 6, 3, k); R(g, bx[1] + 1, 42, 4, 2, p.boot); }
  return c;
}

function hagridBack(p: CharPal, walk: 0 | 1 | 2): HTMLCanvasElement {
  const [c, g] = cv(30, 46);
  const k = CHAR_OUTLINE;
  R(g, 9, 0, 12, 2, k); R(g, 10, 0, 10, 2, p.hair);
  R(g, 7, 2, 16, 4, k); R(g, 8, 2, 14, 4, p.hair); R(g, 8, 2, 4, 4, p.hairHi);
  R(g, 6, 6, 18, 12, k); R(g, 7, 6, 16, 12, p.hair);
  R(g, 7, 6, 4, 12, p.hairHi);
  R(g, 6, 18, 18, 5, k); R(g, 7, 18, 16, 5, p.robe);
  R(g, 6, 22, 18, 3, k); R(g, 7, 22, 16, 3, p.robe);
  R(g, 5, 24, 20, 14, k); R(g, 6, 24, 18, 14, p.robe);
  R(g, 6, 24, 3, 14, p.robeHi); R(g, 14, 24, 2, 14, p.robeDark);
  R(g, 2, 25, 4, 10, k); R(g, 2, 25, 4, 10, p.robe);
  R(g, 24, 25, 4, 10, k); R(g, 24, 25, 4, 10, p.robe);
  const legC = p.robeDark;
  if (walk === 0) { R(g, 10, 38, 4, 4, k); R(g, 11, 38, 2, 4, legC); R(g, 16, 38, 4, 4, k); R(g, 17, 38, 2, 4, legC); }
  else if (walk === 1) { R(g, 8, 38, 4, 4, k); R(g, 9, 38, 2, 4, legC); R(g, 18, 38, 4, 4, k); R(g, 19, 38, 2, 4, legC); }
  else { R(g, 13, 38, 4, 4, k); R(g, 14, 38, 2, 4, legC); }
  const bx = walk === 1 ? [7, 17] : walk === 2 ? [12, 12] : [9, 15];
  R(g, bx[0], 42, 6, 3, k); R(g, bx[0] + 1, 42, 4, 2, p.boot);
  if (walk !== 2) { R(g, bx[1], 42, 6, 3, k); R(g, bx[1] + 1, 42, 4, 2, p.boot); }
  return c;
}

function hagridSide(p: CharPal, walk: 0 | 1 | 2): HTMLCanvasElement {
  const [c, g] = cv(30, 46); // facing right
  const k = CHAR_OUTLINE;
  R(g, 9, 0, 12, 2, k); R(g, 10, 0, 10, 2, p.hair);
  R(g, 7, 2, 17, 4, k); R(g, 8, 2, 15, 4, p.hair); R(g, 8, 2, 4, 4, p.hairHi);
  R(g, 7, 6, 17, 6, k); R(g, 8, 6, 15, 6, p.hair);
  R(g, 13, 9, 2, 2, k); // eye
  R(g, 22, 9, 3, 3, p.skin); // nose tip
  R(g, 10, 11, 14, 13, k); R(g, 11, 11, 12, 13, p.extra); // beard side
  R(g, 11, 11, 3, 13, p.extraHi);
  R(g, 8, 22, 16, 3, k); R(g, 9, 22, 14, 3, p.robe);
  R(g, 7, 24, 16, 14, k); R(g, 8, 24, 14, 14, p.robe);
  R(g, 8, 24, 3, 14, p.robeHi);
  R(g, 17, 25, 5, 10, k); R(g, 17, 25, 5, 10, p.robe); // front arm
  R(g, 17, 34, 5, 4, p.skin);
  const legC = p.robeDark;
  if (walk === 0) { R(g, 11, 38, 4, 4, k); R(g, 12, 38, 2, 4, legC); R(g, 16, 38, 4, 4, k); R(g, 17, 38, 2, 4, legC); }
  else if (walk === 1) { R(g, 9, 38, 4, 4, k); R(g, 10, 38, 2, 4, legC); R(g, 17, 38, 4, 4, k); R(g, 18, 38, 2, 4, legC); }
  else { R(g, 13, 38, 5, 4, k); R(g, 14, 38, 3, 4, legC); }
  const bx = walk === 1 ? [8, 16] : walk === 2 ? [12, 12] : [10, 15];
  R(g, bx[0], 42, 6, 3, k); R(g, bx[0] + 1, 42, 4, 2, p.boot);
  if (walk !== 2) { R(g, bx[1], 42, 6, 3, k); R(g, bx[1] + 1, 42, 4, 2, p.boot); }
  return c;
}

// ------------------------------------------------------------------ ELF 16x28
// 家养小精灵：蝙蝠大耳 + 巨眼 + 瘦小身躯 + 破衣。

function elfFront(p: CharPal, walk: 0 | 1 | 2): HTMLCanvasElement {
  const [c, g] = cv(16, 28);
  const k = CHAR_OUTLINE;
  // -- bat ears
  R(g, 0, 3, 4, 6, k); R(g, 0, 3, 4, 6, p.skin); R(g, 1, 4, 2, 4, p.skinHi);
  R(g, 12, 3, 4, 6, k); R(g, 12, 3, 4, 6, p.skin); R(g, 13, 4, 2, 4, p.skinHi);
  // -- head
  R(g, 4, 0, 8, 2, k); R(g, 5, 0, 6, 2, p.skin);
  R(g, 3, 2, 10, 8, k); R(g, 4, 2, 8, 8, p.skin); R(g, 4, 2, 8, 1, p.skinHi);
  // -- huge eyes
  R(g, 5, 4, 3, 3, '#ffffff'); R(g, 8, 4, 3, 3, '#ffffff');
  R(g, 6, 5, 1, 2, k); R(g, 9, 5, 1, 2, k);
  // -- small mouth
  R(g, 7, 8, 2, 1, k);
  // -- ragged tunic
  R(g, 4, 10, 8, 2, k); R(g, 5, 10, 6, 2, p.robe);
  R(g, 3, 12, 10, 8, k); R(g, 4, 12, 8, 8, p.robe);
  R(g, 4, 12, 2, 8, p.robeHi);
  R(g, 3, 19, 3, 1, k); R(g, 10, 19, 3, 1, k); // rags
  // -- thin arms
  R(g, 1, 13, 2, 5, k); R(g, 1, 13, 2, 5, p.skin);
  R(g, 13, 13, 2, 5, k); R(g, 13, 13, 2, 5, p.skin);
  // -- legs
  if (walk === 0) { R(g, 5, 20, 2, 4, k); R(g, 9, 20, 2, 4, k); }
  else if (walk === 1) { R(g, 4, 20, 2, 4, k); R(g, 10, 20, 2, 4, k); }
  else { R(g, 7, 20, 2, 4, k); }
  // -- big feet
  const fx = walk === 1 ? [3, 10] : walk === 2 ? [6, 6] : [4, 9];
  R(g, fx[0], 24, 4, 3, k); R(g, fx[0], 24, 4, 3, p.skin);
  if (walk !== 2) { R(g, fx[1], 24, 4, 3, k); R(g, fx[1], 24, 4, 3, p.skin); }
  return c;
}

function elfBack(p: CharPal, walk: 0 | 1 | 2): HTMLCanvasElement {
  const [c, g] = cv(16, 28);
  const k = CHAR_OUTLINE;
  R(g, 0, 3, 4, 6, k); R(g, 0, 3, 4, 6, p.skin);
  R(g, 12, 3, 4, 6, k); R(g, 12, 3, 4, 6, p.skin);
  R(g, 4, 0, 8, 2, k); R(g, 5, 0, 6, 2, p.skin);
  R(g, 3, 2, 10, 8, k); R(g, 4, 2, 8, 8, p.skin); R(g, 4, 2, 2, 8, p.skinHi);
  R(g, 4, 10, 8, 2, k); R(g, 5, 10, 6, 2, p.robe);
  R(g, 3, 12, 10, 8, k); R(g, 4, 12, 8, 8, p.robe);
  R(g, 4, 12, 2, 8, p.robeHi); R(g, 10, 12, 2, 8, p.robeDark);
  R(g, 3, 19, 3, 1, k); R(g, 10, 19, 3, 1, k);
  R(g, 1, 13, 2, 5, k); R(g, 1, 13, 2, 5, p.skin);
  R(g, 13, 13, 2, 5, k); R(g, 13, 13, 2, 5, p.skin);
  if (walk === 0) { R(g, 5, 20, 2, 4, k); R(g, 9, 20, 2, 4, k); }
  else if (walk === 1) { R(g, 4, 20, 2, 4, k); R(g, 10, 20, 2, 4, k); }
  else { R(g, 7, 20, 2, 4, k); }
  const fx = walk === 1 ? [3, 10] : walk === 2 ? [6, 6] : [4, 9];
  R(g, fx[0], 24, 4, 3, k); R(g, fx[0], 24, 4, 3, p.skin);
  if (walk !== 2) { R(g, fx[1], 24, 4, 3, k); R(g, fx[1], 24, 4, 3, p.skin); }
  return c;
}

function elfSide(p: CharPal, walk: 0 | 1 | 2): HTMLCanvasElement {
  const [c, g] = cv(16, 28); // facing right
  const k = CHAR_OUTLINE;
  R(g, 1, 2, 4, 7, k); R(g, 1, 2, 4, 7, p.skin); // back ear visible
  R(g, 10, 1, 5, 6, k); R(g, 10, 1, 5, 6, p.skin); R(g, 11, 2, 3, 4, p.skinHi); // front ear
  R(g, 4, 2, 8, 8, k); R(g, 5, 2, 6, 8, p.skin); R(g, 5, 2, 6, 1, p.skinHi);
  R(g, 7, 4, 3, 3, '#ffffff'); R(g, 8, 5, 1, 2, k); // side eye
  R(g, 11, 6, 2, 1, p.skin); R(g, 12, 6, 1, 1, k); // nose
  R(g, 5, 10, 6, 2, k); R(g, 6, 10, 4, 2, p.robe);
  R(g, 4, 12, 8, 8, k); R(g, 5, 12, 6, 8, p.robe);
  R(g, 5, 12, 2, 8, p.robeHi);
  R(g, 4, 19, 2, 1, k); R(g, 9, 19, 2, 1, k);
  R(g, 8, 13, 3, 5, k); R(g, 8, 13, 3, 5, p.skin); // front arm
  if (walk === 0) { R(g, 6, 20, 2, 4, k); R(g, 9, 20, 2, 4, k); }
  else if (walk === 1) { R(g, 5, 20, 2, 4, k); R(g, 10, 20, 2, 4, k); }
  else { R(g, 7, 20, 3, 4, k); }
  const fx = walk === 1 ? [4, 9] : walk === 2 ? [6, 6] : [5, 8];
  R(g, fx[0], 24, 4, 3, k); R(g, fx[0], 24, 4, 3, p.skin);
  if (walk !== 2) { R(g, fx[1], 24, 4, 3, k); R(g, fx[1], 24, 4, 3, p.skin); }
  return c;
}

// ------------------------------------------------------------------ build

type ViewFn = (p: CharPal, walk: 0 | 1 | 2) => HTMLCanvasElement;

interface VariantDef {
  views: { down: ViewFn; up: ViewFn; right: ViewFn };
  houses?: string[]; // student only
  pal: CharPal | ((house: string) => CharPal);
}

const VARIANTS: Record<CharVariant, VariantDef> = {
  student: {
    views: { down: studentFront, up: studentBack, right: studentSide },
    houses: ['gryffindor', 'slytherin', 'ravenclaw', 'hufflepuff'],
    pal: studentPal,
  },
  professor: { views: { down: professorFront, up: professorBack, right: professorSide }, pal: PROFESSOR_PAL },
  merchant: { views: { down: merchantFront, up: merchantBack, right: merchantSide }, pal: MERCHANT_PAL },
  hagrid: { views: { down: hagridFront, up: hagridBack, right: hagridSide }, pal: HAGRID_PAL },
  elf: { views: { down: elfFront, up: elfBack, right: elfSide }, pal: ELF_PAL },
};

const WALK_SUFFIX = ['', '-w0', '-w1'] as const;

function build(): void {
  if (built) return;
  built = true;
  for (const [variant, def] of Object.entries(VARIANTS) as [CharVariant, VariantDef][]) {
    const houses = def.houses ?? [''];
    for (const house of houses) {
      const p = typeof def.pal === 'function' ? def.pal(house) : def.pal;
      const prefix = house ? `char-${variant}-${house}` : `char-${variant}`;
      const views: Record<CharDir, ViewFn> = {
        down: def.views.down, up: def.views.up,
        right: def.views.right, left: def.views.right,
      };
      for (const dir of ['down', 'up', 'right', 'left'] as CharDir[]) {
        for (let w = 0; w < 3; w++) {
          let cnv = views[dir](p, w as 0 | 1 | 2);
          if (dir === 'left') cnv = flipH(cnv);
          cache.set(`${prefix}-${dir}${WALK_SUFFIX[w]}`, cnv);
        }
      }
    }
  }
  // legacy aliases: old wizard-* keys keep working (map to student down)
  for (const house of ['gryffindor', 'slytherin', 'ravenclaw', 'hufflepuff']) {
    for (let w = 0; w < 3; w++) {
      const src = cache.get(`char-student-${house}-down${WALK_SUFFIX[w]}`)!;
      cache.set(`wizard-${house}${w === 0 ? '' : `-w${w - 1}`}`, src);
    }
  }
  for (let w = 0; w < 3; w++) {
    const src = cache.get(`char-student-gryffindor-down${WALK_SUFFIX[w]}`)!;
    cache.set(`wizard${w === 0 ? '' : `-w${w - 1}`}`, src);
  }
}

export function getCharSprite(kind: string): HTMLCanvasElement {
  build();
  const c = cache.get(kind);
  if (!c) {
    // magenta missing tile
    const [m, g] = cv(24, 36);
    R(g, 0, 0, 24, 36, '#ff00ff');
    return m;
  }
  return c;
}

export function charKinds(): string[] {
  build();
  return [...cache.keys()];
}

// ------------------------------------------------------------------ key selection

/** Facing angle (radians, screen space: 0=right, PI/2=down) -> sprite dir. */
export function dirFromAngle(f: number): CharDir {
  const a = ((f % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  if (a < Math.PI / 4 || a >= Math.PI * 7 / 4) return 'right';
  if (a < Math.PI * 3 / 4) return 'down';
  if (a < Math.PI * 5 / 4) return 'left';
  return 'up';
}

const ELF_NAMES = ['dobby', 'kreacher', 'winky', 'hokie'];
const PROFESSOR_NAMES = ['snape', 'mcgonagall', 'dumbledore', 'flitwick', 'sprout', 'binns', 'trelawney'];
const MERCHANT_NAMES = ['rosmerta', 'flume', 'ollivander', 'fortescue', 'borgin', 'zabini'];

/** Name -> variant. Students (players + student NPCs) get house robes. */
export function variantForName(name: string): CharVariant {
  const n = name.toLowerCase();
  if (n.includes('hagrid')) return 'hagrid';
  if (ELF_NAMES.some((e) => n.includes(e))) return 'elf';
  if (PROFESSOR_NAMES.some((e) => n.includes(e))) return 'professor';
  if (MERCHANT_NAMES.some((e) => n.includes(e))) return 'merchant';
  return 'student';
}

/**
 * Full sprite key for a wizard entity.
 * house: lowercased house string; facing: radians; walk: 0=stand 1|2=walk frames.
 */
export function charSpriteKey(name: string, house: string, facing: number, walk: 0 | 1 | 2): string {
  const v = variantForName(name);
  const dir = dirFromAngle(facing);
  const suffix = WALK_SUFFIX[walk];
  if (v === 'student') {
    const h = ['gryffindor', 'slytherin', 'ravenclaw', 'hufflepuff'].includes(house) ? house : 'gryffindor';
    return `char-student-${h}-${dir}${suffix}`;
  }
  return `char-${v}-${dir}${suffix}`;
}

/** Sprite canvas dimensions for aspect-correct drawing. */
export function charSpriteSize(variant: CharVariant): { w: number; h: number } {
  if (variant === 'hagrid') return { w: 30, h: 46 };
  if (variant === 'elf') return { w: 16, h: 28 };
  return { w: 24, h: 36 };
}
