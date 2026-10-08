/**
 * 飞路网 and brooms (a Feature): getting about a big map.
 *
 * - Floo: stand at a fireplace (FIREPLACES, src/shared/travel.ts) and name another: a puff of green flame and you
 *   step out there. Not while stunned, rooted, in Azkaban, duelling, playing Quidditch, or within FLOO_HURT_S of
 *   being hurt (a fight is not escaped by the fire); FLOO_CD_S between journeys.
 * - Broom: mount (MCP `broom`, M in the browser) outside the castle to fly BROOM_MULT × faster. Casting, being hurt,
 *   flying into the castle (CASTLE), a duel or a Quidditch match puts you back on your feet.
 * Neither is saved: after a restart everyone is on foot and every fire is lit.
 */
import { z } from 'zod';
import { BROOM_HURT_S, BROOM_MOUNT_CD_S, BROOM_MULT, BROOM_STAMINA_DRAIN_S, BROOM_STAMINA_MAX, BROOM_STAMINA_REGEN_S, BROOM_STAMINA_WEAK_S, FIREPLACES, FLOO_CD_S, FLOO_HURT_S, FLOO_R, fireplaceNear } from '../shared/travel.js';
import { inMatch } from './duelclub.js';
import type { Feature } from './feature.js';
import { qdOnTeam } from './quidditch.js';
import type { Wizard } from './types.js';
import { CASTLE, inCastle } from './wheel.js';
import type { World } from './world.js';

declare module './world.js' {
  interface World {
    /** 飞路网 / 扫帚 (this module's Feature): who rides since when, when each last travelled by fire. */
    travel: {
      riding: Map<string, number>; flooAt: Map<string, number>; mountAt: Map<string, number>;
      /** 扫帚耐力 (M2): wizard id → 当前耐力，缺省 BROOM_STAMINA_MAX. */
      stamina: Map<string, number>;
      /** 扫帚虚弱 (M2): wizard id → 虚弱结束的 world.now，期间 broom() 拒绝上马. */
      weakUntil: Map<string, number>;
    };
  }
}

/** Why this wizard cannot travel right now (bilingual), or null. */
function busy(world: World, w: Wizard, hurtS: number): string | null {
  if (!world.isActive(w) || w.st.jailedUntil > 0) return 'Not while you are stunned or in Azkaban. 被击晕或在阿兹卡班时不行。';
  if (w.st.rootedUntil > world.now) return 'Your feet are bound. 你的脚被缚住了。';
  if (inMatch(world.duel, w.id)) return 'Not in the middle of a duel. 决斗中不行。';
  if (qdOnTeam(world, w.id)) return 'You are on a Quidditch team: the match has its own brooms. 你在魁地奇队里：比赛有自己的扫帚。';
  if (world.now - w.hurtAt < hurtS) return `You were hurt a moment ago: catch your breath first (${Math.ceil(hurtS - (world.now - w.hurtAt))} s). 你刚受了伤：先喘口气（${Math.ceil(hurtS - (world.now - w.hurtAt))} 秒）。`;
  return null;
}

export function flooStatus(world: World, wid: string) {
  const w = world.need(wid);
  const here = fireplaceNear(w.pos);
  const ready = Math.max(0, Math.ceil((world.travel.flooAt.get(wid) ?? -1e9) + FLOO_CD_S - world.now));
  return {
    here: here?.id ?? null, readyIn: ready,
    fireplaces: FIREPLACES.map((f) => ({ id: f.id, name: f.en, zh: f.zh, x: f.x, z: f.z, dist: Math.round(Math.hypot(f.x - w.pos.x, f.z - w.pos.z)) })),
    howTo: `Walk within ${FLOO_R} m of a fireplace, then floo with to = another fireplace's id.`,
  };
}

