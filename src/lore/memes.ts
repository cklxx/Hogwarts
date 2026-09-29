/**
 * 梗 — the world's running jokes, shared by the kernel (events, NPCs, MCP flavour) and the client (loading tips).
 * Every line is bilingual and Chinese comes first: canon lines follow the 人民文学出版社 translations, the rest are
 * the jokes Chinese Harry Potter fans (and Chinese programmers) actually make. The English is a looser equivalent.
 *
 * Nothing here draws from the world's seeded RNG or Math.random: `pick`/`chance` hash whatever world state the
 * caller passes in (event counter, clock, handles), so seeded worlds stay deterministic. `Cooldowns` is the rate
 * limiter that keeps flavour a punchline rather than spam (see MEME for the gaps).
 */
import type { House } from '../shared/constants.js';
import { ZH_HOUSE } from '../shared/zh.js';

export interface Line { zh: string; en: string }

// ------------------------------------------------------------------ picking, templating, rate limiting

/** FNV-1a over the parts: a stable 32-bit hash (same inputs, same answer, on every machine). */
export function hash32(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    const s = `${p}\u0001`;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  }
  // final avalanche so that neighbouring seeds land on different lines
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

/** A deterministic choice from a pool, seeded by world state. */
export function pick<T>(pool: readonly T[], ...seed: (string | number)[]): T {
  if (!pool.length) throw new Error('empty meme pool');
  return pool[hash32(...seed) % pool.length];
}

/** A deterministic coin with probability p, seeded by world state. */
export function chance(p: number, ...seed: (string | number)[]): boolean {
  return hash32('chance', ...seed) / 0x100000000 < p;
}

/** Fill {placeholders}. A Line value fills zh with its zh and en with its en; anything else fills both. */
export function fill(l: Line, vars: Record<string, string | number | Line> = {}): Line {
  const sub = (s: string, lang: 'zh' | 'en') => s.replace(/\{(\w+)\}/g, (m, k: string) => {
    const v = vars[k];
    if (v === undefined) return m;
    return typeof v === 'object' ? v[lang] : String(v);
  });
  return { zh: sub(l.zh, 'zh'), en: sub(l.en, 'en') };
}

/** A house as a Line (格兰芬多 / Gryffindor). */
export const houseLine = (h: House | string): Line => ({ zh: ZH_HOUSE[h] ?? h, en: h });

/**
 * Named cooldowns on the world clock. `take` checks every [key, seconds] pair and, only if all are ready,
 * marks them all: a line that needs both "this wizard may" and "the feed may" never burns one without the other.
 */
export class Cooldowns {
  private at = new Map<string, number>();
  ready(key: string, now: number, secs: number) {
    const t = this.at.get(key);
    return t === undefined || now - t >= secs || now < t; // (a clock that went backwards — a restore — counts as ready)
  }
  take(now: number, ...gates: [key: string, secs: number][]) {
    if (!gates.every(([k, s]) => this.ready(k, now, s))) return false;
    for (const [k] of gates) this.at.set(k, now);
    if (this.at.size > 20000) this.prune(now, 3600);
    return true;
  }
  /** Forget marks older than maxAge seconds (they are all ready again anyway). */
  prune(now: number, maxAge: number) { for (const [k, t] of this.at) if (now - t > maxAge) this.at.delete(k); }
  get size() { return this.at.size; }
}

/** How often the world is allowed to be funny (seconds, world time). */
export const MEME = {
  /** Any public flavour line in the world feed: at most one per this many seconds, world-wide. */
  PUBLIC_GAP_S: 20,
  /** The same chat trigger from the same wizard. */
  TRIGGER_GAP_S: 30,
  /** NPC idle chatter, all NPCs together. */
  NPC_GAP_S: 25,
  /** A quip on a knock-out, world-wide. */
  STUN_GAP_S: 15,
  /** A quip on a fizzled cast, per wizard. */
  FIZZLE_GAP_S: 30,
  /** A remark on entering a place, per wizard; and the same place again. */
  PLACE_GAP_S: 90,
  PLACE_REPEAT_S: 900,
  /** Standing still this long (online, active, not casting) earns a 躺平 speech bubble; and again after as long. */
  AFK_S: 300,
  /** 内卷: this many creatures in this window is a grind; said at most every GRIND_GAP_S per wizard. */
  GRIND_KILLS: 12,
  GRIND_WINDOW_S: 180,
  GRIND_GAP_S: 900,
  /** 破防了: a broken Protego says so at most this often per wizard (speech bubble only). */
  SHIELD_GAP_S: 20,
  /** Hagrid lets a secret slip at most this often per wizard. */
  HAGRID_GAP_S: 120,
  /** When the Taboo is on, saying the name draws a Dementor at most this often per wizard. */
  TABOO_GAP_S: 300,
  /** "Ten points to Ravenclaw!": what one wizard may award (once per term, never to their own house)… */
  HOUSE_POINTS: 10,
  /** …and the most a house can receive that way in one term. */
  HOUSE_POINTS_CAP: 100,
} as const;

// ------------------------------------------------------------------ loading / idle tips (the client rotates these)

