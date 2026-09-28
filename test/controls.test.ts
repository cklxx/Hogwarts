import { describe, expect, it } from 'vitest';
import { CURRICULUM } from '../src/lore/spells';
import { analyze } from '../src/runes/checker';
import { World, spellKind } from '../src/kernel/world';
import * as K from '../src/kernel/world';
import { AGENT_LIVE_S, agentView, clientLabel, curseText, routeChat, tokenFromUrl } from '../client/controls';
import { tr } from '../client/i18n';
import { SLOW_DOWN } from '../src/server/net';


describe('spell kinds (smart casting in the browser)', () => {
  it('classifies the standard curriculum', () => {
    const kind = Object.fromEntries(CURRICULUM.map((c) => [c.name, spellKind(analyze(c.source).effects)]));
    for (const n of ['Stupefy', 'Incendio', 'Expelliarmus', 'Glacius', 'Depulso', 'Petrificus Totalus', 'Bombarda', 'Reducto', 'Confringo']) expect(kind[n], n).toBe('harm');
    for (const n of ['Protego', 'Episkey', 'Ferula', 'Finite Incantatem', 'Rennervate', 'Vulnera Sanentur']) expect(kind[n], n).toBe('help');
    for (const n of ['Lumos', 'Tempus', 'Revelio', 'Serpensortia', 'Avis', 'Expecto Patronum', 'Point Me', 'Homenum Revelio', 'Apparition']) expect(kind[n], n).toBe('self');
  });
  it('a spell that both harms and helps aims at the foe', () => {
    expect(spellKind(['heal', 'bolt'])).toBe('harm');
    expect(spellKind([])).toBe('self');
  });
  it('privateState tells the client what each hotbar slot is for', () => {
    const w = new World();
    const { wizard } = w.enroll('Kind Tester');
    const bar = w.privateState(wizard.id).hotbar;
    expect(bar[0]).toMatchObject({ name: 'Stupefy', kind: 'harm' });
    expect(bar.find((s) => s?.name === 'Episkey')).toMatchObject({ kind: 'help' });
    expect(bar.find((s) => s?.name === 'Tempus')).toMatchObject({ kind: 'self' });
  });
});

describe('click-to-move (setGoal behind the goto message)', () => {
  it('walks toward the goal and WASD cancels the walk', () => {
    const w = new World();
    const { wizard } = w.enroll('Walker');
    w.touch(wizard.id);
    expect(w.setGoal(wizard.id, { x: 20, z: 10 })).toBeTruthy();
    const start = { ...wizard.pos };
    for (let i = 0; i < 20; i++) w.tick(0.05);
    expect(Math.hypot(wizard.pos.x - start.x, wizard.pos.z - start.z)).toBeGreaterThan(1);
    w.setInput(wizard.id, 1, 0);
    expect(wizard.goal).toBeNull();
  });
});

