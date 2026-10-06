import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { connect, createServer, type AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { World } from '../src/kernel/world.js';

const fixtures: { dir: string; proc: ChildProcess }[] = [];
function launch(saved: string, hook?: string, familiar?: string, port = 0) {
  const dir = mkdtempSync(join(tmpdir(), 'hogwarts-recovery-'));
  const data = join(dir, 'world.json');
  writeFileSync(data, saved);
  if (familiar !== undefined) writeFileSync(join(dir, 'familiars.json'), familiar);
  const args = ['--import', 'tsx'];
  if (hook) { const file = join(dir, 'fault.mjs'); writeFileSync(file, hook); args.push('--import', file); }
  const proc = spawn(process.execPath, [...args, 'src/server/main.ts'], {
    env: { ...process.env, REALMS: '1', PORT: String(port), HOST: '127.0.0.1', PUBLIC_URL: 'http://127.0.0.1', HOGWARTS_DATA: data, NPC_COUNT: '0', ANTHROPIC_API_KEY: familiar === undefined ? '' : 'local-fixture-not-real', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout!.on('data', (d) => { log += d; });
  proc.stderr!.on('data', (d) => { log += d; });
  fixtures.push({ dir, proc });
  const outcome = new Promise<'ready' | 'exit'>((ok) => {
    proc.stdout!.on('data', (d) => { if (String(d).includes('s per term')) ok('ready'); });
    proc.once('exit', () => ok('exit'));
  });
  return { proc, data, outcome, log: () => log };
}
async function exited(proc: ChildProcess) {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  await once(proc, 'exit');
}
async function freePort() {
  const probe = createServer();
  await new Promise<void>((ok) => probe.listen(0, '127.0.0.1', ok));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((ok) => probe.close(() => ok()));
  return port;
}
afterEach(async () => {
  for (const { dir, proc } of fixtures.splice(0)) {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
    await exited(proc);
    rmSync(dir, { recursive: true, force: true });
  }
});

it('refuses a corrupt save, preserves every byte and never logs its contents', async () => {
  const saved = '{"secret":"private-fixture-not-for-logs",';
  const s = launch(saved);
  expect(await s.outcome).toBe('exit');
  expect(s.proc.exitCode).toBe(1);
  expect(readFileSync(s.data, 'utf8')).toBe(saved);
  expect(s.log()).not.toContain('private-fixture-not-for-logs');
});

it('refuses an unsupported save version instead of silently downgrading it', async () => {
  const saved = JSON.stringify({ ...new World({ seed: 7 }).serialize(), version: 999 });
  const s = launch(saved);
  expect(await s.outcome).toBe('exit');
  expect(s.proc.exitCode).toBe(1);
  expect(readFileSync(s.data, 'utf8')).toBe(saved);
});

it.each(['throw', 'reject'])('a fatal %s exits without checkpointing a partially updated world', async (fault) => {
  const saved = JSON.stringify(new World({ seed: 7 }).serialize());
  const worldUrl = pathToFileURL(resolve('src/kernel/world.ts')).href;
  const hook = `import { World } from ${JSON.stringify(worldUrl)};
World.prototype.tick = function() { this.now = 123456; ${fault === 'throw' ? "throw new Error('private-fixture-not-for-logs');" : "Promise.reject(new Error('private-fixture-not-for-logs'));"} };`;
  const s = launch(saved, hook);
  await exited(s.proc);
  expect(s.proc.exitCode).toBe(1);
  expect(readFileSync(s.data, 'utf8')).toBe(saved);
  expect(s.log()).not.toContain('private-fixture-not-for-logs');
});

it('a normal signal waits for a complete checkpoint that can be restored', async () => {
  const w = new World({ seed: 7 });
  w.enroll('Recovery Wizard');
  const s = launch(JSON.stringify(w.serialize()));
  expect(await s.outcome).toBe('ready');
  s.proc.kill('SIGTERM');
  await exited(s.proc);
  expect(s.proc.exitCode).toBe(0);
  const back = World.restore(JSON.parse(readFileSync(s.data, 'utf8')));
  expect([...back.wizards.values()].map((x) => x.name)).toEqual(['Recovery Wizard']);
  expect(back.secret).toBe(w.secret);
});

it('a failed shutdown write exits unsuccessfully and retains the last checkpoint', async () => {
  const saved = JSON.stringify(new World({ seed: 7 }).serialize());
  const s = launch(saved);
  expect(await s.outcome).toBe('ready');
  // Make atomic replacement fail using the real filesystem, without touching any project data.
  renameSync(s.data, s.data + '.last'); mkdirSync(s.data);
  s.proc.kill('SIGTERM'); await exited(s.proc);
  expect(s.proc.exitCode).toBe(1);
  expect(readFileSync(s.data + '.last', 'utf8')).toBe(saved);
  expect(s.log()).toContain('shutdown checkpoint failed');
});

it('a corrupt familiar save stops startup without replacing either file or logging its contents', async () => {
  const saved = JSON.stringify(new World({ seed: 7 }).serialize());
  const familiar = '{"private-fixture-not-for-logs"';
  const s = launch(saved, undefined, familiar);
  expect(await s.outcome).toBe('exit');
  expect(s.proc.exitCode).toBe(1);
  expect(readFileSync(s.data, 'utf8')).toBe(saved);
  expect(readFileSync(join(s.data, '..', 'familiars.json'), 'utf8')).toBe(familiar);
  expect(s.log()).not.toContain('private-fixture-not-for-logs');
});

it('clean shutdown keeps familiar bonds and spent quotas despite stopping Agent work', async () => {
  const w = new World({ seed: 7 }); const wizard = w.enroll('Familiar Keeper').wizard;
  const familiar = { bonds: [{ wid: wizard.id, kind: 'owl', after: 0 }], perWizard: [[wizard.id, { day: 'fixture-day', n: 3 }]], global: { day: 'fixture-day', n: 3 } };
  const s = launch(JSON.stringify(w.serialize()), undefined, JSON.stringify(familiar));
  expect(await s.outcome).toBe('ready');
  s.proc.kill('SIGTERM'); await exited(s.proc);
  expect(s.proc.exitCode).toBe(0);
  expect(JSON.parse(readFileSync(join(s.data, '..', 'familiars.json'), 'utf8'))).toEqual(familiar);
});

it('a hanging shutdown write has a bounded wait and never claims to have saved', async () => {
  const saved = JSON.stringify(new World({ seed: 7 }).serialize());
  const persistenceUrl = pathToFileURL(resolve('src/server/persistence.ts')).href;
  const hook = `import { Checkpoints } from ${JSON.stringify(persistenceUrl)};
Checkpoints.prototype.flush = () => new Promise(() => {});`;
  const s = launch(saved, hook);
  expect(await s.outcome).toBe('ready');
  s.proc.kill('SIGTERM'); await exited(s.proc);
  expect(s.proc.exitCode).toBe(1);
  expect(readFileSync(s.data, 'utf8')).toBe(saved);
  expect(s.log()).toContain('shutdown checkpoint timed out');
  expect(s.log()).not.toContain('Mischief managed');
});

it.each([false, true])('a malformed URL (upgrade=%s) returns 400 and leaves the server usable', async (upgrade) => {
  const port = await freePort();
  const s = launch(JSON.stringify(new World({ seed: 7 }).serialize()), undefined, undefined, port);
  expect(await s.outcome).toBe('ready');
  const response = await new Promise<string>((ok, bad) => {
    const socket = connect(port, '127.0.0.1');
    let raw = '';
    socket.setTimeout(2000, () => { socket.destroy(); bad(new Error('request timed out')); });
    socket.on('error', bad);
    socket.on('data', (d) => { raw += d; });
    socket.on('end', () => ok(raw));
    socket.on('connect', () => socket.write(`GET //[ HTTP/1.1\r\nHost: localhost\r\nConnection: ${upgrade ? 'Upgrade' : 'close'}\r\n${upgrade ? 'Upgrade: websocket\r\n' : ''}\r\n`));
  });
  expect(response).toMatch(/^HTTP\/1\.1 400/);
  expect(s.proc.exitCode).toBeNull();
  expect((await fetch(`http://127.0.0.1:${port}/api/rules`)).status).toBe(200);
});

it.each(['/api/enroll', '/mcp'])('malformed JSON at %s returns 400 without reflecting input into logs or replies', async (path) => {
  const port = await freePort();
  const s = launch(JSON.stringify(new World({ seed: 7 }).serialize()), undefined, undefined, port);
  expect(await s.outcome).toBe('ready');
  const privateInput = 'owl-private-fixture';
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', body: privateInput, headers: { 'content-type': 'application/json' } });
  const body = await r.text();
  expect(r.status).toBe(400);
  expect(body).not.toContain(privateInput.slice(0, 8));
  expect(s.log()).not.toContain(privateInput.slice(0, 8));
  expect((await fetch(`http://127.0.0.1:${port}/api/rules`)).status).toBe(200);
});
