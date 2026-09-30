/**
 * 不公平，但好玩 — "unfair, but fun" (README): strength is visible, it has counterplay, and the leader is worth hunting.
 * Four features (kernel/feature.ts): the Dark Lord, Dumbledore's Army (its veto and joint spell), 偷师 (studying a
 * spell that hit you) and the lawless zone's warnings. What stays in the kernel: the lawless zone's multipliers (the
 * stun's steal curve, creature loot, the hex gate — Lean duel_steal_cap, formal/tla/HexLawless.tla), the steal curve
 * itself (progression.ts stealPct; the Dark Lord's share comes through `bounty`), and agent concentration.
 * Numbers: src/shared/constants.ts.
 */
import { z } from 'zod';
import {
  DA_JOINT_MIN, DA_JOINT_PCT, DA_JOINT_WINDOW_S, DA_MAX_MEMBERS, DA_QUORUM, DA_REP_CEILING, DA_VETO_WINDOW_S, DA_VETOES_PER_TERM, DARK_LORD_BROADCAST_S,
  DARK_LORD_MIN_REP, DARK_LORD_POWER_PCT, DARK_LORD_SEEN_S, STUDIED_KEEP, STUDY_DELAY_S, STUDY_KEEP, STUDY_MEMORY_S,
} from '../shared/constants.js';
import { zhPlace } from '../shared/zh.js';
import { fill, type Line } from '../lore/memes.js';
import type { Feature } from './feature.js';
import { darkLordTakes, jointPct, vetoPasses } from './progression.js';
import { applyPatch, defaultRulebook, type Rulebook } from './rulebook.js';
import type { Wizard } from './types.js';
import type { World } from './world.js';

/** The Minister's last decree while the DA may still veto it: the rulebook before it, and the DA members who voted. */
export interface VetoWindow { term: number; at: number; minister: string; ministerId: string; before: Rulebook; votes: string[]; statue: boolean; decree: number }
export interface DarkMark { id: string | null; since: number; /** Seconds to the next broadcast (not saved). */ cd: number }
export interface DumbledoresArmy {
  /** Registry ids, never shown to anyone but members. */
  members: string[];
  /** The term in which the veto was last used (DA_VETOES_PER_TERM = 1), and the decree it may still veto. */
  vetoTerm: number;
  veto: VetoWindow | null;
  /** Not saved: the members' hits per target (who, when), when each member last struck jointly, the median of this tick. */
  hits: Map<string, Map<string, number>>;
  jointAt: Map<string, number>;
  median: { at: number; v: number };
}
/** 偷师: a custom spell of another wizard that hit you (the author's registry id is kept server-side only). */
export interface StudyHit {
  /** `${authorHandle}:${spellId}` — also what `studied` remembers. */
  key: string;
  spellId: string;
  name: string;
  author: string;
  authorName: string;
  authorHandle: string;
  /** The source as it was when it last hit you. */
  source: string;
  firstAt: number;
  lastAt: number;
}

declare module './world.js' {
  interface World {
    /** 黑魔王 (DARK_LORD_FEATURE): who holds the Dark Mark (reputation #1 with hysteresis) and since when. */
    darkMark: DarkMark;
    /** 邓布利多军 (DA_FEATURE). */
    da: DumbledoresArmy;
    /** 无规则区 (LAWLESS_FEATURE): the wizards standing in it, for the enter / leave notices (not saved). */
    lawlessIn: Set<string>;
  }
}
declare module './types.js' {
  interface Wizard {
    /** 偷师 (STUDY_FEATURE): custom spells of others that hit you recently (≤ STUDY_KEEP), and the ones you studied (≤ STUDIED_KEEP). Persisted. */
    studyHits?: StudyHit[];
    studied?: string[];
  }
}

// ------------------------------------------------------------------ 黑魔王 the Dark Lord
/** When the mark passes to someone ({name}; {old} the previous holder, or nobody). */
export const DARK_LORD_RISES: Line[] = [
  { zh: '☠ 黑魔标记升上了天空：{name} 成了黑魔王（声望第一）。大家都叫 TA「那个人」——击晕 TA 的人能夺走 30% 声望。', en: '☠ The Dark Mark rises: {name} is now the Dark Lord (reputation #1). You-Know-Who. Whoever stuns them steals 30% of their reputation.' },
  { zh: '☠ 「神秘人」换人了：{name} 登上声望榜首，成为黑魔王。不能说名字的那位，现在全城都在找。', en: '☠ There is a new He-Who-Must-Not-Be-Named: {name} tops the leaderboard. Everyone is hunting them now.' },
  { zh: '☠ {name} 成了黑魔王。「那个人回来了！」——预言家日报暂时不打算承认这件事。', en: '☠ {name} is the Dark Lord. "He\'s back!" — the Daily Prophet declines to comment.' },
];
/** The mark fades with nobody to take it. */
export const DARK_LORD_FADES: Line = { zh: '黑魔标记从 {name} 头顶消散了。暂时没有黑魔王。', en: 'The Dark Mark over {name} fades. For now there is no Dark Lord.' };
/** The periodic broadcast of where the Dark Lord is ({name}, {place}, {x}, {z}). */
export const DARK_MARK_SEEN: Line[] = [
  { zh: '☠ 黑魔标记悬在{place}上空：那个人——{name}——就在那里（{x}, {z}）。', en: '☠ The Dark Mark hangs over {place}: {name}, You-Know-Who, is there ({x}, {z}).' },
  { zh: '☠ 有人在{place}看见了「神秘人」{name}（{x}, {z}）。凤凰社，集合！', en: '☠ You-Know-Who ({name}) was seen at {place} ({x}, {z}). Order of the Phoenix, assemble!' },
  { zh: '☠ {name} 在{place}（{x}, {z}）。嘘——别直呼其名。', en: '☠ {name} is at {place} ({x}, {z}). Shh — do not say the name.' },
];
/** To the new Dark Lord, privately. */
export const DARK_LORD_YOU: Line = {
  zh: '你是黑魔王了：直接伤害 ×1.15，但你的位置每分钟向全服广播一次，被击晕会被夺走 30% 声望。缴械咒对你照样有效。',
  en: 'You are the Dark Lord: your spells hit 15% harder, but your whereabouts are announced every minute and a stun takes 30% of your reputation. Expelliarmus still works on you.',
};
/** The Dark Lord is stunned ({name} by {k}, {n} reputation stolen). */
export const DARK_LORD_FALLS: Line[] = [
  { zh: '⚡ {k} 击倒了黑魔王 {name}，夺走 {n} 点声望！「大难不死的男孩」又多了一个。', en: '⚡ {k} stunned the Dark Lord {name} and took {n} reputation! Another Boy Who Lived.' },
  { zh: '⚡ 黑魔王 {name} 被 {k} 击晕（声望 -{n}）。伏地魔：这不可能！', en: '⚡ The Dark Lord {name} falls to {k} (-{n} reputation). "This is not possible!"' },
];

