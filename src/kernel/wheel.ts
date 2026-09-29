import {
  CURFEW_GRACE_S, CURFEW_PENALTY, EVENT_IDS, EVENT_MAX_S, SNITCH_CAP_PER_TERM, SNITCH_POINTS, type EventId, type House,
} from '../shared/constants.js';
import { CURFEW_CAUGHT, WHEEL_LINES, fill, houseLine, type Line } from '../lore/memes.js';
import { zhHouse } from '../shared/zh.js';
import { CREATURES } from './creatures.js';
import { CHESTS, rollCard } from './cards.js';
import { dist } from './physics.js';
import { findPath } from './pathfind.js';
import type { Creature, Projectile, Vec2, Wizard } from './types.js';
import type { World } from './world.js';

/**
 * 校园事件轮盘 — the event wheel (README 校园事件轮盘). Every rules.events.intervalSeconds (start to start, and never
 * sooner than GAP_S after the last one ended) the world rolls one event from rules.events.pool, deterministically
 * from its own seeded stream (World.funRand). At most one event runs at a time; each ends by its deadline
 * (≤ EVENT_MAX_S) or earlier when won; its rewards are paid once (`settle`). formal/tla/EventWheel.tla models
 * exactly this loop (AtMostOneActive, EndsByDeadline, PaidAtMostOnce).
 *
 * The registry (EVENTS) is data + handlers: a new event (the dragon egg, the Bertie Bott wagon…) is one more entry
 * with its id in EVENT_IDS, its lines in lore/memes.ts WHEEL_LINES and whatever it needs in `d`.
 */

export type Outcome = 'on' | 'won' | 'lost';

export interface ActiveEvent {
  id: EventId;
  /** The instance number (the n-th event this world has rolled). */
  n: number;
  startedAt: number;
  endsAt: number;
  outcome: Outcome;
  /** Rewards paid (settle runs once). */
  paid: boolean;
  /** Where the compass points. */
  x: number; z: number;
  /** Per-event state. */
  d: EventData;
}

interface EventData {
  /** troll / dementors: the creatures this event spawned. */
  mobs?: string[];
  maxHp?: number;
  /** snitch: position, waypoint, hover clock; who has been close for how long. */
  sx?: number; sz?: number; wx?: number; wz?: number; hover?: number; near?: Record<string, number>;
  /** curfew: Filch and Mrs Norris on their loop; grace per wizard; who was caught; seconds each spent in the castle. */
  route?: Vec2[]; legs?: number[]; loop?: number; patrol?: { k: 'filch' | 'norris'; s: number; x: number; z: number; f: number }[];
  grace?: Record<string, number>; caught?: string[]; inside?: Record<string, number>; day?: boolean;
  /** dementors: who took part (id → house); houses that lost someone. */
  part?: Record<string, House>; kissed?: House[];
  /** peeves: the ink's radius and where Peeves floats; the place's name. */
  r?: number; px?: number; pz?: number; place?: Line;
  /** room: who got a chest. */
  claimed?: string[];
  /** Who won it (the snitch's catcher, Peeves' hitter, the troll's last blow). */
  hero?: string;
  acc?: number;
  /** dementors: damage per wizard to this event's Dementors. */
  dmg?: Record<string, number>;
}

export interface WheelState {
  nextAt: number;
  seq: number;
  active: ActiveEvent | null;
  /** The last few events (for the HUD's result slip and MCP school_events). */
  history: { id: EventId; n: number; outcome: Outcome; at: number; hero?: string }[];
}

export const blankWheel = (interval: number): WheelState => ({ nextAt: interval, seq: 0, active: null, history: [] });

/** Never roll sooner than this after the last event ended. */
export const GAP_S = 20;
/** The result of an event stays on the HUD this long. */
export const RESULT_S = 8;

interface EventDef {
  id: EventId;
  major: boolean;
  seconds: number;
  weight: number;
  name: Line;
  /** The objective slip. */
  brief: (w: World, e: ActiveEvent) => Line;
  can: (w: World) => boolean;
  start: (w: World, e: ActiveEvent) => Line;
  tick?: (w: World, e: ActiveEvent, dt: number) => void;
  /** Pay out (called once, by settle). */
  pay?: (w: World, e: ActiveEvent) => void;
  /** Tidy up (remove what the event spawned). */
  end?: (w: World, e: ActiveEvent) => void;
}

const players = (w: World) => [...w.wizards.values()].filter((x) => !x.npc && w.online(x));
const line = (pool: readonly Line[], w: World, e: ActiveEvent) => pool[(e.n + Math.floor(w.now)) % pool.length];
const houseL = (h: House) => houseLine(h);

