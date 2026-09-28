/**
 * stdio <-> HTTP bridge for MCP clients that speak stdio (docs/AGENT_LINK.md §A.1, §C.4).
 *
 *   npx tsx src/mcp/stdio-bridge.ts http://host:7777/mcp        (or HOGWARTS_URL=…; `npm run owl -- <url>`)
 *
 * - Key: HOGWARTS_TOKEN, else the keyring (~/.hogwarts/credentials.json, keyring.ts), else none (the
 *   agent enrols or pairs). An env key that works is also written to the keyring; a stale env key (rotated
 *   since) falls back to the keyring's.
 * - After enroll / login / pair / rotate_key succeed, the key is saved FIRST and only then removed from the
 *   text the model sees. If saving fails the result passes through unchanged and stderr says why.
 * - A dead upstream session (server restart, idle timeout, HTTP 400 "No valid MCP session") is rebuilt
 *   with the current key and the call is retried once.
 * - The client's name (clientInfo) and its elicitation capability are forwarded, so the HUD shows the
 *   real client and confirm_with_player / decree can ask the human at the terminal.
 * - Channel push: declares experimental 'claude/channel' and polls GET /api/owls every 2 s, sending
 *   notifications/claude/channel for each new owl from the human.
 * - Status goes to stderr only ("hogwarts: playing as <name> (<registry>)"). The key is never printed.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema, ElicitRequestSchema, InitializeRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema,
  ReadResourceRequestSchema, type CallToolResult, type ClientCapabilities, type InitializeRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { displayPath, keyringPath, loadKey, saveKey } from './keyring.js';

const arg = process.argv.slice(2).find((a) => !a.startsWith('-'));
const url = new URL(arg ?? process.env.HOGWARTS_URL ?? 'http://localhost:7777/mcp');
const ring = keyringPath();
const SAVED = `(已保存到 ${displayPath(ring)} / saved to ${displayPath(ring)})`;
const KEY_TOOLS = new Set(['enroll', 'login', 'pair', 'rotate_key']);
const log = (s: string) => process.stderr.write(`hogwarts: ${s}\n`);

let token: string | null = null;
let clientInfo = { name: 'hogwarts-stdio-bridge', version: '0.8.0' };
let wantElicit = false;
let upstream: Client | null = null;
let server: Server;

const api = (path: string) => new URL(path, url);
/** GET an /api path with the key in a header (never in the URL). */
async function getJson(path: string, key: string): Promise<{ status: number; body: any }> {
  const r = await fetch(api(path), { headers: { authorization: `Bearer ${key}` } });
  return { status: r.status, body: await r.json().catch(() => null) };
}

/** Pick the key to start with: env first, then the keyring; an env key that works is saved. */
async function chooseKey() {
  const env = process.env.HOGWARTS_TOKEN?.trim() || null;
  const stored = loadKey(url, ring)?.token ?? null;
  const tries = [...new Set([env, stored].filter((x): x is string => !!x))];
  for (const k of tries) {
    try {
      const me = await getJson('api/me', k);
      if (me.status === 200) {
        token = k;
        if (k === env && k !== stored) {
          try { saveKey(url, { token: k, registry: me.body?.registry, name: me.body?.name }, ring); } catch (e) { log(`could not save the key to ${displayPath(ring)}: ${(e as Error).message}`); }
        }
        log(`playing as ${me.body?.name} (${me.body?.registry})`);
        return;
      }
    } catch { token = tries[0]; log(`server not reachable at ${url.origin} yet; will retry on the first call`); return; }
  }
  if (tries.length) log('the saved key no longer works (it was changed?): pair again with a code from the game');
  else log(`not logged in yet: enroll, or pair with a code from the game (${url.origin})`);
}

async function connectUpstream() {
  const caps: ClientCapabilities = wantElicit ? { elicitation: { form: {} } } : {};
  const c = new Client(clientInfo, { capabilities: caps });
  if (wantElicit) {
    // an upstream question for the human goes to the real client and back
    c.setRequestHandler(ElicitRequestSchema, (req, extra) => server.elicitInput(req.params as never, { signal: extra.signal }));
  }
  await c.connect(new StreamableHTTPClientTransport(url, token ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : undefined));
  upstream = c;
  return c;
}
const up = async () => upstream ?? connectUpstream();
// a session the server no longer knows (restart, idle timeout), or a connection the restart cut
const deadSession = (e: unknown) => /No valid MCP session|HTTP 40[04]|session not found|fetch failed|ECONNRESET|ECONNREFUSED|socket hang up|other side closed/i.test(String((e as Error)?.message ?? e));

