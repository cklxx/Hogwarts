/**
 * 决斗俱乐部 (roadmap step 3): a queue, a stage in the Courtyard, one match at a time, bounded rewards.
 *
 * - `duel_club join` (MCP) / G (browser) queues you; two in the queue make a match; alone for DUEL_NPC_AFTER_S
 *   and an NPC steps up to spar.
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
import { qdOnTeam, qdPlaying } from './quidditch.js';
import type { World } from './world.js';
import type { Wizard } from './types.js';

export const DUEL_STAGE = { x: 0, z: -30 };
export const DUEL_ENDS = [{ x: -7, z: -30 }, { x: 7, z: -30 }] as const;
export const DUEL_BOW_S = 2, DUEL_COUNT_S = 3, DUEL_FIGHT_S = 90, DUEL_NPC_AFTER_S = 30, DUEL_LEASH = 22;
export const DUEL_WIN_REP = 6, DUEL_WIN_XP = 40, DUEL_LOSS_XP = 15, DUEL_TERM_CAP = 5, DUEL_PAIR_GAP_S = 600, DUEL_QUEUE_MAX = 32;

export type DuelPhase = 'bow' | 'count' | 'fight';
export interface DuelMatch {
  id: number; a: string; b: string; phase: DuelPhase; at: number; npc: boolean;
  stats: Record<string, { dealt: number; hits: number; reflects0: number; dodges0: number }>;
  /** Set by World.damage when one of them is knocked to zero (the tick then ends the match). */
  loser?: string;
}
export interface DuelLedger { term: number; wins: Record<string, number>; pairs: Record<string, number> }
export interface DuelResult { a: string; b: string; winner: string | null; secs: number; at: number }
export interface DuelClub { queue: { id: string; at: number }[]; match: DuelMatch | null; seq: number; ledger: DuelLedger; last: DuelResult[] }

export const newDuelClub = (): DuelClub => ({ queue: [], match: null, seq: 0, ledger: { term: 0, wins: {}, pairs: {} }, last: [] });

/**
 * The reward step (Lean `duelStep`): a fresh win (not an NPC, not a rematch within the gap) under the term cap
 * counts and pays DUEL_WIN_REP; anything else leaves the count and pays nothing. Returns [wins', reputation].
 */
export function duelStep(wins: number, cap: number, fresh: boolean): [number, number] {
  return fresh && wins < cap ? [wins + 1, DUEL_WIN_REP] : [wins, 0];
}

/** What one finished match pays (mutating the ledger): winner/loser XP and the winner's reputation. */
export function duelGrant(l: DuelLedger, winner: string, loser: string, now: number, term: number, npc: boolean) {
  if (l.term !== term) { l.term = term; l.wins = {}; }
  const key = [winner, loser].sort().join('|');
  const rematch = now - (l.pairs[key] ?? -1e12) < DUEL_PAIR_GAP_S;
  const fresh = !npc && !rematch;
  const [wins, rep] = duelStep(l.wins[winner] ?? 0, DUEL_TERM_CAP, fresh);
  l.wins[winner] = wins;
  if (!rematch) l.pairs[key] = now;
  const why: 'ok' | 'npc' | 'rematch' | 'cap' = npc ? 'npc' : rematch ? 'rematch' : rep ? 'ok' : 'cap';
  // NPC sparring always pays its (half) XP — the rematch gap guards reputation between players, not practice
  return { rep, xpWinner: npc ? Math.round(DUEL_WIN_XP / 2) : rematch ? 0 : DUEL_WIN_XP, xpLoser: rematch || npc ? 0 : DUEL_LOSS_XP, why };
}

/** Is `id` in the match that is fighting right now? */
export function inFight(club: DuelClub, id: string | null | undefined): boolean {
  const m = club.match;
  return !!id && !!m && m.phase === 'fight' && (m.a === id || m.b === id);
}
/** Is `id` in the current match at all (bowing, counting down or fighting)? */
export function inMatch(club: DuelClub, id: string | null | undefined): boolean {
  const m = club.match;
  return !!id && !!m && (m.a === id || m.b === id);
}

/** Why the club is closed right now, or null. */
export function duelClosed(world: World): string | null {
  if (!world.rules.combat.pvp) return 'The Ministry has forbidden duelling (PvP is off). 魔法部禁止了决斗（PvP 已关闭）。';
  if (world.inSafe(DUEL_STAGE)) return 'The Courtyard is a safe zone by decree: the Duelling Club is closed. 法令把庭院设成了安全区：决斗俱乐部暂停。';
  return null;
}