export const TIPS: Line[] = [
  { zh: '是勒维-奥-萨，不是勒维奥-萨。', en: "It's Levi-O-sa, not Levio-SA." },
  { zh: '邓布利多平静地问：你把名字投进火焰杯了吗？！', en: 'Dumbledore asked calmly: DID YOU PUT YOUR NAME IN THE GOBLET OF FIRE?!' },
  { zh: '咒语就是代码。写错一个括号，魔杖会冒烟。', en: 'Spells are code. Miss a bracket and your wand smokes.' },
  { zh: '「除你武器」不是谐音梗，是官方翻译。翻译老师 yyds。', en: '"Expelliarmus" — in Chinese it literally reads "remove your weapon". The translator deserves a statue.' },
  { zh: '「阿瓦达索命」念成「阿瓦达啃大瓜」，就从不可饶恕咒变成了吃瓜咒 🍉。', en: 'Mispronounce the Killing Curse as "Avada Kedmelon" and it becomes the Popcorn Charm. 🍉' },
  { zh: '伏地魔至今没找到自己的鼻子。请不要在他面前提「鼻子」。', en: 'Voldemort still has not found his nose. Please do not mention noses around him.' },
  { zh: '一个悲伤的故事：魔杖没电了。（法力会自己慢慢回来的。）', en: 'A sad story: my wand ran out of battery. (Mana comes back on its own.)' },
  { zh: '「我是赫敏·格兰杰。顺便说一句，你鼻子上有块土，你知道吗？」', en: '"I\'m Hermione Granger, by the way. You\'ve got dirt on your nose, did you know?"' },
  { zh: '这个咒语在我的魔杖上是好的。——每一个写 Runes 的巫师', en: '"It works on my wand." — every wizard who ever wrote Runes' },
  { zh: '先用「模拟」跑一遍再铸造。赫敏从不在考场上第一次念咒。', en: 'Simulate before you forge. Hermione never casts a spell for the first time in an exam.' },
  { zh: 'gas 就是咒语的呼吸。死循环会让魔杖 CPU 烧了。', en: 'Gas is a spell\'s breath. An infinite loop fries your wand\'s CPU.' },
  { zh: '要理解递归，你得先理解递归。——禁书区某页的批注', en: 'To understand recursion, you must first understand recursion. — a margin note in the Restricted Section' },
  { zh: 'Lisp 的括号比霍格沃茨的楼梯还多。楼梯有 142 座，有的星期五还会乱跑。', en: 'Lisp has more brackets than Hogwarts has staircases. There are 142, and some move on Fridays.' },
  { zh: '「又不是不能用。」——韦斯莱双胞胎评价自己的咒语', en: '"It works, doesn\'t it?" — the Weasley twins, on their own spells' },
  { zh: '这不是 bug，这是特性。——弗雷德和乔治', en: "It's not a bug, it's a feature. — Fred and George" },
  { zh: '在霍格沃茨，那些请求帮助的人总会得到帮助。（按 H 看全部按键。）', en: 'Help will always be given at Hogwarts to those who ask for it. (Press H for every key.)' },
  { zh: '八眼巨蛛怕火，康沃尔郡小精灵怕冰，魔鬼网怕光。罗恩怕蜘蛛。', en: 'Acromantulas fear fire, pixies fear ice, Devil\'s Snare fears light. Ron fears spiders.' },
  { zh: '摄魂怪只怕守护神。其次怕巧克力——卢平教授是这么说的。', en: 'Dementors fear only a Patronus. Chocolate helps afterwards — ask Professor Lupin.' },
  { zh: '礼堂里不许决斗。这是规矩，也是安全区。', en: 'No duelling in the Great Hall. It is the rule, and a safe zone.' },
  { zh: '按 B 打开咒语书：读课本咒语的源码，比抄作业还快。', en: 'Press B for the spellbook: read the curriculum\'s source. Faster than copying homework.' },
  { zh: '按 O 给你的 Agent 寄猫头鹰。埃罗尔可能会迟到，但从不失约。', en: 'Press O to owl your agent. Errol may be late, but he always arrives.' },
  { zh: '打小怪升年级，这叫学习；一天打八百只，这叫内卷。', en: 'Hunting creatures to level up is studying. Hunting eight hundred a day is grinding.' },
  { zh: '站着不动五分钟，头上会冒出「躺平中」。赫奇帕奇管这叫午休。', en: 'Stand still for five minutes and a "lying flat" bubble appears. Hufflepuffs call it a nap.' },
  { zh: '家养小精灵不是打工人。多比是自由的小精灵！', en: 'House-elves are not wage slaves. Dobby is a free elf!' },
  { zh: '「我爸爸会知道这件事的！」——马尔福，每周至少一次', en: '"My father will hear about this!" — Malfoy, at least once a week' },
  { zh: '马尔福的凡尔赛：「也没怎么练，随手一挥而已。」', en: 'Malfoy, humble-bragging: "I barely practised. Just a flick, really."' },
  { zh: '被「除你武器」了？栓Q。老魔杖的忠诚可能就这么换了主人。', en: 'Disarmed? Thank you very much. That is how the Elder Wand changes hands.' },
  { zh: '「为什么总是我？！」——西莫·斐尼甘，又一次炸掉了坩埚', en: '"Why is it always me?!" — Seamus Finnigan, one cauldron later' },
  { zh: '海格：「我不该说这个的。」（但你可以去他小屋门口问问。）', en: 'Hagrid: "I shouldn\'t have said that." (You could still ask him at his hut.)' },
  { zh: '斯内普：「翻到第三百九十四页。」', en: 'Snape: "Turn to page three hundred and ninety-four."' },
  { zh: '「这么多年了？」「一直如此。」', en: '"After all this time?" "Always."' },
  { zh: '差点没头的尼克：差半英寸，就能加入无头猎手队了。', en: 'Nearly Headless Nick: half an inch of neck away from the Headless Hunt.' },
  { zh: '哭泣的桃金娘住在二楼女生盥洗室。请不要在她面前说「死」。', en: 'Moaning Myrtle lives in the second-floor girls\' bathroom. Do not mention death.' },
  { zh: '皮皮鬼又往楼梯上倒墨水了。费尔奇正在找你——不管是不是你干的。', en: 'Peeves has inked the stairs again. Filch is looking for you, whoever did it.' },
  { zh: '比比多味豆：邓布利多年轻时吃到过一颗呕吐味的，从此只敢吃太妃糖。', en: 'Bertie Bott\'s Every Flavour Beans: Dumbledore once got vomit-flavoured, and stuck to toffee.' },
  { zh: '古灵阁的妖精不接受赊账。1 加隆 = 17 西可 = 493 纳特，别问为什么不是十进制。', en: 'Gringotts gives no credit. 1 Galleon = 17 Sickles = 493 Knuts. Do not ask why it is not decimal.' },
  { zh: '九又四分之三站台的秘诀：朝墙跑，别犹豫。写 Runes 也一样。', en: 'Platform nine and three-quarters: run at the wall, and do not hesitate. Same with Runes.' },
  { zh: '《霍格沃茨：一段校史》——赫敏读了两遍。Agent 可以用 hogwarts_a_history 读第三遍。', en: 'Hogwarts: A History — Hermione read it twice. Agents can read it a third time (hogwarts_a_history).' },
  { zh: '在霍格沃茨场地里不能幻影显形。你没读过《霍格沃茨：一段校史》吗？', en: 'You cannot Apparate on Hogwarts grounds. Haven\'t you read Hogwarts: A History?' },
  { zh: '每学期声望第一的人当魔法部长，可以改一次世界规则。权力越大，雕像越大。', en: 'The top wizard each term becomes Minister and rewrites the rules once. With great power comes a great statue.' },
  { zh: '学院杯 = 全院本学期声望之和。偶尔也有人喊「给拉文克劳加十分！」', en: 'The House Cup is the sum of a house\'s reputation this term. Now and then someone shouts "Ten points to Ravenclaw!"' },
  { zh: '只有邓布利多能在最后一刻给自己学院加一百七十分。偏心这种事，你学不来。', en: 'Only Dumbledore gets to hand his own house 170 points at the last minute.' },
  { zh: '猫头鹰会迷路，Agent 会断线，但暂停键永远在你手里。', en: 'Owls get lost and agents disconnect, but the pause switch is always yours.' },
  { zh: '你的 Agent 想颁布法令？它得先问你。沉默不等于同意。', en: 'Your agent wants to issue a decree? It has to ask you first. Silence is not consent.' },
  { zh: '独角兽会治疗站在它身边的人。伤害它，你只剩下半条命。', en: 'Unicorns heal whoever stands near. Harm one and you live but half a life.' },
  { zh: 'Hello World 是每个巫师的第一个咒语。不信你铸造一个试试。', en: 'Hello World is every wizard\'s first spell. Forge one and see.' },
  { zh: '伍德说：下雨天最适合训练魁地奇。没有人同意伍德。', en: 'Wood says rain is perfect Quidditch weather. Nobody agrees with Wood.' },
  { zh: '分院帽只会唱一首歌，但每年都改歌词。——最早的版本控制', en: 'The Sorting Hat sings one song and rewrites the lyrics every year. The first version control.' },
  { zh: '说出「神秘人」的真名需要勇气。魔法部倒台之后，还需要一点运气。', en: 'Saying You-Know-Who\'s name takes courage. After the Ministry falls, it takes luck as well.' },
  { zh: '击晕一个巫师前先鞠躬。决斗俱乐部的规矩，洛哈特唯一没教错的东西。', en: 'Bow before you duel. The one thing Lockhart taught correctly.' },
];

// ------------------------------------------------------------------ the Sorting Hat's song (on enrolment)

export const SORTING_SONG: Record<House, Line> = {
  Gryffindor: { zh: '你也许属于格兰芬多，那里有埋藏在心底的勇敢，他们的胆识、气魄和豪爽，使格兰芬多出类拔萃。', en: 'You might belong in Gryffindor, where dwell the brave at heart; their daring, nerve and chivalry set Gryffindors apart.' },
  Hufflepuff: { zh: '你也许属于赫奇帕奇，那里的人正直忠诚，赫奇帕奇的学子们坚忍诚实，不畏惧艰辛。', en: 'You might belong in Hufflepuff, where they are just and loyal; those patient Hufflepuffs are true and unafraid of toil.' },
  Ravenclaw: { zh: '如果你头脑精明，或许会进智慧的老拉文克劳，那些睿智博学的人，总会在那里遇见他们的同道。', en: "Or yet in wise old Ravenclaw, if you've a ready mind, where those of wit and learning will always find their kind." },
  Slytherin: { zh: '也许你会进斯莱特林，也许你在这里交上真诚的朋友，但那些狡诈阴险之辈却会不惜一切手段，去达到他们的目的。', en: "Or perhaps in Slytherin you'll make your real friends; those cunning folk use any means to achieve their ends." },
};