// ------------------------------------------------------------------ 邓布利多军 Dumbledore's Army
export const DA_JOINED: Line = { zh: '🦌 你在有求必应屋里签下了名字：{name}，欢迎加入邓布利多军。低调点——乌姆里奇在找这张羊皮纸。', en: "🦌 You sign the parchment in the Room of Requirement: welcome to Dumbledore's Army, {name}. Keep it quiet — Umbridge is looking for that list." };
export const DA_MEMBER_JOINED: Line = { zh: '🦌 {name} 加入了邓布利多军。', en: "🦌 {name} joined Dumbledore's Army." };
export const DA_LEFT: Line = { zh: '你离开了邓布利多军。（羊皮纸上没有出现「告密生」三个字——你只是走了。）', en: "You left Dumbledore's Army. (No SNEAK appears on your face — you simply left.)" };
export const DA_OUTGROWN: Line = { zh: '{name} 成了{role}，名字从邓布利多军的羊皮纸上消失了。', en: "{name} became {role}; their name vanishes from Dumbledore's Army's parchment." };
export const DA_VETOED: Line = {
  zh: '⚡ 邓布利多军否决了部长 {minister} 的法令！规则书恢复原状，铜像也被推倒了。「我们是邓布利多军！」',
  en: "⚡ Dumbledore's Army has vetoed Minister {minister}'s decree! The Rulebook is restored and the statue toppled. \"We're Dumbledore's Army!\"",
};
export const DA_VOTE: Line = { zh: '🗳 你投票否决部长的法令（{v}/{need} 票，在线成员 {online}，法定人数 {q}）。', en: "🗳 You vote to veto the Minister's decree ({v}/{need} votes; {online} members online, quorum {q})." };
export const DA_JOINT: Line[] = [
  { zh: '🦌 呼神护卫！邓布利多军三杖齐发，这一击 ×1.25！', en: "🦌 Expecto Patronum! Dumbledore's Army strikes together (×1.25)!" },
  { zh: '🦌 「我们一起！」邓布利多军的守护神连成一片（伤害 ×1.25）。', en: '🦌 "Together!" The DA\'s Patronuses join into one (damage ×1.25).' },
];

// ------------------------------------------------------------------ 偷师 learning from the strong
export const STUDY_READY: Line = { zh: '原形立现：你看清了 {k} 的「{spell}」是怎么施的。用 study_spell 抄进你的咒语书（会署上原作者）。', en: "Revelio! You see how {k}'s \"{spell}\" works. study_spell copies it into your book (credited to its author)." };
export const STUDY_WAIT: Line = { zh: '原形立现：{k} 的「{spell}」还没看透，再挨几下、再等 {s} 秒。', en: 'Revelio! {k}\'s "{spell}" is not clear to you yet: {s}s more.' };
export const STUDIED_YOU: Line = { zh: '{v} 偷师了你的咒语「{spell}」。模仿是最真诚的恭维。', en: '{v} studied your spell "{spell}". Imitation is the sincerest form of flattery.' };

// ------------------------------------------------------------------ 无规则区 the lawless zone
export const LAWLESS_ENTER: Line = {
  zh: '⚠ 你走进了禁林深处：魔法部的法律到不了这里。包裹诅咒不再受冷却和 10 分钟上限限制，魔物掉落与决斗声望翻倍。新生、NPC、一年级依然受保护，血量底线与禁言上限也还在。想走随时可以走。',
  en: "⚠ You enter the Deep Forest: the Ministry's law does not reach here. Parcel curses skip their cooldowns and the 10-minute cap; creature loot and duel reputation are doubled. Newcomers, NPCs and first-years are still protected, and the health floor and silence caps still hold. You may leave at any time.",
};
export const LAWLESS_LEAVE: Line = { zh: '你走出了禁林深处，魔法部的保护重新生效。', en: "You leave the Deep Forest; the Ministry's protections apply again." };

const round = (n: number) => Math.round(n * 10) / 10;
/** Counts for the Dark Lord and the DA's median: online, or present within the last DARK_LORD_SEEN_S. */
const seenRecently = (world: World, w: Wizard) => world.online(w) || world.now - w.lastSeenAt <= DARK_LORD_SEEN_S;

