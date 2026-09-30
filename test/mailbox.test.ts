/**
 * The Owl Post between a player and their own agent (docs/AGENT_LINK.md §C.2): owls, questions and
 * answers, the wake contract of MCP wait/listen, presence, and the player's pause switch.
 */
import { describe, expect, it } from 'vitest';
import { AGENT_PAUSED, AGENT_PAUSE_ALLOWED, OWLBOX_UNREAD, PLAYER_STEERING, World } from '../src/kernel/world.js';
import { AGENT_SEEN_ROUND_S, ASK_TTL_S, OWLBOX_MAX, OWL_MAX_CHARS, OWL_PER_MIN, PLAYER_GRACE_S } from '../src/shared/constants.js';
import type { Wizard } from '../src/kernel/types.js';

function mk() {
  const w = new World({ seed: 4, secret: 'x' });
  w.rules.creatures.spawnMultiplier = 0;
  return w;
}
function join(w: World, name: string): Wizard {
  const x = w.enroll(name).wizard;
  x.connections = 1;
  x.pos = { x: 20, z: 20 }; // the castle's lawn (src/shared/scenes.ts)
  return x;
}
const run = (w: World, s: number) => { for (let t = 0; t < s; t += 0.05) w.tick(0.05); };
/** Spread owls over time so the per-minute limit is not what a test measures. */
const owlEvery = (w: World, s: number) => { w.now += s; };

describe('owls', () => {
  it('go privately to the one wizard, tagged with who wrote them, in plain text for both languages', () => {
    const w = mk();
    const a = join(w, 'Alice'), b = join(w, 'Bob');
    const m = w.owl(a.id, 'player', '  go to the forest  ');
    expect(m).toMatchObject({ id: 1, from: 'player', text: 'go to the forest' });
    const e = w.events.at(-1)!;
    expect(e).toMatchObject({ type: 'owl', to: a.id, from: 'player', text: 'go to the forest', zh: 'go to the forest', owl: { id: 1 } });
    expect(w.inboxFor(b.id).some((x) => x.type === 'owl')).toBe(false); // nobody else hears it
    expect(w.owl(a.id, 'agent', 'on my way').from).toBe('agent');
    expect(a.owlbox.map((x) => x.id)).toEqual([1, 2]);
  });

  it('are at most OWL_MAX_CHARS long, never empty, and ≤ OWL_PER_MIN a minute from each side', () => {
    const w = mk();
    const a = join(w, 'Alice');
    expect(w.owl(a.id, 'player', 'x'.repeat(OWL_MAX_CHARS + 50)).text).toHaveLength(OWL_MAX_CHARS);
    expect(() => w.owl(a.id, 'player', '   ')).toThrow(/needs a message/);
    for (let i = 1; i < OWL_PER_MIN; i++) w.owl(a.id, 'agent', `spam ${i}`);
    w.owl(a.id, 'agent', 'last one');
    expect(() => w.owl(a.id, 'agent', 'one too many')).toThrow(/Too many owls/);
    expect(w.owl(a.id, 'player', 'the human can still reply').from).toBe('player'); // a chatty agent never gags its player
    run(w, 60.1);
    expect(() => w.owl(a.id, 'agent', 'a new minute')).not.toThrow();
  });

  it('the owlbox keeps OWLBOX_MAX, evicting the oldest finished message but never an unanswered question', () => {
    const w = mk();
    const a = join(w, 'Alice');
    const q = w.owl(a.id, 'agent', 'Shall I?', ['yes', 'no']);
    for (let i = 0; i < OWLBOX_MAX + 10; i++) { owlEvery(w, 2.1); w.owl(a.id, 'player', `msg ${i}`); if (i % 20 === 19) q.ask!.expiresAt = w.now + ASK_TTL_S; }
    expect(a.owlbox).toHaveLength(OWLBOX_MAX);
    expect(a.owlbox[0].id).toBe(q.id); // still there, still open
    expect(a.owlbox.at(-1)!.text).toBe(`msg ${OWLBOX_MAX + 9}`);
  });

  it('a box of nothing but open questions refuses a new owl rather than dropping one', () => {
    const w = mk();
    const a = join(w, 'Alice');
    // (cannot happen at OWL_PER_MIN with ASK_TTL_S: at most ~23 questions are ever open; force it)
    for (let i = 0; i < OWLBOX_MAX; i++) {
      owlEvery(w, 2.1);
      for (const m of a.owlbox) m.ask!.expiresAt = w.now + ASK_TTL_S;
      w.owl(a.id, 'agent', `q${i}`, ['a', 'b']);
    }
    expect(a.owlbox.every((m) => m.ask && !m.answered)).toBe(true);
    expect(() => w.owl(a.id, 'player', 'hello?')).toThrow(/full of questions/);
  });
  it("an agent's owls never push out its player's unread owls (the reviewer's case: one important owl, then 50 from the agent)", () => {
    const w = mk();
    const a = join(w, 'Alice');
    w.owl(a.id, 'player', 'IMPORTANT: stop attacking the centaurs');
    for (let i = 0; i < OWLBOX_MAX; i++) { owlEvery(w, 2.1); w.owl(a.id, 'agent', `status ${i}`); }
    expect(a.owlbox).toHaveLength(OWLBOX_MAX);
    expect(a.owlbox.filter((m) => m.from === 'player').map((m) => m.text)).toEqual(['IMPORTANT: stop attacking the centaurs']);
    expect(w.takeOwls(a.id).map((m) => m.text)).toEqual(['IMPORTANT: stop attacking the centaurs']);
    // once read, it is an ordinary finished message and may make room
    owlEvery(w, 2.1);
    w.owl(a.id, 'agent', 'one more');
    expect(a.owlbox.some((m) => m.from === 'player')).toBe(false);
  });

  it('a box full of unread player owls: an agent must listen first; a newer player owl drops the oldest, and the agent is told how many it missed', () => {
    const w = mk();
    const a = join(w, 'Alice');
    for (let i = 0; i < OWLBOX_MAX; i++) { owlEvery(w, 2.1); w.owl(a.id, 'player', `p${i}`); }
    owlEvery(w, 2.1);
    expect(() => w.owl(a.id, 'agent', 'hello?')).toThrow(OWLBOX_UNREAD);
    expect(() => w.owl(a.id, 'agent', 'ok?', ['yes', 'no'])).toThrow(OWLBOX_UNREAD);
    const since = w.events.at(-1)!.id;
    for (let i = 0; i < 3; i++) { owlEvery(w, 2.1); w.owl(a.id, 'player', `late ${i}`); }
    expect(a.owlbox).toHaveLength(OWLBOX_MAX);
    const got = w.takeOwls(a.id);
    expect(got).toHaveLength(OWLBOX_MAX);
    expect(got[0]).toMatchObject({ text: 'p3', lost: 3 }); // p0, p1, p2 were dropped just before it
    expect(got.reduce((n, m) => n + (m.lost ?? 0), 0)).toBe(3);
    // the player is told once (privately, in both languages), and that also wakes a waiting agent
    const told = w.inboxFor(a.id, since).filter((e) => e.type === 'system');
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ to: a.id });
    expect(told[0].zh).toMatch(/挤掉/);
    // after listening, room is made from read owls first
    owlEvery(w, 2.1);
    expect(w.owl(a.id, 'agent', 'sorry, I was busy').from).toBe('agent');
    expect(w.owl(a.id, 'player', 'fine').lost).toBeUndefined();
  });
});

