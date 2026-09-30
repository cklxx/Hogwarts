/** 今日课表 (src/kernel/quests.ts): three goals a day, counted from the wizard's own counters, paid once, bounded. */
import { describe, expect, it } from 'vitest';
import { QUEST_DAY_MAX_XP, QUEST_DAY_S, QUEST_GALLEONS, QUEST_PER_DAY, pickQuests, questStatus } from '../src/kernel/quests.js';
import { World } from '../src/kernel/world.js';

function mk() {
  const w = new World({ seed: 5, secret: 'quests' });
  w.rules.creatures.spawnMultiplier = 0;
  return w;
}
const run = (w: World, s: number) => { for (let i = 0; i < Math.round(s * 20); i++) w.tick(); };

describe("today's lessons", () => {
  it('three different goals a day per wizard, stable within the day, new the next', () => {
    for (let d = 0; d < 30; d++) {
      const p = pickQuests(d, 'wz_abc');
      expect(new Set(p).size).toBe(QUEST_PER_DAY);
      expect(pickQuests(d, 'wz_abc')).toEqual(p);
    }
    const days = new Set(Array.from({ length: 10 }, (_, d) => pickQuests(d, 'wz_abc').join()));
    expect(days.size).toBeGreaterThan(3);
  });

  it('counts only what is gained after the day starts, pays each goal once and the set once, never backwards', () => {
    const w = mk();
    const a = w.enroll('Seamus').wizard;
    a.connections = 1;
    const st = questStatus(w, a.id);
    expect(st.lessons).toHaveLength(QUEST_PER_DAY);
    const xp0 = a.xp, g0 = a.galleons;
    // bump every counter far past every goal (a counter that resets later must not undo it)
    a.stats.creatures += 10; a.stats.casts += 30; a.stats.spells = (a.stats.spells ?? 0) + 3; a.stats.dodges = (a.stats.dodges ?? 0) + 5; a.stats.reflects = (a.stats.reflects ?? 0) + 2;
    a.cards = [...(a.cards ?? []), 'x1', 'x2'];
    a.cup = { term: w.term.n, pts: 20, src: { events: 10, quidditch: 10 } };
    run(w, 1.2);
    expect(questStatus(w, a.id).lessons.every((l) => l.done)).toBe(true);
    const gained = a.xp - xp0;
    expect(gained).toBe(QUEST_DAY_MAX_XP); // exactly the day's bound
    expect(a.galleons - g0).toBe(QUEST_PER_DAY * QUEST_GALLEONS);
    const paid = a.xp;
    a.cup = { term: w.term.n + 1, pts: 0, src: {} }; // a new term's ledger starts at 0
    run(w, 2);
    expect(a.xp).toBe(paid); // nothing twice
    w.now += QUEST_DAY_S;
    const next = questStatus(w, a.id);
    expect(next.lessons.every((l) => !l.done && l.got === 0)).toBe(true); // a new day: new goals, from zero
  });
});
