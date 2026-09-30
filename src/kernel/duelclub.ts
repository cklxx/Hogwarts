/**
 * 决斗俱乐部 (roadmap step 3): a queue, a stage in the Courtyard, one match at a time, bounded rewards.
 *
 * - `duel_club join` (MCP) / G (browser) queues you; two in the queue make a match; alone for DUEL_NPC_AFTER_S
 *   and an NPC steps up to spar. `join` with mode "2v2" queues you for a team match instead: four make one (the
 *   years balanced: 1st+4th against 2nd+3rd), and after DUEL_NPC_AFTER_S NPCs fill the empty places.
 * - A challenge: `join` with `with` (a name or handle) waits up to DUEL_CHALLENGE_S for that wizard alone — they
 *   accept by joining (plainly, or with your name); no NPC fills in. In a 2v2, `partner` queues you with a chosen
 *   partner (who joins the 2v2 queue plainly or naming you): the two are one side.
 * - In a 2v2 your partner is your ally (no harm, healing allowed); a knocked-out or departed duelist is out (still on
 *   the stage, untouchable and harmless); a side with everyone out loses.
 * - A match: both are placed at the two ends of the stage, healed, and bow (DUEL_BOW_S); a countdown
 *   (DUEL_COUNT_S) in which nobody moves or casts; then they fight for up to DUEL_FIGHT_S. Leaving (or going
 *   offline) before the fight begins calls the match off: no result, no reward, the others back in the queue.
 *   Knocked to zero, walked off the stage (DUEL_LEASH m), stepped into a safe zone (no sheltering where nobody can be
 *   hit) or gone offline during the fight: out. At the bell, whoever dealt more damage wins (regen would wash out an
 *   HP comparison; a bolt sent back by a perfect Protego counts for whoever sent it back), then the healthier one.
 * - While they fight, World.canHarm lets the two (and their summons) harm each other whatever their houses, and
 *   nobody else touch them or be touched by them (formal/tla/Hostility.tla DuelMutual / DuelIsolated); nobody
 *   else may heal or shield them. A knock-out ends the match (no stun, no Hospital Wing, no reputation stolen).
 * - NPC sparring partners fight: they close in for a clear shot and cast what they know, but never heal. The draft
 *   sends the NPC nearest the youngest player's year, and an older one fights at that player's level (sparScale:
 *   以大欺小 cannot happen on the stage). The duel is the player's own choice, so the rest of
 *   npcMayFight (newcomers, the badly hurt, the spawn) does not hold them back on the stage.
 * - Rewards (duelGrant), only for a win fought for (the fight had begun and the winner landed a blow): the winner +DUEL_WIN_REP reputation (and house points) and XP, the loser some XP; only
 *   against a player (an NPC sparring match pays XP only), only once per pair per DUEL_PAIR_GAP_S, and at most
 *   DUEL_TERM_CAP rewarded wins per wizard per term — Lean `duel_club_term_bounded`.
 * - The club is closed while the Minister's rules forbid PvP, or while the stage (its centre or either end) lies in a
 *   safe zone.
 */
import { z } from 'zod';
import { capsFor } from '../runes/primitives.js';
import type { Feature } from './feature.js';
import { qdOnTeam, qdPlaying } from './quidditch.js';
import { stunPaysRep } from './progression.js';
import { DODGE_DIST } from '../shared/constants.js';
import type { World } from './world.js';
import type { Projectile, Vec2, Wizard } from './types.js';

declare module './world.js' {
  interface World {
    /** 决斗俱乐部 (this module's Feature): the queue, the match, the term's reward ledger. */
    duel: DuelClub;
  }
}

export const DUEL_STAGE = { x: 0, z: -30 };
export const DUEL_ENDS = [{ x: -7, z: -30 }, { x: 7, z: -30 }] as const;
/** Matchmaking: at most this many years apart, unless the first in the queue has waited DUEL_ANY_AFTER_S. */
export const DUEL_YEAR_GAP = 1, DUEL_ANY_AFTER_S = 20;
export const DUEL_BOW_S = 2, DUEL_COUNT_S = 3, DUEL_FIGHT_S = 90, DUEL_NPC_AFTER_S = 30, DUEL_LEASH = 22;
/** A challenge (`with`) or a chosen 2v2 partner waits this long for the other wizard, then lapses. */
export const DUEL_CHALLENGE_S = 90;
/** An NPC sparring partner closes in to about this distance for its shots. */
export const DUEL_NPC_REACH = 14;
export const DUEL_WIN_REP = 6, DUEL_WIN_XP = 40, DUEL_LOSS_XP = 15, DUEL_TERM_CAP = 5, DUEL_PAIR_GAP_S = 600, DUEL_QUEUE_MAX = 32;

export type DuelPhase = 'bow' | 'count' | 'fight';
export interface DuelStats {
  dealt: number; hits: number; reflects0: number; dodges0: number;
  /** Of `dealt`: the strength of the bolts this duelist sent back with a perfect Protego (credited when sent back). */
  returned?: number;
}
export interface DuelMatch {
  /** `a` and `b`: the two sides' first duelists (a 1v1's two); `sides`: everyone on each side. */
  id: number; a: string; b: string; phase: DuelPhase; at: number; npc: boolean;
  sides: [string[], string[]];
  /** Duelists out of the fight (knocked out, gone, off the stage) and why. */
  out: Record<string, 'ko' | 'gone'>;
  stats: Record<string, DuelStats>;
}
/** A place in a queue: `with` — a challenge (1v1) naming one wizard; `partner` — a chosen 2v2 partner; `ask`: since when. */
export interface DuelEntry { id: string; at: number; with?: string; partner?: string; ask?: number }
export interface DuelLedger { term: number; wins: Record<string, number>; pairs: Record<string, number> }
export interface DuelResult { a: string; b: string; winner: string | null; secs: number; at: number; sides?: [string[], string[]]; winSide?: 0 | 1 | null }
export interface DuelClub { queue: DuelEntry[]; queue2: DuelEntry[]; match: DuelMatch | null; seq: number; ledger: DuelLedger; last: DuelResult[] }

export const newDuelClub = (): DuelClub => ({ queue: [], queue2: [], match: null, seq: 0, ledger: { term: 0, wins: {}, pairs: {} }, last: [] });

/**
 * The reward step (Lean `duelStep`): a fresh win (not an NPC, not a rematch within the gap) under the term cap
 * counts and pays DUEL_WIN_REP; anything else leaves the count and pays nothing. Returns [wins', reputation].
 */
