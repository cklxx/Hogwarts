/**
 * 试玩指标 (a Feature; docs/PLAYTEST_METRICS.md): what a playtest observer would otherwise time by hand, recorded
 * once a second for every player — seconds from arrival to the first move, cast and creature down; knock-outs in
 * the first ten minutes; which of the ten systems they touched and when; chat lines; time online and sessions; the
 * tutorial step their browser reached and whether it was a phone. `npx tsx scripts/playtest/report.ts` prints the
 * observer sheet from data/world.json. Names and times only: never a key, never sent anywhere (data/ is not committed).
 */
import { inMatch } from './duelclub.js';
import type { Feature } from './feature.js';
import { qdOnTeam } from './quidditch.js';
import { isDaMember } from './unfair.js';
import type { Wizard } from './types.js';
import type { World } from './world.js';

/** The ten systems of the observer sheet, in its order. */
export const SYSTEMS = ['fight', 'duel', 'spell', 'market', 'exam', 'quidditch', 'event', 'chest', 'da', 'politics'] as const;
export type SystemId = (typeof SYSTEMS)[number];
export const SYSTEM_ZH: Record<SystemId, string> = { fight: '打怪', duel: '决斗', spell: '写/改咒语', market: '集市', exam: '考试', quidditch: '魁地奇', event: '校园事件', chest: '宝箱', da: '邓布利多军', politics: '部长/法令' };
/** Offline this long, then online again: a new session (a comeback). */
export const SESSION_GAP_S = 600;
/** The window for "knock-outs early on". */
export const EARLY_S = 600;

export interface PlayerMetrics {
  name: string;
  /** World time of arrival; the marks below are seconds after it. */
  t0: number;
  x0: number; z0: number;
  move?: number; cast?: number; kill?: number;
  /** When each system was first touched. */
  sys: Partial<Record<SystemId, number>>;
  kosEarly: number; stunned0: number;
  chats: number;
  online: number; sessions: number; lastOn: number;
  /** From the browser: the furthest tutorial step (1-based) and a coarse pointer. */
  tut?: number; touch?: boolean;
  /** The camera the browser used last (the 俯视 experiment): 'top' or 'follow'. */
  view?: 'top' | 'follow';
}

declare module './world.js' {
  interface World {
    /** 试玩指标 (this module's Feature): per player, and the last event already counted for chat lines. */
    metrics: { of: Map<string, PlayerMetrics>; ev: number };
  }
}

const since = (world: World, m: PlayerMetrics) => Math.round(world.now - m.t0);

function touched(world: World, w: Wizard): SystemId[] {
  const src = w.cup && w.cup.term === world.term.n ? w.cup.src : {};
  const own = w.spells.some((s) => !s.builtin && !s.market && !s.origin);
  const out: SystemId[] = [];
  if (w.stats.creatures > 0) out.push('fight');
  if (inMatch(world.duel, w.id)) out.push('duel');
  if (own) out.push('spell');
  if (w.spells.some((s) => s.market) || Object.values(world.market.listings).some((l) => l.author === w.id)) out.push('market');
  if ((src.owls ?? 0) > 0) out.push('exam');
  if (qdOnTeam(world, w.id)) out.push('quidditch');
  if ((src.events ?? 0) > 0) out.push('event');
  if ((src.chests ?? 0) > 0) out.push('chest');
  if (isDaMember(world, w.id)) out.push('da');
  if (w.wasMinister) out.push('politics');
  return out;
}

function sweep(world: World) {
  const mx = world.metrics;
  for (const w of world.wizards.values()) {
    if (w.npc) continue;
    let m = mx.of.get(w.id);
    const on = world.online(w);
    if (!m) {
      if (!on) continue;
      m = { name: w.name, t0: world.now, x0: w.pos.x, z0: w.pos.z, sys: {}, kosEarly: 0, stunned0: w.stats.stunned, chats: 0, online: 0, sessions: 1, lastOn: world.now };
      mx.of.set(w.id, m);
    }
    if (!on) continue;
    if (world.now - m.lastOn > SESSION_GAP_S) m.sessions++;
    m.online += Math.min(1, world.now - m.lastOn);
    m.lastOn = world.now;
    m.name = w.name;
    const t = since(world, m);
    if (m.move === undefined && Math.hypot(w.pos.x - m.x0, w.pos.z - m.z0) > 3) m.move = t;
    if (m.cast === undefined && w.stats.casts > 0) m.cast = t;
    if (m.kill === undefined && w.stats.creatures > 0) m.kill = t;
    if (w.stats.stunned > m.stunned0) { if (t <= EARLY_S) m.kosEarly += w.stats.stunned - m.stunned0; m.stunned0 = w.stats.stunned; }
    for (const s of touched(world, w)) m.sys[s] ??= t;
  }
  // chat lines since the last sweep (the feed keeps the last 400 events: a sweep a second never falls behind)
  for (const e of world.events) {
    if (e.id <= mx.ev) continue;
    if (e.type === 'chat' && e.who?.[0]) { const m = mx.of.get(e.who[0]); if (m) m.chats++; }
  }
  mx.ev = world.events.at(-1)?.id ?? mx.ev;
}

export const METRICS_FEATURE: Feature = {
  id: 'metrics',
  init(world) { world.metrics = { of: new Map(), ev: 0 }; },
  sweep,
  save: (world) => Object.fromEntries(world.metrics.of),
  load(world, data) {
    if (!data || typeof data !== 'object') return;
    for (const [id, m] of Object.entries(data as Record<string, PlayerMetrics>)) if (m && typeof m.t0 === 'number') world.metrics.of.set(id, { ...m, sys: m.sys ?? {}, lastOn: m.lastOn ?? m.t0 });
  },
  // the browser: {t:'metrics', tut, touch} as the tutorial moves on
  ws(world, wid, msg) {
    const m = world.metrics.of.get(wid);
    if (!m) return null;
    const step = Number(msg.tut);
    if (Number.isInteger(step) && step > 0 && step <= 20) m.tut = Math.max(m.tut ?? 0, step);
    if (typeof msg.touch === 'boolean') m.touch = msg.touch;
    if (msg.view === 'top' || msg.view === 'follow') m.view = msg.view;
    return null;
  },
};
