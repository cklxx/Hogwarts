/**
 * Hogwarts performance benchmark.
 *
 *   npx tsx scripts/bench.ts kernel [--n=100,500,1000,2000] [--secs=30] [--warm=10]
 *   npx tsx scripts/bench.ts net    [--k=50,200,500] [--secs=15] [--warm=5] [--layout=spread|crowd] [--port=7900] [--realms=1]
 *                                   [--input-hz=20] [--aoi=1|0] [--env=K=V,...]
 *   npx tsx scripts/bench.ts trace  [--n=150] [--secs=30]          # determinism fingerprint (same number = same behaviour)
 *   npx tsx scripts/bench.ts churn  [--n=300] [--secs=120] [--observers=5] [--aoi=0,140/0,140/10]   # AOI enter/leave per client
 *   npx tsx scripts/bench.ts all
 * Common: --out=results.json (append machine-readable results), --label=before|after
 *
 * kernel: an in-process World with N online wizards spread over the map. Every wizard walks (new random
 *   heading every 3 s) and casts Stupefy about once a second: at the nearest hostile creature within 30 m,
 *   otherwise at a random point. creatures.spawnMultiplier = 3, 4 NPCs. Reports ms per tick.
 * net: builds a save file with K wizards, spawns the real server (src/server/main.ts) with the
 *   bench probe preloaded, connects K WebSocket clients (input at --input-hz, default 20 Hz; a cast every
 *   second; asking for AOI snapshots unless --aoi=0) from worker threads, and reports server event-loop
 *   delay, tick/broadcast callback times, CPU, bytes per client.
 * churn: how many entity models an AOI client creates and removes as it walks (see churn()).
 * trace: runs the kernel scenario and hashes the full observable state after every tick (snapshots,
 *   private states, cast reports, events). Used to show that optimisations did not change behaviour.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { ensureNpcs } from '../src/kernel/npc.js';
import { CREATURES } from '../src/kernel/creatures.js';
import { resolve as unstick } from '../src/kernel/physics.js';
import { World } from '../src/kernel/world.js';
import { SnapshotFanout } from '../src/server/fanout.js';
import { mulberry32, SPAWN, WORLD_HALF } from '../src/shared/map.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const mode = argv.find((a) => !a.startsWith('--')) ?? 'all';
const opt = (k: string, d: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const nums = (s: string) => s.split(',').map(Number).filter((x) => x > 0);
const OUT = opt('out', '');
const LABEL = opt('label', '');

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const f1 = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2));
function record(kind: string, row: Record<string, unknown>) {
  if (OUT) appendFileSync(OUT, JSON.stringify({ kind, label: LABEL, at: new Date().toISOString(), ...row }) + '\n');
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ the kernel scenario
interface Scenario { world: World; ids: string[]; rnd: () => number; t: number }

function scenario(n: number, seed: number): Scenario {
  const world = new World({ seed, secret: 'bench-secret' });
  world.rules.creatures.spawnMultiplier = 3;
  world.rules.terms.lengthSeconds = 86400;
  world.term.endsAt = 86400;
  ensureNpcs(world, 4);
  // Fill the wild to its (x3) population before the crowd arrives: one spawn per kind per call.
  for (let i = 0; i < 40; i++) (world as unknown as { spawnCreatures(): void }).spawnCreatures();
  const rnd = mulberry32(seed * 7919 + 17);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const w = world.enroll(`Bench ${i}`).wizard;
    w.connections = 1;
    const p = { x: (rnd() * 2 - 1) * (WORLD_HALF - 8), z: (rnd() * 2 - 1) * (WORLD_HALF - 8) };
    unstick(p, 0.5);
    w.pos = p;
    ids.push(w.id);
  }
  world.drainFx();
  return { world, ids, rnd, t: 0 };
}

interface Action { id: string; cast: null | { target: string | null; aim: { x: number; z: number } | null }; walk: null | { dx: number; dz: number } }

/** What every bench wizard wants to do this tick (harness work, not timed). */
function plan(s: Scenario): Action[] {
  const { world, ids, rnd } = s;
  const hostiles = [...world.creatures.values()].filter((c) => !c.owner && CREATURES[c.kind].faction === 'hostile' && c.hp > 0);
  const out: Action[] = [];
  for (let i = 0; i < ids.length; i++) {
    const w = world.wizards.get(ids[i])!;
    let cast: Action['cast'] = null;
    let walk: Action['walk'] = null;
    if ((s.t + i * 7) % 20 === 0) {
      let best: string | null = null, bd = 30;
      for (const c of hostiles) { const d = Math.hypot(c.pos.x - w.pos.x, c.pos.z - w.pos.z); if (d < bd) { bd = d; best = c.id; } }
      const a = rnd() * Math.PI * 2;
      cast = best ? { target: best, aim: null } : { target: null, aim: { x: w.pos.x + Math.cos(a) * 14, z: w.pos.z + Math.sin(a) * 14 } };
    }
    if ((s.t + i * 13) % 60 === 0) { const a = rnd() * Math.PI * 2; walk = { dx: Math.cos(a), dz: Math.sin(a) }; }
    if (cast || walk) out.push({ id: ids[i], cast, walk });
  }
  return out;
}