// ------------------------------------------------------------------ 黑魔王 the Dark Lord
/** May this wizard hold the Dark Mark? A player, seen recently, with at least DARK_LORD_MIN_REP reputation. */
export const darkLordEligible = (world: World, w: Wizard) => !w.npc && w.reputation >= DARK_LORD_MIN_REP && seenRecently(world, w);

/** The current Dark Lord, if any. */
export function darkLord(world: World): Wizard | null { const id = world.darkMark.id; return (id && world.wizards.get(id)) || null; }

/**
 * The reputation #1 among the eligible holds the Dark Mark. A holder who is still eligible keeps it until a
 * challenger has ≥ 110% of their reputation (darkLordTakes; Lean dark_lord_no_flap: two close rivals never trade it
 * back and forth). Runs in the 1 Hz sweep. Returns the holder's id.
 */
export function updateDarkLord(world: World): string | null {
  const cur = darkLord(world);
  const holder = cur && darkLordEligible(world, cur) ? cur : null;
  let top: Wizard | null = null;
  for (const w of world.wizards.values()) if (darkLordEligible(world, w) && (!top || w.reputation > top.reputation)) top = w;
  let next: Wizard | null;
  if (!holder) next = top;
  else if (!top || top === holder) next = holder;
  else next = darkLordTakes(holder.reputation, top.reputation) ? top : holder;
  if ((next?.id ?? null) !== world.darkMark.id) passDarkMark(world, cur, next);
  return world.darkMark.id;
}

function passDarkMark(world: World, from: Wizard | null, to: Wizard | null) {
  const m = world.darkMark;
  m.id = to?.id ?? null;
  m.since = world.now;
  if (!to) {
    if (from) { const l = fill(DARK_LORD_FADES, { name: from.name }); world.emit('dark', l.en, { who: [from.id], zh: l.zh }); }
    return;
  }
  const l = fill(world.quip(DARK_LORD_RISES, to.handle), { name: to.name });
  world.emit('dark', l.en, { who: from ? [to.id, from.id] : [to.id], zh: l.zh });
  world.tell(to, DARK_LORD_YOU, 'egg');
  leaveDaQuietly(world, to, { zh: '黑魔王', en: 'the Dark Lord' });
  m.cd = 0; // the Dark Mark shows where they are at once
}

/** The Dark Mark names the Dark Lord's whereabouts to everyone, every DARK_LORD_BROADCAST_S while they are online. */
function broadcastDarkMark(world: World) {
  const d = darkLord(world);
  if (!d || !world.online(d) || d.st.jailedUntil) return;
  if (--world.darkMark.cd > 0) return;
  world.darkMark.cd = DARK_LORD_BROADCAST_S;
  const place = world.placeName(d.pos);
  const l = fill(world.quip(DARK_MARK_SEEN, d.handle), { name: d.name, place: { en: place, zh: zhPlace(place) }, x: Math.round(d.pos.x), z: Math.round(d.pos.z) });
  world.emit('dark', l.en, { who: [d.id], zh: l.zh });
}

/**
 * The Dark Lord as everyone may see them (leaderboard; the snapshot's `dl` when `compact`): handle, name, where,
 * whole-metre position, since when (world time). Null when nobody holds the mark or they are offline.
 */
export function darkLordView(world: World, compact?: boolean) {
  const d = darkLord(world);
  if (!d || !world.online(d)) return null;
  const place = world.placeName(d.pos);
  if (compact) return { h: d.handle, n: d.name, x: Math.round(d.pos.x), z: Math.round(d.pos.z), p: place };
  return { handle: d.handle, name: d.name, house: d.house, reputation: Math.round(d.reputation), place, placeZh: zhPlace(place), x: Math.round(d.pos.x), z: Math.round(d.pos.z), since: round(world.darkMark.since) };
}

const isDark = (world: World, id: string) => world.darkMark.id === id;

export const DARK_LORD_FEATURE: Feature = {
  id: 'darkLord',
  init(world) { world.darkMark = { id: null, since: 0, cd: 0 }; },
  save: (world) => ({ id: world.darkMark.id, since: world.darkMark.since }),
  load(world, data, legacy) {
    // saves from before the features kept the mark in flags
    const f = legacy.flags as { darkLordId?: unknown; darkLordSince?: unknown } | undefined;
    const d = (data ?? { id: f?.darkLordId, since: f?.darkLordSince }) as { id?: unknown; since?: unknown };
    world.darkMark = { id: typeof d.id === 'string' ? d.id : null, since: typeof d.since === 'number' ? d.since : 0, cd: 0 };
  },
  sweep(world) { updateDarkLord(world); broadcastDarkMark(world); },
  // ×1.15 on the Dark Lord's own direct hits (not their summons'); Expelliarmus still works on them (World.hit)
  hit: (world, _by, src, _dst, _tags, dmg) => (dmg && src && isDark(world, src.id) ? DARK_LORD_POWER_PCT / 100 : 1),
  // a stun steals 30% of their reputation, and everyone hears of it
  bounty: (world, w) => (isDark(world, w.id) ? DARK_LORD_FALLS : null),
  wire: { key: 'dl', get: (world) => darkLordView(world, true) },
  view: {
    key: 'darkLord',
    me: (world, w) => isDark(world, w.id),
    look: (world, x) => isDark(world, x.id) || undefined,
    board: (world) => ({
      darkLord: darkLordView(world),
      darkLordRule: `The reputation #1 (min ${DARK_LORD_MIN_REP}, seen in the last ${DARK_LORD_SEEN_S / 60} minutes) is the Dark Lord: +${DARK_LORD_POWER_PCT - 100}% damage, whereabouts announced every ${DARK_LORD_BROADCAST_S}s, and a stun steals 30% of their reputation. A challenger needs 110% of theirs to take the mark.`,
    }),
  },
};

