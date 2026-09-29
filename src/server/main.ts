// First: with REALMS=N this process becomes the front door for N realm processes and never gets past this import.
import { adoptedSessionId, clientIp, realm, realmWorker } from './realms.js';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { WebSocketServer, type WebSocket } from 'ws';
import { warmPathfinding } from '../kernel/pathfind.js';
import { ensureNpcs } from '../kernel/npc.js';
import { examLeaderboard, listExams, sitExam } from '../kernel/exams.js';
import { marketMessage } from '../kernel/market.js';
import { schoolEvents } from '../kernel/wheel.js';
import { FEATURE_BY_ID } from '../kernel/features.js';
import { TICK, World } from '../kernel/world.js';
import { HISTORY } from '../lore/history.js';
import { grimoire } from '../mcp/grimoire.js';
import { createMcpServer, isConfirmAnswer, type McpSession } from '../mcp/server.js';
import { FORGE_FAIL_PER_MIN, LOGIN_FAIL_PER_IP_PER_MIN } from '../shared/constants.js';
import { FAMILIAR_OFF, Familiars, anthropicCreate, familiarConfig } from './familiar.js';
import { SnapshotFanout } from './fanout.js';
import { buyPreset } from './shop.js';
import { FailWindow } from './limits.js';
import { serveStatic } from './static.js';
import { PROTOCOL, buildId, serverName, startDiscovery } from './discovery.js';
import { keyOf, pickProtocol } from './key.js';
import { admit, corked, enqueue, flushInputs, forget, meDue, netState, readyForSnapshot, sendMeIfChanged } from './net.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT ?? 7777);
const HOST = process.env.HOST ?? '0.0.0.0';
const DATA = process.env.HOGWARTS_DATA ?? join(ROOT, 'data/world.json');
const DIST = join(ROOT, 'dist');
/** The first LAN IPv4 address of this machine (so links work from other computers), else localhost. */
function lanAddress(): string | undefined {
  for (const list of Object.values(networkInterfaces())) for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  return undefined;
}
const LAN = lanAddress();
/** Fixed base URL when PUBLIC_URL is set; otherwise links are built from the address each player used (baseFor). */
const PUBLIC_URL = process.env.PUBLIC_URL ?? `http://${LAN ?? 'localhost'}:${PORT}`;
/**
 * The base URL to show a player or agent: PUBLIC_URL when configured, else the host they actually reached us at
 * (the browser's address bar / the MCP URL their agent used), so every copied command works from their machine
 * with no manual IP editing. Only well-formed host[:port] values are accepted.
 */
function baseFor(req: IncomingMessage): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL;
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim();
  if (!/^[A-Za-z0-9.\-]+(:\d{1,5})?$|^\[[0-9A-Fa-f:.]+\](:\d{1,5})?$/.test(host)) return PUBLIC_URL;
  const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https' ? 'https' : 'http';
  return `${proto}://${host}`;
}

// ------------------------------------------------------------------ world + persistence
function load(): World {
  if (existsSync(DATA)) {
    try {
      const w = World.restore(JSON.parse(readFileSync(DATA, 'utf8')));
      console.log(`[hogwarts] restored ${w.wizards.size} wizards from ${DATA}`);
      return w;
    } catch (e) {
      console.error('[hogwarts] could not restore world, starting fresh:', e);
    }
  }
  const w = new World();
  if (process.env.TERM_SECONDS) w.rules.terms.lengthSeconds = Math.max(120, Number(process.env.TERM_SECONDS));
  w.term.endsAt = w.now + w.rules.terms.lengthSeconds;
  return w;
}
const world = load();
world.tokenPrefix = realm.prefix;
warmPathfinding();
ensureNpcs(world, Number(process.env.NPC_COUNT ?? 4));
// 校园事件轮盘: EVENT_FIRST_S rolls the first event sooner (demos, e2e tests); the interval itself is a rule (rules.events)
if (process.env.EVENT_FIRST_S) world.wheel.nextAt = world.now + Math.max(0, Number(process.env.EVENT_FIRST_S) || 0);
function save() {
  mkdirSync(dirname(DATA), { recursive: true });
  writeFileSync(DATA + '.tmp', JSON.stringify(world.serialize()));
  renameSync(DATA + '.tmp', DATA);
}