// ------------------------------------------------------------------ places
export const DUNGEON_STAIR = { x: -50, z: -36 };
export const PITCH = { x: 40, z: -150, r: 26 };
export const SEVENTH = { x: -32, z: -58 };
export const LAKE_EDGE = { x: -64, z: 32 };
const GROUNDS_HEART = { x: -12, z: -8 };
/** The castle for curfew: the courtyard, the Great Hall, the wing fronts, the dungeon stair and the greenhouses. */
export const CASTLE = { x0: -64, z0: -73, x1: 64, z1: -4 };
export const inCastle = (p: Vec2) => p.x >= CASTLE.x0 && p.x <= CASTLE.x1 && p.z >= CASTLE.z0 && p.z <= CASTLE.z1;
/** Filch's round: courtyard → west front → seventh floor → the hall door → east front → Erised → greenhouses → back. */
export const CURFEW_WAYPOINTS: Vec2[] = [
  { x: 0, z: -9 }, { x: -21, z: -24 }, { x: -24, z: -40 }, { x: -42, z: -47 }, { x: -52, z: -52 }, { x: -32, z: -58 },
  { x: -16, z: -46 }, { x: 0, z: -36 }, { x: 16, z: -46 }, { x: 30, z: -57 }, { x: 52, z: -52 }, { x: 44, z: -26 }, { x: 21, z: -22 },
];
export const FILCH = { speed: 2.6, range: 11, halfAngle: 0.8 };
export const NORRIS = { speed: 3.3, range: 4 };
const PEEVES_SPOTS: { x: number; z: number; place: Line }[] = [
  { x: 4, z: -16, place: { zh: '庭院', en: 'the Courtyard' } },
  { x: 41, z: -22, place: { zh: '温室门口', en: 'the greenhouses' } },
  { x: 0, z: 168, place: { zh: '霍格莫德大街', en: 'Hogsmeade High Street' } },
  { x: 40, z: -135, place: { zh: '魁地奇球场', en: 'the Quidditch pitch' } },
  { x: 86, z: 22, place: { zh: '海格小屋门口', en: "Hagrid's front garden" } },
];

