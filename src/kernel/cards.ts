import { CARD_DUP_GALLEONS, CARD_RARITIES, type CardRarity } from '../shared/constants.js';
import { CARDS, CARD_BY_ID, CARD_SETS, cardsOfSet, type Card, type CardSetId } from '../lore/cards.js';
import { CHESTS, type ChestSpot } from '../shared/chests.js';
import { dist } from './physics.js';
import { compass } from '../shared/reveal.js';
import type { Wizard } from './types.js';
import type { World } from './world.js';

/**
 * 巧克力蛙画片 and hidden chests (README 巧克力蛙画片 / 隐藏宝箱). Every draw comes from the world's second seeded
 * stream (World.funRand), never Math.random and never the main RNG, so a seeded world always hands out the same
 * cards and the rest of the world is not disturbed. Nothing here costs money: cards are found, earned or dropped.
 */

/** How often each rarity comes out of a plain draw, and out of a "rare or better" draw (event prizes). */
export const RARITY_WEIGHTS: Record<'plain' | 'rare', Record<CardRarity, number>> = {
  plain: { common: 66, rare: 24, epic: 8, legendary: 2 },
  rare: { common: 0, rare: 64, epic: 28, legendary: 8 },
};

/** Draw a rarity with `u` in [0, 1). */
export function rarityFor(u: number, kind: 'plain' | 'rare' = 'plain'): CardRarity {
  const w = RARITY_WEIGHTS[kind];
  const total = CARD_RARITIES.reduce((s, r) => s + w[r], 0);
  let x = u * total;
  for (const r of CARD_RARITIES) { if (x < w[r]) return r; x -= w[r]; }
  return kind === 'rare' ? 'legendary' : 'common';
}

/** A card of that rarity with `u` in [0, 1). Prefers a card the wizard does not own yet (half the time), so albums fill. */
export function drawCard(u1: number, u2: number, kind: 'plain' | 'rare', owned: readonly string[] = []): Card {
  const r = rarityFor(u1, kind);
  const pool = CARDS.filter((c) => c.rarity === r);
  const missing = pool.filter((c) => !owned.includes(c.id));
  const from = missing.length && u2 < 0.5 ? missing : pool;
  return from[Math.min(from.length - 1, Math.floor((u2 < 0.5 ? u2 * 2 : (u2 - 0.5) * 2) * from.length))];
}

export interface CardGrant { card: Card; duplicate: boolean; galleons: number; set?: CardSetId }

/**
 * Give a wizard a card: a new one goes in the album (and may complete a set: its title, said once); a duplicate
 * becomes Galleons. The wizard hears about it privately with the card on the event (the browser's reveal).
 */
export function grantCard(world: World, w: Wizard, card: Card, why: { zh: string; en: string }): CardGrant {
  const album = (w.cards ??= []);
  const duplicate = album.includes(card.id);
  let galleons = 0;
  if (duplicate) {
    galleons = CARD_DUP_GALLEONS[card.rarity];
    w.galleons += galleons;
  } else album.push(card.id);
  const rz = RARITY_ZH[card.rarity];
  world.emit('card', duplicate
    ? `🐸 ${why.en}: a Chocolate Frog card — ${card.en} (${card.rarity}), which you already have. It becomes ${galleons} Galleons.`
    : `🐸 ${why.en}: a Chocolate Frog card — ${card.en} (${card.rarity})! ${album.length}/${CARDS.length} in your album.`, {
    to: w.id, card: card.id, zh: duplicate
      ? `🐸 ${why.zh}：一张巧克力蛙画片 ——「${card.zh}」（${rz}），你已经有了，换成 ${galleons} 加隆。`
      : `🐸 ${why.zh}：一张巧克力蛙画片 ——「${card.zh}」（${rz}）！画册 ${album.length}/${CARDS.length}。`,
  });
  let set: CardSetId | undefined;
  if (!duplicate && card.set && completes(w, card.set)) {
    set = card.set;
    const s = CARD_SETS.find((x) => x.id === set)!;
    const title = `${s.title.zh} ${s.title.en}`;
    if (!w.titles.includes(title)) w.titles.push(title);
    world.emit('achievement', `🏆 ${w.name} completed the "${s.en}" set of Chocolate Frog cards: "${s.title.en}".`, { who: [w.id], zh: `🏆 ${w.name} 集齐了巧克力蛙画片「${s.zh}」：获得称号「${s.title.zh}」。` });
  }
  return { card, duplicate, galleons, set };
}

export const RARITY_ZH: Record<CardRarity, string> = { common: '普通', rare: '稀有', epic: '史诗', legendary: '传说' };

export function completes(w: Wizard, set: CardSetId): boolean {
  const have = w.cards ?? [];
  return cardsOfSet(set).every((c) => have.includes(c.id));
}

/** A random card for a wizard, from the world's fun stream. */
export function rollCard(world: World, w: Wizard, kind: 'plain' | 'rare', why: { zh: string; en: string }): CardGrant {
  return grantCard(world, w, drawCard(world.funRand(), world.funRand(), kind, w.cards ?? []), why);
}

