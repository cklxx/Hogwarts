/**
 * Frozen-world variant of scripts/perf-client.ts used by the 2026-10-03 comparison.
 * See the adjacent README.md. It keeps the real server and client, shares one private fixture,
 * disables bot driving and server simulation, and seeds browser decorations consistently.
 * BENCH_ROOT selects the checkout to serve; PERF_FIXTURE must be shared across A/B runs.
 * PERF_TMP and --out should be different for each run. No generated world/key files belong in git.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { tmpdir } from 'node:os';





const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.env.BENCH_ROOT ?? resolve(HERE, '../../../..'));
const { ensureNpcs } = await import(pathToFileURL(join(ROOT, 'src/kernel/npc.ts')).href);
const { resolve: unstick } = await import(pathToFileURL(join(ROOT, 'src/kernel/physics.ts')).href);
const { World } = await import(pathToFileURL(join(ROOT, 'src/kernel/world.ts')).href);
const { mulberry32, SPAWN, WORLD_HALF } = await import(pathToFileURL(join(ROOT, 'src/shared/map.ts')).href);
// (split at the first '=' only: --url='&dyn=0&x=1' keeps its own '=' signs)
const args = new Map(process.argv.slice(2).map((a) => { const s = a.replace(/^--/, ''), i = s.indexOf('='); return (i < 0 ? [s, '1'] : [s.slice(0, i), s.slice(i + 1)]) as [string, string]; }));
const opt = (k: string, d: string) => args.get(k) ?? d;
const PORT = Number(opt('port', '8820'));
const SECS = Number(opt('secs', '8'));
const WARM = Number(opt('warm', '4'));
const BOTS = Number(opt('bots', '60'));
const CROWD = Number(opt('crowd', '30'));
const NPCS = Number(opt('npcs', '12'));
const QS = opt('q', 'high,low').split(',');
const SPOTS = opt('spots', 'follow,crowd,castle,lake,overview').split(',');
const [VW, VH] = opt('size', '1280x720').split('x').map(Number);
const LABEL = opt('label', '');
const OUT = args.get('out');
const SCRATCH = process.env.PERF_TMP ?? join(tmpdir(), 'hogwarts-frozen-run');
const PW = process.env.PLAYWRIGHT_CORE ?? opt('playwright', 'playwright-core');
const CHROMIUM = opt('chromium', process.env.CHROMIUM ?? '/opt/pw-browsers/chromium');
/** Where the viewer stands (`--viewer=x,z`; default a few metres south of the courtyard spawn). `--viewer=0,-58`: in the Great Hall. */
const VIEWER = args.get('viewer')?.split(',').map(Number);
const EXTRA = (args.get('url') ?? '').replace(/^&?/, '&').replace(/^&$/, '');

/** Camera shots (client/capture.ts); `follow` is the game's own camera behind the viewer at the spawn. */
const SHOTS: Record<string, { pos: [number, number, number]; look: [number, number, number] } | null> = {
  follow: null,
  castle: { pos: [55, 40, 40], look: [0, 12, -45] },
  lake: { pos: [-55, 10, 10], look: [-110, 0, 45] },
  overview: { pos: [0, 150, 170], look: [0, 0, -20] },
  crowd: { pos: [8, 14, 45], look: [0, 1, -22] },
  /** (a look at your own wizard up close: not in the default set) */
  close: { pos: [2.2, 2.0, -12.6], look: [0, 1.1, -16] },
  /** (not in the default set: the Great Hall from its doorway, and the Forbidden Forest with the Highlands behind) */
  hall: { pos: [0, 10, -41], look: [0, 4, -66] },
  forest: { pos: [110, 14, 70], look: [170, 4, 10] },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (a: number[], p: number) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const f1 = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2));

