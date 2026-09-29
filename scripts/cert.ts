/**
 * `npm run cert`: (re)make the HTTPS certificate for this machine's addresses (the server also does this by itself
 * at start-up; run this to use mkcert's CA instead, or to add hosts: `npm run cert -- my-devbox.lan`).
 * Then open http://<this machine>:7777/tls on each computer that plays: it gives a one-line command to trust the CA.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localHosts, makeCertificate } from '../src/server/tls.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = process.env.TLS_DIR ?? join(dirname(process.env.HOGWARTS_DATA ?? join(ROOT, 'data', 'world.json')), 'tls');
const made = makeCertificate(DIR, localHosts(process.argv.slice(2)), process.env.MKCERT !== '0');
if (!made) { console.error('需要 openssl 或 mkcert 之一来生成证书。'); process.exit(1); }
console.log(`证书已生成（${made.via}）：${made.files.cert}\n覆盖：${made.hosts.join(', ')}\nCA：${made.caPath}`);
console.log('重启服务器；然后在每台玩游戏的电脑上打开 http://<这台机器的 IP>:7777/tls，按页面上的一行命令信任 CA，再打开 https://<IP>:7443。');