export function floo(world: World, wid: string, to: string) {
  const w = world.need(wid);
  const from = fireplaceNear(w.pos);
  if (!from) throw new Error(`You are not at a fireplace (stand within ${FLOO_R} m of one: see floo with no destination). 你不在壁炉旁（走到壁炉 ${FLOO_R} 米内）。`);
  const dest = FIREPLACES.find((f) => f.id === to);
  if (!dest) throw new Error(`No fireplace called "${to}". Try one of: ${FIREPLACES.map((f) => f.id).join(', ')}. 没有这个壁炉。`);
  if (dest.id === from.id) throw new Error('You are already here. 你已经在这里了。');
  const why = busy(world, w, FLOO_HURT_S);
  if (why) throw new Error(why);
  const left = (world.travel.flooAt.get(wid) ?? -1e9) + FLOO_CD_S - world.now;
  if (left > 0) throw new Error(`The Floo powder has not settled: ${Math.ceil(left)} s. 飞路粉还没落定：${Math.ceil(left)} 秒。`);
  world.travel.flooAt.set(wid, world.now);
  dismount(world, w);
  world.fx({ k: 'apparate', x: w.pos.x, z: w.pos.z, h: w.handle });
  w.pos = { x: dest.x, z: dest.z };
  world.solids.resolve(w.pos, 0.5, true);
  world.stopWalk(w); // clears goal/route and the cross-scene continuation (via), like main
  world.moved(w);
  world.fx({ k: 'apparate', x: w.pos.x, z: w.pos.z, h: w.handle });
  world.emit('system', `Green flames roar: you step out at ${dest.en}.`, { to: wid, zh: `绿色火焰一闪：你从${dest.zh}的壁炉里走了出来。` });
  return { from: from.id, to: dest.id, pos: { x: Math.round(w.pos.x * 10) / 10, z: Math.round(w.pos.z * 10) / 10 } };
}

function dismount(world: World, w: Wizard) { world.travel.riding.delete(w.id); }

export function broom(world: World, wid: string, on?: boolean) {
  const w = world.need(wid);
  const riding = world.travel.riding.has(wid);
  const want = on ?? !riding;
  if (!want) { dismount(world, w); return { riding: false }; }
  if (riding) return { riding: true };
  // M2: 虚弱期内拒绝上马（耐力耗尽后的 BROOM_STAMINA_WEAK_S 秒）
  const weakLeft = (world.travel.weakUntil.get(wid) ?? -1e9) - world.now;
  if (weakLeft > 0) throw new Error(`The broom needs a rest (${Math.ceil(weakLeft)} s). 扫帚需要休息 ${Math.ceil(weakLeft)} 秒。`);
  // the precinct, not only the roofed halls: the courtyard counts (playtest round 4 read "indoors" while onGrounds was true)
  if (inCastle(w.pos)) {
    // Point the player at the nearest exit instead of raw coordinates.
    const dxOut = CASTLE.x1 - Math.abs(w.pos.x); // distance to east/west edge
    const dzOut = CASTLE.z1 - w.pos.z; // z1 is the south edge; inside means z <= z1, so distance out is z1 - z
    let hint: { zh: string; en: string };
    if (dzOut <= dxOut) {
      hint = { zh: `往南走约 ${Math.ceil(dzOut)} 米出城堡`, en: `walk south ~${Math.ceil(dzOut)} m to leave the precinct` };
    } else {
      const dir = w.pos.x >= 0 ? { zh: '东', en: 'east' } : { zh: '西', en: 'west' };
      hint = { zh: `往${dir.zh}走约 ${Math.ceil(dxOut)} 米出城堡`, en: `walk ${dir.en} ~${Math.ceil(dxOut)} m to leave the precinct` };
    }
    throw new Error(`No brooms inside the castle precinct (the courtyard counts) — ${hint.en}. 城堡范围内（含庭院）不能骑扫帚：${hint.zh}。`);
  }
  const why = busy(world, w, BROOM_HURT_S);
  if (why) throw new Error(why);
  const left = (world.travel.mountAt.get(wid) ?? -1e9) + BROOM_MOUNT_CD_S - world.now;
  if (left > 0) throw new Error(`Steady: ${Math.ceil(left)} s. 稳一稳：${Math.ceil(left)} 秒。`);
  world.travel.mountAt.set(wid, world.now);
  world.travel.riding.set(wid, world.now);
  return { riding: true, speed: BROOM_MULT };
}