// ------------------------------------------------------------------ Owl Post client helpers (docs/AGENT_LINK.md §A.2, §C.1, §C.6)
describe('Owl Post in the browser', () => {
  it('the chat box sends @agent / @a lines to your agent and asks about any other @word', () => {
    expect(routeChat('hello all')).toEqual({ to: 'public', text: 'hello all' });
    expect(routeChat('@agent go to the forest')).toEqual({ to: 'agent', text: 'go to the forest' });
    expect(routeChat('@a 回来')).toEqual({ to: 'agent', text: '回来' });
    expect(routeChat('@Agent：先别打')).toEqual({ to: 'agent', text: '先别打' });
    expect(routeChat('@agent')).toBeNull();
    expect(routeChat('   ')).toBeNull();
    expect(routeChat('@agnet stay private')).toEqual({ to: 'ask', word: 'agnet', text: '@agnet stay private', rest: 'stay private' });
    expect(routeChat('@Harry duel me')).toMatchObject({ to: 'ask', word: 'Harry' });
    // "@alex" is not "@a"
    expect(routeChat('@alex hi')).toMatchObject({ to: 'ask', word: 'alex' });
    expect(routeChat('mail me@agent please')).toEqual({ to: 'public', text: 'mail me@agent please' });
  });

  it('a key handed over in the address is taken and wiped, other parameters stay', () => {
    expect(tokenFromUrl('http://h:7777/?q=low#k=r0.abcDEF_-9')).toEqual({ token: 'r0.abcDEF_-9', clean: '/?q=low' });
    expect(tokenFromUrl('http://h:7777/?token=abc&q=low')).toEqual({ token: 'abc', clean: '/?q=low' });
    expect(tokenFromUrl('http://h:7777/#k=abc&x=1')).toEqual({ token: 'abc', clean: '/#x=1' });
    expect(tokenFromUrl('http://h:7777/?q=low')).toEqual({ token: null, clean: null });
    expect(tokenFromUrl('http://h:7777/#k=')).toEqual({ token: null, clean: '/' });
    expect(tokenFromUrl('not a url')).toEqual({ token: null, clean: null });
  });

  it('the presence widget reads me.agent: seen time, session count, client name', () => {
    expect(clientLabel('claude-code')).toBe('Claude Code');
    expect(clientLabel('cursor-vscode')).toBe('Cursor Vscode');
    expect(clientLabel(undefined)).toBe('Agent');
    expect(agentView(null, 100)).toMatchObject({ connected: false, ago: null, paused: false });
    const seen = { seen: { client: 'claude-code', tool: 'move_to', at: 95 }, goal: '去禁林', paused: false };
    expect(agentView(seen, 103)).toEqual({ connected: true, client: 'Claude Code', ago: 8, tool: 'move_to', goal: '去禁林', paused: false });
    expect(agentView(seen, 95 + AGENT_LIVE_S).connected).toBe(false);
    expect(agentView({ ...seen, sessions: 1 }, 95 + AGENT_LIVE_S * 2).connected).toBe(true);
    expect(agentView({ ...seen, sessions: 0 }, 96).connected).toBe(false);
    expect(agentView({ paused: true }, 0)).toMatchObject({ connected: false, paused: true });
  });

  it('the widget works on the real privateState().agent, which never carries the key', () => {
    const w = new World();
    const { wizard } = w.enroll('Presence Tester');
    w.setAgentSeen(wizard.id, 'claude-code', 'look');
    w.setAgentGoal(wizard.id, 'find the pixies');
    const me = w.privateState(wizard.id);
    expect(JSON.stringify(me)).not.toContain(wizard.token);
    expect(agentView(me.agent, w.now)).toMatchObject({ connected: true, client: 'Claude Code', tool: 'look', goal: 'find the pixies' });
  });

  it('the curse banner names every jinx, the silence and a bound item, the cure and Revelio', () => {
    expect(curseText(null)).toBeNull();
    const c = curseText({ auras: [{ k: 'jelly', mag: 0.4, left: 12 }, { k: 'boils', mag: 3, left: 9 }], silenced: 4, bound: [{ id: 'i1', name: 'Jumper', slot: 'robe', left: 250 }], respite: 0, safe: false, pvp: true })!;
    expect(c.hexed).toBe(true);
    const all = [c.head, ...c.parts, c.cure, c.who].join(' ');
    for (const s of ['腿脚发软', '移速 −40%', '火疖子', '每秒 −3 生命，不会打晕你', '锁舌封喉', '「Jumper」', '250', '咒立停 Finite Incantatem', '原形立现 Revelio']) expect(all).toContain(s);
    expect(c.resting).toBeNull();
    expect(curseText({ auras: [{ k: 'dance', mag: 1, left: 5 }], silenced: 0, bound: [], respite: 0, safe: true, pvp: true })!.resting).toContain('安全区');
    expect(curseText({ auras: [{ k: 'bats', mag: 3, left: 5 }], silenced: 0, bound: [], respite: 0, safe: false, pvp: false })!.resting).toContain('决斗');
    const quiet = curseText({ auras: [], silenced: 0, bound: [], respite: 42 })!;
    expect(quiet.hexed).toBe(false);
    expect(quiet.respite).toContain('42');
  });

  it('the banner reads the real hexState of a jinxed victim and never names the sender', () => {
    const w = new World();
    const { wizard: v } = w.enroll('Hex Victim', 'Gryffindor');
    const { wizard: s } = w.enroll('Hex Sender', 'Slytherin');
    for (const x of [v, s]) { x.year = 3; x.createdAt = w.now - 1000; x.connections = 1; }
    v.pos = { x: 10, z: 30 };
    s.galleons = 500;
    w.forgeItem(s.id, v.id, { name: 'Itchy Robe', slot: 'robe', mods: { speed: -10 }, lore: 'Furnunculus!' });
    const c = curseText(w.privateState(v.id).hex)!;
    expect(c.hexed).toBe(true);
    expect(c.parts.join(' ')).toContain('火疖子');
    expect(c.parts.join(' ')).toContain('Itchy Robe');
    expect(JSON.stringify(c)).not.toContain(s.name);
    expect(JSON.stringify(c)).not.toContain(s.id);
  });

  it('every refusal a player can meet from the Owl Post, the trunk and the hex gates has a Chinese translation', () => {
    const msgs = [
      K.PAIR_REFUSAL, K.PAIR_THROTTLED, K.AGENT_PAUSED, K.PLAYER_STEERING, K.OWLBOX_UNREAD, K.FORGE_REFUSAL, K.SILENCED, K.BOUND_REFUSAL, `${K.BOUND_REFUSAL} (42s)`, K.CURSE_BLESS,
      'Your owlbox is full of questions still waiting for an answer.', 'An owl needs a message.', 'Too many owls this minute; the owlery needs a rest.',
      'There is no such question.', 'That question has expired.', 'That question was already answered.', 'That is not one of the options.',
      'Only an agent asks questions with options.', 'NPCs do not pair with agents.', 'No item "i_12" in your trunk.', 'No item "i_12".',
      'The Elder Wand cannot be destroyed. Harry tried to put it back instead.', 'You have not learned the Dark Arts yet. (Come back in year 2.)',
      'The forge will not post curses for a wizard who enrolled less than 10 minutes ago.', 'You cursed that wizard recently. The forge makes you wait 120s.',
      'This nastiness costs 30 Galleons (malice tax included); you have 4.', 'Forging this costs 12 Galleons; you have 3. Defeat creatures to earn more.',
      'Too much enchantment: 12 points > your budget of 8 (year 2).', "Neville's trunk is full (20 items).", SLOW_DOWN,
      'The Sorting Hat needs a rest: too many enrolments from here. Try again in a few minutes.',
    ];
    for (const m of msgs) {
      const zh = tr(m);
      expect(zh, m).not.toBe(m);
      expect(/[一-鿿]/.test(zh), m).toBe(true);
    }
    expect(tr(`${K.BOUND_REFUSAL} (42s)`)).toContain('42');
  });
});
