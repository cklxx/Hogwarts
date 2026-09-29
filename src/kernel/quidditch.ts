/**
 * 魁地奇 (roadmap step 4): one match a term between two houses on the pitch, bounded rewards.
 *
 * - Schedule: QD_START_FRAC into every term, the pairing rotates through QD_PAIRS (all six in six terms). QD_CALL_S
 *   before the whistle the match is called: players of the two houses join (`quidditch join`, MCP / P in the browser).
 * - Play (at most QD_PLAY_S, and never past half a term): the rostered fly (QD_FLY × speed on the pitch). The Quaffle
 *   is picked up by touching it, carried, and thrown (`quidditch throw`, F): through one of the three hoops at the
 *   other end is +QD_GOAL; a defender who touches it in flight intercepts it. Two Bludgers chase the players: a hit
 *   costs QD_BLUDGER_DMG health (never below 1: no Hospital Wing), knocks you back and drops the Quaffle; a spell that
 *   passes by a Bludger beats it away toward the other side. After QD_SNITCH_AFTER_S the Golden Snitch appears; it darts
 *   off (faster than you fly) whenever a seeker comes close, but every dart tires it: a side's seeker who stays within
 *   QD_CATCH_R of it for QD_CATCH_S catches it, +QD_SNITCH, and the match ends. NPCs fill each
 *   side up to QD_FILL and play (chasers chase and throw, a seeker hunts the Snitch). `quidditch chase` lets an agent
 *   fly on autopilot toward its ball (the Quaffle, or the Snitch for a seeker), throwing when in range.
 * - Leaving the pitch, going offline or being jailed benches you. The Snitch event of the wheel never runs during a match.
 * - Rewards, once, at the whistle (players only, never NPCs): reputation qdRep(goals, caught, won) ≤ QD_REP_MAX, house
 *   points qdCup(team score) ≤ QD_CUP_MAX ('quidditch', under the usual per-wizard term cap), XP, and 20 Galleons for the
 *   catch — Lean `qd_rep_bounded`, `qd_cup_bounded`. One match per term, remembered across a restart (doneTerm).
 */
import { z } from 'zod';
import type { House } from '../shared/constants.js';
import type { Feature } from './feature.js';
import type { Vec2, Wizard } from './types.js';
import type { World } from './world.js';

declare module './world.js' {
  interface World {
    /** 魁地奇 (this module's Feature): this term's match, and which term already had one. */
    qd: QdState;
  }
}

export const QD_PITCH = { x: 40, z: -150, r: 30 };
/** The three hoops at each end (src/shared/map.ts): side 0 defends the north end and scores in the south. */
export const QD_HOOPS: readonly [readonly Vec2[], readonly Vec2[]] = [
  [{ x: 34, z: -178 }, { x: 40, z: -178 }, { x: 46, z: -178 }],
  [{ x: 34, z: -122 }, { x: 40, z: -122 }, { x: 46, z: -122 }],
];
export const QD_ENDS: readonly Vec2[] = [{ x: 40, z: -168 }, { x: 40, z: -132 }];
export const QD_PAIRS: readonly [House, House][] = [
  ['Gryffindor', 'Slytherin'], ['Ravenclaw', 'Hufflepuff'], ['Gryffindor', 'Ravenclaw'],
  ['Slytherin', 'Hufflepuff'], ['Gryffindor', 'Hufflepuff'], ['Slytherin', 'Ravenclaw'],
];
export const QD_START_FRAC = 0.3, QD_CALL_S = 45, QD_PLAY_S = 240, QD_SNITCH_AFTER_S = 60, QD_RESULT_S = 20;
export const QD_FLY = 1.5, QD_FILL = 3, QD_SIDE_MAX = 7, QD_BENCH_R = 44;
export const QD_GOAL_LINE_S = 15;
export const QD_GOAL = 10, QD_SNITCH = 150, QD_HOOP_R = 1.6, QD_THROW_V = 16, QD_THROW_MAX = 24, QD_AUTO_THROW = 15;
export const QD_BLUDGER_V = 7.5, QD_BLUDGER_DMG = 6, QD_BLUDGER_RETARGET_S = 8, QD_BEAT_R = 1.4;
/** The Snitch: cruising speed; a seeker within QD_DART_R makes it dart off at QD_DART_V (faster than you fly), then it must rest QD_DART_CD_S. */
export const QD_SNITCH_V = 8, QD_NO_REST_R = 6, QD_DART_R = 4, QD_DART_V = 15, QD_DART_S = 1, QD_DART_CD_S = 0.3, QD_FLEE_R = 10, QD_CATCH_R = 1.5, QD_CATCH_S = 0.8;
/** It tires: every dart costs one of QD_STAMINA_MIN..MAX (random per match), one comes back every QD_STAMINA_REGEN_S; out of darts it can be caught. */
export const QD_STAMINA_MIN = 8, QD_STAMINA_MAX = 16, QD_STAMINA_REGEN_S = 12, QD_SPAWN_CLEAR = 12;
/** Rewards: reputation per goal (at most QD_GOALS_PAID goals), for the catch, for the win; house points per 5 of the score. */
export const QD_GOAL_REP = 2, QD_GOALS_PAID = 5, QD_CATCH_REP = 10, QD_WIN_REP = 5;
export const QD_REP_MAX = QD_GOAL_REP * QD_GOALS_PAID + QD_CATCH_REP + QD_WIN_REP;
export const QD_CUP_MAX = 60;