// ------------------------------------------------------------------ the registry
export const EVENTS: Record<EventId, EventDef> = {
  troll: {
    id: 'troll', major: true, seconds: 150, weight: 3,
    name: { zh: '地下教室有巨怪！', en: 'Troll in the dungeon!' },
    brief: () => ({ zh: '合力打倒地窖楼梯口的巨怪 · 按伤害分学院分', en: 'Bring down the troll at the Dungeon Stair · points by damage' }),
    can: (w) => w.rules.creatures.enabled.troll,
    start(w, e) {
      const n = players(w).length;
      const mult = Math.min(6, 1.5 + 0.5 * n);
      const c = spawnMob(w, 'troll', DUNGEON_STAIR, mult, 1.2, e.n);
      e.d.mobs = [c.id];
      e.d.maxHp = c.maxHp;
      e.x = DUNGEON_STAIR.x; e.z = DUNGEON_STAIR.z;
      return line(WHEEL_LINES.troll.start, w, e);
    },
    tick(w, e) {
      const c = e.d.mobs?.[0] ? w.creatures.get(e.d.mobs[0]) : undefined;
      if (c) { e.x = c.pos.x; e.z = c.pos.z; }
    },
    end: removeMobs,
  },
  snitch: {
    id: 'snitch', major: true, seconds: 90, weight: 3,
    name: { zh: '金色飞贼出现了', en: 'The Golden Snitch' },
    brief: () => ({ zh: `魁地奇球场 · 贴近 1.5 米停半秒，或用咒语打中 · +${SNITCH_POINTS} 学院分`, en: `Quidditch pitch · stay within 1.5 m for 0.5 s, or hit it with a spell · +${SNITCH_POINTS} house points` }),
    can: (w) => !w.qd.match, // 魁地奇: the match has its own Snitch
    start(w, e) {
      e.d.sx = PITCH.x; e.d.sz = PITCH.z; e.d.hover = 0; e.d.near = {};
      pickWaypoint(w, e);
      e.x = PITCH.x; e.z = PITCH.z;
      return fill(line(WHEEL_LINES.snitch.start, w, e), { n: SNITCH_POINTS });
    },
    tick(w, e, dt) {
      const d = e.d;
      if ((d.hover ?? 0) > 0) d.hover! -= dt;
      else {
        const dx = d.wx! - d.sx!, dz = d.wz! - d.sz!, l = Math.hypot(dx, dz);
        const step = 6.5 * dt;
        if (l <= step) { d.sx = d.wx; d.sz = d.wz; d.hover = 0.5 + w.funRand() * 0.9; pickWaypoint(w, e); }
        else { d.sx! += (dx / l) * step; d.sz! += (dz / l) * step; }
      }
      e.x = d.sx!; e.z = d.sz!;
      const at = { x: d.sx!, z: d.sz! };
      const near = d.near!;
      for (const x of w.nearWizards(at, 3)) {
        if (x.npc || !w.isActive(x)) continue;
        if (dist(x.pos, at) <= 1.5) {
          near[x.id] = (near[x.id] ?? 0) + dt;
          if (near[x.id] >= 0.5) { catchSnitch(w, e, x); return; }
        } else delete near[x.id];
      }
      for (const id of Object.keys(near)) { const x = w.wizards.get(id); if (!x || dist(x.pos, at) > 1.5) delete near[id]; }
    },
  },
  curfew: {
    id: 'curfew', major: true, seconds: 150, weight: 2,
    name: { zh: '宵禁！费尔奇在巡逻', en: 'Curfew! Filch on patrol' },
    brief: (w, e) => (e.d.day
      ? { zh: '乌姆里奇第 29 号教育令：宵禁提前 · 城堡里别被费尔奇和洛丽丝夫人看见 · 躲在柱子后面', en: 'Educational Decree No. 29: curfew moved up · in the castle, stay out of sight of Filch and Mrs Norris · hide behind pillars' }
      : { zh: '城堡里别被费尔奇和洛丽丝夫人看见 · 躲在柱子后面 · 熬过去有奖励', en: 'In the castle, stay out of sight of Filch and Mrs Norris · hide behind pillars · last it out for a reward' }),
    can: () => true,
    start(w, e) {
      const { route, legs } = curfewRoute(w);
      e.d.route = route; e.d.legs = legs; e.d.loop = legs[legs.length - 1];
      e.d.patrol = [{ k: 'filch', s: 0, x: route[0].x, z: route[0].z, f: 0 }, { k: 'norris', s: e.d.loop! / 2, x: route[0].x, z: route[0].z, f: 0 }];
      for (const p of e.d.patrol) placeOnRoute(e, p);
      e.d.grace = {}; e.d.caught = []; e.d.inside = {}; e.d.day = !w.isNight(); e.d.acc = 0;
      e.x = route[0].x; e.z = route[0].z;
      const l = line(WHEEL_LINES.curfew.start, w, e);
      return e.d.day ? { zh: `📜 乌姆里奇第 29 号教育令：宵禁提前到下午！${l.zh}`, en: `📜 Educational Decree No. 29: curfew starts this afternoon! ${l.en}` } : l;
    },
    tick(w, e, dt) {
      const d = e.d;
      for (const p of d.patrol!) { p.s = (p.s + (p.k === 'filch' ? FILCH.speed : NORRIS.speed) * dt) % d.loop!; placeOnRoute(e, p); }
      e.x = d.patrol![0].x; e.z = d.patrol![0].z;
      d.acc! += dt;
      if (d.acc! < 0.25) return;
      const step = d.acc!;
      d.acc = 0;
      for (const x of players(w)) {
        if (!w.isActive(x) || !inCastle(x.pos)) continue;
        d.inside![x.id] = (d.inside![x.id] ?? 0) + step;
        if ((d.grace![x.id] ?? -1e9) > w.now) continue;
        const who = d.patrol!.find((p) => seesWizard(w, p, x));
        if (who) caughtAfterCurfew(w, e, x, who.k);
      }
    },
    pay(w, e) {
      const d = e.d;
      let n = 0;
      for (const [id, secs] of Object.entries(d.inside ?? {})) {
        const x = w.wizards.get(id);
        if (!x || d.caught!.includes(id) || secs < Math.min(60, EVENTS.curfew.seconds * 0.4)) continue;
        n++;
        const g = w.cupGain(x, 25, 'events');
        w.emit('wheel', `🏮 You lasted the curfew in the castle without being caught: +${g} house points for ${x.house}.`, { to: x.id, zh: `🏮 你在城堡里熬过了宵禁，一次也没被抓到：${zhHouse(x.house)} +${g} 学院分。` });
      }
      e.outcome = n > 0 ? 'won' : 'lost';
      d.acc = n;
    },
  },
  dementors: {
    id: 'dementors', major: true, seconds: 120, weight: 2,
    name: { zh: '摄魂怪来袭', en: 'Dementors!' },
    brief: () => ({ zh: '用呼神护卫把摄魂怪赶回湖面 · 哪个学院没人被击倒，全院参战者 +30', en: 'Drive the Dementors back with Expecto Patronum · a house with nobody knocked down: +30 each' }),
    can: (w) => w.isNight() && w.rules.creatures.enabled.dementor,
    start(w, e) {
      const n = Math.min(6, 3 + Math.floor(players(w).length / 3));
      e.d.mobs = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI - Math.PI / 2;
        const c = spawnMob(w, 'dementor', { x: LAKE_EDGE.x + Math.cos(a) * 6, z: LAKE_EDGE.z + Math.sin(a) * 10 }, 1, 1, e.n);
        c.home = { x: GROUNDS_HEART.x + Math.cos(a) * 8, z: GROUNDS_HEART.z + Math.sin(a) * 8 };
        e.d.mobs.push(c.id);
      }
      e.d.part = {}; e.d.kissed = [];
      e.x = LAKE_EDGE.x; e.z = LAKE_EDGE.z;
      return line(WHEEL_LINES.dementors.start, w, e);
    },
    tick(w, e) {
      const live = (e.d.mobs ?? []).map((id) => w.creatures.get(id)).filter((c): c is Creature => !!c);
      if (!live.length) { settle(w, e, 'won'); return; }
      let sx = 0, sz = 0;
      for (const c of live) {
        sx += c.pos.x; sz += c.pos.z;
        for (const id of Object.keys(c.damageBy)) { const x = w.wizards.get(id); if (x && !x.npc) e.d.part![id] = x.house; }
        for (const x of w.nearWizards(c.pos, 30)) if (!x.npc && w.isActive(x) && dist(x.pos, c.pos) <= 30) e.d.part![x.id] = x.house;
      }
      e.x = sx / live.length; e.z = sz / live.length;
    },
    pay(w, e) {
      const d = e.d;
      for (const [id, h] of Object.entries(d.part ?? {})) {
        const x = w.wizards.get(id);
        if (!x || d.kissed!.includes(h)) continue;
        const g = w.cupGain(x, 30, 'events');
        w.emit('wheel', `🌫️ Nobody from ${h} fell to the Dementors: +${g} house points.`, { to: x.id, zh: `🌫️ ${zhHouse(h)}没有一个人倒在摄魂怪面前：+${g} 学院分。` });
      }
      if (e.outcome === 'won') {
        // the Patronus that did the most
        let best: Wizard | undefined, most = 0;
        for (const [id, dmg] of Object.entries(d.dmg ?? {})) { const x = w.wizards.get(id); if (x && !x.npc && dmg > most) { most = dmg; best = x; } }
        if (best) { d.hero = best.name; rollCard(w, best, 'rare', { zh: '守护神最亮的人', en: 'The brightest Patronus' }); }
      }
    },
    end: removeMobs,
  },
  peeves: {
    id: 'peeves', major: false, seconds: 60, weight: 2,
    name: { zh: '皮皮鬼的墨水', en: "Peeves' ink" },
    brief: (_w, e) => ({ zh: `${e.d.place?.zh ?? ''}满地墨水会让你变慢 · 用任何咒语打中皮皮鬼 +30`, en: `Ink all over ${e.d.place?.en ?? ''} slows you · hit Peeves with any spell: +30` }),
    can: () => true,
    start(w, e) {
      const s = PEEVES_SPOTS[Math.floor(w.funRand() * PEEVES_SPOTS.length)];
      e.d.r = 7; e.d.px = s.x; e.d.pz = s.z; e.d.place = s.place; e.d.acc = 0;
      e.x = s.x; e.z = s.z;
      return fill(line(WHEEL_LINES.peeves.start, w, e), { house: s.place });
    },
    tick(w, e, dt) {
      const d = e.d;
      const t = w.now - e.startedAt;
      d.px = e.x + Math.cos(t * 0.9) * 3; d.pz = e.z + Math.sin(t * 1.3) * 3;
      d.acc! += dt;
      if (d.acc! < 0.5) return;
      d.acc = 0;
      for (const x of w.nearWizards(e, d.r!)) if (w.isActive(x) && dist(x.pos, e) <= d.r!) w.applyAura(x.id, 'chill', 1, 0.35, null);
    },
  },
  room: {
    id: 'room', major: false, seconds: 90, weight: 1,
    name: { zh: '有求必应屋', en: 'The Room of Requirement' },
    brief: (_w, e) => ({ zh: `八楼走廊来回走三趟 · 前三位得宝箱（还剩 ${3 - (e.d.claimed?.length ?? 0)} 个）`, en: `Pace the seventh-floor corridor three times · a chest for the first three (${3 - (e.d.claimed?.length ?? 0)} left)` }),
    can: () => true,
    start(w, e) {
      e.d.claimed = [];
      e.x = SEVENTH.x; e.z = SEVENTH.z;
      return line(WHEEL_LINES.room.start, w, e);
    },
  },
};

