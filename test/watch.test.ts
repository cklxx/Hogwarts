/** 观战 (docs/TODO.md P4): watch links, public watching while an agent plays, and what a watcher is shown. */
import { describe, expect, it } from 'vitest';
import { AGENT_ACTIVE_S, AGENT_LOG_MAX, World } from '../src/kernel/world.js';

function mk() {
  const w = new World({ seed: 3, secret: 'watch-secret' });
  w.rules.creatures.spawnMultiplier = 0;
  return w;
}
const join = (w: World, name: string) => { const x = w.enroll(name).wizard; x.connections = 1; return x; };

describe('watch links', () => {
  it('show one wizard, never carry the key, and stop at once when revoked or replaced', () => {
    const w = mk();
    const a = join(w, 'Luna');
    const c1 = w.newWatchCode(a.id);
    expect(c1).not.toContain(a.token);
    expect(w.watchTarget(c1)?.id).toBe(a.id);
    const c2 = w.newWatchCode(a.id);
    expect(w.watchTarget(c1)).toBeNull(); // a new link replaces the old one
    expect(w.watchTarget(c2)?.id).toBe(a.id);
    w.revokeWatch(a.id);
    expect(w.watchTarget(c2)).toBeNull();
    expect(w.watchTarget('')).toBeNull();
  });

  it('survive a restart (the link a friend has keeps working)', () => {
    const w = mk();
    const a = join(w, 'Neville');
    const code = w.newWatchCode(a.id);
    const back = World.restore(JSON.parse(JSON.stringify(w.serialize())));
    expect(back.watchTarget(code)?.name).toBe('Neville');
  });

  it('carry the realm like pairing codes do, so a front door can route them', () => {
    const w = new World({ seed: 3, secret: 's', tokenPrefix: 'r2.' });
    const a = join(w, 'Cho');
    expect(w.newWatchCode(a.id)).toMatch(/^2-/);
  });
});

describe('public watching', () => {
  it('only while the agent plays, and only if the player allows it', () => {
    const w = mk();
    const a = join(w, 'Ginny');
    expect(w.publicWatch(a.handle).ok).toBe(false); // no agent yet
    w.setAgentSeen(a.id, 'claude-code', 'whoami');
    expect(w.publicWatch(a.handle).ok).toBe(true);
    w.setWatchable(a.id, false);
    expect(w.publicWatch(a.handle)).toMatchObject({ ok: false, error: expect.stringContaining('旁观') });
    w.setWatchable(a.id, true);
    w.now += AGENT_ACTIVE_S + 1; // the agent went quiet
    expect(w.publicWatch(a.handle)).toMatchObject({ ok: false, error: expect.stringContaining('没在玩') });
    expect(w.publicWatch('nobody').ok).toBe(false);
  });
});

describe('what a watcher sees', () => {
  it('the agent\'s recent calls (bounded), spell names for everyone and spell source only for the owner', () => {
    const w = mk();
    const a = join(w, 'Hermione');
    w.forgeSpell(a.id, { name: 'Pixie Pest', source: '(bolt target 8 :ice)' });
    for (let i = 0; i < AGENT_LOG_MAX + 5; i++) w.noteAgentCall(a.id, 'look', true);
    w.noteAgentCall(a.id, 'cast', true, 'Pixie Pest');
    const pub = w.watchState(a.id);
    expect(pub.agent.log).toHaveLength(AGENT_LOG_MAX);
    const last = pub.agent.log.at(-1)!;
    expect(last).toMatchObject({ tool: 'cast', ok: true, spell: 'Pixie Pest' });
    expect(last).not.toHaveProperty('source');
    expect(JSON.stringify(pub)).not.toContain(a.token);
    expect(w.watchState(a.id, true).agent.log.at(-1)).toMatchObject({ source: '(bolt target 8 :ice)' });
  });
});