export function duelStep(wins: number, cap: number, fresh: boolean): [number, number] {
  return fresh && wins < cap ? [wins + 1, DUEL_WIN_REP] : [wins, 0];
}

/** What one finished match pays (mutating the ledger): winner/loser XP and the winner's reputation. */
export function duelGrant(l: DuelLedger, winner: string, loser: string, now: number, term: number, npc: boolean, bully = false) {
  if (l.term !== term) { l.term = term; l.wins = {}; }
  const key = [winner, loser].sort().join('|');
  const rematch = now - (l.pairs[key] ?? -1e12) < DUEL_PAIR_GAP_S;
  const fresh = !npc && !rematch && !bully; // 以大欺小: beating someone BULLY_YEAR_GAP+ years below you is no glory
  const [wins, rep] = duelStep(l.wins[winner] ?? 0, DUEL_TERM_CAP, fresh);
  l.wins[winner] = wins;
  if (!rematch) l.pairs[key] = now;
  const why: 'ok' | 'npc' | 'rematch' | 'bully' | 'cap' = npc ? 'npc' : rematch ? 'rematch' : bully ? 'bully' : rep ? 'ok' : 'cap';
  // NPC sparring always pays its (half) XP — the rematch gap guards reputation between players, not practice
  return { rep, xpWinner: npc ? Math.round(DUEL_WIN_XP / 2) : rematch ? 0 : DUEL_WIN_XP, xpLoser: rematch || npc ? 0 : DUEL_LOSS_XP, why };
}

/** Which side of this match `id` is on: 0, 1, or -1 (not in it). */
export const sideOf = (m: DuelMatch, id: string | null | undefined): -1 | 0 | 1 => (!id ? -1 : m.sides[0].includes(id) ? 0 : m.sides[1].includes(id) ? 1 : -1);
/** Is `id` in the match that is fighting right now (and still in the fight)? */
export function inFight(club: DuelClub, id: string | null | undefined): boolean {
  const m = club.match;
  return !!m && m.phase === 'fight' && sideOf(m, id) >= 0 && !m.out[id!];
}
/** Is `id` in the current match at all (bowing, counting down, fighting, or out of it)? */
export function inMatch(club: DuelClub, id: string | null | undefined): boolean {
  const m = club.match;
  return !!m && sideOf(m, id) >= 0;
}
/** Opponents fighting right now: both in the fight, on different sides (formal/tla/Hostility.tla DuelMutual). */
export function duelFoes(club: DuelClub, x: string | null | undefined, y: string | null | undefined): boolean {
  const m = club.match;
  if (!m || !inFight(club, x) || !inFight(club, y)) return false;
  return sideOf(m, x) !== sideOf(m, y);
}
/** Partners in a 2v2: the same side of this match. */
export const duelPartners = (club: DuelClub, x: string, y: string) => { const m = club.match; return !!m && x !== y && sideOf(m, x) >= 0 && sideOf(m, x) === sideOf(m, y); };
const queued = (c: DuelClub, id: string) => c.queue.some((q) => q.id === id) || c.queue2.some((q) => q.id === id);

/** Why the club is closed right now, or null. */
export function duelClosed(world: World): string | null {
  if (!world.rules.combat.pvp) return 'The Ministry has forbidden duelling (PvP is off). 魔法部禁止了决斗（PvP 已关闭）。';
  if (world.inSafe(DUEL_STAGE) || DUEL_ENDS.some((e) => world.inSafe(e))) return 'The Courtyard is a safe zone by decree: the Duelling Club is closed. 法令把庭院设成了安全区：决斗俱乐部暂停。';
  return null;
}

/** A private line to one wizard (both languages). */
const tell = (world: World, id: string, en: string, zh: string) => { if (world.wizards.has(id)) world.emit('duel', en, { to: id, zh }); };

/** The wizard a challenge or a partner request names: a real wizard (by name or handle, never a registry id), in the castle, not you. */
function rivalOf(world: World, wid: string, key: string, what: 'challenge' | 'partner'): Wizard {
  const id = world.resolveTarget(key.trim(), wid);
  const t = id ? world.wizards.get(id) : undefined;
  if (!t) throw new Error(`There is no wizard called "${key}". 没有叫「${key}」的巫师。`);
  if (t.id === wid) throw new Error(what === 'challenge' ? 'You cannot challenge yourself. 不能向自己挑战。' : 'You cannot be your own partner. 不能和自己搭档。');
  if (t.npc) throw new Error('NPCs take no challenges: join plainly and one spars with you if nobody comes. NPC 不接受指名：直接报名，没人来的话会有 NPC 陪练。');
  if (!world.online(t)) throw new Error(`${t.name} is not in the castle right now. ${t.name} 现在不在城堡里。`);
  return t;
}

