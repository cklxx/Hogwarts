/**
 * 使魔 end to end: the real server (with the real @anthropic-ai/sdk client) against a scripted fake of the
 * Messages API on localhost (ANTHROPIC_BASE_URL), driven from a browser socket. No network.
 * The core moment: an owl asks for a spell, and a moment later slot 5 holds it and the familiar replies.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

const PORT = 8740 + Math.floor(Math.random() * 20);
const BASE = `http://127.0.0.1:${PORT}`;
const SOURCE = '(bolt (ahead 12) 12 :ice)';
const REPLY = '🦉 好了：「冰封精灵」在 5 号键。Glacius Pixiae is on key 5.';
let proc: ChildProcess;
let api: Server;
const seen: { headers: Record<string, unknown>; body: any }[] = [];

/** Each request gets the next step of the script, whatever it asked. */
const script = [
  () => [{ type: 'tool_use', id: 'tu_1', name: 'forge_spell', input: { name: 'Glacius Pixiae', source: SOURCE, slot: 5 } }],
  () => [{ type: 'tool_use', id: 'tu_2', name: 'tell_player', input: { text: REPLY } }],
  () => [{ type: 'text', text: '' }],
];

beforeAll(async () => {
  api = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      seen.push({ headers: req.headers, body });
      const step = script.shift();
      const content = step ? step() : [{ type: 'text', text: 'script over' }];
      res.writeHead(200, { 'content-type': 'application/json', 'request-id': `req_${seen.length}` });
      res.end(JSON.stringify({
        id: `msg_${seen.length}`, type: 'message', role: 'assistant', model: body.model, content,
        stop_reason: content.some((c) => c.type === 'tool_use') ? 'tool_use' : 'end_turn', stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      }));
    });
  });
  await new Promise<void>((ok) => api.listen(0, '127.0.0.1', ok));
  const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  const dir = mkdtempSync(join(tmpdir(), 'hogwarts-familiar-'));
  const env: NodeJS.ProcessEnv = {
    ...process.env, PORT: String(PORT), HOST: '127.0.0.1', HOGWARTS_DATA: join(dir, 'world.json'), PUBLIC_URL: BASE, NPC_COUNT: '0',
    ANTHROPIC_API_KEY: 'sk-test-familiar', ANTHROPIC_BASE_URL: apiUrl, FAMILIAR_DAILY: '5', FAMILIAR_MODEL: 'claude-opus-5-5',
  };
  for (const k of ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_PROFILE', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) delete env[k];
  proc = spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((ok, bad) => {
    const t = setTimeout(() => bad(new Error('server did not start')), 60000);
    proc.stdout!.on('data', (d) => { if (String(d).includes('[hogwarts]')) { clearTimeout(t); ok(); } });
    proc.stderr!.on('data', (d) => { if (!String(d).startsWith('[familiar]')) process.stderr.write(d); });
  });
}, 70000);
afterAll(() => { proc?.kill('SIGTERM'); api?.close(); });

describe('使魔 end to end', () => {
  it('a browser-only player summons the familiar, asks for a spell, and finds it on key 5', async () => {
    const r = await fetch(`${BASE}/api/enroll`, { method: 'POST', body: JSON.stringify({ name: 'Browser Only' }) });
    const { token } = (await r.json()) as { token: string };
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { authorization: `Bearer ${token}` } });
    const msgs: any[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
    const until = async (pred: (m: any) => boolean, ms = 15000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) { const m = msgs.find(pred); if (m) return m; await new Promise((x) => setTimeout(x, 50)); }
      throw new Error('timed out');
    };
    const welcome = await until((m) => m.t === 'welcome');
    expect(welcome.familiar).toMatchObject({ on: false, left: 5, daily: 5 });

    ws.send(JSON.stringify({ t: 'familiar', on: true, kind: 'owl' }));
    expect((await until((m) => m.t === 'familiar')).s).toMatchObject({ on: true, name: '使魔 · 猫头鹰', dormant: false });
    await until((m) => m.t === 'event' && m.e.type === 'owl' && m.e.from === 'agent' && /使魔到/.test(m.e.text));

    ws.send(JSON.stringify({ t: 'owl', text: '给我一个能冻住身边所有小精灵的咒语' }));
    const answer = await until((m) => m.t === 'event' && m.e.type === 'owl' && m.e.from === 'agent' && m.e.text === REPLY);
    expect(answer.e.who).toBeUndefined(); // wireEvent
    const me = await until((m) => m.t === 'me' && m.s.hotbar?.[4]?.name === 'Glacius Pixiae');
    expect(me.s.agent.seen.client).toBe('使魔 · 猫头鹰');
    expect(me.s.agent.familiar).toMatchObject({ on: true, left: 4 });

    // what reached the Messages API: the SDK's request, with the key only in its header
    expect(seen.length).toBe(3);
    expect(seen[0].headers['x-api-key']).toBe('sk-test-familiar');
    expect(String(seen[0].headers['anthropic-beta'])).toContain('server-side-fallback-2026-07-01');
    expect(seen[0].body).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', output_config: { effort: 'low' } });
    expect(seen[0].body.tools.map((t: { name: string }) => t.name)).not.toContain('rotate_key');
    expect(JSON.stringify(seen.map((s) => s.body))).not.toContain(token);
    expect(JSON.stringify(seen[0].body.messages)).toContain('冻住身边所有小精灵');
    ws.close();
  });
});
