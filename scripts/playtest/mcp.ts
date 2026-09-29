/**
 * A one-shot MCP client for playtesting from a shell, one tool call per command, exactly the tools an agent sees:
 *   npx tsx scripts/playtest/mcp.ts --url http://localhost:7777/mcp --me ./me.key enroll '{"name":"Luna"}'
 *   npx tsx scripts/playtest/mcp.ts --me ./me.key whoami
 *   npx tsx scripts/playtest/mcp.ts --me ./me.key cast '{"spell":"1","target":"c12"}'
 *   npx tsx scripts/playtest/mcp.ts --me ./me.key tools          (the tool list with descriptions)
 *   npx tsx scripts/playtest/mcp.ts instructions                 (the server's instructions for agents)
 * `--me FILE` holds this player's Owl Post key: enroll/login/pair write it there (mode 0600) and every other call
 * sends it as the Bearer header, so each command binds the same wizard. The key is never printed.
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(k); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const url = new URL(flag('--url') ?? process.env.HOGWARTS_URL ?? 'http://localhost:7777/mcp');
const keyFile = flag('--me');
const [tool, json] = argv;
if (!tool) { console.error('usage: mcp.ts [--url URL] [--me KEYFILE] <tool|tools|instructions> [json-args]'); process.exit(2); }

const key = keyFile && existsSync(keyFile) ? readFileSync(keyFile, 'utf8').trim() : undefined;
const c = new Client({ name: 'hogwarts-playtest', version: '1' });
const transport = new StreamableHTTPClientTransport(url, key ? { requestInit: { headers: { Authorization: `Bearer ${key}` } } } : undefined);
await c.connect(transport);
try {
  if (tool === 'tools') {
    const { tools } = await c.listTools();
    for (const t of tools) console.log(`- ${t.name}: ${t.description ?? ''}\n  args: ${JSON.stringify((t.inputSchema as { properties?: object }).properties ?? {})}`);
  } else if (tool === 'instructions') {
    console.log(c.getInstructions() ?? '(none)');
  } else {
    const args = json ? JSON.parse(json) : {};
    const r = (await c.callTool({ name: tool, arguments: args })) as { content?: { type: string; text?: string }[]; isError?: boolean };
    let text = (r.content ?? []).map((x) => x.text ?? '').join('\n');
    // enroll / login / pair / rotate_key hand back the key: keep it in the key file, never on screen
    try {
      const data = JSON.parse(text) as { token?: string };
      if (typeof data.token === 'string' && keyFile) {
        writeFileSync(keyFile, data.token, { mode: 0o600 });
        chmodSync(keyFile, 0o600);
        text = text.split(data.token).join(`(saved to ${keyFile})`);
      }
    } catch { /* not JSON */ }
    if (key) text = text.split(key).join('(key)');
    console.log(r.isError ? `ERROR: ${text}` : text);
    if (r.isError) process.exitCode = 1;
  }
} finally {
  // one command, one session: end it on the server too (DELETE), or a busy playtest fills the session table
  await transport.terminateSession().catch(() => {});
  await c.close();
}