describe('questions', () => {
  it('only an agent asks, with 2-4 different options', () => {
    const w = mk();
    const a = join(w, 'Alice');
    expect(() => w.owl(a.id, 'player', 'hm?', ['a', 'b'])).toThrow(/Only an agent/);
    for (const bad of [['one'], ['a', 'b', 'c', 'd', 'e'], ['a', 'a'], ['a', '  ']]) expect(() => w.owl(a.id, 'agent', 'q?', bad)).toThrow(/2 to 4/);
    const q = w.owl(a.id, 'agent', 'Fight the troll?', ['yes', 'no', 'later']);
    const e = w.events.at(-1)!;
    expect(e).toMatchObject({ type: 'ask', from: 'agent', to: a.id, owl: { id: q.id, options: ['yes', 'no', 'later'], expiresAt: w.now + ASK_TTL_S } });
    expect(w.askState(a.id, q.id)).toEqual({ state: 'open', expiresAt: w.now + ASK_TTL_S });
  });

  it('are answered once, with one of their options, before they expire', () => {
    const w = mk();
    const a = join(w, 'Alice');
    const q = w.owl(a.id, 'agent', 'Fight the troll?', ['yes', 'no']);
    expect(() => w.answerAsk(a.id, q.id, 'maybe')).toThrow(/not one of the options/);
    expect(() => w.answerAsk(a.id, 999, 'yes')).toThrow(/no such question/);
    const r = w.answerAsk(a.id, q.id, ' yes ');
    expect(r).toMatchObject({ from: 'player', text: 'yes', re: q.id });
    expect(q).toMatchObject({ answered: true, answer: 'yes' });
    expect(w.events.at(-1)).toMatchObject({ type: 'owl', from: 'player', to: a.id, owl: { id: r.id, re: q.id } });
    expect(() => w.answerAsk(a.id, q.id, 'no')).toThrow(/already answered/);
    expect(w.askState(a.id, q.id)).toEqual({ state: 'answered', answer: 'yes' });
    const plain = w.owl(a.id, 'agent', 'just saying');
    expect(() => w.answerAsk(a.id, plain.id, 'yes')).toThrow(/no such question/);
  });

  it('expire after ASK_TTL_S: the tick marks them "(expired)" and they can no longer be answered', () => {
    const w = mk();
    const a = join(w, 'Alice');
    const q = w.owl(a.id, 'agent', 'Quick, yes or no?', ['yes', 'no']);
    run(w, ASK_TTL_S - 1);
    expect(q.answered).toBeFalsy();
    run(w, 2.1);
    expect(q).toMatchObject({ answered: true, answer: '(expired)' });
    expect(() => w.answerAsk(a.id, q.id, 'yes')).toThrow(/expired/);
    expect(w.askState(a.id, q.id)).toEqual({ state: 'expired' });
    // and exactly at the deadline, before any sweep, it is already too late
    const q2 = w.owl(a.id, 'agent', 'Again?', ['yes', 'no']);
    w.now = q2.ask!.expiresAt;
    expect(() => w.answerAsk(a.id, q2.id, 'yes')).toThrow(/expired/);
  });
});

