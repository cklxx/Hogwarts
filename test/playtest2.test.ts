/** What AI playtest round 2 (docs/PLAYTEST.md) found, fixed: each line is a tester's complaint. */
import { describe, expect, it } from 'vitest';
import { CHESTS } from '../src/shared/chests.js';
import { DUEL_NPC_AFTER_S, DUEL_STAGE, duelJoin } from '../src/kernel/duelclub.js';
import { QD_CALL_S, QD_START_FRAC, qdJoin } from '../src/kernel/quidditch.js';
import { ensureNpcs } from '../src/kernel/npc.js';
import { startEvent } from '../src/kernel/wheel.js';
import { World } from '../src/kernel/world.js';
import type { Creature, Wizard } from '../src/kernel/types.js';

function mk(npcs = 0) {
  const w = new World({ seed: 44, secret: 'playtest2' });
  w.rules.creatures.spawnMultiplier = 0;
  w.rules.events.pool = [];
  if (npcs) ensureNpcs(w, npcs);
  return w;
}
function player(w: World, name: string, house = 'Gryffindor'): Wizard {
  const a = w.enroll(name, house as never).wizard;
  a.connections = 1; a.createdAt = -1e6; a.pos = { x: 60, z: 60 };
  return a;
}
const run = (w: World, s: number) => { for (let i = 0; i < Math.round(s * 20); i++) w.tick(); };
function pixie(w: World, x: number, z: number): Creature {
  const c: Creature = { id: 'c_px', kind: 'pixie', pos: { x, z }, home: { x, z }, hp: 30, maxHp: 30, facing: 0, target: null, attackCd: 1e9, rootedUntil: 1e9, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
  w.creatures.set(c.id, c);
  return c;
}

describe('playtest round 2', () => {
  it('"cast only says ok": look.yourHits lists what your spells hit, and what went down', () => {
    const w = mk();
    const a = player(w, 'Hunter');
    const c = pixie(w, 60, 66);
    w.damage(a.id, c.id, 12, 'ice');
    w.damage(a.id, c.id, 40, 'ice');
    const hits = w.look(a.id).yourHits;
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ target: 'c_px', down: true }); // newest first
    expect(hits[1].damage).toBeGreaterThan(0);
  });

  it('"no way to find a chest": look shows the ones within sight', () => {
    const w = mk();
    const a = player(w, 'Newcomer');
    const ch = CHESTS[0];
    a.pos = { x: ch.x + 30, z: ch.z };
    expect(w.look(a.id).chests.find((c) => c.id === ch.id)).toBeUndefined();
    a.pos = { x: ch.x + 6, z: ch.z };
    expect(w.look(a.id).chests.find((c) => c.id === ch.id)).toBeTruthy();
  });

  it('"Peeves is not in look": the school event and what to aim at', () => {
    const w = mk();
    const a = player(w, 'Politician');
    startEvent(w, 'peeves');
    const e = w.look(a.id).schoolEvent!;
    expect(e.id).toBe('peeves');
    expect(e.target?.how).toMatch(/aim_x/);
  });

  it('"a bolt at someone I cannot harm cost mana": refused with the reason, nothing spent', () => {
    const w = mk();
    const a = player(w, 'Duellist'), b = player(w, 'Mate'); // housemates, no friendly fire
    w.rules.combat.friendlyFire = false;
    b.pos = { x: 60, z: 66 };
    const mana = a.mana;
    const r = w.cast(a.id, 'Stupefy', { target: b.handle });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/cannot harm/);
    expect(a.mana).toBe(mana);
  });

  it('"the NPC stood still, then walked off and I won": an NPC in the Quidditch match is not a duel sparring partner, and vice versa', () => {
    const w = mk(4);
    const q = player(w, 'Seeker', 'Gryffindor');
    w.now = w.term.startedAt + QD_START_FRAC * (w.term.endsAt - w.term.startedAt) - QD_CALL_S + 1;
    run(w, 0.1);
    qdJoin(w, q.id);
    run(w, QD_CALL_S);
    const m = w.qd.match!;
    expect(m.phase).toBe('play');
    const npcsPlaying = Object.keys(m.roster).filter((id) => w.wizards.get(id)!.npc);
    const d = player(w, 'Duellist', 'Hufflepuff');
    d.pos = { x: DUEL_STAGE.x, z: DUEL_STAGE.z + 4 };
    duelJoin(w, d.id);
    run(w, DUEL_NPC_AFTER_S + 0.2);
    const dm = w.duel.match;
    if (dm) expect(npcsPlaying).not.toContain(dm.b);
    expect(() => duelJoin(w, q.id)).toThrow(/Quidditch/);
  });

  it('"reputation halved and nobody said": the term end tells each player what carried over', () => {
    const w = mk();
    const a = player(w, 'Politician');
    a.reputation = 40;
    w.forceEndTerm();
    expect(a.reputation).toBe(20);
    expect(w.events.some((e) => e.to === a.id && /40 → 20/.test(e.text))).toBe(true);
  });

  it('"the Room said lost though I got a chest"', () => {
    const w = mk();
    const a = player(w, 'Newcomer');
    startEvent(w, 'room');
    const e = w.wheel.active!;
    e.d.claimed = [a.id];
    w.now = e.endsAt + 0.1;
    run(w, 0.1);
    expect(w.wheelResult?.outcome).toBe('won');
  });

  it('a 5-minute term needs a third of the reputation to make a Minister', () => {
    const w = mk();
    expect(w.ministerBar()).toBe(30);
    w.rules.terms.lengthSeconds = 300;
    expect(w.ministerBar()).toBe(10);
  });
});