/** 20 Hz: back on your feet when hurt, indoors, stunned, jailed, duelling or on a Quidditch team. M2: riding drains stamina (forced dismount + weak window at 0); on foot it regenerates. */
function step(world: World, dt: number) {
  const t = world.travel;
  // M2: 耐力恢复先行——本 tick 内因耗尽/受伤而落地的，本 tick 不再回（落地状态下个 tick 起算）
  for (const [id, st] of t.stamina) {
    if (!t.riding.has(id) && st < BROOM_STAMINA_MAX) t.stamina.set(id, Math.min(BROOM_STAMINA_MAX, st + BROOM_STAMINA_REGEN_S * dt));
  }
  // 现有行为原样：受伤/进城堡/被击晕等的强制下马
  const r = t.riding;
  if (r.size) {
    for (const [id, since] of r) {
      const w = world.wizards.get(id);
      if (!w || w.hurtAt > since || inCastle(w.pos) || !world.isActive(w) || w.st.jailedUntil > 0 || inMatch(world.duel, id) || qdOnTeam(world, id)) r.delete(id);
    }
  }
  // M2: 耐力消耗。riding 的按 DRAIN_S 扣；耗尽则强制降落 + 虚弱期 + 清零
  for (const id of t.riding.keys()) {
    const ns = (t.stamina.get(id) ?? BROOM_STAMINA_MAX) - BROOM_STAMINA_DRAIN_S * dt;
    if (ns <= 0) {
      t.stamina.set(id, 0);
      t.weakUntil.set(id, world.now + BROOM_STAMINA_WEAK_S);
      const w = world.wizards.get(id);
      if (w) dismount(world, w); else t.riding.delete(id);
    } else {
      t.stamina.set(id, ns);
    }
  }
}

function run(world: World, wid: string, a: Record<string, unknown>) {
  if (a.op === 'broom') return broom(world, wid, typeof a.on === 'boolean' ? a.on : undefined);
  return typeof a.to === 'string' && a.to ? floo(world, wid, a.to) : flooStatus(world, wid);
}

/** M2: 耐力 wire 的 getter。契约要求快照顶层 key `trst`；一个 Feature 只能注册一个 wire key，
 * 接通快照需在 features.ts 另注册一个 Feature（见 CONTRACT.md），此处先实现并导出 getter 供 M3/M4 直接用。 */
/** 主理人裁定：快照 wire `trst` 的 Feature 注册。一个 Feature 只能注册一个 wire key（feature.ts），
 * 故 stamina wire 独立成 Feature，随 TRAVEL_FEATURE 注册。 */
export const TRAVEL_STAMINA_WIRE = {
  key: 'trst',
  get: (world: World): Record<string, number> | undefined => {
    const out: Record<string, number> = {};
    for (const [id, st] of world.travel.stamina) {
      if (st >= BROOM_STAMINA_MAX) continue;
      const h = world.wizards.get(id)?.handle;
      if (h) out[h] = Math.round(st);
    }
    return Object.keys(out).length ? out : undefined;
  },
};
/** 主理人裁定：`trst` 入快照。一个 Feature 只能注册一个 wire key，故 stamina wire 独立成 Feature。 */
export const TRAVEL_STAMINA_FEATURE: Feature = { id: 'travel-stamina', wire: TRAVEL_STAMINA_WIRE };

export const TRAVEL_FEATURE: Feature = {
  id: 'travel',
  init(world) { world.travel = { riding: new Map(), flooAt: new Map(), mountAt: new Map(), stamina: new Map(), weakUntil: new Map() }; },
  step,
  wire: { key: 'tr', get: (world) => (world.travel.riding.size ? [...world.travel.riding.keys()].map((id) => world.wizards.get(id)?.handle ?? '') : undefined) },
  moveMult: (world, w) => (world.travel.riding.has(w.id) ? BROOM_MULT : 1),
  // casting puts you back on your feet (and goes ahead)
  castBlock: (world, w) => { world.travel.riding.delete(w.id); return null; },
  tools: [
    {
      name: 'floo', title: 'Floo Network', cost: 1,
      description: `飞路网: fireplaces at ${FIREPLACES.map((f) => `${f.id} (${f.x}, ${f.z})`).join(', ')}. With no "to": the list, distances, and whether you stand at one. Standing within ${FLOO_R} m of one, to = another's id: you step out there. ${FLOO_CD_S} s between journeys; not while stunned, rooted, duelling, on a Quidditch team, or within ${FLOO_HURT_S} s of being hurt.`,
      input: { to: z.enum(FIREPLACES.map((f) => f.id) as [string, ...string[]]).optional() },
      run: (world, wid, a) => run(world, wid, { to: a.to }),
    },
    {
      name: 'broom', title: 'Broom', cost: 1,
      description: `Mount (on: true) or dismount (on: false) a broom (M in the browser); no "on" toggles. Outside the castle precinct (the courtyard counts as inside) you move ×${BROOM_MULT}. Casting, being hurt, entering the precinct, a duel or a Quidditch match puts you back on your feet.`,
      input: { on: z.boolean().optional() },
      run: (world, wid, a) => broom(world, wid, typeof a.on === 'boolean' ? a.on : undefined),
    },
  ],
  ws: run,
};