describe('what wakes an agent (the MCP wait/listen contract)', () => {
  it("the player's owls and answers wake it; its own tell_player never does", () => {
    const w = mk();
    const a = join(w, 'Alice'), b = join(w, 'Bob');
    const since = w.events.at(-1)!.id;
    w.owl(a.id, 'agent', 'I am off to the forest');
    expect(w.inboxFor(a.id, since)).toEqual([]);
    const q = w.owl(a.id, 'agent', 'Troll?', ['fight', 'flee']);
    expect(w.inboxFor(a.id, since)).toEqual([]);
    w.answerAsk(a.id, q.id, 'flee');
    w.owl(a.id, 'player', 'and bring snacks');
    expect(w.inboxFor(a.id, since).map((e) => [e.type, e.from, e.text])).toEqual([['owl', 'player', 'flee'], ['owl', 'player', 'and bring snacks']]);
    // public events wake it too, except its own chat; other wizards' private events never
    w.say(a, 'hello all');
    w.say(b, 'hi Alice');
    w.owl(b.id, 'player', 'secret for Bob');
    expect(w.inboxFor(a.id, since).map((e) => e.text)).toEqual(['flee', 'and bring snacks', 'Bob: hi Alice']);
  });

  it("listen: the player's owls since the watermark, which then moves past them (never backwards)", () => {
    const w = mk();
    const a = join(w, 'Alice');
    w.owl(a.id, 'player', 'one');
    w.owl(a.id, 'agent', 'noted');
    w.owl(a.id, 'player', 'two');
    expect(w.owlsFor(a.id).map((m) => m.text)).toEqual(['one', 'two']); // read-only
    expect(w.owlsFor(a.id).map((m) => m.text)).toEqual(['one', 'two']);
    expect(w.owlsFor(a.id, 1).map((m) => m.text)).toEqual(['two']);
    expect(w.takeOwls(a.id).map((m) => m.text)).toEqual(['one', 'two']);
    expect(a.agentReadUpTo).toBe(3);
    expect(w.takeOwls(a.id)).toEqual([]);
    w.markOwlsRead(a.id, 1);
    expect(a.agentReadUpTo).toBe(3);
    w.markOwlsRead(a.id, 999);
    expect(a.agentReadUpTo).toBe(3); // never past the last owl
    w.owl(a.id, 'player', 'three');
    expect(w.takeOwls(a.id).map((m) => m.text)).toEqual(['three']);
  });

  it('the owlbox, its ids and the watermark survive a restart; presence and the pause do not', () => {
    const w = mk();
    const a = join(w, 'Alice');
    w.owl(a.id, 'player', 'one');
    const q = w.owl(a.id, 'agent', 'ok?', ['yes', 'no']);
    w.takeOwls(a.id);
    w.setAgentGoal(a.id, 'hunt spiders');
    w.setAgentSeen(a.id, 'claude-code', 'look');
    w.setAgentPaused(a.id, true);
    const w2 = World.restore(JSON.parse(JSON.stringify(w.serialize())));
    const a2 = w2.wizards.get(a.id)!;
    expect(a2.owlbox).toEqual(a.owlbox);
    expect([a2.owlSeq, a2.agentReadUpTo, a2.agentGoal]).toEqual([2, 1, 'hunt spiders']);
    expect([a2.agentPaused, a2.agentSeen]).toEqual([false, null]);
    expect(w2.owl(a.id, 'player', 'after restart').id).toBe(3);
    w2.answerAsk(a.id, q.id, 'yes');
    // an old save without any of it
    const old = JSON.parse(JSON.stringify(w.serialize()));
    for (const x of old.wizards) { delete x.owlbox; delete x.owlSeq; delete x.agentReadUpTo; delete x.agentGoal; delete x.agentPaused; delete x.agentSeen; }
    const a3 = World.restore(old).wizards.get(a.id)!;
    expect([a3.owlbox, a3.owlSeq, a3.agentReadUpTo, a3.agentGoal, a3.agentPaused, a3.agentSeen]).toEqual([[], 0, 0, null, false, null]);
  });
});

