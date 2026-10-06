import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { World } from '../src/kernel/world.js';
import { Checkpoints, familiarSave, readSave, restoreWorld, writeAtomic } from '../src/server/persistence.js';

const dirs: string[] = [];
function fixture() { const dir = mkdtempSync(join(tmpdir(), 'hogwarts-checkpoint-')); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('only a missing save starts a new installation; other read failures stop startup', () => {
  const dir = fixture();
  expect(readSave(join(dir, 'missing.json'), restoreWorld)).toBeUndefined();
  expect(() => readSave(dir, restoreWorld)).toThrow(/Cannot read save/);
});

it('restores current and legacy envelopes with the same identities and secret', () => {
  const w = new World({ seed: 7 }); w.enroll('Legacy Wizard');
  for (const version of [undefined, 1, 2]) {
    const data = JSON.parse(JSON.stringify({ ...w.serialize(), version }));
    const back = restoreWorld(data);
    expect([...back.wizards.keys()]).toEqual([...w.wizards.keys()]);
    expect(back.secret).toBe(w.secret);
  }
});

it.each(['time', 'term', 'duplicate-id', 'duplicate-token', 'position', 'secret'])('rejects damaged %s state before it reaches the clock', (kind) => {
  const w = new World({ seed: 7 }); w.enroll('One'); w.enroll('Two');
  const data = w.serialize();
  if (kind === 'time') data.now = NaN;
  if (kind === 'term') data.term.endsAt = Infinity;
  if (kind === 'duplicate-id') data.wizards[1]!.id = data.wizards[0]!.id;
  if (kind === 'duplicate-token') data.wizards[1]!.token = data.wizards[0]!.token;
  if (kind === 'position') data.wizards[0]!.pos.x = NaN;
  if (kind === 'secret') data.secret = '';
  expect(() => restoreWorld(data)).toThrow();
});

it('rejects malformed or negative companion quotas without resetting them', () => {
  for (const data of [null, {}, { bonds: [], perWizard: [], global: { day: 'day', n: -1 } }, { bonds: [], perWizard: [['wizard', { day: 'day', n: NaN }]], global: { day: 'day', n: 0 } }]) expect(() => familiarSave(data)).toThrow();
});

it('atomic replacement writes exact bytes, private permissions and no leftover temporary file', async () => {
  const dir = fixture(), path = join(dir, 'world.json');
  writeFileSync(path, 'previous');
  const body = '{"name":"中文 🪄"}';
  await writeAtomic(path, body);
  expect(readFileSync(path, 'utf8')).toBe(body);
  if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(readdirSync(dir)).toEqual(['world.json']);
});

it('failed replacement leaves the previous checkpoint intact and cleans its temporary file', async () => {
  const dir = fixture(), path = join(dir, 'world.json');
  writeFileSync(path, 'previous');
  await expect(writeAtomic(path, 'next', { ...fs, rename: async () => { throw new Error('injected rename failure'); } })).rejects.toThrow();
  expect(readFileSync(path, 'utf8')).toBe('previous');
  expect(readdirSync(dir)).toEqual(['world.json']);
});

it('a serialization failure preserves the checkpoint and a later valid snapshot can retry', async () => {
  const dir = fixture(), path = join(dir, 'world.json');
  writeFileSync(path, 'previous');
  let data: unknown = 1n;
  const c = new Checkpoints(() => [{ path, data }]);
  await expect(c.save()).rejects.toThrow();
  expect(readFileSync(path, 'utf8')).toBe('previous');
  data = { ok: true };
  await c.save();
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(data);
});

it('slow I/O coalesces requests and freezes both files before the world changes; shutdown saves the latest state', async () => {
  const dir = fixture(), world = join(dir, 'world.json'), familiar = join(dir, 'familiars.json');
  const state = { n: 1 };
  let release!: () => void, writes = 0;
  const gate = new Promise<void>((ok) => { release = ok; });
  const c = new Checkpoints(() => [{ path: world, data: state }, { path: familiar, data: state }], async (path, body) => {
    if (++writes === 1) await gate;
    await writeAtomic(path, body);
  });
  const first = c.save();
  state.n = 2;
  for (let i = 0; i < 100; i++) expect(c.save()).toBe(first);
  expect(writes).toBe(1);
  release(); await first;
  expect(JSON.parse(readFileSync(world, 'utf8')).n).toBe(1);
  expect(JSON.parse(readFileSync(familiar, 'utf8')).n).toBe(1);
  await c.flush();
  expect(JSON.parse(readFileSync(world, 'utf8')).n).toBe(2);
  expect(JSON.parse(readFileSync(familiar, 'utf8')).n).toBe(2);
});

it('shutdown waits for an in-flight checkpoint before capturing the final state', async () => {
  let n = 1, release!: () => void;
  const gate = new Promise<void>((ok) => { release = ok; });
  const bodies: string[] = [];
  const c = new Checkpoints(() => [{ path: 'world', data: { n } }], async (_path, body) => {
    if (!bodies.length) { bodies.push(body); await gate; } else bodies.push(body);
  });
  const first = c.save(); n = 2;
  const final = c.flush();
  expect(bodies).toEqual(['{"n":1}']);
  release(); await Promise.all([first, final]);
  expect(bodies).toEqual(['{"n":1}', '{"n":2}']);
});

it('shutdown can recover from an earlier failed write and persist the latest snapshot', async () => {
  let writes = 0;
  const bodies: string[] = [];
  const c = new Checkpoints(() => [{ path: 'world', data: { valid: true } }], async (_path, body) => {
    if (++writes === 1) throw new Error('injected disk failure');
    bodies.push(body);
  });
  const first = c.save();
  const final = c.flush();
  await expect(first).rejects.toThrow(); await final;
  expect(bodies).toEqual(['{"valid":true}']);
});
