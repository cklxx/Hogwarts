/** Compare synchronous legacy checkpoints with the async writer on the same frozen World.
 * npx tsx scripts/bench-persistence.ts --n=500,2000 --rounds=9
 * No save contents, keys or identities appear in the output.
 */
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { World } from '../src/kernel/world.js';
import { Checkpoints } from '../src/server/persistence.js';

const opt = (key: string, fallback: string) => process.argv.find((a) => a.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const counts = opt('n', '500,2000').split(',').map(Number);
const rounds = Number(opt('rounds', '9'));
if (!Number.isInteger(rounds) || rounds < 3 || counts.some((n) => !Number.isInteger(n) || n <= 0)) throw new Error('Positive sizes and at least three rounds required');
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const dir = mkdtempSync(join(tmpdir(), 'hogwarts-persistence-bench-'));
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, cores: cpus().length, rounds }));
try {
  for (const n of counts) {
    const w = new World({ seed: 7, secret: 'benchmark-fixture' });
    for (let i = 0; i < n; i++) w.enroll(`Bench ${i}`);
    const expected = JSON.stringify(w.serialize());
    const path = join(dir, 'world.json');
    const asyncWriter = new Checkpoints(() => [{ path, data: w.serialize() }]);
    const legacy = () => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path + '.tmp', JSON.stringify(w.serialize()));
      renameSync(path + '.tmp', path);
      return Promise.resolve();
    };
    const samples = { legacy: [] as { blocking: number; turn: number; complete: number }[], async: [] as { blocking: number; turn: number; complete: number }[] };
    for (let i = -3; i < rounds; i++) {
      for (const mode of i % 2 ? ['async', 'legacy'] as const : ['legacy', 'async'] as const) {
        await new Promise<void>((ok) => setImmediate(ok));
        const start = performance.now();
        const turn = new Promise<number>((ok) => setImmediate(() => ok(performance.now() - start)));
        const work = mode === 'legacy' ? legacy() : asyncWriter.save();
        const blocking = performance.now() - start;
        await work;
        const complete = performance.now() - start;
        const delay = await turn;
        if (readFileSync(path, 'utf8') !== expected) throw new Error('Checkpoint changed observable saved state');
        if (i >= 0) samples[mode].push({ blocking, turn: delay, complete });
      }
    }
    console.log(JSON.stringify({ n, bytes: Buffer.byteLength(expected), identical: true, ...Object.fromEntries(Object.entries(samples).map(([mode, xs]) => [mode, {
      blockingMedianMs: median(xs.map((x) => x.blocking)), nextTurnMedianMs: median(xs.map((x) => x.turn)), completeMedianMs: median(xs.map((x) => x.complete)), samples: xs,
    }])) }));
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