export function duelJoin(world: World, wid: string, mode: '1v1' | '2v2' = '1v1', opts: { with?: string; partner?: string } = {}) {
  const c = world.duel, w = world.need(wid);
  const closed = duelClosed(world);
  if (closed) throw new Error(closed);
  if (!world.isActive(w)) throw new Error('Not while you are stunned or in Azkaban. 被击晕或在阿兹卡班时不能报名。');
  if (inMatch(c, wid)) throw new Error('You are duelling right now. 你正在决斗。');
  if (qdPlaying(world, wid)) throw new Error('You are playing Quidditch: leave the pitch first (quidditch leave). 你正在打魁地奇：先下场（quidditch leave）。');
  if (opts.partner) mode = '2v2';
  if (opts.with && mode === '2v2') throw new Error('"with" names a 1v1 opponent; in a 2v2 name your partner with "partner". "with" 用于 1v1 指名对手；2v2 用 "partner" 指定搭档。');
  const rival = opts.with ? rivalOf(world, wid, opts.with, 'challenge') : opts.partner ? rivalOf(world, wid, opts.partner, 'partner') : null;
  const [q, other] = mode === '2v2' ? [c.queue2, c.queue] : [c.queue, c.queue2];
  if (other.some((x) => x.id === wid)) { if (mode === '2v2') c.queue = c.queue.filter((x) => x.id !== wid); else c.queue2 = c.queue2.filter((x) => x.id !== wid); }
  let e = q.find((x) => x.id === wid);
  const was = e?.with ?? e?.partner, fresh = !e;
  if (!e) {
    if (q.length >= DUEL_QUEUE_MAX) throw new Error('The queue is full; try again soon. 排队的人满了，等一会儿。');
    e = { id: wid, at: world.now };
    (mode === '2v2' ? c.queue2 : c.queue).push(e);
  }
  // a plain join takes anyone (it drops an earlier challenge); naming someone (again) starts the wait anew
  delete e.with; delete e.partner; delete e.ask;
  if (rival) { if (mode === '2v2') e.partner = rival.id; else e.with = rival.id; e.ask = world.now; }
  if (rival && rival.id !== was) {
    const accept = mode === '2v2' ? `duel_club {"op":"join","mode":"2v2","partner":"${w.name}"}` : `duel_club {"op":"join","with":"${w.name}"}`;
    if (mode === '2v2') {
      world.emit('duel', `${w.name} signed up for the Duelling Club (2v2) with ${rival.name} as partner.`, { zh: `${w.name} 报名了决斗俱乐部（2v2），想和 ${rival.name} 搭档。` });
      tell(world, rival.id, `${w.name} wants you as a 2v2 partner at the Duelling Club: ${accept} (or join the 2v2 queue) within ${DUEL_CHALLENGE_S}s.`, `${w.name} 想在决斗俱乐部和你搭档打 2v2：${DUEL_CHALLENGE_S} 秒内 ${accept}（或直接排 2v2）即可。`);
    } else {
      world.emit('duel', `${w.name} challenges ${rival.name} at the Duelling Club.`, { zh: `${w.name} 在决斗俱乐部向 ${rival.name} 发起挑战。` });
      tell(world, rival.id, `${w.name} challenges you to a duel: ${accept} (or a plain join) within ${DUEL_CHALLENGE_S}s to accept.`, `${w.name} 向你发起决斗挑战：${DUEL_CHALLENGE_S} 秒内 ${accept}（或直接报名）即可应战。`);
    }
  } else if (fresh && !rival) {
    world.emit('duel', `${w.name} signed up for the Duelling Club${mode === '2v2' ? ' (2v2)' : ''}.`, { zh: `${w.name} 报名了决斗俱乐部${mode === '2v2' ? '（2v2）' : ''}。` });
  }
  return duelStatus(world, wid);
}

export function duelLeave(world: World, wid: string) {
  const c = world.duel;
  const wasQueued = queued(c, wid);
  c.queue = c.queue.filter((q) => q.id !== wid);
  c.queue2 = c.queue2.filter((q) => q.id !== wid);
  const m = c.match;
  if (m && sideOf(m, wid) >= 0) {
    if (m.phase !== 'fight') {
      cancelMatch(world, m, wid, 'left');
      return { ...duelStatus(world, wid), left: 'cancelled' as const, note: 'You left before the fight began: the match is off (no result, no reward, no rematch wait). 开打前离开：比赛取消（不计胜负、没有奖励、不占重赛间隔）。' };
    }
    if (m.out[wid]) return { ...duelStatus(world, wid), left: null, note: 'You are already out of this match; it goes on without you. 你已经出局了，比赛继续。' };
    m.out[wid] = 'gone';
    settle(world, m);
    const on = c.match === m;
    return {
      ...duelStatus(world, wid), left: 'forfeit' as const,
      note: on ? 'You left mid-fight: that is a forfeit — you are out, and your partner fights on alone. 决斗中离开算弃权：你出局了，队友一个人接着打。' : 'You left mid-fight: that is a forfeit — the other side wins. 决斗中离开算弃权：对方获胜。',
    };
  }
  return { ...duelStatus(world, wid), left: wasQueued ? 'queue' as const : null, note: wasQueued ? 'You left the queue. 你退出了排队。' : 'You were not queued or duelling. 你没有在排队，也不在决斗。' };
}

export function duelStatus(world: World, wid: string | null) {
  const c = world.duel;
  const m = c.match;
  const name = (id: string) => world.wizards.get(id)?.name ?? '?';
  const side = (ids: string[]) => ids.map(name).join(' & ');
  const p1 = wid ? c.queue.findIndex((q) => q.id === wid) : -1, p2 = wid ? c.queue2.findIndex((q) => q.id === wid) : -1;
  const pos = p1 >= 0 ? p1 : p2;
  const e = p1 >= 0 ? c.queue[p1] : p2 >= 0 ? c.queue2[p2] : undefined;
  const lapse = e?.ask !== undefined ? Math.max(0, Math.ceil(e.ask + DUEL_CHALLENGE_S - world.now)) : undefined;
  const askedBy = (q: DuelEntry[], k: 'with' | 'partner') => (wid ? q.filter((x) => x[k] === wid).map((x) => name(x.id)) : []);
  const challengedBy = askedBy(c.queue, 'with'), partnerAskedBy = askedBy(c.queue2, 'partner');
  return {
    closed: duelClosed(world),
    stage: DUEL_STAGE,
    queue: c.queue.length, queue2v2: c.queue2.length,
    you: pos >= 0 ? { position: pos + 1, mode: (p1 >= 0 ? '1v1' : '2v2') as '1v1' | '2v2', ...(e?.with ? { challenging: name(e.with), secondsLeft: lapse } : {}), ...(e?.partner ? { partner: name(e.partner), secondsLeft: lapse } : {}) }
      : m && inMatch(c, wid) ? { inMatch: true, side: sideOf(m, wid), out: !!m.out[wid!] } : null,
    ...(challengedBy.length ? { challengedBy } : {}), ...(partnerAskedBy.length ? { partnerAskedBy } : {}),
    match: m ? {
      a: side(m.sides[0]), b: side(m.sides[1]), mode: m.sides[0].length > 1 ? '2v2' : '1v1', phase: m.phase, secondsLeft: Math.max(0, Math.ceil(phaseEnd(m) - world.now)),
      // every duelist's health and shields, so an agent can duel from status alone (playtest round 2)
      hp: [...m.sides[0], ...m.sides[1]].map((id) => { const x = world.wizards.get(id); return x ? { name: x.name, side: sideOf(m, id), hp: Math.round(x.hp), maxHp: world.derivedOf(x).maxHp, shield: Math.round(x.st.shield ?? 0), dealt: Math.round(m.stats[id]?.dealt ?? 0), ...(m.stats[id]?.returned ? { sentBack: Math.round(m.stats[id].returned!) } : {}), ...(m.out[id] ? { out: true } : {}) } : null; }),
      stageRadius: DUEL_LEASH,
    } : null,
    winsThisTerm: wid ? (c.ledger.term === world.term.n ? c.ledger.wins[wid] ?? 0 : 0) : 0,
    rules: { winRep: DUEL_WIN_REP, winXp: DUEL_WIN_XP, sparringWinXp: Math.round(DUEL_WIN_XP / 2), lossXp: DUEL_LOSS_XP, rewardedWinsPerTerm: DUEL_TERM_CAP, samePairEveryMinutes: DUEL_PAIR_GAP_S / 60, fightSeconds: DUEL_FIGHT_S, challengeSeconds: DUEL_CHALLENGE_S },
    /** The last five, newest first: both sides in full (a 2v2's four), and the winning side. */
    last: c.last.slice(-5).reverse().map((r) => {
      const s = r.sides ?? [[r.a], [r.b]];
      const ws = r.winSide !== undefined ? r.winSide : r.winner === null ? null : s[0].includes(r.winner) ? 0 : 1;
      return { a: side(s[0]), b: side(s[1]), winner: ws === null ? null : side(s[ws]), secs: r.secs };
    }),
  };
}

