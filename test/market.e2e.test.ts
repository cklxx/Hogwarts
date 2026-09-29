/**
 * 咒语集市 end to end: the real server; an agent publishes over MCP (streamable HTTP), a browser browses, reads and
 * copies over the WebSocket, and the author is told. (Its own server: enrolments are rate-limited per address.)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

const PORT = Number(process.env.HOGWARTS_MARKET_PORT ?? 9110 + Math.floor(Math.random() * 10));
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
  const dir = mkdtempSync(join(tmpdir(), 'hogwarts-market-'));
  proc = spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts'], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', HOGWARTS_DATA: join(dir, 'world.json'), PUBLIC_URL: BASE, NPC_COUNT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((ok, bad) => {
    const t = setTimeout(() => bad(new Error('server did not start')), 60000);
    proc.stdout!.on('data', (d) => { if (String(d).includes('[hogwarts]')) { clearTimeout(t); ok(); } });
    proc.stderr!.on('data', (d) => process.stderr.write(d));
  });
}, 70000);
afterAll(() => { proc?.kill('SIGTERM'); });

describe('咒语集市 over MCP and WebSocket', () => {
  it('an agent publishes over MCP, a browser browses, reads and copies over WebSocket', async () => {
    const a = await client();
    const author = (await call(a, 'enroll', { name: 'Market Fred', house_preference: 'Gryffindor' })).data;
    expect((await call(a, 'forge_spell', { name: 'Whiz Bang', source: '(bolt aim 6 :fire)' })).isError).toBe(false);
    const pub = await call(a, 'publish_spell', { spell: 'Whiz Bang', desc_en: 'a firework' });
    expect(pub.isError, pub.text).toBe(false);
    const id = pub.data.published as string;
    const r = await fetch(`${BASE}/api/enroll`, { method: 'POST', body: JSON.stringify({ name: 'Market Luna' }) });
    expect(r.status).toBe(200);
    const { token } = (await r.json()) as { token: string };
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${token}`);
    const msgs: any[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
    await new Promise((ok, bad) => { ws.once('open', ok); ws.once('error', bad); });
    const next = async (pred: (m: any) => boolean) => {
      const t0 = Date.now();
      while (Date.now() - t0 < 10000) { const i = msgs.findIndex(pred); if (i >= 0) return msgs.splice(i, 1)[0]; await new Promise((ok) => setTimeout(ok, 50)); }
      throw new Error('timed out');
    };
    ws.send(JSON.stringify({ t: 'market', op: 'browse', element: 'fire' }));
    const b = await next((m) => m.t === 'market' && m.op === 'browse');
    expect(b.r.listings.map((l: any) => l.id)).toContain(id);
    ws.send(JSON.stringify({ t: 'market', op: 'spell', id }));
    expect((await next((m) => m.t === 'market' && m.op === 'spell')).r).toMatchObject({ source: '(bolt aim 6 :fire)', author: 'Market Fred', canCopy: { ok: true } });
    ws.send(JSON.stringify({ t: 'marketop', op: 'copy', id, slot: 6 }));
    expect((await next((m) => m.t === 'market' && m.op === 'copy')).r.copied.name).toBe('Whiz Bang');
    const book = await next((m) => m.t === 'book');
    expect(book.armory.spells.find((s: any) => s.name === 'Whiz Bang')).toMatchObject({ market: { id, v: 1 }, origin: { author: 'Market Fred' } });
    ws.send(JSON.stringify({ t: 'marketop', op: 'copy', id }));
    expect((await next((m) => m.t === 'err')).error).toMatch(/already have/);
    // the author hears about it, and nobody's registry number went over the wire
    const heard = await call(a, 'events');
    expect(heard.data.some((e: { text: string; private: boolean }) => e.private && /copied your "Whiz Bang"/.test(e.text))).toBe(true);
    expect(JSON.stringify(msgs)).not.toContain(author.registry);
    ws.close();
  });
});