// ------------------------------------------------------------------ the clock
let last = performance.now();
let acc = 0;
setInterval(() => {
  const t = performance.now();
  acc += Math.min(1, (t - last) / 1000);
  last = t;
  while (acc >= TICK) { flushInputs(); world.tick(TICK); acc -= TICK; } // flush: inputs merged over the rate limit (net.ts)
}, 1000 * TICK);
setInterval(save, 30_000);
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { save(); console.log('\n[hogwarts] saved. Mischief managed.'); process.exit(0); });
// One bad request must never take the castle down: log, persist, keep running.
process.on('uncaughtException', (e) => { console.error('[hogwarts] uncaught:', e); try { save(); } catch { /* ignore */ } });
process.on('unhandledRejection', (e) => { console.error('[hogwarts] unhandled rejection:', e); });

// Enrolment rate limit per client address (stops scripted throwaway wizards).
const enrolLog = new Map<string, number[]>();
function allowEnrol(req: IncomingMessage) {
  const ip = clientIp(req);
  const now = Date.now();
  const recent = (enrolLog.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  if (recent.length >= 5) return false;
  recent.push(now);
  enrolLog.set(ip, recent);
  return true;
}
/** Seconds until this address may enrol again (the oldest of its five leaves the window). */
function enrolWait(req: IncomingMessage) {
  const l = enrolLog.get(clientIp(req)) ?? [];
  return l.length ? Math.max(1, Math.ceil((l[0] + 10 * 60_000 - Date.now()) / 1000)) : 1;
}
const enrolBusy = (req: IncomingMessage) => { const n = enrolWait(req); return `The Sorting Hat needs a rest: too many enrolments from here. Try again in ${n}s. 分院帽要歇一会儿：这里入学的人太多了，${n} 秒后再试。 retry_after=${n}`; };

// Failed logins per client address: docs/AGENT_LINK.md §A.2. Every place a key is presented counts a wrong
// one (MCP login, an MCP initialize with a Bearer header, the WebSocket upgrade, /api/me, /api/owls).
const loginFails = new FailWindow(LOGIN_FAIL_PER_IP_PER_MIN);
const LOGIN_THROTTLED = 'Too many wrong keys from your address in the last minute. Wait a minute, then try again.';
/**
 * Check a presented key. The key is looked up FIRST: a right key always works, however many wrong keys
 * came from the same address (a NAT, a campus, a buggy agent on the same machine must not be able to make
 * a browser forget its key). Only a wrong key is throttled ('throttled') or counted ('unknown').
 */
function checkKey(req: IncomingMessage, token: string | undefined) {
  const w = token ? world.byToken(token) : undefined;
  if (w) return w;
  const ip = clientIp(req);
  if (!loginFails.allowed(ip)) return 'throttled' as const;
  loginFails.fail(ip);
  return 'unknown' as const;
}
/** The wizard behind a request's key; otherwise answers 401 (wrong key) or 429 (too many wrong keys) and returns undefined. */
function keyed(req: IncomingMessage, res: ServerResponse) {
  const w = checkKey(req, keyOf(req));
  if (w === 'throttled') { json(res, 429, { error: LOGIN_THROTTLED }); return undefined; }
  if (w === 'unknown') { json(res, 401, { error: 'unknown token' }); return undefined; }
  return w;
}
// Refused forge_item parcels per wizard (§B.1), shared by all of its MCP sessions: a new session does not reset it.
const forgeFails = new FailWindow(FORGE_FAIL_PER_MIN);

// ------------------------------------------------------------------ HTTP
const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
};
async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) { size += (c as Buffer).length; if (size > 1_000_000) throw new Error('body too large'); chunks.push(c as Buffer); }
  const s = Buffer.concat(chunks).toString('utf8');
  return s ? JSON.parse(s) : undefined;
}

