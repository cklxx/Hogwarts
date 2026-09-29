import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { certCovers, makeCertificate, tlsPage } from '../src/server/tls.js';

const hasOpenssl = (() => { try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const verify = (ca: string, cert: string) => { try { execFileSync('openssl', ['verify', '-CAfile', ca, cert], { stdio: 'pipe' }); return true; } catch { return false; } };

describe.runIf(hasOpenssl)('LAN HTTPS certificates (WebGPU needs a secure context)', () => {
  it('signs this machine\'s addresses, even outside the private ranges, and nothing on the public web', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hog-tls-'));
    const made = makeCertificate(dir, ['localhost', '127.0.0.1', '10.37.1.20', '203.0.113.9'], false)!;
    expect(made.via).toBe('openssl');
    expect(verify(made.files.ca, made.files.cert)).toBe(true);
    expect(certCovers(made.files.cert, ['10.37.1.20', '203.0.113.9'])).toBe(true);
    // the CA cannot vouch for a public site, even though we hold its key
    const evilKey = join(dir, 'evil.key'), csr = join(dir, 'evil.csr'), ext = join(dir, 'evil.ext'), evil = join(dir, 'evil.pem');
    execFileSync('openssl', ['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', evilKey, '-out', csr, '-subj', '/CN=evil'], { stdio: 'ignore' });
    writeFileSync(ext, 'subjectAltName=DNS:www.example.com\n');
    execFileSync('openssl', ['x509', '-req', '-in', csr, '-CA', made.files.ca, '-CAkey', made.files.caKey, '-CAcreateserial', '-out', evil, '-days', '1', '-extfile', ext], { stdio: 'ignore' });
    expect(verify(made.files.ca, evil)).toBe(false);
  });

  it('keeps the CA players already trusted when the addresses stay inside it, and renews it when they do not', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hog-tls-'));
    const first = makeCertificate(dir, ['localhost', '10.37.1.20'], false)!;
    const ca1 = readFileSync(first.files.ca, 'utf8');
    const again = makeCertificate(dir, ['localhost', '10.37.9.9'], false)!;
    expect(readFileSync(again.files.ca, 'utf8')).toBe(ca1);
    expect(again.renewedCa).toBe(false);
    const moved = makeCertificate(dir, ['localhost', '198.51.100.7'], false)!;
    expect(readFileSync(moved.files.ca, 'utf8')).not.toBe(ca1);
    expect(moved.renewedCa).toBe(true);
    expect(verify(moved.files.ca, moved.files.cert)).toBe(true);
  });
});

describe('the /tls page', () => {
  it('fills in this server\'s address in one-line trust commands and never offers the CA key', () => {
    const html = tlsPage({ httpBase: 'http://10.37.1.20:7777', httpsUrl: 'https://10.37.1.20:7443/', hasCa: true });
    expect(html).toContain('http://10.37.1.20:7777/tls/ca.pem');
    expect(html).toContain('security add-trusted-cert');
    expect(html).toContain('certutil -addstore -f ROOT');
    expect(html).toContain('https://10.37.1.20:7443/');
    expect(html).not.toMatch(/ca-key/);
  });
});