/** Reputation for one player's match (Lean `qdRep`, `qd_rep_bounded`): monotone, never above QD_REP_MAX. */
export function qdRep(goals: number, caught: boolean, won: boolean): number {
  return QD_GOAL_REP * Math.min(Math.max(0, Math.floor(goals)), QD_GOALS_PAID) + (caught ? QD_CATCH_REP : 0) + (won ? QD_WIN_REP : 0);
}
/** House points a player earns from their team's score (Lean `qdCup`, `qd_cup_bounded`). */
export function qdCup(score: number): number {
  return Math.min(QD_CUP_MAX, Math.floor(Math.max(0, score) / 5));
}

export type QdRole = 'chaser' | 'seeker';
export interface QdPlayer { side: 0 | 1; role: QdRole; goals: number; chase: boolean; wantSeeker: boolean }
interface Ball { x: number; z: number }
export interface QdMatch {
  term: number; sides: [House, House]; phase: 'call' | 'play' | 'done';
  /** call: the whistle; play: the hard end; done: when the result stops showing. */
  until: number;
  startedAt: number;
  score: [number, number];
  roster: Record<string, QdPlayer>;
  quaffle: Ball & { vx: number; vz: number; flying: number; carrier: string | null; thrower: string | null; deadUntil: number };
  bludgers: (Ball & { vx: number; vz: number; away: number; target: string | null; retargetAt: number })[];
  snitch: (Ball & { wx: number; wz: number; hover: number; near: Record<string, number>; dartUntil: number; dartReady: number; stamina: number }) | null;
  snitchAt: number;
  caughtBy: string | null;
  winner: 0 | 1 | null;
}
export interface QdState { match: QdMatch | null; doneTerm: number }
export const newQd = (): QdState => ({ match: null, doneTerm: 0 });

const d2 = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
const houseZh: Record<House, string> = { Gryffindor: '格兰芬多', Hufflepuff: '赫奇帕奇', Ravenclaw: '拉文克劳', Slytherin: '斯莱特林' };

/** Is this wizard flying in a match right now (World.moveWizard: QD_FLY × speed)? */
export function qdFlying(world: World, w: Wizard): boolean {
  const m = world.qd.match;
  return !!m && m.phase === 'play' && !!m.roster[w.id] && d2(w.pos, QD_PITCH) <= QD_BENCH_R;
}
export const qdPlaying = (world: World, wid: string) => { const m = world.qd.match; return !!m && m.phase === 'play' && !!m.roster[wid]; };
/** On this match's roster at all (called or playing). */
export const qdOnTeam = (world: World, wid: string) => { const m = world.qd.match; return !!m && m.phase !== 'done' && !!m.roster[wid]; };
/** In the Duelling Club (queued or in a match): not free for Quidditch. */
const inDuel = (world: World, wid: string) => { const d = world.duel; return d.queue.some((q) => q.id === wid) || (!!d.match && (d.match.a === wid || d.match.b === wid)); };

function schedule(world: World) {
  const len = world.term.endsAt - world.term.startedAt;
  const whistle = world.term.startedAt + QD_START_FRAC * len;
  return { whistle, play: Math.min(QD_PLAY_S, len / 2), snitch: Math.min(QD_SNITCH_AFTER_S, Math.min(QD_PLAY_S, len / 2) / 4) };
}
export const qdPairing = (term: number): [House, House] => [...QD_PAIRS[(((term - 1) % QD_PAIRS.length) + QD_PAIRS.length) % QD_PAIRS.length]] as [House, House];

function lee(world: World, en: string, zh: string) { world.emit('quidditch', `🎙 Lee Jordan: ${en}`, { zh: `🎙 李·乔丹：${zh}` }); }

// ------------------------------------------------------------------ joining
export function qdJoin(world: World, wid: string, role?: QdRole) {
  const w = world.wizards.get(wid);
  if (!w) throw new Error('Unknown wizard.');
  const m = world.qd.match;
  if (!m || m.phase === 'done') {
    const s = schedule(world), next = qdPairing(world.term.n);
    const when = world.qd.doneTerm === world.term.n || world.now > s.whistle ? 'next term' : `in ${Math.max(0, Math.ceil(s.whistle - QD_CALL_S - world.now))}s`;
    throw new Error(`No Quidditch match is being called. The next one, ${when}: ${next[0]} v ${next[1]}. 现在没有魁地奇比赛在集合：下一场${when === 'next term' ? '在下学期' : `${Math.max(0, Math.ceil(s.whistle - QD_CALL_S - world.now))} 秒后集合`}，${houseZh[next[0]]} 对 ${houseZh[next[1]]}。`);
  }
  const side = m.sides.indexOf(w.house);
  if (side < 0) throw new Error(`This match is ${m.sides[0]} v ${m.sides[1]}: cheer from the stands. 这一场是${houseZh[m.sides[0]]}对${houseZh[m.sides[1]]}：去看台上加油吧。`);
  if (!world.isActive(w)) throw new Error('You cannot play while stunned or in Azkaban. 被击晕或在阿兹卡班时不能上场。');
  if (inDuel(world, wid)) throw new Error('You are in the Duelling Club: finish or leave it first (duel_club leave). 你在决斗俱乐部里：先打完或退出（duel_club leave）。');
  const p = m.roster[wid];
  if (p) { if (role) p.wantSeeker = role === 'seeker'; return qdStatus(world, wid); }
  if (Object.values(m.roster).filter((x) => x.side === side).length >= QD_SIDE_MAX) throw new Error('Your team is full. 你们队满员了。');
  m.roster[wid] = { side: side as 0 | 1, role: 'chaser', goals: 0, chase: false, wantSeeker: role === 'seeker' };
  if (m.phase === 'play') { place(world, w, side as 0 | 1); if (role === 'seeker' && !seekerOf(m, side as 0 | 1)) m.roster[wid].role = 'seeker'; }
  return qdStatus(world, wid);
}