// MCP: one transport + one McpServer per MCP session.
type McpEntry = { transport: StreamableHTTPServerTransport; session: McpSession; seen: number };
const mcpSessions = new Map<string, McpEntry>();
const MAX_MCP_SESSIONS = Number(process.env.MCP_MAX_SESSIONS ?? 500);
const MCP_IDLE_MS = 30 * 60_000;
/** A full table makes room by closing the least recently used session idle this long (a client that never closes its sessions cannot lock everyone out). */
const MCP_EVICT_IDLE_MS = Number(process.env.MCP_EVICT_IDLE_MS ?? 60_000);
/** Sessions one wizard may hold at once: a new keyed session closes that wizard's oldest beyond this. */
const MCP_PER_WIZARD = 8;
function closeMcp(id: string, e: McpEntry) {
  mcpSessions.delete(id);
  e.session.wizardId = null;
  e.transport.close().catch(() => {});
}
setInterval(() => {
  const now = Date.now();
  for (const [id, e] of mcpSessions) if (now - e.seen > MCP_IDLE_MS) closeMcp(id, e);
}, 60_000);
/** Make room for one more session: the least recently used idle one goes. False when every session is busy. */
function evictIdle(now: number): boolean {
  let old: [string, McpEntry] | null = null;
  for (const kv of mcpSessions) if (now - kv[1].seen >= MCP_EVICT_IDLE_MS && (!old || kv[1].seen < old[1].seen)) old = kv;
  if (!old) return false;
  closeMcp(old[0], old[1]);
  return true;
}
/** One wizard's sessions beyond MCP_PER_WIZARD - 1, oldest first, are closed (before a new one of theirs opens). */
function trimWizard(wid: string) {
  const mine = [...mcpSessions].filter(([, e]) => e.session.wizardId === wid).sort((a, b) => a[1].seen - b[1].seen);
  for (const [id, e] of mine.slice(0, Math.max(0, mine.length - (MCP_PER_WIZARD - 1)))) closeMcp(id, e);
}
/** MCP sessions bound to a wizard: derived by scanning, never counted (docs/AGENT_LINK.md §A.4). */
function sessionsOf(wid: string) {
  let n = 0;
  for (const e of mcpSessions.values()) if (e.session.wizardId === wid) n++;
  return n;
}
// 使魔, the built-in agent (familiar.ts): only with ANTHROPIC_API_KEY; otherwise null and invisible.
const familiarCfg = familiarConfig();
const familiars = familiarCfg
  ? new Familiars({ world, config: familiarCfg, create: anthropicCreate(), externalAgents: sessionsOf, session: { baseUrl: PUBLIC_URL, forgeFails, sessionsOf } })
  : null;
if (familiarCfg) console.error(`[familiar] on: model ${familiarCfg.model}, effort ${familiarCfg.effort}, ${familiarCfg.daily}/wizard/day, ${familiarCfg.globalDaily}/day in all, ${familiarCfg.concurrency} at once`);
/** Close code for a socket whose key was changed (it reconnects only with the new key). */
const KEY_CHANGED = 4001;
/**
 * A wizard's key changed (docs/AGENT_LINK.md §A.3). A rotation is the remedy for a leaked key, so nothing
 * that holds the old key may keep acting or learn the new one:
 *  - every MCP session bound to the wizard is closed except `keepMcp` (the agent session that asked);
 *  - every browser socket of the wizard is closed except `keepWs` (the browser tab that asked), and only
 *    that socket is sent the new key ({t:'token'}). An open socket is no proof of being the owner — a
 *    thief who had the key may hold one — so the others re-authenticate with the new key (a tab of the
 *    same browser finds it in localStorage; after an agent's rotate_key the human gets it from the agent).
 */
function rotated(wid: string, token: string, keep: { keepMcp?: string; keepWs?: WebSocket } = {}) {
  for (const [ws, id] of [...clients]) {
    if (id !== wid) continue;
    if (ws === keep.keepWs) { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'token', token })); }
    else ws.close(KEY_CHANGED, 'key changed');
  }
  for (const [id, e] of [...mcpSessions]) if (id !== keep.keepMcp && e.session.wizardId === wid) closeMcp(id, e);
}

