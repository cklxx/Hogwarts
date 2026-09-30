/**
 * 决斗俱乐部 (roadmap step 3): a queue, a stage in the Courtyard, one match at a time, bounded rewards.
 *
 * - `duel_club join` (MCP) / G (browser) queues you; two in the queue make a match; alone for DUEL_NPC_AFTER_S
 *   and an NPC steps up to spar. `join` with mode "2v2" queues you for a team match instead: four make one (the
 *   years balanced: 1st+4th against 2nd+3rd), and after DUEL_NPC_AFTER_S NPCs fill the empty places.
 * - In a 2v2 your partner is your ally (no harm, healing allowed); a knocked-out or departed duelist is out (still on
 *   the stage, untouchable and harmless); a side with everyone out loses.
 * - A match: both are placed at the two ends of the stage, healed, and bow (DUEL_BOW_S); a countdown
 *   (DUEL_COUNT_S) in which nobody moves or casts; then they fight for up to DUEL_FIGHT_S. Knocked to zero, walked
 *   off the stage (DUEL_LEASH m) or gone offline: the other one wins. At the bell, whoever dealt more damage wins
 *   (regen would wash out an HP comparison), then the healthier one.
 * - While they fight, World.canHarm lets the two (and their summons) harm each other whatever their houses, and
 *   nobody else touch them or be touched by them (formal/tla/Hostility.tla DuelMutual / DuelIsolated); nobody
 *   else may heal or shield them. A knock-out ends the match (no stun, no Hospital Wing, no reputation stolen).
 * - Rewards (duelGrant), only for a win fought for (the fight had begun and the winner landed a blow): the winner +DUEL_WIN_REP reputation (and house points) and XP, the loser some XP; only
 *   against a player (an NPC sparring match pays XP only), only once per pair per DUEL_PAIR_GAP_S, and at most
 *   DUEL_TERM_CAP rewarded wins per wizard per term — Lean `duel_club_term_bounded`.
 * - The club is closed while the Minister's rules forbid PvP, or while the stage lies in a safe zone.
 */
import { z } from 'zod';
import type { Feature } from './feature.js';
import { qdOnTeam, qdPlaying } from './quidditch.js';
import { stunPaysRep } from './progression.js';
import type { World } from './world.js';
import type { Wizard } from './types.js';

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
export const DUEL_WIN_REP = 6, DUEL_WIN_XP = 40, DUEL_LOSS_XP = 15, DUEL_TERM_CAP = 5, DUEL_PAIR_GAP_S = 600, DUEL_QUEUE_MAX = 32;

export type DuelPhase = 'bow' | 'count' | 'fight';
export interface DuelMatch {
  /** `a` and `b`: the two sides' first duelists (a 1v1's two); `sides`: everyone on each side. */
  id: number; a: string; b: string; phase: DuelPhase; at: number; npc: boolean;
  sides: [string[], string[]];
  /** Duelists out of the fight (knocked out, gone, off the stage) and why. */
  out: Record<string, 'ko' | 'gone'>;
  stats: Record<string, { dealt: number; hits: number; reflects0: number; dodges0: number }>;
}
export interface DuelLedger { term: number; wins: Record<string, number>; pairs: Record<string, number> }
export interface DuelResult { a: string; b: string; winner: string | null; secs: number; at: number }
export interface DuelClub { queue: { id: string; at: number }[]; queue2: { id: string; at: number }[]; match: DuelMatch | null; seq: number; ledger: DuelLedger; last: DuelResult[] }

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
  if (world.inSafe(DUEL_STAGE)) return 'The Courtyard is a safe zone by decree: the Duelling Club is closed. 法令把庭院设成了安全区：决斗俱乐部暂停。';
  return null;
}

