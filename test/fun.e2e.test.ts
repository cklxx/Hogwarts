/**
 * Sprint 1 end to end (README 学院杯 / 校园事件轮盘 / 巧克力蛙画片): the real server with a staged world (the event wheel
 * rolls the Golden Snitch two seconds in); an agent reads the school's news, its album and opens a chest over MCP; a
 * browser sees the house strip and the event in its snapshots, catches the Snitch, gets its card event, opens a chest
 * with F, and asks for the school's news over the WebSocket. Nobody's registry number goes over the wire.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { World } from '../src/kernel/world.js';
import { CHESTS } from '../src/shared/chests.js';
import { onMsg } from './ws.js';

const PORT = Number(process.env.HOGWARTS_FUN_PORT ?? 9120 + Math.floor(Math.random() * 10));
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
  const dir = mkdtempSync(join(tmpdir(), 'hogwarts-fun-'));
  // a staged world: only the Snitch in the wheel's pool
  const w = new World({ seed: 1, secret: 'fun-e2e' });
  w.rules.events.pool = ['snitch'];
  writeFileSync(join(dir, 'world.json'), JSON.stringify(w.serialize()));
  proc = spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts'], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', HOGWARTS_DATA: join(dir, 'world.json'), PUBLIC_URL: BASE, NPC_COUNT: '0', EVENT_FIRST_S: '2' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((ok, bad) => {
    const t = setTimeout(() => bad(new Error('server did not start')), 60000);
    proc.stdout!.on('data', (d) => { if (String(d).includes('[hogwarts]') && String(d).includes('MCP')) { clearTimeout(t); ok(); } });
    proc.stderr!.on('data', (d) => process.stderr.write(d));
  });
}, 70000);
afterAll(() => { proc?.kill('SIGTERM'); });

describe('学院杯 · 校园事件轮盘 · 巧克力蛙画片 over MCP and WebSocket', () => {
  it('an agent reads the school and its album; a browser catches the Snitch, flips a card and opens a chest', async () => {
    const a = await client();
    const agent = (await call(a, 'enroll', { name: 'Fun Fred', house_preference: 'Gryffindor' })).data;
    const school0 = await call(a, 'school_events');
    expect(school0.isError, school0.text).toBe(false);
    expect(school0.data.term).toMatchObject({ n: 1, finalMinute: false, finalMinuteMultiplier: 2 });
    expect(Object.keys(school0.data.housePoints)).toEqual(['Gryffindor', 'Hufflepuff', 'Ravenclaw', 'Slytherin']);
    expect(school0.data.chests.total).toBe(CHESTS.length);
    const album = await call(a, 'frog_cards');
    expect(album.data.total).toBeGreaterThanOrEqual(78);
    expect(album.data.owned).toBe(0);
    // an agent far from any chest is told how many are left
    const none = await call(a, 'open_chest');
    expect(none.isError).toBe(true);
    expect(none.text).toMatch(/No closed chest/);

    const r = await fetch(`${BASE}/api/enroll`, { method: 'POST', body: JSON.stringify({ name: 'Fun Ginny', house: 'Gryffindor' }) });
    const { token } = (await r.json()) as { token: string };
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { authorization: `Bearer ${token}` } });
    const msgs: any[] = [];
    onMsg(ws, (m) => msgs.push(m));
    await new Promise((ok, bad) => { ws.once('open', ok); ws.once('error', bad); });
    const next = async (pred: (m: any) => boolean, ms = 15000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { const i = msgs.findIndex(pred); if (i >= 0) return msgs.splice(i, 1)[0]; await new Promise((ok) => setTimeout(ok, 50)); }
      throw new Error('timed out');
    };
    // the house strip is in every snapshot; the Snitch rolls ~2 s in
    const snap = await next((m) => m.t === 'snap' && m.s.cup);
    expect(snap.s.cup.pts).toHaveLength(4);
    const announce = await next((m) => m.t === 'event' && m.e.type === 'wheel' && /金色飞贼/.test(m.e.zh ?? ''));
    expect(announce.e.to).toBeUndefined();
    const withSnitch = await next((m) => m.t === 'snap' && m.s.ev?.id === 'snitch' && m.s.ev.s);
    expect(withSnitch.s.ev).toMatchObject({ st: 'on' });
    const during = await call(a, 'school_events');
    expect(during.data.event).toMatchObject({ id: 'snitch', nameZh: '金色飞贼出现了' });
    // the browser walks under it (as if it ran there) and casts at it until it is caught
    let caught: any = null;
    for (let i = 0; i < 120 && !caught; i++) {
      const s = msgs.filter((m) => m.t === 'snap').at(-1);
      const sn = s?.s.ev?.s;
      if (sn) ws.send(JSON.stringify({ t: 'goto', x: sn.x, z: sn.z + 3 }));
      if (sn) ws.send(JSON.stringify({ t: 'cast', key: '1', x: sn.x, z: sn.z }));
      await new Promise((ok) => setTimeout(ok, 250));
      caught = msgs.find((m) => m.t === 'event' && m.e.type === 'card' && m.e.card);
    }
    expect(caught, 'the snitch was caught and a card flipped').toBeTruthy();
    const me = msgs.filter((m) => m.t === 'me').at(-1) ?? await next((m) => m.t === 'me');
    await new Promise((ok) => setTimeout(ok, 400));
    const me2 = msgs.filter((m) => m.t === 'me').at(-1) ?? me;
    expect(me2.s.fun.pts).toBeGreaterThanOrEqual(150);
    expect(me2.s.fun.cards).toContain(caught.e.card);
    // the school's news over the WebSocket
    ws.send(JSON.stringify({ t: 'school' }));
    const sc = await next((m) => m.t === 'school');
    expect(sc.r.housePoints.Gryffindor).toBeGreaterThanOrEqual(150);
    expect(sc.r.recent.at(-1)).toMatchObject({ id: 'snitch', outcome: 'won', hero: 'Fun Ginny' });
    // a chest with F: walk to the nearest one and open it
    const c = CHESTS.find((x) => x.id === 'stands')!;
    ws.send(JSON.stringify({ t: 'goto', x: c.x, z: c.z }));
    let opened: any = null;
    for (let i = 0; i < 160 && !opened; i++) {
      await new Promise((ok) => setTimeout(ok, 250));
      ws.send(JSON.stringify({ t: 'chest' }));
      await new Promise((ok) => setTimeout(ok, 50));
      opened = msgs.find((m) => m.t === 'chest');
    }
    expect(opened?.r).toMatchObject({ chest: 'stands', housePoints: 5 });
    expect(JSON.stringify(msgs)).not.toContain(agent.registry);
    ws.close();
  }, 120000);
});