// ------------------------------------------------------------------ 无规则区 the lawless zone's warnings
export const LAWLESS_FEATURE: Feature = {
  id: 'lawless',
  init(world) { world.lawlessIn = new Set(); },
  /** Entering the lawless zone warns you (once per visit); leaving says so. */
  sweep(world) {
    const inn = world.lawlessIn;
    for (const w of world.wizards.values()) {
      if (w.npc) continue;
      const inside = world.online(w) && world.inLawless(w.pos);
      if (inside === inn.has(w.id)) continue;
      if (inside) { inn.add(w.id); world.tell(w, LAWLESS_ENTER, 'dark'); }
      else { inn.delete(w.id); if (world.online(w)) world.tell(w, LAWLESS_LEAVE); }
    }
    for (const id of inn) if (!world.wizards.has(id)) inn.delete(id);
  },
};

// ------------------------------------------------------------------ 邓布利多军 Dumbledore's Army (formal/tla/DAVeto.tla)
/** How long the joint-Patronus badge stays lit after your last joint hit. */
const DA_JOINT_BADGE_S = 6;
const blankDa = (): DumbledoresArmy => ({ members: [], vetoTerm: 0, veto: null, hits: new Map(), jointAt: new Map(), median: { at: -1, v: 0 } });

export const isDaMember = (world: World, id: string) => world.da.members.includes(id);

/** The median reputation of the players seen recently (the DA admits anyone below it, or below DA_REP_CEILING). */
export function reputationMedian(world: World): number {
  const reps = [...world.wizards.values()].filter((w) => !w.npc && seenRecently(world, w)).map((w) => w.reputation).sort((a, b) => a - b);
  const m = reps.length >> 1;
  return !reps.length ? 0 : reps.length % 2 ? reps[m] : (reps[m - 1] + reps[m]) / 2;
}
/** The same, computed at most once per world time: `me` shows it on every socket's update (join/veto use the fresh one). */
function medianNow(world: World): number {
  const m = world.da.median;
  if (m.at !== world.now) { m.at = world.now; m.v = reputationMedian(world); }
  return m.v;
}

/** Why this wizard may not join the DA (null: they may). */
function daRefusal(world: World, w: Wizard, med = reputationMedian(world)): Line | null {
  if (w.npc) return { en: 'NPCs keep out of the Room of Requirement.', zh: 'NPC 进不了有求必应屋。' };
  if (world.flags.ministerId === w.id) return { en: 'The Minister for Magic cannot join the army raised against the Ministry.', zh: '魔法部长不能加入反对魔法部的队伍。' };
  if (isDark(world, w.id)) return { en: "The Dark Lord is not welcome in Dumbledore's Army.", zh: '邓布利多军不欢迎黑魔王。' };
  if (w.reputation >= DA_REP_CEILING && w.reputation >= med) {
    return {
      en: `Dumbledore's Army is for the underdogs: your reputation (${Math.round(w.reputation)}) must be below ${DA_REP_CEILING} or below the median (${Math.round(med)}).`,
      zh: `邓布利多军是弱者的联盟：你的声望（${Math.round(w.reputation)}）需低于 ${DA_REP_CEILING}，或低于中位数（${Math.round(med)}）。`,
    };
  }
  return null;
}

/** The DA members in play right now: online and not in Azkaban (they make the quorum and the majority). */
export function daActive(world: World): Wizard[] {
  const out: Wizard[] = [];
  for (const id of world.da.members) { const w = world.wizards.get(id); if (w && world.online(w) && !w.st.jailedUntil) out.push(w); }
  return out;
}

export function joinDA(world: World, wid: string) {
  const w = world.need(wid), da = world.da;
  if (isDaMember(world, w.id)) throw new Error("You are already in Dumbledore's Army. 你已经是邓布利多军的一员了。");
  const no = daRefusal(world, w);
  if (no) throw new Error(`${no.en} ${no.zh}`);
  if (da.members.length >= DA_MAX_MEMBERS) throw new Error(`The Room of Requirement is full (${DA_MAX_MEMBERS} members). 有求必应屋已经挤满了（${DA_MAX_MEMBERS} 人）。`);
  for (const id of da.members) { const m = world.wizards.get(id); if (m) world.tell(m, fill(DA_MEMBER_JOINED, { name: w.name }), 'da'); }
  da.members = [...da.members, w.id];
  world.tell(w, fill(DA_JOINED, { name: w.name }), 'da');
  return daState(world, wid);
}

export function leaveDA(world: World, wid: string) {
  const w = world.need(wid);
  if (!isDaMember(world, w.id)) throw new Error("You are not in Dumbledore's Army. 你不是邓布利多军的成员。");
  world.da.members = world.da.members.filter((id) => id !== w.id);
  world.tell(w, DA_LEFT, 'da');
  return daState(world, wid);
}

/** A member who became Minister or Dark Lord leaves the DA (the others are told). */
function leaveDaQuietly(world: World, w: Wizard, role: Line) {
  if (!isDaMember(world, w.id)) return;
  world.da.members = world.da.members.filter((id) => id !== w.id);
  const l = fill(DA_OUTGROWN, { name: w.name, role });
  world.tell(w, l, 'da');
  for (const id of world.da.members) { const m = world.wizards.get(id); if (m) world.tell(m, l, 'da'); }
}

