/**
 * LAN discovery: a Hogwarts server answers a UDP probe on its own port number (7777/udp next to 7777/tcp), so a
 * desktop client or `npm run find` lists the servers on the network without anyone typing an IP.
 *
 *   probe  → "HOGWARTS?"                        (broadcast to <subnet>.255:7777, or unicast)
 *   answer ← {"hogwarts":1,"name":…,"port":7777,"version":…,"build":…,"players":3}
 *
 * The answer goes only to private, loopback and link-local senders (and to this machine's own subnets, /16 or
 * smaller), at most RATE per sender per second, and it is
 * small: a spoofed probe cannot turn this into a traffic amplifier aimed at the internet. DISCOVERY=0 turns it off.
 */
import { createHash } from 'node:crypto';
import { createSocket, type Socket } from 'node:dgram';
import { readFileSync, statSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';

export const PROBE = 'HOGWARTS?';
/** Bumped when the WebSocket or HTTP API changes incompatibly, so a desktop client can refuse a server it cannot talk to. */
export const PROTOCOL = 1;
const RATE = 4;

export interface ServerInfo { hogwarts: 1; name: string; port: number; version: string; build: string; protocol: number; players: number }
export interface Found extends ServerInfo { address: string; url: string }

/** Private (10/8, 172.16/12, 192.168/16, 100.64/10), loopback and link-local IPv4 senders only. */
export function isLocalSender(ip: string): boolean {
  const m = /^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b < 128);
}

/** Is `ip` on one of this machine's own IPv4 subnets (a LAN numbered from a public range still finds its server)? */
export function onLocalSubnet(ip: string): boolean {
  const m = /^(?:::ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (!m) return false;
  const n = (a: string) => a.split('.').reduce((x, o) => x * 256 + Number(o), 0);
  const v = n(m[1]);
  return Object.values(networkInterfaces()).flat().some((a) => {
    if (!a || a.family !== 'IPv4' || a.internal) return false;
    const mask = n(a.netmask);
    return mask >= n('255.255.0.0') && ((v & mask) >>> 0) === ((n(a.address) & mask) >>> 0); // (a /16 or smaller: not "the internet")
  });
}

/** The server's display name: HOGWARTS_NAME, else this machine's host name. */
export const serverName = () => (process.env.HOGWARTS_NAME ?? hostname()).slice(0, 40);

let buildCache: { key: string; id: string } | null = null;
/** A short id of the client build being served (dist/index.html names every hashed bundle): changes on each rebuild. */
export function buildId(dist: string): string {
  try {
    const f = join(dist, 'index.html');
    const st = statSync(f);
    const key = `${st.size}:${st.mtimeMs}`;
    if (buildCache?.key !== key) buildCache = { key, id: createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 12) };
    return buildCache.id;
  } catch { return 'dev'; }
}

/** Answer probes on `port`/udp. Returns the socket (close it to stop), or null when turned off or the port is taken. */
export function startDiscovery(port: number, info: () => Omit<ServerInfo, 'hogwarts' | 'protocol'>): Socket | null {
  if (process.env.DISCOVERY === '0') return null;
  const sock = createSocket({ type: 'udp4', reuseAddr: true });
  const seen = new Map<string, { t: number; n: number }>();
  sock.on('message', (msg, from) => {
    if (msg.length > 64 || !msg.toString('utf8').startsWith(PROBE) || !(isLocalSender(from.address) || onLocalSubnet(from.address))) return;
    const now = Date.now(), s = seen.get(from.address);
    if (s && now - s.t < 1000) { if (++s.n > RATE) return; } else seen.set(from.address, { t: now, n: 1 });
    if (seen.size > 4096) seen.clear();
    const body: ServerInfo = { hogwarts: 1, protocol: PROTOCOL, ...info() };
    sock.send(JSON.stringify(body), from.port, from.address);
  });
  sock.on('error', (e) => { console.warn(`[hogwarts] LAN discovery off (${(e as Error).message})`); try { sock.close(); } catch { /* closed */ } });
  sock.bind(port, '0.0.0.0');
  return sock;
}

/** Broadcast addresses of this machine's IPv4 networks (plus the limited broadcast and loopback). */
export function broadcastTargets(): string[] {
  const out = new Set<string>(['255.255.255.255', '127.0.0.1']);
  for (const a of Object.values(networkInterfaces()).flat()) {
    if (!a || a.family !== 'IPv4' || a.internal) continue;
    const ip = a.address.split('.').map(Number), mask = a.netmask.split('.').map(Number);
    out.add(ip.map((o, i) => (o & mask[i]) | (~mask[i] & 255)).join('.'));
  }
  return [...out];
}

/** Probe the network and collect the servers that answer within `ms`. */
export function findServers(opts: { port?: number; ms?: number; targets?: string[] } = {}): Promise<Found[]> {
  const port = opts.port ?? 7777, ms = opts.ms ?? 1200;
  return new Promise((done) => {
    const sock = createSocket('udp4');
    const found = new Map<string, Found>();
    sock.on('message', (msg, from) => {
      try {
        const r = JSON.parse(msg.toString('utf8')) as ServerInfo;
        if (r.hogwarts !== 1 || typeof r.port !== 'number') return;
        // one entry per server: it may answer on loopback and on its LAN address; the LAN one is what others can use
        const key = `${r.name}|${r.port}|${r.build}`, prev = found.get(key);
        if (prev && prev.address !== '127.0.0.1') return;
        found.set(key, { ...r, address: from.address, url: `http://${from.address}:${r.port}` });
      } catch { /* not ours */ }
    });
    sock.on('error', () => { /* no network */ });
    sock.bind(0, () => {
      sock.setBroadcast(true);
      for (const t of opts.targets ?? broadcastTargets()) sock.send(PROBE, port, t, () => { /* unreachable targets are fine */ });
    });
    setTimeout(() => { try { sock.close(); } catch { /* closed */ } done([...found.values()]); }, ms);
  });
}
