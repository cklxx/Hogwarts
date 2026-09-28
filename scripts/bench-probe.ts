/**
 * Benchmark probe, preloaded into a game server by scripts/bench.ts:
 *   node --import tsx --import ./scripts/bench-probe.ts src/server/main.ts
 * It changes nothing in the server. It measures from the outside:
 *   - event-loop delay (perf_hooks.monitorEventLoopDelay)
 *   - wall time of every 50 ms callback (the world clock) and 100 ms callback (the snapshot broadcast)
 *   - time spent inside each World#tick and World#snapshot call
 *   - process CPU time and RSS
 * Control: the bench writes {gen, cmd} to $BENCH_PROBE_DIR/ctl.json; every probe in the process tree
 * polls it, resets its counters on 'reset' and writes $BENCH_PROBE_DIR/<pid>.json on 'dump'.
 * Only active when BENCH_PROBE_DIR is set.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

const DIR = process.env.BENCH_PROBE_DIR;
if (DIR) {
  const eld = monitorEventLoopDelay({ resolution: 2 });
  eld.enable();
  const series: Record<string, number[]> = { tick: [], broadcast: [], snapshot: [], worldTick: [] };
  let cpu0 = process.cpuUsage();
  let t0 = performance.now();

  const realSetInterval = globalThis.setInterval;
  const labelFor = (ms: unknown) => (ms === 50 ? 'tick' : ms === 100 ? 'broadcast' : null);
  globalThis.setInterval = ((fn: (...a: unknown[]) => void, ms?: number, ...rest: unknown[]) => {
    const label = labelFor(ms);
    if (!label || typeof fn !== 'function') return realSetInterval(fn, ms, ...rest);
    return realSetInterval((...a: unknown[]) => {
      const s = performance.now();
      try { fn(...a); } finally { series[label].push(performance.now() - s); }
    }, ms, ...rest);
  }) as typeof setInterval;

  // Time the snapshot builders. Imported lazily so the probe loads before the server's modules.
  import('../src/kernel/world.js').then(({ World }) => {
    const proto = World.prototype as unknown as Record<string, unknown>;
    for (const [name, into] of [['snapshot', 'snapshot'], ['tick', 'worldTick']]) {
      const orig = proto[name];
      if (typeof orig !== 'function') continue;
      proto[name] = function (this: unknown, ...a: unknown[]) {
        const s = performance.now();
        try { return (orig as (...x: unknown[]) => unknown).apply(this, a); } finally { series[into].push(performance.now() - s); }
      };
    }
  }).catch(() => {});

  const pct = (xs: number[], p: number) => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  };
  const summary = (xs: number[]) => ({ n: xs.length, mean: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0, p50: pct(xs, 50), p95: pct(xs, 95), p99: pct(xs, 99), max: xs.length ? Math.max(...xs) : 0 });

  let gen = -1;
  const ctl = `${DIR}/ctl.json`;
  const poll = () => {
    if (!existsSync(ctl)) return;
    let c: { gen: number; cmd: string };
    try { c = JSON.parse(readFileSync(ctl, 'utf8')); } catch { return; }
    if (c.gen === gen) return;
    gen = c.gen;
    if (c.cmd === 'reset') {
      eld.reset();
      for (const k of Object.keys(series)) series[k] = [];
      cpu0 = process.cpuUsage();
      t0 = performance.now();
    } else if (c.cmd === 'dump') {
      const wall = performance.now() - t0;
      const cpu = process.cpuUsage(cpu0);
      const out = {
        pid: process.pid,
        role: process.env.REALM_ID !== undefined ? `realm ${process.env.REALM_ID}` : process.env.REALMS && Number(process.env.REALMS) > 1 ? 'primary' : 'single',
        wallMs: wall,
        cpuPct: ((cpu.user + cpu.system) / 1000 / wall) * 100,
        rssMb: process.memoryUsage().rss / 1048576,
        eventLoop: { mean: eld.mean / 1e6, p50: eld.percentile(50) / 1e6, p99: eld.percentile(99) / 1e6, max: eld.max / 1e6 },
        tick: summary(series.tick),
        broadcast: summary(series.broadcast),
        snapshot: summary(series.snapshot),
        worldTick: summary(series.worldTick),
      };
      writeFileSync(`${DIR}/${process.pid}.json`, JSON.stringify(out));
    }
  };
  realSetInterval(poll, 200).unref();
}