/** The decree the DA may still veto (this term's, within DA_VETO_WINDOW_S, veto unspent), or null. */
function vetoable(world: World) {
  const v = world.da.veto;
  if (!v || v.term !== world.term.n || world.now - v.at > DA_VETO_WINDOW_S || world.da.vetoTerm === world.term.n) return null;
  return v;
}

/** What the DA looks like to `wid`. Only members see who the members are. */
export function daState(world: World, wid: string, med = reputationMedian(world)) {
  const w = world.need(wid), da = world.da;
  const member = isDaMember(world, w.id);
  const no = member ? null : daRefusal(world, w, med);
  const active = daActive(world);
  const v = vetoable(world);
  const votes = v ? v.votes.filter((id) => active.some((a) => a.id === id)).length : 0;
  return {
    member, eligible: !member && !no, ...(no ? { why: no.en, whyZh: no.zh } : {}),
    size: da.members.length, max: DA_MAX_MEMBERS, online: active.length, quorum: DA_QUORUM,
    ...(member ? { members: da.members.map((id) => world.wizards.get(id)).filter((x): x is Wizard => !!x).map((x) => ({ handle: x.handle, name: x.name, online: world.online(x) })) } : {}),
    admits: { belowReputation: DA_REP_CEILING, orBelowMedian: Math.round(med) },
    veto: {
      perTerm: DA_VETOES_PER_TERM, usedThisTerm: da.vetoTerm === world.term.n, windowSeconds: DA_VETO_WINDOW_S,
      decree: v ? { minister: v.minister, changes: world.decrees[v.decree]?.changes ?? [], secondsLeft: Math.max(0, Math.ceil(DA_VETO_WINDOW_S - (world.now - v.at))) } : null,
      // a majority of the members in play, and never fewer of them in play than the quorum (playtest round 4 read
      // "needed 1" with nobody online): below quorum the veto cannot pass however many vote
      votes, needed: Math.floor(Math.max(active.length, DA_QUORUM) / 2) + 1, voted: !!v && v.votes.includes(w.id),
      ...(active.length < DA_QUORUM ? { blocked: `below quorum: ${active.length} of the ${DA_QUORUM} members needed are in play`, blockedZh: `不足法定人数：在场成员 ${active.length}，至少要 ${DA_QUORUM}` } : {}),
    },
    joint: {
      members: DA_JOINT_MIN, withinSeconds: DA_JOINT_WINDOW_S, damagePct: DA_JOINT_PCT,
      how: `Any damaging spell counts (no Patronus needed): when ${DA_JOINT_MIN} members hit the same target within ${DA_JOINT_WINDOW_S} s, their hits deal ×${DA_JOINT_PCT / 100}. Agree on a target (chat ch "da"), then strike together.`,
      ...(member ? { now: jointNow(world, w.id) } : {}),
    },
  };
}

/**
 * A DA member votes to veto the Minister's last decree (formal/tla/DAVeto.tla Vote/Veto). It passes when at least
 * DA_QUORUM members are in play and a strict majority of them has voted, within DA_VETO_WINDOW_S of the decree,
 * once per term: the Rulebook goes back to what it was before the decree and its statue falls.
 */
export function vetoDecree(world: World, wid: string) {
  const w = world.need(wid), da = world.da;
  if (!isDaMember(world, w.id)) throw new Error("Only members of Dumbledore's Army may vote to veto a decree. 只有邓布利多军的成员能投票否决法令。");
  if (!world.online(w) || w.st.jailedUntil) throw new Error('You must be in the world to vote. 你得在场才能投票。');
  if (da.vetoTerm === world.term.n) throw new Error(`The DA has already used its veto this term (${DA_VETOES_PER_TERM} per term). 邓布利多军本学期的否决权已经用过了（每学期 ${DA_VETOES_PER_TERM} 次）。`);
  const v = da.veto;
  const late = `Too late: a decree can only be vetoed within ${DA_VETO_WINDOW_S}s of being enacted. 太晚了：法令颁布 ${DA_VETO_WINDOW_S} 秒内才能否决。`;
  // the 1 Hz sweep drops a closed window: a vote after it is still "too late" for this term's decree, not "no decree" (test/society.test.ts)
  if (!v || v.term !== world.term.n) throw new Error(world.decrees.some((d) => d.term === world.term.n && !d.vetoed) ? late : 'There is no decree this term to veto. 本学期还没有可以否决的法令。');
  if (world.now - v.at > DA_VETO_WINDOW_S) throw new Error(late);
  if (!v.votes.includes(w.id)) v.votes = [...v.votes, w.id];
  const active = daActive(world);
  const votes = v.votes.filter((id) => active.some((a) => a.id === id)).length;
  const needed = Math.floor(active.length / 2) + 1;
  if (vetoPasses(active.length, votes)) {
    enactVeto(world, v);
    return { vetoed: true, votes, needed, online: active.length, quorum: DA_QUORUM };
  }
  const mine = fill(DA_VOTE, { v: votes, need: needed, online: active.length, q: DA_QUORUM });
  const theirs = { en: `🗳 ${w.name} voted to veto the Minister's decree (${votes}/${needed}).`, zh: `🗳 ${w.name} 投票否决部长的法令（${votes}/${needed}）。` };
  for (const m of active) world.tell(m, m === w ? mine : theirs, 'da');
  return { vetoed: false, votes, needed, online: active.length, quorum: DA_QUORUM, secondsLeft: Math.max(0, Math.ceil(DA_VETO_WINDOW_S - (world.now - v.at))) };
}

