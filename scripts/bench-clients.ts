/**
 * Load-generating WebSocket clients for scripts/bench.ts (runs inside a worker thread).
 * Each client behaves like a browser: input at job.inputHz (default 20 Hz; a browser sends one per animation frame while it walks and turns), random walk, a cast every ~1 s, and it
 * counts what the server sends it without parsing the (large) snapshots.
 */
import { parentPort, workerData } from 'node:worker_threads';
import WebSocket from 'ws';

interface Job { url: string; tokens: string[]; offset: number; seed: number; inputHz?: number }
const job = workerData as Job;

let s = job.seed >>> 0;
const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

interface Client { ws: WebSocket; open: boolean; dx: number; dz: number; f: number; castAt: number[]; i: number }
const clients: Client[] = [];
const zero = () => ({ bytes: 0, snapBytes: 0, meBytes: 0, eventBytes: 0, snaps: 0, mes: 0, events: 0, other: 0, inputs: 0, casts: 0, castReplies: 0, rtt: [] as number[], closed: 0 });
let st = zero();

const T = (b: Buffer, i: number) => String.fromCharCode(b[i]);
function onMessage(c: Client, data: Buffer) {
  st.bytes += data.length;
  // a binary snapshot frame (src/shared/snapwire.ts), or {"t":"me"...  {"t":"evs"...  {"t":"cast"...
  const k = data[0] === 2 ? 'sn' : T(data, 6) + T(data, 7);
  if (k === 'sn') { st.snaps++; st.snapBytes += data.length; }
  else if (k === 'me') { st.mes++; st.meBytes += data.length; }
  else if (k === 'ev') { st.events++; st.eventBytes += data.length; }
  else if (k === 'ca') { st.castReplies++; const t0 = c.castAt.shift(); if (t0 !== undefined) st.rtt.push(performance.now() - t0); }
  else st.other++;
}

async function connectAll() {
  const pending: Promise<void>[] = [];
  for (let i = 0; i < job.tokens.length; i++) {
    const c: Client = { ws: null as unknown as WebSocket, open: false, dx: 0, dz: 0, f: 0, castAt: [], i: job.offset + i };
    const a = rnd() * Math.PI * 2;
    c.dx = Math.cos(a); c.dz = Math.sin(a); c.f = a;
    clients.push(c);
    pending.push(new Promise<void>((ok) => {
      const ws = new WebSocket(`${job.url}/ws`, { perMessageDeflate: false, skipUTF8Validation: true, headers: { authorization: `Bearer ${job.tokens[i]}` } });
      c.ws = ws;
      ws.on('open', () => { c.open = true; ok(); });
      ws.on('message', (d: Buffer) => onMessage(c, d));
      ws.on('close', () => { c.open = false; st.closed++; ok(); });
      ws.on('error', () => { /* counted by close */ });
    }));
    if (pending.length % 50 === 0) await Promise.all(pending.slice(-50));
  }
  await Promise.all(pending);
}

let tickNo = 0;
let timer: NodeJS.Timeout | null = null;
function drive() {
  let owed = 0; // inputs per client due this 50 ms step (inputHz / 20, carried over when fractional)
  timer = setInterval(() => {
    tickNo++;
    owed += (job.inputHz ?? 20) / 20;
    const burst = Math.floor(owed);
    owed -= burst;
    for (const c of clients) {
      if (!c.open) continue;
      if ((tickNo + c.i * 13) % 60 === 0) { const a = rnd() * Math.PI * 2; c.dx = Math.cos(a); c.dz = Math.sin(a); c.f = a; }
      for (let j = 0; j < burst; j++) c.ws.send(JSON.stringify({ t: 'input', dx: c.dx, dz: c.dz, f: c.f + j * 0.01 }));
      st.inputs += burst;
      if ((tickNo + c.i * 7) % 20 === 0) {
        c.castAt.push(performance.now());
        c.ws.send(JSON.stringify({ t: 'cast', key: '1', x: (rnd() - 0.5) * 400, z: (rnd() - 0.5) * 400 }));
        st.casts++;
      }
    }
  }, 50);
}

parentPort!.on('message', async (m: { cmd: string }) => {
  if (m.cmd === 'connect') { await connectAll(); parentPort!.postMessage({ t: 'connected', open: clients.filter((c) => c.open).length }); }
  else if (m.cmd === 'drive') drive();
  else if (m.cmd === 'reset') { st = zero(); for (const c of clients) c.castAt = []; parentPort!.postMessage({ t: 'reset' }); }
  else if (m.cmd === 'stats') parentPort!.postMessage({ t: 'stats', st, open: clients.filter((c) => c.open).length, n: clients.length });
  else if (m.cmd === 'stop') {
    if (timer) clearInterval(timer);
    for (const c of clients) c.ws.terminate();
    parentPort!.postMessage({ t: 'stopped' });
    setTimeout(() => process.exit(0), 50);
  }
});
