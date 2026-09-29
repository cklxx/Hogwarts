import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { z } from 'zod';

const PORT = Number(process.env.HOGWARTS_BRIDGE_TEST_PORT ?? 8060);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = join(mkdtempSync(join(tmpdir(), 'hogwarts-bridge-')), 'world.json');
let proc: ChildProcess;

async function startServer() {
  proc = spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts'], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', HOGWARTS_DATA: DATA, PUBLIC_URL: BASE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((ok, bad) => {
    const t = setTimeout(() => bad(new Error('server did not start')), 60000);
    proc.stdout!.on('data', (d) => { if (String(d).includes('(MCP:')) { clearTimeout(t); ok(); } });
  });
}
async function stopServer() {
  const p = proc;
  await new Promise<void>((ok) => { p.once('exit', () => ok()); p.kill('SIGTERM'); });
}

/** A bridge process driven by an MCP client over stdio; stderr collected. */
async function bridge(home: string, opts: { name?: string; elicit?: (q: string) => { action: string; content?: unknown }; env?: Record<string, string> } = {}) {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), HOME: home, ...opts.env };
  delete env.HOGWARTS_URL; delete env.HOGWARTS_TOKEN; delete env.HOGWARTS_KEYRING;
  Object.assign(env, opts.env ?? {});
  const t = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'src/mcp/stdio-bridge.ts', `${BASE}/mcp?x=1`], env, stderr: 'pipe' });
  let stderr = '';
  t.stderr?.on('data', (d) => { stderr += String(d); });
  const c = new Client({ name: opts.name ?? 'test-client', version: '1' }, { capabilities: opts.elicit ? { elicitation: {} } : {} });
  if (opts.elicit) c.setRequestHandler(ElicitRequestSchema, async (req) => opts.elicit!(req.params.message) as never);
  const channel: any[] = [];
  c.setNotificationHandler(z.object({ method: z.literal('notifications/claude/channel'), params: z.any() }) as never, (n: any) => { channel.push(n.params); });
  await c.connect(t);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await c.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    let data: any = r.content[0].text;
    try { data = JSON.parse(r.content[0].text); } catch { /* text */ }
    return { data, text: r.content[0].text, isError: !!r.isError };
  };
  return { c, call, channel, stderr: () => stderr, close: () => c.close() };
}
const keyring = (home: string) => JSON.parse(readFileSync(join(home, '.hogwarts', 'credentials.json'), 'utf8'));
const tokenOf = (home: string) => keyring(home).keys[`${BASE}/mcp`].token as string;

beforeAll(startServer, 70000);
afterAll(() => { proc?.kill('SIGTERM'); });

describe('stdio bridge (docs/AGENT_LINK.md §A.1, §C.4)', () => {
  it('saves the key (0600, by origin+pathname), strips it from the model, logs back in, reconnects after a restart', async () => {
    const home = mkdtempSync(join(tmpdir(), 'owl-home-'));
    const b = await bridge(home);
    const e = await b.call('enroll', { name: 'Bridge Kid' });
    expect(e.isError).toBe(false);
    const tok = tokenOf(home);
    expect(tok.length).toBeGreaterThan(10);
    expect(e.text).not.toContain(tok);
    expect(e.data.token).toMatch(/credentials\.json/);
    expect(statSync(join(home, '.hogwarts', 'credentials.json')).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, '.hogwarts')).mode & 0o777).toBe(0o700);
    expect(Object.keys(keyring(home).keys)).toEqual([`${BASE}/mcp`]); // no query string in the key
    expect(b.stderr()).toContain('playing as Bridge Kid');
    expect(b.stderr()).not.toContain(tok);
    await b.close();

    // a new session comes back as the same wizard with no login call
    const b2 = await bridge(home);
    const who = await b2.call('whoami');
    expect(who.data.name).toBe('Bridge Kid');
    // the server restarts: the old MCP session is gone, the bridge rebuilds it and retries
    await stopServer();
    await startServer();
    const again = await b2.call('whoami');
    expect(again.isError).toBe(false);
    expect(again.data.name).toBe('Bridge Kid');
    expect(b2.stderr()).not.toContain(tok);
    await b2.close();
  }, 60000);

  it('passes the key through (and warns) when it cannot be saved; an env key is saved on first success', async () => {
    const home = mkdtempSync(join(tmpdir(), 'owl-home-'));
    writeFileSync(join(home, '.hogwarts'), 'not a directory');
    const b = await bridge(home);
    const e = await b.call('enroll', { name: 'No Disk' });
    expect(e.isError).toBe(false);
    expect(typeof e.data.token).toBe('string');
    expect(e.data.token).not.toMatch(/credentials/);
    expect(b.stderr()).toMatch(/could not save/);
    expect(b.stderr()).not.toContain(e.data.token);
    await b.close();

    const home2 = mkdtempSync(join(tmpdir(), 'owl-home-'));
    const b2 = await bridge(home2, { env: { HOGWARTS_TOKEN: e.data.token } });
    expect((await b2.call('whoami')).data.name).toBe('No Disk');
    expect(tokenOf(home2)).toBe(e.data.token);
    await b2.close();
  }, 30000);

  it('forwards the client name and elicitation, and pushes the human\'s owls as channel notifications', async () => {
    const home = mkdtempSync(join(tmpdir(), 'owl-home-'));
    mkdirSync(join(home, '.hogwarts'), { mode: 0o700 });
    const b = await bridge(home, { name: 'claude-code', elicit: () => ({ action: 'accept', content: { approve: true } }) });
    await b.call('enroll', { name: 'Channel Kid' });
    const tok = tokenOf(home);
    // no browser: the question goes to the terminal through the bridge
    const conf = await b.call('confirm_with_player', { question: 'ok?', timeout_seconds: 5 });
    expect(conf.data).toMatchObject({ approved: true, via: 'terminal' });

    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { authorization: `Bearer ${tok}` } });
    const seen = new Promise<any>((ok) => ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.t === 'me' && m.s.agent?.seen) ok(m.s.agent.seen); }));
    await new Promise((ok) => ws.once('open', ok));
    await b.call('look');
    expect((await seen).client).toBe('claude-code');
    ws.send(JSON.stringify({ t: 'owl', text: 'come to the lake' }));
    const t0 = Date.now();
    while (!b.channel.length && Date.now() - t0 < 8000) await new Promise((ok) => setTimeout(ok, 200));
    expect(b.channel[0]).toMatchObject({ content: expect.stringContaining('come to the lake'), meta: { kind: 'owl' } });
    expect(JSON.stringify(b.channel)).not.toContain(tok);
    expect(b.stderr()).not.toContain(tok);
    ws.close();
    await b.close();
  }, 40000);
});