// ------------------------------------------------------------------ knock-outs

/** A wizard stuns a wizard. {k} knocked out {v}. */
export const STUN_QUIPS: Line[] = [
  { zh: '围观群众已就位：阿瓦达啃大瓜 🍉', en: 'The crowd has its popcorn ready. 🍉' },
  { zh: '{v} 破防了。', en: '{v}\'s defences: broken.' },
  { zh: '庞弗雷夫人已经在校医院铺好了床。', en: 'Madam Pomfrey has already made up a bed in the Hospital Wing.' },
  { zh: '{v}：「这不科学！」——这是魔法。', en: '{v}: "That\'s not scientific!" It\'s magic.' },
  { zh: '洛哈特式决斗教学：先倒下的那位是示范。', en: 'Lockhart\'s duelling method: whoever falls first was the demonstration.' },
  { zh: '{v} 的魔杖：我尽力了。', en: '{v}\'s wand: "I did my best."' },
  { zh: '家人们谁懂啊，{v} 刚出门就被击晕了。', en: 'Can you believe it — {v} barely stepped outside.' },
  { zh: '{k}：「下次记得先鞠躬。」', en: '{k}: "Bow first next time."' },
  { zh: '{v} 决定原地躺平一会儿。', en: '{v} has decided to lie flat for a bit.' },
  { zh: '差点没头的尼克飘过：「这点小伤，差半英寸都算不上。」', en: 'Nearly Headless Nick drifts by: "That\'s not even half an inch."' },
];

/** A knock-out by fire / ice / lightning / light. */
export const STUN_BY_ELEMENT: Record<string, Line[]> = {
  fire: [
    { zh: '芭比Q了。', en: 'Well, that\'s barbecued.' },
    { zh: '{v} 外焦里嫩。西莫表示：这次不是我。', en: '{v}: crispy outside, tender inside. Seamus says it wasn\'t him this time.' },
    { zh: '「火焰熊熊」——字面意思。', en: '"Incendio" — literally.' },
  ],
  ice: [
    { zh: '冻住，不许走！', en: 'Freeze! Don\'t move! (Not that {v} can.)' },
    { zh: '{v} 被冻成了一根冰棍。', en: '{v} has become an ice lolly.' },
  ],
  lightning: [
    { zh: '{v} 的发型炸了，但炸得很有个性。', en: '{v}\'s hair exploded. It is a look.' },
  ],
  light: [
    { zh: '{v}：「我的眼睛！」', en: '{v}: "My eyes!"' },
  ],
};

/** A Slytherin goes down. (Always, for anyone called Malfoy or Draco; now and then for the rest.) */
export const MALFOY_LINES: Line[] = [
  { zh: '{v}：「我爸爸会知道这件事的！」', en: '{v}: "My father will hear about this!"' },
  { zh: '{v}：「你们等着，我这就给我爸爸写信！」', en: '{v}: "Just you wait — I\'m owling my father!"' },
  { zh: '{v}：「这不公平！我爸爸是……算了，他会知道的。」', en: '{v}: "This isn\'t fair! My father is... never mind. He\'ll hear about it."' },
];

/** A Malfoy knocks someone out: 凡尔赛. */
export const VERSAILLES_LINES: Line[] = [
  { zh: '{k}：「也没怎么练，随手一挥而已。」（凡尔赛）', en: '{k}: "I barely practised. Just a flick, really."' },
  { zh: '{k}：「我爸爸说，这种程度的决斗不值得写信回家。」（凡尔赛）', en: '{k}: "Father says a duel this easy isn\'t worth an owl home."' },
  { zh: '{k}：「这根魔杖是爸爸随便买的，也就几百加隆吧。」（凡尔赛）', en: '{k}: "Father just picked this wand up. A few hundred Galleons, nothing much."' },
];

/** Seamus goes down (the NPC, or anyone of that name). */
export const SEAMUS_LINES: Line[] = [
  { zh: '{v}：「为什么总是我？！」', en: '{v}: "Why is it always me?!"' },
  { zh: '{v}：「家人们谁懂啊，这次我连魔杖都还没举起来！」', en: '{v}: "I hadn\'t even raised my wand this time!"' },
];

/** Knocked out by a creature (or the Willow). {v} is the wizard. */
export const CREATURE_STUN: Record<string, Line[]> = {
  spider: [
    { zh: '{v}：「为什么是蜘蛛？为什么不能是『跟着蝴蝶走』？」', en: '{v}: "Why spiders? Why couldn\'t it be \'follow the butterflies\'?"' },
    { zh: '罗恩从远处发来慰问：「我懂你。」', en: 'Ron, from a safe distance: "I know. I know."' },
  ],
  troll: [
    { zh: '「巨怪——在地下教室——还以为你应该知道。」', en: '"Troll — in the dungeons — thought you ought to know."' },
    { zh: '早知道就念「羽加迪姆勒维奥萨」了。', en: 'Should have said "Wingardium Leviosa".' },
  ],
  dementor: [
    { zh: '卢平：「吃块巧克力吧，会好受一点的。」', en: 'Lupin: "Eat some chocolate. It\'ll help."' },
    { zh: '{v} 想起了自己最糟糕的记忆：期末考试没复习。', en: '{v} relives their worst memory: an exam they did not revise for.' },
  ],
  pixie: [
    { zh: '洛哈特：「刚抓来的康沃尔郡小精灵！」——然后他就溜了。', en: 'Lockhart: "Freshly caught Cornish pixies!" — and then he left.' },
    { zh: '{v} 被一群蓝色的小东西挂上了吊灯。', en: '{v} has been hung from the chandelier by small blue things.' },
  ],
  snare: [
    { zh: '魔鬼网：越挣扎，缠得越紧。你没听斯普劳特教授的课吧？', en: 'Devil\'s Snare: the more you struggle, the tighter it gets. Skipped Herbology?' },
    { zh: '赫敏：「它怕光！」——{v}：「现在说有什么用！」', en: 'Hermione: "It hates light!" — {v}: "NOW you tell me!"' },
  ],
  inferius: [
    { zh: '阴尸怕火。{v} 大概是忘了。', en: 'Inferi fear fire. {v} forgot.' },
  ],
  willow: [
    { zh: '打人柳：「这是我的私人空间。」', en: 'The Whomping Willow: "Personal space, please."' },
    { zh: '{v} 把打人柳当成了一棵普通的树。它不这么认为。', en: '{v} mistook the Whomping Willow for an ordinary tree. It disagreed.' },
  ],
};

// ------------------------------------------------------------------ growing up

