import { CREATURES } from '../src/kernel/creatures';
import { itemPoints, itemPrice } from '../src/kernel/progression';
import { capsFor } from '../src/runes/primitives';
import type { CreatureKind } from '../src/shared/constants';
import { MATERIAL_DEFS, GLAMOUR_MATERIALS } from '../src/shared/glamour';
import { SHOP, type ShopItem } from '../src/shared/shop';
import { L, creatureName, spellName } from './i18n';

/**
 * Ease of play (易玩性), the pure parts: spell templates for people who do not write code, the one next goal
 * the HUD names, the stun overlay's advice, the prompt handed to an agent, and the shop's prices. main.ts
 * draws them; test/play.test.ts compiles every template and walks the goal chain.
 */

// ------------------------------------------------------------------ spell templates (从模板开始)
export type TplValue = string | number;
export interface TplOption { v: string; zh: string; en: string; year?: number; seals?: number }
export type TplParam =
  | { id: string; kind: 'range'; zh: string; en: string; min: number; max: (year: number, seals: number) => number; step?: number; def: (year: number, seals: number) => number; unit?: { zh: string; en: string } }
  | { id: string; kind: 'select'; zh: string; en: string; options: TplOption[]; def: string };
export interface Template {
  key: string;
  zh: string; en: string;
  /** The lowest year this template (with its default choices) compiles at. */
  year: number;
  desc: { zh: string; en: string };
  /** The spell name it suggests. */
  name: { zh: string; en: string };
  params: TplParam[];
  build: (p: Record<string, TplValue>, year: number, seals: number) => string;
}