const phaseEnd = (m: DuelMatch) => m.at + (m.phase === 'bow' ? DUEL_BOW_S : m.phase === 'count' ? DUEL_COUNT_S : DUEL_FIGHT_S);

/** The snapshot's view of the match (everyone sees the stage): handles, phase, seconds left in it. */
export function duelWire(world: World) {
  const m = world.duel.match;
  if (!m) return undefined;
  const h = (id: string) => world.wizards.get(id)?.handle;
  const two = m.sides[0].length > 1 || m.sides[1].length > 1;
  return { a: h(m.a), b: h(m.b), ...(two ? { a2: h(m.sides[0][1] ?? ''), b2: h(m.sides[1][1] ?? '') } : {}), ph: m.phase, t: Math.max(0, Math.ceil(phaseEnd(m) - world.now)), ...(Object.keys(m.out).length ? { out: Object.keys(m.out).map(h) } : {}) };
}

function heal(world: World, w: Wizard) {
  const d = world.derivedOf(w);
  w.hp = d.maxHp;
  w.mana = d.maxMana;
}

const names = (world: World, ids: string[]) => ids.map((id) => world.wizards.get(id)?.name ?? '?').join(' & ');
const zhNames = (world: World, ids: string[]) => ids.map((id) => world.wizards.get(id)?.name ?? '?').join('、');

function startMatch(world: World, sides: [Wizard[], Wizard[]], npc: boolean) {
  const c = world.duel;
  const all = [...sides[0], ...sides[1]];
  c.queue = c.queue.filter((q) => !all.some((w) => w.id === q.id));
  c.queue2 = c.queue2.filter((q) => !all.some((w) => w.id === q.id));
  sides.forEach((team, s) => team.forEach((w, i) => {
    const end = DUEL_ENDS[s];
    w.pos = { x: end.x, z: end.z + (team.length > 1 ? (i === 0 ? -2.5 : 2.5) : 0) };
    w.goal = null; w.route = []; w.goalBy = null;
    w.input = { dx: 0, dz: 0 };
    w.st.shield = 0; w.st.shieldUntil = 0; w.st.dodgeUntil = 0;
    heal(world, w);
    w.facing = Math.atan2(DUEL_STAGE.x - w.pos.x, -(DUEL_STAGE.z - w.pos.z));
    world.moved(w);
  }));
  const stats = Object.fromEntries(all.map((w) => [w.id, { dealt: 0, hits: 0, reflects0: w.stats.reflects ?? 0, dodges0: w.stats.dodges ?? 0 }]));
  const ids: [string[], string[]] = [sides[0].map((w) => w.id), sides[1].map((w) => w.id)];
  c.match = { id: ++c.seq, a: ids[0][0], b: ids[1][0], sides: ids, out: {}, phase: 'bow', at: world.now, npc, stats };
  const kind = npc ? { en: 'sparring with NPCs: XP only', zh: '和 NPC 陪练：只给经验' } : { en: 'rated: a win you fight for pays reputation', zh: '计分赛：打出来的胜利给声望' };
  world.emit('duel', `Duelling Club${ids[0].length > 1 ? ' (2v2)' : ''}: ${names(world, ids[0])} against ${names(world, ids[1])} — ${kind.en}. Wands up — bow.`, { zh: `决斗俱乐部${ids[0].length > 1 ? '（2v2）' : ''}：${zhNames(world, ids[0])} 对 ${zhNames(world, ids[1])}（${kind.zh}）！举杖——鞠躬。` });
  // each player hears it privately too (inbox, wait until:"event"): an agent a round trip behind the bow still knows
  // a fight is on, and that its reflexes are what fights in the first seconds (round 5: "no event when matched")
  const go = DUEL_BOW_S + DUEL_COUNT_S;
  for (const w of all) if (!w.npc) world.tell(w, { en: `⚔ Your Duelling Club match is on: bow, then the fight starts in ${go} s (leaving before then only calls it off). Your reflexes fight while you think (reflexes preset "duelist").`, zh: `⚔ 你的决斗开始了：鞠躬，${go} 秒后开打（在那之前离开只算取消）。你思考时由反射替你打（reflexes 预设 "duelist"）。` }, 'duel');
}

/**
 * Someone left (or went offline) before the fight began: the match is off — no result, no reward, nothing in the
 * ledger (so no rematch wait) — and the other players go back to the front of their queue, told why.
 */
function cancelMatch(world: World, m: DuelMatch, by: string, why: 'left' | 'offline') {
  const c = world.duel;
  if (c.match !== m) return;
  c.match = null;
  const two = m.sides[0].length > 1 || m.sides[1].length > 1;
  const who = world.wizards.get(by)?.name ?? '?';
  const whyEn = why === 'left' ? 'left' : 'went offline', whyZh = why === 'left' ? '离开了' : '下线了';
  const back: DuelEntry[] = [];
  for (const id of [...m.sides[0], ...m.sides[1]]) {
    const w = world.wizards.get(id);
    if (!w) continue;
    heal(world, w);
    if (id === by || w.npc) continue;
    back.push({ id, at: world.now });
    tell(world, id, `${who} ${whyEn} before the duel began: the match is off — no result, no reward. You are back at the front of the queue (duel_club leave to stop).`, `${who} 在开打前${whyZh}：比赛取消，不计胜负、没有奖励。你回到了排队的最前面（duel_club leave 可以退出）。`);
  }
  if (two) c.queue2.unshift(...back); else c.queue.unshift(...back);
  world.emit('duel', `Duelling Club: ${who} ${whyEn} before the duel began — the match is off.`, { zh: `决斗俱乐部：${who} 在开打前${whyZh}，比赛取消。` });
}

