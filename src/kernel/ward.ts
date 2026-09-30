/**
 * 触发式铁甲咒 (the ward): a perfect Protego for whoever cannot time one. An agent's MCP round trip (~0.85 s) is
 * longer than the PERFECT_PROTEGO_S window, so a Protego it casts on seeing `wait until:"incoming"` is always late.
 *
 * Arm the ward for up to WARD_MAX_S seconds: the first hostile bolt or Expelliarmus that reaches you is met by a
 * Protego raised that instant (the curriculum's, `(shield self 25 4)`) — it goes back where it came from, and the
 * shield stays up as a cast one would. Bounded so it never beats good timing:
 *  - WARD_MANA is paid when you arm it, like a Protego raised a moment too early (paying only when it fires would
 *    make an unused ward free: a standing insurance policy);
 *  - no other spell while it is up (you are holding the shield ready, not casting); `lower` drops it, mana not refunded;
 *  - one ward per WARD_CD_S whether it fired or not, so it parries at most one spell in that time, where a human
 *    with good timing can parry every bolt;
 *  - it only answers what a Protego answers: roots, blasts, claws and anything canHarm refuses pass it by (and a
 *    dodge roll still lets a bolt fly past without spending it).
 * The kernel mechanic is the same for everyone: MCP tool `ward`, browser key X ({t:'ward'}).
 */
import { z } from 'zod';
import type { Feature } from './feature.js';
import type { Projectile, Wizard } from './types.js';
import type { World } from './world.js';
import { WARD_CD_S, WARD_MANA, WARD_MAX_S } from '../shared/constants.js';

export { WARD_CD_S, WARD_MANA, WARD_MAX_S };
const WARD_SHIELD = 25, WARD_SHIELD_S = 4;

interface Ward { until: number; readyAt: number }
declare module './world.js' {
  interface World {
    /** Armed wards and their cooldowns, by wizard id (ward.ts). Seconds long: not persisted. */
    wards: Map<string, Ward>;
  }
}

const armed = (world: World, id: string) => { const x = world.wards.get(id); return !!x && x.until > world.now; };

/** Where your ward stands: up (seconds left), recharging, or ready. */
export function wardStatus(world: World, wid: string) {
  const x = world.wards.get(wid), r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    armed: x && x.until > world.now ? r1(x.until - world.now) : 0,
    readyIn: x && x.readyAt > world.now ? r1(x.readyAt - world.now) : 0,
    rules: { maxSeconds: WARD_MAX_S, cooldownSeconds: WARD_CD_S, mana: WARD_MANA, shield: `${WARD_SHIELD} for ${WARD_SHIELD_S}s` },
  };
}

/** Arm the ward for `secs` (clamped to 0.5 … WARD_MAX_S). `by` 'agent' yields to a steering human, as dodge does. */
export function armWard(world: World, wid: string, secs = WARD_MAX_S, by: 'player' | 'agent' = 'player') {
  const w = world.need(wid);
  const no = (zh: string, en: string, retry?: number) => { throw new Error(`${en} ${zh}${retry ? ` retry_after=${Math.max(1, Math.ceil(retry))}` : ''}`); };
  if (!world.isActive(w)) no('被击晕或在阿兹卡班时举不起盾。', 'You cannot raise a ward while stunned or in Azkaban.');
  if (w.st.disarmedUntil > world.now) no('你的魔杖被缴了。', 'You have been disarmed!');
  if (world.silenced(w)) no('你被噤声了，念不出咒语。', 'You are silenced.');
  if (by === 'agent' && world.playerSteering(w)) no('你的玩家正在操控，交给他们。', 'Your human is steering: leave it to them.');
  const x = world.wards.get(wid);
  if (x && x.until > world.now) no('铁甲咒已经举着了。', 'Your ward is already up.');
  if (x && x.readyAt > world.now) no(`铁甲咒还要 ${(x.readyAt - world.now).toFixed(1)} 秒才能再举。`, `Your ward is recharging: ${(x.readyAt - world.now).toFixed(1)}s.`, x.readyAt - world.now);
  if (w.mana < WARD_MANA) no(`法力不够：要 ${WARD_MANA}，你有 ${Math.floor(w.mana)}。`, `Not enough mana: the ward takes ${WARD_MANA}, you have ${Math.floor(w.mana)}.`);
  const s = Math.min(WARD_MAX_S, Math.max(0.5, Number.isFinite(secs) ? secs : WARD_MAX_S));
  w.mana -= WARD_MANA;
  world.wards.set(wid, { until: world.now + s, readyAt: world.now + WARD_CD_S });
  w.say = { text: '盔甲护身……', until: world.now + Math.min(s, 1.5) }; // an opponent sees it coming, as they would a Protego
  return { armed: s, mana: WARD_MANA, readyAgainIn: WARD_CD_S, note: 'No other spell until it fires, times out, or you lower it. 举盾期间不能施别的咒语。' };
}

