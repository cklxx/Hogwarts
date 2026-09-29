/** 看 Agent 玩: you watch your own wizard move while your agent plays; the panel says what it is doing. */
import { describe, expect, it } from 'vitest';
import { AGENT_ACTIVE_S, AGENT_LOG_MAX, World } from '../src/kernel/world.js';

function mk() {
  const w = new World({ seed: 3, secret: 'watch-secret' });
  w.rules.creatures.spawnMultiplier = 0;
  return w;
}
const join = (w: World, name: string) => { const x = w.enroll(name).wizard; x.connections = 1; return x; };

describe('your agent at work', () => {
  it('its recent calls (bounded), with the source of the spells it cast, and never your key', () => {
    const w = mk();
    const a = join(w, 'Hermione');
    w.forgeSpell(a.id, { name: 'Pixie Pest', source: '(bolt target 8 :ice)' });
    for (let i = 0; i < AGENT_LOG_MAX + 5; i++) w.noteAgentCall(a.id, 'look', true);
    w.noteAgentCall(a.id, 'cast', true, 'Pixie Pest');
    const act = w.agentActivity(a.id);
    expect(act.log).toHaveLength(AGENT_LOG_MAX);
    expect(act.log.at(-1)).toMatchObject({ tool: 'cast', ok: true, spell: 'Pixie Pest', source: '(bolt target 8 :ice)' });
    expect(JSON.stringify(act)).not.toContain(a.token);
  });

  it('counts as playing for AGENT_ACTIVE_S after its last call', () => {
    const w = mk();
    const a = join(w, 'Ron');
    expect(w.agentActive(a)).toBe(false);
    w.setAgentSeen(a.id, 'claude', 'look');
    expect(w.agentActive(a)).toBe(true);
    w.now += AGENT_ACTIVE_S + 1;
    expect(w.agentActive(a)).toBe(false);
  });
});