/** The album as MCP frog_cards and the browser's panel see it (ids only; the card texts are in lore/cards.ts). */
export function albumOf(w: Wizard) {
  const have = w.cards ?? [];
  return {
    owned: have.length, total: CARDS.length,
    cards: CARDS.map((c) => ({ id: c.id, name: c.en, zh: c.zh, rarity: c.rarity, set: c.set ?? null, owned: have.includes(c.id), ...(have.includes(c.id) ? { flavour: c.flavour.en, flavourZh: c.flavour.zh } : {}) })),
    sets: CARD_SETS.map((s) => ({ id: s.id, name: s.en, zh: s.zh, have: cardsOfSet(s.id).filter((c) => have.includes(c.id)).length, of: cardsOfSet(s.id).length, done: completes(w, s.id), reward: s.title.en, rewardZh: s.title.zh })),
    duplicates: 'A duplicate turns into Galleons: common 5, rare 12, epic 30, legendary 80. 重复的画片会换成加隆。',
    where: 'Cards drop from defeated creatures (rarely), come with event rewards (the snitch, the troll, Peeves, the Room of Requirement) and wait in hidden chests (F to open). Never sold. 画片从魔物身上掉落（很少）、来自校园事件奖励、藏在宝箱里（按 F 打开），从不出售。',
  };
}

// ------------------------------------------------------------------ hidden chests

/** Runes fragments found in chests: a torn page with a working spell and a line of lore. */
export const RUNES_FRAGMENTS: { zh: string; en: string; source: string }[] = [
  { zh: '一页残破的笔记：「先冻住，再点着。」', en: 'A torn note: "Freeze it first, then light it."', source: '(bolt (or target aim) 10 :ice)\n(after 0.4 (bolt (or target aim) 10 :fire))' },
  { zh: '混血王子的批注：「对付巨怪，用它自己的大棒。」', en: 'The Half-Blood Prince, in the margin: "For a troll, use its own club."', source: '(bolt (or target aim) 16 :arcane)' },
  { zh: '纳威的草药学作业背面：「魔鬼网怕光。」', en: 'On the back of Neville\'s Herbology essay: "Devil\'s Snare hates light."', source: '(bolt (or target aim) 20 :light)' },
  { zh: '韦斯莱双胞胎的草稿：「一个咒语，打三个人。」', en: 'A Weasley twins\' draft: "One spell, three people."', source: '(each e (enemies 10) (bolt e 6 :lightning))' },
  { zh: '赫敏的便签：「残血的先打。效率。」', en: 'Hermione\'s sticky note: "Finish the weakest first. Efficiency."', source: '(let t (first (enemies 20)))\n(when t (bolt t 15))' },
  { zh: '庞弗雷夫人的处方：「先止血，再包扎。」', en: 'Madam Pomfrey\'s prescription: "Stop the bleeding, then the bandage."', source: '(heal self 10)\n(regen self 3 5)' },
  { zh: '卢平的讲义：「守护神要想着最快乐的事。」', en: 'Lupin\'s lecture notes: "Think of your happiest memory."', source: '(patronus 8)' },
  { zh: '一张被咬过的羊皮纸：「护盾，然后跑。」', en: 'A nibbled scrap of parchment: "Shield, then run."', source: '(shield self 20 3)\n(haste self 1.4 3)' },
];

/** The chests nobody has opened this term. */
export function chestsLeft(world: World): ChestSpot[] {
  const opened = world.flags.chests?.term === world.term.n ? world.flags.chests.opened : {};
  return CHESTS.filter((c) => !opened[c.id]);
}

/** The nearest chest within reach of a wizard that is still closed this term. */
export function chestNear(world: World, w: Wizard, reach = 2.6): ChestSpot | null {
  let best: ChestSpot | null = null, bd = reach;
  for (const c of chestsLeft(world)) { const d = dist(c, w.pos); if (d <= bd) { bd = d; best = c; } }
  return best;
}
/**
 * 宝箱线索: where the chests still closed this term are, as places (not coordinates: it is a hunt), and how warm
 * the nearest one is from where you stand (playtest round 3: "13 chests, no way to find any").
 */
export function chestClues(world: World, w?: Wizard) {
  const left = chestsLeft(world);
  let near: { c: ChestSpot; d: number } | null = null;
  if (w) for (const c of left) { const d = dist(c, w.pos); if (!near || d < near.d) near = { c, d }; }
  // warmer and warmer (playtest round 4: "within 30 m" left a seeker pacing a whole courtyard)
  const warm = (d: number) => {
    const m = [5, 15, 30, 80].find((x) => d <= x);
    return m ? { en: `within ${m} m`, zh: `${m} 米内` } : { en: 'far off', zh: '还很远' };
  };
  return {
    left: left.length, total: CHESTS.length,
    where: left.map((c) => ({ en: c.en, zh: c.zh })),
    // and which way (round 5: one found by warmth alone, the second never): a compass point, north = −z
    ...(near ? { nearest: { en: near.c.en, zh: near.c.zh, distance: warm(near.d).en, distanceZh: warm(near.d).zh, ...(w ? { bearing: compass(Math.atan2(near.c.x - w.pos.x, -(near.c.z - w.pos.z))) } : {}) } } : {}),
  };
}
export { CHESTS, CARD_BY_ID };