function act(s: Scenario, actions: Action[], onCast?: (r: unknown) => void) {
  let ok = 0;
  for (const a of actions) {
    if (a.walk) s.world.setInput(a.id, a.walk.dx, a.walk.dz);
    if (a.cast) {
      const r = s.world.cast(a.id, 'Stupefy', { target: a.cast.target, aim: a.cast.aim });
      if (r.ok) ok++;
      onCast?.(r);
    }
  }
  return ok;
}

function kernelBench(n: number, secs: number, warm: number) {
  const s = scenario(n, 4242 + n);
  const ticks = Math.round(secs * 20), warmTicks = Math.round(warm * 20);
  const tickMs: number[] = [], actMs: number[] = [];
  let creatures = 0, projectiles = 0, active = 0, castsOk = 0, casts = 0;
  for (let i = 0; i < warmTicks + ticks; i++) {
    const actions = plan(s);
    const a0 = performance.now();
    const ok = act(s, actions);
    const a1 = performance.now();
    s.world.tick();
    const a2 = performance.now();
    s.t++;
    if (i % 2 === 0) s.world.drainFx();
    if (i < warmTicks) continue;
    actMs.push(a1 - a0);
    tickMs.push(a2 - a1);
    creatures += s.world.creatures.size;
    projectiles += s.world.projectiles.size;
    for (const w of s.world.wizards.values()) if (s.world.isActive(w)) active++;
    castsOk += ok;
    casts += actions.filter((x) => x.cast).length;
  }
  const total = tickMs.map((t, i) => t + actMs[i]);
  const row = {
    n, secs, tickP50: pct(tickMs, 50), tickP95: pct(tickMs, 95), tickMax: Math.max(...tickMs), tickMean: mean(tickMs),
    syscallMean: mean(actMs), totalP50: pct(total, 50), totalP95: pct(total, 95), totalMean: mean(total),
    creatures: creatures / ticks, projectiles: projectiles / ticks, active: active / ticks, castsPerSec: casts / secs, castOkPct: casts ? (100 * castsOk) / casts : 0,
  };
  record('kernel', row);
  return row;
}

// ------------------------------------------------------------------ determinism fingerprint
function trace(n: number, secs: number) {
  const s = scenario(n, 777);
  const h = createHash('sha256');
  const handle = new Map<string, string>();
  for (const w of s.world.wizards.values()) handle.set(w.id, w.handle);
  const anon = (x: string) => handle.get(x) ?? x;
  const watch = s.ids.slice(0, 5);
  for (let i = 0; i < secs * 20; i++) {
    const actions = plan(s);
    act(s, actions, (r) => h.update(JSON.stringify(r)));
    s.world.tick();
    s.t++;
    h.update(JSON.stringify(s.world.snapshot()));
    for (const id of watch) h.update(JSON.stringify(s.world.privateState(id)));
    for (const w of s.world.wizards.values()) h.update(`${w.handle}|${w.pos.x}|${w.pos.z}|${w.hp}|${w.mana}|${w.xp}|${w.reputation}|${w.galleons}|${w.st.stunnedUntil}|${anon(w.lastHurtBy ?? '')}`);
    for (const c of s.world.creatures.values()) h.update(`${c.id}|${c.kind}|${c.pos.x}|${c.pos.z}|${c.hp}|${anon(c.target ?? '')}|${Object.entries(c.damageBy).map(([k, v]) => anon(k) + v).join()}`);
  }
  for (const e of s.world.events) h.update(`${e.t}|${e.type}|${e.text}`);
  const row = { n, secs, hash: h.digest('hex').slice(0, 16), wizards: s.world.wizards.size, creatures: s.world.creatures.size, events: s.world.events.length };
  record('trace', row);
  return row;
}