export function qdLeave(world: World, wid: string) {
  const m = world.qd.match;
  if (m && m.roster[wid]) bench(world, m, wid);
  return qdStatus(world, wid);
}

/** Autopilot for an agent: fly at your ball (the Snitch for a seeker, else the Quaffle), throwing when in range. */
export function qdChase(world: World, wid: string, on: boolean) {
  const m = world.qd.match, p = m?.roster[wid];
  if (!m || !p) throw new Error('You are not on a team. Call quidditch join first. 你还没上场：先 quidditch join。');
  p.chase = on;
  if (!on) { const w = world.wizards.get(wid); if (w && w.goalBy === 'agent') { w.goal = null; w.route = []; w.goalBy = null; } }
  return qdStatus(world, wid);
}

/** Throw the Quaffle you carry at one of the hoops at the other end (the nearest, or left / middle / right). */
export function qdThrow(world: World, wid: string, hoop?: 'left' | 'middle' | 'right') {
  const m = world.qd.match, p = m?.roster[wid], w = world.wizards.get(wid);
  if (!m || m.phase !== 'play' || !p || !w) throw new Error('You are not playing. 你不在场上。');
  if (m.quaffle.carrier !== wid) throw new Error('You do not have the Quaffle. 鬼飞球不在你手里。');
  const hoops = QD_HOOPS[1 - p.side];
  const t = hoop ? hoops[hoop === 'left' ? 0 : hoop === 'middle' ? 1 : 2] : [...hoops].sort((a, b) => d2(w.pos, a) - d2(w.pos, b))[0];
  launch(m, w, t);
  return qdStatus(world, wid);
}

function launch(m: QdMatch, w: Wizard, to: Vec2) {
  const q = m.quaffle, l = d2(w.pos, to) || 1;
  q.vx = ((to.x - w.pos.x) / l) * QD_THROW_V;
  q.vz = ((to.z - w.pos.z) / l) * QD_THROW_V;
  q.flying = Math.min(QD_THROW_MAX, l + 3) / QD_THROW_V;
  q.thrower = w.id;
  q.carrier = null;
  q.x = w.pos.x; q.z = w.pos.z;
}

function seekerOf(m: QdMatch, side: 0 | 1) { return Object.keys(m.roster).find((id) => m.roster[id].side === side && m.roster[id].role === 'seeker'); }

function place(world: World, w: Wizard, side: 0 | 1) {
  const e = QD_ENDS[side], n = Object.values(world.qd.match!.roster).filter((x) => x.side === side).length;
  w.pos = { x: e.x + ((n % 5) - 2) * 3, z: e.z };
  w.goal = null; w.route = []; w.goalBy = null;
  world.moved(w);
}

function bench(world: World, m: QdMatch, wid: string) {
  if (m.quaffle.carrier === wid) { m.quaffle.carrier = null; m.quaffle.flying = 0; }
  const p = m.roster[wid];
  delete m.roster[wid];
  const w = world.wizards.get(wid);
  if (w && p?.chase && w.goalBy === 'agent') { w.goal = null; w.route = []; w.goalBy = null; }
}

// ------------------------------------------------------------------ the match
function startPlay(world: World, m: QdMatch) {
  const s = schedule(world);
  m.phase = 'play';
  m.startedAt = world.now;
  m.until = world.now + s.play;
  m.snitchAt = world.now + s.snitch;
  // NPCs fill each side: their own house first, then guests nobody else has taken
  const npcs = [...world.wizards.values()].filter((w) => w.npc && world.isActive(w) && !m.roster[w.id] && !inDuel(world, w.id));
  for (const side of [0, 1] as const) {
    const have = () => Object.values(m.roster).filter((x) => x.side === side).length;
    for (const w of [...npcs.filter((x) => x.house === m.sides[side]), ...npcs.filter((x) => x.house !== m.sides[side])]) {
      if (have() >= QD_FILL) break;
      if (m.roster[w.id]) continue;
      m.roster[w.id] = { side, role: 'chaser', goals: 0, chase: true, wantSeeker: false };
    }
  }
  // one seeker a side: a player who asked, else an NPC, else the first to join
  for (const side of [0, 1] as const) {
    const ids = Object.keys(m.roster).filter((id) => m.roster[id].side === side);
    const pick = ids.find((id) => m.roster[id].wantSeeker && !world.wizards.get(id)?.npc) ?? ids.find((id) => world.wizards.get(id)?.npc) ?? ids[0];
    if (pick) m.roster[pick].role = 'seeker';
  }
  const bySide: [number, number] = [0, 0];
  for (const [id, p] of Object.entries(m.roster)) {
    const w = world.wizards.get(id);
    if (!w) continue;
    const e = QD_ENDS[p.side];
    w.pos = { x: e.x + ((bySide[p.side]++ % 5) - 2) * 3, z: e.z };
    w.goal = null; w.route = []; w.goalBy = null;
    world.moved(w);
  }
  m.quaffle = { x: QD_PITCH.x, z: QD_PITCH.z, vx: 0, vz: 0, flying: 0, carrier: null, thrower: null, deadUntil: world.now + 1 };
  m.bludgers = [-6, 6].map((dx) => ({ x: QD_PITCH.x + dx, z: QD_PITCH.z, vx: 0, vz: 0, away: 0, target: null, retargetAt: 0 }));
  world.fx({ k: 'nova', x: QD_PITCH.x, z: QD_PITCH.z, r: 8, e: 'light' });
  lee(world, `And they're off! ${m.sides[0]} v ${m.sides[1]} — the Quaffle is up!`, `比赛开始！${houseZh[m.sides[0]]}对${houseZh[m.sides[1]]}——鬼飞球抛起来了！`);
}

