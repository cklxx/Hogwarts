/**
 * Screenshot comparison harness for the renderer: the same world, the same camera spots, the same hours, on
 * either backend (WebGPU or WebGL2), so pictures from two builds or two backends can be laid side by side.
 *
 *   npx vite build && npx tsx scripts/gpu-shots.ts --gpu=webgpu|webgl [--label=x] [--out=dir] [--port=9004]
 *        [--size=960x540] [--shots=castle-dusk,courtyard-day,...] [--wait=6] [--url=&extra=1]
 *
 * The world: a viewer at the courtyard spawn, seven wizards in a row wearing each glamour material (velvet,
 * silk, scales, mirror, flame, starlight, ghost), 24 bots walking and casting in the courtyard (spells in
 * flight), the aurora decreed. Each shot pins the camera, the hour and the weather through `?capture=1`
 * (client/capture.ts), waits `--wait` seconds, and writes `<out>/<label>-<shot>.png` with the HUD hidden.
 * `--gpu=webgl` adds `?gpu=webgl` (the WebGL2 fallback of the WebGPU renderer; a build before it simply ignores
 * it). Headless Chromium renders both through SwiftShader: slow, but pixel-comparable.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { resolve as unstick } from '../src/kernel/physics.js';
import { World } from '../src/kernel/world.js';
import { mulberry32, SPAWN } from '../src/shared/map.js';
import type { GlamourMaterial } from '../src/shared/glamour.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? '1'] as [string, string]; }));
const opt = (k: string, d: string) => args.get(k) ?? d;
const PORT = Number(opt('port', '9004'));
const GPU = opt('gpu', 'webgpu');
const LABEL = opt('label', GPU);
const OUT = resolve(opt('out', join(ROOT, 'data', 'shots')));
const [VW, VH] = opt('size', '960x540').split('x').map(Number);
const WAIT = Number(opt('wait', '6'));
const EXTRA = (args.get('url') ?? '').replace(/^&?/, '&').replace(/^&$/, '');
const PW = process.env.PLAYWRIGHT_CORE ?? opt('playwright', '/tmp/claude-0/-home-user-Hogwarts/f6d5f4cd-c14a-5196-b6e5-05eb73ec4d18/scratchpad/node_modules/playwright-core/index.mjs');
const CHROMIUM = opt('chromium', process.env.CHROMIUM ?? '/opt/pw-browsers/chromium');
const SCRATCH = process.env.PERF_TMP ?? join(ROOT, 'data', 'perf');

type V3 = [number, number, number];
/** The comparison spots: camera, look-at, hour of the day, weather. */
const SHOTS: Record<string, { pos: V3; look: V3; hour: number; weather?: string; fov?: number }> = {
  'castle-dusk': { pos: [55, 40, 40], look: [0, 12, -45], hour: 17.8 },
  'courtyard-day': { pos: [8, 14, 45], look: [0, 1, -22], hour: 11 },
  forest: { pos: [110, 14, 70], look: [170, 4, 10], hour: 14.5 },
  'night-aurora': { pos: [0, 9, 70], look: [0, 30, -60], hour: 23 },
  glamour: { pos: [0, 1.9, -13.2], look: [0, 1.15, -19], hour: 12, fov: 50 },
  spells: { pos: [14, 6, -8], look: [0, 1.5, -24], hour: 16 },
  lake: { pos: [-55, 10, 10], look: [-110, 0, 45], hour: 10 },
};
const WANT = (args.get('shots') ?? Object.keys(SHOTS).join(',')).split(',');

const GLAMOURS: GlamourMaterial[] = ['velvet', 'silk', 'scales', 'mirror', 'flame', 'starlight', 'ghost'];
const COLOURS: Partial<Record<GlamourMaterial, { robe?: number; trim?: number; glow?: number }>> = {
  velvet: { robe: 0x6a1b3a, trim: 0xd4af37 }, silk: { robe: 0x2a5aa8, trim: 0xf0e0c0 }, flame: { glow: 0xff7a1a },
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeWorld(file: string) {
  const world = new World({ seed: 4242, secret: 'shots-secret' });
  world.rules.creatures.spawnMultiplier = 1;
  world.rules.terms.lengthSeconds = 86400;
  world.term.endsAt = 86400;
  (world.rules.world.aesthetics as { aurora: boolean }).aurora = true;
  const viewer = world.enroll('Shot Viewer').wizard;
  viewer.pos = { x: SPAWN.x + 6, z: SPAWN.z + 9 };
  viewer.createdAt = -1e9;
  const still: string[] = [];
  GLAMOURS.forEach((mat, i) => {
    const w = world.enroll(`Glamour ${mat}`).wizard;
    w.pos = { x: SPAWN.x - 2.7 + i * 0.9, z: SPAWN.z + 3 };
    w.facing = Math.PI;
    w.createdAt = -1e9;
    (w as unknown as { look: unknown }).look = { mat, ...COLOURS[mat] };
    still.push(w.token);
  });
  const rnd = mulberry32(99);
  const bots: string[] = [];
  for (let i = 0; i < 24; i++) {
    const w = world.enroll(`Bot ${i}`).wizard;
    const p = { x: SPAWN.x + (rnd() - 0.5) * 30, z: SPAWN.z - 6 + (rnd() - 0.5) * 20 };
    unstick(p, 0.5);
    w.pos = p;
    w.createdAt = -1e9;
    bots.push(w.token);
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(world.serialize()));
  return { viewer: viewer.token, still, bots };
}

async function waitHttp(url: string, ms: number) {
  const t0 = Date.now();
  for (;;) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not up yet */ }
    if (Date.now() - t0 > ms) throw new Error(`server did not come up: ${url}`);
    await sleep(250);
  }
}