function makeWorld(file: string) {
  const world = new World({ seed: 4242, secret: 'perf-secret' });
  world.rules.creatures.spawnMultiplier = 3;
  world.rules.terms.lengthSeconds = 86400;
  world.term.endsAt = 86400;
  ensureNpcs(world, NPCS);
  for (let i = 0; i < 40; i++) (world as unknown as { spawnCreatures(): void }).spawnCreatures();
  const rnd = mulberry32(777);
  const viewer = world.enroll('Perf Viewer').wizard;
  viewer.pos = VIEWER ? { x: VIEWER[0], z: VIEWER[1] } : { x: SPAWN.x, z: SPAWN.z + 6 };
  viewer.createdAt = -1e9;
  const tokens: string[] = [];
  for (let i = 0; i < BOTS; i++) {
    const w = world.enroll(`Bot ${i}`).wizard;
    const p = i < CROWD ? { x: SPAWN.x + (rnd() - 0.5) * 30, z: SPAWN.z + (rnd() - 0.5) * 30 } : { x: (rnd() * 2 - 1) * (WORLD_HALF - 8), z: (rnd() * 2 - 1) * (WORLD_HALF - 8) };
    unstick(p, 0.5);
    w.pos = p;
    w.createdAt = -1e9;
    tokens.push(w.token);
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ ...world.serialize(), benchmarkCreatures: [...world.creatures.values()] }));
  return { viewer: viewer.token, tokens, creatures: world.creatures.size };
}

async function waitHttp(url: string, ms: number) {
  const t0 = Date.now();
  for (;;) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not up yet */ }
    if (Date.now() - t0 > ms) throw new Error(`server did not come up: ${url}`);
    await sleep(250);
  }
}

/** Installed before the page's scripts: long tasks and a heap sampler. */
const INIT = `
  let deterministicSeed = 20261003;
  Math.random = () => { deterministicSeed = (Math.imul(deterministicSeed, 1664525) + 1013904223) >>> 0; return deterministicSeed / 4294967296; };
  window.__lt = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch {}
  window.__heap = { grow: 0, drops: 0, dropped: 0, last: 0, peak: 0 };
  setInterval(() => {
    const m = performance.memory; if (!m) return;
    const h = window.__heap, u = m.usedJSHeapSize;
    if (h.last) { if (u >= h.last) h.grow += u - h.last; else { h.drops++; h.dropped += h.last - u; } }
    h.last = u; h.peak = Math.max(h.peak, u);
  }, 50);
`;

interface Row { [k: string]: string | number }
interface Profile { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; hitCount?: number; children?: number[] }[]; samples: number[]; timeDeltas: number[] }
/** Top functions by self time (and the whole-profile total) from a CDP CPU profile. */
function printProfile(p: Profile, what: string) {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const self = new Map<number, number>();
  for (let i = 0; i < p.samples.length; i++) self.set(p.samples[i], (self.get(p.samples[i]) ?? 0) + (p.timeDeltas[i] ?? 0) / 1000);
  const agg = new Map<string, number>();
  let total = 0;
  for (const [id, ms] of self) {
    const f = byId.get(id)!.callFrame;
    const k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
    agg.set(k, (agg.get(k) ?? 0) + ms);
    total += ms;
  }
  console.log(`  cpu profile (${what}): ${total.toFixed(0)} ms sampled`);
  for (const [k, ms] of [...agg].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`    ${ms.toFixed(1).padStart(8)} ms  ${k}`);
}

interface HeapNode { callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number }; selfSize: number; children: HeapNode[] }
/** Top allocation sites (self bytes, collected objects included) from a CDP sampling heap profile. */
function printHeap(root: HeapNode, what: string, secs: number) {
  const agg = new Map<string, number>();
  let total = 0;
  const name = (f: HeapNode['callFrame']) => `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}:${f.columnNumber + 1}`;
  const walk = (n: HeapNode, parent: string) => {
    const f = n.callFrame;
    // (a builtin, Math.random or an iterator's next, is shown with the function that called it)
    const k = f.url ? name(f) : `${f.functionName} ← ${parent}`;
    if (n.selfSize) { agg.set(k, (agg.get(k) ?? 0) + n.selfSize); total += n.selfSize; }
    for (const c of n.children) walk(c, f.url ? name(f) : parent);
  };
  walk(root, '');
  console.log(`  allocations (${what}): ${(total / 1048576 / secs).toFixed(2)} MB/s sampled`);
  for (const [k, b] of [...agg].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`    ${(b / 1024 / secs).toFixed(1).padStart(8)} KB/s  ${k}`);
}

