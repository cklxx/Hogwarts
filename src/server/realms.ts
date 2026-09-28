/**
 * REALMS=N: run N independent worlds (shards) as N processes behind one front door, so one big box
 * uses all its cores. Without REALMS (or REALMS<=1) nothing here runs and the server is exactly the
 * single-world server it always was.
 *
 *   primary (this module, when REALMS>1 and REALM_ID is unset)
 *     - forks N realm processes: the same entry script with REALM_ID=i, PORT=0 (a private loopback port)
 *       and HOGWARTS_DATA=<data>.r<i>.json (realm 0 keeps <data>, so an existing world becomes realm 0);
 *     - listens on PORT: /api/realms lists realms and player counts; every other HTTP request is
 *       proxied to the realm that owns it; a WebSocket upgrade is not proxied — the socket itself is
 *       handed to the realm process (fd passing over IPC), so game traffic never touches the primary;
 *     - restarts a realm that dies; on SIGINT/SIGTERM stops every realm (each saves) and exits.
 *   realm process (REALM_ID set): the ordinary server, plus: tokens and MCP session ids it mints carry
 *     the prefix "r<i>." (that is how the primary routes them), it reports its port and stats to the
 *     primary, accepts handed-over WebSocket sockets, and trusts X-Forwarded-For from the primary.
 *
 * Routing: ?realm=N wins; else an MCP session id or token prefix "r<N>." names the realm (unprefixed
 * tokens predate realms and live in realm 0); enrolment and new MCP sessions without a token go to the
 * realm with the fewest players online; anything else (static files, public APIs) to realm 0.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { Agent, createServer, request, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { fileURLToPath } from 'node:url';

export interface RealmStats { players: number; wizards: number; clients: number; mcp: number }

const REALMS = Math.floor(Number(process.env.REALMS ?? 0)) || 0;
const ID = process.env.REALM_ID;

export const realm = {
  mode: (ID !== undefined ? 'worker' : REALMS > 1 ? 'primary' : 'single') as 'single' | 'primary' | 'worker',
  id: ID !== undefined ? Number(ID) : 0,
  /** Prefix of tokens and MCP session ids minted here ('' outside realm mode, so nothing changes). */
  prefix: ID !== undefined ? `r${Number(ID)}.` : '',
};

export const realmDataPath = (base: string, i: number) => (i === 0 ? base : base.replace(/(\.json)?$/, `.r${i}.json`));
export const realmOf = (s: string | undefined | null): number | null => {
  const m = s ? /^r(\d{1,4})\./.exec(s) : null;
  return m ? Number(m[1]) : null;
};

// ------------------------------------------------------------------ realm process side
/** Called by a realm process once its HTTP server listens. */
export function realmWorker(http: Server, stats: () => RealmStats) {
  if (realm.mode !== 'worker' || !process.send) return;
  const port = (http.address() as AddressInfo).port;
  process.send({ t: 'ready', id: realm.id, port });
  setInterval(() => { try { process.send?.({ t: 'stats', id: realm.id, ...stats() }); } catch { /* primary gone */ } }, 1000).unref();
  process.on('message', (m: { t?: string; method?: string; url?: string; headers?: Record<string, string>; head?: string }, handle?: unknown) => {
    if (m?.t !== 'upgrade' || !handle) return;
    const socket = handle as Socket;
    // A request-shaped object is all the upgrade path (ws.handleUpgrade) reads.
    const req = { method: m.method, url: m.url, headers: m.headers ?? {}, socket } as unknown as IncomingMessage;
    http.emit('upgrade', req, socket, Buffer.from(m.head ?? '', 'base64'));
  });
  // The primary is gone: save and leave (main.ts saves on SIGTERM).
  process.on('disconnect', () => process.kill(process.pid, 'SIGTERM'));
}