async function handleMcp(req: IncomingMessage, res: ServerResponse, url: URL) {
  const sid = req.headers['mcp-session-id'] as string | undefined;
  const body = req.method === 'POST' ? await readBody(req) : undefined;
  let entry = sid ? mcpSessions.get(sid) : undefined;
  if (!entry) {
    if (req.method !== 'POST' || !isInitializeRequest(body)) {
      return json(res, 400, { jsonrpc: '2.0', error: { code: -32000, message: 'No valid MCP session. Start with initialize.' }, id: null });
    }
    const adopt = adoptedSessionId(req);
    const token = keyOf(req);
    // A Bearer key is a login: a wrong one counts as a failed login (and the session starts unbound).
    const keyedBy = token ? checkKey(req, token) : undefined;
    if (keyedBy === 'throttled') return json(res, 429, { jsonrpc: '2.0', error: { code: -32000, message: LOGIN_THROTTLED }, id: null });
    if (typeof keyedBy === 'object') trimWizard(keyedBy.id);
    if (mcpSessions.size >= MAX_MCP_SESSIONS && !evictIdle(Date.now())) {
      res.setHeader('Retry-After', String(Math.ceil(MCP_EVICT_IDLE_MS / 1000)));
      return json(res, 503, { jsonrpc: '2.0', error: { code: -32000, message: `Too many open MCP sessions; try again in ${Math.ceil(MCP_EVICT_IDLE_MS / 1000)}s. retry_after=${Math.ceil(MCP_EVICT_IDLE_MS / 1000)}` }, id: null });
    }
    const session: McpSession = {
      wizardId: typeof keyedBy === 'object' ? keyedBy.id : null, baseUrl: baseFor(req), ip: clientIp(req), allowEnrol: () => allowEnrol(req), enrolBusy: () => enrolBusy(req),
      loginFails, forgeFails, sessionsOf, rotated: (wid, tok, keep) => rotated(wid, tok, { keepMcp: keep }),
    };
    if (session.wizardId) world.touch(session.wizardId);
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      // REALMS: the front door moves a session here (MCP `login` with this realm's token) under its existing id.
      sessionIdGenerator: () => (adopt && !mcpSessions.has(adopt) ? adopt : realm.prefix + randomUUID()),
      onsessioninitialized: (id) => { session.id = id; mcpSessions.set(id, { transport, session, seen: Date.now() }); },
    });
    transport.onclose = () => { if (transport.sessionId) mcpSessions.delete(transport.sessionId); };
    await createMcpServer(world, session).connect(transport);
    entry = { transport, session, seen: Date.now() };
  }
  entry.seen = Date.now();
  await entry.transport.handleRequest(req, res, body);
}

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS' });
      return res.end();
    }
    if (url.pathname === '/mcp') return await handleMcp(req, res, url);
    if (url.pathname === '/api/enroll' && req.method === 'POST') {
      if (!allowEnrol(req)) { res.setHeader('Retry-After', String(enrolWait(req))); return json(res, 429, { error: enrolBusy(req) }); }
      const b = (await readBody(req)) as { name?: string; house?: string } | undefined;
      try {
        const { wizard, sorting } = world.enroll(String(b?.name ?? ''), b?.house);
        return json(res, 200, { token: wizard.token, name: wizard.name, house: wizard.house, sorting });
      } catch (e) {
        return json(res, 400, { error: (e as Error).message });
      }
    }
    if (url.pathname === '/api/me') {
      const w = keyed(req, res);
      return w ? json(res, 200, { ...world.whoami(w.id), mcpUrl: `${baseFor(req)}/mcp` }) : undefined;
    }
    // The player's owls to their agent after owl id `since` (default: after what the agent has read), for a
    // stdio bridge's channel push (docs/AGENT_LINK.md §C.4). Read-only, and not presence: polling it neither
    // consumes owls nor keeps the wizard online. `cursor` is what to pass as `since` next time.
    if (url.pathname === '/api/owls' && req.method === 'GET') {
      const w = keyed(req, res);
      if (!w) return;
      const raw = url.searchParams.get('since');
      const since = raw !== null && /^\d{1,12}$/.test(raw) ? Number(raw) : undefined;
      // answers to confirm_with_player went to the agent as {approved}: not pushed again as the human's words
      const all = world.owlsFor(w.id, since);
      const owls = all.filter((m) => !isConfirmAnswer(w.owlbox, m.re));
      return json(res, 200, { owls, cursor: all.at(-1)?.id ?? since ?? w.agentReadUpTo, read: w.agentReadUpTo });
    }
    if (url.pathname === '/api/version') return json(res, 200, version());
    if (url.pathname === '/api/realms') return json(res, 200, { mode: realm.mode, realms: [{ id: realm.id, up: true, ...realmStats(), restarts: 0 }] });
    if (url.pathname === '/api/leaderboard') return json(res, 200, world.leaderboard());
    if (url.pathname === '/api/history') return json(res, 200, HISTORY);
    if (url.pathname === '/api/rules') return json(res, 200, { rules: world.rules, decrees: world.decrees });
    return serveStatic(DIST, req, res, url.pathname);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: String(e) });
  }
});