function endPlay(world: World, m: QdMatch) {
  m.phase = 'done';
  m.until = world.now + QD_RESULT_S;
  m.winner = m.score[0] === m.score[1] ? null : m.score[0] > m.score[1] ? 0 : 1;
  world.qd.doneTerm = m.term;
  const lines: string[] = [], zh: string[] = [];
  for (const [id, p] of Object.entries(m.roster)) {
    const w = world.wizards.get(id);
    if (!w || w.npc) continue;
    const won = m.winner === p.side, caught = m.caughtBy === id;
    const rep = qdRep(p.goals, caught, won);
    if (rep) world.addRep(w, rep, 'quidditch');
    const cup = world.cupGain(w, qdCup(m.score[p.side]), 'quidditch');
    world.gainXp(w, won ? 60 : 30);
    if (caught) w.galleons += 20;
    world.emit('quidditch', `Quidditch: ${won ? 'you won' : m.winner === null ? 'a draw' : 'you lost'} ${m.score[p.side]}–${m.score[1 - p.side]}. +${rep} reputation, +${cup} house points${caught ? ', 20 Galleons for the Snitch' : ''}.`, {
      to: id, zh: `魁地奇：${won ? '你们赢了' : m.winner === null ? '平局' : '你们输了'} ${m.score[p.side]}:${m.score[1 - p.side]}。声望 +${rep}，学院分 +${cup}${caught ? '，抓住飞贼 20 加隆' : ''}。`,
    });
    if (p.goals) { lines.push(`${w.name} ${p.goals} goal${p.goals > 1 ? 's' : ''}`); zh.push(`${w.name} 进 ${p.goals} 球`); }
  }
  const c = m.caughtBy ? world.wizards.get(m.caughtBy)?.name : null;
  const [A, B] = m.sides;
  const res = m.winner === null ? { en: 'a draw', zh: '平局' } : { en: `${m.sides[m.winner]} win`, zh: `${houseZh[m.sides[m.winner]]}获胜` };
  lee(world, `Full time: ${A} ${m.score[0]} – ${m.score[1]} ${B}, ${res.en}${c ? ` — ${c} caught the Snitch!` : '.'}${lines.length ? ` (${lines.join(', ')})` : ''}`,
    `终场：${houseZh[A]} ${m.score[0]} : ${m.score[1]} ${houseZh[B]}，${res.zh}${c ? `——${c} 抓住了金色飞贼！` : '。'}${zh.length ? `（${zh.join('，')}）` : ''}`);
  for (const [id, p] of Object.entries(m.roster)) { const w = world.wizards.get(id); if (w && p.chase && w.goalBy === 'agent') { w.goal = null; w.route = []; w.goalBy = null; } }
}

/** 20 Hz, from World.step. */
export function stepQuidditch(world: World, dt: number) {
  const q = world.qd;
  let m = q.match;
  if (m && m.term !== world.term.n && m.phase !== 'done') endPlay(world, m); // the term ended under it
  if (m && m.phase === 'done' && (world.now >= m.until || m.term !== world.term.n)) { q.match = m = null; }
  const s = schedule(world);
  if (!m) {
    if (q.doneTerm === world.term.n || world.now < s.whistle - QD_CALL_S || world.now > s.whistle + 5) return;
    q.match = m = {
      term: world.term.n, sides: qdPairing(world.term.n), phase: 'call', until: s.whistle, startedAt: 0, score: [0, 0], roster: {},
      quaffle: { x: QD_PITCH.x, z: QD_PITCH.z, vx: 0, vz: 0, flying: 0, carrier: null, thrower: null, deadUntil: 0 }, bludgers: [], snitch: null, snitchAt: 0, caughtBy: null, winner: null,
    };
    lee(world, `Quidditch in ${Math.round(s.whistle - world.now)} seconds: ${m.sides[0]} v ${m.sides[1]}! Players to the pitch (quidditch join / P).`,
      `${Math.round(s.whistle - world.now)} 秒后魁地奇开赛：${houseZh[m.sides[0]]}对${houseZh[m.sides[1]]}！队员到球场集合（quidditch join / 按 P）。`);
    return;
  }
  if (m.phase === 'call') { if (world.now >= m.until) startPlay(world, m); return; }
  if (m.phase !== 'play') return;
  // bench whoever left, went offline or was jailed
  for (const id of Object.keys(m.roster)) {
    const w = world.wizards.get(id);
    if (!w || (!w.npc && !world.online(w)) || w.st.jailedUntil > 0 || d2(w.pos, QD_PITCH) > QD_BENCH_R) bench(world, m, id);
  }
  stepQuaffle(world, m, dt);
  stepBludgers(world, m, dt);
  stepSnitch(world, m, dt);
  steer(world, m);
  if (m.phase === 'play' && world.now >= m.until) endPlay(world, m);
}