// ------------------------------------------------------------------ the loop

/** The event instance the world is running, if any (ids are EVENT_IDS). */
export function stepWheel(w: World, dt: number) {
  const s = w.wheel;
  const e = s.active;
  if (e) {
    if (e.outcome === 'on') {
      EVENTS[e.id].tick?.(w, e, dt);
      if (e.outcome === 'on' && w.now >= e.endsAt) settle(w, e, 'lost');
    }
    if (e.outcome !== 'on') finish(w, e);
    return;
  }
  const r = w.rules.events;
  if (!r.enabled || w.now < s.nextAt) return;
  const who = players(w);
  if (!who.length) { s.nextAt = w.now + 10; return; }
  const id = choose(w);
  if (!id) { s.nextAt = w.now + 30; return; }
  startEvent(w, id);
}

/** Pick the next event: eligible ones from the pool, by weight, never the same twice running if there is a choice. */
export function choose(w: World): EventId | null {
  const pool = [...new Set(w.rules.events.pool)].filter((id) => EVENT_IDS.includes(id) && EVENTS[id].can(w));
  if (!pool.length) return null;
  const last = w.wheel.history.at(-1)?.id;
  const from = pool.length > 1 && last ? pool.filter((id) => id !== last) : pool;
  const total = from.reduce((a, id) => a + EVENTS[id].weight, 0);
  let x = w.funRand() * total;
  for (const id of from) { if (x < EVENTS[id].weight) return id; x -= EVENTS[id].weight; }
  return from[from.length - 1];
}