// ------------------------------------------------------------------ AOI churn
/**
 * What an area of interest costs the client: the kernel scenario with N wizards, and `observers` of
 * them watched like browsers (a snapshot every 2 ticks through SnapshotFanout, as main.ts sends it).
 * Counts, per observer, the models a client would create and remove, and splits the removals into
 * "really gone" (died / logged off) and "left my area" (still in the world), plus "flicker": removed and
 * back within 3 s.
 */
function churn(n: number, secs: number, radius: number, margin: number, observers: number) {
  const s = scenario(n, 5150 + n);
  const f = new SnapshotFanout(radius, 16, margin);
  const watch = s.ids.slice(0, observers).map((id) => ({ id, anchor: { cell: -1 }, w: new Set<string>(), c: new Set<string>(), gone: new Map<string, number>(), dist: 0, last: null as null | { x: number; z: number } }));
  const z = () => ({ wIn: 0, wOut: 0, wLeft: 0, cIn: 0, cOut: 0, cLeft: 0, flicker: 0, bytes: 0, snaps: 0, dist: 0 });
  const tot = z();
  for (let i = 0; i < secs * 20; i++) {
    act(s, plan(s));
    s.world.tick();
    s.t++;
    if (i % 2) continue;
    const snap = s.world.snapshot();
    f.load(snap);
    const online = new Set(snap.w.map((x) => x.h)), alive = new Set(snap.c.map((x) => x.i));
    for (const o of watch) {
      const me = s.world.wizards.get(o.id)!;
      if (o.last) o.dist += Math.hypot(me.pos.x - o.last.x, me.pos.z - o.last.z);
      o.last = { ...me.pos };
      const buf = f.payloadFor(me.pos.x, me.pos.z, o.anchor);
      tot.bytes += buf.length; tot.snaps++;
      if (i < 20) { const m = JSON.parse(buf.toString()).s; o.w = new Set(m.w.map((x: { h: string }) => x.h)); o.c = new Set(m.c.map((x: { i: string }) => x.i)); continue; } // the first second fills the scene
      const m = JSON.parse(buf.toString()).s as { w: { h: string }[]; c: { i: string }[] };
      const w = new Set(m.w.map((x) => x.h)), c = new Set(m.c.map((x) => x.i));
      for (const h of w) if (!o.w.has(h)) { tot.wIn++; const g = o.gone.get('w' + h); if (g !== undefined && s.t - g <= 60) tot.flicker++; }
      for (const h of o.w) if (!w.has(h)) { tot.wOut++; if (online.has(h)) tot.wLeft++; o.gone.set('w' + h, s.t); }
      for (const id of c) if (!o.c.has(id)) { tot.cIn++; const g = o.gone.get('c' + id); if (g !== undefined && s.t - g <= 60) tot.flicker++; }
      for (const id of o.c) if (!c.has(id)) { tot.cOut++; if (alive.has(id)) tot.cLeft++; o.gone.set('c' + id, s.t); }
      o.w = w; o.c = c;
    }
  }
  tot.dist = watch.reduce((a, o) => a + o.dist, 0);
  const per = (v: number) => v / observers;
  const row = {
    n, secs, radius, observers, margin: f.margin, guaranteed: f.guaranteed,
    wizardsCreated: per(tot.wIn), wizardsRemoved: per(tot.wOut), wizardsLeftArea: per(tot.wLeft),
    creaturesCreated: per(tot.cIn), creaturesRemoved: per(tot.cOut), creaturesLeftArea: per(tot.cLeft),
    flicker: per(tot.flicker), metresWalked: per(tot.dist), snapKB: tot.snaps ? tot.bytes / tot.snaps / 1024 : 0,
  };
  record('churn', row);
  return row;
}

// ------------------------------------------------------------------ network benchmark
const realmPath = (base: string, i: number) => (i === 0 ? base : base.replace(/(\.json)?$/, `.r${i}.json`));

async function waitHttp(url: string, ms: number) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error(`server at ${url} did not come up`);
}

function probeCmd(dir: string, gen: number, cmd: string) { writeFileSync(join(dir, 'ctl.json'), JSON.stringify({ gen, cmd })); }

interface NetOpts { k: number; secs: number; warm: number; port: number; realms: number; layout: 'spread' | 'crowd'; workers: number; env: Record<string, string>; inputHz: number; aoi: boolean }