export function lowerWard(world: World, wid: string) {
  const x = world.wards.get(wid);
  const was = !!x && x.until > world.now;
  if (x) x.until = 0;
  return { lowered: was, readyIn: wardStatus(world, wid).readyIn };
}

/** Feature.parry: an armed ward meets the spell with a Protego raised now (World.tryReflect then sends it back). */
function parry(world: World, w: Wizard, p: Projectile): boolean {
  const x = world.wards.get(w.id);
  if (!x || x.until <= world.now || !world.isActive(w)) return false;
  x.until = 0;
  world.shield(w, w, WARD_SHIELD, WARD_SHIELD_S);
  const from = world.entity(world.credit(p.owner) ?? p.owner);
  world.emit('combat', `Your ward met ${from?.name ?? 'a spell'}'s spell with a perfect Protego.`, { to: w.id, zh: `你的铁甲咒接住了${from?.name ?? '一道咒语'}的咒语：完美格挡。` });
  return true;
}

export const WARD_FEATURE: Feature = {
  id: 'ward',
  init(world) { world.wards = new Map(); },
  castBlock: (world, w) => (armed(world, w.id) ? 'Your ward is up: no other spell until it fires or you lower it (ward op:"lower"). 铁甲咒举着的时候不能施别的咒语（ward op:"lower" 放下）。' : null),
  parry,
  ws: (world, wid, m) => { try { return m.op === 'lower' ? lowerWard(world, wid) : { ...armWard(world, wid, typeof m.secs === 'number' ? m.secs : WARD_MAX_S) }; } catch (e) { return { error: (e as Error).message }; } },
  tools: [{
    name: 'ward', title: 'Ward (triggered Protego)', cost: 1,
    description: `触发式铁甲咒: a perfect Protego without the timing, for when a round trip is slower than the 0.35 s parry window. op "raise" (default) arms it for \`seconds\` (0.5–${WARD_MAX_S}, default ${WARD_MAX_S}): the first hostile bolt or Expelliarmus that reaches you meets a Protego raised that instant — sent back at its caster, and the shield (${WARD_SHIELD} for ${WARD_SHIELD_S}s) stays up. Costs ${WARD_MANA} mana when raised (fired or not); no other spell while it is up; one ward every ${WARD_CD_S}s. Roots, area blasts and claws pass it by; a dodge still works. "lower" drops it (no refund); "status" shows it. Pair it with wait until:"incoming" or raise it when you expect a bolt (a duel opponent's cooldown).`,
    input: {
      op: z.enum(['raise', 'lower', 'status']).optional(),
      seconds: z.number().min(0.5).max(WARD_MAX_S).optional(),
    },
    run: (world, wid, a) => (a.op === 'lower' ? lowerWard(world, wid) : a.op === 'status' ? wardStatus(world, wid) : { ...armWard(world, wid, typeof a.seconds === 'number' ? a.seconds : WARD_MAX_S, 'agent'), status: wardStatus(world, wid) }),
  }],
};
