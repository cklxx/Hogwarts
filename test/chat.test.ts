/** 聊天 (src/kernel/chat.ts): channels deliver to the right people, and nothing private reaches the wire. */
import { describe, expect, it } from 'vitest';
import { CHAT_BURST, CHAT_NEAR_M, chatRead, chatSend } from '../src/kernel/chat.js';
import { visibleTo } from '../src/kernel/types.js';
import { World } from '../src/kernel/world.js';
import type { Wizard } from '../src/kernel/types.js';

function mk() {
  const w = new World({ seed: 3, secret: 'chat' });
  w.rules.creatures.spawnMultiplier = 0;
  return w;
}
function wiz(w: World, name: string, house: string, x = 0): Wizard {
  const a = w.enroll(name, house as never).wizard;
  a.connections = 1;
  a.pos = { x, z: 0 };
  return a;
}
const last = (w: World) => w.events.at(-1)!;

describe('chat channels', () => {
  it('all is public (say); house reaches the house only; near reaches those within range; dm reaches the two', () => {
    const w = mk();
    const harry = wiz(w, 'Harry', 'Gryffindor'), ron = wiz(w, 'Ron', 'Gryffindor', 200), draco = wiz(w, 'Draco', 'Slytherin', 10), luna = wiz(w, 'Luna', 'Ravenclaw', CHAT_NEAR_M + 20);
    chatSend(w, harry.id, { text: 'hello school' });
    expect(last(w)).toMatchObject({ type: 'chat', text: 'Harry: hello school' });
    expect(visibleTo(last(w), luna.id)).toBe(true);

    chatSend(w, harry.id, { text: 'meet at the tower', ch: 'house' });
    const house = last(w);
    expect(house).toMatchObject({ ch: 'house' });
    expect([harry, ron, draco, luna].map((x) => visibleTo(house, x.id))).toEqual([true, true, false, false]);

    chatSend(w, harry.id, { text: 'psst', ch: 'near' });
    const near = last(w);
    expect([harry, ron, draco, luna].map((x) => visibleTo(near, x.id))).toEqual([true, false, true, false]);
    expect(harry.say?.text).toBe('psst'); // a bubble for those who can see him

    chatSend(w, harry.id, { text: 'truce?', ch: 'dm', to: draco.handle });
    const dm = last(w);
    expect([harry, ron, draco, luna].map((x) => visibleTo(dm, x.id))).toEqual([true, false, true, false]);
    expect(w.wireEvent(dm)).not.toHaveProperty('aud'); // registry ids never on the wire
    expect(() => chatSend(w, harry.id, { text: 'hi', ch: 'dm', to: draco.id })).toThrow(/whom|发给谁/); // not by someone else's registry id

    expect(chatRead(w, ron.id).map((l) => l.ch)).toEqual(['all', 'house']);
    expect(chatRead(w, draco.id, { ch: 'dm' })).toMatchObject([{ text: expect.stringContaining('truce?'), private: true }]);
  });

  it('refuses a line with your own key, while silenced, and past the burst', () => {
    const w = mk();
    const a = wiz(w, 'Hermione', 'Gryffindor');
    expect(() => chatSend(w, a.id, { text: `my key is ${a.token}` })).toThrow(/Owl Post key/);
    expect(w.events.some((e) => e.text.includes(a.token))).toBe(false);
    for (let i = 0; i < CHAT_BURST; i++) chatSend(w, a.id, { text: `line ${i}`, ch: 'house' });
    expect(() => chatSend(w, a.id, { text: 'one more', ch: 'house' })).toThrow(/Slow down|慢一点/);
    w.now += 11;
    expect(chatSend(w, a.id, { text: 'later', ch: 'house' })).toMatchObject({ sent: 'house' });
  });
});

describe('chat in the browser', () => {
  it('routes /h /n /w (and the Chinese words) to their channels, @agent to the agent, the rest to the school', async () => {
    const { routeChat } = await import('../client/controls.js');
    expect(routeChat('hello')).toEqual({ to: 'public', text: 'hello' });
    expect(routeChat('/h tower at nine')).toEqual({ to: 'public', text: 'tower at nine', ch: 'house' });
    expect(routeChat('/学院 集合')).toEqual({ to: 'public', text: '集合', ch: 'house' });
    expect(routeChat('/n psst')).toEqual({ to: 'public', text: 'psst', ch: 'near' });
    expect(routeChat('/w draco truce?')).toEqual({ to: 'public', text: 'truce?', ch: 'dm', dm: 'draco' });
    expect(routeChat('/私 luna 你好')).toEqual({ to: 'public', text: '你好', ch: 'dm', dm: 'luna' });
    expect(routeChat('/w draco')).toBeNull(); // nothing to say
    expect(routeChat('/hello there')).toEqual({ to: 'public', text: '/hello there' }); // not a channel word
    expect(routeChat('@agent come here')).toEqual({ to: 'agent', text: 'come here' });
  });

  it('the log splits the kernel\'s lines into label, name (a whisper button) and words, per tab', async () => {
    const { chatRows } = await import('../client/panels/chat.js');
    const w = mk();
    const a = wiz(w, 'Harry', 'Gryffindor'), b = wiz(w, 'Ron', 'Gryffindor', 5);
    chatSend(w, a.id, { text: 'hi all' });
    chatSend(w, a.id, { text: 'house only', ch: 'house' });
    const evs = w.events.filter((e) => e.type === 'chat').map((e) => w.wireEvent(e)) as Parameters<typeof chatRows>[0];
    expect(chatRows(evs, 'all', false)).toMatchObject([{ name: 'Harry', words: 'hi all', label: '' }, { name: 'Harry', words: 'house only', label: '[Gryffindor]', ch: 'house' }]);
    expect(chatRows(evs, 'house', true)).toMatchObject([{ name: 'Harry', words: 'house only', label: '[学院]' }]);
    void b;
  });
});

describe('one name, one wizard', () => {
  it('refuses names that only look different: case, spacing, punctuation, accents, full-width and Cyrillic letters', async () => {
    const { nameKey } = await import('../src/kernel/identity.js');
    const w = mk();
    w.enroll('Harry Potter');
    for (const n of ['harry potter', 'Harry_Potter', 'Harry.Potter', 'Hárry Potter', 'Ｈａｒｒｙ Potter', 'Hаrry Potter', 'HARRY-POTTER']) {
      expect(() => w.enroll(n), n).toThrow(/taken|已被占用/);
    }
    expect(w.enroll('Harry Potts').wizard.name).toBe('Harry Potts');
    w.enroll('赫敏');
    expect(() => w.enroll('赫敏')).toThrow(/已被占用/);
    expect(nameKey('Hаrry')).toBe(nameKey('Harry'));
    expect(nameKey('Luna')).not.toBe(nameKey('Lune'));
  });
});
