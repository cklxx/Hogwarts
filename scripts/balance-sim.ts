/**
 * Balance simulation (docs/PLAYTEST.md): scripted wizards grind creatures in the real kernel for a stretch of world
 * time, and we count what a minute of it is worth — XP, reputation, damage taken, times knocked out — next to what
 * a minute of O.W.L. exams pays. No server, no network: World.tick() at 20 Hz, as fast as the CPU goes.
 *
 *   npx tsx scripts/balance-sim.ts [--minutes=10] [--year=1] [--seed=5]
 *
 * Styles: "turret" (stands and casts at whatever is in range — the playtest's shell loop), "kiter" (strafes
 * sideways between casts, so aimed shots miss), "brawler" (walks up close). Spots: the pixie lawn, the Devil's
 * Snare by the greenhouses, the Forbidden Forest (acromantulas), the troll's corner.
 */
import { World, TICK } from '../src/kernel/world.js';
import { GRADE_MULT, rewardBase } from '../src/kernel/exams.js';
import { XP_FOR_YEAR } from '../src/kernel/progression.js';
import type { Wizard } from '../src/kernel/types.js';

const arg = (k: string, d: number) => Number(process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d);
const MINUTES = arg('minutes', 10), YEAR = arg('year', 1), SEED = arg('seed', 5);
const SPOTS: Record<string, { x: number; z: number }> = { pixies: { x: 12, z: 10 }, snare: { x: 41, z: -24 }, forest: { x: 150, z: 20 }, troll: { x: -50, z: -36 } };
const STYLES = ['turret', 'kiter', 'brawler'] as const;
/** The playtest's Herbicide idea: pick the element the target is weak to (ice for pixies, fire for the rest). */
const BOLT = '(bolt target 12 (if (= (kind target) "pixie") :ice :fire))';

function run(spot: string, style: (typeof STYLES)[number]) {
  const w = new World({ seed: SEED, secret: 'balance' });
  const me: Wizard = w.enroll(`Sim ${style}`).wizard;
  me.connections = 1;
  me.year = YEAR;
  me.pos = { ...SPOTS[spot] };
  me.xp = XP_FOR_YEAR[YEAR] ?? 0;
  const xp0 = me.xp, rep0 = me.reputation;
  let spell = w.forgeSpell(me.id, { name: 'Grind', source: BOLT, quiet: true }).spell;
  if (!spell) spell = w.forgeSpell(me.id, { name: 'Grind', source: '(bolt target 8)', quiet: true }).spell;
  let hpLost = 0, knockouts = 0, casts = 0, t = 0, side = 1, lastHp = me.hp;
  const ticks = Math.round((MINUTES * 60) / TICK);
  for (let i = 0; i < ticks; i++) {
    t += TICK;
    const down = me.st.stunnedUntil > 0;
    if (!down && i % 10 === 0) {
      const foes = w.around(me.pos, style === 'brawler' ? 40 : 30, (e) => e.kind === 'creature' && w.canHarm(me.id, e.id), me.id, 1);
      const f = foes[0];
      if (f) {
        const d = Math.hypot(f.pos.x - me.pos.x, f.pos.z - me.pos.z);
        if (style === 'brawler' && d > 6) w.setGoal(me.id, f.pos);
        const r = w.cast(me.id, spell.id, { target: f.id });
        if (r.ok) casts++;
      } else if (Math.hypot(me.pos.x - SPOTS[spot].x, me.pos.z - SPOTS[spot].z) > 8) w.setGoal(me.id, SPOTS[spot]);
    }
    if (style === 'kiter' && !down) { if (i % 30 === 0) side = -side; w.setInput(me.id, side, 0); }
    w.tick();
    if (me.hp < lastHp) hpLost += lastHp - me.hp;
    if (!down && me.st.stunnedUntil > 0) { knockouts++; me.pos = { ...SPOTS[spot] }; }
    lastHp = me.hp;
  }
  const per = (n: number) => (n / MINUTES).toFixed(1);
  return { spot, style, xpMin: per(me.xp - xp0), repMin: per(me.reputation - rep0), hpLostMin: per(hpLost), knockouts, castsMin: per(casts) };
}

const rows = [];
for (const spot of Object.keys(SPOTS)) for (const style of STYLES) rows.push(run(spot, style));
console.table(rows);
// the exams a wizard of this year may sit (years 1 … YEAR), each an O at ~2 minutes (the playtests), first pass only
const exams = Array.from({ length: YEAR }, (_, i) => (rewardBase(i + 1).xp * GRADE_MULT.O) / 2);
const examMin = exams.reduce((a, b) => a + b, 0) / exams.length;
// a typical hunter: the lower-risk styles (turret and kiter) on the pixie lawn, the snare and the forest; the troll is the gamble
const typical = rows.filter((r) => r.spot !== 'troll' && r.style !== 'brawler').map((r) => Number(r.xpMin));
const huntMin = typical.reduce((a, b) => a + b, 0) / typical.length;
console.log(`O.W.L. exams for a year-${YEAR}: an O pays ${exams.map((x) => x * 2).join(' / ')} XP (exam years 1…${YEAR}); at ~2 min each ${examMin.toFixed(1)} XP/min while this week's first passes last, then nothing until next week.`);
console.log(`Typical hunting (turret + kiter, pixies / snare / forest): ${huntMin.toFixed(1)} XP/min. Hunting ÷ exams = ${(huntMin / examMin).toFixed(2)} (target 0.7–1.3).`);