function enactVeto(world: World, v: VetoWindow) {
  const res = applyPatch(defaultRulebook(), v.before as unknown); // re-validated: it may have come from disk
  const was = world.rules;
  world.rules = res.ok ? res.rulebook : defaultRulebook();
  world.da.vetoTerm = v.term;
  world.da.veto = null;
  const rec = world.decrees[v.decree];
  if (rec) rec.vetoed = true;
  if (v.statue) {
    const st = world.flags.statues;
    let i = st.length - 1;
    while (i >= 0 && !(st[i].name === v.minister && st[i].term === v.term)) i--;
    if (i >= 0) world.flags.statues = st.filter((_, j) => j !== i);
  }
  for (const x of world.wizards.values()) world.clampVitals(x);
  const l = fill(DA_VETOED, { minister: v.minister });
  world.emit('decree', l.en, { who: [v.ministerId], zh: l.zh });
  world.rulesChanged(was, null); // (咒语集市: a listing unpublished since the decree leaves the 推荐 shelf, Market.tla PromotedPublished)
}

/**
 * The joint spell: a DA member's hit on `dstId` is remembered for DA_JOINT_WINDOW_S; while at least DA_JOINT_MIN
 * distinct members have hit it in that window, their hits deal ×DA_JOINT_PCT% (jointPct: never more, however many
 * join in; the Dark Lord is never a member, so it never stacks with the Dark Mark).
 */
function jointBonus(world: World, by: string, dstId: string): number {
  if (!isDaMember(world, by)) return 1;
  const hits = world.da.hits;
  let m = hits.get(dstId);
  if (!m) { m = new Map(); hits.set(dstId, m); }
  m.set(by, world.now);
  let n = 0;
  for (const [id, at] of m) { if (world.now - at > DA_JOINT_WINDOW_S || !isDaMember(world, id)) m.delete(id); else n++; }
  const pct = jointPct(n);
  if (pct > 100) for (const id of m.keys()) world.da.jointAt.set(id, world.now); // me.da.jointBadge: every member in on it, every time (the public line below is rate-limited)
  if (pct > 100 && world.banter([`joint:${dstId}`, 10])) {
    const e = world.entity(dstId);
    if (e) world.fx({ k: 'patronus', x: e.pos.x, z: e.pos.z, r: 6 });
    const l = world.quip(DA_JOINT, dstId);
    world.emit('da', l.en, { zh: l.zh });
  }
  return pct / 100;
}

/** 联合一击 feedback: the targets you hit in the last window, and how many members are on each (playtest round 4: no way to tell). */
function jointNow(world: World, wid: string) {
  const out: { target: string; id?: string; members: number; need: number; secondsLeft: number }[] = [];
  for (const [dst, m] of world.da.hits) {
    const at = m.get(wid);
    if (at === undefined || world.now - at > DA_JOINT_WINDOW_S) continue;
    const on = [...m].filter(([id, t]) => world.now - t <= DA_JOINT_WINDOW_S && isDaMember(world, id));
    const e = world.entity(dst);
    out.push({
      target: e?.name ?? '?', ...(e?.kind === 'creature' ? { id: dst } : {}), members: on.length, need: DA_JOINT_MIN,
      secondsLeft: round(Math.max(0, DA_JOINT_WINDOW_S - (world.now - Math.min(...on.map(([, t]) => t))))),
    });
  }
  return out;
}

const DA_OPS = ['status', 'join', 'leave', 'veto'] as const;
const daOp = (world: World, wid: string, op: unknown) =>
  op === 'join' ? joinDA(world, wid) : op === 'leave' ? leaveDA(world, wid) : op === 'veto' ? vetoDecree(world, wid) : daState(world, wid);

