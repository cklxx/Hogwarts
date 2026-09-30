/**
 * 今日课表 (a Feature): three small goals a day for each player, so there is always a next thing to do.
 *
 * The day is QUEST_DAY_S of world time; each wizard's three goals are picked from QUESTS by the day and their handle
 * (the same all day, different for everyone, and the same on every run of a seeded world). Progress counts what the wizard's own counters gain
 * (creatures defeated, casts, spells forged, cards, rolls, perfect reflects, house points from school events and
 * Quidditch) — a counter that resets (a new term's ledger) never counts backwards. A goal pays QUEST_XP and
 * QUEST_GALLEONS once; all three add QUEST_ALL_XP: at most QUEST_DAY_MAX_XP a day (test/quests.test.ts).
 */
import type { Feature } from './feature.js';
import type { Wizard } from './types.js';
import type { World } from './world.js';

export const QUEST_DAY_S = 86400, QUEST_PER_DAY = 3, QUEST_XP = 15, QUEST_GALLEONS = 5, QUEST_ALL_XP = 15;
export const QUEST_DAY_MAX_XP = QUEST_PER_DAY * QUEST_XP + QUEST_ALL_XP;
const CHECK_S = 1;

interface QuestDef { id: string; n: number; zh: string; en: string; count: (w: Wizard) => number }
export const QUESTS: readonly QuestDef[] = [
  { id: 'hunt', n: 3, zh: '打倒 3 只生物', en: 'Defeat 3 creatures', count: (w) => w.stats.creatures },
  { id: 'cast', n: 12, zh: '施放 12 次咒语', en: 'Cast 12 spells', count: (w) => w.stats.casts },
  { id: 'forge', n: 1, zh: '写一个自己的咒语（铸造、抄或改编都算）', en: 'Write a spell of your own (forge, copy or fork)', count: (w) => w.stats.spells ?? 0 },
  { id: 'card', n: 1, zh: '收集一张巧克力蛙画片', en: 'Collect a Chocolate Frog card', count: (w) => w.cards?.length ?? 0 },
  { id: 'dodge', n: 3, zh: '翻滚躲开 3 次（空格）', en: 'Roll aside 3 times (Space)', count: (w) => w.stats.dodges ?? 0 },
  { id: 'reflect', n: 1, zh: '用盔甲护身完美反弹一次', en: 'Reflect a spell with a well-timed Protego', count: (w) => w.stats.reflects ?? 0 },
  { id: 'event', n: 1, zh: '在校园事件里为学院拿分', en: 'Earn house points in a school event', count: (w) => w.cup?.src.events ?? 0 },
  { id: 'quidditch', n: 1, zh: '打一场魁地奇并为学院拿分', en: 'Earn house points in a Quidditch match', count: (w) => w.cup?.src.quidditch ?? 0 },
];
const BY_ID = new Map(QUESTS.map((q) => [q.id, q]));

interface Progress { day: number; ids: string[]; got: number[]; last: number[]; paid: boolean[]; all: boolean }

declare module './world.js' {
  interface World {
    /** 今日课表 (this module's Feature): each player's goals for the day and how far they are. */
    quests: { of: Map<string, Progress>; acc: number };
  }
}

const dayOf = (world: World) => Math.floor(world.now / QUEST_DAY_S);
/** Three different goals for this wizard today (a small string hash of the day and the id; no world dice). */
export function pickQuests(day: number, wid: string): string[] {
  let h = 2166136261 ^ day;
  for (const c of wid) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const pool = QUESTS.map((q) => q.id), out: string[] = [];
  while (out.length < QUEST_PER_DAY) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const id = pool.splice(h % pool.length, 1)[0];
    out.push(id);
  }
  return out;
}

function progressOf(world: World, w: Wizard): Progress {
  const day = dayOf(world);
  let p = world.quests.of.get(w.id);
  if (!p || p.day !== day) {
    const ids = pickQuests(day, w.handle); // the public handle, not the random registry id: the kernel stays reproducible (bench.ts trace)
    p = { day, ids, got: ids.map(() => 0), last: ids.map((id) => BY_ID.get(id)!.count(w)), paid: ids.map(() => false), all: false };
    world.quests.of.set(w.id, p);
  }
  return p;
}

/** Count what the counters gained since the last look; pay what is newly done. */
function advance(world: World, w: Wizard) {
  const p = progressOf(world, w);
  p.ids.forEach((id, i) => {
    const q = BY_ID.get(id)!;
    const now = q.count(w);
    p.got[i] = Math.min(q.n, p.got[i] + Math.max(0, now - p.last[i]));
    p.last[i] = now;
    if (p.got[i] >= q.n && !p.paid[i]) {
      p.paid[i] = true;
      world.gainXp(w, QUEST_XP);
      w.galleons += QUEST_GALLEONS;
      world.emit('achievement', `📜 Today's lesson done: ${q.en}. +${QUEST_XP} XP, +${QUEST_GALLEONS} Galleons.`, { to: w.id, zh: `📜 今日课表完成一项：${q.zh}。经验 +${QUEST_XP}，加隆 +${QUEST_GALLEONS}。` });
    }
  });
  if (!p.all && p.paid.every(Boolean)) {
    p.all = true;
    world.gainXp(w, QUEST_ALL_XP);
    world.emit('achievement', `📜 Every lesson today done: +${QUEST_ALL_XP} XP. New ones tomorrow.`, { to: w.id, zh: `📜 今天的课全上完了：经验再 +${QUEST_ALL_XP}。明天有新的。` });
  }
  return p;
}

export function questStatus(world: World, wid: string) {
  const w = world.need(wid);
  const p = advance(world, w);
  return {
    day: p.day, resetsIn: Math.ceil((p.day + 1) * QUEST_DAY_S - world.now),
    lessons: p.ids.map((id, i) => { const q = BY_ID.get(id)!; return { id, zh: q.zh, en: q.en, got: p.got[i], of: q.n, done: p.paid[i] }; }),
    reward: { each: { xp: QUEST_XP, galleons: QUEST_GALLEONS }, allThree: { xp: QUEST_ALL_XP } },
  };
}

export const QUESTS_FEATURE: Feature = {
  id: 'quests',
  init(world) { world.quests = { of: new Map(), acc: 0 }; },
  stepLate(world, dt) {
    const q = world.quests;
    q.acc += dt;
    if (q.acc < CHECK_S) return;
    q.acc = 0;
    for (const w of world.wizards.values()) if (!w.npc && world.online(w)) advance(world, w);
  },
  save: (world) => Object.fromEntries(world.quests.of),
  load(world, data) {
    if (!data || typeof data !== 'object') return;
    for (const [id, p] of Object.entries(data as Record<string, Progress>)) if (p && Array.isArray(p.ids) && p.ids.every((x) => BY_ID.has(x))) world.quests.of.set(id, p);
  },
  tools: [{
    name: 'lessons', title: "Today's lessons", cost: 0, readOnly: true,
    description: `今日课表: your ${QUEST_PER_DAY} goals for today (the same all day, new ones tomorrow), how far you are, and what they pay (+${QUEST_XP} XP and ${QUEST_GALLEONS} Galleons each, +${QUEST_ALL_XP} XP for all three).`,
    input: {},
    run: (world, wid) => questStatus(world, wid),
  }],
  ws: (world, wid) => questStatus(world, wid),
};