export function duelJoin(world: World, wid: string, mode: '1v1' | '2v2' = '1v1') {
  const c = world.duel, w = world.need(wid);
  const closed = duelClosed(world);
  if (closed) throw new Error(closed);
  if (!world.isActive(w)) throw new Error('Not while you are stunned or in Azkaban. 被击晕或在阿兹卡班时不能报名。');
  if (inMatch(c, wid)) throw new Error('You are duelling right now. 你正在决斗。');
  if (qdPlaying(world, wid)) throw new Error('You are playing Quidditch: leave the pitch first (quidditch leave). 你正在打魁地奇：先下场（quidditch leave）。');
  const [q, other] = mode === '2v2' ? [c.queue2, c.queue] : [c.queue, c.queue2];
  if (other.some((x) => x.id === wid)) { if (mode === '2v2') c.queue = c.queue.filter((x) => x.id !== wid); else c.queue2 = c.queue2.filter((x) => x.id !== wid); }
  if (!q.some((x) => x.id === wid)) {
    if (q.length >= DUEL_QUEUE_MAX) throw new Error('The queue is full; try again soon. 排队的人满了，等一会儿。');
    (mode === '2v2' ? c.queue2 : c.queue).push({ id: wid, at: world.now });
    world.emit('duel', `${w.name} signed up for the Duelling Club${mode === '2v2' ? ' (2v2)' : ''}.`, { zh: `${w.name} 报名了决斗俱乐部${mode === '2v2' ? '（2v2）' : ''}。` });
  }
  return duelStatus(world, wid);
}

export function duelLeave(world: World, wid: string) {
  const c = world.duel;
  c.queue = c.queue.filter((q) => q.id !== wid);
  c.queue2 = c.queue2.filter((q) => q.id !== wid);
  const m = c.match;
  if (m && sideOf(m, wid) >= 0) { m.out[wid] ??= 'gone'; settle(world, m); }
  return duelStatus(world, wid);
}

export function duelStatus(world: World, wid: string | null) {
  const c = world.duel;
  const m = c.match;
  const name = (id: string) => world.wizards.get(id)?.name ?? '?';
  const p1 = wid ? c.queue.findIndex((q) => q.id === wid) : -1, p2 = wid ? c.queue2.findIndex((q) => q.id === wid) : -1;
  const pos = p1 >= 0 ? p1 : p2;
  return {
    closed: duelClosed(world),
    stage: DUEL_STAGE,
    queue: c.queue.length, queue2v2: c.queue2.length,
    you: pos >= 0 ? { position: pos + 1, mode: (p1 >= 0 ? '1v1' : '2v2') as '1v1' | '2v2' } : m && inMatch(c, wid) ? { inMatch: true, side: sideOf(m, wid), out: !!m.out[wid!] } : null,
    match: m ? {
      a: m.sides[0].map(name).join(' & '), b: m.sides[1].map(name).join(' & '), mode: m.sides[0].length > 1 ? '2v2' : '1v1', phase: m.phase, secondsLeft: Math.max(0, Math.ceil(phaseEnd(m) - world.now)),
      // every duelist's health and shields, so an agent can duel from status alone (playtest round 2)
      hp: [...m.sides[0], ...m.sides[1]].map((id) => { const x = world.wizards.get(id); return x ? { name: x.name, side: sideOf(m, id), hp: Math.round(x.hp), maxHp: world.derivedOf(x).maxHp, shield: Math.round(x.st.shield ?? 0), dealt: Math.round(m.stats[id]?.dealt ?? 0), ...(m.out[id] ? { out: true } : {}) } : null; }),
      stageRadius: DUEL_LEASH,
    } : null,
    winsThisTerm: wid ? (c.ledger.term === world.term.n ? c.ledger.wins[wid] ?? 0 : 0) : 0,
    rules: { winRep: DUEL_WIN_REP, winXp: DUEL_WIN_XP, sparringWinXp: Math.round(DUEL_WIN_XP / 2), lossXp: DUEL_LOSS_XP, rewardedWinsPerTerm: DUEL_TERM_CAP, samePairEveryMinutes: DUEL_PAIR_GAP_S / 60, fightSeconds: DUEL_FIGHT_S },
    /** The last five, newest first. */
    last: c.last.slice(-5).reverse().map((r) => ({ a: name(r.a), b: name(r.b), winner: r.winner ? name(r.winner) : null, secs: r.secs })),
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
  c.last.push({ a: m.a, b: m.b, winner: winSide === null ? null : m.sides[winSide][0], secs, at: world.now });
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
    const st = m.stats[W.id], r = (W.stats.reflects ?? 0) - st.reflects0, dd = (W.stats.dodges ?? 0) - st.dodges0;
    const pay = g.rep ? { en: ` (+${g.rep} reputation)`, zh: `（声望 +${g.rep}）` } : g.why === 'unearned' ? { en: ' (no blow landed: no reward)', zh: '（一招未中，不计奖励）' } : { en: g.why === 'rematch' ? ' (a rematch: no reward)' : g.why === 'bully' ? ` (${W.year - Lz.year} years below: no reputation)` : g.why === 'cap' ? ' (this term\'s rewarded wins are used up)' : ' (sparring: XP only)', zh: g.why === 'rematch' ? '（重赛，不计奖励）' : g.why === 'bully' ? `（对方低 ${W.year - Lz.year} 个年级，不计声望）` : g.why === 'cap' ? '（本学期的计奖胜场已用完）' : '（陪练，只给经验）' };
    lines.push({ en: `${W.name}: ${Math.round(st.dealt)} damage, ${st.hits} hits${r ? `, ${r} perfect Protego` : ''}${dd ? `, ${dd} rolls` : ''}${pay.en}`, zh: `${W.name}：伤害 ${Math.round(st.dealt)}、命中 ${st.hits} 次${r ? `、完美格挡 ${r} 次` : ''}${dd ? `、翻滚 ${dd} 次` : ''}${pay.zh}` });
  });
  world.emit('duel', `Duelling Club: ${names(world, m.sides[winSide])} beat ${names(world, m.sides[1 - winSide])} ${howEn} in ${secs}s — ${lines.map((l) => l.en).join('; ')}.`, { who: [...winners, ...losers].map((w) => w.id), zh: `决斗俱乐部：${zhNames(world, m.sides[winSide])} ${howZh}战胜 ${zhNames(world, m.sides[1 - winSide])}，用时 ${secs} 秒——${lines.map((l) => l.zh).join('；')}。` });
}

