import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

// REALMS=2 behind one front door (src/server/realms.ts): pairing codes "K-ABC-DEF" route to realm K.
const PORT = Number(process.env.HOGWARTS_REALMS_TEST_PORT ?? 8062);
const BASE = `http://127.0.0.1:${PORT}`;
let proc: ChildProcess;

async function client(token?: string) {
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), token ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : undefined));
  return c;
}
async function call(c: Client, name: string, args: Record<string, unknown> = {}) {
  const r = (await c.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  let data: any = r.content[0].text;
  try { data = JSON.parse(r.content[0].text); } catch { /* text */ }
  return { data, isError: !!r.isError, text: r.content[0].text };
}
async function player(name: string) {
  const { token } = (await (await fetch(`${BASE}/api/enroll`, { method: 'POST', body: JSON.stringify({ name }) })).json()) as { token: string };
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { authorization: `Bearer ${token}` } });
  const welcome = await new Promise<any>((ok) => ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.t === 'welcome') ok(m); }));
  const code = new Promise<string>((ok) => ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.t === 'paircode') ok(m.code); }));
  ws.send(JSON.stringify({ t: 'paircode' }));
  return { token, ws, registry: welcome.registry as string, code: await code, realm: Number(/^r(\d+)\./.exec(token)![1]) };
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hogwarts-realms-'));
  proc = spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts'], {
    env: { ...process.env, REALMS: '2', PORT: String(PORT), HOST: '127.0.0.1', HOGWARTS_DATA: join(dir, 'world.json'), PUBLIC_URL: BASE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const t0 = Date.now();
  for (;;) {
    if (Date.now() - t0 > 90000) throw new Error('realms did not start');
    const r = await fetch(`${BASE}/api/realms`).then((x) => x.json()).catch(() => null) as any;
    if (r?.realms?.length === 2 && r.realms.every((x: any) => x.up)) break;
    await new Promise((ok) => setTimeout(ok, 300));
  }
}, 100000);
afterAll(() => { proc?.kill('SIGTERM'); });

describe('REALMS pairing codes', () => {
  it('routes a code to its realm, and a refused code leaves a bound session bound', async () => {
    const a = await player('Realm One');
    const b = await player('Realm Two');
    expect(a.code).toMatch(new RegExp(`^${a.realm}-`));
    // a fresh session lands wherever the front door puts it; both codes must work from there
    for (const p of [a, b]) {
      const c = await client();
      const r = await call(c, 'pair', { code: p.code });
      expect(r.isError).toBe(false);
      expect(r.data.registry).toBe(p.registry);
      expect((await call(c, 'whoami')).data.registry).toBe(p.registry);
    }
    // a session bound by its key sends a mistyped code naming the other realm: refused, and still bound
    const bound = await client(a.token);
    expect((await call(bound, 'whoami')).data.registry).toBe(a.registry);
    const wrong = await call(bound, 'pair', { code: `${1 - a.realm}-AAA-AAA` });
    expect(wrong.isError).toBe(true);
    expect((await call(bound, 'whoami')).data.registry).toBe(a.registry);
    a.ws.close(); b.ws.close();
  }, 120000);
});