async function main() {
  const { chromium } = await import(pathToFileURL(PW).href);
  const data = join(SCRATCH, `shots-world-${PORT}.json`);
  const w = makeWorld(data);
  // (localhost, not 127.0.0.1: WebGPU wants a secure context, and Chromium trusts http://localhost)
  const base = `http://localhost:${PORT}`;
  const env: Record<string, string> = { ...(process.env as Record<string, string>), PORT: String(PORT), HOST: '127.0.0.1', HOGWARTS_DATA: data, PUBLIC_URL: base, NPC_COUNT: '0' };
  delete env.REALMS;
  const proc: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout!.on('data', (d) => { log += d; });
  proc.stderr!.on('data', (d) => { log += d; });
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => { proc.kill('SIGKILL'); process.exit(130); });
  const workers: Worker[] = [];
  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    // (Vulkan and ANGLE both on SwiftShader: with WebGPU on SwiftShader alone, this Chromium loses the device at once)
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  try {
    await waitHttp(`${base}/api/rules`, 60_000);
    const ask = (wk: Worker, cmd: string, want: string) => new Promise<unknown>((ok) => { const h = (m: { t: string }) => { if (m.t === want) { wk.off('message', h); ok(m); } }; wk.on('message', h); wk.postMessage({ cmd }); });
    const still = new Worker(new URL('./bench-clients.ts', import.meta.url), { workerData: { url: `ws://127.0.0.1:${PORT}`, tokens: w.still, offset: 0, seed: 3, inputHz: 20, aoi: true } });
    const bots = new Worker(new URL('./bench-clients.ts', import.meta.url), { workerData: { url: `ws://127.0.0.1:${PORT}`, tokens: w.bots, offset: 100, seed: 5, inputHz: 20, aoi: true } });
    workers.push(still, bots);
    await Promise.all([ask(still, 'connect', 'connected'), ask(bots, 'connect', 'connected')]);
    bots.postMessage({ cmd: 'drive' });
    const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('pageerror', (e: Error) => console.error('[page error]', e.message, (e.stack ?? '').split('\n').slice(1, 6).join(' | ')));
    const T0 = Date.now();
    page.on('console', (m: { type(): string; text(): string }) => { const t = m.text(); if (args.has('verbose') || m.type() === 'error' || m.type() === 'warning' || t.startsWith('[perf]') || t.startsWith('[gpu]')) console.log(`  ${((Date.now() - T0) / 1000).toFixed(1)}s [${m.type()}] ${t.slice(0, 400)}`); });
    const t0 = Date.now();
    await page.goto(`${base}/?perf=1&capture=1&q=high&dyn=0${GPU === 'webgl' ? '&gpu=webgl' : ''}${EXTRA}#k=${w.viewer}`, { waitUntil: 'load' });
    await page.waitForFunction(() => (window as any).__perf?.marks?.firstFrame, null, { timeout: 300_000, polling: 500 });
    const backend = await page.evaluate(() => (window as any).__perf?.backend ?? 'webgl (WebGLRenderer)');
    console.log(`${LABEL}: first frame after ${((Date.now() - t0) / 1000).toFixed(1)} s, backend ${backend}`);
    await page.addStyleTag({ content: '#hud,#perf,#tutorial,#overlay,#toast,#banner{display:none!important}' });
    mkdirSync(OUT, { recursive: true });
    for (const name of WANT) {
      const s = SHOTS[name];
      if (!s) { console.warn(`no shot ${name}`); continue; }
      await page.evaluate((c: unknown) => { (window as any).__capture = c; }, s);
      await sleep(WAIT * 1000);
      const file = join(OUT, `${LABEL}-${name}.png`);
      await page.screenshot({ path: file, timeout: 120_000 });
      console.log(`  ${file}`);
    }
    await ctx.close();
  } finally {
    await browser.close().catch(() => {});
    for (const wk of workers) await wk.terminate();
    proc.kill('SIGTERM');
    await sleep(500);
    if (proc.exitCode === null) proc.kill('SIGKILL');
    if (process.env.PERF_LOG) console.log(log);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