/** Start one event (tests and the wheel). Refused while another runs: at most one at a time. */
export function startEvent(w: World, id: EventId): ActiveEvent | null {
  const s = w.wheel;
  if (s.active) return null;
  const def = EVENTS[id];
  const e: ActiveEvent = { id, n: ++s.seq, startedAt: w.now, endsAt: w.now + Math.min(EVENT_MAX_S, def.seconds), outcome: 'on', paid: false, x: 0, z: 0, d: {} };
  s.active = e;
  const l = def.start(w, e);
  w.emit('wheel', `${l.en}`, { zh: l.zh });
  return e;
}

/** Decide an event's outcome and pay it: exactly once, whatever calls it again. */
export function settle(w: World, e: ActiveEvent, outcome: 'won' | 'lost') {
  if (e.paid) return;
  e.paid = true;
  e.outcome = outcome;
  EVENTS[e.id].pay?.(w, e);
  const pool = WHEEL_LINES[e.id][e.outcome === 'won' ? 'won' : 'lost'];
  const hero = e.d.hero ? [...w.wizards.values()].find((x) => x.name === e.d.hero) : undefined;
  const l = fill(line(pool, w, e), { v: hero?.name ?? e.d.hero ?? '', n: e.id === 'curfew' || e.id === 'snitch' ? e.d.acc ?? 0 : 0, house: hero ? houseL(hero.house) : '' });
  w.emit('wheel', l.en, { zh: l.zh });
}

function finish(w: World, e: ActiveEvent) {
  const s = w.wheel;
  EVENTS[e.id].end?.(w, e);
  s.history = [...s.history, { id: e.id, n: e.n, outcome: e.outcome, at: w.now, ...(e.d.hero ? { hero: e.d.hero } : {}) }].slice(-6);
  s.active = null;
  s.nextAt = Math.max(e.startedAt + w.rules.events.intervalSeconds, w.now + GAP_S);
  w.wheelResult = { id: e.id, n: e.n, outcome: e.outcome, hero: e.d.hero, until: w.now + RESULT_S };
}

// ------------------------------------------------------------------ hooks from the kernel

