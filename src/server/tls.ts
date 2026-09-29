/**
 * TLS for LAN play. Browsers expose WebGPU only in a secure context (https:// or localhost), so a game opened at
 * http://10.x.x.x always falls back to WebGL 2. This module makes a small local certificate authority and a server
 * certificate for this machine's addresses (with openssl, or mkcert's CA when mkcert is installed), and the /tls page
 * (tlsPage) hands players the CA certificate plus a one-line install command for their OS.
 *
 * Safety: the CA is **name-constrained** to localhost, the private address ranges (10/8, 172.16/12, 192.168/16,
 * 127/8, 100.64/10, ::1) and exactly this machine's other addresses, so even if this machine were compromised, the CA
 * a player trusted could not mint a certificate for any public website. Only the CA *certificate* is ever served; its private key stays in data/tls/.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';

export interface TlsFiles { dir: string; cert: string; key: string; ca: string; caKey: string }
export const tlsFiles = (dir: string): TlsFiles => ({ dir, cert: join(dir, 'cert.pem'), key: join(dir, 'key.pem'), ca: join(dir, 'ca.pem'), caKey: join(dir, 'ca-key.pem') });

/** This machine's IPv4 addresses (LAN first), plus localhost. */
export function localHosts(extra: string[] = []): string[] {
  const ips = Object.values(networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4').map((a) => a!.address);
  return [...new Set(['localhost', '127.0.0.1', ...ips, ...extra])];
}

const has = (bin: string) => { try { execFileSync(bin, ['-help'], { stdio: 'ignore' }); return true; } catch (e) { return (e as { code?: string }).code !== 'ENOENT'; } };
const run = (bin: string, args: string[]) => execFileSync(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });

/** Private ranges the CA may always sign for (plus 100.64/10, where Tailscale and CGNAT hand out addresses). */
const PRIVATE: [string, string][] = [['10.0.0.0', '255.0.0.0'], ['172.16.0.0', '255.240.0.0'], ['192.168.0.0', '255.255.0.0'], ['127.0.0.0', '255.0.0.0'], ['100.64.0.0', '255.192.0.0']];
const PRIVATE_DNS = ['localhost', '.local', '.lan', '.home.arpa', '.internal', '.ts.net'];
const ip4 = (a: string) => a.split('.').reduce((n, o) => n * 256 + Number(o), 0);
const inRange = (ip: string, [net, mask]: [string, string]) => ((ip4(ip) & ip4(mask)) >>> 0) === ((ip4(net) & ip4(mask)) >>> 0);
const isIp = (h: string) => /^\d+\.\d+\.\d+\.\d+$/.test(h);
const dnsCovered = (h: string, dns: string[]) => dns.some((d) => (d.startsWith('.') ? h.endsWith(d) : h === d));
/**
 * The CA's name constraints: localhost/private networks, plus exactly (a /32 or the one name) any other host this
 * machine is reached at, so a certificate for it verifies. Everything else stays out of the CA's reach.
 */
function constraintsFor(hosts: string[]) {
  const ips = PRIVATE.slice();
  const dns = PRIVATE_DNS.slice();
  for (const h of hosts) {
    if (isIp(h)) { if (!ips.some((r) => inRange(h, r))) ips.push([h, '255.255.255.255']); } else if (!dnsCovered(h, dns)) dns.push(h);
  }
  const ext = ['nameConstraints=critical', ...dns.map((d) => `permitted;DNS:${d}`), ...ips.map(([n, m]) => `permitted;IP:${n}/${m}`), 'permitted;IP:0:0:0:0:0:0:0:1/FFFF:FFFF:FFFF:FFFF:FFFF:FFFF:FFFF:FFFF'].join(',');
  return { ext, ips, dns };
}
const covered = (hosts: string[], c: { ips: [string, string][]; dns: string[] }) => hosts.every((h) => (isIp(h) ? c.ips.some((r) => inRange(h, r)) : dnsCovered(h, c.dns)));

/**
 * Make (or refresh) the certificate. With mkcert installed and `preferMkcert`, mkcert's own CA signs it (mkcert's
 * CA is not name-constrained; it is the user's own tool). Otherwise openssl: a name-constrained local CA made once
 * and kept, and a server certificate for `hosts` signed by it. Returns what was used, or null without either tool.
 */
export function makeCertificate(dir: string, hosts = localHosts(), preferMkcert = true): { via: 'mkcert' | 'openssl'; hosts: string[]; files: TlsFiles; caPath: string; renewedCa?: boolean } | null {
  const f = tlsFiles(dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (preferMkcert && has('mkcert')) {
    run('mkcert', ['-install']);
    run('mkcert', ['-cert-file', f.cert, '-key-file', f.key, ...hosts]);
    const caroot = String(run('mkcert', ['-CAROOT'])).trim();
    return { via: 'mkcert', hosts, files: f, caPath: join(caroot, 'rootCA.pem') };
  }
  if (!has('openssl')) return null;
  // The CA is kept (players trusted it) unless a host falls outside its constraints; then it is made again and
  // players must trust the new one (the /tls page says so via `renewedCa`).
  const meta = join(dir, 'ca-constraints.json');
  let prev: { ips: [string, string][]; dns: string[] } | null = null;
  try { prev = JSON.parse(readFileSync(meta, 'utf8')); } catch { /* none yet */ }
  let renewedCa = false;
  if (!existsSync(f.ca) || !existsSync(f.caKey) || !prev || !covered(hosts, prev)) {
    const c = constraintsFor(hosts);
    run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', f.caKey, '-out', f.ca, '-days', '3650', '-subj', '/CN=Hogwarts LAN CA (local only)',
      '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-addext', c.ext]);
    writeFileSync(meta, JSON.stringify({ ips: c.ips, dns: c.dns }));
    renewedCa = prev !== null;
  }
  const csr = join(dir, 'server.csr'), ext = join(dir, 'san.ext');
  const san = hosts.map((h, i) => (/^[\d.]+$/.test(h) ? `IP.${i + 1} = ${h}` : `DNS.${i + 1} = ${h}`)).join('\n');
  writeFileSync(ext, `basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=@alt\n[alt]\n${san}\n`);
  run('openssl', ['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', f.key, '-out', csr, '-subj', '/CN=Hogwarts']);
  run('openssl', ['x509', '-req', '-in', csr, '-CA', f.ca, '-CAkey', f.caKey, '-CAcreateserial', '-out', f.cert, '-days', '825', '-sha256', '-extfile', ext]);
  return { via: 'openssl', hosts, files: f, caPath: f.ca, renewedCa };
}