describe('playtest round 2, over MCP', () => {
  async function client(w: World, wid: string) {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const { createMcpServer } = await import('../src/mcp/server.js');
    const server = createMcpServer(w, { wizardId: wid, baseUrl: 'http://x' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const c = new Client({ name: 'test', version: '0' });
    await c.connect(ct);
    return async (name: string, args: Record<string, unknown> = {}) => {
      const r = (await c.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      return JSON.parse(r.content[0].text);
    };
  }

  it('"the password said nothing back": say answers with what it set off', async () => {
    const w = mk();
    const a = player(w, 'Moony');
    const call = await client(w, a.id);
    const r = await call('say', { text: 'I solemnly swear that I am up to no good' });
    expect(r.answered?.length).toBeGreaterThan(0);
    expect((await call('say', { text: 'hello' })).answered).toBeUndefined();
  });

  it('"status has no hp": a duel match shows both sides\' health', async () => {
    const w = mk();
    const a = player(w, 'Left'), b = player(w, 'Right', 'Slytherin');
    for (const x of [a, b]) x.pos = { x: DUEL_STAGE.x, z: DUEL_STAGE.z + 3 };
    duelJoin(w, a.id); duelJoin(w, b.id);
    run(w, 0.2);
    const r = await (await client(w, a.id))('duel_club', { op: 'status' });
    expect(r.match.hp.map((x: { name: string }) => x.name)).toEqual(['Left', 'Right']);
    expect(r.match.hp[0].maxHp).toBeGreaterThan(0);
  });
});

describe('playtest round 2: something to react to', () => {
  it('"I cannot see the bolt coming": incoming lists the spells flying at you, soonest first', () => {
    const w = mk();
    const a = player(w, 'Target', 'Gryffindor'), b = player(w, 'Shooter', 'Slytherin');
    b.pos = { x: 60, z: 80 };
    expect(w.incoming(a.id)).toEqual([]);
    w.spawnProjectile(b, 'bolt', a.pos, a.id, 10, 'arcane', 0, []);
    const inc = w.incoming(a.id);
    expect(inc).toHaveLength(1);
    expect(inc[0].from).toBe('Shooter');
    expect(inc[0].eta).toBeGreaterThan(0);
    expect(w.incoming(b.id)).toEqual([]); // not your own
    // a bolt going elsewhere is not incoming
    const c = player(w, 'Bystander', 'Hufflepuff');
    c.pos = { x: 90, z: 60 };
    expect(w.incoming(c.id)).toEqual([]);
  });
});
