/**
 * 遭遇 (a Feature; the table is src/shared/encounters.ts): each scene's toy, its goal, and the three doors when you
 * reach it.
 *
 * What counts: a creature of the goal's kind downed inside the encounter's circle, credited to whoever hit it last
 * there (the `hit` hook writes it down: the creature may be gone before the sweep looks); a prop of the goal's kind
 * broken inside it, credited to whoever broke it (kernel/props.ts `who`, a whole chain to the one who lit it). With
 * `within`, only what you did in the last that many seconds counts (Zonko's: one chain). Reaching `need` clears the
 * encounter for you this term and opens three doors (fewer once every rune is at RUNE_MAX): the encounter's own rune
 * (new, or a level on it), another rune (new ones first), and a purse; pick one — the browser's card
 * (client/panels/encounters.ts) or MCP `encounters {pick}`. Once per encounter per wizard per term (docs/RULES.md).
 */
import { z } from 'zod';
import { doorText, ENCOUNTERS, encounterAt, encounterById, PURSE_GALLEONS, PURSE_XP, STUDY_XP, type Door, type EncounterDef, type EncounterId } from '../shared/encounters.js';
import { PROPS } from '../shared/props.js';
import { RUNE_IDS, RUNE_MAX, type RuneId } from '../shared/runes.js';
import type { Feature } from './feature.js';
import { grantRune, raiseRune, runeLevel } from './runes.js';
import type { World } from './world.js';

declare module './world.js' {
  interface World {
    /** 遭遇 (this module's Feature). */
    enc: {
      term: number;
      /** This term: progress per `wizard|encounter`, and the encounters each wizard has cleared. */
      n: Map<string, number>; done: Map<string, Set<EncounterId>>;
      /** For a `within` goal: when each counted thing happened, per `wizard|encounter`. */
      recent: Map<string, number[]>;
      /** Goal creatures hit inside an encounter: who hit each last, and where. */
      alive: Map<string, { by: string; enc: EncounterId }>;
      /** Broken goal props already counted (until they come back). */
      counted: Set<string>;
      /** Doors waiting for a pick, per wizard, oldest first. */
      doors: Map<string, { enc: EncounterId; doors: Door[] }[]>;
    };
  }
}

const key = (wid: string, e: EncounterId) => `${wid}|${e}`;
const inside = (e: EncounterDef, x: number, z: number) => Math.hypot(x - e.x, z - e.z) <= e.r;
/** Each break goal's props (those of its kind inside its circle). */
const GOAL_PROPS = new Map(ENCOUNTERS.filter((e) => e.goal.t === 'break').map((e) => [e.id, PROPS.filter((p) => p.kind === (e.goal as { kind: string }).kind && inside(e, p.x, p.z))]));

function newTerm(world: World) {
  const s = world.enc;
  if (s.term === world.term.n) return;
  s.term = world.term.n; s.n.clear(); s.done.clear(); s.recent.clear();
}

/** The doors for `wid` clearing `e`: its rune, another rune (new ones first), then the purse (and study, to make three). */
export function doorsFor(world: World, wid: string, e: EncounterDef): Door[] {
  const out: Door[] = [];
  const offer = (k: RuneId) => { const lv = runeLevel(world, wid, k); if (!lv) out.push({ t: 'rune', rune: k }); else if (lv < RUNE_MAX) out.push({ t: 'level', rune: k, to: lv + 1 }); };
  offer(e.rune);
  const others = RUNE_IDS.filter((k) => k !== e.rune).sort((a, b) => runeLevel(world, wid, a) - runeLevel(world, wid, b));
  for (const k of others) if (out.length < 2) offer(k);
  out.push({ t: 'purse' });
  if (out.length < 3) out.push({ t: 'study' });
  return out;
}

