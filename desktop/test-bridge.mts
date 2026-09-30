/**
 * End-to-end test of `hogwarts-desktop --mcp-stdio` with the MCP SDK client and a real server:
 *   enroll through the bridge (the key goes to the keychain and out of the reply), whoami, an owl from the human
 *   arrives as a channel notification, restart the server (the bridge rebuilds its session with the saved key),
 *   whoami again.
 *
 *   cd desktop/src-tauri && cargo build && cd ../..
 *   dbus-run-session -- bash -c 'printf pw | gnome-keyring-daemon --unlock --replace --daemonize --components=secrets >/dev/null; sleep 1;
 *     npx tsx desktop/test-bridge.mts desktop/src-tauri/target/debug/hogwarts-desktop /tmp/hw-bridge 17992 [--stripped]'
 * --stripped starts the bridge with the SDK's default (minimal) environment, as some MCP clients do: on Linux
 * there is then no keychain, and the key is kept for the session and left in the reply (macOS / Windows still have one).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WebSocket } from 'ws';
import { z } from 'zod';

const [exe, dir, port = '17992'] = process.argv.slice(2);
const stripped = process.argv.includes('--stripped');
mkdirSync(dir, { recursive: true });
const start = () => new Promise<ChildProcess>((ok) => {
  const p = spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts'], { env: { ...process.env, PORT: port, HOST: '127.0.0.1', HOGWARTS_DATA: `${dir}/world.json`, NPC_COUNT: '0' }, stdio: ['ignore', 'pipe', 'ignore'] });
  p.stdout!.on('data', (d: Buffer) => { if (String(d).includes('per term')) setTimeout(() => ok(p), 300); });
});
let srv = await start();
process.on('exit', () => { try { srv.kill('SIGTERM'); } catch { /* gone */ } });
let failed = false;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed = true; };

const c = new Client({ name: 'bridge-test', version: '1' });
const channel: { content: string; meta: { kind: string } }[] = [];
c.setNotificationHandler(z.object({ method: z.literal('notifications/claude/channel'), params: z.any() }) as never, (n: { params: (typeof channel)[0] }) => { channel.push(n.params); });
await c.connect(new StdioClientTransport({ command: exe, args: ['--mcp-stdio', '--server', `http://127.0.0.1:${port}`], stderr: 'inherit', ...(stripped ? {} : { env: process.env as Record<string, string> }) }));
const text = async (name: string, args: object = {}) => ((await c.callTool({ name, arguments: args })) as { content: { text: string }[] }).content.map((x) => x.text).join('\n');
check((await c.listTools()).tools.some((t) => t.name === 'whoami'), 'tools listed through the bridge');
const e = JSON.parse(await text('enroll', { name: `Bridge ${Date.now() % 100000}` }));
// a stripped environment only loses the keychain on Linux (Secret Service over D-Bus); macOS / Windows keep theirs
if (stripped && process.platform === 'linux') check(typeof e.token === 'string' && e.token.length > 8 && !/keychain/.test(e.token), 'no keychain: the key is left in the reply');
else check(/keychain/.test(String(e.token)) && !JSON.stringify(e).includes("#k=") && !e.connect?.bridge && !String(e.token).includes(String(JSON.parse(await text('whoami')).registry ?? 'x')), `the key went to the keychain, not to the model (token field: ${e.token})`);
check(JSON.parse(await text('whoami')).name === e.name, 'whoami: bound to the new wizard');
check(!!c.getServerCapabilities()?.experimental?.['claude/channel'], 'the bridge declares claude/channel');
// the human's owl (sent from the game window, which holds the key): with the keychain the test cannot read the
// key back, so this runs where the key stayed in the reply
if (stripped) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { authorization: `Bearer ${e.token}` } });
  await new Promise((ok) => ws.once('message', ok));
  ws.send(JSON.stringify({ t: 'owl', text: 'come to the lake' }));
  const t0 = Date.now();
  while (!channel.length && Date.now() - t0 < 8000) await new Promise((ok) => setTimeout(ok, 200));
  check(channel[0]?.meta?.kind === 'owl' && channel[0].content.includes('come to the lake') && !JSON.stringify(channel).includes(e.token), 'an owl from the human arrives as a channel notification');
  ws.close();
}
srv.kill('SIGTERM');
await new Promise((r) => setTimeout(r, 1500));
srv = await start();
const w = await text('whoami');
check(w.startsWith('{') && JSON.parse(w).name === e.name, 'after a server restart: session rebuilt with the key');
await c.close();
process.exit(failed ? 1 : 0);