function stepQuaffle(world: World, m: QdMatch, dt: number) {
  const q = m.quaffle;
  if (q.carrier) {
    const c = world.wizards.get(q.carrier);
    if (!c || !m.roster[q.carrier]) { q.carrier = null; q.flying = 0; return; }
    q.x = c.pos.x; q.z = c.pos.z;
    return;
  }
  if (q.flying > 0) {
    const ax = q.x, az = q.z;
    q.x += q.vx * dt; q.z += q.vz * dt;
    q.flying -= dt;
    const tp = q.thrower ? m.roster[q.thrower] : undefined;
    // through a hoop at the other end
    if (tp) for (const h of QD_HOOPS[1 - tp.side]) {
      if (segDist(ax, az, q.x, q.z, h) <= QD_HOOP_R) return goal(world, m, q.thrower!, tp);
    }
    // a defender (anyone on the other side) who touches it in flight intercepts it
    for (const id of Object.keys(m.roster)) {
      if (tp && m.roster[id].side === tp.side) continue;
      const w = world.wizards.get(id);
      if (w && world.isActive(w) && d2(w.pos, q) <= 1.0) { q.carrier = id; q.flying = 0; q.thrower = null; return; }
    }
    if (d2(q, QD_PITCH) > QD_PITCH.r) { const l = d2(q, QD_PITCH); q.x = QD_PITCH.x + ((q.x - QD_PITCH.x) / l) * QD_PITCH.r; q.z = QD_PITCH.z + ((q.z - QD_PITCH.z) / l) * QD_PITCH.r; q.flying = 0; }
    return;
  }
  if (world.now < q.deadUntil) return;
  let best: string | null = null, bd = 1.5;
  for (const id of Object.keys(m.roster)) {
    const w = world.wizards.get(id);
    if (!w || !world.isActive(w)) continue;
    const d = d2(w.pos, q);
    if (d <= bd) { bd = d; best = id; }
  }
  if (best) { q.carrier = best; q.thrower = null; }
}

function goal(world: World, m: QdMatch, id: string, p: QdPlayer) {
  m.score[p.side] += QD_GOAL;
  p.goals++;
  const w = world.wizards.get(id);
  const q = m.quaffle;
  world.fx({ k: 'levelup', x: q.x, z: q.z, h: w?.handle });
  q.x = QD_PITCH.x; q.z = QD_PITCH.z; q.flying = 0; q.carrier = null; q.thrower = null; q.deadUntil = world.now + 2;
  // a guest (an NPC from another house filling in) is named as one; at most one goal line every QD_GOAL_LINE_S (it drowned the event feed)
  const guest = w && w.house !== m.sides[p.side];
  const who = { en: `${w?.name ?? '?'}${guest ? ` (guest for ${m.sides[p.side]})` : ''}`, zh: `${w?.name ?? '?'}${guest ? `（替${houseZh[m.sides[p.side]]}客串）` : ''}` };
  if (world.banter(['qd:goal', QD_GOAL_LINE_S])) lee(world, `${who.en} scores! ${m.sides[0]} ${m.score[0]} – ${m.score[1]} ${m.sides[1]}.`, `${who.zh} 进球！${houseZh[m.sides[0]]} ${m.score[0]} : ${m.score[1]} ${houseZh[m.sides[1]]}。`);
}

function stepBludgers(world: World, m: QdMatch, dt: number) {
  const ids = Object.keys(m.roster);
  for (const b of m.bludgers) {
    if (b.away > 0) {
      b.away -= dt;
      b.x += b.vx * dt; b.z += b.vz * dt;
      b.vx *= 0.97; b.vz *= 0.97;
      clampPitch(b);
      continue;
    }
    let t = b.target ? world.wizards.get(b.target) : undefined;
    if (!t || !m.roster[t.id] || world.now >= b.retargetAt) {
      const pool = ids.filter((id) => world.wizards.get(id) && world.isActive(world.wizards.get(id)!));
      b.target = pool.length ? pool[Math.floor(world.funRand() * pool.length) % pool.length] : null;
      b.retargetAt = world.now + QD_BLUDGER_RETARGET_S;
      t = b.target ? world.wizards.get(b.target) : undefined;
    }
    if (!t) continue;
    const l = d2(t.pos, b);
    if (l <= 1.0) { hit(world, m, b, t); continue; }
    const step = Math.min(l, QD_BLUDGER_V * dt);
    b.x += ((t.pos.x - b.x) / l) * step; b.z += ((t.pos.z - b.z) / l) * step;
  }
}