async function netBench(o: NetOpts) {
  const dir = mkdtempSync(join(process.env.BENCH_TMP ?? tmpdir(), 'hogbench-'));
  const probeDir = join(dir, 'probe');
  mkdirSync(probeDir);
  const data = join(dir, 'world.json');
  const R = Math.max(1, o.realms);
  const tokens: string[] = [];
  const rnd = mulberry32(99 + o.k);
  for (let r = 0; r < R; r++) {
    const world = new World({ seed: 1000 + r, secret: 'bench-secret' });
    world.rules.creatures.spawnMultiplier = 3;
    world.rules.terms.lengthSeconds = 86400;
    world.term.endsAt = 86400;
    const kr = Math.floor(o.k / R) + (r < o.k % R ? 1 : 0);
    for (let i = 0; i < kr; i++) {
      const w = world.enroll(`Net ${r} ${i}`).wizard;
      const p = o.layout === 'spread'
        ? { x: (rnd() * 2 - 1) * (WORLD_HALF - 8), z: (rnd() * 2 - 1) * (WORLD_HALF - 8) }
        : { x: SPAWN.x + (rnd() - 0.5) * 30, z: SPAWN.z + (rnd() - 0.5) * 30 };
      unstick(p, 0.5);
      w.pos = p;
      w.createdAt = -1e9;
      if (R > 1) w.token = `r${r}.${w.token}`;
      tokens.push(w.token);
    }
    writeFileSync(realmPath(data, r), JSON.stringify(world.serialize()));
  }
  const base = `http://127.0.0.1:${o.port}`;
  const env: Record<string, string> = { ...(process.env as Record<string, string>), PORT: String(o.port), HOST: '127.0.0.1', HOGWARTS_DATA: data, PUBLIC_URL: base, NPC_COUNT: '4', BENCH_PROBE_DIR: probeDir, ...o.env };
  if (R > 1) env.REALMS = String(R); else delete env.REALMS;
  const nodeFlags = (process.env.BENCH_NODE_FLAGS ?? '').split(' ').filter(Boolean); // e.g. "--cpu-prof --cpu-prof-dir=/tmp/prof"
  const proc: ChildProcess = spawn(process.execPath, [...nodeFlags, '--import', 'tsx', '--import', './scripts/bench-probe.ts', 'src/server/main.ts'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout!.on('data', (d) => { log += d; });
  proc.stderr!.on('data', (d) => { log += d; });
  const workers: Worker[] = [];
  try {
    await waitHttp(`${base}/api/rules`, 60_000);
    if (R > 1) await waitHttp(`${base}/api/realms`, 60_000);
    const W = Math.max(1, Math.min(o.workers, o.k));
    const per = Math.ceil(tokens.length / W);
    const ask = (w: Worker, cmd: string, want: string) => new Promise<any>((ok) => {
      const h = (m: { t: string }) => { if (m.t === want) { w.off('message', h); ok(m); } };
      w.on('message', h);
      w.postMessage({ cmd });
    });
    for (let i = 0; i < W; i++) {
      const slice = tokens.slice(i * per, (i + 1) * per);
      if (!slice.length) continue;
      workers.push(new Worker(new URL('./bench-clients.ts', import.meta.url), { workerData: { url: `ws://127.0.0.1:${o.port}`, tokens: slice, offset: i * per, seed: 31 * i + 7, inputHz: o.inputHz, aoi: o.aoi } }));
    }
    const conn = await Promise.all(workers.map((w) => ask(w, 'connect', 'connected')));
    const open = conn.reduce((s, c) => s + c.open, 0);
    for (const w of workers) w.postMessage({ cmd: 'drive' });
    await sleep(o.warm * 1000);
    probeCmd(probeDir, 1, 'reset');
    await Promise.all(workers.map((w) => ask(w, 'reset', 'reset')));
    const t0 = performance.now();
    await sleep(o.secs * 1000);
    const stats = await Promise.all(workers.map((w) => ask(w, 'stats', 'stats')));
    const wall = (performance.now() - t0) / 1000;
    probeCmd(probeDir, 2, 'dump');
    // An overloaded server may take a while to get to its probe's timer: wait for every process to report.
    const expect = R > 1 ? R + 1 : 1;
    const dumps = () => readdirSync(probeDir).filter((f) => f !== 'ctl.json');
    for (const until = Date.now() + 60_000; dumps().length < expect && Date.now() < until;) await sleep(250);
    await sleep(300);
    const probes = dumps().map((f) => JSON.parse(readFileSync(join(probeDir, f), 'utf8')));
    const agg = stats.reduce((a, s) => {
      for (const k of Object.keys(s.st)) if (k !== 'rtt') a[k] = (a[k] ?? 0) + s.st[k];
      a.rtt.push(...s.st.rtt);
      return a;
    }, { rtt: [] as number[] } as Record<string, any>);
    const stillOpen = stats.reduce((s, x) => s + x.open, 0);
    const servers = probes.filter((p) => p.role !== 'primary');
    const primary = probes.find((p) => p.role === 'primary');
    const worst = (f: (p: any) => number) => Math.max(0, ...servers.map(f));
    const row = {
      k: o.k, realms: R, layout: o.layout, secs: o.secs, inputHz: o.inputHz, aoi: o.aoi, connected: open, stillOpen, inputsPerClientPerSec: (agg.inputs ?? 0) / wall / o.k,
      bytesPerClientPerSec: agg.bytes / wall / o.k, snapBytesAvg: agg.snaps ? agg.snapBytes / agg.snaps : 0,
      snapsPerClientPerSec: agg.snaps / wall / o.k, mePerClientPerSec: agg.mes / wall / o.k, eventsPerClientPerSec: agg.events / wall / o.k,
      castRttP50: pct(agg.rtt, 50), castRttP95: pct(agg.rtt, 95), castRttP99: pct(agg.rtt, 99), castReplies: agg.castReplies, castsSent: agg.casts,
      eventLoopP50: worst((p) => p.eventLoop.p50), eventLoopP99: worst((p) => p.eventLoop.p99), eventLoopMax: worst((p) => p.eventLoop.max),
      tickP50: worst((p) => p.tick.p50), tickP95: worst((p) => p.tick.p95), tickCount: servers.reduce((s, p) => s + p.tick.n, 0) / servers.length,
      broadcastP50: worst((p) => p.broadcast.p50), broadcastP95: worst((p) => p.broadcast.p95), broadcastCount: servers.reduce((s, p) => s + p.broadcast.n, 0) / servers.length,
      snapshotMean: worst((p) => p.snapshot.mean), worldTickP50: worst((p) => p.worldTick?.p50 ?? 0), worldTickP95: worst((p) => p.worldTick?.p95 ?? 0),
      serverCpuPct: servers.reduce((s, p) => s + p.cpuPct, 0), primaryCpuPct: primary?.cpuPct ?? 0, serverRssMb: servers.reduce((s, p) => s + p.rssMb, 0),
      perRealm: servers.map((p) => ({ role: p.role, cpuPct: p.cpuPct, eventLoopP99: p.eventLoop.p99, tickP95: p.tick.p95, broadcastP95: p.broadcast.p95 })),
    };
    record('net', row);
    return row;
  } catch (e) {
    console.error(log.slice(-4000));
    throw e;
  } finally {
    await Promise.all(workers.map((w) => new Promise<void>((ok) => { w.once('exit', () => ok()); w.postMessage({ cmd: 'stop' }); setTimeout(() => { w.terminate().then(() => ok()); }, 3000); })));
    await new Promise<void>((ok) => {
      if (proc.exitCode !== null) return ok();
      proc.once('exit', () => ok());
      proc.kill('SIGTERM');
      setTimeout(() => { if (proc.exitCode === null) proc.kill('SIGKILL'); }, 8000);
    });
    rmSync(dir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ main
async function main() {
  const machine = `${cpus().length}x ${cpus()[0]?.model ?? '?'} · ${(totalmem() / 2 ** 30).toFixed(0)} GB · node ${process.version}`;
  console.log(`# Hogwarts bench ${LABEL ? `(${LABEL}) ` : ''}— ${machine}\n`);
  if (mode === 'kernel' || mode === 'all') {
    const secs = Number(opt('secs', '30')), warm = Number(opt('warm', '10'));
    console.log(`## kernel: ${secs}s simulated after ${warm}s warm-up, spawnMultiplier 3, a cast per wizard per second\n`);
    console.log('| wizards | tick p50 ms | tick p95 ms | tick max ms | tick mean ms | syscalls ms/tick | creatures | projectiles | casts/s | cast ok % |');
    console.log('|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const n of nums(opt('n', '100,500,1000,2000'))) {
      const r = kernelBench(n, secs, warm);
      console.log(`| ${n} | ${f1(r.tickP50)} | ${f1(r.tickP95)} | ${f1(r.tickMax)} | ${f1(r.tickMean)} | ${f1(r.syscallMean)} | ${f1(r.creatures)} | ${f1(r.projectiles)} | ${f1(r.castsPerSec)} | ${f1(r.castOkPct)} |`);
    }
    console.log();
  }
  if (mode === 'trace' || mode === 'all') {
    const r = trace(Number(opt('n', mode === 'trace' ? '150' : '150')), Number(opt('secs', '30')));
    console.log(`## trace: n=${r.n} secs=${r.secs} → fingerprint ${r.hash} (wizards ${r.wizards}, creatures ${r.creatures}, events ${r.events})\n`);
  }
  if (mode === 'churn') {
    const n = Number(opt('n', '300')), secs = Number(opt('secs', '120')), obs = Number(opt('observers', '5'));
    console.log(`## AOI churn: ${n} wizards (kernel scenario), ${obs} observers, ${secs}s; per observer\n`);
    console.log('| AOI radius / margin (everything within) | snap KB | walked m | wizard models created | removed | …of them still in the world | creature models created | removed | …of them still alive ("puff") | flicker (back within 3 s) |');
    console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const spec of opt('aoi', '0,140/0,140/10').split(',')) {
      const [r, m] = spec.split('/').map(Number);
      const x = churn(n, secs, r, m ?? 10, obs);
      console.log(`| ${r ? `${r} / ${x.margin} (${x.guaranteed} m)` : 'off'} | ${f1(x.snapKB)} | ${f1(x.metresWalked)} | ${f1(x.wizardsCreated)} | ${f1(x.wizardsRemoved)} | ${f1(x.wizardsLeftArea)} | ${f1(x.creaturesCreated)} | ${f1(x.creaturesRemoved)} | ${f1(x.creaturesLeftArea)} | ${f1(x.flicker)} |`);
    }
    console.log();
  }
  if (mode === 'net' || mode === 'all') {
    const secs = Number(opt(mode === 'all' ? 'netsecs' : 'secs', '15')), warm = Number(opt(mode === 'all' ? 'netwarm' : 'warm', '5'));
    const layouts = opt('layout', 'spread').split(',') as ('spread' | 'crowd')[];
    const realms = Number(opt('realms', '1'));
    const extraEnv = Object.fromEntries(opt('env', '').split(',').filter(Boolean).map((kv) => kv.split('=') as [string, string]));
    const inputHz = Number(opt('input-hz', '20')), aoi = opt('aoi', '1') !== '0';
    console.log(`## net: ${secs}s measured after ${warm}s warm-up; clients send input at ${inputHz} Hz and cast every second; ${aoi ? 'clients ask for AOI snapshots' : 'clients get full snapshots (as the shipped browser client)'}${realms > 1 ? `; REALMS=${realms}` : ''}\n`);
    console.log('| clients | layout | realms | loop p50 ms | loop p99 ms | loop max ms | world.tick p50 / p95 ms | 50 ms timer p95 | bcast p50 ms | bcast p95 ms | snapshot ms | server CPU % | KB/s per client | snap KB | me/s | ev/s | cast RTT p50 | cast RTT p99 | cast replies % | input/s per client | open |');
    console.log('|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
    let port = Number(opt('port', '7900'));
    for (const layout of layouts) for (const k of nums(opt('k', '50,200,500'))) {
      const r = await netBench({ k, secs, warm, port: port++, realms, layout, workers: Number(opt('workers', '2')), env: extraEnv, inputHz, aoi });
      console.log(`| ${k} | ${layout} | ${realms} | ${f1(r.eventLoopP50)} | ${f1(r.eventLoopP99)} | ${f1(r.eventLoopMax)} | ${f1(r.worldTickP50)} / ${f1(r.worldTickP95)} | ${f1(r.tickP95)} | ${f1(r.broadcastP50)} | ${f1(r.broadcastP95)} | ${f1(r.snapshotMean)} | ${f1(r.serverCpuPct)}${r.primaryCpuPct ? ` (+${f1(r.primaryCpuPct)} primary)` : ''} | ${f1(r.bytesPerClientPerSec / 1024)} | ${f1(r.snapBytesAvg / 1024)} | ${f1(r.mePerClientPerSec)} | ${f1(r.eventsPerClientPerSec)} | ${f1(r.castRttP50)} | ${f1(r.castRttP99)} | ${f1(r.castsSent ? (100 * r.castReplies) / r.castsSent : 0)} | ${f1(r.inputsPerClientPerSec)} | ${r.stillOpen}/${r.connected} |`);
      if (port > 7949) port = Number(opt('port', '7900'));
    }
    console.log();
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