/** One more for `wid` on `e` (at time `at`); clears it at `need`. */
function credit(world: World, wid: string, e: EncounterDef, at: number) {
  const w = world.wizards.get(wid);
  if (!w || w.npc) return;
  newTerm(world);
  const s = world.enc;
  if (s.done.get(wid)?.has(e.id)) return;
  const k = key(wid, e.id);
  let n: number;
  if (e.within) {
    const ts = (s.recent.get(k) ?? []).filter((t) => t >= at - e.within!);
    ts.push(at);
    s.recent.set(k, ts);
    n = ts.length;
  } else n = (s.n.get(k) ?? 0) + 1;
  s.n.set(k, n);
  if (n < e.need) return;
  (s.done.get(wid) ?? s.done.set(wid, new Set()).get(wid)!).add(e.id);
  s.recent.delete(k);
  const doors = doorsFor(world, wid, e);
  (s.doors.get(wid) ?? s.doors.set(wid, []).get(wid)!).push({ enc: e.id, doors });
  world.fx({ k: 'nova', x: e.x, z: e.z, r: 4, e: 'light' });
  world.emit('achievement', `✨ ${e.en}: done! Pick one of ${doors.length} rewards.`, { to: wid, zh: `✨ ${e.zh}：完成！从 ${doors.length} 份奖励里挑一份。` });
}

/** `wid` takes door `i` of the oldest choice waiting. */
export function pickDoor(world: World, wid: string, i: number) {
  const w = world.need(wid);
  const q = world.enc.doors.get(wid);
  const c = q?.[0];
  if (!c) throw new Error('No rewards waiting: clear an encounter first. 没有待选的奖励：先完成一个遭遇。');
  const d = c.doors[i];
  if (!d) throw new Error(`Pick 0–${c.doors.length - 1}. 请选 0–${c.doors.length - 1}。`);
  q!.shift();
  if (!q!.length) world.enc.doors.delete(wid);
  if (d.t === 'rune') grantRune(world, wid, d.rune);
  else if (d.t === 'level') raiseRune(world, wid, d.rune);
  else {
    if (d.t === 'purse') w.galleons += PURSE_GALLEONS;
    world.gainXp(w, d.t === 'purse' ? PURSE_XP : STUDY_XP);
    const t = doorText(d);
    world.emit('achievement', `✨ ${t.en}.`, { to: wid, zh: `✨ ${t.zh}。` });
  }
  return { ok: true, took: d, text: doorText(d) };
}

function status(world: World, wid: string) {
  newTerm(world);
  const s = world.enc, w = world.need(wid);
  return {
    encounters: ENCOUNTERS.map((e) => ({
      id: e.id, scene: e.scene, zh: e.zh, en: e.en, at: { x: e.x, z: e.z, r: e.r }, goal: `${e.goalZh} / ${e.goalEn}`, tip: `${e.tipZh} / ${e.tipEn}`,
      progress: s.done.get(wid)?.has(e.id) ? e.need : s.n.get(key(wid, e.id)) ?? 0, need: e.need, doneThisTerm: !!s.done.get(wid)?.has(e.id),
      ...(inside(e, w.pos.x, w.pos.z) ? { here: true } : {}),
    })),
    waiting: (s.doors.get(wid) ?? []).map((c) => ({ encounter: c.enc, doors: c.doors.map((d, i) => ({ pick: i, ...d, ...doorText(d) })) })),
  };
}