/** Appended to the public level-up line, by the new school year. */
export const LEVEL_QUIPS: Record<number, Line[]> = {
  2: [
    { zh: '现在可以学「除你武器」了——不是谐音梗，是官方翻译。', en: 'Expelliarmus is now on the syllabus.' },
    { zh: '二年级：密室的门……咳，没什么，当我没说。', en: 'Year two: the Chamber of... never mind. Forget I said anything.' },
  ],
  3: [
    { zh: '三年级：可以去霍格莫德了（前提是监护人签了字）。', en: 'Year three: Hogsmeade weekends! (If someone signed your form.)' },
    { zh: '三年级：守护神咒解锁。摄魂怪表示压力很大。', en: 'Year three: the Patronus Charm. The Dementors are feeling the pressure.' },
  ],
  4: [
    { zh: '四年级：火焰杯在向你招手。邓布利多正准备「平静地」问你一个问题。', en: 'Year four: the Goblet of Fire beckons. Dumbledore is preparing to ask you something, calmly.' },
    { zh: '四年级：圣诞舞会还缺舞伴。先卷一卷，再说脱单。', en: 'Year four: still no partner for the Yule Ball. Grind first, dance later.' },
  ],
  5: [
    { zh: '五年级：O.W.L.s 考试周。卷起来了，家人们。', en: 'Year five: O.W.L. week. Everyone is grinding.' },
    { zh: '五年级：乌姆里奇清了清嗓子：「咳，咳。」', en: 'Year five: Umbridge clears her throat. "Hem, hem."' },
  ],
  6: [
    { zh: '六年级：幻影显形课开课了——但不能在霍格沃茨场地里。', en: 'Year six: Apparition lessons — just not on the grounds.' },
    { zh: '六年级：二手课本上写满了批注，署名「混血王子」。', en: 'Year six: your second-hand textbook is full of notes signed "the Half-Blood Prince".' },
  ],
  7: [
    { zh: '七年级：N.E.W.T.s。据说有人为了逃这门考试，跑去找魂器了。', en: 'Year seven: N.E.W.T.s. Rumour has it someone skipped them to hunt Horcruxes.' },
    { zh: '七年级：毕业快乐！……等等，禁林里的蜘蛛还没打完。', en: 'Year seven: congratulations! ...The spiders in the forest have not heard.' },
  ],
};

/** Said to a wizard when their title changes (by XP, a year, or a broken seal). */
export const TITLE_QUIPS: Record<string, Line[]> = {
  squib: [{ zh: '恭喜！你从麻瓜「晋升」为哑炮。费尔奇和费格太太向你表示欢迎。', en: 'Congratulations! Promoted from Muggle to Squib. Filch and Mrs Figg welcome you.' }],
  apprentice: [{ zh: '学徒：课本终于能看懂一半了。另一半是批注。', en: 'Apprentice: you understand half the textbook now. The other half is margin notes.' }],
  wizard: [{ zh: '巫师：海格说得没错——「你是个巫师！」（他只是迟到了两年。）', en: 'Wizard: Hagrid was right — "You\'re a wizard!" (He was just two years late.)' }],
  prefect: [{ zh: '级长：珀西·韦斯莱亲自教你擦级长徽章。一天三次。', en: 'Prefect: Percy Weasley will personally teach you to polish the badge. Three times a day.' }],
  'auror-trainee': [{ zh: '见习傲罗：疯眼汉穆迪盯着你：「时刻保持警惕！」', en: 'Auror Trainee: Mad-Eye Moody glares at you. "CONSTANT VIGILANCE!"' }],
  auror: [{ zh: '傲罗：唐克斯问你要不要一起换个发色。', en: 'Auror: Tonks asks if you want to change hair colour together.' }],
  warlock: [{ zh: '大巫师：你的帽子自己变尖了。', en: 'Warlock: your hat has grown pointier on its own.' }],
  'chief-warlock': [{ zh: '威森加摩首席：邓布利多也坐过这把椅子。它有点硬。', en: 'Chief Warlock: Dumbledore sat in this chair too. It is a bit hard.' }],
  merlin: [{ zh: '梅林：以后有人喊「梅林的胡子！」，说的可能就是你。', en: 'Merlin: from now on, "Merlin\'s beard!" might mean yours.' }],
};

/** 内卷: too many creatures too fast. */
export const GRIND_LINES: Line[] = [
  { zh: '🔥 内卷警告：禁林里的八眼巨蛛已经开始排队了。', en: '🔥 Grind alert: the Acromantulas have started queueing.' },
  { zh: '🔥 你这么卷，赫敏都要喊你休息了。', en: '🔥 You grind so hard even Hermione says take a break.' },
  { zh: '🔥 卷，都可以卷。但记得去礼堂吃饭。', en: '🔥 Grind away. But do eat in the Great Hall.' },
];

/** 躺平: a speech bubble over a wizard standing still for a long time. */
export const AFK_BUBBLES: Line[] = [
  { zh: '躺平中……', en: 'Lying flat...' },
  { zh: '（在霍格沃茨发呆）', en: '(staring into the middle distance)' },
  { zh: '别叫我，我在冥想。', en: 'Shh. Meditating.' },
  { zh: 'zzz……分院帽说我适合赫奇帕奇……zzz', en: 'zzz... the Hat said Hufflepuff... zzz' },
];

/** 破防了: a speech bubble when a Protego gives way. */
export const SHIELD_BREAK: Line[] = [
  { zh: '破防了！', en: 'Shield broken!' },
  { zh: '盔甲护身……护了个寂寞。', en: 'Protego... protected nothing.' },
];

// ------------------------------------------------------------------ spells that fail (spells are code)

export type FizzleKind = 'gas' | 'parse' | 'unknown' | 'mana' | 'range' | 'complex' | 'leviosar';

/** Which kind of failure an error message is (null: not one we joke about). */
export function fizzleKind(error: string | undefined): FizzleKind | null {
  const e = error ?? '';
  if (/out of gas/.test(e)) return 'gas';
  if (/Levi-O-sa/.test(e)) return 'leviosar';
  if (/^not enough mana/.test(e)) return 'mana';
  if (/unclosed|mismatched|unexpected|empty spell|empty form|a form must start|nesting deeper/.test(e)) return 'parse';
  if (/unknown (name|spell word)|no such word/.test(e)) return 'unknown';
  if (/out of range/.test(e)) return 'range';
  if (/too complex/.test(e)) return 'complex';
  return null;
}

export const FIZZLE_QUIPS: Record<FizzleKind, Line[]> = {
  gas: [
    { zh: '🪄 这个咒语在我的魔杖上是好的。', en: '🪄 It works on my wand.' },
    { zh: '🪄 魔杖 CPU 烧了。', en: '🪄 Your wand\'s CPU is toast.' },
    { zh: '🪄 要理解递归，你得先理解递归。', en: '🪄 To understand recursion, you must first understand recursion.' },
    { zh: '🪄 gas 用完了，咒语原地躺平。', en: '🪄 Out of gas. The spell lay down where it stood.' },
  ],
  parse: [
    { zh: '🪄 括号没配对，魔杖冒了一股青烟。', en: '🪄 Unbalanced brackets. Your wand gives off a puff of smoke.' },
    { zh: '🪄 Lisp 的括号比八楼的楼梯还绕。数一数？', en: '🪄 More brackets than the castle has staircases. Count them?' },
    { zh: '🪄 编译都没过，谈何魔法。', en: '🪄 It does not even parse. Magic comes later.' },
  ],
  unknown: [
    { zh: '🪄 你念的是如尼文，还是鬼画符？赫敏看了都沉默。', en: '🪄 Is that Ancient Runes or chicken scratch? Even Hermione is speechless.' },
    { zh: '🪄 咒语书里查无此词。看看 grimoire？', en: '🪄 No such word in any spellbook. Try the grimoire?' },
  ],
  mana: [
    { zh: '🪄 一个悲伤的故事：魔杖没电了。', en: '🪄 A sad story: the wand ran out of battery.' },
    { zh: '🪄 法力见底。来块蜂蜜公爵的巧克力？', en: '🪄 Mana is empty. A Honeydukes chocolate, perhaps?' },
  ],
  range: [
    { zh: '🪄 够不着。魔杖又不是金箍棒。', en: '🪄 Out of reach. A wand is not a telescoping staff.' },
    { zh: '🪄 太远了，魔咒在半路下车了。', en: '🪄 Too far. The spell got off the bus halfway.' },
  ],
  complex: [
    { zh: '🪄 咒语太复杂了。祖传代码，建议重构。', en: '🪄 Too complex. Legacy code: consider refactoring.' },
  ],
  leviosar: [
    { zh: '🪄 赫敏：「是勒维-奥-萨，不是勒维奥-萨！」', en: '🪄 Hermione: "It\'s Levi-O-sa, not Levi-o-SAR!"' },
    { zh: '🪄 罗恩的发音，罗恩的命运。', en: '🪄 Ron\'s pronunciation, Ron\'s fate.' },
  ],
};

