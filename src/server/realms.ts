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
 * tokens predate realms and live in realm 0); enrolment goes to the realm with the fewest players
 * online; else the routing cookie (below) names the realm; new MCP sessions without a token go to the
 * realm with the fewest players; anything else (static files, public APIs) to realm 0.
 *
 * Routing cookie: a successful /api/enroll or /api/me answer carries `Set-Cookie: hogwarts_realm=K`
 * (K = the realm that answered), so the browser's later tokenless requests — the in-game board's
 * /api/leaderboard, /api/rules, /api/history — reach the player's own realm, not realm 0.
 *
 * MCP `login`: a session opened without a token lives in the realm it was sent to. When it calls the
 * `login` tool with a token of another realm, the front door first moves the session there: it opens
 * a session under the same id in the token's realm (replaying the client's `initialize`), routes the
 * session there from then on, and closes the old one. The client notices nothing.
 *
 * MCP `pair`: pairing codes minted in realm K read "K-ABC-DEF" (docs/AGENT_LINK.md §A.2). A `pair` call
 * whose code names another realm moves the session there first, through the same hook as `login`, so the
 * code is redeemed (and its failures counted) by the realm that minted it. The move only sticks if the
 * code is accepted: the old session is kept until the answer is in, and a refused code (mistyped, expired,
 * throttled) moves the session back, still bound to the wizard it had.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { Agent, createServer, request, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import { parsePairCode } from '../kernel/identity.js';
import { readFileSync } from 'node:fs';
import { buildId, serverName, startDiscovery } from './discovery.js';
import { keyOf } from './key.js';

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
/** Hop-by-hop headers never cross the proxy; nor do x-hogwarts-* headers from outside (they are the front door's). */
const strip = (h: Record<string, unknown>) => Object.fromEntries(Object.entries(h).filter(([k, v]) => !HOP.has(k.toLowerCase()) && !/^x-hogwarts-/i.test(k) && v !== undefined));

/** Header on the front door's replayed `initialize`: open the session under this (existing) id. */
const ADOPT = 'x-hogwarts-adopt-session';
const SESSION_ID = /^r\d{1,4}\.[0-9a-f-]{36}$/;
/** In a realm process: the session id the front door asks this `initialize` to adopt, if any. */
export function adoptedSessionId(req: IncomingMessage): string | null {
  const v = realm.mode === 'worker' ? req.headers[ADOPT] : undefined;
  return typeof v === 'string' && SESSION_ID.test(v) ? v : null;
}

export const realmCookie = (id: number) => `hogwarts_realm=${id}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`;
export function cookieRealm(cookie: string | undefined): number | null {
  const m = cookie ? /(?:^|;\s*)hogwarts_realm=(\d{1,4})(?:;|$)/.exec(cookie) : null;
  return m ? Number(m[1]) : null;
}

/** The token of the first `login` tool call in a JSON-RPC message (or batch), if any. */
export function loginToken(msg: unknown): string | null {
  for (const m of Array.isArray(msg) ? msg : [msg]) {
    const x = m as { method?: unknown; params?: { name?: unknown; arguments?: { token?: unknown } } } | null;
    if (x && x.method === 'tools/call' && x.params?.name === 'login' && typeof x.params.arguments?.token === 'string') return x.params.arguments.token.trim();
  }
  return null;
}
/** The realm the first `pair` tool call in a JSON-RPC message (or batch) names by its code prefix ("2-ABC-DEF"), if any. */
export function pairRealm(msg: unknown): number | null {
  for (const m of Array.isArray(msg) ? msg : [msg]) {
    const x = m as { method?: unknown; params?: { name?: unknown; arguments?: { code?: unknown } } } | null;
    if (x && x.method === 'tools/call' && x.params?.name === 'pair' && typeof x.params.arguments?.code === 'string') return parsePairCode(x.params.arguments.code)?.realm ?? null;
  }
  return null;
}
/** The realm a `login` (by its token) or a `pair` (by its code) in this message belongs to: where the session must live. */
export function targetRealm(msg: unknown): number | null {
  const tok = loginToken(msg);
  if (tok !== null) return realmOf(tok) ?? 0;
  return pairRealm(msg);
}
const isInitialize = (msg: unknown) => !!msg && typeof msg === 'object' && (msg as { method?: unknown }).method === 'initialize';


async function runPrimary() {
  const PORT = Number(process.env.PORT ?? 7777);
  const HOST = process.env.HOST ?? '0.0.0.0';
  const DATA = process.env.HOGWARTS_DATA ?? fileURLToPath(new URL('../../data/world.json', import.meta.url));
  const PUBLIC_URL = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`;
  const realms: Realm[] = Array.from({ length: REALMS }, (_, id) => ({ id, proc: null, port: 0, stats: null, restarts: 0, joins: 0 }));
  let stopping = false;

  const start = (r: Realm) => {
    const proc = fork(process.argv[1], process.argv.slice(2), {
      env: { ...process.env, REALM_ID: String(r.id), PORT: '0', HOST: '127.0.0.1', HOGWARTS_DATA: realmDataPath(DATA, r.id), ...(process.env.PUBLIC_URL ? { PUBLIC_URL } : {}) },
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
  // MCP sessions moved to another realm by `login` (session id → realm), and the `initialize` request
  // that opened each session (replayed when one moves). Forgotten after 30 idle minutes, like sessions.
  const homes = new Map<string, number>();
  const inits = new Map<string, { body: Buffer; seen: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [id, e] of inits) if (now - e.seen > 30 * 60_000) { inits.delete(id); homes.delete(id); }
  }, 60_000).unref();

  const choose = (req: IncomingMessage, url: URL): number => {
    const q = url.searchParams.get('realm');
    if (q !== null && /^\d+$/.test(q)) return Number(q);
    const sid = req.headers['mcp-session-id'] as string | undefined;
    const home = sid ? homes.get(sid) ?? realmOf(sid) : null;
    if (home !== null) return home;
    const tok = keyOf(req);
    if (tok) return realmOf(tok) ?? 0;
    if (url.pathname === '/api/enroll' && req.method === 'POST') return leastLoaded();
    const c = cookieRealm(req.headers.cookie);
    if (c !== null && c < REALMS) return c;
    if (url.pathname === '/mcp' && req.method === 'POST') return leastLoaded();
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
  /** Proxy one request to realm r (its body streamed, or `body` if the front door has read it already). */
  const forward = (req: IncomingMessage, res: ServerResponse, r: Realm | undefined, body?: Buffer, answered?: (status: number, headers: IncomingMessage['headers']) => void) => {
    if (!r) return json(res, 404, { error: `There are ${REALMS} realms (0-${REALMS - 1}).` });
    if (!r.port) return json(res, 503, { error: `Realm ${r.id} is starting; try again in a moment.` });
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    // The player's own realm just answered who they are: remember it for their tokenless requests.
    const sticky = path === '/api/me' || (path === '/api/enroll' && req.method === 'POST');
    const up = request({
      host: '127.0.0.1', port: r.port, method: req.method, path: req.url, agent,
      headers: { ...strip(req.headers), ...(body ? { 'content-length': String(body.length) } : {}), 'x-forwarded-for': req.socket.remoteAddress ?? '', 'x-hogwarts-realm': String(r.id) },
    }, (ur) => {
      const status = ur.statusCode ?? 502;
      const headers = strip(ur.headers) as Record<string, string | string[]>;
      if (sticky && status === 200) headers['set-cookie'] = [...([] as string[]).concat(headers['set-cookie'] ?? []), realmCookie(r.id)];
      answered?.(status, ur.headers);
      res.writeHead(status, headers);
      ur.pipe(res);
    });
    up.on('error', (e) => { if (!res.headersSent) json(res, 502, { error: `realm ${r.id}: ${e.message}` }); else res.destroy(); });
    res.on('close', () => { if (!res.writableFinished) up.destroy(); });
    if (body) up.end(body);
    else req.pipe(up);
  };

  /** A request of the front door's own to a realm's /mcp; resolves with the status and headers. */
  const call = (r: Realm, method: string, headers: Record<string, string>, body: Buffer | null) => new Promise<{ status: number; headers: IncomingMessage['headers'] }>((ok, fail) => {
    const up = request({ host: '127.0.0.1', port: r.port, method, path: '/mcp', agent, timeout: 10_000, headers: { ...headers, ...(body ? { 'content-length': String(body.length) } : {}) } }, (ur) => {
      ur.resume(); // e.g. the answer to a replayed initialize: not the client's business
      ur.on('end', () => ok({ status: ur.statusCode ?? 502, headers: ur.headers }));
      ur.on('error', fail);
    });
    up.on('timeout', () => up.destroy(new Error('timeout')));
    up.on('error', fail);
    up.end(body ?? undefined);
  });

  /** Move MCP session `sid` from realm `from` to realm `to` (see the header comment); `keepOld`: leave the old session open. */
  const rehome = async (sid: string, from: Realm, to: Realm, req: IncomingMessage, keepOld = false) => {
    const init = inits.get(sid);
    if (!init || !to.port) return false;
    const pv = req.headers['mcp-protocol-version'];
    const version: Record<string, string> = typeof pv === 'string' ? { 'mcp-protocol-version': pv } : {};
    const base = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-forwarded-for': req.socket.remoteAddress ?? '' };
    try {
      const opened = await call(to, 'POST', { ...base, [ADOPT]: sid }, init.body);
      if (opened.status !== 200 || opened.headers['mcp-session-id'] !== sid) return false;
      await call(to, 'POST', { ...base, ...version, 'mcp-session-id': sid }, Buffer.from('{"jsonrpc":"2.0","method":"notifications/initialized"}'));
    } catch {
      return false;
    }
    homes.set(sid, to.id);
    if (from.port && !keepOld) call(from, 'DELETE', { ...version, 'mcp-session-id': sid }, null).catch(() => {});
    return true;
  };
  const closeIn = (r: Realm, sid: string, req: IncomingMessage) => {
    const pv = req.headers['mcp-protocol-version'];
    if (r.port) call(r, 'DELETE', { ...(typeof pv === 'string' ? { 'mcp-protocol-version': pv } : {}), 'mcp-session-id': sid }, null).catch(() => {});
  };

  /**
   * A `pair` in session `sid`, just moved from realm `from` to realm `to` (its old session still open):
   * forward it, read the whole answer, and keep the move only if the code was accepted. A refusal (a tool
   * result with isError) moves the session back to `from`, where it is still bound as before.
   */
  const forwardPair = (req: IncomingMessage, res: ServerResponse, from: Realm, to: Realm, sid: string, body: Buffer) => {
    const up = request({
      host: '127.0.0.1', port: to.port, method: 'POST', path: req.url, agent,
      headers: { ...strip(req.headers), 'content-length': String(body.length), 'x-forwarded-for': req.socket.remoteAddress ?? '', 'x-hogwarts-realm': String(to.id) },
    }, (ur) => {
      const chunks: Buffer[] = [];
      ur.on('data', (c: Buffer) => chunks.push(c));
      ur.on('end', () => {
        const answer = Buffer.concat(chunks);
        const refused = (ur.statusCode ?? 502) !== 200 || /"isError"\s*:\s*true/.test(answer.toString('utf8'));
        if (refused) { homes.set(sid, from.id); closeIn(to, sid, req); } else closeIn(from, sid, req);
        const headers = strip(ur.headers) as Record<string, string | string[]>;
        delete headers['content-length'];
        res.writeHead(ur.statusCode ?? 502, { ...headers, 'content-length': String(answer.length) });
        res.end(answer);
      });
      ur.on('error', () => { homes.set(sid, from.id); closeIn(to, sid, req); if (!res.headersSent) json(res, 502, { error: `realm ${to.id}: answer lost` }); else res.destroy(); });
    });
    up.on('error', (e) => { homes.set(sid, from.id); closeIn(to, sid, req); if (!res.headersSent) json(res, 502, { error: `realm ${to.id}: ${e.message}` }); else res.destroy(); });
    up.end(body);
  };

  const readAll = async (req: IncomingMessage, max: number) => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) { size += (c as Buffer).length; if (size > max) return null; chunks.push(c as Buffer); }
    return Buffer.concat(chunks);
  };

  /** /mcp is proxied like everything else, but the front door keeps each `initialize` and watches for `login`. */
  const mcp = async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    const sid = req.headers['mcp-session-id'] as string | undefined;
    const known = sid ? inits.get(sid) : undefined;
    if (known) known.seen = Date.now();
    if (req.method !== 'POST') {
      const r = realms[choose(req, url)];
      if (req.method === 'DELETE' && sid) { inits.delete(sid); homes.delete(sid); }
      return forward(req, res, r);
    }
    const body = await readAll(req, 1_000_000);
    if (!body) return json(res, 413, { jsonrpc: '2.0', error: { code: -32000, message: 'body too large' }, id: null });
    let msg: unknown;
    if (!sid || body.includes('"login"') || body.includes('"pair"')) { try { msg = JSON.parse(body.toString('utf8')); } catch { /* the realm answers that */ } }
    if (sid && known) {
      const target = targetRealm(msg);
      const from = realms[choose(req, url)], to = target !== null ? realms[target] : undefined;
      if (from && to && to !== from) {
        const pairing = loginToken(msg) === null; // the target realm came from a pairing code, not a key
        if (await rehome(sid, from, to, req, pairing) && pairing) return forwardPair(req, res, from, to, sid, body);
      }
    }
    forward(req, res, realms[choose(req, url)], body, !sid && isInitialize(msg) ? (status, h) => {
      const id = h['mcp-session-id'];
      if (status !== 200 || typeof id !== 'string') return;
      inits.set(id, { body, seen: Date.now() });
      if (inits.size > 20_000) { const oldest = inits.keys().next().value!; inits.delete(oldest); homes.delete(oldest); }
    } : undefined);
  };

  const front = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/api/realms') return json(res, 200, list());
    if (url.pathname === '/api/enroll' && req.method === 'POST' && !allowEnrol(req.socket.remoteAddress ?? '?'))
      return json(res, 429, { error: 'The Sorting Hat needs a rest: too many enrolments from here. Try again in a few minutes.' });
    if (url.pathname === '/mcp') {
      mcp(req, res, url).catch((e) => { if (!res.headersSent) json(res, 502, { error: String(e) }); else res.destroy(); });
      return;
    }
    forward(req, res, realms[choose(req, url)]);
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
  // LAN discovery for the whole front door (discovery.ts): every realm's players count
  if (!/^127\.|^localhost$|^::1$/.test(HOST)) {
    const dist = fileURLToPath(new URL('../../dist', import.meta.url));
    let version = '0';
    try { version = String(JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')).version); } catch { /* keep 0 */ }
    startDiscovery(PORT, () => ({ name: serverName(), port: PORT, version, build: buildId(dist), players: realms.reduce((n, r) => n + (r.stats?.players ?? 0), 0) }));
  }

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
