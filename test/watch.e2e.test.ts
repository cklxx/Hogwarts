/**
 * 观战 end to end (docs/TODO.md P4): an agent plays over MCP; a friend watches through the owner's link over a
 * read-only WebSocket; the owner revokes the link.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

const PORT = Number(process.env.HOGWARTS_WATCH_PORT ?? 9140 + Math.floor(Math.random() * 10));
const BASE = `http://127.0.0.1:${PORT}`;
let proc: ChildProcess;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hogwarts-watch-'));
  proc = spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts'], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', HOGWARTS_DATA: join(dir, 'world.json'), PUBLIC_URL: BASE, NPC_COUNT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((ok, bad) => {
    const t = setTimeout(() => bad(new Error('server did not start')), 60000);
    proc.stdout!.on('data', (d) => { if (String(d).includes('per term')) { clearTimeout(t); ok(); } });
  });
}, 70000);
afterAll(() => { proc?.kill('SIGTERM'); });

/** Every message a socket gets, and a way to wait for one. */
function tap(ws: WebSocket) {
  const got: any[] = [];
  ws.on('message', (raw) => { try { got.push(JSON.parse(String(raw))); } catch { /* not ours */ } });
  const wait = (pred: (m: any) => boolean, ms = 8000) => new Promise<any>((ok, bad) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const m = got.find(pred);
      if (m) { clearInterval(iv); ok(m); } else if (Date.now() - t0 > ms) { clearInterval(iv); bad(new Error('timed out')); }
    }, 50);
  });
  return { got, wait };
}
const open = (url: string) => new Promise<WebSocket>((ok, bad) => { const ws = new WebSocket(url); ws.once('open', () => ok(ws)); ws.once('error', bad); ws.once('unexpected-response', (_r, res) => bad(new Error(`HTTP ${res.statusCode}`))); });

describe('观战: watching an agent play', () => {
  it('a friend watches through the owner\'s link, sees what the agent does (not its spell source), cannot act, and is cut off on revoke', async () => {
    // the agent enrols and plays over MCP
    const agent = new Client({ name: 'watch-test-agent', version: '0' });
    await agent.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`)));
    const call = async (name: string, args: Record<string, unknown> = {}) => JSON.parse(((await agent.callTool({ name, arguments: args })) as any).content[0].text);
    const me = await call('enroll', { name: 'Watched Owl' });
    const token = me.token as string;

    // the owner's browser tab makes a watch link
    const owner = await open(`ws://127.0.0.1:${PORT}/ws?token=${encodeURIComponent(token)}&aoi=1`);
    const o = tap(owner);
    await o.wait((m) => m.t === 'welcome');
    owner.send(JSON.stringify({ t: 'watchlink' }));
    const { code } = await o.wait((m) => m.t === 'watchlink' && m.code);
    expect(code).not.toContain(token);
    expect((await (await fetch(`${BASE}/api/watch?watch=${encodeURIComponent(code)}`)).json())).toMatchObject({ ok: true, name: 'Watched Owl' });

    // a friend opens it
    const friend = await open(`ws://127.0.0.1:${PORT}/ws?watch=${encodeURIComponent(code)}&aoi=1`);
    const f = tap(friend);
    expect((await f.wait((m) => m.t === 'watching')).s).toMatchObject({ name: 'Watched Owl', handle: me.handle ?? expect.any(String) });
    await f.wait((m) => m.t === 'snap');

    // the agent forges and casts; the agent walks somewhere
    await call('forge_spell', { name: 'Glowworm', source: '(light)' });
    await call('cast', { spell: 'Glowworm' });
    const start = await call('whoami');
    await call('move_to', { x: start.x + 12, z: start.z });

    // the friend mashes keys and casts: nothing they send is read
    for (let i = 0; i < 10; i++) { friend.send(JSON.stringify({ t: 'input', dx: -1, dz: 0 })); friend.send(JSON.stringify({ t: 'cast', key: '1' })); }

    const w = await f.wait((m) => m.t === 'watch' && m.s.agent.log.some((c: any) => c.tool === 'cast' && c.spell === 'Glowworm'), 10000);
    const cast = w.s.agent.log.find((c: any) => c.tool === 'cast');
    expect(cast.ok).toBe(true);
    expect(cast).not.toHaveProperty('source'); // spell source stays the owner's secret
    expect(JSON.stringify(f.got)).not.toContain(token);
    // the owner's tab gets the same log, with the source
    const mine = await o.wait((m) => m.t === 'agentlog' && m.s.log.some((c: any) => c.tool === 'cast'));
    expect(mine.s.log.find((c: any) => c.tool === 'cast').source).toBe('(light)');

    // the agent's walk went on despite the friend's keys
    await new Promise((r) => setTimeout(r, 2500));
    const after = await call('whoami');
    expect(after.x).toBeGreaterThan(start.x + 3);

    // anyone may follow the wizard by handle while the agent plays (unless the player turns it off)
    expect((await fetch(`${BASE}/api/watch?follow=${after.handle}`)).status).toBe(200);
    owner.send(JSON.stringify({ t: 'watchable', on: false }));
    await o.wait((m) => m.t === 'watchlink' && m.watchable === false);
    expect((await fetch(`${BASE}/api/watch?follow=${after.handle}`)).status).toBe(404);

    // revoke: the friend is cut off, the link is dead
    const closed = new Promise<number>((ok) => friend.once('close', (c) => ok(c)));
    owner.send(JSON.stringify({ t: 'watchrevoke' }));
    expect(await closed).toBe(4003);
    expect((await fetch(`${BASE}/api/watch?watch=${encodeURIComponent(code)}`)).status).toBe(404);
    await expect(open(`ws://127.0.0.1:${PORT}/ws?watch=${encodeURIComponent(code)}`)).rejects.toThrow(/404/);
    owner.close();
    await agent.close();
  }, 60000);
});
