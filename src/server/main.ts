import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { WebSocketServer, type WebSocket } from 'ws';
import { warmPathfinding } from '../kernel/pathfind.js';
import { TICK, World } from '../kernel/world.js';
import { HISTORY } from '../lore/history.js';
import { grimoire } from '../mcp/grimoire.js';
import { createMcpServer, type McpSession } from '../mcp/server.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT ?? 7777);
const HOST = process.env.HOST ?? '0.0.0.0';
const DATA = process.env.HOGWARTS_DATA ?? join(ROOT, 'data/world.json');
const DIST = join(ROOT, 'dist');
const PUBLIC_URL = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`;

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
warmPathfinding();
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
  while (acc >= TICK) { world.tick(TICK); acc -= TICK; }
}, 1000 * TICK);
setInterval(save, 30_000);
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { save(); console.log('\n[hogwarts] saved. Mischief managed.'); process.exit(0); });

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
const tokenOf = (req: IncomingMessage, url: URL) => {
  const h = req.headers.authorization;
  if (h?.toLowerCase().startsWith('bearer ')) return h.slice(7).trim();
  return (req.headers['x-wizard-token'] as string | undefined) ?? url.searchParams.get('token') ?? undefined;
};

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon' };
function serveStatic(res: ServerResponse, path: string) {
  if (!existsSync(DIST)) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<h1>Hogwarts server is running</h1><p>No client build found. Run <code>npm run build</code>, or use <code>npm run dev</code> and open the Vite URL.</p><p>MCP endpoint: <code>/mcp</code></p>');
    return;
  }
  let file = normalize(join(DIST, path === '/' ? 'index.html' : path));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}

// MCP: one transport + one McpServer per MCP session.
const mcpSessions = new Map<string, { transport: StreamableHTTPServerTransport; session: McpSession }>();

async function handleMcp(req: IncomingMessage, res: ServerResponse, url: URL) {
  const sid = req.headers['mcp-session-id'] as string | undefined;
  const body = req.method === 'POST' ? await readBody(req) : undefined;
  let entry = sid ? mcpSessions.get(sid) : undefined;
  if (!entry) {
    if (req.method !== 'POST' || !isInitializeRequest(body)) {
      return json(res, 400, { jsonrpc: '2.0', error: { code: -32000, message: 'No valid MCP session. Start with initialize.' }, id: null });
    }
    const token = tokenOf(req, url);
    const session: McpSession = { wizardId: token ? world.byToken(token)?.id ?? null : null, baseUrl: PUBLIC_URL };
    if (session.wizardId) world.touch(session.wizardId);
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => { mcpSessions.set(id, { transport, session }); },
    });
    transport.onclose = () => { if (transport.sessionId) mcpSessions.delete(transport.sessionId); };
    await createMcpServer(world, session).connect(transport);
    entry = { transport, session };
  }
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
      const b = (await readBody(req)) as { name?: string; house?: string } | undefined;
      try {
        const { wizard, sorting } = world.enroll(String(b?.name ?? ''), b?.house);
        return json(res, 200, { token: wizard.token, name: wizard.name, house: wizard.house, sorting });
      } catch (e) {
        return json(res, 400, { error: (e as Error).message });
      }
    }
    if (url.pathname === '/api/me') {
      const w = world.byToken(tokenOf(req, url) ?? '');
      return w ? json(res, 200, { ...world.whoami(w.id), token: w.token, mcpUrl: `${PUBLIC_URL}/mcp` }) : json(res, 401, { error: 'unknown token' });
    }
    if (url.pathname === '/api/leaderboard') return json(res, 200, world.leaderboard());
    if (url.pathname === '/api/history') return json(res, 200, HISTORY);
    if (url.pathname === '/api/rules') return json(res, 200, { rules: world.rules, decrees: world.decrees });
    return serveStatic(res, url.pathname);
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
  | { t: 'hotbar'; slots: (string | null)[] };

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const aimOf = (m: { x?: unknown; z?: unknown }) => (finite(m.x) && finite(m.z) ? { x: m.x, z: m.z } : null);

/** Every browser action goes through the same World syscalls as MCP. Nothing a client sends may throw out of here. */
function handleClient(ws: WebSocket, wid: string, m: ClientMsg) {
  const w = world.wizards.get(wid);
  if (!w || !m || typeof m !== 'object') return;
  const reply = (o: unknown) => ws.send(JSON.stringify(o));
  const book = () => reply({ t: 'book', armory: world.armory(wid), grimoire: grimoire(w.year, world.rules) });
  try {
    switch (m.t) {
      case 'input': world.setInput(wid, finite(m.dx) ? m.dx : 0, finite(m.dz) ? m.dz : 0, finite(m.f) ? m.f : undefined); break;
      case 'cast': reply({ t: 'cast', r: world.cast(wid, String(m.key), { aim: aimOf(m), target: typeof m.target === 'string' ? m.target : null }) }); break;
      case 'chat': world.say(w, String(m.text ?? '')); break;
      case 'equip': world.equip(wid, String(m.item)); break;
      case 'unequip': world.unequip(wid, String(m.slot)); break;
      case 'book': book(); break;
      case 'simulate': reply({ t: 'sim', r: world.simulate(wid, String(m.source ?? ''), { aim: aimOf(m), target: typeof m.target === 'string' ? m.target : null }) }); break;
      case 'forge': {
        const r = world.forgeSpell(wid, { name: String(m.name ?? ''), incantation: m.incantation ? String(m.incantation) : undefined, source: String(m.source ?? ''), slot: finite(m.slot) ? m.slot : undefined });
        reply({ t: 'forged', name: r.spell.name, notes: r.notes });
        book();
        break;
      }
      case 'unlearn': world.unlearn(wid, String(m.spell)); book(); break;
      case 'hotbar': if (Array.isArray(m.slots)) { world.setHotbar(wid, m.slots.map((x) => (x ? String(x) : null))); book(); } break;
    }
  } catch (e) {
    reply({ t: 'err', error: (e as Error).message });
  }
}

const wss = new WebSocketServer({ noServer: true });
const clients = new Map<WebSocket, string>();
http.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname !== '/ws') return socket.destroy();
  const w = world.byToken(url.searchParams.get('token') ?? '');
  if (!w) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
  wss.handleUpgrade(req, socket, head, (ws) => {
    clients.set(ws, w.id);
    w.connections++;
    const recent = world.events.filter((e) => !e.to || e.to === w.id).slice(-30);
    ws.send(JSON.stringify({ t: 'welcome', handle: w.handle, name: w.name, house: w.house, events: recent, mcpUrl: `${PUBLIC_URL}/mcp`, token: w.token }));
    ws.on('message', (raw) => {
      let m: ClientMsg;
      try { m = JSON.parse(String(raw)); } catch { return; }
      handleClient(ws, w.id, m);
    });
    ws.on('close', () => { clients.delete(ws); w.connections = Math.max(0, w.connections - 1); world.setInput(w.id, 0, 0); });
  });
});

world.onEvent((e) => {
  const msg = JSON.stringify({ t: 'event', e });
  for (const [ws, wid] of clients) if (!e.to || e.to === wid) ws.send(msg);
});
setInterval(() => {
  if (!clients.size) { world.drainFx(); return; }
  const snap = JSON.stringify({ t: 'snap', s: world.snapshot() });
  for (const [ws, wid] of clients) {
    ws.send(snap);
    ws.send(JSON.stringify({ t: 'me', s: world.privateState(wid) }));
  }
}, 100);

http.listen(PORT, HOST, () => {
  console.log(`[hogwarts] ${PUBLIC_URL}  (MCP: ${PUBLIC_URL}/mcp, WS: /ws)  term ${world.term.n}, ${world.rules.terms.lengthSeconds}s per term`);
});
