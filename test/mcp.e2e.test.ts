import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

const PORT = Number(process.env.HOGWARTS_TEST_PORT ?? 17000 + Math.floor(Math.random() * 1000));
const BASE = `http://127.0.0.1:${PORT}`;
let proc: ChildProcess;

async function client(token?: string) {
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), token ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : undefined));
  return c;
}
async function call(c: Client, name: string, args: Record<string, unknown> = {}) {
  const r = (await c.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  const text = r.content[0].text;
  let data: unknown = text;
  try { data = JSON.parse(text); } catch { /* plain text */ }
  return { data: data as any, isError: !!r.isError, text };
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hogwarts-'));
  proc = spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts'], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', HOGWARTS_DATA: join(dir, 'world.json'), PUBLIC_URL: BASE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((ok, bad) => {
    const t = setTimeout(() => bad(new Error('server did not start')), 60000);
    proc.stdout!.on('data', (d) => { if (String(d).includes('[hogwarts]')) { clearTimeout(t); ok(); } });
    proc.stderr!.on('data', (d) => process.stderr.write(d));
  });
}, 70000);
afterAll(() => { proc?.kill('SIGTERM'); });

describe('MCP over streamable HTTP', () => {
  it('lets an agent enroll, read the grimoire, forge and cast a spell, and find the loophole', async () => {
    const c = await client();
    const tools = (await c.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(['enroll', 'whoami', 'armory', 'grimoire', 'forge_spell', 'cast', 'forge_item', 'decree', 'look']));

    const unbound = await call(c, 'whoami');
    expect(unbound.isError).toBe(true);

    const e = await call(c, 'enroll', { name: 'Agent Fred', house_preference: 'Gryffindor' });
    expect(e.isError).toBe(false);
    expect(e.data.token).toBeTruthy();
    const me = await call(c, 'whoami');
    expect(me.data.house).toBe('Gryffindor');
    expect(me.data.registry).toMatch(/^wz_/);
    expect(me.data.quote.zh).toMatch(/[一-鿿]/); // a line of flavour for the agent (lore/memes.ts)
    expect(me.data.quote.en).toBeTruthy();

    const g = await call(c, 'grimoire');
    expect(g.text).toContain('RUNES');
    expect(g.text).toContain('(bolt at power element?)');

    const bad = await call(c, 'forge_spell', { name: 'Oops', source: '(bolt target' });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/unclosed/);
    expect(bad.text).toMatch(/🪄/); // and a joke about it (spells are code)

    const f = await call(c, 'forge_spell', { name: 'Frostbite', incantation: 'Glacies Mordax!', source: '(bolt (ahead 12) 12 :ice)', slot: 6 });
    expect(f.isError).toBe(false);
    expect(f.data.dryRunNow.ok).toBe(true);

    const cast = await call(c, 'cast', { spell: 'Frostbite' });
    expect(cast.data.ok).toBe(true);
    expect(cast.data.mana).toBeGreaterThan(0);

    const walk = await call(c, 'move_to', { landmark: 'great_hall' });
    expect(walk.isError).toBe(false);
    const waited = await call(c, 'wait', { seconds: 15, until: 'arrived' });
    expect(waited.data.reason).toBe('arrived');
    expect(waited.data.at.place).toBe('The Great Hall');

    const look = await call(c, 'look');
    expect(look.data.you.place).toBeTruthy();
    expect(look.data.time.remark.zh).toMatch(/[一-鿿]/);

    // A second wizard, via a second agent session using a token header.
    const c2 = await client();
    const e2 = await call(c2, 'enroll', { name: 'Agent George' });
    const c2b = await client(e2.data.token);
    expect((await call(c2b, 'whoami')).data.name).toBe('Agent George');

    // Find George's registry number the canon way...
    await call(c, 'say', { text: 'I solemnly swear that I am up to no good' });
    const map = await call(c, 'marauders_map');
    const george = map.data.find((x: any) => x.name === 'Agent George');
    expect(george.registry).toMatch(/^wz_/);
    // ...and exploit the forge.
    const gift = await call(c, 'forge_item', { wizard_id: george.registry, name: 'Canary Cream', slot: 'trinket', mods: { speed: 5 } });
    expect(gift.isError).toBe(false);
    expect(gift.data.notes.join(' ')).toMatch(/Weasley Loophole/);
    const trunk = await call(c2b, 'armory');
    expect(trunk.data.items[0].name).toBe('Canary Cream');

    const d = await call(c, 'decree', { patch: { combat: { damageMultiplier: 2 } } });
    expect(d.isError).toBe(true);
    expect(d.text).toMatch(/Minister/);

    const lb = await call(c, 'leaderboard');
    expect(lb.data.loopholeFirstFoundBy).toBe('Agent Fred');
  });

  it('limits refused forge parcels per wizard, not per session', async () => {
    const c = await client();
    const e = await call(c, 'enroll', { name: 'Forge Prober' });
    let throttled = false;
    for (let i = 0; i < 14 && !throttled; i++) {
      const r = await call(c, 'forge_item', { wizard_id: `wz_nobody${i}`, name: 'x', slot: 'trinket', mods: { speed: 1 } });
      throttled = /refused too many/.test(r.text);
    }
    expect(throttled).toBe(true);
    const c2 = await client(e.data.token); // a new session with the same key does not reset it
    expect((await call(c2, 'forge_item', { wizard_id: 'wz_nobodyz', name: 'x', slot: 'trinket', mods: { speed: 1 } })).text).toMatch(/refused too many/);
  });

  it('serves the 3D client protocol over WebSocket', async () => {
    const r = await fetch(`${BASE}/api/enroll`, { method: 'POST', body: JSON.stringify({ name: 'Browser Kid' }) });
    const { token } = (await r.json()) as { token: string };
    // the key comes from a header or the browser's subprotocol entry, never from the address
    expect((await fetch(`${BASE}/api/me?token=${encodeURIComponent(token)}`)).status).toBe(401);
    const opened = (ws: WebSocket) => new Promise<string>((ok) => { ws.on('message', (m) => ok(JSON.parse(String(m)).t)); ws.on('unexpected-response', (_q, res) => ok(`HTTP ${res.statusCode}`)); ws.on('error', () => ok('error')); });
    expect(await opened(new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${encodeURIComponent(token)}`))).toBe('HTTP 401');
    const browser = new WebSocket(`ws://127.0.0.1:${PORT}/ws?aoi=1`, ['hogwarts', `hw-key.${token}`]); // what client/main.ts sends
    expect(await opened(browser)).toBe('welcome');
    expect(browser.protocol).toBe('hogwarts'); // the key entry is never echoed back
    browser.close();
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { authorization: `Bearer ${token}` } });
    const got = new Set<string>();
    let bought: unknown = null, build: unknown = null;
    await new Promise<void>((ok) => {
      ws.on('message', (m) => {
        const msg = JSON.parse(String(m));
        got.add(msg.t);
        if (msg.t === 'welcome') build = msg.build;
        if (msg.t === 'welcome') { ws.send(JSON.stringify({ t: 'cast', key: '1' })); ws.send(JSON.stringify({ t: 'buy', item: 'amulet' })); }
        if (msg.t === 'bought') bought = msg.r;
        if (got.has('welcome') && got.has('snap') && got.has('me') && got.has('cast') && got.has('bought')) ok();
      });
    });
    expect([...got]).toEqual(expect.arrayContaining(['welcome', 'snap', 'me', 'cast', 'bought']));
    // the browser shop: a preset forged into your own trunk and worn (src/server/shop.ts)
    expect(bought).toMatchObject({ item: '生命护符', slot: 'amulet', equipped: true });
    // what the server is (GET /api/version): the build in the welcome is the one it reports, so a tab can tell it is stale
    const v = (await (await fetch(`${BASE}/api/version`)).json()) as { build: string; protocol: number; players: number; version: string };
    expect(v).toMatchObject({ protocol: 1, version: expect.any(String) });
    expect(v.players).toBeGreaterThanOrEqual(1);
    expect(build).toBe(v.build);

    // the O.W.L. exams panel: {t:'exams'} lists the week, {t:'sit'} grades a submission (kernel/exams.ts)
    const next = (t: string) => new Promise<any>((ok, bad) => {
      const timer = setTimeout(() => bad(new Error(`no ${t}`)), 8000);
      const on = (raw: WebSocket.RawData) => { const m = JSON.parse(String(raw)); if (m.t === t || m.t === 'err') { clearTimeout(timer); ws.off('message', on); ok(m); } };
      ws.on('message', on);
    });
    ws.send(JSON.stringify({ t: 'exams' }));
    const list = await next('exams');
    expect(list.r.exams.length).toBeGreaterThanOrEqual(5);
    const open = list.r.exams.find((e: { locked?: string }) => !e.locked);
    ws.send(JSON.stringify({ t: 'sit', id: open.id, source: '(say' }));
    const sat = await next('sat');
    expect(sat.r.grade).toBe('T');
    expect(sat.r.log).toMatch(/FAIL/);
    ws.close();
  });

  it('links a player and their agent: pair, owls, pause, rotate — and never leaks the key', async () => {
    const r = await fetch(`${BASE}/api/enroll`, { method: 'POST', body: JSON.stringify({ name: 'Owl Keeper' }) });
    const { token } = (await r.json()) as { token: string };
    const wsMsgs: string[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { authorization: `Bearer ${token}` } });
    const next = (pred: (m: any) => boolean, ms = 8000) => new Promise<any>((ok, bad) => {
      const t = setTimeout(() => bad(new Error('ws timeout')), ms);
      const on = (raw: WebSocket.RawData) => { const m = JSON.parse(String(raw)); if (pred(m)) { clearTimeout(t); ws.off('message', on); ok(m); } };
      ws.on('message', on);
    });
    ws.on('message', (raw) => wsMsgs.push(String(raw)));
    const welcome = await next((m) => m.t === 'welcome');
    expect(welcome.token).toBeUndefined();
    expect(welcome.registry).toMatch(/^wz_/);

    // pairing: the browser mints a code, a token-less agent session redeems it
    ws.send(JSON.stringify({ t: 'paircode' }));
    const pc = await next((m) => m.t === 'paircode');
    expect(pc.code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    const agent = await client();
    const mcpTexts: string[] = [];
    const say = async (name: string, args: Record<string, unknown> = {}) => { const x = await call(agent, name, args); if (!['pair', 'rotate_key'].includes(name)) mcpTexts.push(x.text); return x; };
    const paired = await say('pair', { code: pc.code.toLowerCase() });
    expect(paired.isError).toBe(false);
    expect(paired.data.registry).toBe(welcome.registry);
    expect(paired.data.connect.claudeCode).toContain('${HOGWARTS_TOKEN}');
    expect(JSON.stringify(paired.data.connect)).not.toContain(token);
    expect((await say('pair', { code: pc.code })).isError).toBe(true); // single use
    const who = await say('whoami');
    expect(who.data.agents).toEqual({ sessions: 1, clients: 1 });

    // tell_player with a question -> browser answers -> listen
    const asked = await say('tell_player', { text: 'Forest or lake?', options: ['forest', 'lake'] });
    expect(asked.data.question).toBe(true);
    const ask = await next((m) => m.t === 'event' && m.e.type === 'ask');
    expect(ask.e.from).toBe('agent');
    expect(ask.e.who).toBeUndefined();
    ws.send(JSON.stringify({ t: 'answer', id: ask.e.owl.id, choice: 'lake' }));
    ws.send(JSON.stringify({ t: 'owl', text: 'hello agent' }));
    await new Promise((ok) => setTimeout(ok, 300));
    const heard = await say('listen', { seconds: 5 });
    expect(heard.data.owls.map((o: any) => o.text)).toEqual(['lake', 'hello agent']);
    expect(heard.data.owls[0].answers).toBe(asked.data.sent);
    const owls = await (await fetch(`${BASE}/api/owls?since=0`, { headers: { Authorization: `Bearer ${token}` } })).json() as any;
    expect(owls.owls.length).toBe(2);
    expect((await fetch(`${BASE}/api/owls`, { headers: { Authorization: 'Bearer nope-nope-nope' } })).status).toBe(401);

    // pause: actions refused, talking allowed
    ws.send(JSON.stringify({ t: 'pause', on: true }));
    await new Promise((ok) => setTimeout(ok, 300));
    const refused = await say('cast', { spell: '1' });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/paused/);
    expect((await say('look')).isError).toBe(false);
    expect((await say('set_goal_note', { goal: 'waiting for my human' })).isError).toBe(false);
    ws.send(JSON.stringify({ t: 'pause', on: false }));
    await new Promise((ok) => setTimeout(ok, 300));
    expect((await say('look')).isError).toBe(false);

    // a key in the arguments is refused
    expect((await say('say', { text: `my key is ${token}` })).text).toMatch(/Owl Post key/);
    mcpTexts.pop();

    /** Another browser socket (e.g. a thief who had the key), recording what it gets and how it closes. */
    const sock = (tok: string) => {
      const s = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { authorization: `Bearer ${tok}` } });
      const msgs: any[] = [];
      s.on('message', (raw) => { wsMsgs.push(String(raw)); msgs.push(JSON.parse(String(raw))); });
      const closed = new Promise<number>((ok) => s.on('close', (code) => ok(code)));
      const opened = new Promise((ok) => s.once('open', ok));
      return { s, msgs, closed, opened };
    };

    // the agent rotates: old key dead, new key works, other agent sessions closed, caller kept, and every
    // browser socket closed WITHOUT being sent the new key (one of them may be a thief's)
    const other = await client(token);
    expect((await call(other, 'whoami')).data.registry).toBe(welcome.registry);
    const thief = sock(token);
    await thief.opened;
    const ownerClosed = new Promise<number>((ok) => ws.on('close', (code) => ok(code)));
    const rot = await say('rotate_key');
    expect(rot.isError).toBe(false);
    const fresh = rot.data.token as string;
    expect(fresh).not.toBe(token);
    expect(await thief.closed).toBe(4001);
    expect(await ownerClosed).toBe(4001);
    expect(thief.msgs.some((m) => m.t === 'token')).toBe(false);
    expect(wsMsgs.some((m) => m.includes(fresh))).toBe(false);
    expect((await fetch(`${BASE}/api/me`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
    const meNew = await fetch(`${BASE}/api/me`, { headers: { authorization: `Bearer ${fresh}` } });
    expect(meNew.status).toBe(200);
    expect(JSON.stringify(await meNew.json())).not.toContain(fresh);
    expect((await call(await client(token), 'whoami')).isError).toBe(true);
    expect((await call(await client(fresh), 'whoami')).data.registry).toBe(welcome.registry);
    await expect(call(other, 'whoami')).rejects.toThrow();
    expect((await say('whoami')).isError).toBe(false);

    // the browser rotates: only the socket that asked gets the new key; the wizard's other socket is closed
    const owner = sock(fresh), tab2 = sock(fresh);
    await owner.opened; await tab2.opened;
    owner.s.send(JSON.stringify({ t: 'rotate' }));
    expect(await tab2.closed).toBe(4001);
    const t0 = Date.now();
    while (!owner.msgs.some((m) => m.t === 'token') && Date.now() - t0 < 5000) await new Promise((ok) => setTimeout(ok, 100));
    const third = owner.msgs.find((m) => m.t === 'token').token as string;
    expect(third).not.toBe(fresh);
    expect(tab2.msgs.some((m) => m.t === 'token')).toBe(false);
    await expect(say('whoami')).rejects.toThrow(); // the browser's rotation closed the agent session too

    // confirm with the browser connected: the player declines (a new agent session with the new key)
    const agent2 = await client(third);
    const q = new Promise<any>((ok) => owner.s.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.t === 'event' && m.e.type === 'ask') ok(m); }));
    const conf = call(agent2, 'confirm_with_player', { question: 'Destroy everything?', timeout_seconds: 10 });
    const asked2 = await q;
    owner.s.send(JSON.stringify({ t: 'answer', id: asked2.e.owl.id, choice: asked2.e.owl.options[1] }));
    expect((await conf).data.approved).toBe(false);
    // ...and that answer is not handed to the agent a second time as a message from its human
    const after = await call(agent2, 'listen', { seconds: 1 });
    expect(after.data.owls).toEqual([]);

    owner.s.close();
    await new Promise((ok) => setTimeout(ok, 300));
    // no browser, no elicitation: nobody to ask
    const none = await call(agent2, 'confirm_with_player', { question: 'Sure?', timeout_seconds: 5 });
    expect(none.data).toEqual({ approved: false, via: 'none', reason: 'no human reachable' });

    // a right key is never throttled, however many wrong keys the same address sent
    for (let i = 0; i < 22; i++) await fetch(`${BASE}/api/me`, { headers: { authorization: `Bearer bogus-key-${i}` } });
    expect((await fetch(`${BASE}/api/me`, { headers: { authorization: `Bearer bogus-key-x` } })).status).toBe(429);
    expect((await fetch(`${BASE}/api/me`, { headers: { authorization: `Bearer ${third}` } })).status).toBe(200);
    expect((await fetch(`${BASE}/api/owls`, { headers: { Authorization: `Bearer ${third}` } })).status).toBe(200);

    expect((await call(await client(third), 'whoami')).isError).toBe(false); // MCP with the right key too

    for (const t of [token, fresh, third]) {
      expect(wsMsgs.filter((m) => !m.startsWith('{"t":"token"')).some((m) => m.includes(t))).toBe(false);
      expect(mcpTexts.some((m) => m.includes(t))).toBe(false);
    }
  });
});