const ELEMENT_OPTS: TplOption[] = [
  { v: 'arcane', zh: '奥术（无属性）', en: 'arcane (plain)' },
  { v: 'fire', zh: '火 —— 蜘蛛、魔鬼网、阴尸怕它', en: 'fire — spiders, snare, inferi' },
  { v: 'ice', zh: '冰 —— 小精灵怕它，还会减速', en: 'ice — pixies hate it, slows' },
  { v: 'lightning', zh: '雷', en: 'lightning' },
  { v: 'light', zh: '光 —— 魔鬼网最怕', en: 'light — Devil\'s Snare hates it' },
];
const COLOUR_OPTS: TplOption[] = [
  { v: 'house', zh: '学院色', en: 'house colour' },
  ...([
    ['crimson', '绯红', 'crimson'], ['scarlet', '猩红', 'scarlet'], ['gold', '金', 'gold'], ['silver', '银', 'silver'], ['bronze', '古铜', 'bronze'],
    ['emerald', '祖母绿', 'emerald'], ['sapphire', '蓝宝石', 'sapphire'], ['midnight', '午夜蓝', 'midnight'], ['sky', '天蓝', 'sky'], ['teal', '青绿', 'teal'],
    ['plum', '梅紫', 'plum'], ['violet', '紫罗兰', 'violet'], ['rose', '玫瑰粉', 'rose'], ['orange', '韦斯莱橙', 'orange'], ['black', '黑', 'black'], ['white', '白', 'white'], ['ivory', '象牙白', 'ivory'],
  ] as const).map(([v, zh, en]) => ({ v, zh, en })),
];
const colour = (v: TplValue) => (v === 'house' ? '(house self)' : `:${v}`);
/** The cloth's name without its description ("天鹅绒，柔和的绒光" → "天鹅绒"; the seal tag goes too: the lock says it). */
const short = (t: string) => t.replace(/^[【\[][^】\]]*[】\]]\s*/, '').split(/[，：（,:(]/)[0].trim();
const MATERIAL_OPTS: TplOption[] = GLAMOUR_MATERIALS.map((m) => ({ v: m, zh: short(MATERIAL_DEFS[m].zh), en: short(MATERIAL_DEFS[m].doc), year: MATERIAL_DEFS[m].year, seals: MATERIAL_DEFS[m].seals }));
const cap = (f: (c: ReturnType<typeof capsFor>) => number) => (y: number, s: number) => f(capsFor(y, s));

export const TEMPLATES: Template[] = [
  {
    key: 'bolt', zh: '元素弹', en: 'Elemental bolt', year: 1,
    desc: { zh: '一发追踪魔弹：有目标打目标，没目标打向瞄准点。威力越高越费法力。', en: 'A homing bolt: at your target, or at your aim when there is none. More power costs more mana.' },
    name: { zh: '我的元素弹', en: 'My Bolt' },
    params: [
      { id: 'power', kind: 'range', zh: '威力', en: 'Power', min: 4, max: cap((c) => c.boltPower), def: (y, s) => Math.min(14, capsFor(y, s).boltPower) },
      { id: 'el', kind: 'select', zh: '元素', en: 'Element', options: ELEMENT_OPTS, def: 'ice' },
    ],
    build: (p) => `(bolt (or target aim) ${p.power} :${p.el})`,
  },
  {
    key: 'execute', zh: '残血收割', en: 'Finisher', year: 1,
    desc: { zh: '血量低于门槛的敌人吃一发重击，否则打一发省蓝的小魔弹。', en: 'A foe below the threshold takes a heavy hit; otherwise a cheap small bolt.' },
    name: { zh: '残血收割', en: 'Finisher' },
    params: [
      { id: 'hp', kind: 'range', zh: '血量门槛', en: 'HP threshold', min: 5, max: () => 120, step: 5, def: () => 25 },
      { id: 'big', kind: 'range', zh: '重击威力', en: 'Heavy power', min: 4, max: cap((c) => c.boltPower), def: (y, s) => capsFor(y, s).boltPower },
      { id: 'small', kind: 'range', zh: '小魔弹威力', en: 'Small power', min: 2, max: cap((c) => c.boltPower), def: () => 6 },
      { id: 'r', kind: 'range', zh: '找敌范围', en: 'Search radius', min: 5, max: () => 32, def: () => 25, unit: { zh: '米', en: 'm' } },
    ],
    build: (p) => `(let t (or target (first (enemies ${p.r}))))\n(when t\n  (if (< (hp t) ${p.hp})\n    (bolt t ${p.big})\n    (bolt t ${p.small})))`,
  },
  {
    key: 'guard', zh: '护盾 + 治疗', en: 'Shield + heal', year: 1,
    desc: { zh: '先给自己套一层护盾，再治疗自己。被围攻时按一下就能喘口气。', en: 'A shield on yourself, then a heal. One key when you are surrounded.' },
    name: { zh: '护盾治疗', en: 'Guard' },
    params: [
      { id: 'shield', kind: 'range', zh: '护盾量', en: 'Shield', min: 5, max: cap((c) => c.shieldAmount), def: () => 20 },
      { id: 'secs', kind: 'range', zh: '护盾秒数', en: 'Shield seconds', min: 1, max: () => 8, def: () => 4, unit: { zh: '秒', en: 's' } },
      { id: 'heal', kind: 'range', zh: '治疗量', en: 'Heal', min: 4, max: cap((c) => c.healAmount), def: () => 12 },
    ],
    build: (p) => `(shield self ${p.shield} ${p.secs})\n(heal self ${p.heal})`,
  },
  {
    key: 'freeze', zh: '群体冰冻', en: 'Mass freeze', year: 1,
    desc: { zh: '范围内最近的几个敌人各吃一发冰弹（减速）；3 年级起可以改成定身。', en: 'The nearest few foes in range each take an ice bolt (it slows); from year 3 it can root instead.' },
    name: { zh: '群体冰冻', en: 'Mass Freeze' },
    params: [
      { id: 'r', kind: 'range', zh: '范围', en: 'Radius', min: 4, max: () => 20, def: () => 10, unit: { zh: '米', en: 'm' } },
      { id: 'n', kind: 'range', zh: '最多几个', en: 'At most', min: 1, max: cap((c) => Math.min(8, c.effectsPerCast)), def: () => 3 },
      { id: 'power', kind: 'range', zh: '每发威力', en: 'Power each', min: 2, max: cap((c) => c.boltPower), def: () => 8 },
      { id: 'mode', kind: 'select', zh: '效果', en: 'Effect', options: [{ v: 'ice', zh: '冰弹（减速）', en: 'ice bolt (slows)' }, { v: 'root', zh: '定身', en: 'root', year: 3 }], def: 'ice' },
    ],
    build: (p, y, s) => {
      const picks = Array.from({ length: Number(p.n) }, (_, i) => `(nth es ${i})`).join(' ');
      const act = p.mode === 'root' ? `(root e ${capsFor(y, s).rootSecs.toFixed(1)})` : `(bolt e ${p.power} :ice)`;
      return `(let es (enemies ${p.r}))\n(each e (list ${picks})\n  (when e ${act}))`;
    },
  },
  {
    key: 'summon', zh: '召唤', en: 'Conjure', year: 2,
    desc: { zh: '变出一个帮你打架的伙伴：2 年级蛇，3 年级飞鸟。', en: 'Conjure a helper that fights for you: a serpent in year 2, birds in year 3.' },
    name: { zh: '我的召唤', en: 'My Summon' },
    params: [
      { id: 'kind', kind: 'select', zh: '召唤物', en: 'Creature', options: [{ v: 'serpent', zh: '蛇', en: 'serpent', year: 2 }, { v: 'birds', zh: '飞鸟群', en: 'birds', year: 3 }], def: 'serpent' },
      { id: 'secs', kind: 'range', zh: '持续', en: 'Lasts', min: 5, max: () => 30, def: () => 20, unit: { zh: '秒', en: 's' } },
    ],
    build: (p) => `(summon :${p.kind} ${p.secs})`,
  },
  {
    key: 'glamour', zh: '变形术（换装）', en: 'Transfiguration (a new look)', year: 1,
    desc: { zh: '给自己换一身长袍：颜色、镶边和布料。灰色的布料要到更高年级才解锁。', en: 'New robes for yourself: colour, trim and cloth. Greyed-out cloths unlock in later years.' },
    name: { zh: '我的新长袍', en: 'My New Robes' },
    params: [
      { id: 'robe', kind: 'select', zh: '长袍颜色', en: 'Robe colour', options: COLOUR_OPTS, def: 'midnight' },
      { id: 'trim', kind: 'select', zh: '镶边颜色', en: 'Trim colour', options: COLOUR_OPTS, def: 'gold' },
      { id: 'mat', kind: 'select', zh: '布料', en: 'Cloth', options: MATERIAL_OPTS, def: 'velvet' },
    ],
    build: (p) => `(glamour :robe ${colour(p.robe)} :trim ${colour(p.trim)} :material :${p.mat})`,
  },
];

/** Is this option open to you? */
export const optionOpen = (o: TplOption, year: number, seals: number) => (o.year ?? 1) <= year && (o.seals ?? 0) <= seals;
/** Why an option is locked ("3 年级" / "第 1 道封印"), or ''. */
export function optionLock(o: TplOption, year: number, seals: number): string {
  if ((o.year ?? 1) > year) return L(`${o.year} 年级`, `year ${o.year}`);
  if ((o.seals ?? 0) > seals) return L(`禁书区第 ${o.seals} 道封印`, `seal ${o.seals}`);
  return '';
}
/** The default choices of a template at a year, clamped to what that year allows. */
export function tplDefaults(t: Template, year: number, seals = 0): Record<string, TplValue> {
  const out: Record<string, TplValue> = {};
  for (const p of t.params) {
    if (p.kind === 'range') out[p.id] = Math.max(p.min, Math.min(p.max(year, seals), p.def(year, seals)));
    else out[p.id] = (p.options.find((o) => o.v === p.def && optionOpen(o, year, seals)) ?? p.options.find((o) => optionOpen(o, year, seals)) ?? p.options[0]).v;
  }
  return out;
}
/** Keep choices inside what the year allows (a slider past the cap, a locked option). */
export function tplClamp(t: Template, values: Record<string, TplValue>, year: number, seals = 0): Record<string, TplValue> {
  const d = tplDefaults(t, year, seals);
  const out: Record<string, TplValue> = { ...d };
  for (const p of t.params) {
    const v = values[p.id];
    if (p.kind === 'range') { const n = Number(v); if (Number.isFinite(n)) out[p.id] = Math.max(p.min, Math.min(p.max(year, seals), Math.round(n))); }
    else if (typeof v === 'string' && p.options.some((o) => o.v === v && optionOpen(o, year, seals))) out[p.id] = v;
  }
  return out;
}

// ------------------------------------------------------------------ the next goal (下一步)
export interface GoalState {
  year: number; xp: number; xpNext: number | null; ui: string[]; seals: number; galleons: number; reputation: number; decree: boolean; house: string;
  /** Your own (non-curriculum) spells, or null before the armory arrived. */
  customSpells: number | null;
  /** Items in your trunk, or null before the armory arrived. */
  items: number | null;
  /** This week's O.W.L.s: passed, how many, how many your year may sit (null before the list arrived). */
  exams?: { passed: number; of: number; open: number } | null;
  /** Dumbledore's Army as it stands for you (null before the server said). */
  da?: { member: boolean; eligible: boolean } | null;
  /** You wear the Dark Mark. */
  darkLord?: boolean;
}
export type GoalAct = { cast: string } | { open: 'book' | 'tpl' | 'seals' | 'trunk' | 'board' | 'owl' | 'exams' | 'da' };
/** `pillar`: which of the three paths of play (README 怎么玩) the goal belongs to — 1 fight and duel, 2 write spells, 3 politics. */
export interface Goal { key: string; text: string; why: string; act?: GoalAct; actLabel?: string; pillar?: 1 | 2 | 3 }
const PIXIE_XP = CREATURES.pixie.xp;

/** The Restricted Section, offered as an elective once you are in year 2 (never before, never as the next step). */
const elective = (s: GoalState) => s.year >= 2 && s.seals < 4
  ? L(' 选修：禁书区（R）的封印谜题能提高咒语上限，不在主线上。', ' Elective: the Restricted Section (R) has seal puzzles that raise your caps; not on the main path.')
  : '';

/**
 * Exactly one next goal, derived from your own state (privateState + armory + the panels); null at the very end.
 * It walks the three pillars in turn — ① fight (pixies, gear, year 2) ② write (a spell of your own, an O.W.L.)
 * ③ politics (the DA, reputation, Minister) — and never sends you to the seals, which stay an elective.
 */
export function nextGoal(s: GoalState): Goal | null {
  const has = (k: string) => s.ui.includes(k);
  if (!has('revelio')) return {
    key: 'revelio', pillar: 1, text: L('施放「原形立现」，看清自己的斤两', 'Cast Revelio to see your own measure'),
    why: L('原形立现会点亮左上角：年级、声望、加隆、下一个称号。点下面的按钮直接施放（它不在快捷栏上，咒语书里也能找到）。', 'Revelio lights the top-left corner: your year, reputation, Galleons and next title. The button casts it (it is not on the hotbar; the spellbook has it too).'),
    act: { cast: 'Revelio' }, actLabel: L('施放', 'Cast'),
  };
  if (s.decree) return {
    key: 'decree', pillar: 3, text: L('你是魔法部长：颁布一道法令', 'You are Minister: issue a decree'),
    why: L('法令能改写世界规则（MCP 的 decree）。让你的 Agent 帮你起草。小心：颁布后 180 秒内，邓布利多军可以投票否决它。', 'A decree rewrites the rules of the world (MCP: decree). Ask your agent to draft one. Careful: for 180 s after, Dumbledore\'s Army may vote it down.'),
    act: { open: 'owl' }, actLabel: L('写信给 Agent', 'Write to your agent'),
  };
  if (s.year === 1 && s.xp < PIXIE_XP * 5) return {
    key: 'pixies', pillar: 1, text: L(`打 5 只康沃尔郡小精灵（${Math.min(5, Math.floor(s.xp / PIXIE_XP))}/5）`, `Defeat 5 Cornish Pixies (${Math.min(5, Math.floor(s.xp / PIXIE_XP))}/5)`),
    why: L(`小精灵成群住在城堡东南的草地上。点击一只或按 Tab 锁定，再按 1。它们怕冰：2 年级学会「${spellName('Glacius')}」打得更快。被围住了就按「${spellName('Protego')}」，或者退回大礼堂（安全区）。`, 'Pixies swarm the lawn south-east of the castle. Click one (or Tab), then 1. They hate ice: Glacius in year 2 kills them faster. Surrounded? Protego, or back to the Great Hall (safe zone).'),
  };
  if (s.items === 0 && s.galleons >= 15) return {
    key: 'shop', pillar: 1, text: L(`用 ${s.galleons} 加隆买一件装备`, `Spend your ${s.galleons} Galleons on gear`),
    why: L('打开行囊（T），商店里有护符、扫帚、指环和长袍。买下会自动穿上，生命、移速或回蓝马上变好。', 'Open the trunk (T): the shop sells an amulet, a broom, a ring and a robe. Bought gear is worn at once.'),
    act: { open: 'trunk' }, actLabel: L('打开商店', 'Open the shop'),
  };
  if (s.customSpells === 0) return {
    key: 'spell', pillar: 2, text: L('写你的第一个咒语：用模板，或让 Agent 帮你写', 'Write your first spell: from a template, or ask your agent'),
    why: L('咒语就是 Runes 程序。咒语书里「从模板开始」用下拉框和滑块就能拼出一个；或者点「🦉 让 Agent 帮我写」（没有 Agent？在猫头鹰邮递里召唤使魔）。', 'Spells are Runes programs. "Start from a template" in the spellbook builds one from menus and sliders; or press "🦉 Ask my agent" (no agent? summon a familiar in the Owl Post).'),
    act: { open: 'tpl' }, actLabel: L('从模板开始', 'Templates'),
  };
  if (s.year === 1) return {
    key: 'year2', pillar: 1, text: L(`升到 2 年级（经验 ${s.xp}/${s.xpNext ?? '—'}）`, `Reach year 2 (${s.xp}/${s.xpNext ?? '—'} XP)`),
    why: L(`打魔物攒经验：小精灵 ${PIXIE_XP}、魔鬼网 ${CREATURES.snare.xp}、八眼巨蛛 ${CREATURES.spider.xp}；O.W.L. 考试（K）及格也给经验。2 年级会学到「${spellName('Glacius')}」「${spellName('Finite Incantatem')}」「${spellName('Serpensortia')}」「${spellName('Point Me')}」和「${spellName('Expelliarmus')}」。`, `Defeat creatures for XP (pixie ${PIXIE_XP}, snare ${CREATURES.snare.xp}, acromantula ${CREATURES.spider.xp}); passing an O.W.L. (K) pays XP too. Year 2 brings Glacius, Finite Incantatem, Serpensortia, Point Me and Expelliarmus.`),
  };
  if (!has('point-me')) return {
    key: 'pointme', pillar: 1, text: L(`施放「${spellName('Point Me')}」解锁小地图`, 'Cast Point Me to unlock the minimap'),
    why: L('给我指路会点亮左下角的小地图：墙、湖、魔物和同学都在上面。', 'Point Me lights the minimap in the bottom-left corner: walls, the lake, creatures and classmates.'),
    act: { cast: 'Point Me' }, actLabel: L('施放', 'Cast'),
  };
  if (s.exams && s.exams.open > 0 && s.exams.passed === 0) return {
    key: 'owl', pillar: 2, text: L(`通过一门 O.W.L. 考试（本周 ${s.exams.passed}/${s.exams.of}）`, `Pass an O.W.L. (${s.exams.passed}/${s.exams.of} this week)`),
    why: L('每周 6 道实战考题：交一段 Runes，隐藏用例像单元测试一样评分，越省节点、gas 和法力分越高。及格给经验、加隆和声望，每题还有排行榜。按 K 或点咒语书上的「考试」书签。', 'Six exams a week: hand in Runes, graded by hidden cases like unit tests; fewer nodes, gas and mana score higher. A pass pays XP, Galleons and reputation, and every exam has a leaderboard. K, or the spellbook\'s O.W.L. ribbon.'),
    act: { open: 'exams' }, actLabel: L('去考试', 'Sit an exam'),
  };
  if (s.darkLord) return {
    key: 'darklord', pillar: 3, text: L('你是黑魔王：守住声望第一', 'You are the Dark Lord: hold on to first place'),
    why: L('伤害 +15%，但你的位置每 60 秒向全服公开，击晕你的人夺走你 30% 的声望。撑到学期末，你就是魔法部长。', 'Damage +15%, but your whereabouts are announced every 60 s and whoever stuns you takes 30% of your reputation. Last to the term\'s end and you are Minister.'),
    act: { open: 'board' }, actLabel: L('排行榜', 'Leaderboard'),
  };
  if (s.da && s.da.eligible && !s.da.member && s.year >= 2) return {
    key: 'da', pillar: 3, text: L('加入邓布利多军：弱者抱团', "Join Dumbledore's Army: the underdogs band together"),
    why: L('声望不高也能改变世界：成员一起能在法令颁布后 180 秒内投票否决它，三人以上同时打中一个目标伤害 ×1.25。按 J。', 'Low reputation can still change the world: members can vote down a decree within 180 s, and three hitting one target deal ×1.25. Press J.'),
    act: { open: 'da' }, actLabel: L('邓布利多军', "Dumbledore's Army"),
  };
  if (s.reputation < 100) return {
    key: 'cup', pillar: 3, text: L(`打怪与决斗，为学院杯赢声望（${s.reputation}/100）`, `Fight and duel for House Cup reputation (${s.reputation}/100)`),
    why: L('打魔物、和其他学院的巫师决斗、考 O.W.L. 都加声望（击晕强者夺走得更多）。学期结束时声望最高（至少 100）的人成为魔法部长。按 L 看排名。', 'Creatures, duels with other houses and O.W.L.s earn reputation (stunning the strong takes more). At term end the top wizard (at least 100) becomes Minister for Magic. L shows the ranks.') + elective(s),
    act: { open: 'board' }, actLabel: L('排行榜', 'Leaderboard'),
  };
  return {
    key: 'minister', pillar: 3, text: L('成为魔法部长：学期结束时声望第一', 'Become Minister for Magic: top reputation at term end'),
    why: L('学期结束时声望最高（至少 100）的巫师成为魔法部长，可以颁布一道法令改写世界规则；声望 ≥150 的第一名还会戴上黑魔标记（伤害 +15%，但位置公开）。', 'At the end of each term the highest-reputation wizard (min 100) becomes Minister and may issue one decree; the top one with 150+ also wears the Dark Mark (+15% damage, but seen by all).') + elective(s),
    act: { open: 'board' }, actLabel: L('排行榜', 'Leaderboard'),
  };
}

// ------------------------------------------------------------------ the stun overlay: what hit you, what to try
export interface Down { k: CreatureKind | 'wizard' | 'willow' | null; n: number; name?: string }
const WEAK_ZH: Record<string, string> = { fire: '火', ice: '冰', light: '光', lightning: '雷', arcane: '奥术' };
const ELEMENT_SPELL: Record<string, string> = { fire: 'Incendio', ice: 'Glacius', light: 'Lumos Solem', lightning: 'Reducto' };
const LEARN_YEAR: Record<string, number> = { Incendio: 1, Glacius: 2, 'Lumos Solem': 4, Reducto: 5 };
/**
 * One line under "被击晕了": who put you down and what to try next time, with hotbar keys where the spells are.
 * `slotOf` gives a spell's hotbar key (1-6) or 0.
 */
export function downAdvice(d: Down | null | undefined, slotOf: (spell: string) => number, year: number): string {
  const spell = (n: string) => { const k = slotOf(n); return `${spellName(n)}${k ? `(${k})` : ''}`; };
  const guard = L(`${spell('Protego')} / ${spell('Episkey')}`, `${spell('Protego')} / ${spell('Episkey')}`);
  const hall = L('或退回大礼堂（安全区）', 'or fall back to the Great Hall (safe zone)');
  if (!d || !d.k) return L(`下次试试 ${guard}，${hall}`, `Next time try ${guard}, ${hall}`);
  if (d.k === 'wizard') return L(`被巫师 ${d.name ?? '某人'} 击倒 —— 其他学院的玩家可以和你决斗。下次先套 ${spell('Protego')}，或待在大礼堂（安全区，禁止决斗）`, `Stunned by ${d.name ?? 'a wizard'} — players of other houses may duel you. Next time Protego first, or stay in the Great Hall (safe zone, no duels)`);
  if (d.k === 'willow') return L('打人柳会还手 —— 离它 8 米以外就安全了', 'The Whomping Willow hits back — stay 8 m away from it');
  const def = CREATURES[d.k];
  const who = creatureName(d.k, def.name);
  const head = d.n > 1 ? L(`被 ${d.n} 只${who}围攻`, `Swarmed by ${d.n} ${def.name}s`) : L(`被${who}击倒`, `Knocked out by a ${def.name}`);
  if (d.k === 'dementor') return L(`${head} —— 摄魂怪只怕「${spellName('Expecto Patronum')}」（3 年级）。夜里别去黑湖，${hall}`, `${head} — only Expecto Patronum (year 3) drives Dementors off. Keep away from the lake at night, ${hall}`);
  if (d.k === 'troll') return L(`${head} —— 巨怪一棒很疼：等 3 年级以上、结伴再来。${hall}`, `${head} — a troll hits hard: come back in year 3+, with friends. ${hall}`);
  // what it is weak to, preferring a spell you already know
  const known = (e: string) => (LEARN_YEAR[ELEMENT_SPELL[e]] ?? 9) <= year ? 1 : 0;
  const weak = Object.entries(def.weak).filter(([e, m]) => (m ?? 1) > 1 && ELEMENT_SPELL[e]).sort((a, b) => known(b[0]) - known(a[0]) || (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0];
  const ws = weak ? ELEMENT_SPELL[weak] : null;
  let counter = '';
  if (weak && ws) {
    const later = year < (LEARN_YEAR[ws] ?? 1) ? L(`（${LEARN_YEAR[ws]} 年级学会）`, ` (year ${LEARN_YEAR[ws]})`) : '';
    counter = L(`；它怕${WEAK_ZH[weak]}：${spell(ws)}${later}`, `; it hates ${weak}: ${spell(ws)}${later}`);
  }
  return L(`${head} —— 下次试试 ${guard}${counter}，${hall}`, `${head} — next time try ${guard}${counter}, ${hall}`);
}

// ------------------------------------------------------------------ asking an agent to write the spell (🦉 让 Agent 帮我写)
export function agentAsk(o: { draft: string; error: string; slot: number; name?: string }): string {
  const draft = o.draft.trim().replace(/\s+/g, ' ');
  const err = o.error.trim().replace(/^✗\s*/, '').replace(/\s+/g, ' ');
  const head = L(`帮我把这个咒语改好，铸造后放到 ${o.slot} 号栏`, `Please fix this spell, forge it and put it on hotbar slot ${o.slot}`);
  const body = draft ? L(`：${draft}`, `: ${draft}`) : L('：（还没写，帮我写一个好用的攻击咒语）', ': (nothing yet — write me a good attack spell)');
  const tail = err ? L(` —— 报错：${err}`, ` — error: ${err}`) : '';
  return `${head}${o.name ? L(`（名字：${o.name}）`, ` (name: ${o.name})`) : ''}${body}${tail}`.slice(0, 400);
}
/** The block to copy to an agent that is not connected yet: the request plus how to connect. */
export function agentPrompt(o: { draft: string; error: string; slot: number; name?: string; code?: string | null }): string {
  const connect = o.code
    ? L(`连上霍格沃茨，配对码 ${o.code}。`, `Connect to Hogwarts, pairing code ${o.code}.`)
    : L('连上霍格沃茨（我会在游戏里按 Esc 生成配对码告诉你）。', 'Connect to Hogwarts (I will press Esc in the game and read you the pairing code).');
  const draft = o.draft.trim();
  return [
    connect,
    L(`然后帮我把咒语书里的这个咒语改好，用 forge_spell 铸造${o.name ? `成「${o.name}」` : ''}，放到 ${o.slot} 号快捷栏（slot=${o.slot}）：`, `Then fix this spell from my spellbook, forge it with forge_spell${o.name ? ` as "${o.name}"` : ''} and put it on hotbar slot ${o.slot} (slot=${o.slot}):`),
    draft || L('（还没写 —— 帮我写一个好用的攻击咒语）', '(nothing yet — write me a good attack spell)'),
    o.error ? L(`现在的报错：${o.error.replace(/^✗\s*/, '')}`, `The error now: ${o.error.replace(/^✗\s*/, '')}`) : '',
    L('先用 simulate_spell 试一下，别浪费法力。', 'Try it with simulate_spell first so no mana is wasted.'),
  ].filter(Boolean).join('\n');
}

// ------------------------------------------------------------------ the shop (行囊 → 商店)
export const shopPrice = (s: ShopItem) => itemPrice(itemPoints(s.mods).points);
export const shopPoints = (s: ShopItem) => itemPoints(s.mods).points;
export { SHOP };