/** Client address as seen by the front door (realm processes only ever talk to the primary). */
export function clientIp(req: IncomingMessage) {
  const fwd = realm.mode === 'worker' ? (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() : undefined;
  return fwd || req.socket.remoteAddress || '?';
}

// ------------------------------------------------------------------ primary side
interface Realm { id: number; proc: ChildProcess | null; port: number; stats: RealmStats | null; restarts: number; joins: number }

const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer']);
const strip = (h: Record<string, unknown>) => Object.fromEntries(Object.entries(h).filter(([k, v]) => !HOP.has(k.toLowerCase()) && v !== undefined));

function tokenOf(req: IncomingMessage, url: URL) {
  const h = req.headers.authorization;
  if (h?.toLowerCase().startsWith('bearer ')) return h.slice(7).trim();
  return (req.headers['x-wizard-token'] as string | undefined) ?? url.searchParams.get('token') ?? undefined;
}

async function runPrimary() {
  const PORT = Number(process.env.PORT ?? 7777);
  const HOST = process.env.HOST ?? '0.0.0.0';
  const DATA = process.env.HOGWARTS_DATA ?? fileURLToPath(new URL('../../data/world.json', import.meta.url));
  const PUBLIC_URL = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`;
  const realms: Realm[] = Array.from({ length: REALMS }, (_, id) => ({ id, proc: null, port: 0, stats: null, restarts: 0, joins: 0 }));
  let stopping = false;

  const start = (r: Realm) => {
    const proc = fork(process.argv[1], process.argv.slice(2), {
      env: { ...process.env, REALM_ID: String(r.id), PORT: '0', HOST: '127.0.0.1', HOGWARTS_DATA: realmDataPath(DATA, r.id), PUBLIC_URL },
      execArgv: process.execArgv,
    });
    r.proc = proc;
    r.port = 0;
    proc.on('message', (m: { t?: string; port?: number } & RealmStats) => {
      if (m?.t === 'ready') { r.port = m.port!; console.log(`[hogwarts] realm ${r.id} ready (pid ${proc.pid})`); }
      else if (m?.t === 'stats') { r.stats = { players: m.players, wizards: m.wizards, clients: m.clients, mcp: m.mcp }; r.joins = 0; }
    });
    proc.on('exit', (code, sig) => {
      r.port = 0;
      r.proc = null;
      if (stopping) return;
      r.restarts++;
      console.error(`[hogwarts] realm ${r.id} exited (${code ?? sig}); restarting`);
      setTimeout(() => { if (!stopping) start(r); }, 1000);
    });
  };
  realms.forEach(start);

  // Newcomers go where the fewest players are; `joins` counts newcomers sent since the realm last reported,
  // so a burst of enrolments spreads out instead of all landing on the same realm.
  const load = (r: Realm) => (r.stats?.players ?? 0) + r.joins;
  const leastLoaded = () => {
    const r = realms.filter((x) => x.port).sort((a, b) => load(a) - load(b) || (a.stats?.wizards ?? 0) + a.joins - ((b.stats?.wizards ?? 0) + b.joins) || a.id - b.id)[0];
    if (!r) return 0;
    r.joins++;
    return r.id;
  };
  const choose = (req: IncomingMessage, url: URL): number => {
    const q = url.searchParams.get('realm');
    if (q !== null && /^\d+$/.test(q)) return Number(q);
    const sid = realmOf(req.headers['mcp-session-id'] as string | undefined);
    if (sid !== null) return sid;
    const tok = tokenOf(req, url);
    if (tok) return realmOf(tok) ?? 0;
    if ((url.pathname === '/api/enroll' || url.pathname === '/mcp') && req.method === 'POST') return leastLoaded();
    return 0;
  };
  const list = () => ({
    mode: 'realms', realms: realms.map((r) => ({ id: r.id, up: !!r.port, players: r.stats?.players ?? 0, wizards: r.stats?.wizards ?? 0, clients: r.stats?.clients ?? 0, mcp: r.stats?.mcp ?? 0, restarts: r.restarts })),
  });
  const json = (res: ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify(body));
  };

  // The per-address enrolment limit (5 per 10 minutes, as in main.ts) is enforced here as well, so that
  // spreading enrolments over realms does not multiply it. (MCP `enroll` is limited per realm.)
  const enrolLog = new Map<string, number[]>();
  const allowEnrol = (ip: string) => {
    const now = Date.now();
    const recent = (enrolLog.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
    if (recent.length >= 5) return false;
    recent.push(now);
    enrolLog.set(ip, recent);
    return true;
  };

  const agent = new Agent({ keepAlive: true, maxSockets: 512 });
  const front = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/api/realms') return json(res, 200, list());
    if (url.pathname === '/api/enroll' && req.method === 'POST' && !allowEnrol(req.socket.remoteAddress ?? '?'))
      return json(res, 429, { error: 'The Sorting Hat needs a rest: too many enrolments from here. Try again in a few minutes.' });
    const r = realms[choose(req, url)];
    if (!r) return json(res, 404, { error: `There are ${REALMS} realms (0-${REALMS - 1}).` });
    if (!r.port) return json(res, 503, { error: `Realm ${r.id} is starting; try again in a moment.` });
    const up = request({
      host: '127.0.0.1', port: r.port, method: req.method, path: req.url, agent,
      headers: { ...strip(req.headers), 'x-forwarded-for': req.socket.remoteAddress ?? '', 'x-hogwarts-realm': String(r.id) },
    }, (ur) => {
      res.writeHead(ur.statusCode ?? 502, strip(ur.headers) as Record<string, string>);
      ur.pipe(res);
    });
    up.on('error', (e) => { if (!res.headersSent) json(res, 502, { error: `realm ${r.id}: ${e.message}` }); else res.destroy(); });
    res.on('close', () => { if (!res.writableFinished) up.destroy(); });
    req.pipe(up);
  });
  front.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const r = realms[choose(req, url)];
    if (!r?.proc || !r.port) { socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n'); return; }
    socket.pause();
    r.proc.send({ t: 'upgrade', method: req.method, url: req.url, headers: req.headers, head: head.toString('base64') }, socket, { keepOpen: false }, (err) => { if (err) socket.destroy(); });
  });
  front.on('error', (e) => { console.error(`[hogwarts] cannot listen on ${HOST}:${PORT}:`, e.message); process.exit(1); });
  front.listen(PORT, HOST, () => console.log(`[hogwarts] ${PUBLIC_URL}  front door for ${REALMS} realms (GET /api/realms)`));

  const stop = () => {
    if (stopping) return;
    stopping = true;
    const alive = realms.filter((r) => r.proc);
    for (const r of alive) r.proc!.kill('SIGTERM');
    let left = alive.length;
    if (!left) process.exit(0);
    for (const r of alive) r.proc!.once('exit', () => { if (--left === 0) { console.log('[hogwarts] all realms saved.'); process.exit(0); } });
    setTimeout(() => process.exit(0), 15_000).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (realm.mode === 'primary') {
  await runPrimary();
  // The importing entry (main.ts) must not go on to build a single world in this process: park its
  // evaluation forever. The front door's servers keep the process alive until stop() exits it.
  await new Promise<never>(() => {});
}