/** Run fn on the upstream; on a dead session rebuild it (current key) and retry once. */
async function withUpstream<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  try { return await fn(await up()); } catch (e) {
    if (!deadSession(e)) throw e;
    upstream?.close().catch(() => {});
    upstream = null;
    log('server session ended; reconnecting');
    return fn(await connectUpstream());
  }
}

/** After a key tool succeeded: save the key first, then take it out of the model-visible text. */
function intercept(tool: string, r: CallToolResult): CallToolResult {
  if (!KEY_TOOLS.has(tool) || r.isError) return r;
  const text = r.content?.[0]?.type === 'text' ? r.content[0].text : '';
  let data: any;
  try { data = JSON.parse(text); } catch { return r; }
  const key = typeof data?.token === 'string' ? data.token : null;
  if (!key) return r;
  token = key;
  try { saveKey(url, { token: key, registry: data.registry, name: data.name }, ring); } catch (e) {
    log(`could not save the key to ${displayPath(ring)} (${(e as Error).message}); it is passed on unchanged — store it yourself`);
    return r;
  }
  data.token = SAVED;
  if (data.play) { data.play = `${url.origin}/`; data.playNote = `Your human opens this and logs in with the key in ${displayPath(ring)}.`; }
  data.remember = { saved: `The bridge saved your key in ${displayPath(ring)}; new sessions log in automatically. Do not ask for the key or write it anywhere.` };
  log(`playing as ${data.name} (${data.registry})`);
  // belt and braces: no copy of the key survives anywhere in the text
  const clean = JSON.stringify(data, null, 2).split(key).join(SAVED);
  return { ...r, content: [{ type: 'text', text: clean }, ...(r.content ?? []).slice(1)] };
}

// ---------------------------------------------------------------- channel push (§C.4 item 1)
let cursor: number | undefined;
let pushing = false;
async function pollOwls() {
  if (pushing || !token) return;
  pushing = true;
  try {
    const q = cursor === undefined ? 'api/owls' : `api/owls?since=${cursor}`;
    const r = await getJson(q, token);
    if (r.status !== 200 || !r.body) return;
    const read = Number(r.body.read ?? 0);
    for (const m of r.body.owls ?? []) {
      if (m.id <= read) continue; // already read with listen
      await server.notification({ method: 'notifications/claude/channel', params: { content: `🦉 主人说：${m.text}`, meta: { kind: 'owl', id: String(m.id) } } }).catch(() => {});
    }
    cursor = r.body.cursor;
  } catch { /* server down: the next poll tries again */ } finally { pushing = false; }
}

// ---------------------------------------------------------------- the stdio side
const BRIDGE_NOTE = '\nThrough this bridge your key is saved and restored for you. Owls from your human may also arrive as <channel source="hogwarts" kind="owl"> messages; answer with tell_player and still call listen to acknowledge them.';
server = new Server({ name: 'hogwarts', version: '0.8.0' }, {
  capabilities: { tools: {}, resources: {}, experimental: { 'claude/channel': {} } },
  instructions: 'Hogwarts (Owl Post bridge).' + BRIDGE_NOTE,
});
const origInit = (server as any)._oninitialize.bind(server) as (r: InitializeRequest) => Promise<unknown>;
server.setRequestHandler(InitializeRequestSchema, async (req) => {
  clientInfo = { name: req.params.clientInfo?.name || clientInfo.name, version: req.params.clientInfo?.version || '0' };
  wantElicit = !!req.params.capabilities?.elicitation;
  try {
    const c = await connectUpstream();
    (server as any)._instructions = (c.getInstructions() ?? '') + BRIDGE_NOTE;
  } catch (e) { log(`server not reachable (${(e as Error).message}); will retry on the first call`); }
  return origInit(req) as never;
});
server.setRequestHandler(ListToolsRequestSchema, (req) => withUpstream((c) => c.listTools(req.params)));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const r = (await withUpstream((c) => c.callTool(req.params))) as CallToolResult;
  return intercept(req.params.name, r);
});
server.setRequestHandler(ListResourcesRequestSchema, (req) => withUpstream((c) => c.listResources(req.params)));
server.setRequestHandler(ReadResourceRequestSchema, (req) => withUpstream((c) => c.readResource(req.params)));

await chooseKey();
await server.connect(new StdioServerTransport());
if (process.env.HOGWARTS_CHANNEL !== '0') setInterval(() => void pollOwls(), 2000).unref();