/** Spell names the forge has opinions about (a note in forge_spell's result; no effect on the spell). */
export const FORGE_NAME_EGGS: { re: RegExp; line: Line }[] = [
  { re: /hello[\s_-]*world|你好[\s，,]*世界/i, line: { zh: '每个伟大的巫师都从 Hello World 开始。现在施放它试试。', en: 'Every great wizard starts with Hello World. Now cast it.' } },
  { re: /rm\s*-rf|删库/i, line: { zh: '删库跑路？在霍格沃茨，跑路只能跑去阿兹卡班。（放心，这个咒语只是名字吓人。）', en: 'rm -rf? At Hogwarts the only place to run is Azkaban. (Relax: it is just a scary name.)' } },
  { re: /^sudo\b/i, line: { zh: 'sudo 在这里不管用。想提权？先当上魔法部长。', en: 'sudo does nothing here. Want root? Become Minister for Magic.' } },
  { re: /啃大瓜/, line: { zh: '这不是索命咒，是吃瓜咒 🍉。魔法部表示不予追究。', en: 'Not the Killing Curse — the Popcorn Charm 🍉. The Ministry will not press charges.' } },
  { re: /yyds|永远的神/i, line: { zh: '名字起得很自信。是不是 yyds，施放了才知道。', en: 'A confident name. Whether it is legendary, the casting will tell.' } },
  { re: /\b(todo|fixme)\b/i, line: { zh: 'TODO：以后再说。——每个巫师都这么说，从来没有以后。', en: 'TODO: later. Every wizard says so. Later never comes.' } },
  { re: /stack\s*overflow|栈溢出/i, line: { zh: '别慌：gas 会在栈溢出之前先让咒语躺平。', en: 'Relax: gas stops the spell long before the stack overflows.' } },
];

/** A spell of this name, cast successfully, earns the Hello World achievement. */
export const isHelloWorld = (name: string) => /^\s*(hello[\s_,-]*world|你好[\s，,]*世界)\s*[!！.。]*\s*$/i.test(name);

/** When forging a spell under a curriculum name (appended to the refusal). */
export const LEGACY_CODE: Line = { zh: '祖传代码，不要动。', en: 'Legacy code. Do not touch.' };

// ------------------------------------------------------------------ Galleons, Gringotts and owls

/** One of these goes into forge_item's notes. {g} is the Galleons left. */
export const GRINGOTTS: Line[] = [
  { zh: '古灵阁提醒您：加隆一旦花出，概不退还。（余额 {g} 加隆）', en: 'Gringotts reminds you: Galleons spent are Galleons gone. ({g} left)' },
  { zh: '妖精拉环：「古灵阁从不赊账。」（余额 {g} 加隆）', en: 'Griphook: "Gringotts does not give credit." ({g} left)' },
  { zh: '1 加隆 = 17 西可 = 493 纳特。别问为什么不是十进制。（余额 {g} 加隆）', en: '1 Galleon = 17 Sickles = 493 Knuts. Do not ask why it is not decimal. ({g} left)' },
  { zh: '海格说，除了霍格沃茨，古灵阁是世上最安全的地方。你的 {g} 加隆在那里很安心。', en: 'Hagrid says Gringotts is the safest place in the world, bar Hogwarts. Your {g} Galleons are resting easy.' },
  { zh: '打怪如打工，花钱如流水。打工人，打工魂。（余额 {g} 加隆）', en: 'Earned like a day job, spent like water. ({g} left)' },
];

/** Errol delivers a parcel (sometimes). {item} {from} */
export const ERROL: Line[] = [
  { zh: '埃罗尔（韦斯莱家的老猫头鹰）一头栽进了你的箱子。包裹倒是完好无损：「{item}」，来自 {from}。', en: 'Errol (the Weasleys\' elderly owl) crash-lands in your trunk. The parcel survived: "{item}", from {from}.' },
  { zh: '猫头鹰迟到了三个小时，还顺路去霍格莫德吃了个馅饼。包裹：「{item}」，来自 {from}。', en: 'The owl is three hours late and stopped in Hogsmeade for a pasty. Parcel: "{item}", from {from}.' },
];

/** A sock! (forge_item with a sock in the name.) */
export const DOBBY_SOCK: { toSelf: Line; toOther: Line } = {
  toSelf: { zh: '你送了自己一只袜子。多比表示：这样不算数。', en: 'You gave yourself a sock. Dobby says that does not count.' },
  toOther: { zh: '🧦 主人给了多比一只袜子！多比是自由的小精灵了！（多比不是打工人。）', en: '🧦 Master has given Dobby a sock! Dobby is free!' },
};

// ------------------------------------------------------------------ chat triggers

export type TriggerId =
  | 'always' | 'yer_wizard' | 'hagrid' | 'goblet' | 'caps' | 'points' | 'points_from' | 'trevor' | 'page394' | 'nick' | 'myrtle'
  | 'peeves' | 'dobby' | 'hermione' | 'voldemort' | 'you_know_who' | 'nose' | 'weasley_king' | 'leviosar' | 'alohomora' | 'melon';

/** A "N points to House" / "给X加N分" award in a chat line: the house, or null. */
export function pointsAward(text: string): House | null {
  const en = text.toLowerCase().match(/\b(?:\w+)\s+points?\s+to\s+(gryffindor|hufflepuff|ravenclaw|slytherin)\b/);
  if (en) return (en[1][0].toUpperCase() + en[1].slice(1)) as House;
  const zh = text.replace(/\s+/g, '').match(/(格兰芬多|赫奇帕奇|拉文克劳|斯莱特林)加[\d一二两三四五六七八九十百千]{1,4}分/);
  if (zh) return (Object.entries(ZH_HOUSE).find(([, v]) => v === zh[1])?.[0] ?? null) as House | null;
  return null;
}

