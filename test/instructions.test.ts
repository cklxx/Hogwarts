/** The MCP instructions tell an agent this world's own clock, not the default one. */
import { describe, expect, it } from 'vitest';
import { instructionsFor } from '../src/mcp/server.js';
import { World } from '../src/kernel/world.js';

describe('instructionsFor', () => {
  it('fills in the term length and the event interval', () => {
    const w = new World({ seed: 1, secret: 'instr' });
    expect(instructionsFor(w)).toMatch(/A term \(15 min\)/);
    w.rules.terms.lengthSeconds = 300;
    w.rules.events.intervalSeconds = 90;
    const t = instructionsFor(w);
    expect(t).toMatch(/A term \(5 min\)/);
    expect(t).toMatch(/every ~90 s/);
    expect(t).not.toMatch(/__[A-Z]+__/);
    expect(t).toMatch(/duel_club/);
  });
});
