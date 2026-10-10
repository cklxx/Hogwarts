/** 命运链 smoke test (src/kernel/fates.ts): trigger, saved branch, lost branch. */
import { describe, expect, it } from 'vitest';
import type { FateId } from '../src/kernel/fates.js';
import { HOOKS } from '../src/kernel/features.js';
import { World } from '../src/kernel/world.js';

function mk() {
  const w = new World({ seed: 7, secret: 'fates' });
  w.rules.creatures.spawnMultiplier = 0; // keep the world quiet except our fates
  w.rules.terms.lengthSeconds = 30; // short terms
  return w;
}
const run = (w: World, s: number) => { for (let i = 0; i < Math.round(s * 20); i++) w.tick(); };
const dayOf = (n: number) => ((n - 1) % 7) + 1;
/** Walk to the start of the term whose Day is `day` (within the first cycle). */
function gotoDay(w: World, day: number) {
  run(w, 0.2); // first tick: term 1
  while (dayOf(w.term.n) !== day) { w.forceEndTerm(); run(w, 0.2); }
}

describe('fates', () => {
  it('opens each thread on its trigger day', () => {
    const w = mk();
    const expectDay: Record<FateId, number> = { filch: 1, merchant: 2, hagrid: 3, snape: 4, luna: 5 };
    for (const [id, day] of Object.entries(expectDay) as [FateId, number][]) {
      gotoDay(w, day);
      expect(w.fates.threads[id].state).toBe('open');
    }
  });

  it('marks saved when all event mobs die (merchant)', () => {
    const w = mk();
    gotoDay(w, 2);
    const t = w.fates.threads.merchant;
    expect(t.state).toBe('open');
    expect(t.mobs.size).toBeGreaterThan(0);
    // kill them all (as the world would)
    for (const id of [...t.mobs]) w.creatures.delete(id);
    run(w, 0.5);
    expect(t.state).toBe('saved');
    // published for the aftermath reader
    expect((w.flags as any).fateResults.merchant).toBe('saved');
  });

  it('marks lost at the deadline with mobs alive (hagrid)', () => {
    const w = mk();
    gotoDay(w, 3);
    const t = w.fates.threads.hagrid;
    expect(t.state).toBe('open');
    // do nothing: walk to Day 4 (deadline)
    gotoDay(w, 4);
    expect(t.state).toBe('lost');
    expect(t.mobs.size).toBe(0); // leftovers despawned
    expect((w.flags as any).fateResults.hagrid).toBe('lost');
  });

  it('saves filch when a player walks to the cat', () => {
    const w = mk();
    // add a player wizard
    const p = w.enroll('TestPlayer', 'Gryffindor').wizard;
    p.connections = 1; // online
    gotoDay(w, 1);
    const t = w.fates.threads.filch;
    expect(t.state).toBe('open');
    // walk the player to the cat
    p.pos = { x: t.at.x, z: t.at.z };
    run(w, 0.5);
    expect(t.state).toBe('saved');
  });

  it('applies snape buff during the assault (hit hook)', () => {
    const w = mk();
    const p = w.enroll('TestPlayer', 'Gryffindor').wizard;
    p.connections = 1;
    gotoDay(w, 4);
    const t = w.fates.threads.snape;
    for (const id of [...t.mobs]) w.creatures.delete(id);
    run(w, 0.5);
    expect(t.state).toBe('saved');
    // walk to end of Day 7: assault starts
    gotoDay(w, 7);
    w.forceEndTerm(); run(w, 0.5);
    expect(w.warweek.assault).not.toBe(null);
    // the hit hook: player damage during assault gets 1.25x
    const fatesHook = HOOKS.hit.find((h) => h.id === 'fates')!;
    expect(fatesHook.hit(w, p.id, p, 'dummy', [], true)).toBe(1.25);
  });
});
