import { STATIC_SOLIDS } from '../src/kernel/physics';
import { SIGHT_H, sees } from '../src/shared/curfew';
import { HOUSES, type EventId, type House } from '../src/shared/constants';
import { CARDS, CARD_SETS, cardsOfSet, type Card } from '../src/lore/cards';
import { L } from './i18n';

/**
 * The pure parts of the sprint-1 HUD (client/panels/fun.ts): the house strip, the event slip, the curfew hint, the
 * ceremony and the album, as data. No DOM, so test/fun-ui.test.ts can walk them against what the kernel sends
 * (the snapshot's `cup` and `ev`, privateState().fun).
 */

/** The snapshot's `cup` (World.cupView). */
export interface CupSnap {
  n: number; left: number; pts: number[]; fm: number; ch: string[];
  cer?: CeremonySnap;
}
export interface CeremonySnap {
  term: number; until: number; winner: House | null; points: Record<House, number>;
  mvp: Star | null; duelist: Star | null; hunter: Star | null; hero: Star | null; minister: string | null;
}
export interface Star { name: string; house: House; pts: number }
/** The snapshot's `ev` (kernel/wheel.ts wheelView). */
export interface EvSnap {
  id?: EventId; n?: number; left?: number; st?: 'on' | 'won' | 'lost'; x?: number; z?: number; hero?: string; nx?: number;
  hp?: number; m?: number; s?: { x: number; z: number }; p?: { k: 'filch' | 'norris'; x: number; z: number; f: number }[]; day?: boolean;
  r?: number; px?: number; pz?: number; left2?: number;
}
/** privateState().fun (World.funState). */
export interface FunMe {
  pts: number; cap: number; lost: number; src: Record<string, number>; cards: string[]; total: number;
  curfew: { caught: boolean; grace: number } | null;
}

/** The house strip: each house's points, its share of the leader's, the leader(s), and your house. */
export function stripModel(cup: CupSnap, mine?: House | null) {
  const max = Math.max(0, ...cup.pts);
  return HOUSES.map((h, i) => {
    const pts = Math.max(0, Math.round(cup.pts[i] ?? 0));
    return { house: h, pts, share: max > 0 ? pts / max : 0, lead: max > 0 && pts === max, mine: h === mine };
  });
}

