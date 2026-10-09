/** 大战周 smoke test (src/kernel/warweek.ts): Day N broadcasts, Day 7 assault, settlement report. */
import { describe, expect, it } from 'vitest';
import { WARWEEK_TERMS } from '../src/kernel/warweek.js';
import { World } from '../src/kernel/world.js';

function mk() {
  const w = new World({ seed: 7, secret: 'warweek' });
  w.rules.creatures.spawnMultiplier = 0; // keep the world quiet except our assault
  return w;
}
const run = (w: World, s: number) => { for (let i = 0; i < Math.round(s * 20); i++) w.tick(); };

describe('war week', () => {
  it('announces Day N at each term start (1-7)', () => {
    const w = mk();
    expect(w.flags.warweek).toBe(true); // default on
    const seen: string[] = [];
    const origEmit = w.emit.bind(w);
    (w as any).emit = (t: any, text: string, o: any) => { if (t === 'term' && /War Week, Day/.test(text)) seen.push(text); return origEmit(t, text, o); };
    w.rules.terms.lengthSeconds = 30; // short terms for the test
    run(w, 0.2); // first tick: term 1 -> Day 1
    for (let n = 0; n < WARWEEK_TERMS - 1; n++) {
      w.forceEndTerm();
      run(w, 0.2);
    }
    expect(seen.length).toBe(WARWEEK_TERMS);
    expect(seen[0]).toMatch(/Day 1/);
    expect(seen[6]).toMatch(/Day 7/);
  });

  it('triggers the assault when Day 7 ends, and settles with a report', () => {
    const w = mk();
    w.rules.terms.lengthSeconds = 30;
    const lines: string[] = [];
    const origEmit = w.emit.bind(w);
    (w as any).emit = (t: any, text: string, o: any) => { if (t === 'term') lines.push(text); return origEmit(t, text, o); };
    // walk to the end of Day 7
    for (let n = 0; n < WARWEEK_TERMS; n++) { w.forceEndTerm(); run(w, 0.2); }
    expect(w.warweek.assault).not.toBe(null);
    expect(lines.some((l) => /assault begins/.test(l))).toBe(true);
    // let all three waves spawn
    run(w, 200);
    const a = w.warweek.assault!;
    expect(a.wave).toBe(3);
    expect(a.mobs.size).toBeGreaterThan(0);
    // kill everything: victory
    for (const id of [...a.mobs]) w.creatures.delete(id);
    run(w, 1);
    expect(w.warweek.assault).toBe(null);
    expect(lines.some((l) => /assault is broken/.test(l))).toBe(true);
  });

  it('does nothing when the flag is off', () => {
    const w = mk();
    w.flags.warweek = false;
    w.rules.terms.lengthSeconds = 30;
    const seen: string[] = [];
    const origEmit = w.emit.bind(w);
    (w as any).emit = (t: any, text: string, o: any) => { if (t === 'term' && /War Week/.test(text)) seen.push(text); return origEmit(t, text, o); };
    for (let n = 0; n < WARWEEK_TERMS + 1; n++) { w.forceEndTerm(); run(w, 0.2); }
    expect(seen.length).toBe(0);
    expect(w.warweek.assault).toBe(null);
  });
});
