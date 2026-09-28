import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

const PORT = 17000 + Math.floor(Math.random() * 1000);
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
    const t = setTimeout(() => bad(new Error('server did not start')), 15000);
    proc.stdout!.on('data', (d) => { if (String(d).includes('[hogwarts]')) { clearTimeout(t); ok(); } });
    proc.stderr!.on('data', (d) => process.stderr.write(d));
  });
}, 20000);
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

    const g = await call(c, 'grimoire');
    expect(g.text).toContain('RUNES');
    expect(g.text).toContain('(bolt at power element?)');

    const bad = await call(c, 'forge_spell', { name: 'Oops', source: '(bolt target' });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/unclosed/);

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

  it('serves the 3D client protocol over WebSocket', async () => {
    const r = await fetch(`${BASE}/api/enroll`, { method: 'POST', body: JSON.stringify({ name: 'Browser Kid' }) });
    const { token } = (await r.json()) as { token: string };
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${token}`);
    const got = new Set<string>();
    await new Promise<void>((ok) => {
      ws.on('message', (m) => {
        const msg = JSON.parse(String(m));
        got.add(msg.t);
        if (msg.t === 'welcome') ws.send(JSON.stringify({ t: 'cast', key: '1' }));
        if (got.has('welcome') && got.has('snap') && got.has('me') && got.has('cast')) ok();
      });
    });
    ws.close();
    expect([...got]).toEqual(expect.arrayContaining(['welcome', 'snap', 'me', 'cast']));
  });
});
