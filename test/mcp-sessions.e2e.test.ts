/**
 * A client that never closes its MCP sessions must not lock everyone out (playtest round 2): a full table makes
 * room by closing the least recently used idle session, and one wizard holds at most MCP_PER_WIZARD sessions.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PORT = 9160 + Math.floor(Math.random() * 10);
const BASE = `http://127.0.0.1:${PORT}`;
let proc: ChildProcess;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hogwarts-sessions-'));
  proc = spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts'], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', HOGWARTS_DATA: join(dir, 'world.json'), PUBLIC_URL: BASE, NPC_COUNT: '0', MCP_MAX_SESSIONS: '6', MCP_EVICT_IDLE_MS: '400' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((ok, bad) => {
    const t = setTimeout(() => bad(new Error('server did not start')), 60000);
    proc.stdout!.on('data', (d) => { if (String(d).includes('per term')) { clearTimeout(t); ok(); } });
  });
}, 70000);
afterAll(() => { proc?.kill('SIGTERM'); });

const H = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
/** initialize and walk away (never DELETE): the leaky client. Returns the HTTP status and the session id. */
async function leak(key?: string) {
  const r = await fetch(`${BASE}/mcp`, {
    method: 'POST', headers: { ...H, ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'leaky', version: '1' } } }),
  });
  await r.text();
  return { status: r.status, sid: r.headers.get('mcp-session-id'), retry: r.headers.get('retry-after') };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('MCP session table', () => {
  it('when full, a busy table says when to retry; an idle one makes room', async () => {
    for (let i = 0; i < 6; i++) expect((await leak()).status).toBe(200);
    const full = await leak();
    expect(full.status).toBe(503);
    expect(Number(full.retry)).toBeGreaterThan(0);
    await sleep(500);
    expect((await leak()).status).toBe(200); // the oldest idle session went
  }, 60000);

  it('one wizard keeps at most 8 sessions: a ninth closes their oldest', async () => {
    const e = await fetch(`${BASE}/api/enroll`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Leaky Luna' }) });
    const { token } = await e.json() as { token: string };
    await sleep(500);
    const first = await leak(token);
    expect(first.status).toBe(200);
    for (let i = 0; i < 8; i++) { await sleep(450); expect((await leak(token)).status).toBe(200); }
    // the first session is gone: a request on it is refused as unknown
    const r = await fetch(`${BASE}/mcp`, { method: 'POST', headers: { ...H, 'mcp-session-id': first.sid! }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) });
    await r.text();
    expect(r.status).toBe(400);
  }, 60000);
});
