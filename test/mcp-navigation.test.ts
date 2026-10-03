import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createMcpServer } from '../src/mcp/server.js';
import { World } from '../src/kernel/world.js';
import { sceneAt } from '../src/shared/scenes.js';

const closes: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(closes.splice(0).map((close) => close())); });

function fixture() {
  const world = new World({ seed: 43, secret: 'navigation-test' });
  world.rules.creatures.spawnMultiplier = 0;
  world.rules.events.pool = [];
  world.term.endsAt = 1e12;
  const wizard = world.enroll('Navigation Reader', 'Ravenclaw').wizard;
  wizard.connections = 1;
  wizard.pos = { x: 0, z: -22 };
  return { world, wizard };
}
async function session(world: World, wid: string) {
  const server = createMcpServer(world, { wizardId: wid, baseUrl: 'http://test' });
  const client = new Client({ name: 'navigation-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st); await client.connect(ct);
  closes.push(async () => { await client.close(); await server.close(); });
  return async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).not.toBe(true);
    return JSON.parse((result.content as { text: string }[])[0].text);
  };
}
function run(world: World, seconds: number) {
  for (let i = 0; i < seconds * 20; i++) world.tick();
}

// Real MCP calls over linked transports and real World movement; no mocked arrival handler.
describe('MCP arrival feedback', () => {
  it('does not call an already knocked-out wizard arrived', async () => {
    const { world, wizard } = fixture();
    const call = await session(world, wizard.id);
    await call('move_to', { x: 12, z: -12 });
    world.damage(null, wizard.id, 1000, 'arcane');
    expect(wizard.st.stunnedUntil).toBeGreaterThan(0);
    const result = await call('wait', { until: 'arrived', seconds: 0.5 });
    expect(result).toMatchObject({ reason: 'knocked_out', walking: false });
    expect(result.note ?? '').not.toMatch(/move_to first/);
  });

  it('reports no active walk without blaming a short journey that finished between sessions', async () => {
    const { world, wizard } = fixture();
    await (await session(world, wizard.id))('move_to', { x: 4, z: -22 });
    run(world, 2);
    expect(wizard.goal).toBeNull();
    expect(Math.hypot(wizard.pos.x - 4, wizard.pos.z + 22)).toBeLessThan(1);
    const result = await (await session(world, wizard.id))('wait', { until: 'arrived', seconds: 0.5 });
    expect(result).toMatchObject({ reason: 'idle', walking: false });
    expect(result.note).toMatch(/finished before/);
    expect(result.note).not.toMatch(/move_to first/);
  });

  it('returns interrupted when a walk is cancelled away from its destination', async () => {
    const { world, wizard } = fixture();
    const call = await session(world, wizard.id);
    await call('move_to', { x: 12, z: -12 });
    const timer = setTimeout(() => world.setGoal(wizard.id, null, 'agent'), 30);
    try {
      const result = await call('wait', { until: 'arrived', seconds: 1 });
      expect(result).toMatchObject({ reason: 'interrupted', walking: false });
      expect(result.note).toMatch(/before reaching/);
    } finally { clearTimeout(timer); }
  });

  it('preserves arrived for a journey that reaches its target while waiting', async () => {
    const { world, wizard } = fixture();
    const call = await session(world, wizard.id);
    await call('move_to', { x: 12, z: -12 });
    const timer = setInterval(() => world.tick(), 5);
    try {
      const result = await call('wait', { until: 'arrived', seconds: 1 });
      expect(result).toMatchObject({ reason: 'arrived', walking: false, state: 'in the world' });
      expect(result.note ?? '').not.toMatch(/not walking|move_to first/);
      expect(Math.hypot(result.at.x - 12, result.at.z + 12)).toBeLessThan(1);
    } finally { clearInterval(timer); }
  });

  it('uses the legal adjusted endpoint when the requested point is inside a building', async () => {
    const { world, wizard } = fixture();
    const call = await session(world, wizard.id);
    await call('move_to', { x: 41, z: -40 });
    const endpoint = { ...wizard.goal! };
    expect(Math.hypot(endpoint.x - 41, endpoint.z + 40)).toBeGreaterThan(1);
    const timer = setInterval(() => world.tick(), 5);
    try {
      const result = await call('wait', { until: 'arrived', seconds: 3 });
      expect(result).toMatchObject({ reason: 'arrived', walking: false });
      expect(Math.hypot(result.at.x - endpoint.x, result.at.z - endpoint.z)).toBeLessThan(1);
    } finally { clearInterval(timer); }
  });

  it('follows a cross-scene journey through its gate to the adjusted hut entrance', async () => {
    const { world, wizard } = fixture();
    const call = await session(world, wizard.id);
    await call('move_to', { landmark: 'hagrid' });
    expect(world.via.has(wizard.id)).toBe(true);
    const timer = setInterval(() => world.tick(), 10);
    try {
      const result = await call('wait', { until: 'arrived', seconds: 5 });
      expect(result).toMatchObject({ reason: 'arrived', walking: false });
      expect(sceneAt(wizard.pos.x, wizard.pos.z)?.id).toBe('forest');
      // Hagrid's hut is solid: the legal route ends at its entrance, not the landmark centre.
      expect(Math.hypot(result.at.x - 95, result.at.z - 34)).toBeLessThan(4);
    } finally { clearInterval(timer); }
  });

  it('does not invent failure if a building entrance is reached between scene-route observations', async () => {
    const { world, wizard } = fixture();
    const call = await session(world, wizard.id);
    await call('move_to', { landmark: 'hagrid' });
    expect(world.via.has(wizard.id)).toBe(true);
    // The final adjusted endpoint is created and reached between MCP's observations.
    const timer = setTimeout(() => run(world, 30), 30);
    try {
      const result = await call('wait', { until: 'arrived', seconds: 1 });
      expect(result).toMatchObject({ reason: 'unconfirmed', walking: false });
      expect(result.note).toMatch(/final route/);
      expect(sceneAt(wizard.pos.x, wizard.pos.z)?.id).toBe('forest');
      expect(Math.hypot(result.at.x - 95, result.at.z - 34)).toBeLessThan(4);
    } finally { clearTimeout(timer); }
  });

  it('does not mistake a teleport that ends a walk for arrival at its former destination', async () => {
    const { world, wizard } = fixture();
    const call = await session(world, wizard.id);
    await call('move_to', { x: 12, z: -12 });
    const timer = setTimeout(() => world.apparate(wizard, { x: -82, z: 26 }), 30);
    try {
      const result = await call('wait', { until: 'arrived', seconds: 1 });
      expect(result).toMatchObject({ reason: 'interrupted', walking: false });
      expect(result.at.x).toBeLessThan(-70);
    } finally { clearTimeout(timer); }
  });

  it('reports knocked_out if a walk is ended by combat during the wait', async () => {
    const { world, wizard } = fixture();
    const call = await session(world, wizard.id);
    await call('move_to', { x: 12, z: -12 });
    const timer = setTimeout(() => world.damage(null, wizard.id, 1000, 'arcane'), 30);
    try {
      const result = await call('wait', { until: 'arrived', seconds: 1 });
      expect(result).toMatchObject({ reason: 'knocked_out', walking: false });
    } finally { clearTimeout(timer); }
  });
});