// ------------------------------------------------------------------ WebSocket (3D clients)
type ClientMsg =
  | { t: 'input'; dx: number; dz: number; f?: number }
  | { t: 'cast'; key: string; x?: number; z?: number; target?: string }
  | { t: 'chat'; text: string }
  | { t: 'equip'; item: string }
  | { t: 'unequip'; slot: string }
  | { t: 'book' }
  | { t: 'simulate'; source: string; x?: number; z?: number; target?: string }
  | { t: 'forge'; name: string; incantation?: string; source: string; slot?: number }
  | { t: 'unlearn'; spell: string }
  | { t: 'hotbar'; slots: (string | null)[] }
  | { t: 'goto'; x: number; z: number }
  | { t: 'dodge'; dx: number; dz: number }
  // (a feature's own messages, {t: feature id, …} — seals, da, study, duel, quidditch, … — go to kernel/features.ts before this switch)
  // Owl Post (docs/AGENT_LINK.md §C.5)
  | { t: 'owl'; text: string }
  | { t: 'answer'; id: number; choice: string }
  | { t: 'paircode' }
  | { t: 'rotate' }
  | { t: 'pause'; on: boolean }
  | { t: 'destroy'; item: string }
  // 使魔 (familiar.ts): summon or dismiss the built-in agent
  | { t: 'familiar'; on: boolean; kind?: string }
  // O.W.L. exams (kernel/exams.ts)
  | { t: 'exams' }
  | { t: 'sit'; id: string; source: string }
  | { t: 'examboard'; id?: string }
  // the browser shop: a fixed preset forged into your own trunk (shop.ts)
  | { t: 'buy'; item: string; lang?: string }
  // 咒语集市 (kernel/market.ts marketMessage): reads and actions; replies { t: 'market', op, r } (+ a fresh book)
  | { t: 'market'; op?: 'browse' | 'spell'; [k: string]: unknown }
  | { t: 'marketop'; op: 'publish' | 'unpublish' | 'copy' | 'fork'; [k: string]: unknown }
  // 学院杯 · 校园事件轮盘 · 巧克力蛙画片: open the chest you stand at (F); the school's news and your album
  | { t: 'chest' }
  | { t: 'school' };

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const aimOf = (m: { x?: unknown; z?: unknown }) => (finite(m.x) && finite(m.z) ? { x: m.x, z: m.z } : null);

