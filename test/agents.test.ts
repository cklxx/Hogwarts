/**
 * Agents play well too (owner round 3): standing reflexes the kernel runs without a round trip, one inbox for
 * everything said to you, batch for several replies in one call, and 附身 — an agent playing an NPC or a creature.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createMcpServer } from '../src/mcp/server.js';
import { chatSend } from '../src/kernel/chat.js';
import { actingAs, FEATURE_BY_ID } from '../src/kernel/features.js';
import { EGG_POSSESS_S, POSSESS_ROAM, possessCreature, possessNpc, release } from '../src/kernel/possess.js';
import { setReflexes } from '../src/kernel/reflexes.js';
import { World } from '../src/kernel/world.js';
import type { Creature, Wizard } from '../src/kernel/types.js';

function mk(seed = 9) {
  const w = new World({ seed, secret: 'agents' });
  w.rules.creatures.spawnMultiplier = 0;
  w.rules.events.pool = [];
  w.rules.combat.pvp = true;
  w.term.endsAt = 1e12;
  return w;
}
function join(w: World, name: string, house: string, x: number, z: number, year = 3, npc = false): Wizard {
  const a = w.enroll(name, house as never).wizard;
  a.connections = 1; a.createdAt = -1e6; a.year = year; a.pos = { x, z }; a.npc = npc;
  a.hp = w.privateState(a.id).maxHp; a.mana = w.privateState(a.id).maxMana;
  return a;
}
function beast(w: World, id: string, x: number, z: number, hp = 400): Creature {
  const c: Creature = { id, kind: 'troll', pos: { x, z }, home: { x, z }, hp, maxHp: hp, facing: 0, target: null, attackCd: 1e9, rootedUntil: 0, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
  w.creatures.set(id, c);
  return c;
}
const run = (w: World, s: number) => { for (let i = 0; i < Math.round(s * 20); i++) w.tick(); };
async function mcp(w: World, wid: string) {
  const server = createMcpServer(w, { wizardId: wid, baseUrl: 'http://x' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(ct);
  return async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await c.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    let v: unknown = r.content[0].text;
    try { v = JSON.parse(r.content[0].text); } catch { /* text */ }
    return { err: !!r.isError, v: v as Record<string, any> };
  };
}

describe('反射: standing orders', () => {
  it('dodges a bolt the moment it is about to land, and heals when low', () => {
    const w = mk();
    const a = join(w, 'Claude Quill', 'Ravenclaw', 100, 100), b = join(w, 'Draco Foe', 'Slytherin', 100, 116);
    setReflexes(w, a.id, [{ when: 'incoming', do: 'dodge' }, { when: 'low_hp', do: 'cast', spell: 'Episkey', target: 'self', below: 0.5 }]);
    w.spawnProjectile(b, 'bolt', a.pos, null, 20, 'arcane', 0, []); // a straight shot at where a stands
    const hp = a.hp;
    run(w, 2);
    expect(a.hp).toBe(hp); // rolled out of its path
    a.hp = w.privateState(a.id).maxHp * 0.3;
    const low = a.hp;
    run(w, 1);
    expect(a.hp).toBeGreaterThan(low);
  });

  it('refuses more than the limit, a spell you do not know, and yields when paused', () => {
    const w = mk();
    const a = join(w, 'Claude Quill', 'Ravenclaw', 100, 100), b = join(w, 'Draco Foe', 'Slytherin', 100, 116);
    expect(() => setReflexes(w, a.id, [{ when: 'hurt', do: 'cast', spell: 'Avada' }])).toThrow(/spell you know/);
    expect(() => setReflexes(w, a.id, Array(7).fill({ when: 'hurt', do: 'ward' }))).toThrow(/At most/);
    setReflexes(w, a.id, [{ when: 'incoming', do: 'dodge' }]);
    a.agentPaused = true;
    w.spawnProjectile(b, 'bolt', a.pos, null, 20, 'arcane', 0, []);
    const hp = a.hp;
    run(w, 2);
    expect(a.hp).toBeLessThan(hp);
  });
});

describe('对话: inbox and batch', () => {
  it('inbox: everything said to you once, bounded, never your own lines; batch answers several at once', async () => {
    const w = mk();
    const a = join(w, 'Claude Quill', 'Ravenclaw', 100, 100), b = join(w, 'Luna Friend', 'Ravenclaw', 104, 100);
    const call = await mcp(w, a.id);
    await call('inbox'); // start from now
    chatSend(w, b.id, { ch: 'near', text: 'hello there' });
    chatSend(w, b.id, { ch: 'dm', to: a.handle, text: 'x'.repeat(200) });
    chatSend(w, b.id, { ch: 'all', text: 'nobody in particular' });
    chatSend(w, a.id, { ch: 'near', text: 'my own line' });
    const r = await call('inbox');
    const kinds = r.v.items.map((i: { kind: string }) => i.kind);
    expect(kinds).toEqual(['chat:near', 'chat:dm']);
    expect((await call('inbox')).v.items).toEqual([]); // read once
    const bt = await call('batch', { calls: [{ tool: 'chat', args: { ch: 'near', text: 'hi Luna' } }, { tool: 'inbox' }, { tool: 'nope' }] });
    expect(bt.v.results.map((x: { ok: boolean }) => x.ok)).toEqual([true, false, false]);
    expect(w.events.some((e) => e.type === 'chat' && e.text.includes('hi Luna'))).toBe(true);
  });
});

