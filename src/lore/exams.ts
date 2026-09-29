/**
 * 普通巫师等级考试 (O.W.L.s) — the words around the exams in src/kernel/exams.ts: grade names, the subjects, the
 * achievements and the jokes. Chinese first, every line bilingual (see lore/memes.ts). Picking is by hash, never by RNG.
 */
import type { Line } from './memes.js';

/** Canon O.W.L. grades. O, E and A pass; P, D and T fail. */
export const GRADES = ['O', 'E', 'A', 'P', 'D', 'T'] as const;
export type Grade = (typeof GRADES)[number];
export const PASSING: ReadonlySet<Grade> = new Set(['O', 'E', 'A']);

export const GRADE_NAMES: Record<Grade, Line> = {
  O: { zh: '优秀', en: 'Outstanding' },
  E: { zh: '良好', en: 'Exceeds Expectations' },
  A: { zh: '及格', en: 'Acceptable' },
  P: { zh: '差', en: 'Poor' },
  D: { zh: '很差', en: 'Dreadful' },
  T: { zh: '巨怪', en: 'Troll' },
};

/** Canon O.W.L. subjects the exams are filed under. */
export const SUBJECTS = {
  charms: { zh: '魔咒学', en: 'Charms' },
  dada: { zh: '黑魔法防御术', en: 'Defence Against the Dark Arts' },
  creatures: { zh: '保护神奇生物', en: 'Care of Magical Creatures' },
  transfiguration: { zh: '变形术', en: 'Transfiguration' },
  astronomy: { zh: '天文学', en: 'Astronomy' },
  arithmancy: { zh: '算术占卜', en: 'Arithmancy' },
  muggle: { zh: '麻瓜研究', en: 'Muggle Studies' },
  apparition: { zh: '幻影显形', en: 'Apparition' },
  herbology: { zh: '草药学', en: 'Herbology' },
  healing: { zh: '医疗翼实习', en: 'Hospital Wing Practical' },
} satisfies Record<string, Line>;
export type Subject = keyof typeof SUBJECTS;

/** Achievements the exams grant (merged into world.ts ACHIEVEMENTS). */
export const OWL_ACHIEVEMENTS: Record<string, { name: string; zh: string; rep: number; text: string; textZh: string }> = {
  owl_all_o: {
    name: 'O.W.L.: Outstanding in Everything', zh: 'O.W.L. 全 O', rep: 30,
    text: 'Outstanding in every O.W.L. of the week. Hermione got ten O.W.L.s; she would like a word about your eleventh.',
    textZh: '本周每一门普通巫师等级考试都是「优秀」。赫敏拿了十个 O.W.L.，她想和你聊聊第十一个。',
  },
  owl_full_marks: {
    name: 'Passed Every O.W.L.', zh: 'O.W.L. 全科通过', rep: 10,
    text: 'You passed every O.W.L. of the week. Fred and George got three each, and look how they turned out.',
    textZh: '你通过了本周的全部普通巫师等级考试。弗雷德和乔治各只拿了三个，看看人家现在混得多好。',
  },
  owl_troll: {
    name: 'Troll in the Dungeon', zh: '地下教室里有巨怪', rep: 0,
    text: 'You earned a T. Troll — in the dungeon! Thought you ought to know.',
    textZh: '你拿到了一个 T。巨怪——在地下教室里！我想你应该知道。',
  },
};

/** Said when a submission earns a T (巨怪). `{exam}` is the exam's title. */
export const TROLL_LINES: readonly Line[] = [
  { zh: '巨怪！在地下教室里！……我想你应该知道。（奇洛教授晕倒了。）', en: 'TROLL! In the dungeon! ...Thought you ought to know. (Professor Quirrell faints.)' },
  { zh: '「{exam}」：T。考官说这份答卷让她想起了格洛普。', en: '"{exam}": T. The examiner says your answer reminded her of Grawp.' },
  { zh: '是勒维-奥-萨，不是勒维-奥-萨尔！——你的程序也一样。', en: "It's Levi-O-sa, not Levi-o-SAR! — and the same goes for your program." },
  { zh: '恭喜获得「巨怪」级评价：比「很差」还差一档，算是一种成就。', en: 'Congratulations on a Troll: one below Dreadful, which is an achievement of sorts.' },
  { zh: '罗恩：「她简直是个噩梦。」——说的不是赫敏，是你的答卷。', en: 'Ron: "She\'s a nightmare, honestly." — about your answer sheet, this time.' },
  { zh: '这份答卷在我的魔杖上是好的。——考场规则第一条：考官的魔杖说了算。', en: 'It works on my wand. — Exam rule one: the examiner\'s wand decides.' },
  { zh: '家养小精灵都看不下去了，多比想替你重考。', en: 'Even the house-elves winced. Dobby has offered to resit it for you.' },
];

/** Said on an O. `{exam}` is the exam's title. */
export const OUTSTANDING_LINES: readonly Line[] = [
  { zh: '「{exam}」：O。麦格教授的嘴角似乎上扬了一毫米。', en: '"{exam}": O. Professor McGonagall\'s mouth twitched by nearly a millimetre.' },
  { zh: '优秀！考官悄悄在你的名字旁边画了一颗星。', en: 'Outstanding! The examiner has quietly drawn a star beside your name.' },
  { zh: '给你的学院加十分！——哦不，考试给的学院分另算。那就再给你加一个 O。', en: 'Ten points to your house! — no, exams pay house points their own way. Have an O as well.' },
  { zh: '这段咒语短得让邓布利多想起了自己的第一段 Hello World。', en: 'A spell so short Dumbledore was reminded of his first Hello World.' },
];

/** The examination in one line, for tool descriptions and panels. */
export const OWL_BLURB: Line = {
  zh: '普通巫师等级考试：每周一套实战考题，每道题是一个固定的沙盒场景和若干隐藏测试用例。提交 Runes 源码，考场里真实施法、判分，不影响真实世界。',
  en: 'Ordinary Wizarding Levels: a weekly set of practical exams, each a fixed sandbox scene with hidden test cases. Submit Runes source; it is cast for real in a private exam hall and graded, and the live world is never touched.',
};