export const DA_FEATURE: Feature = {
  id: 'da',
  init(world) { world.da = blankDa(); },
  save: (world) => ({ members: world.da.members, vetoTerm: world.da.vetoTerm, veto: world.da.veto }),
  load(world, data, legacy) {
    // saves from before the features kept it in flags: da.members, vetoTerm, veto
    const f = legacy.flags as { da?: { members?: unknown }; vetoTerm?: unknown; veto?: unknown } | undefined;
    const d = (data ?? { members: f?.da?.members, vetoTerm: f?.vetoTerm, veto: f?.veto }) as { members?: unknown; vetoTerm?: unknown; veto?: unknown };
    world.da = {
      ...blankDa(), members: Array.isArray(d.members) ? d.members.filter((x): x is string => typeof x === 'string') : [],
      vetoTerm: typeof d.vetoTerm === 'number' ? d.vetoTerm : 0, veto: d.veto && typeof d.veto === 'object' ? d.veto as VetoWindow : null,
    };
  },
  /** 1 Hz: a Minister leaves; members who are gone; the joint-hit memory; the veto window closing. */
  sweep(world) {
    const da = world.da, mid = world.flags.ministerId;
    const minister = mid ? world.wizards.get(mid) : undefined;
    if (minister && isDaMember(world, minister.id)) leaveDaQuietly(world, minister, { zh: '魔法部长', en: 'Minister for Magic' });
    if (da.members.some((id) => !world.wizards.has(id))) da.members = da.members.filter((id) => world.wizards.has(id));
    for (const [id, at] of da.jointAt) if (world.now - at > DA_JOINT_BADGE_S) da.jointAt.delete(id);
    for (const [t, m] of da.hits) {
      for (const [id, at] of m) if (world.now - at > DA_JOINT_WINDOW_S) m.delete(id);
      if (!m.size) da.hits.delete(t);
    }
    const v = da.veto;
    if (v && (v.term !== world.term.n || world.now - v.at > DA_VETO_WINDOW_S)) da.veto = null;
  },
  // DA_JOINT_MIN members hitting the same target within DA_JOINT_WINDOW_S (a summon counts for its owner)
  hit: (world, by, _src, dstId, _tags, dmg) => (dmg && by ? jointBonus(world, by, dstId) : 1),
  // a decree may be vetoed within DA_VETO_WINDOW_S (formal/tla/DAVeto.tla): keep what it replaced
  rules(world, before, minister) {
    if (minister) world.da.veto = { term: world.term.n, at: world.now, minister: minister.name, ministerId: minister.id, before, votes: [], statue: true, decree: world.decrees.length - 1 };
  },
  view: {
    key: 'da',
    // what the panels need, in whole numbers (the {t:'da'} reply adds why you may not join, who is admitted, the joint rule)
    me(world, w) {
      const { member, eligible, size, online, quorum, members, veto } = daState(world, w.id, medianNow(world));
      /** jointBadge: seconds the joint-Patronus badge still shows for you (your last joint hit + DA_JOINT_BADGE_S), else 0. */
      return { member, eligible, size, online, quorum, members, veto, jointBadge: Math.max(0, round((world.da.jointAt.get(w.id) ?? -1e9) + DA_JOINT_BADGE_S - world.now)) };
    },
  },
  tools: [
    {
      name: 'dumbledores_army', title: "Dumbledore's Army", cost: 0, readOnly: true,
      description: `邓布利多军: the underdogs' union. Whether you may join (reputation below 100 or below the median), its size and who is online (members see each other), the Minister's decree it may still veto (majority of ≥3 online members, within 180 s, once per term), and the joint-spell rule (${DA_JOINT_MIN} members hitting one target within ${DA_JOINT_WINDOW_S} s: ×${DA_JOINT_PCT / 100}).`,
      input: {},
      run: (world, wid) => daState(world, wid),
    },
    {
      name: 'join_dumbledores_army', title: "Join Dumbledore's Army", cost: 1,
      description: 'Sign the parchment in the Room of Requirement (only if your reputation is below 100 or below the median). Membership is secret: only members see each other.',
      input: {},
      run: (world, wid) => joinDA(world, wid),
    },
    {
      name: 'leave_dumbledores_army', title: "Leave Dumbledore's Army", cost: 1,
      description: 'Take your name off the parchment.',
      input: {},
      run: (world, wid) => leaveDA(world, wid),
    },
    {
      name: 'veto_decree', title: "Vote to veto the Minister's decree", cost: 1,
      description: "DA members only: vote to veto the Minister's last decree. It is reverted when a strict majority of the DA members online (at least 3 of them) has voted, within 180 s of the decree; once per term.",
      input: {},
      run: (world, wid) => vetoDecree(world, wid),
    },
  ],
  // the browser (J): {t:'da', op} → {t:'da', r: {op, …}}
  ws: (world, wid, m) => ({ op: DA_OPS.includes(m.op as never) ? m.op : 'status', ...daOp(world, wid, m.op) }),
};

// ------------------------------------------------------------------ 偷师 learning from the strong
/** Remember a custom spell of `attacker` that just hit `victim` (bolt damage, a root or a disarm). */
function noteSpellHit(world: World, attacker: Wizard, victim: Wizard, tags: readonly string[]) {
  if (attacker === victim || victim.npc || attacker.npc) return;
  const name = tags[1];
  if (!name) return;
  const spell = attacker.spells.find((s) => !s.builtin && s.name === name);
  if (!spell) return;
  const key = `${attacker.handle}:${spell.id}`;
  if (victim.studied?.includes(key)) return;
  const now = world.now;
  const hits = (victim.studyHits ?? []).filter((h) => now - h.lastAt < STUDY_MEMORY_S);
  const h = hits.find((x) => x.key === key);
  if (h) Object.assign(h, { lastAt: now, source: spell.source, name: spell.name, authorName: attacker.name });
  else {
    hits.push({ key, spellId: spell.id, name: spell.name, author: attacker.id, authorName: attacker.name, authorHandle: attacker.handle, source: spell.source, firstAt: now, lastAt: now });
    if (hits.length > STUDY_KEEP) { hits.sort((a, b) => b.lastAt - a.lastAt); hits.length = STUDY_KEEP; }
  }
  victim.studyHits = hits;
}

/** Spells that hit you recently and that you have not studied: whose, and when you can study them (world time). */
export function studyable(world: World, w: Wizard) {
  return (w.studyHits ?? []).filter((h) => world.now - h.lastAt < STUDY_MEMORY_S && !w.studied?.includes(h.key)).map((h) => ({
    spell: h.name, from: h.authorName, handle: h.authorHandle,
    readyAt: round(h.firstAt + STUDY_DELAY_S), readyIn: Math.max(0, Math.ceil(STUDY_DELAY_S - (world.now - h.firstAt))),
    forgottenAt: round(h.lastAt + STUDY_MEMORY_S),
  }));
}

/**
 * 偷师: read the source of a custom spell that hit you, STUDY_DELAY_S after it first did and while it hit you in the
 * last STUDY_MEMORY_S — once per spell. With `copy`, forge it into your own book (your year's caps and spellbook
 * size apply, as for any forge; the copy records its author). A failed copy does not spend the study.
 */