export const ENCOUNTERS_FEATURE: Feature = {
  id: 'encounters',
  init(world) { world.enc = { term: world.term.n, n: new Map(), done: new Map(), recent: new Map(), alive: new Map(), counted: new Set(), doors: new Map() }; },
  // a goal creature hit inside its encounter: who hit it last there
  hit(world, by, _src, dstId, _tags, dmg) {
    if (!dmg || !by || !world.wizards.has(by)) return 1;
    const c = world.creatures.get(dstId);
    if (!c) return 1;
    for (const e of ENCOUNTERS) if (e.goal.t === 'down' && e.goal.kind === c.kind && inside(e, c.pos.x, c.pos.z)) world.enc.alive.set(dstId, { by, enc: e.id });
    return 1;
  },
  sweep(world) {
    const s = world.enc;
    // the creatures downed since last second
    for (const [id, a] of [...s.alive]) {
      const c = world.creatures.get(id);
      if (c && c.hp > 0) continue;
      s.alive.delete(id);
      credit(world, a.by, encounterById(a.enc)!, world.now);
    }
    // the props broken since last second (a chain: each to the one who lit it, at the time it went)
    const props = world.props;
    for (const [eid, ps] of GOAL_PROPS) {
      const e = encounterById(eid)!;
      for (const p of ps) {
        const who = props?.who.get(p.id);
        if (!who) { s.counted.delete(p.id); continue; }
        if (s.counted.has(p.id)) continue;
        s.counted.add(p.id);
        credit(world, who.by, e, who.at);
      }
    }
  },
  // the browser: the encounter you are in (and how far along), and the doors waiting
  view: {
    key: 'enc',
    me(world, w) {
      const s = world.enc, e = encounterAt(w.pos.x, w.pos.z), q = s.doors.get(w.id)?.[0];
      if (!e && !q) return null;
      return {
        ...(e ? { here: { id: e.id, n: s.term === world.term.n ? s.n.get(key(w.id, e.id)) ?? 0 : 0, need: e.need, done: s.term === world.term.n && !!s.done.get(w.id)?.has(e.id) } } : {}),
        ...(q ? { doors: { enc: q.enc, doors: q.doors } } : {}),
      };
    },
    // MCP look: the encounter you stand in
    here(world, w) {
      const e = encounterAt(w.pos.x, w.pos.z);
      if (!e) return undefined;
      const s = world.enc, done = s.term === world.term.n && !!s.done.get(w.id)?.has(e.id);
      return { id: e.id, zh: e.zh, goal: `${e.goalZh} / ${e.goalEn}`, tip: `${e.tipZh} / ${e.tipEn}`, progress: done ? e.need : s.term === world.term.n ? s.n.get(key(w.id, e.id)) ?? 0 : 0, need: e.need, doneThisTerm: done };
    },
  },
  tools: [{
    name: 'encounters', title: 'Encounters', cost: 0,
    description: '遭遇: each scene has one — the greenhouse (Devil’s Snare, always wet), the acromantula nest in the forest (webs that burn in clusters), Zonko’s yard in Hogsmeade (a row of whizbangs). Lists each one’s goal, tip, where it is and your progress this term; clearing one opens doors (a new rune, a level on one, a purse): take one with {pick: n}. Once per encounter per term.',
    input: { pick: z.number().int().min(0).max(5).optional() },
    run(world, wid, a) { return typeof a.pick === 'number' ? pickDoor(world, wid, a.pick) : status(world, wid); },
  }],
  // the browser: {t:'encounters', pick}
  ws(world, wid, m) { return typeof m.pick === 'number' ? pickDoor(world, wid, m.pick) : status(world, wid); },
  save(world) {
    const s = world.enc;
    return { term: s.term, n: Object.fromEntries(s.n), done: Object.fromEntries([...s.done].map(([k, v]) => [k, [...v]])), doors: Object.fromEntries(s.doors) };
  },
  load(world, data) {
    const d = data as { term?: number; n?: Record<string, number>; done?: Record<string, string[]>; doors?: Record<string, { enc: string; doors: Door[] }[]> } | undefined;
    if (!d || typeof d !== 'object') return;
    const s = world.enc;
    if (typeof d.term === 'number') s.term = d.term;
    for (const [k, v] of Object.entries(d.n ?? {})) if (typeof v === 'number') s.n.set(k, v);
    for (const [k, v] of Object.entries(d.done ?? {})) if (Array.isArray(v)) s.done.set(k, new Set(v.filter((x): x is EncounterId => !!encounterById(String(x)))));
    const okDoor = (x: Door) => x && (x.t === 'purse' || x.t === 'study' || ((x.t === 'rune' || x.t === 'level') && (RUNE_IDS as string[]).includes(x.rune)));
    for (const [k, v] of Object.entries(d.doors ?? {})) if (Array.isArray(v)) {
      const q = v.filter((c) => c && encounterById(c.enc) && Array.isArray(c.doors) && c.doors.every(okDoor)).map((c) => ({ enc: c.enc as EncounterId, doors: c.doors }));
      if (q.length) s.doors.set(k, q);
    }
  },
};