/** A creature an event spawned was defeated (World.slay, after the usual rewards). */
export function wheelSlain(w: World, c: Creature) {
  const e = w.wheel.active;
  if (!e || e.outcome !== 'on' || c.ev !== e.n) return;
  if (e.id === 'dementors') {
    e.d.dmg ??= {};
    for (const [id, dmg] of Object.entries(c.damageBy)) e.d.dmg[id] = (e.d.dmg[id] ?? 0) + dmg;
    return;
  }
  if (e.id !== 'troll') return;
  const killer = c.lastHitBy ? w.wizards.get(c.lastHitBy) : undefined;
  e.d.hero = killer?.name;
  // 240 house points shared by damage (a share under 5% gets nothing); the top hitter a rare card, everyone ≥ 15% a card
  const total = Object.values(c.damageBy).reduce((a, b) => a + b, 0) || 1;
  const ranked = Object.entries(c.damageBy).sort((a, b) => b[1] - a[1]);
  ranked.forEach(([id, dmg], i) => {
    const x = w.wizards.get(id);
    const share = dmg / total;
    if (!x || share < 0.05) return;
    const g = w.cupGain(x, Math.round(240 * share), 'events');
    w.emit('wheel', `🧌 Your share of the troll: ${Math.round(share * 100)}% of the damage, +${g} house points for ${x.house}.`, { to: x.id, zh: `🧌 巨怪战的伤害占比 ${Math.round(share * 100)}%：${zhHouse(x.house)} +${g} 学院分。` });
    if (!x.npc && (i === 0 || share >= 0.15)) rollCard(w, x, i === 0 ? 'rare' : 'plain', { zh: '打倒巨怪', en: 'The troll' });
  });
  settle(w, e, 'won');
}

/** A wizard was knocked out by an event creature (World.stun). */
export function wheelKissed(w: World, v: Wizard, c: Creature) {
  const e = w.wheel.active;
  if (!e || e.outcome !== 'on' || c.ev !== e.n || e.id !== 'dementors' || v.npc) return;
  if (!e.d.kissed!.includes(v.house)) e.d.kissed!.push(v.house);
}

/** A spell in flight passes by: it catches the snitch or chases Peeves off (World.stepProjectiles). */
export function wheelBolt(w: World, p: Projectile) {
  const e = w.wheel.active;
  if (!e || e.outcome !== 'on') return;
  const o = w.wizards.get(p.owner);
  if (!o || o.npc) return;
  if (e.id === 'snitch' && Math.hypot(p.pos.x - e.d.sx!, p.pos.z - e.d.sz!) <= 1.1) catchSnitch(w, e, o);
  else if (e.id === 'peeves' && Math.hypot(p.pos.x - e.d.px!, p.pos.z - e.d.pz!) <= 1.4) {
    e.d.hero = o.name;
    const g = w.cupGain(o, 30, 'events');
    w.emit('wheel', `🎈 You chased Peeves off: +${g} house points for ${o.house}.`, { to: o.id, zh: `🎈 你把皮皮鬼赶跑了：${zhHouse(o.house)} +${g} 学院分。` });
    rollCard(w, o, 'plain', { zh: '赶走皮皮鬼', en: 'Chasing off Peeves' });
    settle(w, e, 'won');
  }
}

/** Someone paced the seventh-floor corridor three times (World.placeEggs): during the event, a chest for the first three. */
export function wheelRoom(w: World, x: Wizard): boolean {
  const e = w.wheel.active;
  if (!e || e.outcome !== 'on' || e.id !== 'room' || x.npc || e.d.claimed!.includes(x.id)) return false;
  e.d.claimed!.push(x.id);
  const g = w.cupGain(x, 20, 'events');
  w.emit('wheel', `🚪 A door appears in the blank wall. Inside: a chest, just for you (+${g} house points).`, { to: x.id, zh: `🚪 空墙上出现了一扇门，里面有一个只属于你的宝箱（学院分 +${g}）。` });
  w.chestLoot(x, { zh: '有求必应屋的宝箱', en: 'A chest from the Room of Requirement' }, true);
  if (e.d.claimed!.length >= 3) { e.d.hero = x.name; settle(w, e, 'won'); }
  return true;
}

// ------------------------------------------------------------------ event pieces

function spawnMob(w: World, kind: 'troll' | 'dementor', at: Vec2, hpMult: number, dmgMult: number, ev: number): Creature {
  const def = CREATURES[kind];
  const pos = { ...at };
  if (!def.flying) w.solids.resolve(pos, def.radius);
  const hp = Math.round(def.hp * w.rules.creatures.statMultiplier * hpMult);
  const c: Creature = {
    id: w.mintId('c'), kind, pos, home: { ...pos }, hp, maxHp: hp, facing: 0, target: null, attackCd: 1, rootedUntil: 0,
    wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0, ev, ...(dmgMult !== 1 ? { dmgMult } : {}),
  };
  w.creatures.set(c.id, c);
  w.fx({ k: 'apparate', x: pos.x, z: pos.z });
  return c;
}

function removeMobs(w: World, e: ActiveEvent) {
  for (const id of e.d.mobs ?? []) {
    const c = w.creatures.get(id);
    if (!c) continue;
    w.creatures.delete(id);
    w.fx({ k: 'apparate', x: c.pos.x, z: c.pos.z });
  }
}