describe('presence and the pause switch', () => {
  it("me.agent shows the agent's last call, rounded to 5 s so it does not change on every poll", () => {
    const w = mk();
    const a = join(w, 'Alice');
    expect(w.privateState(a.id).agent).toEqual({ seen: null, goal: null, paused: false });
    w.now = 101.3;
    w.setAgentSeen(a.id, 'claude-code', 'move_to');
    w.setAgentGoal(a.id, '  go   fight the spiders in the Forbidden Forest, all of them, every last one, eight legs or not, today  ');
    const s1 = JSON.stringify(w.privateState(a.id).agent);
    expect(w.privateState(a.id).agent).toEqual({ seen: { client: 'claude-code', tool: 'move_to', at: 100 }, goal: expect.any(String), paused: false });
    expect(w.privateState(a.id).agent.goal!.length).toBeLessThanOrEqual(80);
    w.now = 103.9;
    w.setAgentSeen(a.id, 'claude-code', 'move_to');
    expect(JSON.stringify(w.privateState(a.id).agent)).toBe(s1);
    w.now = 105;
    w.setAgentSeen(a.id, 'claude-code', 'move_to');
    expect(w.privateState(a.id).agent.seen!.at).toBe(105);
    expect(105 % AGENT_SEEN_ROUND_S).toBe(0);
    w.setAgentGoal(a.id, '');
    expect(w.privateState(a.id).agent.goal).toBeNull();
  });

  it('pausing refuses action tools (not reading, not talking), cancels the walk the agent set, and tells the agent why', () => {
    const w = mk();
    const a = join(w, 'Alice');
    w.setGoal(a.id, { x: 40, z: 22 }, 'agent');
    expect(a.goal).not.toBeNull();
    const since = w.events.at(-1)!.id;
    w.setAgentPaused(a.id, true);
    expect(a.goal).toBeNull();
    expect(w.privateState(a.id).agent.paused).toBe(true);
    for (const tool of ['look', 'whoami', 'events', 'armory', 'grimoire', 'leaderboard', 'listen', 'tell_player', 'set_goal_note']) expect(w.agentMayAct(a.id, tool), tool).toBe(true);
    for (const tool of ['cast', 'move_to', 'say', 'forge_item', 'forge_spell', 'use_item', 'equip_item', 'destroy_item', 'decree', 'stop', 'break_seal']) expect(w.agentMayAct(a.id, tool), tool).toBe(false);
    expect(() => w.setGoal(a.id, { x: 40, z: 22 }, 'agent')).toThrow(AGENT_PAUSED);
    expect(w.inboxFor(a.id, since).map((e) => e.text)).toEqual([expect.stringMatching(/paused your agent/)]); // wakes a waiting agent
    w.setAgentPaused(a.id, false);
    expect(w.agentMayAct(a.id, 'cast')).toBe(true);
    expect(AGENT_PAUSE_ALLOWED.has('cast')).toBe(false);
  });

  it("pausing keeps the player's own walk; the player's WASD cancels any walk; an agent cannot take the wheel while the player steers", () => {
    const w = mk();
    const a = join(w, 'Alice');
    w.setGoal(a.id, { x: 40, z: 22 }); // the player's click-to-move
    w.setAgentPaused(a.id, true);
    expect(a.goal).not.toBeNull();
    w.setAgentPaused(a.id, false);
    w.setGoal(a.id, null); // the player stops
    w.now += PLAYER_GRACE_S;
    w.setGoal(a.id, { x: 40, z: 22 }, 'agent');
    w.setInput(a.id, 0, 1);
    expect(a.goal).toBeNull();
    expect(() => w.setGoal(a.id, { x: 40, z: 22 }, 'agent')).toThrow(PLAYER_STEERING);
    w.setInput(a.id, 0, 0);
    expect(() => w.setGoal(a.id, { x: 40, z: 22 }, 'agent')).toThrow(PLAYER_STEERING); // just let go: the grace
    w.now += PLAYER_GRACE_S;
    expect(w.setGoal(a.id, { x: 40, z: 22 }, 'agent')).not.toBeNull();
    run(w, 1);
    expect(a.pos.x).toBeGreaterThan(24);
  });

  it("an agent never overrides or cancels the player's click-to-move: the human comes first", () => {
    const w = mk();
    const a = join(w, 'Alice');
    w.setGoal(a.id, { x: 26, z: 24 }); // the player clicks the ground (a few metres: the walk ends inside the 10 s below)
    const mine = { ...a.goal! };
    w.now += 10; // long after the click: the walk itself still has priority
    expect(() => w.setGoal(a.id, { x: 30, z: 26 }, 'agent')).toThrow(PLAYER_STEERING);
    expect(w.setGoal(a.id, null, 'agent')).toBeNull(); // the agent's stop ends only a walk the agent set
    expect([a.goal, a.goalBy]).toEqual([mine, 'player']);
    expect(w.playerSteering(a)).toBe(true);
    // the player's walk ends; the grace runs from the arrival, then the agent may walk again
    for (let t = 0; t < 10 && a.goal; t += 0.05) w.tick(0.05);
    expect(a.goal).toBeNull();
    expect(() => w.setGoal(a.id, { x: 30, z: 26 }, 'agent')).toThrow(PLAYER_STEERING);
    run(w, PLAYER_GRACE_S + 0.1);
    expect(w.playerSteering(a)).toBe(false);
    w.setGoal(a.id, { x: 30, z: 26 }, 'agent');
    expect(a.goalBy).toBe('agent');
    // a click replaces the agent's walk at once; the agent's stop leaves it alone
    w.setGoal(a.id, { x: 36, z: 30 });
    expect(a.goalBy).toBe('player');
    w.setGoal(a.id, null, 'agent');
    expect(a.goal).not.toBeNull();
    // and the agent's own stop does end the agent's own walk
    w.setGoal(a.id, null);
    w.now += PLAYER_GRACE_S;
    w.setGoal(a.id, { x: 30, z: 26 }, 'agent');
    w.setGoal(a.id, null, 'agent');
    expect([a.goal, a.goalBy]).toEqual([null, null]);
  });

  it('a paused agent keeps exactly the nine tools of §C.1: never the key, never a rebinding, nothing else', () => {
    const w = mk();
    const a = join(w, 'Alice');
    w.setAgentPaused(a.id, true);
    expect([...AGENT_PAUSE_ALLOWED].sort()).toEqual(['armory', 'events', 'grimoire', 'leaderboard', 'listen', 'look', 'set_goal_note', 'tell_player', 'whoami']);
    for (const tool of ['rotate_key', 'enroll', 'login', 'pair', 'read_seal_page', 'unlearn_spell', 'set_hotbar', 'wait', 'confirm_with_player', 'simulate_spell']) expect(w.agentMayAct(a.id, tool), tool).toBe(false);
    for (const tool of AGENT_PAUSE_ALLOWED) expect(AGENT_PAUSED).toContain(tool);
    expect(w.agentMayAct('wz_nobody', 'enroll')).toBe(true); // no wizard bound: nothing to pause
  });
});

describe('the wire', () => {
  it('wireEvent drops who (registry ids) and keeps everything a client renders', () => {
    const w = mk();
    const a = join(w, 'Alice');
    w.say(a, 'hello');
    const e = w.events.at(-1)!;
    expect(e.who).toEqual([a.id]);
    const wire = w.wireEvent(e);
    expect(wire).not.toHaveProperty('who');
    expect(wire).toMatchObject({ id: e.id, type: 'chat', text: 'Alice: hello', zh: 'Alice：hello' });
    expect(JSON.stringify(w.events.filter((x) => !x.to).map((x) => w.wireEvent(x)))).not.toMatch(/wz_/);
  });
});