export function duelJoin(world: World, wid: string) {
  const c = world.duel, w = world.need(wid);
  const closed = duelClosed(world);
  if (closed) throw new Error(closed);
  if (!world.isActive(w)) throw new Error('Not while you are stunned or in Azkaban. 被击晕或在阿兹卡班时不能报名。');
  if (inMatch(c, wid)) throw new Error('You are duelling right now. 你正在决斗。');
  if (qdPlaying(world, wid)) throw new Error('You are playing Quidditch: leave the pitch first (quidditch leave). 你正在打魁地奇：先下场（quidditch leave）。');
  if (!c.queue.some((q) => q.id === wid)) {
    if (c.queue.length >= DUEL_QUEUE_MAX) throw new Error('The queue is full; try again soon. 排队的人满了，等一会儿。');
    c.queue.push({ id: wid, at: world.now });
    world.emit('duel', `${w.name} signed up for the Duelling Club.`, { zh: `${w.name} 报名了决斗俱乐部。` });
  }
  return duelStatus(world, wid);
}

export function duelLeave(world: World, wid: string) {
  const c = world.duel;
  c.queue = c.queue.filter((q) => q.id !== wid);
  const m = c.match;
  if (m && (m.a === wid || m.b === wid)) endMatch(world, m.a === wid ? m.b : m.a, 'forfeit');
  return duelStatus(world, wid);
}