function pickWaypoint(w: World, e: ActiveEvent) {
  const a = w.funRand() * Math.PI * 2, r = Math.sqrt(w.funRand()) * PITCH.r;
  e.d.wx = PITCH.x + Math.cos(a) * r;
  e.d.wz = PITCH.z + Math.sin(a) * r;
}

function catchSnitch(w: World, e: ActiveEvent, x: Wizard) {
  const cup = w.cupOf(x);
  const room = Math.max(0, SNITCH_CAP_PER_TERM - (cup.snitch ?? 0));
  const g = w.cupGain(x, Math.min(SNITCH_POINTS, room), 'events');
  cup.snitch = (cup.snitch ?? 0) + Math.min(SNITCH_POINTS, room);
  x.galleons += 20;
  e.d.hero = x.name;
  e.d.acc = g;
  w.fx({ k: 'levelup', x: x.pos.x, z: x.pos.z, h: x.handle });
  w.emit('wheel', g ? `✨ You caught the Golden Snitch: +${g} house points for ${x.house}, and 20 Galleons.` : '✨ You caught the Golden Snitch again this term: 20 Galleons (the house points count once a term).', {
    to: x.id, zh: g ? `✨ 你抓住了金色飞贼：${zhHouse(x.house)} +${g} 学院分，外加 20 加隆。` : '✨ 这学期你又抓住了一次金色飞贼：20 加隆（学院分每学期只算一次）。',
  });
  rollCard(w, x, 'rare', { zh: '金色飞贼', en: 'The Golden Snitch' });
  settle(w, e, 'won');
}

/** Filch's round as a closed walk (A* between the waypoints), with the running length at each point. */
function curfewRoute(w: World): { route: Vec2[]; legs: number[] } {
  const route: Vec2[] = [{ ...CURFEW_WAYPOINTS[0] }];
  for (let i = 0; i < CURFEW_WAYPOINTS.length; i++) {
    const from = route[route.length - 1], to = CURFEW_WAYPOINTS[(i + 1) % CURFEW_WAYPOINTS.length];
    const path = findPath(from, to, w.solids) ?? [to];
    for (const p of path) route.push({ x: p.x, z: p.z });
  }
  const legs = [0];
  for (let i = 1; i < route.length; i++) legs.push(legs[i - 1] + dist(route[i - 1], route[i]));
  return { route, legs };
}

function placeOnRoute(e: ActiveEvent, p: { s: number; x: number; z: number; f: number }) {
  const { route, legs } = e.d;
  let i = 1;
  while (i < legs!.length - 1 && legs![i] < p.s) i++;
  const a = route![i - 1], b = route![i], len = legs![i] - legs![i - 1] || 1;
  const t = Math.max(0, Math.min(1, (p.s - legs![i - 1]) / len));
  p.x = a.x + (b.x - a.x) * t;
  p.z = a.z + (b.z - a.z) * t;
  if (Math.hypot(b.x - a.x, b.z - a.z) > 1e-6) p.f = Math.atan2(b.x - a.x, -(b.z - a.z));
}

/** Filch sees in a cone (his lantern), Mrs Norris all round but close; neither sees through walls or pillars. */
export function seesWizard(w: World, p: { k: 'filch' | 'norris'; x: number; z: number; f: number }, x: Wizard): boolean {
  const dx = x.pos.x - p.x, dz = x.pos.z - p.z, d = Math.hypot(dx, dz);
  if (p.k === 'filch') {
    if (d > FILCH.range) return false;
    const ang = Math.atan2(dx, -dz), off = Math.abs(Math.atan2(Math.sin(ang - p.f), Math.cos(ang - p.f)));
    if (d > 1.2 && off > FILCH.halfAngle) return false;
  } else if (d > NORRIS.range) return false;
  // the Marauder's Map shows you their footsteps: Mrs Norris cannot sneak up on you
  if (p.k === 'norris' && x.marauderUntil > w.now) return false;
  return !w.solids.hitSegment(p.x, p.z, x.pos.x, x.pos.z, 1.5);
}

function caughtAfterCurfew(w: World, e: ActiveEvent, x: Wizard, by: 'filch' | 'norris') {
  const d = e.d;
  d.grace![x.id] = w.now + CURFEW_GRACE_S;
  if (!d.caught!.includes(x.id)) d.caught!.push(x.id);
  const lost = w.cupLose(x, CURFEW_PENALTY);
  const l = fill(CURFEW_CAUGHT[lost <= 0 ? 2 : by === 'norris' ? 1 : 0], { house: houseL(x.house), n: lost });
  w.emit('wheel', l.en, { to: x.id, zh: l.zh });
}

