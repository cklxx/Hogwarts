import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createMcpServer } from '../src/mcp/server.js';
import { World } from '../src/kernel/world.js';
import { touch } from '../src/kernel/props.js';
import { propById } from '../src/shared/props.js';

const closes: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(closes.splice(0).map((close) => close())); });

async function fixture(pos = { x: -82, z: 26 }) {
  const world = new World({ seed: 43, secret: 'exploration-test' });
  world.rules.creatures.spawnMultiplier = 0;
  world.rules.events.pool = [];
  const wizard = world.enroll('Exploration Reader', 'Ravenclaw').wizard;
  wizard.connections = 1;
  wizard.pos = { ...pos };
  const server = createMcpServer(world, { wizardId: wizard.id, baseUrl: 'http://test' });
  const client = new Client({ name: 'exploration-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st); await client.connect(ct);
  closes.push(async () => { await client.close(); await server.close(); });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).not.toBe(true);
    return JSON.parse((result.content as { text: string }[])[0].text);
  };
  return { world, wizard, call };
}
type SeenProp = { id: string; x: number; z: number; state: string; secondsLeft?: number };
const distance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

describe('MCP exploration query bounds', () => {
  it.each([10, 12])('limits nearby props to an explicitly smaller radius %i', async (radius) => {
    const { wizard, call } = await fixture();
    const wide = (await call('look')).props as SeenProp[];
    const small = (await call('look', { radius })).props as SeenProp[];
    expect(wide.some((p) => distance(wizard.pos, p) > radius)).toBe(true);
    expect(small).toEqual(wide.filter((p) => distance(wizard.pos, p) <= radius));
    expect(small.length).toBeGreaterThan(0);
  });

  it('keeps the original default prop output and 25 metre cap for larger look radii', async () => {
    const { wizard, call } = await fixture();
    const original = (await call('look')).props as SeenProp[];
    expect(original).toHaveLength(73);
    expect(original.every((p) => distance(wizard.pos, p) <= 25)).toBe(true);
    expect((await call('look', { radius: 25 })).props).toEqual(original);
    expect((await call('look', { radius: 40 })).props).toEqual(original);
    expect((await call('look', { radius: 80 })).props).toEqual(original);
  });

  it('includes a prop exactly at the radius and preserves its state without changing game resources', async () => {
    const { world, wizard, call } = await fixture({ x: 10, z: -19 });
    const prop = propById('ctf02-3')!; // exactly 8 metres south
    touch(world, prop, 'fire', wizard.id);
    const before = { hp: wizard.hp, mana: wizard.mana, xp: wizard.xp, galleons: wizard.galleons, props: world.serialize().features.props };
    const edge = (await call('look', { radius: 8 })).props as SeenProp[];
    expect(edge.find((p) => p.id === prop.id)).toMatchObject({ state: 'awake', secondsLeft: expect.any(Number) });
    expect(((await call('look', { radius: 7.99 })).props ?? []).some((p: SeenProp) => p.id === prop.id)).toBe(false);
    expect({ hp: wizard.hp, mana: wizard.mana, xp: wizard.xp, galleons: wizard.galleons, props: world.serialize().features.props }).toEqual(before);
  });

  it('omits an empty props section instead of leaking farther props', async () => {
    const { call } = await fixture({ x: 0, z: -20 });
    expect((await call('look', { radius: 1 })).props).toBeUndefined();
  });
});

describe('MCP movement estimate scope', () => {
  it('identifies the first segment and onward destination for a multi-scene journey', async () => {
    const { world, wizard, call } = await fixture();
    const response = await call('move_to', { landmark: 'hagrid' });
    const via = world.via.get(wizard.id)!;
    expect(via).toBeDefined();
    expect(response.route).toMatchObject({
      currentTarget: wizard.goal, destination: via.to, continues: true,
      estimateScope: 'current_segment', estimateBasis: 'straight_line_at_base_speed',
    });
    expect(distance(response.route.currentTarget, response.route.destination)).toBeGreaterThan(50);
    expect(response.distance).toBe(Math.round(distance(wizard.pos, wizard.goal!)));
    expect(response.etaSeconds).toBe(Math.round(distance(wizard.pos, wizard.goal!) / world.rules.physics.moveSpeed));
    expect(response.route.note).toMatch(/当前段/);
    expect(response.route.note).toMatch(/not the whole journey/);
  });

  it('also marks an edge crossing as an onward journey', async () => {
    const { world, wizard, call } = await fixture({ x: 0, z: -22 });
    const response = await call('move_to', { landmark: 'hagrid' });
    const via = world.via.get(wizard.id)!;
    expect(via.gate.to).toBe('forest');
    expect(response.route).toMatchObject({ currentTarget: wizard.goal, destination: via.to, continues: true });
    expect(distance(response.route.currentTarget, response.route.destination)).toBeGreaterThan(10);
  });

  it('preserves same-scene movement and reports its actual endpoint as the destination', async () => {
    const { world, wizard, call } = await fixture({ x: 0, z: -22 });
    const response = await call('move_to', { x: 12, z: -12 });
    expect(world.via.has(wizard.id)).toBe(false);
    expect(response).toMatchObject({ walkingTo: wizard.goal, distance: 16, etaSeconds: 2 });
    expect(response.route).toMatchObject({ currentTarget: wizard.goal, destination: wizard.goal, continues: false });
  });

  it('shows the legal adjusted endpoint for a requested point inside a building', async () => {
    const { wizard, call } = await fixture({ x: 0, z: -22 });
    const requested = { x: 41, z: -40 };
    const response = await call('move_to', requested);
    expect(distance(wizard.goal!, requested)).toBeGreaterThan(1);
    expect(response.route).toMatchObject({ currentTarget: wizard.goal, destination: wizard.goal, continues: false });
    expect(response.distance).toBe(Math.round(distance(wizard.pos, wizard.goal!)));
  });
});