export function studySpell(world: World, wid: string, spell: string, opts: { from?: string; copy?: boolean; name?: string; slot?: number } = {}) {
  const w = world.need(wid), now = world.now;
  if (w.npc) throw new Error('NPCs learn from the curriculum.');
  const k = String(spell ?? '').trim().toLowerCase();
  const f = opts.from?.trim().toLowerCase();
  const live = (w.studyHits ?? []).filter((h) => now - h.lastAt < STUDY_MEMORY_S);
  w.studyHits = live;
  let c = live.filter((h) => !w.studied?.includes(h.key) && (h.name.toLowerCase() === k || h.key.toLowerCase() === k));
  if (f) c = c.filter((h) => h.authorHandle.toLowerCase() === f || h.authorName.toLowerCase() === f);
  if (!c.length) throw new Error(`No spell called "${spell}" of another wizard has hit you in the last ${STUDY_MEMORY_S / 60} minutes (the curriculum is in your book already; each spell can be studied once). 最近 ${STUDY_MEMORY_S / 60} 分钟内没有叫「${spell}」的自创咒语打中过你（每个咒语只能偷师一次）。`);
  if (c.length > 1) throw new Error(`Several wizards hit you with a spell called "${spell}": say whose (from: ${c.map((h) => h.authorHandle).join(' | ')}).`);
  const h = c[0];
  const wait = Math.ceil(STUDY_DELAY_S - (now - h.firstAt));
  if (wait > 0) throw new Error(`You have not watched "${h.name}" long enough to see how it works: ${wait}s more. 偷师要有耐心：再看 ${wait} 秒。 retry_after=${wait}`);
  let copied: { name: string; id: string; notes: string[] } | undefined;
  if (opts.copy) {
    const name = (opts.name ?? h.name).trim();
    if (w.spells.some((s) => s.name.toLowerCase() === name.toLowerCase())) throw new Error(`You already have a spell called "${name}": give the copy another name. 你的咒语书里已经有「${name}」了，换个名字。`);
    // forgeSpell throws on your caps or a full book: then nothing is spent
    const r = world.forgeSpell(w.id, { name, source: h.source, slot: opts.slot, origin: { author: h.authorName, handle: h.authorHandle, spell: h.name, at: now } });
    copied = { name: r.spell.name, id: r.spell.id, notes: r.notes };
  }
  w.studied = [...(w.studied ?? []), h.key].slice(-STUDIED_KEEP);
  w.studyHits = live.filter((x) => x !== h);
  world.fx({ k: 'reveal', x: w.pos.x, z: w.pos.z, h: w.handle });
  const author = world.wizards.get(h.author);
  if (author && author !== w) world.tell(author, fill(STUDIED_YOU, { v: w.name, spell: h.name }));
  return {
    studied: h.name, author: h.authorName, handle: h.authorHandle, source: h.source, ...(copied ? { copied } : {}),
    note: copied ? `"${copied.name}" is in your book now, credited to ${h.authorName}.` : 'Studied. Forge it yourself from this source, or call again next time with copy:true to have it copied and credited.',
  };
}

const str = (x: unknown) => (typeof x === 'string' ? x : undefined);
const studyArgs = (a: Record<string, unknown>) => ({
  from: str(a.from), copy: a.copy === true, name: str(a.name), slot: typeof a.slot === 'number' && Number.isFinite(a.slot) ? a.slot : undefined,
});

export const STUDY_FEATURE: Feature = {
  id: 'study',
  // bolt damage, a root or a disarm: a custom spell of another wizard that touched you
  hit(world, _by, src, dstId, tags) {
    const v = src && world.wizards.get(dstId);
    if (v) noteSpellHit(world, src, v, tags);
    return 1;
  },
  // Revelio on yourself also shows which spells that hit you are ready to be studied
  reveal(world, w, charm) {
    if (charm !== 'revelio') return;
    for (const s of studyable(world, w)) world.tell(w, s.readyIn ? fill(STUDY_WAIT, { k: s.from, spell: s.spell, s: s.readyIn }) : fill(STUDY_READY, { k: s.from, spell: s.spell }));
  },
  // `me` stays steady (world times, no countdown); whoami says how long too
  view: {
    key: 'studyable',
    me: (world, w) => studyable(world, w).map(({ spell, from, handle, readyAt }) => ({ spell, from, handle, readyAt })),
    whoami: studyable,
  },
  tools: [{
    name: 'study_spell', title: 'Study a spell that hit you (偷师)', cost: 2,
    description: "Learn from the strong: a custom spell another wizard hit you with can be studied 120 s after it first hit you (while it hit you in the last 10 minutes), once per spell. Returns its source; copy:true forges it into your book (your year's caps and spellbook size apply; the copy records its author). Casting Revelio lists what is ready; whoami.studyable too.",
    input: {
      spell: z.string().min(1).max(60).describe('the spell\'s name, as it hit you'),
      from: z.string().optional().describe('whose (handle or name), if several spells share the name'),
      copy: z.boolean().optional().describe('also forge it into your book (default false)'),
      name: z.string().min(1).max(40).optional().describe('name for your copy (default: the original name)'),
      slot: z.number().int().min(1).max(6).optional().describe('hotbar slot for the copy'),
    },
    run: (world, wid, a) => studySpell(world, wid, String(a.spell), studyArgs(a)),
  }],
  // the browser (the spellbook's 偷师 block): {t:'study', spell, from?, copy?, name?, slot?}
  ws: (world, wid, m) => studySpell(world, wid, String(m.spell ?? ''), studyArgs(m)),
};