/** "12:05" for the countdown; the last minute is 决胜时刻. */
export const countdown = (s: number) => { const t = Math.max(0, Math.ceil(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
export const finalMinute = (cup: CupSnap) => cup.fm > 1 && cup.left <= 60;

/** Each event's ink: an icon of the sprite and a short name. */
export const EVENT_INK: Record<EventId, { icon: string; zh: string; en: string }> = {
  troll: { icon: 'troll', zh: '地下教室有巨怪！', en: 'Troll in the dungeon!' },
  snitch: { icon: 'snitch', zh: '金色飞贼出现了', en: 'The Golden Snitch' },
  curfew: { icon: 'lantern', zh: '宵禁！费尔奇在巡逻', en: 'Curfew! Filch on patrol' },
  dementors: { icon: 'patronus', zh: '摄魂怪来袭', en: 'Dementors!' },
  peeves: { icon: 'swirl', zh: '皮皮鬼的墨水', en: "Peeves' ink" },
  room: { icon: 'key', zh: '有求必应屋', en: 'The Room of Requirement' },
};

/** The objective line of the event slip (the kernel's brief, said shorter). */
export function objective(ev: EvSnap): string {
  switch (ev.id) {
    case 'troll': return L('地窖楼梯口 · 合力打倒它 · 按伤害分学院分', 'Dungeon Stair · bring it down together · points by damage');
    case 'snitch': return L('魁地奇球场 · 贴近停半秒或用咒语打中 · +150', 'Quidditch pitch · stay close for 0.5 s or hit it with a spell · +150');
    case 'curfew': return ev.day ? L('教育令第 29 号：城堡里别被费尔奇看见 · 躲在柱子后面', 'Decree No. 29: in the castle, stay out of Filch\'s sight · hide behind pillars') : L('城堡里别被费尔奇和洛丽丝夫人看见 · 躲在柱子后面', 'In the castle, stay out of sight of Filch and Mrs Norris · hide behind pillars');
    case 'dementors': return L(`呼神护卫把它们赶走 · 还剩 ${ev.left2 ?? '?'} 只 · 本院没人倒下 +30`, `Expecto Patronum drives them off · ${ev.left2 ?? '?'} left · nobody down in your house: +30`);
    case 'peeves': return L('墨水会让你变慢 · 用咒语打中皮皮鬼 +30', 'The ink slows you · hit Peeves with a spell: +30');
    case 'room': return L(`八楼走廊来回走三趟 · 宝箱还剩 ${ev.left2 ?? 3} 个`, `Pace the seventh-floor corridor three times · ${ev.left2 ?? 3} chests left`);
    default: return '';
  }
}

/** The result slip: won or lost, and by whom. */
export function resultLine(ev: EvSnap): string {
  const name = ev.id ? L(EVENT_INK[ev.id].zh, EVENT_INK[ev.id].en) : '';
  if (ev.st === 'won') return ev.hero ? L(`${name} · ${ev.hero} 立功了！`, `${name} · ${ev.hero} did it!`) : L(`${name} · 成功！`, `${name} · done!`);
  return L(`${name} · 结束了`, `${name} · over`);
}

/** The troll's shared HP bar: 0..1. */
export const bossFrac = (ev: EvSnap) => (ev.m ? Math.max(0, Math.min(1, (ev.hp ?? 0) / ev.m)) : 0);

/** The castle curfew applies in (kernel/wheel.ts CASTLE). */
export const inCastle = (p: { x: number; z: number }) => p.x >= -64 && p.x <= 64 && p.z >= -73 && p.z <= -4;

/**
 * The curfew hint for someone at `me`: the nearest of Filch and Mrs Norris, how far, and whether they can see you —
 * the same rule the kernel catches you by (shared/curfew.ts), pillars and walls included, so the HUD reddens its
 * edge only when you would really be caught (the Marauder's Map aside).
 */
export function curfewHint(ev: EvSnap, me: { x: number; z: number }) {
  if (ev.id !== 'curfew' || ev.st !== 'on' || !ev.p?.length) return null;
  let best: { k: 'filch' | 'norris'; d: number; inCone: boolean } | null = null;
  for (const p of ev.p) {
    const d = Math.hypot(me.x - p.x, me.z - p.z);
    const inCone = sees(p, me, (ax, az, bx, bz) => !STATIC_SOLIDS.hitSegment(ax, az, bx, bz, SIGHT_H));
    if (!best || d < best.d) best = { k: p.k, d, inCone };
    else if (inCone && !best.inCone) best = { k: p.k, d, inCone };
  }
  return best ? { ...best, inside: inCastle(me), danger: best.inCone || best.d < 7 } : null;
}

/** Where the compass points for an event (the snitch and Peeves move; the rest have the event's spot). */
export function evTarget(ev: EvSnap): { x: number; z: number } | null {
  if (ev.id === 'snitch' && ev.s) return ev.s;
  if (ev.id === 'peeves' && ev.px !== undefined) return { x: ev.px, z: ev.pz! };
  if (ev.x !== undefined && ev.z !== undefined) return { x: ev.x, z: ev.z };
  return null;
}

// ------------------------------------------------------------------ the album
export const RARITY_INK: Record<Card['rarity'], { zh: string; en: string; cls: string }> = {
  common: { zh: '普通', en: 'Common', cls: 'r-common' },
  rare: { zh: '稀有', en: 'Rare', cls: 'r-rare' },
  epic: { zh: '史诗', en: 'Epic', cls: 'r-epic' },
  legendary: { zh: '传说', en: 'Legendary', cls: 'r-legendary' },
};

/** The album grouped for the panel: each set, then everyone else, with owned flags; and the set progress. */
export function albumModel(owned: readonly string[], filter: 'all' | 'owned' | 'missing' = 'all') {
  const have = new Set(owned);
  const keep = (c: Card) => filter === 'all' || (filter === 'owned' ? have.has(c.id) : !have.has(c.id));
  const groups = CARD_SETS.map((s) => ({ id: s.id as string, zh: s.zh, en: s.en, reward: s.title, cards: cardsOfSet(s.id).filter(keep).map((c) => ({ c, owned: have.has(c.id) })), have: cardsOfSet(s.id).filter((c) => have.has(c.id)).length, of: cardsOfSet(s.id).length }));
  const rest = CARDS.filter((c) => !c.set);
  groups.push({ id: 'others', zh: '著名巫师', en: 'Famous Witches and Wizards', reward: { zh: '', en: '' }, cards: rest.filter(keep).map((c) => ({ c, owned: have.has(c.id) })), have: rest.filter((c) => have.has(c.id)).length, of: rest.length });
  return { groups, owned: CARDS.filter((c) => have.has(c.id)).length, total: CARDS.length };
}

/** A card's monogram for its portrait: the first character of the name in the reader's language. */
export const monogram = (c: Card) => [...L(c.zh.replace(/^[「『]/, ''), c.en.replace(/^(The|It's) /, ''))][0] ?? '?';

/** The reveal queue: cards to flip over, one at a time, never the same event twice. */
export class RevealQueue {
  private q: { id: string; dup: boolean }[] = [];
  private seen = new Set<number>();
  push(evId: number, card: string, dup: boolean) {
    if (this.seen.has(evId)) return false;
    this.seen.add(evId);
    if (this.seen.size > 200) this.seen = new Set([...this.seen].slice(-100));
    this.q.push({ id: card, dup });
    return true;
  }
  next() { return this.q.shift() ?? null; }
  get size() { return this.q.length; }
}