function hit(world: World, m: QdMatch, b: QdMatch['bludgers'][number], t: Wizard) {
  t.hp = Math.max(1, t.hp - QD_BLUDGER_DMG);
  world.knock(b, t.id, 3);
  world.fx({ k: 'hit', x: t.pos.x, z: t.pos.z, h: t.handle, n: QD_BLUDGER_DMG, e: 'arcane' });
  if (m.quaffle.carrier === t.id) { m.quaffle.carrier = null; m.quaffle.flying = 0; m.quaffle.deadUntil = world.now + 0.6; }
  const l = d2(t.pos, b) || 1;
  b.vx = ((b.x - t.pos.x) / l) * 12; b.vz = ((b.z - t.pos.z) / l) * 12; b.away = 1.2;
  b.target = null;
  if (world.banter([`qd:bludger`, 12])) lee(world, `Ouch — a Bludger on ${t.name}!`, `哎哟——游走球砸中了 ${t.name}！`);
}

/** A spell in flight passes a Bludger: beaten away along the spell's path, toward the other side (World.stepProjectiles). */
export function quidditchBolt(world: World, p: { owner: string; pos: Vec2; vel: Vec2 }) {
  const m = world.qd.match;
  if (!m || m.phase !== 'play') return;
  const me = m.roster[p.owner];
  if (!me) return;
  for (const b of m.bludgers) {
    if (b.away > 0 || d2(p.pos, b) > QD_BEAT_R) continue;
    const l = Math.hypot(p.vel.x, p.vel.z) || 1;
    b.vx = (p.vel.x / l) * 14; b.vz = (p.vel.z / l) * 14; b.away = 1.2;
    const foes = Object.keys(m.roster).filter((id) => m.roster[id].side !== me.side);
    b.target = foes.length ? foes.sort((x, y) => d2(world.wizards.get(x)!.pos, b) - d2(world.wizards.get(y)!.pos, b))[0] : null;
    b.retargetAt = world.now + QD_BLUDGER_RETARGET_S;
  }
}

function stepSnitch(world: World, m: QdMatch, dt: number) {
  if (!m.snitch) {
    if (world.now < m.snitchAt) return;
    // somewhere on the pitch no seeker is already waiting
    const seekers = Object.keys(m.roster).filter((id) => m.roster[id].role === 'seeker').map((id) => world.wizards.get(id)?.pos).filter((p): p is Vec2 => !!p);
    let at: Vec2 = QD_PITCH;
    for (let i = 0; i < 12; i++) {
      const a = world.funRand() * Math.PI * 2, r = Math.sqrt(world.funRand()) * QD_PITCH.r * 0.8;
      at = { x: QD_PITCH.x + Math.cos(a) * r, z: QD_PITCH.z + Math.sin(a) * r };
      if (seekers.every((p) => d2(p, at) >= QD_SPAWN_CLEAR)) break;
    }
    const stamina = QD_STAMINA_MIN + Math.floor(world.funRand() * (QD_STAMINA_MAX - QD_STAMINA_MIN + 1));
    m.snitch = { x: at.x, z: at.z, wx: 0, wz: 0, hover: 0, near: {}, dartUntil: 0, dartReady: 0, stamina };
    waypoint(world, m.snitch);
    lee(world, 'The Golden Snitch has been sighted! Seekers, go!', '金色飞贼出现了！找球手，冲啊！');
    return;
  }
  const s = m.snitch;
  s.stamina = Math.min(QD_STAMINA_MAX, s.stamina + dt / QD_STAMINA_REGEN_S);
  // a seeker too close: it darts off, away from them (then it has to rest before it can dart again), while it has the strength
  if (world.now >= s.dartReady && s.stamina >= 1) {
    for (const id of Object.keys(m.roster)) {
      const w = m.roster[id].role === 'seeker' ? world.wizards.get(id) : undefined;
      if (!w || d2(w.pos, s) > QD_DART_R) continue;
      flee(world, s, w.pos);
      s.hover = 0; s.dartUntil = world.now + QD_DART_S; s.dartReady = world.now + QD_DART_S + QD_DART_CD_S; s.stamina -= 1;
      break;
    }
  }
  // it never rests with a seeker close by
  if (s.hover > 0 && Object.keys(m.roster).some((id) => m.roster[id].role === 'seeker' && d2(world.wizards.get(id)?.pos ?? QD_PITCH, s) <= QD_NO_REST_R)) s.hover = 0;
  if (s.hover > 0) s.hover -= dt;
  else {
    const dx = s.wx - s.x, dz = s.wz - s.z, l = Math.hypot(dx, dz), step = (world.now < s.dartUntil ? QD_DART_V : QD_SNITCH_V) * dt;
    if (l <= step) {
      s.x = s.wx; s.z = s.wz;
      // a seeker on its tail: keep running, away from the nearest; nobody close: rest a moment, then wander
      const near = Object.keys(m.roster).filter((id) => m.roster[id].role === 'seeker').map((id) => world.wizards.get(id)?.pos).filter((p): p is Vec2 => !!p && d2(p, s) <= QD_FLEE_R).sort((a, b) => d2(a, s) - d2(b, s))[0];
      if (near) { flee(world, s, near); } else { s.hover = 0.4 + world.funRand() * 0.8; waypoint(world, s); }
    }
    else { s.x += (dx / l) * step; s.z += (dz / l) * step; }
  }
  for (const id of Object.keys(m.roster)) {
    if (m.roster[id].role !== 'seeker') continue;
    const w = world.wizards.get(id);
    if (w && world.isActive(w) && d2(w.pos, s) <= QD_CATCH_R) {
      s.near[id] = (s.near[id] ?? 0) + dt;
      if (s.near[id] >= QD_CATCH_S) {
        m.caughtBy = id;
        m.score[m.roster[id].side] += QD_SNITCH;
        world.fx({ k: 'levelup', x: s.x, z: s.z, h: w.handle });
        lee(world, `${w.name} has caught the Snitch! +${QD_SNITCH}!`, `${w.name} 抓住了金色飞贼！+${QD_SNITCH}！`);
        m.snitch = null;
        endPlay(world, m);
        return;
      }
    } else delete s.near[id];
  }
}