/** A side with everyone out loses; both at once, a draw. */
function settle(world: World, m: DuelMatch) {
  const down = (s: 0 | 1) => m.sides[s].every((id) => m.out[id]);
  const d0 = down(0), d1 = down(1);
  if (!d0 && !d1) return;
  const lost = d0 ? 0 : 1;
  endMatch(world, d0 && d1 ? null : (1 - lost) as 0 | 1, m.sides[lost].some((id) => m.out[id] === 'ko') ? 'knockout' : 'forfeit');
}

function endMatch(world: World, winSide: 0 | 1 | null, how: 'knockout' | 'forfeit' | 'time') {
  const c = world.duel, m = c.match;
  if (!m) return;
  c.match = null;
  const secs = Math.round(m.phase === 'fight' ? world.now - m.at : 0);
  c.last.push({ a: m.a, b: m.b, winner: winSide === null ? null : m.sides[winSide][0], secs, at: world.now, sides: [[...m.sides[0]], [...m.sides[1]]], winSide });
  if (c.last.length > 20) c.last.shift();
  for (const id of [...m.sides[0], ...m.sides[1]]) { const w = world.wizards.get(id); if (w) heal(world, w); }
  if (winSide === null) {
    world.emit('duel', `Duelling Club: ${names(world, m.sides[0])} and ${names(world, m.sides[1])} — a draw at the bell.`, { zh: `决斗俱乐部：${zhNames(world, m.sides[0])} 和 ${zhNames(world, m.sides[1])} 打成平手。` });
    return;
  }
  const winners = m.sides[winSide].map((id) => world.wizards.get(id)).filter((w): w is Wizard => !!w);
  const losers = m.sides[1 - winSide].map((id) => world.wizards.get(id)).filter((w): w is Wizard => !!w);
  if (!winners.length || !losers.length) return;
  const howEn = how === 'knockout' ? 'knocked out' : how === 'forfeit' ? 'by forfeit' : 'on points at the bell';
  const howZh = how === 'knockout' ? '击倒' : how === 'forfeit' ? '对方弃权' : '时间到按伤害判';
  const lines: { en: string; zh: string }[] = [];
  winners.forEach((W, i) => {
    const Lz = losers[i % losers.length];
    // a win nobody fought for pays nothing and leaves the ledger alone (a friend joining and walking off is no farm)
    const earned = m.phase === 'fight' && (m.stats[W.id]?.dealt ?? 0) > 0;
    const g = earned ? duelGrant(c.ledger, W.id, Lz.id, world.now, world.term.n, m.npc, !stunPaysRep(W.year, Lz.year)) : { rep: 0, xpWinner: 0, xpLoser: 0, why: 'unearned' as const };
    if (g.rep) world.addRep(W, g.rep, 'duels');
    if (g.xpWinner) world.gainXp(W, g.xpWinner);
    if (g.xpLoser) world.gainXp(Lz, g.xpLoser);
    // 决斗者: a rated bout won by knock-out is a real opponent stunned, whatever the houses (never an NPC sparring partner)
    if (earned && !m.npc && how === 'knockout' && stunPaysRep(W.year, Lz.year)) world.achieve(W, 'first_blood');
    const st = m.stats[W.id], r = (W.stats.reflects ?? 0) - st.reflects0, dd = (W.stats.dodges ?? 0) - st.dodges0, back = Math.round(st.returned ?? 0);
    const pay = g.rep ? { en: ` (+${g.rep} reputation)`, zh: `（声望 +${g.rep}）` } : g.why === 'unearned' ? { en: ' (no blow landed: no reward)', zh: '（一招未中，不计奖励）' } : { en: g.why === 'rematch' ? ' (a rematch: no reward)' : g.why === 'bully' ? ` (${W.year - Lz.year} years below: no reputation)` : g.why === 'cap' ? ' (this term\'s rewarded wins are used up)' : ' (sparring: XP only)', zh: g.why === 'rematch' ? '（重赛，不计奖励）' : g.why === 'bully' ? `（对方低 ${W.year - Lz.year} 个年级，不计声望）` : g.why === 'cap' ? '（本学期的计奖胜场已用完）' : '（陪练，只给经验）' };
    lines.push({ en: `${W.name}: ${Math.round(st.dealt)} damage${back ? ` (${back} sent back)` : ''}, ${st.hits} hits${r ? `, ${r} perfect Protego` : ''}${dd ? `, ${dd} rolls` : ''}${pay.en}`, zh: `${W.name}：伤害 ${Math.round(st.dealt)}${back ? `（其中弹回 ${back}）` : ''}、命中 ${st.hits} 次${r ? `、完美格挡 ${r} 次` : ''}${dd ? `、翻滚 ${dd} 次` : ''}${pay.zh}` });
  });
  world.emit('duel', `Duelling Club: ${names(world, m.sides[winSide])} beat ${names(world, m.sides[1 - winSide])} ${howEn} in ${secs}s — ${lines.map((l) => l.en).join('; ')}.`, { who: [...winners, ...losers].map((w) => w.id), zh: `决斗俱乐部：${zhNames(world, m.sides[winSide])} ${howZh}战胜 ${zhNames(world, m.sides[1 - winSide])}，用时 ${secs} 秒——${lines.map((l) => l.zh).join('；')}。` });
}

/**
 * 以大欺小, on the stage: an NPC sparring partner older than the player it faces fights at that player's level — its
 * blows scaled by the two years' bolt caps, the player's blows on it by the two health pools (DUEL_FEATURE.hit). The
 * club used to send only NPCs at most BULLY_YEAR_GAP years above, and NPCs outgrow first-years within minutes, so
 * in round 5 nobody was ever sent (two players queued four minutes each). The factor for one blow, else 1.
 */
function sparScale(world: World, by: string, dstId: string): number {
  const m = world.duel.match;
  if (!m || m.phase !== 'fight' || !m.npc) return 1;
  const a = world.wizards.get(by), b = world.wizards.get(dstId);
  if (!a || !b || sideOf(m, a.id) < 0 || sideOf(m, b.id) < 0 || sideOf(m, a.id) === sideOf(m, b.id) || a.npc === b.npc) return 1;
  const [npc, pl] = a.npc ? [a, b] : [b, a];
  if (npc.year <= pl.year) return 1;
  return a.npc ? capsFor(pl.year).boltPower / capsFor(npc.year).boltPower : world.derivedOf(npc).maxHp / world.derivedOf(pl).maxHp;
}