describe('附身: possession', () => {
  it('an agent plays an NPC over MCP: its tools move the NPC, the rest wait, and it comes back', async () => {
    const w = mk();
    const a = join(w, 'Claude Quill', 'Ravenclaw', 100, 100), n = join(w, 'Hannah Npc', 'Hufflepuff', 140, 100, 5, true);
    const call = await mcp(w, a.id);
    const list = await call('possess', { op: 'list' });
    expect(list.v.npcs.map((x: { name: string }) => x.name)).toContain('Hannah Npc');
    const t = await call('possess', { op: 'take', target: n.handle });
    expect(t.err).toBe(false);
    expect(actingAs(w, a.id)).toBe(n.id);
    expect((await call('whoami')).v.name).toBe('Hannah Npc');
    expect((await call('move_to', { x: 150, z: 100 })).err).toBe(false);
    run(w, 3);
    expect(n.pos.x).toBeGreaterThan(141);
    expect(a.pos).toEqual({ x: 100, z: 100 });
    expect((await call('forge_spell', { name: 'X', source: '(bolt 1)' })).v).toMatch(/possess release/);
    expect((w.privateState(a.id) as Record<string, unknown>).actAs).toMatchObject({ handle: n.handle });
    expect((await call('possess', { op: 'take', target: n.handle })).err).toBe(true); // one at a time
    await call('possess', { op: 'release' });
    expect(actingAs(w, a.id)).toBe(a.id);
    expect(n.heldBy).toBeUndefined();
    expect((await call('whoami')).v.name).toBe('Claude Quill');
  });

  it('a held NPC is still an NPC: it cannot hurt a newcomer, and the possession wears off', () => {
    const w = mk();
    const a = join(w, 'Claude Quill', 'Ravenclaw', 100, 100), n = join(w, 'Hannah Npc', 'Hufflepuff', 140, 100, 7, true);
    const kid = join(w, 'New Kid', 'Gryffindor', 140, 108, 1);
    kid.createdAt = w.now;
    possessNpc(w, a.id, n.handle, 5);
    const hp = kid.hp;
    w.spawnProjectile(n, 'bolt', kid.pos, kid.id, 20, 'arcane', 0, []);
    run(w, 1);
    expect(kid.hp).toBe(hp);
    run(w, 5);
    expect(actingAs(w, a.id)).toBe(a.id);
    expect(w.events.some((e) => e.to === a.id && e.text.includes('wears off'))).toBe(true);
  });

  it('a creature: walks where told (never far from its lair), attacks only whom it may, roars; if it falls it is over', () => {
    const w = mk();
    const a = join(w, 'Claude Quill', 'Ravenclaw', 100, 100), foe = join(w, 'Draco Foe', 'Slytherin', 120, 120);
    const kid = join(w, 'New Kid', 'Gryffindor', 112, 112, 1);
    kid.createdAt = w.now;
    const c = beast(w, 'c_t', 110, 110);
    possessCreature(w, a.id, c.id);
    expect(c.driver).toBe(a.id);
    // walk: clamped to POSSESS_ROAM from its lair
    const cmd = (x: Record<string, unknown>) => (FEATURE_BY_ID.get('possess')!.tools![0].run(w, a.id, { op: 'command', ...x }) as Record<string, any>);
    expect(Math.hypot(cmd({ x: 1110, z: 110 }).to.x - 110, 0)).toBeLessThanOrEqual(POSSESS_ROAM + 1);
    expect(() => cmd({ attack: kid.handle })).toThrow(/newcomer/);
    expect(cmd({ attack: foe.handle }).attacking).toBe('Draco Foe');
    expect(cmd({ roar: 'GRAAH' }).roared).toBe('GRAAH');
    expect(w.events.some((e) => e.type === 'chat' && e.ch === 'near' && e.text.includes('GRAAH'))).toBe(true);
    c.hp = 0; w.creatures.delete(c.id);
    run(w, 0.2);
    expect(w.possess.of.has(a.id)).toBe(false);
  });

  it('release puts a creature back to its lair and its own mind', () => {
    const w = mk();
    const a = join(w, 'Claude Quill', 'Ravenclaw', 100, 100);
    const c = beast(w, 'c_t', 110, 110);
    possessCreature(w, a.id, c.id);
    c.home = { x: 150, z: 150 };
    release(w, a.id);
    expect(c.driver).toBeUndefined();
    expect(c.home).toEqual({ x: 110, z: 110 });
  });

  it('a player who says the word beside an NPC is them for a minute', () => {
    const w = mk();
    const p = join(w, 'Player One', 'Gryffindor', 100, 100), n = join(w, 'Hannah Npc', 'Hufflepuff', 101, 100, 5, true);
    w.say(p, 'Polyjuice!');
    expect(actingAs(w, p.id)).toBe(n.id);
    w.setInput(actingAs(w, p.id), 1, 0);
    run(w, 1);
    expect(n.pos.x).toBeGreaterThan(101.5);
    run(w, EGG_POSSESS_S);
    expect(actingAs(w, p.id)).toBe(p.id);
    expect(n.input).toEqual({ dx: 0, dz: 0 });
  });
});