/** Does the certificate cover every one of `hosts` (so a new LAN address gets a fresh certificate)? */
export function certCovers(certPath: string, hosts: string[]): boolean {
  try {
    const text = String(execFileSync('openssl', ['x509', '-in', certPath, '-noout', '-ext', 'subjectAltName'], { stdio: ['ignore', 'pipe', 'ignore'] }));
    return hosts.every((h) => text.includes(/^[\d.]+$/.test(h) ? `IP Address:${h}` : `DNS:${h}`));
  } catch { return true; } // cannot tell: keep what is there
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The /tls page: why, one-line trust commands per OS with this server's address filled in, and the HTTPS link. */
export function tlsPage(o: { httpBase: string; httpsUrl: string | null; hasCa: boolean }): string {
  const ca = `${o.httpBase}/tls/ca.pem`;
  const cmd = {
    mac: `curl -fsSLo ~/Downloads/hogwarts-ca.pem ${ca} && sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/Downloads/hogwarts-ca.pem`,
    win: `curl.exe -fsSLo $env:TEMP\\hogwarts-ca.pem ${ca}; certutil -addstore -f ROOT $env:TEMP\\hogwarts-ca.pem`,
    linux: `curl -fsSLo /tmp/hogwarts-ca.pem ${ca} && certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n hogwarts-lan -i /tmp/hogwarts-ca.pem`,
  };
  const body = !o.hasCa || !o.httpsUrl
    ? `<p>这台服务器还没有证书（需要 openssl 或 mkcert）。在服务器上运行 <code>npm run cert</code> 后重启。</p>`
    : `<ol>
  <li><b>在你这台电脑上执行一行命令</b>（下载并信任本服务器的 CA，只需一次）：
    <h3>macOS（终端，需要输入开机密码）</h3><pre>${esc(cmd.mac)}</pre>
    <h3>Windows（以管理员身份打开 PowerShell）</h3><pre>${esc(cmd.win)}</pre>
    <h3>Linux（Chrome/Chromium，需要 libnss3-tools）</h3><pre>${esc(cmd.linux)}</pre>
    <p class="hint">也可以手动：<a href="/tls/ca.pem" download="hogwarts-ca.pem">下载 CA 证书</a>，导入系统的「受信任的根证书」。</p></li>
  <li><b>重启浏览器</b>，然后打开 <a href="${esc(o.httpsUrl)}">${esc(o.httpsUrl)}</a>。</li>
</ol>
<p class="hint">安全说明：这个 CA 带名称约束，只能给 localhost、局域网地址（10.x、172.16–31.x、192.168.x）和这台服务器自己的地址签发证书，签不了任何公网网站；它的私钥只在服务器上。用完想撤销：在系统证书管理里删除「Hogwarts LAN CA」。</p>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>开启 WebGPU · 霍格沃茨</title>
<style>body{margin:0;background:#1a120b;color:#2a1b0f;font:16px/1.7 'LXGW WenKai','Songti SC',serif}main{max-width:760px;margin:32px auto;padding:28px 34px;background:#f2e6c9;border-radius:6px;box-shadow:0 8px 30px #000a}
h1{font-size:28px;margin:0 0 8px}h3{font-size:15px;margin:14px 0 4px;color:#5b4029}pre{white-space:pre-wrap;word-break:break-all;background:#fff8e6;border:1px solid #d9c08a;padding:10px 12px;border-radius:4px;font:13px/1.5 ui-monospace,Menlo,Consolas,monospace}
.hint{color:#5b4029;font-size:14px}a{color:#962024}code{background:#fff8e6;padding:0 4px}</style></head><body><main>
<h1>开启 WebGPU</h1>
<p>浏览器只在 <b>HTTPS 或 localhost</b> 下提供 WebGPU。你现在用局域网 HTTP 打开，所以游戏在用 WebGL 2（画面相同，粒子与草地少一些）。想用 WebGPU：</p>
${body}
<p class="hint">不想装证书：在你电脑上 <code>ssh -L 7777:localhost:7777 这台服务器</code>，再打开 <code>http://localhost:7777</code> 也能用 WebGPU。<a href="/">← 回到游戏</a></p>
</main></body></html>`;
}

/** The CA certificate to hand out (never the key). */
export const caPem = (f: TlsFiles, caPath?: string) => { const p = caPath ?? f.ca; return existsSync(p) ? readFileSync(p) : null; };