/** Away from `from`, with a random swerve, never off the pitch (at the edge it slides along it). */
function flee(world: World, s: Ball & { wx: number; wz: number }, from: Vec2) {
  const l = d2(from, s) || 1, ax = (s.x - from.x) / l, az = (s.z - from.z) / l, turn = (world.funRand() - 0.5) * 1.6;
  const c = Math.cos(turn), sn = Math.sin(turn);
  const t = { x: s.x + (ax * c - az * sn) * 14, z: s.z + (ax * sn + az * c) * 14 };
  clampPitch(t);
  s.wx = t.x; s.wz = t.z;
}

function waypoint(world: World, s: { wx: number; wz: number }) {
  const a = world.funRand() * Math.PI * 2, r = Math.sqrt(world.funRand()) * QD_PITCH.r * 0.9;
  s.wx = QD_PITCH.x + Math.cos(a) * r; s.wz = QD_PITCH.z + Math.sin(a) * r;
}

/** NPCs and agents on autopilot: fly at their ball; a carrier flies at the hoops and throws in range. */
function steer(world: World, m: QdMatch) {
  if (m.phase !== 'play') return;
  const q = m.quaffle;
  for (const [id, p] of Object.entries(m.roster)) {
    if (!p.chase) continue;
    const w = world.wizards.get(id);
    if (!w || !world.isActive(w) || (!w.npc && world.playerSteering(w))) continue;
    let to: Vec2 | null = null;
    if (p.role === 'seeker') to = m.snitch ? { x: m.snitch.x, z: m.snitch.z } : QD_ENDS[p.side];
    else if (q.carrier === id) {
      const h = [...QD_HOOPS[1 - p.side]].sort((a, b) => d2(w.pos, a) - d2(w.pos, b))[0];
      if (d2(w.pos, h) <= QD_AUTO_THROW) { launch(m, w, h); continue; }
      to = { x: h.x, z: h.z + (p.side === 0 ? -8 : 8) };
    } else if (!q.carrier || m.roster[q.carrier]?.side !== p.side) to = { x: q.x, z: q.z };
    else to = { x: QD_PITCH.x + (p.side === 0 ? 6 : -6), z: QD_HOOPS[1 - p.side][1].z + (p.side === 0 ? -12 : 12) }; // get open for a pass
    if (to) { w.goal = { ...to }; w.route = []; w.goalBy = 'agent'; }
  }
}

function clampPitch(b: Ball) {
  const l = d2(b, QD_PITCH);
  if (l > QD_PITCH.r) { b.x = QD_PITCH.x + ((b.x - QD_PITCH.x) / l) * QD_PITCH.r; b.z = QD_PITCH.z + ((b.z - QD_PITCH.z) / l) * QD_PITCH.r; }
}
function segDist(ax: number, az: number, bx: number, bz: number, p: Vec2) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.z - az) * dz) / l2)) : 0;
  return Math.hypot(ax + dx * t - p.x, az + dz * t - p.z);
}

// ------------------------------------------------------------------ views
export function qdStatus(world: World, wid: string | null) {
  const m = world.qd.match, s = schedule(world);
  const name = (id: string | null) => (id ? world.wizards.get(id)?.name ?? '?' : null);
  const you = wid && m?.roster[wid] ? m.roster[wid] : null;
  const next = qdPairing(world.term.n);
  return {
    match: m ? {
      teams: m.sides, phase: m.phase, secondsLeft: Math.max(0, Math.ceil(m.until - world.now)), score: m.score,
      quaffle: { x: round(m.quaffle.x), z: round(m.quaffle.z), carrier: name(m.quaffle.carrier), flying: m.quaffle.flying > 0 },
      bludgers: m.bludgers.map((b) => ({ x: round(b.x), z: round(b.z), chasing: name(b.target) })),
      snitch: m.snitch ? { x: round(m.snitch.x), z: round(m.snitch.z) } : m.phase === 'play' ? { appearsIn: Math.max(0, Math.ceil(m.snitchAt - world.now)) } : null,
      roster: Object.entries(m.roster).map(([id, p]) => ({ name: name(id), house: m.sides[p.side], role: p.role, goals: p.goals, npc: !!world.wizards.get(id)?.npc })),
      caughtBy: name(m.caughtBy), winner: m.winner === null ? null : m.sides[m.winner],
      yourHoops: you ? QD_HOOPS[1 - you.side] : undefined,
    } : null,
    next: m ? null : world.qd.doneTerm === world.term.n || world.now > s.whistle + 5 ? { term: world.term.n + 1, teams: qdPairing(world.term.n + 1) } : { term: world.term.n, teams: next, callsIn: Math.max(0, Math.ceil(s.whistle - QD_CALL_S - world.now)) },
    you: you ? { side: m!.sides[you.side], role: you.role, goals: you.goals, autopilot: you.chase, carrying: m!.quaffle.carrier === wid } : null,
    pitch: QD_PITCH,
    rules: { goal: QD_GOAL, snitch: QD_SNITCH, bludgerDamage: QD_BLUDGER_DMG, reputationMax: QD_REP_MAX, housePointsMax: QD_CUP_MAX, howTo: 'join during the call; touch the Quaffle to take it, throw it (quidditch throw) through a hoop at the other end; a spell that passes a Bludger beats it away; a seeker who stays within 1.5 m of the Snitch for 0.5 s catches it. quidditch chase = autopilot.' },
  };
}