/**
 * NPCs free to fill `n` places against players whose youngest is in year `year`: in play, not in this match, not on
 * a Quidditch team, not queued, not possessed — the nearest year first (an older one fights at the player's level: sparScale).
 */
function freeNpcs(world: World, taken: Set<string>, year: number, n: number) {
  const ok = [...world.wizards.values()].filter((w) => w.npc && !w.heldBy && world.isActive(w) && !qdOnTeam(world, w.id) && !taken.has(w.id) && !queued(world.duel, w.id));
  return ok.map((w, i) => ({ w, i })).sort((p, q) => Math.abs(p.w.year - year) - Math.abs(q.w.year - year) || p.i - q.i).slice(0, n).map((x) => x.w);
}

const youngest = (ws: Wizard[]) => Math.min(...ws.filter((w) => !w.npc).map((w) => w.year), 99);

/**
 * Keep the queues honest: whoever left the castle, went to Azkaban or took to the Quidditch pitch is taken off and
 * told why; a stunned wizard keeps their place (they are skipped until they are back on their feet).
 */
function sweepQueues(world: World) {
  const c = world.duel;
  const keep = (q: DuelEntry) => {
    const w = world.wizards.get(q.id);
    if (!w) return false;
    const why = !world.online(w) ? ['you left the castle (offline)', '你离开了城堡（下线）'] : w.st.jailedUntil > 0 ? ['you were sent to Azkaban', '你被关进了阿兹卡班'] : qdPlaying(world, q.id) ? ['you are playing Quidditch', '你在打魁地奇'] : null;
    if (!why) return true;
    tell(world, q.id, `You were taken off the Duelling Club queue: ${why[0]}. Join again when you are free.`, `你被移出了决斗俱乐部的队伍：${why[1]}。有空再报名。`);
    return false;
  };
  if (c.queue.length) c.queue = c.queue.filter(keep);
  if (c.queue2.length) c.queue2 = c.queue2.filter(keep);
}

/** A challenge or partner request nobody answered within DUEL_CHALLENGE_S: the asker leaves the queue, told. */
function lapse(world: World) {
  const c = world.duel;
  const out = (q: DuelEntry) => {
    const t = q.with ?? q.partner;
    if (!t || world.now - (q.ask ?? q.at) < DUEL_CHALLENGE_S) return true;
    const n = world.wizards.get(t)?.name ?? '?';
    if (q.with) tell(world, q.id, `${n} did not take up your challenge within ${DUEL_CHALLENGE_S}s: you have left the queue. Challenge again, or join without "with" to take anyone.`, `${n} 在 ${DUEL_CHALLENGE_S} 秒内没有应战：你已离开队伍。可以再次挑战，或不带 "with" 报名，和谁打都行。`);
    else tell(world, q.id, `${n} did not join as your partner within ${DUEL_CHALLENGE_S}s: you have left the 2v2 queue. Ask again, or join without "partner".`, `${n} 在 ${DUEL_CHALLENGE_S} 秒内没有来搭档：你已离开 2v2 队伍。可以再邀请，或不带 "partner" 报名。`);
    return false;
  };
  if (c.queue.some((q) => q.ask !== undefined)) c.queue = c.queue.filter(out);
  if (c.queue2.some((q) => q.ask !== undefined)) c.queue2 = c.queue2.filter(out);
}