/** Every browser action goes through the same World syscalls as MCP. Nothing a client sends may throw out of here. */
function handleClient(ws: WebSocket, wid: string, m: ClientMsg) {
  const w = world.wizards.get(wid);
  if (!w || !m || typeof m !== 'object') return;
  const reply = (o: unknown) => ws.send(JSON.stringify(o));
  const book = () => reply({ t: 'book', armory: world.armory(wid), grimoire: grimoire(w.year, world.rules, w.seals) });
  const items = () => reply({ t: 'items', items: world.armory(wid).items });
  try {
    // a feature's own messages {t: feature id, …} (kernel/features.ts), answered as {t, r}
    const feat = typeof m.t === 'string' ? FEATURE_BY_ID.get(m.t) : undefined;
    if (feat?.ws) { reply({ t: feat.id, r: feat.ws(world, wid, m as unknown as Record<string, unknown>) }); return; }
    switch (m.t) {
      case 'input': world.setInput(wid, finite(m.dx) ? m.dx : 0, finite(m.dz) ? m.dz : 0, finite(m.f) ? m.f : undefined); break;
      case 'cast': reply({ t: 'cast', r: world.cast(wid, String(m.key), { aim: aimOf(m), target: typeof m.target === 'string' ? m.target : null }) }); break;
      case 'chat': world.say(w, String(m.text ?? '')); break;
      case 'equip': world.equip(wid, String(m.item)); items(); break;
      case 'unequip': world.unequip(wid, String(m.slot)); items(); break;
      case 'destroy': { const it = world.destroyItem(wid, String(m.item)); reply({ t: 'destroyed', item: it.id, name: it.name }); items(); break; }
      case 'owl': world.owl(wid, 'player', String(m.text ?? '')); break;
      case 'answer': world.answerAsk(wid, Number(m.id), String(m.choice ?? '')); break;
      case 'paircode': { const c = world.mintPairCode(wid); reply({ t: 'paircode', code: c.code, expiresIn: c.expiresIn }); break; }
      case 'rotate': rotated(wid, world.rotateToken(wid), { keepWs: ws }); break;
      case 'pause': world.setAgentPaused(wid, m.on === true); break;
      case 'familiar': if (!familiars) throw new Error(FAMILIAR_OFF); reply({ t: 'familiar', s: familiars.summon(wid, m.on === true, m.kind) }); break;
      case 'book': book(); break;
      case 'simulate': reply({ t: 'sim', r: world.simulate(wid, String(m.source ?? ''), { aim: aimOf(m), target: typeof m.target === 'string' ? m.target : null }) }); break;
      case 'forge': {
        const r = world.forgeSpell(wid, { name: String(m.name ?? ''), incantation: m.incantation ? String(m.incantation) : undefined, source: String(m.source ?? ''), slot: finite(m.slot) ? m.slot : undefined });
        reply({ t: 'forged', name: r.spell.name, notes: r.notes });
        book();
        break;
      }
      case 'unlearn': world.unlearn(wid, String(m.spell)); book(); break;
      case 'goto': reply({ t: 'goto', goal: finite(m.x) && finite(m.z) ? world.setGoal(wid, { x: m.x, z: m.z }) : world.setGoal(wid, null) }); break;
      case 'dodge': world.dodge(wid, finite(m.dx) ? m.dx : 0, finite(m.dz) ? m.dz : 0); break; // (a roll on cooldown just does nothing)
      case 'hotbar': if (Array.isArray(m.slots)) { world.setHotbar(wid, m.slots.map((x) => (x ? String(x) : null))); book(); } break;
      case 'exams': reply({ t: 'exams', r: listExams(world, wid) }); break;
      case 'sit': reply({ t: 'sat', r: sitExam(world, wid, String(m.id ?? ''), String(m.source ?? '').slice(0, 4000)) }); break;
      // one exam's top 10 (the browser's O.W.L. panel; MCP exam_leaderboard)
      case 'examboard': reply({ t: 'examboard', r: examLeaderboard(world, wid, typeof m.id === 'string' ? m.id : undefined) }); break;
      case 'buy': reply({ t: 'bought', r: buyPreset(world, wid, String(m.item ?? ''), m.lang === 'en' ? 'en' : 'zh') }); book(); break;
      case 'chest': reply({ t: 'chest', r: world.openChest(wid) }); break;
      case 'school': reply({ t: 'school', r: schoolEvents(world, wid) }); break;
      case 'market':
      case 'marketop': {
        const r = marketMessage(world, wid, m);
        reply({ t: 'market', op: r.op, r: r.r });
        if (r.book) book();
        break;
      }
    }
  } catch (e) {
    reply({ t: 'err', error: (e as Error).message });
  }
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, handleProtocols: pickProtocol });
const clients = new Map<WebSocket, string>();
http.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname !== '/ws') return socket.destroy();
  const w = checkKey(req, keyOf(req));
  if (w === 'throttled') { socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n'); return socket.destroy(); }
  if (w === 'unknown') { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
  wss.handleUpgrade(req, socket, head, (ws) => {
    clients.set(ws, w.id);
    w.connections++;
    // No token here (the client has it) and no `who` on events (registry ids): World.wireEvent.
    const recent = world.events.filter((e) => !e.to || e.to === w.id).slice(-30).map((e) => world.wireEvent(e));
    ws.send(JSON.stringify({ t: 'welcome', handle: w.handle, name: w.name, house: w.house, registry: w.id, events: recent, owls: w.owlbox.slice(-30), pair: world.pairCodeOf(w.id), mcpUrl: `${baseFor(req)}/mcp`, build: buildId(DIST), ...(familiars ? { familiar: familiars.stateOf(w.id) } : {}) }));
    // Area-of-interest snapshots only for clients that say they handle entities leaving their area (aoi=1),
    // or for everyone with AOI_ALL=1; the others get the full snapshot as before (fanout.ts).
    netState(ws).aoi = fanout.enabled && (AOI_ALL || url.searchParams.get('aoi') === '1');
    ws.on('message', (raw) => {
      let m: ClientMsg;
      try { m = JSON.parse(String(raw)); } catch { return; }
      admit(ws, m, (x) => handleClient(ws, w.id, x as ClientMsg)); // per-socket rate limits (net.ts)
    });
    ws.on('error', () => ws.terminate());
    ws.on('close', () => { forget(ws); clients.delete(ws); w.connections = Math.max(0, w.connections - 1); world.setInput(w.id, 0, 0); });
  });
});

