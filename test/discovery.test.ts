/** LAN discovery (src/server/discovery.ts): a desktop client or `npm run find` lists servers without typing an IP. */
import { createSocket } from 'node:dgram';
import { afterEach, describe, expect, it } from 'vitest';
import { PROBE, PROTOCOL, findServers, isLocalSender, startDiscovery } from '../src/server/discovery.js';

const socks: { close(): void }[] = [];
afterEach(() => { for (const s of socks.splice(0)) try { s.close(); } catch { /* closed */ } });
const port = () => 20000 + Math.floor(Math.random() * 20000);
const info = (p: number) => () => ({ name: 'Test Castle', port: p, version: '0.1.0', build: 'abc123', players: 3 });

describe('LAN discovery', () => {
  it('answers a probe with what the server is', async () => {
    const p = port();
    socks.push(startDiscovery(p, info(p))!);
    const [s, ...rest] = await findServers({ port: p, ms: 400, targets: ['127.0.0.1'] });
    expect(rest).toEqual([]);
    expect(s).toMatchObject({ hogwarts: 1, name: 'Test Castle', port: p, players: 3, build: 'abc123', protocol: PROTOCOL, url: `http://127.0.0.1:${p}` });
  });

  it('ignores anything that is not a short probe, and at most a few probes a second from one sender', async () => {
    const p = port();
    socks.push(startDiscovery(p, info(p))!);
    const c = createSocket('udp4');
    socks.push(c);
    let answers = 0;
    c.on('message', () => answers++);
    await new Promise<void>((ok) => c.bind(0, () => ok()));
    c.send('hello', p, '127.0.0.1');
    c.send(PROBE + 'x'.repeat(100), p, '127.0.0.1');
    for (let i = 0; i < 10; i++) c.send(PROBE, p, '127.0.0.1');
    await new Promise((ok) => setTimeout(ok, 300));
    expect(answers).toBe(4);
  });

  it('answers only private, loopback and link-local senders (no amplifier for spoofed internet addresses)', () => {
    for (const ip of ['10.37.1.20', '172.16.0.1', '172.31.255.1', '192.168.1.5', '127.0.0.1', '169.254.3.4', '100.64.0.9', '::ffff:192.168.0.2']) expect(isLocalSender(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '172.32.0.1', '192.169.0.1', '100.128.0.1', '203.0.113.9', '::1', 'fe80::1']) expect(isLocalSender(ip), ip).toBe(false);
  });
});
