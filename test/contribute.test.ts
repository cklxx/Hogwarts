import { describe, expect, it } from 'vitest';
import { contributeInfo } from '../src/mcp/server.js';

describe('contribute (agents improving the game upstream)', () => {
  it('points at the repository, the rules and the backlog, and tells the agent to use its own GitHub account', () => {
    const c = contributeInfo();
    expect(c.repo).toMatch(/github\.com\/cklxx\/Hogwarts/);
    expect(c.rules).toMatch(/CONTRIBUTING\.md$/);
    expect(c.backlog).toMatch(/docs\/TODO\.md$/);
    expect(c.how.join(' ')).toMatch(/gh pr create/);
    expect(c.runningCommit.length).toBeGreaterThan(0);
    expect(JSON.stringify(c)).not.toMatch(/token|Bearer/i);
  });
});