// Events: encoded once, queued for the sockets connected right now, written with the next broadcast (net.ts).
world.onEvent((e) => {
  const msg = Buffer.from(JSON.stringify({ t: 'event', e: world.wireEvent(e) }));
  for (const [ws, wid] of clients) if (!e.to || e.to === wid) enqueue(ws, msg);
});

// Snapshots: built and serialised once per broadcast (fanout.ts). Clients with AOI get the entities
// within AOI_RADIUS metres of them (0 = AOI off), shared by every client anchored to the same cell;
// the others share one full snapshot. The private 'me' state goes out at most 5 Hz and only when it
// changed; slow sockets skip snapshots; each socket gets its events + snapshot + 'me' in one write (net.ts).
const fanout = new SnapshotFanout(Number(process.env.AOI_RADIUS ?? 140), Number(process.env.AOI_CELL ?? 16), Number(process.env.AOI_MARGIN ?? 10));
const AOI_ALL = process.env.AOI_ALL === '1';
let broadcasts = 0;
setInterval(() => {
  if (!clients.size) { world.drainFx(); return; }
  broadcasts++;
  flushInputs();
  fanout.load(world.snapshot());
  // MCP sessions per wizard for me.agent.sessions, counted once per broadcast (only if some socket needs it)
  let agents: Map<string, number> | null = null;
  const agentSessions = (wid: string) => {
    if (!agents) {
      agents = new Map();
      for (const e of mcpSessions.values()) if (e.session.wizardId) agents.set(e.session.wizardId, (agents.get(e.session.wizardId) ?? 0) + 1);
    }
    return agents.get(wid) ?? 0;
  };
  const second = broadcasts % 10 === 0;
  for (const [ws, wid] of clients) {
    corked(ws, () => {
      const w = world.wizards.get(wid);
      if (!w || !readyForSnapshot(ws)) return;
      // 看 Agent 玩: what your agent is doing (with spell sources), once a second while it plays
      if (second && w.agentSeen && world.agentActive(w)) ws.send(JSON.stringify({ t: 'agentlog', s: world.agentActivity(wid) }));
      const st = netState(ws);
      ws.send(st.aoi ? fanout.payloadFor(w.pos.x, w.pos.z, st.anchor) : fanout.fullPayload(), { binary: false });
      if (meDue(ws, broadcasts)) {
        const s = world.privateState(wid);
        sendMeIfChanged(ws, JSON.stringify({ t: 'me', s: { ...s, agent: { ...s.agent, sessions: agentSessions(wid), ...(familiars ? { familiar: familiars.stateOf(wid) } : {}) } } }));
      }
    });
  }
}, 100);

function realmStats() {
  let players = 0;
  for (const x of world.wizards.values()) if (!x.npc && world.online(x)) players++;
  return { players, wizards: world.wizards.size, clients: clients.size, mcp: mcpSessions.size };
}

// Failing to bind is fatal (the uncaughtException guard above must not keep a deaf process alive).
/** What this server is (GET /api/version, the LAN discovery answer): the desktop client checks it before connecting. */
const PKG_VERSION = (() => { try { return String(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version); } catch { return '0'; } })();
const onlinePlayers = () => { let n = 0; for (const w of world.wizards.values()) if (!w.npc && world.online(w)) n++; return n; };
const version = () => ({ name: serverName(), version: PKG_VERSION, build: buildId(DIST), protocol: PROTOCOL, players: onlinePlayers() });
// LAN discovery (discovery.ts): answers "HOGWARTS?" on PORT/udp, so desktop clients and `npm run find` list this server
if (realm.mode === 'single' && !/^127\.|^localhost$|^::1$/.test(HOST)) startDiscovery(PORT, () => ({ ...version(), port: PORT }));

http.on('error', (e) => { console.error(`[hogwarts] cannot listen on ${HOST}:${PORT}:`, (e as Error).message); process.exit(1); });
http.listen(PORT, HOST, () => {
  if (!process.env.PUBLIC_URL) console.log(`[hogwarts] 本机 http://localhost:${PORT}${LAN ? `   局域网 http://${LAN}:${PORT}（别的电脑用这个；游戏里的连接命令会自动填上玩家实际访问的地址）` : ''}`);
  console.log(`[hogwarts] ${PUBLIC_URL}  (MCP: ${PUBLIC_URL}/mcp, WS: /ws)  term ${world.term.n}, ${world.rules.terms.lengthSeconds}s per term${realm.mode === 'worker' ? `  [realm ${realm.id}]` : ''}`);
  realmWorker(http, realmStats);
});