/** An NPC free to fill a place: in play, not in this match, not on a Quidditch team, not queued. */
const freeNpcs = (world: World, taken: Set<string>) => [...world.wizards.values()].filter((w) => w.npc && !w.heldBy && world.isActive(w) && !qdOnTeam(world, w.id) && !taken.has(w.id) && !queued(world.duel, w.id));

/** Called every tick by World.tick. */
export function stepDuelClub(world: World) {
  const c = world.duel;
  const m = c.match;
  if (m) {
    const gone = (w: Wizard | undefined) => !w || !world.online(w) || w.st.jailedUntil > 0;
    for (const id of [...m.sides[0], ...m.sides[1]]) {
      if (m.out[id]) continue;
      const w = world.wizards.get(id);
      if (gone(w)) m.out[id] = 'gone';
      else if (m.phase === 'fight' && Math.hypot(w!.pos.x - DUEL_STAGE.x, w!.pos.z - DUEL_STAGE.z) > DUEL_LEASH) m.out[id] = 'gone'; // walked off the stage
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
  // drop whoever is no longer in play, then pair the queues, or give lone wizards NPCs to spar with
  const inPlay = (q: { id: string }) => { const w = world.wizards.get(q.id); return !!w && world.online(w) && world.isActive(w) && !qdPlaying(world, q.id); };
  c.queue = c.queue.filter(inPlay);
  c.queue2 = c.queue2.filter(inPlay);
  if (c.queue.length >= 2) {
    // the longest-waiting gets the nearest year in the queue (a first-year met a fourth-year in playtest round 2);
    // within DUEL_YEAR_GAP, or anyone at all once they have waited DUEL_ANY_AFTER_S
    const a = world.wizards.get(c.queue[0].id)!;
    const rest = c.queue.slice(1).map((q) => world.wizards.get(q.id)!).sort((x, y) => Math.abs(x.year - a.year) - Math.abs(y.year - a.year));
    const b = rest[0];
    if (Math.abs(b.year - a.year) <= DUEL_YEAR_GAP || world.now - c.queue[0].at >= DUEL_ANY_AFTER_S) return startMatch(world, [[a], [b]], !!(a.npc || b.npc));
  }
  if (c.queue.length === 1 && world.now - c.queue[0].at >= DUEL_NPC_AFTER_S) {
    const a = world.wizards.get(c.queue[0].id)!;
    // an NPC who is free: not flying in this term's Quidditch match (playtest round 2: one NPC in both stood still, then flew off the stage)
    const npc = freeNpcs(world, new Set([a.id]))[0];
    if (npc) return startMatch(world, [[a], [npc]], true);
  }
  // 2v2: four make a match, the years balanced (1st + 4th against 2nd + 3rd); after a wait NPCs fill the places
  const four = c.queue2.slice(0, 4).map((q) => world.wizards.get(q.id)!);
  if (four.length && four.length < 4 && world.now - c.queue2[0].at >= DUEL_NPC_AFTER_S) four.push(...freeNpcs(world, new Set(four.map((w) => w.id))).slice(0, 4 - four.length));
  if (four.length === 4) {
    const y = [...four].sort((p, q) => q.year - p.year);
    return startMatch(world, [[y[0], y[3]], [y[1], y[2]]], four.some((w) => w.npc));
  }
}

// ------------------------------------------------------------------ the plug (kernel/feature.ts)
const bowing = (world: World, id: string) => inMatch(world.duel, id) && world.duel.match!.phase !== 'fight';
const ledgerOf = (x: unknown): DuelLedger | null => {
  const l = x as { term?: unknown; wins?: unknown; pairs?: unknown } | undefined;
  return l && typeof l.term === 'number' ? { term: l.term, wins: { ...(l.wins as Record<string, number> ?? {}) }, pairs: { ...(l.pairs as Record<string, number> ?? {}) } } : null;
};
const DUEL_OPS = ['join', 'leave', 'status'] as const;
const runOp = (world: World, wid: string, op: unknown, mode?: unknown) => (op === 'join' ? duelJoin(world, wid, mode === '2v2' ? '2v2' : '1v1') : op === 'leave' ? duelLeave(world, wid) : duelStatus(world, wid));

export const DUEL_FEATURE: Feature = {
  id: 'duel',
  init(world) { world.duel = newDuelClub(); },
  step: stepDuelClub,
  wire: { key: 'du', get: duelWire },
  // only the term's reward ledger: caps and rematch gaps survive a restart; the queue and the match do not
  save: (world) => world.duel.ledger,
  load(world, data, legacy) { const l = ledgerOf(data ?? legacy.duelLedger); if (l) world.duel.ledger = l; },
  moveMult: (world, w) => (bowing(world, w.id) ? 0 : 1),
  castBlock: (world, w) => (bowing(world, w.id) ? 'Wait for the countdown to finish. 等倒计时结束再施法。' : null),
  helpBlock: (world, src, dst) => src.id !== dst.id && inMatch(world.duel, dst.id) && !duelPartners(world.duel, src.id, dst.id), // no help from the crowd (a 2v2 partner may)
  npc(world, w) {
    // a sparring partner: still until the countdown ends, then only the opponent, gently (no healing, a Stupefy about
    // every other thought), so a first-year can beat a seventh-year NPC
    const m = world.duel.match;
    if (!m || sideOf(m, w.id) < 0) return false;
    if (m.phase !== 'fight' || m.out[w.id]) return true;
    const foes = m.sides[1 - sideOf(m, w.id)].filter((id) => !m.out[id]).map((id) => world.wizards.get(id)).filter((x): x is Wizard => !!x);
    const opp = foes.sort((p, q) => Math.hypot(p.pos.x - w.pos.x, p.pos.z - w.pos.z) - Math.hypot(q.pos.x - w.pos.x, q.pos.z - w.pos.z))[0];
    if (opp && world.rand() < 0.5 && w.mana > 10) world.cast(w.id, 'Stupefy', { target: opp.id });
    return true;
  },
  tools: [{
    name: 'duel_club', title: 'Duelling Club', cost: 0,
    description: `决斗俱乐部 on the Courtyard stage (${DUEL_STAGE.x}, ${DUEL_STAGE.z}): op "join" queues you (two in the queue make a match, the nearest year first; alone for ${DUEL_NPC_AFTER_S}s and an NPC spars with you; mode "2v2": a team match of four, years balanced, your partner an ally you may heal), "leave" leaves the queue (or forfeits a match), "status" shows the queue, the match (both sides' health) and your rewarded wins this term. A match: placed at the two ends and healed, a bow and a countdown (no moving or casting), then up to ${DUEL_FIGHT_S}s. Only you two can harm each other (whatever your houses); nobody can interfere. Knocked to zero, walked off the stage or gone: the other wins. A win you fought for: +${DUEL_WIN_REP} reputation and XP, at most ${DUEL_TERM_CAP} rewarded wins a term, the same pair once every ${DUEL_PAIR_GAP_S / 60} minutes; NPC sparring pays XP only. dodge, wait until:"incoming" and a well-timed Protego matter here.`,
    input: { op: z.enum(DUEL_OPS).optional(), mode: z.enum(['1v1', '2v2']).optional().describe('join: "2v2" queues you for a team match (four make one; NPCs fill after a wait)') },
    run: (world, wid, a) => runOp(world, wid, a.op, a.mode),
  }],
  ws: (world, wid, m) => runOp(world, wid, m.op, m.mode),
};