/** Called every tick by World.tick. */
export function stepDuelClub(world: World) {
  const c = world.duel;
  const m = c.match;
  if (m) {
    const gone = (w: Wizard | undefined) => !w || !world.online(w) || w.st.jailedUntil > 0;
    for (const id of [...m.sides[0], ...m.sides[1]]) {
      if (m.out[id]) continue;
      const w = world.wizards.get(id);
      if (gone(w)) {
        if (m.phase !== 'fight') return cancelMatch(world, m, id, 'offline'); // before the fight: nobody wins a bow
        m.out[id] = 'gone';
      } else if (m.phase === 'fight' && Math.hypot(w!.pos.x - DUEL_STAGE.x, w!.pos.z - DUEL_STAGE.z) > DUEL_LEASH) {
        m.out[id] = 'gone'; // walked off the stage
        tell(world, id, 'You walked off the duelling stage: you are out of the match.', '你走下了决斗台：出局。');
      } else if (m.phase === 'fight' && world.inSafe(w!.pos)) {
        // no sheltering: a safe zone overlapping the stage (the Great Hall's doors) would make a duelist untouchable
        m.out[id] = 'gone';
        tell(world, id, 'You stepped into a safe zone: that counts as leaving the stage — you are out of the match.', '你走进了安全区：算走下决斗台——出局。');
      }
    }
    settle(world, m);
    if (c.match !== m) return;
    if (world.now >= phaseEnd(m)) {
      if (m.phase === 'bow') { m.phase = 'count'; m.at = world.now; world.emit('duel', 'Three… two… one…', { zh: '三……二……一……' }); }
      else if (m.phase === 'count') { m.phase = 'fight'; m.at = world.now; world.emit('duel', 'Duel!', { zh: '开始！' }); }
      else {
        // the bell: more damage dealt wins (regen would wash out an HP comparison), then the healthier side
        const dealt = (s: 0 | 1) => m.sides[s].reduce((t, id) => t + (m.stats[id]?.dealt ?? 0), 0);
        const health = (s: 0 | 1) => m.sides[s].reduce((t, id) => { const x = world.wizards.get(id); return t + (x && !m.out[id] ? x.hp / world.derivedOf(x).maxHp : 0); }, 0);
        const da = dealt(0), db = dealt(1), fa = health(0), fb = health(1);
        endMatch(world, Math.abs(da - db) > 1e-9 ? (da > db ? 0 : 1) : Math.abs(fa - fb) < 1e-9 ? null : fa > fb ? 0 : 1, 'time');
      }
    }
    return;
  }
  if (duelClosed(world)) return;
  sweepQueues(world);
  lapse(world);
  // who can be matched right now (a stunned wizard waits in place)
  const ready = (q: DuelEntry) => { const w = world.wizards.get(q.id); return !!w && world.isActive(w); };
  const W = (q: DuelEntry) => world.wizards.get(q.id)!;
  const due = (at: number) => world.now - at >= DUEL_NPC_AFTER_S;
  const q1 = c.queue.filter(ready);
  // a challenge first: the challenger and the wizard they named, who joined plainly or named them back
  for (const e of q1) {
    if (!e.with) continue;
    const t = q1.find((x) => x.id === e.with && (!x.with || x.with === e.id));
    if (t) return startMatch(world, [[W(e)], [W(t)]], false);
  }
  const open = q1.filter((q) => !q.with);
  if (open.length >= 2) {
    // the longest-waiting gets the nearest year in the queue (a first-year met a fourth-year in playtest round 2);
    // within DUEL_YEAR_GAP, or anyone at all once they have waited DUEL_ANY_AFTER_S
    const a = W(open[0]);
    const rest = open.slice(1).map(W).sort((x, y) => Math.abs(x.year - a.year) - Math.abs(y.year - a.year));
    const b = rest[0];
    if (Math.abs(b.year - a.year) <= DUEL_YEAR_GAP || world.now - open[0].at >= DUEL_ANY_AFTER_S) return startMatch(world, [[a], [b]], !!(a.npc || b.npc));
  }
  if (open.length === 1 && due(open[0].at)) {
    const a = W(open[0]);
    // an NPC who is free: not flying in this term's Quidditch match (playtest round 2: one NPC in both stood still, then flew off the stage)
    const npc = freeNpcs(world, new Set([a.id]), a.year, 1)[0];
    if (npc) return startMatch(world, [[a], [npc]], true);
  }
  // 2v2: chosen partners are one side; four make a match, the years balanced (1st + 4th against 2nd + 3rd); after a
  // wait NPCs fill the places (never for a partner request still waiting for its partner)
  const q2 = c.queue2.filter(ready);
  const used = new Set<string>(), teams: { ws: [Wizard, Wizard]; at: number }[] = [];
  for (const e of q2) {
    if (!e.partner || used.has(e.id)) continue;
    const p = q2.find((x) => x.id === e.partner && !used.has(x.id) && (!x.partner || x.partner === e.id));
    if (p) { teams.push({ ws: [W(e), W(p)], at: Math.max(e.at, p.at) }); used.add(e.id).add(p.id); }
  }
  const singles = q2.filter((x) => !x.partner && !used.has(x.id));
  if (teams.length >= 2) return startMatch(world, [teams[0].ws, teams[1].ws], false);
  if (teams.length === 1) {
    const team = teams[0].ws;
    if (singles.length >= 2) return startMatch(world, [team, [W(singles[0]), W(singles[1])]], false);
    if (due(Math.min(teams[0].at, ...singles.map((s) => s.at)))) {
      const foes = singles.map(W);
      const all = [...team, ...foes];
      foes.push(...freeNpcs(world, new Set(all.map((w) => w.id)), youngest(all), 2 - foes.length));
      if (foes.length === 2) return startMatch(world, [team, [foes[0], foes[1]]], foes.some((w) => w.npc));
    }
    return;
  }
  const four = singles.slice(0, 4).map(W);
  if (four.length && four.length < 4 && due(singles[0].at)) four.push(...freeNpcs(world, new Set(four.map((w) => w.id)), youngest(four), 4 - four.length));
  if (four.length === 4) {
    const y = [...four].sort((p, q) => q.year - p.year);
    return startMatch(world, [[y[0], y[3]], [y[1], y[2]]], four.some((w) => w.npc));
  }
}

// ------------------------------------------------------------------ the NPC sparring partner
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * A club NPC in the fight (twice a second): the nearest foe (at the foe's level: sparScale); close in when it is out of
 * reach or out of sight — never off the stage, never into a safe zone — then one action: a Protego now and then when
 * hurt, else an attack it knows (Expelliarmus from the second year, Incendio, mostly Stupefy). It never heals, so the
 * player can win.
 */
function spar(world: World, w: Wizard, m: DuelMatch) {
  const foes = m.sides[1 - sideOf(m, w.id)].filter((id) => !m.out[id]).map((id) => world.wizards.get(id)).filter((x): x is Wizard => !!x);
  const opp = foes.sort((p, q) => dist(p.pos, w.pos) - dist(q.pos, w.pos))[0];
  if (!opp) { if (w.goal) world.setGoal(w.id, null); return; }
  const d = dist(opp.pos, w.pos), clear = world.inBlast(w.pos, opp.pos);
  if (d > DUEL_NPC_REACH || !clear) {
    // a spot nearer the foe, pulled toward the middle of the stage
    const k = Math.max(0, d - DUEL_NPC_REACH * 0.6) / (d || 1);
    let to = { x: w.pos.x + (opp.pos.x - w.pos.x) * k, z: w.pos.z + (opp.pos.z - w.pos.z) * k };
    if (!clear) to = { x: (opp.pos.x + DUEL_STAGE.x) / 2, z: (opp.pos.z + DUEL_STAGE.z) / 2 };
    const off = dist(to, DUEL_STAGE), r = DUEL_LEASH - 4;
    if (off > r) to = { x: DUEL_STAGE.x + ((to.x - DUEL_STAGE.x) / off) * r, z: DUEL_STAGE.z + ((to.z - DUEL_STAGE.z) / off) * r };
    if (world.inSafe(to)) to = { ...DUEL_STAGE };
    if (!w.goal || dist(w.goal, to) > 3) { try { world.setGoal(w.id, to); } catch { /* no way there: shoot from here */ } }
  } else if (w.goal) world.setGoal(w.id, null);
  if (!clear) return;
  if (w.hp < world.derivedOf(w).maxHp * 0.5 && w.st.shieldUntil < world.now && w.mana > 30 && world.rand() < 0.3) { world.cast(w.id, 'Protego'); return; }
  const roll = world.rand();
  const spell = w.year >= 2 && roll < 0.15 ? 'Expelliarmus' : roll < 0.4 ? 'Incendio' : 'Stupefy';
  const r = world.cast(w.id, spell, { target: opp.id });
  if (!r.ok && spell !== 'Stupefy') world.cast(w.id, 'Stupefy', { target: opp.id });
}

// ------------------------------------------------------------------ the plug (kernel/feature.ts)
const bowing = (world: World, id: string) => inMatch(world.duel, id) && world.duel.match!.phase !== 'fight';
const ledgerOf = (x: unknown): DuelLedger | null => {
  const l = x as { term?: unknown; wins?: unknown; pairs?: unknown } | undefined;
  return l && typeof l.term === 'number' ? { term: l.term, wins: { ...(l.wins as Record<string, number> ?? {}) }, pairs: { ...(l.pairs as Record<string, number> ?? {}) } } : null;
};
const DUEL_OPS = ['join', 'leave', 'status'] as const;
const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x : undefined);
const runOp = (world: World, wid: string, a: Record<string, unknown>) => (a.op === 'join' ? duelJoin(world, wid, a.mode === '2v2' ? '2v2' : '1v1', { with: str(a.with), partner: str(a.partner) }) : a.op === 'leave' ? duelLeave(world, wid) : duelStatus(world, wid));