export function duelStatus(world: World, wid: string | null) {
  const c = world.duel;
  const m = c.match;
  const name = (id: string) => world.wizards.get(id)?.name ?? '?';
  const pos = wid ? c.queue.findIndex((q) => q.id === wid) : -1;
  return {
    closed: duelClosed(world),
    stage: DUEL_STAGE,
    queue: c.queue.length, you: pos >= 0 ? { position: pos + 1 } : inMatch(c, wid) ? { inMatch: true } : null,
    match: m ? {
      a: name(m.a), b: name(m.b), phase: m.phase, secondsLeft: Math.max(0, Math.ceil(phaseEnd(m) - world.now)),
      // both sides' health and shields, so an agent can duel from status alone (playtest round 2)
      hp: [m.a, m.b].map((id) => { const x = world.wizards.get(id); return x ? { name: x.name, hp: Math.round(x.hp), maxHp: world.derivedOf(x).maxHp, shield: Math.round(x.st.shield ?? 0), dealt: Math.round(m.stats[id]?.dealt ?? 0) } : null; }),
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
  return { a: world.wizards.get(m.a)?.handle, b: world.wizards.get(m.b)?.handle, ph: m.phase, t: Math.max(0, Math.ceil(phaseEnd(m) - world.now)) };
}

function heal(world: World, w: Wizard) {
  const d = world.derivedOf(w);
  w.hp = d.maxHp;
  w.mana = d.maxMana;
}

function startMatch(world: World, a: Wizard, b: Wizard, npc: boolean) {
  const c = world.duel;
  c.queue = c.queue.filter((q) => q.id !== a.id && q.id !== b.id);
  for (const [w, end] of [[a, DUEL_ENDS[0]], [b, DUEL_ENDS[1]]] as const) {
    w.pos = { ...end };
    w.goal = null; w.route = []; w.goalBy = null;
    w.input = { dx: 0, dz: 0 };
    w.st.shield = 0; w.st.shieldUntil = 0; w.st.dodgeUntil = 0;
    heal(world, w);
    w.facing = Math.atan2(DUEL_STAGE.x - end.x, -(DUEL_STAGE.z - end.z));
    world.moved(w);
  }
  const stats = Object.fromEntries([a, b].map((w) => [w.id, { dealt: 0, hits: 0, reflects0: w.stats.reflects ?? 0, dodges0: w.stats.dodges ?? 0 }]));
  c.match = { id: ++c.seq, a: a.id, b: b.id, phase: 'bow', at: world.now, npc, stats };
  const kind = npc ? { en: 'sparring with an NPC: XP only', zh: '和 NPC 陪练：只给经验' } : { en: 'rated: a win you fight for pays reputation', zh: '计分赛：打出来的胜利给声望' };
  world.emit('duel', `Duelling Club: ${a.name} (${a.house}) against ${b.name} (${b.house}) — ${kind.en}. Wands up — bow.`, { zh: `决斗俱乐部：${a.name} 对 ${b.name}（${kind.zh}）！举杖——鞠躬。` });
}

function endMatch(world: World, winner: string | null, how: 'knockout' | 'forfeit' | 'time') {
  const c = world.duel, m = c.match;
  if (!m) return;
  c.match = null;
  const secs = Math.round(m.phase === 'fight' ? world.now - m.at : 0);
  c.last.push({ a: m.a, b: m.b, winner, secs, at: world.now });
  if (c.last.length > 20) c.last.shift();
  const A = world.wizards.get(m.a), B = world.wizards.get(m.b);
  for (const w of [A, B]) if (w) heal(world, w);
  if (!A || !B) return;
  if (!winner) {
    world.emit('duel', `Duelling Club: ${A.name} and ${B.name} — a draw at the bell.`, { zh: `决斗俱乐部：${A.name} 和 ${B.name} 打成平手。` });
    return;
  }
  const W = winner === A.id ? A : B, Lz = W === A ? B : A;
  // a win nobody fought for pays nothing and leaves the ledger alone (a friend joining and walking off is no farm)
  const earned = m.phase === 'fight' && (m.stats[W.id]?.dealt ?? 0) > 0;
  const g = earned ? duelGrant(c.ledger, W.id, Lz.id, world.now, world.term.n, m.npc) : { rep: 0, xpWinner: 0, xpLoser: 0, why: 'unearned' as const };
  if (g.rep) world.addRep(W, g.rep, 'duels');
  if (g.xpWinner) world.gainXp(W, g.xpWinner);
  if (g.xpLoser) world.gainXp(Lz, g.xpLoser);
  const s = m.stats[W.id], r = (W.stats.reflects ?? 0) - s.reflects0, dd = (W.stats.dodges ?? 0) - s.dodges0;
  const howEn = how === 'knockout' ? 'knocked out' : how === 'forfeit' ? 'by forfeit' : 'on points at the bell';
  const howZh = how === 'knockout' ? '击倒' : how === 'forfeit' ? '对方弃权' : '时间到按伤害判';
  const pay = g.rep ? { en: ` (+${g.rep} reputation)`, zh: `（声望 +${g.rep}）` } : g.why === 'unearned' ? { en: ' (no blow landed: no reward)', zh: '（一招未中，不计奖励）' } : { en: g.why === 'rematch' ? ' (a rematch: no reward)' : g.why === 'cap' ? ' (this term\'s rewarded wins are used up)' : ' (sparring: XP only)', zh: g.why === 'rematch' ? '（重赛，不计奖励）' : g.why === 'cap' ? '（本学期的计奖胜场已用完）' : '（陪练，只给经验）' };
  world.emit('duel', `Duelling Club: ${W.name} beat ${Lz.name} ${howEn} in ${secs}s — ${Math.round(s.dealt)} damage, ${s.hits} hits${r ? `, ${r} perfect Protego` : ''}${dd ? `, ${dd} rolls` : ''}.${pay.en}`, { who: [W.id, Lz.id], zh: `决斗俱乐部：${W.name} ${howZh}战胜 ${Lz.name}，用时 ${secs} 秒——造成 ${Math.round(s.dealt)} 伤害、命中 ${s.hits} 次${r ? `、完美格挡 ${r} 次` : ''}${dd ? `、翻滚 ${dd} 次` : ''}。${pay.zh}` });
}

/** Called every tick by World.tick. */
export function stepDuelClub(world: World) {
  const c = world.duel;
  const m = c.match;
  if (m) {
    const A = world.wizards.get(m.a), B = world.wizards.get(m.b);
    const gone = (w: Wizard | undefined) => !w || !world.online(w) || w.st.jailedUntil > 0;
    if (gone(A) || gone(B)) return endMatch(world, gone(A) ? (gone(B) ? null : m.b) : m.a, 'forfeit');
    if (m.loser) return endMatch(world, m.loser === m.a ? m.b : m.a, 'knockout');
    if (m.phase === 'fight') {
      const off = (w: Wizard) => Math.hypot(w.pos.x - DUEL_STAGE.x, w.pos.z - DUEL_STAGE.z) > DUEL_LEASH;
      if (off(A!) || off(B!)) return endMatch(world, off(A!) ? (off(B!) ? null : m.b) : m.a, 'forfeit');
    }
    if (world.now >= phaseEnd(m)) {
      if (m.phase === 'bow') { m.phase = 'count'; m.at = world.now; world.emit('duel', 'Three… two… one…', { zh: '三……二……一……' }); }
      else if (m.phase === 'count') { m.phase = 'fight'; m.at = world.now; world.emit('duel', 'Duel!', { zh: '开始！' }); }
      else {
        // the bell: more damage dealt wins (regen would wash out an HP comparison), then the healthier one
        const da = m.stats[m.a]?.dealt ?? 0, db = m.stats[m.b]?.dealt ?? 0;
        const fa = A!.hp / world.derivedOf(A!).maxHp, fb = B!.hp / world.derivedOf(B!).maxHp;
        const w = Math.abs(da - db) > 1e-9 ? (da > db ? m.a : m.b) : Math.abs(fa - fb) < 1e-9 ? null : fa > fb ? m.a : m.b;
        endMatch(world, w, 'time');
      }
    }
    return;
  }
  if (duelClosed(world)) return;
  // drop whoever is no longer in play, then pair the first two, or give a lone wizard an NPC to spar with
  c.queue = c.queue.filter((q) => { const w = world.wizards.get(q.id); return !!w && world.online(w) && world.isActive(w) && !qdPlaying(world, q.id); });
  if (c.queue.length >= 2) {
    const a = world.wizards.get(c.queue[0].id)!, b = world.wizards.get(c.queue[1].id)!;
    return startMatch(world, a, b, !!(a.npc || b.npc));
  }
  if (c.queue.length === 1 && world.now - c.queue[0].at >= DUEL_NPC_AFTER_S) {
    const a = world.wizards.get(c.queue[0].id)!;
    // an NPC who is free: not flying in this term's Quidditch match (playtest round 2: one NPC in both stood still, then flew off the stage)
    const npc = [...world.wizards.values()].find((w) => w.npc && world.isActive(w) && !qdOnTeam(world, w.id));
    if (npc) startMatch(world, a, npc, true);
  }
}