async function main() {
  const { chromium } = await import(PW === 'playwright-core' ? PW : pathToFileURL(resolve(PW)).href);
  const data = join(SCRATCH, `perf-world-${PORT}.json`);
  mkdirSync(SCRATCH, { recursive: true });
  const fixtureDir = resolve(process.env.PERF_FIXTURE ?? join(tmpdir(), 'hogwarts-frozen-fixture'));
  mkdirSync(fixtureDir, { recursive: true, mode: 0o700 });
  const fixture = join(fixtureDir, 'world.json');
  const meta = join(fixtureDir, 'metadata.json');
  let w: ReturnType<typeof makeWorld>;
  if (!existsSync(fixture)) {
    w = makeWorld(fixture);
    writeFileSync(meta, JSON.stringify({ ...w, configuration: { bots: BOTS, crowd: CROWD, npcs: NPCS } }));
    chmodSync(fixture, 0o600); chmodSync(meta, 0o600);
  } else {
    const saved = JSON.parse(readFileSync(meta, 'utf8'));
    if (JSON.stringify(saved.configuration) !== JSON.stringify({ bots: BOTS, crowd: CROWD, npcs: NPCS })) throw new Error('Fixture settings differ; use a fresh PERF_FIXTURE directory.');
    w = saved;
  }
  copyFileSync(fixture, data);
  const base = `http://127.0.0.1:${PORT}`;
  const env: Record<string, string> = { ...(process.env as Record<string, string>), PORT: String(PORT), HOST: '127.0.0.1', PERF_TMP: SCRATCH, BENCH_EXPECTED_CLIENTS: String(BOTS + 1), HOGWARTS_DATA: data, PUBLIC_URL: base, NPC_COUNT: String(NPCS) };
  delete env.REALMS;
  const proc: ChildProcess = spawn(process.execPath, ['--import', 'tsx', '--import', pathToFileURL(join(HERE, 'freeze-world.mjs')).href, 'src/server/main.ts'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => { proc.kill('SIGKILL'); process.exit(130); });
  proc.stdout!.on('data', (d) => { log += d; });
  proc.stderr!.on('data', (d) => { log += d; });
  const workers: Worker[] = [];
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const rows: Row[] = [];
  try {
    await waitHttp(`${base}/api/rules`, 60_000);
    if (BOTS) {
      const half = Math.ceil(w.tokens.length / 2);
      for (let i = 0; i < 2; i++) {
        const slice = w.tokens.slice(i * half, (i + 1) * half);
        if (slice.length) workers.push(new Worker(pathToFileURL(join(ROOT, 'scripts/bench-clients.ts')), { workerData: { url: `ws://127.0.0.1:${PORT}`, tokens: slice, offset: i * half, seed: 31 * i + 7, inputHz: 20 } }));
      }
      const ask = (wk: Worker, cmd: string, want: string) => new Promise<unknown>((ok) => { const h = (m: { t: string }) => { if (m.t === want) { wk.off('message', h); ok(m); } }; wk.on('message', h); wk.postMessage({ cmd }); });
      await Promise.all(workers.map((wk) => ask(wk, 'connect', 'connected')));
      // Frozen fixture: connect the real WebSockets, but do not move or cast.
    }
    console.log(`world: ${BOTS} bots (${CROWD} at the spawn), ${NPCS} NPCs, ${w.creatures} creatures at start; ${VW}x${VH}; ${SECS}s per spot after ${WARM}s`);

    for (const q of QS) {
      const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      page.on('pageerror', (e: Error) => console.error('[page error]', e.message));
      page.on('console', (m: { text(): string }) => { if (m.text().startsWith('[perf]')) console.log(`  ${m.text()}`); });
      await page.addInitScript(INIT);
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Performance.enable');
      const reqs = new Map<string, { url: string; type: string }>();
      const bytes: Record<string, number> = {};
      let total = 0;
      cdp.on('Network.requestWillBeSent', (e: { requestId: string; request: { url: string }; type?: string }) => reqs.set(e.requestId, { url: e.request.url, type: e.type ?? '' }));
      cdp.on('Network.loadingFinished', (e: { requestId: string; encodedDataLength: number }) => {
        const r = reqs.get(e.requestId);
        if (!r) return;
        const ext = (new URL(r.url).pathname.match(/\.(\w+)$/)?.[1] ?? r.type).toLowerCase();
        bytes[ext] = (bytes[ext] ?? 0) + e.encodedDataLength;
        total += e.encodedDataLength;
      });
      if (args.has('profile')) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start'); }
      const t0 = Date.now();
      await page.goto(`${base}/?perf=1&capture=1&q=${q}${EXTRA}#k=${w.viewer}`, { waitUntil: 'load' });
      const loadMs = Date.now() - t0;
      await page.waitForFunction(() => (window as any).__perf?.marks?.firstFrame, null, { timeout: 180_000, polling: 250 });
      const marks = await page.evaluate(() => (window as any).__perf.marks);
      if (args.has('profile')) printProfile(((await cdp.send('Profiler.stop')) as { profile: Profile }).profile, 'load');
      const lm = Object.fromEntries(((await cdp.send('Performance.getMetrics')) as { metrics: { name: string; value: number }[] }).metrics.map((m) => [m.name, m.value]));
      console.log(`  load main thread: task ${Math.round(lm.TaskDuration * 1000)} ms, script ${Math.round(lm.ScriptDuration * 1000)} ms, layout ${Math.round(lm.LayoutDuration * 1000)} ms, style ${Math.round(lm.RecalcStyleDuration * 1000)} ms`);
      const progs0: string[] = args.has('census') ? await page.evaluate(() => (window as any).__perf.programs?.() ?? []) : [];
      await sleep(1500); // HDRIs and textures that arrive after the first frame
      const load = { q, loadEventMs: loadMs, ...Object.fromEntries(Object.entries(marks as Record<string, number>).map(([k, v]) => [`${k}Ms`, Math.round(v)])), totalKB: Math.round(total / 1024), ...Object.fromEntries(Object.entries(bytes).map(([k, v]) => [`KB_${k}`, Math.round(v / 1024)])) };
      console.log(`\nload (q=${q}):`, JSON.stringify(load));
      if (OUT) appendFileSync(OUT, JSON.stringify({ kind: 'load', label: LABEL, ...load }) + '\n');

      for (const spot of SPOTS) {
        await page.evaluate((s: unknown) => { (window as any).__capture = s; }, { ...SHOTS[spot], skip: true });
        await sleep(2000); // settle the fixed camera, interpolation and LOD at 60 Hz before drawing
        await page.evaluate((s: unknown) => { (window as any).__capture = s; }, args.has('nodraw') ? { ...SHOTS[spot], skip: true } : SHOTS[spot] ?? null);
        await page.mouse.move(VW * 0.5, VH * 0.42); // the pointer over the view: hover, aim and ground picking run every frame
        await sleep(WARM * 1000);
        const metric = async () => Object.fromEntries(((await cdp.send('Performance.getMetrics')) as { metrics: { name: string; value: number }[] }).metrics.map((m) => [m.name, m.value]));
        await page.evaluate(() => { (window as any).__perf.reset(); (window as any).__lt.length = 0; Object.assign((window as any).__heap, { grow: 0, drops: 0, dropped: 0 }); });
        if (args.get('profile') === 'spot') { await cdp.send('Profiler.start'); }
        if (args.has('heap')) { await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.startSampling', { samplingInterval: 8192, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true }); }
        const m0 = await metric();
        const w0 = Date.now();
        await sleep(SECS * 1000);
        const m1 = await metric();
        if (args.get('profile') === 'spot') printProfile(((await cdp.send('Profiler.stop')) as { profile: Profile }).profile, spot);
        if (args.has('heap')) printHeap(((await cdp.send('HeapProfiler.stopSampling')) as { profile: { head: HeapNode } }).profile.head, spot, SECS);
        const wall = (Date.now() - w0) / 1000;
        const r = await page.evaluate(() => { const p = (window as any).__perf; return { frames: p.frames, counters: p.counters, info: p.info(), lt: (window as any).__lt, heap: (window as any).__heap, passes: p.passes, census: p.census() }; });
        if (args.has('census')) {
          const progs: string[] = await page.evaluate(() => (window as any).__perf.programs?.() ?? []);
          const fresh = progs.filter((p) => !progs0.includes(p));
          console.log(`  programs: ${progs0.length} at the first frame, ${fresh.length} compiled since${fresh.length ? ': ' + fresh.slice(0, 12).join(' / ') : ''}`);
          const n = (r.frames as unknown[]).length || 1;
          console.log(`  passes (draw calls per frame): ${Object.entries(r.passes as Record<string, number>).map(([k, v]) => `${k} ${f1(v / n)}`).join(', ')}`);
          const c = Object.entries(r.census as Record<string, { n: number; casters: number; tris: number; instances: number }>).sort((a, b) => b[1].n - a[1].n);
          console.log(`  scene: ${c.reduce((a, [, v]) => a + v.n, 0)} drawables, ${c.reduce((a, [, v]) => a + v.casters, 0)} shadow casters`);
          if (args.get('detail')) for (const name of args.get('detail')!.split(',')) console.log(`  detail ${name}:`, JSON.stringify(await page.evaluate((n: string) => (window as any).__perf.detail(n), name)));
          for (const [k, v] of c.slice(0, 25)) console.log(`    ${k.padEnd(28)} ${String(v.n).padStart(5)} objs ${String(v.casters).padStart(5)} casters ${String(Math.round(v.tris)).padStart(8)} tris/obj-sum ${v.instances !== v.n ? `${v.instances} instances` : ''}`);
        }
        const fr = (r.frames as { dt: number; js: number; calls: number; tris: number; s: Record<string, number> }[]).filter((f) => f.dt > 0);
        const sec = (k: string) => mean(fr.map((f) => f.s[k] ?? 0));
        const snaps = r.counters.snaps || 1;
        const d = (k: string) => (m1[k] ?? 0) - (m0[k] ?? 0);
        const row: Row = {
          label: LABEL, q, spot, frames: fr.length, fps: fr.length / wall,
          frameP50: pct(fr.map((f) => f.dt), 50), frameP95: pct(fr.map((f) => f.dt), 95), frameMax: Math.max(0, ...fr.map((f) => f.dt)), over50: fr.filter((f) => f.dt > 50).length,
          jsPerFrame: mean(fr.map((f) => f.js - (f.s.msg ?? 0) - (f.s.hud ?? 0))), jsPerSec: fr.reduce((a, f) => a + f.js, 0) / wall,
          msg: fr.reduce((a, f) => a + (f.s.msg ?? 0), 0) / wall, hud: fr.reduce((a, f) => a + (f.s.hud ?? 0), 0) / wall, anim: sec('anim'), world: sec('world'), fx: sec('fx'), ctl: sec('ctl'), render: sec('render'),
          parsePerSnap: fr.reduce((a, f) => a + (f.s.parse ?? 0), 0) / snaps, applyPerSnap: fr.reduce((a, f) => a + (f.s.apply ?? 0), 0) / snaps,
          callsMin: Math.min(...fr.map(f => f.calls)), callsMax: Math.max(...fr.map(f => f.calls)), callsUnique: JSON.stringify([...new Set(fr.map(f => f.calls))]),
          trisMin: Math.min(...fr.map(f => f.tris)), trisMax: Math.max(...fr.map(f => f.tris)), trisUnique: JSON.stringify([...new Set(fr.map(f => f.tris))]),
          census: JSON.stringify(r.census), passes: JSON.stringify(r.passes),
          calls: mean(fr.map((f) => f.calls)), tris: mean(fr.map((f) => f.tris)), programs: r.info?.programs ?? 0, textures: r.info?.textures ?? 0, geometries: r.info?.geometries ?? 0,
          layoutsPerSec: d('LayoutCount') / wall, styleRecalcsPerSec: d('RecalcStyleCount') / wall, layoutMsPerSec: (d('LayoutDuration') * 1000) / wall, styleMsPerSec: (d('RecalcStyleDuration') * 1000) / wall,
          scriptMsPerSec: (d('ScriptDuration') * 1000) / wall, taskMsPerSec: (d('TaskDuration') * 1000) / wall,
          longTasks: r.lt.length, longTaskMs: r.lt.reduce((a: number, x: number[]) => a + x[1], 0),
          heapGrowMBps: r.heap.grow / 1048576 / wall, gcDrops: r.heap.drops, heapPeakMB: r.heap.peak / 1048576,
          wsKBps: r.counters.wsBytes / 1024 / wall, snapKB: r.counters.snapBytes / 1024 / snaps, snapsPerSec: r.counters.snaps / wall,
        };
        rows.push(row);
        if (args.has('shots')) { await page.addStyleTag({ content: '#hud,#perf,#tutorial,#overlay{display:none!important}' }); mkdirSync(args.get('shots')!, { recursive: true }); await page.screenshot({ path: join(args.get('shots')!, `${LABEL || 'run'}-${q}-${spot}.png`), timeout: 120_000 }); }
        if (OUT) appendFileSync(OUT, JSON.stringify({ kind: 'spot', ...row }) + '\n');
        console.log(`  ${q}/${spot}: ${f1(row.fps as number)} fps, JS ${f1(row.jsPerFrame as number)} ms/frame, ${f1(row.calls as number)} calls`);
      }
      await ctx.close();
    }
  } finally {
    await browser.close().catch(() => {});
    for (const wk of workers) await wk.terminate();
    proc.kill('SIGTERM');
    await sleep(500);
    if (proc.exitCode === null) proc.kill('SIGKILL');
    if (process.env.PERF_LOG) console.log(log);
  }
  const cols: [string, string][] = [
    ['q', 'q'], ['spot', 'spot'], ['fps', 'fps'], ['frameP50', 'frame p50'], ['frameP95', 'p95'], ['frameMax', 'max'], ['over50', '>50ms'],
    ['jsPerFrame', 'frame JS ms'], ['msg', 'msg ms/s'], ['hud', 'hud ms/s'], ['anim', 'anim'], ['world', 'world'], ['fx', 'fx'], ['ctl', 'ctl'], ['render', 'render'],
    ['parsePerSnap', 'parse/snap'], ['applyPerSnap', 'apply/snap'], ['calls', 'calls'], ['tris', 'tris'], ['programs', 'progs'], ['textures', 'tex'], ['geometries', 'geo'],
    ['layoutsPerSec', 'layout/s'], ['styleRecalcsPerSec', 'style/s'], ['layoutMsPerSec', 'layout ms/s'], ['styleMsPerSec', 'style ms/s'], ['longTasks', 'long tasks'],
    ['heapGrowMBps', 'heap MB/s'], ['gcDrops', 'GCs'], ['wsKBps', 'WS KB/s'], ['snapKB', 'snap KB'],
  ];
  console.log(`\n| ${cols.map((c) => c[1]).join(' | ')} |\n|${cols.map(() => '---').join('|')}|`);
  for (const r of rows) console.log(`| ${cols.map(([k]) => (typeof r[k] === 'number' ? f1(r[k] as number) : r[k])).join(' | ')} |`);
}

main().catch((e) => { console.error(e); process.exit(1); });