/**
 * 完美格挡 in a duel: a bolt sent back counts for whoever sent it back, at the strength it goes back with, the moment
 * it is sent (whether or not the opponent then rolls clear or shields it); its landing adds nothing more (World.damage).
 */
function creditReflect(world: World, w: Wizard, p: Projectile, from: string) {
  const m = world.duel.match;
  if (!m || p.kind !== 'bolt') return;
  const foe = world.credit(from) ?? from;
  const st = m.stats[w.id];
  if (!st || !duelFoes(world.duel, w.id, foe)) return;
  const rb = world.rules, o = world.wizards.get(foe);
  const v = Math.min(p.power * rb.combat.damageMultiplier * (rb.combat.elementMultipliers[p.element] ?? 1) * world.derivedOf(w).power, o ? Math.max(0, o.hp) : Infinity);
  if (!(v > 0)) return;
  st.dealt += v;
  st.returned = (st.returned ?? 0) + v;
}

/**
 * A duellist's roll stays on the stage (the 2026-09-30 society playtest: the duel reflex rolled Mia and Jake off it
 * and into the Great Hall's safe zone — out of the match, twice). The roll's end must be inside the leash with a
 * metre to spare and outside every safe zone; if it would not be, the opposite way, then either side, is tried;
 * if none is, it is left alone (a roll nowhere is no better).
 */
function stageRoll(world: World, w: Wizard, dx: number, dz: number): [number, number] | null {
  const m = world.duel.match;
  if (!m || m.phase !== 'fight' || m.out[w.id] || ![...m.sides[0], ...m.sides[1]].includes(w.id)) return null;
  const ok = (x: number, z: number) => {
    const ex = w.pos.x + x * DODGE_DIST, ez = w.pos.z + z * DODGE_DIST;
    return Math.hypot(ex - DUEL_STAGE.x, ez - DUEL_STAGE.z) <= DUEL_LEASH - 1 && !world.inSafe({ x: ex, z: ez });
  };
  if (ok(dx, dz)) return null;
  for (const [x, z] of [[-dx, -dz], [-dz, dx], [dz, -dx]] as const) if (ok(x, z)) return [x, z];
  return null;
}

export const DUEL_FEATURE: Feature = {
  id: 'duel',
  init(world) { world.duel = newDuelClub(); },
  dodgeDir: stageRoll,
  step: stepDuelClub,
  wire: { key: 'du', get: duelWire },
  // only the term's reward ledger: caps and rematch gaps survive a restart; the queue and the match do not
  save: (world) => world.duel.ledger,
  load(world, data, legacy) { const l = ledgerOf(data ?? legacy.duelLedger); if (l) world.duel.ledger = l; },
  moveMult: (world, w) => (bowing(world, w.id) ? 0 : 1),
  castBlock: (world, w) => (bowing(world, w.id) ? 'Wait for the countdown to finish. 等倒计时结束再施法。' : null),
  helpBlock: (world, src, dst) => src.id !== dst.id && inMatch(world.duel, dst.id) && !duelPartners(world.duel, src.id, dst.id), // no help from the crowd (a 2v2 partner may)
  reflect: creditReflect,
  hit: (world, by, _src, dstId, _tags, dmg) => (dmg && by ? sparScale(world, by, dstId) : 1),
  npc(world, w) {
    // a sparring partner: still until the countdown ends (and once out), then it fights (spar)
    const m = world.duel.match;
    if (!m || sideOf(m, w.id) < 0) return false;
    if (m.phase === 'fight' && !m.out[w.id]) spar(world, w, m);
    return true;
  },
  tools: [{
    name: 'duel_club', title: 'Duelling Club', cost: 0,
    description: `决斗俱乐部 on the Courtyard stage (${DUEL_STAGE.x}, ${DUEL_STAGE.z}): op "join" queues you (two in the queue make a match, the nearest year first; alone for ${DUEL_NPC_AFTER_S}s and an NPC spars with you; with: "<name or handle>" challenges one wizard — you wait up to ${DUEL_CHALLENGE_S}s for them alone, no NPC, and they accept by joining plainly or with your name; mode "2v2": a team match of four, years balanced, your partner an ally you may heal — partner: "<name>" picks your partner, who joins the 2v2 queue plainly or naming you). "leave" leaves the queue; during the bow or the countdown it calls the match off (no result, no reward); during the fight it is a forfeit. "status" shows the queue, who challenged you, the match (both sides' health) and your rewarded wins this term. A match: placed at the two ends and healed, a bow and a countdown (no moving or casting), then up to ${DUEL_FIGHT_S}s. Only you two can harm each other (whatever your houses); nobody can interfere. Knocked to zero, walked off the stage (${DUEL_LEASH} m), stepped into a safe zone or gone: you are out. At the bell the most damage wins (a bolt you send back with a perfect Protego counts for you). A win you fought for: +${DUEL_WIN_REP} reputation and XP, at most ${DUEL_TERM_CAP} rewarded wins a term, the same pair once every ${DUEL_PAIR_GAP_S / 60} minutes; NPC sparring pays XP only. dodge, wait until:"incoming" and a well-timed Protego matter here.`,
    input: {
      op: z.enum(DUEL_OPS).optional(),
      mode: z.enum(['1v1', '2v2']).optional().describe('join: "2v2" queues you for a team match (four make one; NPCs fill after a wait)'),
      with: z.string().max(60).optional().describe(`join (1v1): challenge this wizard (name or handle); waits up to ${DUEL_CHALLENGE_S}s for them, no NPC fills in`),
      partner: z.string().max(60).optional().describe(`join (2v2): your chosen partner (name or handle); waits up to ${DUEL_CHALLENGE_S}s for them to join the 2v2 queue`),
    },
    run: (world, wid, a) => runOp(world, wid, a),
  }],
  ws: (world, wid, m) => runOp(world, wid, m),
};