// ------------------------------------------------------------------ what the HUD and agents see

/** The snapshot's `ev`: the running event (or the last result for a few seconds), or when the next one comes. */
export function wheelView(w: World) {
  const e = w.wheel.active;
  if (e && e.outcome === 'on') {
    const def = EVENTS[e.id];
    const v: Record<string, unknown> = { id: e.id, n: e.n, left: Math.max(0, Math.ceil(e.endsAt - w.now)), st: e.outcome, x: rnd(e.x), z: rnd(e.z) };
    if (e.id === 'troll') {
      const c = e.d.mobs?.[0] ? w.creatures.get(e.d.mobs[0]) : undefined;
      v.hp = Math.max(0, Math.round(c?.hp ?? 0)); v.m = Math.round(e.d.maxHp ?? 1);
    }
    if (e.id === 'snitch') v.s = { x: rnd(e.d.sx!), z: rnd(e.d.sz!) };
    if (e.id === 'curfew') { v.p = e.d.patrol!.map((p) => ({ k: p.k, x: rnd(p.x), z: rnd(p.z), f: rnd(p.f) })); v.day = e.d.day || undefined; }
    if (e.id === 'dementors') v.left2 = (e.d.mobs ?? []).filter((id) => w.creatures.has(id)).length;
    if (e.id === 'peeves') { v.r = e.d.r; v.px = rnd(e.d.px!); v.pz = rnd(e.d.pz!); }
    if (e.id === 'room') v.left2 = 3 - (e.d.claimed?.length ?? 0);
    void def;
    return v;
  }
  const r = w.wheelResult;
  if (r && w.now < r.until) return { id: r.id, n: r.n, st: r.outcome, hero: r.hero };
  if (!w.rules.events.enabled) return null;
  return { nx: Math.max(0, Math.ceil(w.wheel.nextAt - w.now)) };
}

/** MCP school_events and the browser's objective slip: the event as words. */
export function describeEvent(w: World, e: ActiveEvent | null) {
  if (!e) return null;
  const def = EVENTS[e.id];
  const b = def.brief(w, e);
  return { id: e.id, name: def.name.en, nameZh: def.name.zh, objective: b.en, objectiveZh: b.zh, secondsLeft: Math.max(0, Math.ceil(e.endsAt - w.now)), where: { x: rnd(e.x), z: rnd(e.z) }, major: def.major };
}

const rnd = (n: number) => Math.round(n * 10) / 10;
export const EVENT_NAMES: Record<EventId, Line> = Object.fromEntries(EVENT_IDS.map((id) => [id, EVENTS[id].name])) as Record<EventId, Line>;
export const isMajor = (id: EventId) => EVENTS[id].major;

/** MCP school_events: the term as a match, the event on now, the last few, when the next comes, the chests. */
export function schoolEvents(w: World, wid: string) {
  const me = w.need(wid);
  const cup = w.cupView();
  const e = w.wheel.active && w.wheel.active.outcome === 'on' ? w.wheel.active : null;
  const lb = w.leaderboard();
  return {
    term: { n: cup.n, secondsLeft: cup.left, finalMinute: cup.fm > 0, finalMinuteMultiplier: w.rules.terms.finalMinuteMultiplier, finalMinuteRule: 'The last 60 seconds of a term multiply every house point gained (决胜时刻).' },
    housePoints: lb.housePoints, sources: lb.housePointSources,
    you: { house: me.house, ...w.funState(me), capRule: `One wizard adds at most ${w.rules.terms.wizardPointsCap} house points a term, from every source together, and never goes below zero.` },
    event: describeEvent(w, e),
    next: e ? null : w.rules.events.enabled ? { inSeconds: Math.max(0, Math.ceil(w.wheel.nextAt - w.now)), pool: w.rules.events.pool } : 'the event wheel is off by decree',
    recent: w.wheel.history.slice(-5).map((h) => ({ ...h, name: EVENT_NAMES[h.id].en, nameZh: EVENT_NAMES[h.id].zh })),
    chests: { closed: cup.ch.length, total: CHESTS.length, howTo: 'Hidden chests refill every term; stand next to one and call open_chest (in the browser: F). 隐藏宝箱每学期刷新；走到旁边调用 open_chest（浏览器里按 F）。' },
    lastCup: w.houseCups.at(-1) ?? null,
    ceremony: w.ceremony && w.now < w.ceremony.until ? w.ceremony : null,
    rules: w.rules.events,
  };
}
