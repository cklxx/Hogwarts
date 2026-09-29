/**
 * `npm run find`: list the Hogwarts servers on this network (LAN discovery, src/server/discovery.ts).
 *   npm run find                 (probe port 7777 on every local subnet)
 *   npm run find -- --port=8000
 */
import { findServers } from '../src/server/discovery.js';

const port = Number(process.argv.find((a) => a.startsWith('--port='))?.slice(7) ?? 7777);
const found = await findServers({ port, ms: 1500 });
if (!found.length) {
  console.log(`没有找到服务器（UDP ${port}）。服务器要用默认 HOST=0.0.0.0 启动；另外检查防火墙是否放行 UDP ${port}。`);
  process.exit(1);
}
for (const s of found) console.log(`${s.url}\t${s.name}\t${s.players} 人在线\tv${s.version} (${s.build})`);
