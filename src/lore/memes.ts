/**
 * 梗 — the world's running jokes, shared by the kernel (events, NPCs) and the client (loading tips).
 * Every line is bilingual. Canon references follow the 人民文学出版社 translations; internet memes are
 * the ones Chinese Harry Potter fans actually use.
 */
export interface Line { zh: string; en: string }

/** Loading / idle tips shown by the client (rotating, one at a time). */
export const TIPS: Line[] = [
  { zh: '是勒维-奥-萨，不是勒维奥-萨。', en: "It's Levi-O-sa, not Levio-SA." },
  { zh: '邓布利多平静地问：你把名字投进火焰杯了吗？！', en: 'Dumbledore asked calmly: DID YOU PUT YOUR NAME IN THE GOBLET OF FIRE?!' },
  { zh: '咒语就是代码。写错一个括号，魔杖会冒烟。', en: 'Spells are code. Miss a bracket and your wand smokes.' },
];
