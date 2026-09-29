/**
 * `npm run cert`: a TLS certificate for this machine's LAN addresses, so browsers on other computers get a
 * secure context (https://) and with it WebGPU. The server picks it up at data/tls/{cert,key}.pem on restart and
 * serves the game on HTTPS_PORT (default 7443) as well as on plain HTTP.
 *
 * - With mkcert installed (https://github.com/FiloSottile/mkcert) it uses mkcert's local CA.
 * - Otherwise it makes a small local CA with openssl (data/tls/ca.pem) and signs the certificate with it.
 * Either way, trust the CA once on each computer that plays (the script prints how), and the browser shows no
 * warning. Extra hosts: `npm run cert -- my-devbox.lan 10.37.1.2`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = process.env.TLS_DIR ?? join(dirname(process.env.HOGWARTS_DATA ?? join(ROOT, 'data', 'world.json')), 'tls');
mkdirSync(DIR, { recursive: true });
const ips = Object.values(networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4').map((a) => a!.address);
const hosts = [...new Set(['localhost', '127.0.0.1', ...ips, ...process.argv.slice(2)])];
const cert = join(DIR, 'cert.pem'), key = join(DIR, 'key.pem');
const has = (bin: string) => { try { execFileSync(bin, ['-help'], { stdio: 'ignore' }); return true; } catch (e) { return (e as { code?: string }).code !== 'ENOENT'; } };
const run = (bin: string, args: string[]) => execFileSync(bin, args, { stdio: ['ignore', 'pipe', 'inherit'] });

if (has('mkcert')) {
  run('mkcert', ['-install']);
  run('mkcert', ['-cert-file', cert, '-key-file', key, ...hosts]);
  const caroot = String(run('mkcert', ['-CAROOT'])).trim();
  console.log(`证书已生成（mkcert）：${cert}\n包含：${hosts.join(', ')}`);
  console.log(`本机已自动信任。其他电脑要信任同一个 CA：把 ${join(caroot, 'rootCA.pem')} 拷过去，在那台电脑上运行 mkcert -install（设置 CAROOT 指向它），或手动导入系统/浏览器的受信任根证书。`);
} else if (has('openssl')) {
  const ca = join(DIR, 'ca.pem'), caKey = join(DIR, 'ca-key.pem');
  if (!existsSync(ca) || !existsSync(caKey)) {
    run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', caKey, '-out', ca, '-days', '3650', '-subj', '/CN=Hogwarts local CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
  }
  const csr = join(DIR, 'server.csr'), ext = join(DIR, 'san.ext');
  const san = hosts.map((h, i) => (/^[\d.]+$/.test(h) ? `IP.${i + 1} = ${h}` : `DNS.${i + 1} = ${h}`)).join('\n');
  writeFileSync(ext, `basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=@alt\n[alt]\n${san}\n`);
  run('openssl', ['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', csr, '-subj', '/CN=Hogwarts']);
  run('openssl', ['x509', '-req', '-in', csr, '-CA', ca, '-CAkey', caKey, '-CAcreateserial', '-out', cert, '-days', '825', '-sha256', '-extfile', ext]);
  console.log(`证书已生成（openssl，本地 CA）：${cert}\n包含：${hosts.join(', ')}`);
  console.log(`在每台玩游戏的电脑上信任一次这个 CA：${ca}\n  macOS：双击导入「钥匙串访问」→ 系统 → 设为「始终信任」\n  Windows：双击 → 安装证书 → 本地计算机 → 受信任的根证书颁发机构\n  Linux/Chrome：设置 → 隐私和安全 → 安全 → 管理证书 → 授权机构 → 导入`);
} else {
  console.error('需要 mkcert 或 openssl 之一来生成证书。');
  process.exit(1);
}
console.log('重启服务器后打开 https://<这台机器的 IP>:7443（HTTPS_PORT 可改）。');
