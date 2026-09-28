import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { keyFor, loadKey, saveKey } from '../src/mcp/keyring.js';
import { pairRealm, targetRealm } from '../src/server/realms.js';

describe('Owl Post keyring', () => {
  it('keys by origin + pathname, stores 0600 in a 0700 directory, and throws when it cannot write', () => {
    expect(keyFor('http://h:7777/mcp?realm=2')).toBe('http://h:7777/mcp');
    expect(keyFor('http://h:7777/mcp/')).toBe('http://h:7777/mcp');
    const dir = mkdtempSync(join(tmpdir(), 'owl-'));
    const file = join(dir, 'ring', 'credentials.json');
    saveKey('http://h:7777/mcp?x=1', { token: 'secret-token-1', registry: 'wz_1', name: 'A' }, file);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, 'ring')).mode & 0o777).toBe(0o700);
    expect(loadKey('http://h:7777/mcp', file)?.token).toBe('secret-token-1');
    expect(loadKey('http://other:7777/mcp', file)).toBeNull();
    const blocker = join(dir, 'plain-file');
    writeFileSync(blocker, 'x');
    expect(() => saveKey('http://h/mcp', { token: 't' }, join(blocker, 'credentials.json'))).toThrow();
  });

  it('routes login by token prefix and pair by code prefix', () => {
    const call = (name: string, args: unknown) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    expect(pairRealm(call('pair', { code: '2-abc-def' }))).toBe(2);
    expect(pairRealm(call('pair', { code: 'ABC-DEF' }))).toBeNull();
    expect(targetRealm(call('login', { token: 'r1.xyzxyzxyz' }))).toBe(1);
    expect(targetRealm(call('pair', { code: '3 ABC DEF' }))).toBe(3);
    expect(targetRealm(call('look', {}))).toBeNull();
  });
});