/** The snapshot's `qd` (every client: the match is public). */
export function qdWire(world: World) {
  const m = world.qd.match;
  if (!m) return undefined;
  const h = (id: string | null) => (id ? world.wizards.get(id)?.handle ?? '' : '');
  return {
    s: m.sides, sc: m.score, ph: m.phase, t: Math.max(0, Math.ceil(m.until - world.now)),
    q: m.phase === 'play' ? [round(m.quaffle.x), round(m.quaffle.z), h(m.quaffle.carrier)] as [number, number, string] : null,
    bl: m.phase === 'play' ? m.bludgers.map((b) => [round(b.x), round(b.z)] as [number, number]) : [],
    sn: m.snitch ? [round(m.snitch.x), round(m.snitch.z)] as [number, number] : null,
    sa: m.phase === 'play' && !m.snitch ? Math.max(0, Math.ceil(m.snitchAt - world.now)) : 0,
    r: Object.entries(m.roster).map(([id, p]) => [h(id), p.side, p.role === 'seeker' ? 1 : 0] as [string, number, number]),
    w: m.phase === 'done' ? m.winner : undefined,
    c: m.caughtBy ? world.wizards.get(m.caughtBy)?.name : undefined,
  };
}
const round = (n: number) => Math.round(n * 10) / 10;

// ------------------------------------------------------------------ the plug (kernel/feature.ts)
const QD_OPS = ['join', 'leave', 'status', 'throw', 'chase', 'stop'] as const;
function runOp(world: World, wid: string, a: Record<string, unknown>) {
  const role = a.role === 'seeker' || a.role === 'chaser' ? a.role : undefined;
  const hoop = a.hoop === 'left' || a.hoop === 'middle' || a.hoop === 'right' ? a.hoop : undefined;
  switch (a.op) {
    case 'join': return qdJoin(world, wid, role);
    case 'leave': return qdLeave(world, wid);
    case 'throw': return qdThrow(world, wid, hoop);
    case 'chase': return qdChase(world, wid, true);
    case 'stop': return qdChase(world, wid, false);
    default: return qdStatus(world, wid);
  }
}

export const QD_FEATURE: Feature = {
  id: 'quidditch',
  init(world) { world.qd = newQd(); },
  step: stepQuidditch,
  wire: { key: 'qd', get: qdWire },
  // which term already had its match (the match itself is not saved)
  save: (world) => ({ doneTerm: world.qd.doneTerm }),
  load(world, data, legacy) {
    const d = (data ?? legacy.quidditch) as { doneTerm?: unknown } | undefined;
    if (typeof d?.doneTerm === 'number') world.qd.doneTerm = d.doneTerm;
  },
  moveMult: (world, w) => (qdFlying(world, w) ? QD_FLY : 1),
  bolt: (world, p) => { if (world.qd.match) quidditchBolt(world, p); },
  // on a team, the match steers you (a duel sparring partner is the duel's: DUEL_FEATURE comes first)
  npc: (world, w) => qdPlaying(world, w.id),
  tools: [{
    name: 'quidditch', title: 'Quidditch', cost: 1,
    description: `魁地奇: one match a term on the pitch (${QD_PITCH.x}, ${QD_PITCH.z}), two houses in turn (status shows who, and when). op "join" (while the match is being called, or during play; role "seeker" to ask to be your side's seeker), "leave", "status" (score, the Quaffle and who carries it, the Bludgers and whom they chase, the Snitch, your hoops), "throw" (the Quaffle you carry, at a hoop at the other end: the nearest, or hoop left/middle/right; through it is +${QD_GOAL}; a defender who touches it in flight intercepts it), "chase" / "stop" (autopilot: fly at your ball — the Quaffle, or the Snitch for a seeker — and throw in range). Players fly ×${QD_FLY} on the pitch; touching the free Quaffle takes it. A Bludger costs ${QD_BLUDGER_DMG} health (never below 1) and the Quaffle; any spell that passes a Bludger beats it away. The Snitch appears after a while and darts off from seekers, but tires: a seeker within ${QD_CATCH_R} m of it for ${QD_CATCH_S} s catches it, +${QD_SNITCH}, and the match ends. At the whistle: up to +${QD_REP_MAX} reputation (goals, the catch, the win), up to +${QD_CUP_MAX} house points from your team's score, XP. NPCs fill each side.`,
    input: { op: z.enum(QD_OPS).optional(), role: z.enum(['chaser', 'seeker']).optional(), hoop: z.enum(['left', 'middle', 'right']).optional() },
    run: runOp,
  }],
  ws: runOp,
};