/** Which triggers a chat line sets off (in a stable order). `n` is lower-case letters only; raw text catches Chinese. */
export function chatTriggers(text: string): TriggerId[] {
  const n = text.toLowerCase().replace(/[^a-z]/g, '');
  const z = text.replace(/[\s，,。.!！?？「」“”"'、~～…]/g, '');
  const letters = text.replace(/[^A-Za-z]/g, '');
  const out: TriggerId[] = [];
  const on = (id: TriggerId, cond: boolean) => { if (cond) out.push(id); };
  on('always', n.includes('afterallthistime') || z.includes('这么多年了'));
  on('yer_wizard', /(yer|youre|youare)awizard/.test(n) || z.includes('你是个巫师') || z.includes('你是一个巫师'));
  on('hagrid', n.includes('hagrid') || z.includes('海格'));
  on('goblet', n.includes('gobletoffire') || z.includes('火焰杯'));
  on('caps', letters.length >= 12 && letters === letters.toUpperCase());
  on('points', pointsAward(text) !== null);
  on('points_from', /\bpoints?\s+from\s+(gryffindor|hufflepuff|ravenclaw|slytherin)\b/i.test(text) || /(格兰芬多|赫奇帕奇|拉文克劳|斯莱特林)扣[\d一二两三四五六七八九十百千]{1,4}分/.test(z));
  on('trevor', n.includes('trevor') || /\btoad\b/i.test(text) || z.includes('特雷弗') || z.includes('蟾蜍'));
  on('page394', n.includes('turntopage') || /\b394\b/.test(text) || z.includes('三百九十四页') || z.includes('第394页'));
  on('nick', n.includes('nearlyheadless') || z.includes('差点没头'));
  on('myrtle', n.includes('myrtle') || z.includes('桃金娘'));
  on('peeves', n.includes('peeves') || z.includes('皮皮鬼'));
  on('dobby', n.includes('dobby') || z.includes('多比'));
  on('hermione', /i(a|)mhermione/.test(n) || z.includes('我是赫敏'));
  on('voldemort', n.includes('voldemort') || z.includes('伏地魔'));
  on('you_know_who', n.includes('youknowwho') || n.includes('hewhomustnotbenamed') || z.includes('神秘人') || z.includes('那个连名字都不能提的人'));
  on('nose', n.includes('whereismynose') || z.includes('我的鼻子呢'));
  on('weasley_king', n.includes('weasleyisourking') || z.includes('韦斯莱是我们的王'));
  on('leviosar', n.includes('leviosar'));
  on('alohomora', n.includes('alohomora') || z.includes('阿拉霍洞开'));
  on('melon', z.includes('啃大瓜'));
  return out;
}

/** What the castle says back. Private unless noted in world.ts. {name} is the speaker. */
export const REPLIES: Partial<Record<TriggerId, Line[]>> = {
  always: [
    { zh: '地下教室深处，一个低沉的声音：「一直如此。」', en: 'From deep in the dungeons, a quiet voice: "Always."' },
  ],
  goblet: [
    { zh: '邓布利多平静地问：「{name}，你把名字投进火焰杯了吗？！」', en: 'Dumbledore asked calmly: "{NAME}, DID YOU PUT YOUR NAME IN THE GOBLET OF FIRE?!"' },
  ],
  caps: [
    { zh: '（系统提示：检测到大写锁定。邓布利多当年也是这么「平静地」问的。）', en: '(Caps lock detected. That is how Dumbledore asks "calmly", too.)' },
  ],
  points_from: [
    { zh: '只有教授能扣分。不过麦格教授确实一晚上从格兰芬多扣掉过一百五十分。', en: 'Only professors take points. Though McGonagall once took a hundred and fifty from Gryffindor in one night.' },
  ],
  page394: [
    { zh: '斯内普的声音从地下教室传来：「翻到第三百九十四页。」——狼人那一章。', en: 'Snape\'s voice drifts up from the dungeons: "Turn to page three hundred and ninety-four." The chapter on werewolves.' },
  ],
  nick: [
    { zh: '尼克幽幽地飘过：「请叫我敏西-波平顿的尼古拉斯爵士。」——他的头还连着半英寸，所以进不了无头猎手队。', en: 'Nick drifts past, wounded: "Sir Nicholas de Mimsy-Porpington, if you please." Half an inch of neck keeps him out of the Headless Hunt.' },
  ],
  myrtle: [
    { zh: '哭泣的桃金娘从最近的水管里冒了出来：「你们是不是又在背后说我？！」', en: 'Moaning Myrtle bursts out of the nearest pipe: "Were you talking about me behind my back?!"' },
  ],
  peeves: [
    { zh: '皮皮鬼从天花板上倒挂下来，冲你做了个鬼脸，把一个水弹扔向了费尔奇的方向。', en: 'Peeves hangs upside down from the ceiling, pulls a face, and lobs a water balloon in Filch\'s general direction.' },
  ],
  dobby: [
    { zh: '远处传来一个尖细的声音：「多比是自由的小精灵！」（多比不是打工人。）', en: 'A squeaky voice from somewhere: "Dobby is a free elf!"' },
  ],
  hermione: [
    { zh: '「我是赫敏·格兰杰。顺便说一句，你鼻子上有块土，你知道吗？」', en: '"I\'m Hermione Granger, by the way. You\'ve got dirt on your nose, did you know?"' },
  ],
  voldemort: [
    { zh: '{name} 说出了那个名字。周围的人齐齐倒吸一口凉气。', en: '{name} said the name. Everyone nearby gasps.' },
  ],
  you_know_who: [
    { zh: '邓布利多：「叫他伏地魔吧。对名字的恐惧，只会加剧对这个人本身的恐惧。」', en: 'Dumbledore: "Call him Voldemort. Fear of a name increases fear of the thing itself."' },
  ],
  nose: [
    { zh: '伏地魔（远程）：「你礼貌吗？」', en: 'Voldemort, from afar: "Rude."' },
  ],
  weasley_king: [
    { zh: '♪ 韦斯莱是我们的王，韦斯莱是我们的王，他从不让鬼飞球进框，韦斯莱是我们的王！♪', en: '♪ Weasley is our King, Weasley is our King, he didn\'t let the Quaffle in, Weasley is our King! ♪' },
  ],
  leviosar: [
    { zh: '赫敏头也不回：「是勒维-奥-萨，不是勒维奥-萨！」', en: 'Hermione, without looking up: "It\'s Levi-O-sa, not Levi-o-SAR!"' },
  ],
  alohomora: [
    { zh: '「阿拉霍洞开！」……这扇门其实没锁。你推一下试试？', en: '"Alohomora!" ...The door was not locked. Try pushing it.' },
  ],
  melon: [
    { zh: '🍉 吃瓜群众已就位。（这不是不可饶恕咒，魔法部不予追究。）', en: '🍉 The onlookers have their popcorn. (Not an Unforgivable. The Ministry is not interested.)' },
  ],
};

/** "You're a wizard" — depends on whether the speaker is still a Muggle. */
export const YER_A_WIZARD: { muggle: Line; wizard: Line } = {
  muggle: { zh: '海格：「你是个巫师，{name}。」——严格来说你现在还是麻瓜。先去赚 30 点经验吧。', en: 'Hagrid: "Yer a wizard, {name}." Strictly speaking you are still a Muggle. Go earn 30 XP.' },
  wizard: { zh: '海格：「你是个巫师！」你：「我知道。我都 {year} 年级了。」', en: 'Hagrid: "Yer a wizard!" You: "I know. I\'m in year {year}."' },
};

/** Trevor: at the lake he is found; anywhere else Neville is still looking. */
export const TREVOR: { found: Line; lost: Line } = {
  found: { zh: '🐸 你在黑湖边的石头底下找到了特雷弗！纳威会感激你一辈子的。', en: '🐸 You found Trevor under a stone by the Black Lake! Neville will be grateful forever.' },
  lost: { zh: '纳威：「有人看见一只蟾蜍吗？」（它最喜欢湿乎乎的地方……）', en: 'Neville: "Has anyone seen a toad?" (He does like damp places...)' },
};

/** Hagrid, near his hut, says a bit too much. Never the true secrets: only nudges already in Hogwarts: A History. */
export const HAGRID_HINTS: Line[] = [
  { zh: '海格：「打人柳的树根那儿有个树结……用束缚咒打它的树干，它就老实了。」——「我不该说这个的。」', en: 'Hagrid: "There\'s a knot at the Willow\'s roots... hit its trunk with a binding charm an\' it goes quiet." — "I shouldn\'t have said that."' },
  { zh: '海格：「八楼那面空墙……来回走三趟，心里想着你需要的东西。」——「我不该说这个的。我不该说这个的。」', en: 'Hagrid: "That blank wall on the seventh floor... walk past three times, thinkin\' hard." — "I shouldn\'t have said that. I shouldn\'t have said that."' },
  { zh: '海格：「在魁地奇球场上喊一嗓子『火弩箭飞来』……」——「我什么都没说！」', en: 'Hagrid: "Shout \'Accio Firebolt\' on the Quidditch pitch an\'..." — "I never said nothin\'!"' },
  { zh: '海格：「邓布利多的墓……别去打扰他老人家。他那根魔杖……」——「我不该说这个的。」', en: 'Hagrid: "Dumbledore\'s tomb... don\'t go botherin\' him. That wand of his..." — "I shouldn\'t have said that."' },
  { zh: '海格：「路威喜欢音乐，一放音乐它就睡着了。」——「我不该说这个的！」', en: 'Hagrid: "Fluffy loves music. Play him a bit an\' he\'s off to sleep." — "I shouldn\'t have said that!"' },
  { zh: '海格：「尼可·勒梅——」「我不该说这个的！我不该说这个的！」', en: 'Hagrid: "Nicolas Flamel —" "I shouldn\'t have said that! I shouldn\'t have said that!"' },
  { zh: '海格：「蜘蛛怕火。阿拉戈克的孩子们……别跟它们说是我说的。」', en: 'Hagrid: "Spiders hate fire. Aragog\'s lot... don\'t tell \'em I told yeh."' },
  { zh: '海格：「有张旧羊皮纸，得先大声发誓你不怀好意……」——「我什么都没说！」', en: 'Hagrid: "There\'s an old bit o\' parchment — yeh have ter swear yer up ter no good, out loud..." — "I never said nothin\'!"' },
  { zh: '海格：「凤凰的眼泪能治伤。福克斯有时候会在场地上空唱歌。」', en: 'Hagrid: "Phoenix tears heal. Fawkes sings over the grounds, now an\' then."' },
  { zh: '海格：「魔鬼网怕光，也怕火。斯普劳特教授教过的，你没听？」', en: 'Hagrid: "Devil\'s Snare hates light an\' fire. Professor Sprout taught yeh that, didn\'t she?"' },
  { zh: '海格：「独角兽……千万别伤害它们。那可是要付出代价的。」', en: 'Hagrid: "Unicorns... never hurt one. There\'s a price for that."' },
];

/** "Ten points to X!" */
export const POINTS: Record<'given' | 'own' | 'again' | 'fresh' | 'full', Line> = {
  given: { zh: '🏆 {name}：「给{house}加十分！」——{house}学院分 +{n}。', en: '🏆 {name}: "Ten points to {house}!" — {house} +{n} house points.' },
  own: { zh: '只有邓布利多能在最后一刻给自己的学院加一百七十分。偏心这种事，你学不来。（不能给自己学院加分。）', en: 'Only Dumbledore gets to give his own house 170 points at the last minute. (You cannot award your own house.)' },
  again: { zh: '这学期你已经加过分了。下学期请早。', en: 'You have already awarded points this term. Try again next term.' },
  fresh: { zh: '你入学还不到十分钟，教授们还不认识你呢。', en: 'You enrolled less than ten minutes ago. The professors do not know you yet.' },
  full: { zh: '教授们觉得，这学期给{house}加的分已经够多了。', en: 'The professors feel {house} has been given plenty of points this term.' },
};

/** When the Taboo is on and the name draws a Dementor. */
export const TABOO_DEMENTOR: Line = { zh: '你的防护魔法应声碎裂。一个摄魂怪循着那个名字，朝你飘了过来。', en: 'Your protective enchantments shatter. A Dementor drifts toward you, following the name.' };

// ------------------------------------------------------------------ places, time and weather

/** A private remark when a wizard walks into a place (by zone id). */
export const PLACE_LINES: Record<string, Line[]> = {
  great_hall: [
    { zh: '礼堂的天花板映着外面的天空。蜡烛飘在半空，家养小精灵在楼下厨房里忙活——多比说他们不是打工人。', en: 'The Great Hall ceiling shows the sky outside. Candles float; somewhere below, house-elves cook (not wage slaves, Dobby insists).' },
    { zh: '长桌上摆满了烤鸡和南瓜汁。罗恩已经吃上了。', en: 'The long tables are laden with roast chicken and pumpkin juice. Ron has already started.' },
  ],
  courtyard: [
    { zh: '皮皮鬼在庭院上空转圈，手里抓着一把粉笔头。小心头顶。', en: 'Peeves circles the Courtyard with a fistful of chalk. Mind your head.' },
    { zh: '庭院里有人在交换巧克力蛙画片。「又是邓布利多！」', en: 'Someone in the Courtyard is swapping Chocolate Frog cards. "Dumbledore again!"' },
  ],
  seventh_floor: [
    { zh: '傻巴拿巴还在挂毯上教巨怪跳芭蕾。巨怪们看起来很痛苦。', en: 'Barnabas the Barmy is still teaching trolls ballet on the tapestry. The trolls look miserable.' },
  ],
  greenhouses: [
    { zh: '三号温室里的曼德拉草在闹脾气。戴好耳罩。', en: 'The Mandrakes in Greenhouse Three are sulking. Earmuffs on.' },
  ],
  dungeons: [
    { zh: '地下教室又冷又潮。空气里一股缩身药水的味道——有人又把雏菊根切成了块，而不是片。', en: 'The dungeons are cold and damp. It smells of Shrinking Solution: someone diced the daisy roots instead of slicing them.' },
    { zh: '墙上的火把晃了一下。你莫名觉得该给斯莱特林扣五分。', en: 'A torch flickers. You feel an inexplicable urge to take five points from someone.' },
  ],
  tomb: [
    { zh: '白色大理石墓安安静静。湖面上吹来一阵风。', en: 'The white marble tomb is quiet. A breeze comes off the lake.' },
  ],
  willow: [
    { zh: '打人柳的枝条动了动，像是在热身。', en: 'The Whomping Willow\'s branches twitch, as if warming up.' },
  ],
  lake_shore: [
    { zh: '大乌贼把一根触手伸出水面，懒洋洋地晒太阳。', en: 'The giant squid lifts a tentacle out of the water to sunbathe.' },
  ],
  forest: [
    { zh: '禁林，顾名思义，禁止入内。你已经进来了。', en: 'The Forbidden Forest is, as the name suggests, forbidden. You are in it.' },
    { zh: '树林深处传来咔嗒咔嗒的声音。罗恩要是在，已经跑了。', en: 'Clicking, deep in the trees. Ron would already be running.' },
  ],
  pitch: [
    { zh: '伍德的战术板还立在场边，上面画满了箭头。没人看得懂。', en: 'Wood\'s tactics board still stands by the pitch, covered in arrows. Nobody understands it.' },
  ],
  hogsmeade: [
    { zh: '蜂蜜公爵糖果店飘出甜香。三把扫帚里有人在喝黄油啤酒。', en: 'A sweet smell drifts from Honeydukes. Someone is drinking Butterbeer in the Three Broomsticks.' },
    { zh: '佐科笑话店的橱窗里摆着粪蛋。弗雷德和乔治会想你的。', en: 'Dungbombs in Zonko\'s window. Fred and George would approve.' },
  ],
  azkaban: [
    { zh: '阿兹卡班：冷，湿，还没有 Wi-Fi。', en: 'Azkaban: cold, damp, and no signal.' },
  ],
};

/** A remark for look(), by time of day. */
export const TIME_REMARKS: Record<'dawn' | 'day' | 'dusk' | 'night', Line[]> = {
  dawn: [
    { zh: '天刚亮。猫头鹰正从猫头鹰棚里飞出去送早报。', en: 'Dawn. The owls are leaving the Owlery with the morning post.' },
    { zh: '清晨。伍德已经在球场上等你训练了。', en: 'Early morning. Wood is already on the pitch, waiting for practice.' },
  ],
  day: [
    { zh: '白天。上课时间，但你显然在逃课。', en: 'Daytime. Lessons are on; you are clearly skipping them.' },
    { zh: '阳光正好，适合在湖边躺平。', en: 'Lovely sun. Good for lying flat by the lake.' },
  ],
  dusk: [
    { zh: '黄昏。礼堂里的蜡烛一根根亮了起来。', en: 'Dusk. One by one, the candles in the Great Hall light up.' },
  ],
  night: [
    { zh: '夜里。宵禁了，费尔奇和洛丽丝夫人正在巡逻。', en: 'Night. Curfew; Filch and Mrs Norris are on patrol.' },
    { zh: '夜深了。黑湖边的摄魂怪出来了——带好守护神。', en: 'Late at night. The Dementors are out by the lake. Bring a Patronus.' },
  ],
};

export const WEATHER_REMARKS: Record<string, Line[]> = {
  rain: [{ zh: '下雨了。伍德说这种天气正适合训练。没人同意伍德。', en: 'Raining. Wood says it is perfect training weather. Nobody agrees with Wood.' }],
  snow: [{ zh: '下雪了。弗雷德和乔治在给雪球施魔法。', en: 'Snowing. Fred and George are bewitching snowballs.' }],
  fog: [{ zh: '大雾。连摄魂怪都迷路了。', en: 'Thick fog. Even the Dementors are lost.' }],
};

/** Which part of the day an hour (0-24) is. */
export function dayPart(hour: number, night: boolean): 'dawn' | 'day' | 'dusk' | 'night' {
  if (night) return 'night';
  if (hour < 8) return 'dawn';
  if (hour >= 18) return 'dusk';
  return 'day';
}

// ------------------------------------------------------------------ NPC chatter

/** Idle chatter, by NPC name. */
export const NPC_LINES: Record<string, Line[]> = {
  'Seamus Finnigan': [
    { zh: '为什么总是我？！', en: 'Why is it always me?!' },
    { zh: '我只是念了句「羽加迪姆勒维奥萨」……', en: 'I only said "Wingardium Leviosa"...' },
    { zh: '那本来应该是水的！', en: 'That was meant to be water!' },
    { zh: '家人们谁懂啊，我就想把水变成朗姆酒，结果坩埚炸了。', en: 'Honestly — I tried to turn water into rum and the cauldron exploded.' },
    { zh: '我的眉毛呢？谁看见我的眉毛了？', en: 'Where are my eyebrows? Has anyone seen my eyebrows?' },
    { zh: '火焰熊熊！……好吧，这次确实有点太熊熊了。', en: 'Incendio! ...Right. A bit more incendio than planned.' },
    { zh: '爆炸不是事故，是我的个人风格。', en: 'Explosions aren\'t accidents. They\'re my signature.' },
    { zh: '芭比Q了，我的魔药作业。', en: 'Well, my Potions homework is barbecued.' },
  ],
  'Hannah Abbott': [
    { zh: '有人看见斯普劳特教授了吗？', en: 'Has anyone seen Professor Sprout?' },
    { zh: '当心魔鬼网！', en: 'Mind the Devil\'s Snare!' },
    { zh: '大家待在一起。', en: 'Stay together, everyone.' },
    { zh: '赫奇帕奇不内卷，但赫奇帕奇从不掉队。', en: 'Hufflepuffs don\'t grind. Hufflepuffs also never fall behind.' },
    { zh: '我带了南瓜馅饼，谁要？', en: 'I brought pumpkin pasties. Anyone?' },
    { zh: '曼德拉草要换盆了，记得戴耳罩。', en: 'The Mandrakes need repotting. Earmuffs on.' },
    { zh: '找东西？我们赫奇帕奇最会找了。', en: 'Lost something? We Hufflepuffs are particularly good finders.' },
  ],
  'Padma Patil': [
    { zh: '过人的聪明才智是人类最大的财富。', en: 'Wit beyond measure is man\'s greatest treasure.' },
    { zh: '又是小精灵。冻住它们。', en: 'Pixies again. Freeze them.' },
    { zh: '格雷女士知道的比她说的多。', en: 'The Grey Lady knows more than she says.' },
    { zh: '我们休息室的门不问密码，问谜语。今天的是：先有凤凰，还是先有火？', en: 'Our common room asks riddles, not passwords. Today: which came first, the phoenix or the flame?' },
    { zh: '看你咒语的缩进，我就知道你不是拉文克劳的。', en: 'I can tell from your indentation you\'re not a Ravenclaw.' },
    { zh: '帕瓦蒂又去上占卜课了。她说我今天会遇到一只小精灵。……准了。', en: 'Parvati\'s at Divination again. She said I\'d meet a pixie today. She was right.' },
  ],
  'Gregory Goyle': [
    { zh: '呃。', en: 'Uh.' },
    { zh: '克拉布？克拉布！', en: 'Crabbe? Crabbe!' },
    { zh: '……啥？', en: '...wha?' },
    { zh: '蛋糕。', en: 'Cake.' },
    { zh: '德拉科说，他爸爸会知道的。', en: 'Draco says his father will hear about this.' },
    { zh: '（掰着手指）一、二……二。', en: '(counting on fingers) One, two... two.' },
    { zh: '我……忘了我要说什么了。', en: 'I... forgot what I was gonna say.' },
  ],
};

/** Extra chatter at night / in weather (mixed into the NPC's own pool). */
export const NPC_NIGHT: Line[] = [
  { zh: '天黑了，湖边的摄魂怪要出来了。', en: 'It\'s dark. The Dementors will be out by the lake.' },
  { zh: '宵禁了！费尔奇和洛丽丝夫人在巡逻。', en: 'Curfew! Filch and Mrs Norris are on patrol.' },
  { zh: '夜游被抓要扣五十分的……每人。', en: 'Out after hours is fifty points... each.' },
];
export const NPC_WEATHER: Record<string, Line[]> = {
  rain: [{ zh: '又下雨了。伍德肯定又要加练了。', en: 'Raining again. Wood will want extra practice.' }],
  snow: [{ zh: '下雪了！打雪仗吗？', en: 'Snow! Snowball fight?' }],
  fog: [{ zh: '雾这么大，我连自己的魔杖都看不见。', en: 'So foggy I can\'t see my own wand.' }],
};

/** Said by an NPC of `house` to a wizard of another house nearby. {house} is theirs. */
export const NPC_RIVAL: Record<House, Line[]> = {
  Gryffindor: [{ zh: '{house}的？来决斗俱乐部练练？我保证这次不炸。', en: 'A {house}? Duelling Club later? I promise not to explode this time.' }],
  Hufflepuff: [{ zh: '你好呀，{house}的朋友！吃个馅饼？', en: 'Hello, {house}! Pasty?' }],
  Ravenclaw: [{ zh: '{house}的同学，考你一个谜语？答错不扣分。', en: 'A riddle for the {house}? No points lost for a wrong answer.' }],
  Slytherin: [{ zh: '你……{house}的。哼。', en: 'You... {house}. Hmph.' }],
};

// ------------------------------------------------------------------ MCP flavour

/** A line in whoami for agents, by nothing in particular. */
export const WHOAMI_QUOTES: Line[] = [
  { zh: '「决定我们成为什么样的人的，不是我们的能力，而是我们的选择。」——邓布利多', en: '"It is our choices that show what we truly are, far more than our abilities." — Dumbledore' },
  { zh: '「沉湎于虚幻的梦想而忘记现实的生活，这是毫无益处的。」', en: '"It does not do to dwell on dreams and forget to live."' },
  { zh: '「幸福的时光也能在最黑暗的时刻找到，只要记得开灯。」', en: '"Happiness can be found even in the darkest of times, if one only remembers to turn on the light."' },
  { zh: '「我们都有光明和黑暗的一面，重要的是我们选择展现哪一面。」——小天狼星', en: '"We\'ve all got both light and dark inside us. What matters is the part we choose to act on." — Sirius' },
  { zh: '「当然是发生在你脑子里的事，哈利，但为什么这就意味着它不是真的呢？」', en: '"Of course it is happening inside your head, Harry, but why on earth should that mean that it is not real?"' },
  { zh: '你是一个 Agent，也是一个巫师。别问哪个更重要——分院帽也答不上来。', en: 'You are an agent and a wizard. Do not ask which matters more; the Sorting Hat cannot say either.' },
  { zh: '「言语是我们最取之不竭的魔法源泉。」——对 Agent 来说，字面意思。', en: '"Words are our most inexhaustible source of magic." For an agent, literally.' },
  { zh: '先 look，再 cast。先 simulate，再 forge。先问主人，再颁布法令。', en: 'Look before you cast. Simulate before you forge. Ask your human before you decree.' },
];
