/**
 * Offline, deterministic renderer for the promo film (docs/promo/hogwarts-promo.mp4).
 *
 *   npx tsx scripts/promo/render.ts [--fps 24] [--size 1280x720] [--workers 2] [--only id,id] [--keep]
 *
 * 1. stages the cast with the kernel (sim.ts) and writes it as a world save;
 * 2. builds the client and starts the real server on that save (a free port in 8500-8519);
 * 3. records every shot as a tape of snapshots on a virtual clock (sim.ts, story.ts);
 * 4. opens headless Chromium on `/?capture=1`, with inpage.js replacing the clock, requestAnimationFrame
 *    and the socket, and steps the game exactly 1/fps seconds per frame while the camera flies the shot
 *    (client/capture.ts) and the captions are drawn as HTML over the canvas; each frame is a screenshot;
 * 5. joins the shots with cross-fades, the original score (music.ts) and H.264 (ffmpeg from imageio-ffmpeg or $FFMPEG).
 *
 * No GPU needed (SwiftShader); a frame takes seconds, which is why nothing here runs in real time.
 */
import { writeScore } from './music.js';
import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { record, stage, welcome, type Tape } from './sim.js';
import { ACTORS, CSS, FONTS, SHOTS, XFADE, allText, type Shot } from './story.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k: string) => process.argv.includes(`--${k}`);
const FPS = Number(arg('fps', '24'));
const [W, H] = arg('size', '1280x720').split('x').map(Number);
const WORKERS = Math.max(1, Number(arg('workers', '2')));
const ONLY = arg('only', '').split(',').filter(Boolean);
/** Look-development: draw only every Nth frame (the others are stepped, not drawn). */
const EVERY = Math.max(1, Number(arg('every', '1')));
const LOCAL_FONTS = flag('local-fonts');
const RESUME = flag('resume');
const WORK = resolve(arg('work', join(ROOT, 'data/promo')));
const OUT = resolve(arg('out', join(ROOT, 'docs/promo')));
const PREROLL = 2.5; // seconds of each shot played (not drawn) before its first frame: models settle, old sparks die
const log = (...a: unknown[]) => console.log(`[promo ${new Date().toISOString().slice(11, 19)}]`, ...a);

/** The little of Playwright this uses (playwright-core is not a dependency of the game: see README.md). */
interface PwPage {
  on(ev: 'pageerror', cb: (e: Error) => void): void;
  addInitScript(o: { content: string }): Promise<void>;
  goto(url: string, o?: object): Promise<unknown>;
  waitForFunction(expr: string, arg?: unknown, o?: object): Promise<unknown>;
  addStyleTag(o: { content?: string; url?: string }): Promise<unknown>;
  evaluate<R, A>(fn: (a: A) => R | Promise<R>, arg: A): Promise<R>;
  waitForLoadState(s: string): Promise<void>;
  screenshot(o: { path: string; type: 'png'; timeout?: number }): Promise<unknown>;
}
interface PwRoute {
  request(): { url(): string; headers(): Record<string, string> };
  fulfill(o: { status: number; body: Buffer; contentType: string; headers?: Record<string, string> }): Promise<void>;
  abort(): Promise<void>;
}
interface PwContext { newPage(): Promise<PwPage>; route(url: RegExp, handler: (r: PwRoute) => Promise<void>): Promise<void> }
interface PwBrowser { newContext(o: object): Promise<PwContext>; close(): Promise<void> }
interface PwChromium { launch(o: object): Promise<PwBrowser> }

async function loadPlaywright(): Promise<PwChromium> {
  const p = process.env.PLAYWRIGHT_CORE;
  const spec = p ? pathToFileURL(p).href : 'playwright-core';
  const mod = await import(spec).catch(() => null);
  if (!mod) throw new Error('playwright-core not found: `npm i --no-save playwright-core`, or set PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs');
  return mod.chromium ?? mod.default.chromium;
}
function ffmpegBin() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  try { return execFileSync('python3', ['-c', 'import imageio_ffmpeg as i; print(i.get_ffmpeg_exe())']).toString().trim(); } catch { return 'ffmpeg'; }
}
async function freePort(): Promise<number> {
  for (let p = 8500; p <= 8519; p++) {
    const ok = await new Promise<boolean>((done) => {
      const s = createServer().once('error', () => done(false)).once('listening', () => s.close(() => done(true)));
      s.listen(p, '127.0.0.1');
    });
    if (ok) return p;
  }
  throw new Error('no free port in 8500-8519');
}

// ------------------------------------------------------------------ the server
async function startServer(save: unknown, port: number): Promise<ChildProcess> {
  const data = join(WORK, 'world.json');
  writeFileSync(data, JSON.stringify(save));
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', HOGWARTS_DATA: data, NPC_COUNT: '0', PUBLIC_URL: `http://127.0.0.1:${port}` },
  });
  child.stderr!.on('data', (d) => process.stderr.write(`[server] ${d}`));
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw new Error('server exited');
    const ok = await fetch(`http://127.0.0.1:${port}/api/leaderboard`).then((r) => r.ok).catch(() => false);
    if (ok) return child;
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill('SIGTERM');
  throw new Error('server did not come up');
}

// ------------------------------------------------------------------ web fonts, fetched once (with retries) and kept in data/promo/fonts
const run = promisify(execFile);
async function fontFromCache(route: PwRoute) {
  const url = route.request().url();
  const dir = join(WORK, 'fonts');
  const file = join(dir, createHash('sha1').update(url).digest('hex'));
  try {
    if (!existsSync(file)) {
      mkdirSync(dir, { recursive: true });
      const part = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}`;
      // curl honours $HTTPS_PROXY; the CSS depends on the browser's user agent (it picks woff2 and unicode ranges)
      await run('curl', ['-sSfL', '--retry', '8', '--retry-all-errors', '--retry-delay', '1', '-m', '60', '-A', route.request().headers()['user-agent'] ?? 'Mozilla/5.0', '-o', part, url]);
      renameSync(part, file);
    }
    await route.fulfill({ status: 200, body: readFileSync(file), contentType: url.includes('googleapis') ? 'text/css' : 'font/woff2', headers: { 'access-control-allow-origin': '*' } });
  } catch (e) {
    log('font fetch failed:', url, (e as Error).message);
    await route.abort();
  }
}

// ------------------------------------------------------------------ one browser renders a list of shots
interface Job { shot: Shot; tape: Tape; frames: number; dir: string }

async function worker(n: number, jobs: Job[], port: number, token: string, hello: string) {
  const chromium = await loadPlaywright();
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium',
    args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, ignoreHTTPSErrors: true, locale: 'zh-CN' });
    await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, fontFromCache);
    const page = await ctx.newPage();
    page.on('pageerror', (e: Error) => log(`w${n} page error:`, e.message));
    await page.addInitScript({ content: readFileSync(join(HERE, 'inpage.js'), 'utf8') });
    // the key goes after '#', like an agent's enrol link: the page logs in as the director
    await page.goto(`http://127.0.0.1:${port}/?capture=1&q=high#k=${encodeURIComponent(token)}`, { waitUntil: 'load' });
    await page.waitForFunction('window.__ready && window.__ready()', undefined, { timeout: 300_000 }); // SwiftShader under load can take minutes
    await page.addStyleTag({ content: CSS });
    // every browser must get the same faces (a flaky fetch would mix fonts between shots): retry, then refuse
    let fonts = !FONTS || LOCAL_FONTS;
    for (let i = 0; i < 6 && !fonts; i++) {
      fonts = await page.addStyleTag({ url: FONTS }).then(() => true, () => false);
      if (!fonts) await new Promise((r) => setTimeout(r, 3000));
    }
    if (!fonts) throw new Error('web fonts unreachable; pass --local-fonts to render with the local CJK fonts');
    // the caption layer (designed at 1280x720, scaled to the frame) and every caption once, invisibly, so the
    // web fonts fetch all their glyphs before the first frame
    const step = (d: number, m: string[], c: object | null) => page.evaluate(([a, b, x]: [number, string[], object | null]) => (window as any).__step(a, b, x), [d, m, c]);
    await page.evaluate(([scale, text]: [number, string]) => {
      const d = document.createElement('div'); d.id = 'promo'; d.className = 'promo'; d.style.transform = `scale(${scale})`; document.body.append(d);
      const pre = document.createElement('div'); pre.id = 'promo-glyphs'; pre.style.cssText = 'position:fixed;left:0;top:0;opacity:0.01;pointer-events:none';
      pre.innerHTML = `<div class="promo" style="position:static">${text}</div>`; document.body.append(pre);
    }, [H / 720, allText()]);
    await step(0.001, [hello], null);
    await page.evaluate(() => document.fonts.ready.then(() => true), null);
    for (let i = 0; FONTS && !LOCAL_FONTS; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      // load every face the captions use for every character they contain, then check that it took
      const ok = await page.evaluate(async () => {
        const text = document.getElementById('promo-glyphs')!.textContent!.replace(/\s+/g, '');
        const faces = ['400 40px "Ma Shan Zheng"', '500 18px "Noto Serif SC"', '700 40px "Noto Serif SC"', '500 15px "Cinzel"', '700 15px "Cinzel"'];
        await Promise.all(faces.map((f) => document.fonts.load(f, text).catch(() => [])));
        return faces.every((f) => document.fonts.check(f, text));
      }, null);
      if (ok) break;
      if (i >= 60) throw new Error('web font glyphs did not load; pass --local-fonts to render with the local CJK fonts');
    }
    await page.evaluate(() => document.getElementById('promo-glyphs')!.remove(), null);
    // textures and HDRIs load in real time: give them a moment, then warm the shaders up with a few drawn frames
    await page.waitForLoadState('networkidle').catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
    for (const job of jobs) {
      const { shot, tape } = job;
      mkdirSync(job.dir, { recursive: true });
      const frame = (f: number) => join(job.dir, `${String(f).padStart(5, '0')}.png`);
      // --resume: frames already on disk are stepped through, not drawn again (the film is deterministic per shot)
      let have = 0;
      if (RESUME) while (have < job.frames && existsSync(frame(have))) have++;
      if (have === job.frames) { log(`w${n} ${shot.id}: all ${have} frames already rendered`); continue; }
      // particles draw from Math.random: reseed per shot, so a shot looks the same whichever browser renders it
      await page.evaluate((x: number) => (window as any).__seed(x), [...shot.id].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261));
      const dt = 1 / FPS;
      let ti = 0;
      const take = (upTo: number) => { const out: string[] = []; while (ti < tape.length && tape[ti].t <= upTo + 1e-9) out.push(tape[ti++].m); return out; };
      // pre-roll: the shot's first seconds of tape at the frame rate, not drawn (the last few are, to warm up)
      const pre = Math.round(PREROLL * FPS);
      for (let k = 0; k < pre; k++) {
        const t = -PREROLL + k * dt;
        const cam = shot.camera(Math.max(0, t));
        await step(dt, take(t), { ...cam, skip: k < pre - 2 });
      }
      let lastHtml = '';
      const t0 = Date.now();
      for (let f = 0; f < job.frames; f++) {
        const t = f * dt;
        const cam = shot.camera(t);
        if (f % EVERY || f < have) { await step(dt, take(t), { ...cam, skip: true }); continue; }
        const html = shot.overlay?.(t) ?? '';
        if (html !== lastHtml) { await page.evaluate((h: string) => { document.getElementById('promo')!.innerHTML = h; }, html); lastHtml = html; }
        await step(dt, take(t), cam);
        // (a loaded machine can take minutes per frame: no timeout)
        await page.screenshot({ path: frame(f), type: 'png', timeout: 0 });
        if (f % 24 === 23 || f === job.frames - 1) {
          const per = (Date.now() - t0) / (f + 1 - have) / 1000;
          log(`w${n} ${shot.id} ${f + 1}/${job.frames}  ${per.toFixed(2)} s/frame`);
        }
      }
      await page.evaluate(() => { document.getElementById('promo')!.innerHTML = ''; }, null);
    }
  } finally {
    await browser.close();
  }
}

/** Frames of a job still to draw (with --resume, the ones not on disk yet). */
function todo(j: Job) {
  if (!RESUME) return j.frames;
  let have = 0;
  while (have < j.frames && existsSync(join(j.dir, `${String(have).padStart(5, '0')}.png`))) have++;
  return j.frames - have;
}
/** Split the jobs over the workers so each gets about the same number of frames to draw (shots stay whole). */
function share(jobs: Job[], n: number): Job[][] {
  const bins: Job[][] = Array.from({ length: n }, () => []);
  const load = new Array(n).fill(0);
  for (const j of jobs.filter((x) => todo(x) > 0).sort((a, b) => todo(b) - todo(a))) {
    const i = load.indexOf(Math.min(...load));
    bins[i].push(j); load[i] += todo(j);
  }
  for (const b of bins) b.sort((a, c) => jobs.indexOf(a) - jobs.indexOf(c));
  return bins.filter((b) => b.length);
}

// ------------------------------------------------------------------ the cut
function encode(jobs: Job[]) {
  const ff = ffmpegBin();
  const inputs: string[] = [];
  for (const j of jobs) inputs.push('-framerate', String(FPS), '-i', join(j.dir, '%05d.png'));
  const durs = jobs.map((j) => j.frames / FPS);
  const total = durs.reduce((a, b) => a + b, 0) - XFADE * (jobs.length - 1);
  // cross-fade the shots: shot i is rendered XFADE seconds longer than it is on screen alone
  let chain = '';
  let prev = '[0:v]';
  let offset = 0;
  for (let i = 1; i < jobs.length; i++) {
    offset += durs[i - 1] - XFADE;
    const out = i === jobs.length - 1 ? '[vx]' : `[x${i}]`;
    chain += `${prev}[${i}:v]xfade=transition=fade:duration=${XFADE}:offset=${offset.toFixed(4)}${out};`;
    prev = out;
  }
  if (jobs.length === 1) chain = '[0:v]null[vx];';
  // fade in from and out to black; under it the score (scripts/promo/music.ts), with an accent on every cut
  const v = `${chain}[vx]fade=t=in:st=0:d=0.8,fade=t=out:st=${(total - 1.2).toFixed(3)}:d=1.2,format=yuv420p[v]`;
  const cuts: number[] = [];
  let at = 0;
  for (const j of jobs.slice(0, -1)) { at += j.shot.dur; cuts.push(at); }
  const wavPath = join(WORK, 'score.wav');
  writeScore(wavPath, total, cuts);
  inputs.push('-i', wavPath);
  const audio = `[${jobs.length}:a]loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:st=0:d=0.4,afade=t=out:st=${(total - 2.5).toFixed(3)}:d=2.5[a]`;
  const out = join(OUT, 'hogwarts-promo.mp4');
  mkdirSync(OUT, { recursive: true });
  execFileSync(ff, ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', `${v};${audio}`, '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', arg('crf', '26'), '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-shortest', out], { stdio: 'inherit' });
  return { out, total };
}

/**
 * The README's moving preview (GitHub will not play an mp4 from the repository): a few seconds of each of the
 * film's best moments (the title, the Runes, Quidditch, the end card), 480 px, 10 fps, one shared palette.
 */
function previewGif(jobs: Job[], film: string) {
  const ff = ffmpegBin();
  const starts: Record<string, number> = {};
  let at = 0;
  for (const j of jobs) { starts[j.shot.id] = at; at += j.shot.dur; }
  const clips = ([['castle', 1.2, 3.2], ['code', 0.6, 3.4], ['quidditch', 1.0, 3.2], ['end', 1.2, 3.0]] as const).filter(([id]) => id in starts);
  const parts = clips.map(([id, from, len], i) => `[0:v]trim=start=${(starts[id] + from).toFixed(3)}:duration=${len},setpts=PTS-STARTPTS,fps=10,scale=480:-2:flags=lanczos[c${i}]`);
  const graph = `${parts.join(';')};${clips.map((_, i) => `[c${i}]`).join('')}concat=n=${clips.length}:v=1:a=0,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`;
  const out = join(OUT, 'preview.gif');
  execFileSync(ff, ['-y', '-loglevel', 'error', '-i', film, '-filter_complex', graph, '-loop', '0', out]);
  return out;
}

function poster(jobs: Job[]) {
  const ff = ffmpegBin();
  const j = jobs.find((x) => x.shot.poster !== undefined) ?? jobs[0];
  const f = Math.min(j.frames - 1, Math.round((j.shot.poster ?? 0) * FPS));
  const out = join(OUT, 'poster.jpg');
  execFileSync(ff, ['-y', '-loglevel', 'error', '-i', join(j.dir, `${String(f).padStart(5, '0')}.png`), '-q:v', '3', out]);
  return out;
}

// ------------------------------------------------------------------ main
async function main() {
  const began = Date.now();
  mkdirSync(WORK, { recursive: true });
  if (!flag('no-build')) { log('building the client'); execFileSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'ignore' }); }
  const staged = stage(ACTORS);
  const shots = SHOTS.filter((s) => !ONLY.length || ONLY.includes(s.id));
  const jobs: Job[] = shots.map((shot, i) => {
    const tail = i < shots.length - 1 && !ONLY.length ? XFADE : 0;
    return { shot, tape: record(staged, shot, PREROLL + 0.5, tail + 0.5), frames: Math.round((shot.dur + tail) * FPS), dir: join(WORK, 'frames', shot.id) };
  });
  log(`${jobs.length} shots, ${jobs.reduce((a, j) => a + j.frames, 0)} frames at ${W}x${H} ${FPS} fps on ${WORKERS} browser(s)`);
  if (!flag('encode-only')) {
    const port = await freePort();
    const server = await startServer(staged.save, port);
    log(`server on :${port} (pid ${server.pid})`);
    try {
      await Promise.all(share(jobs, WORKERS).map((b, n) => worker(n, b, port, staged.token, welcome(staged))));
    } finally {
      if (server.pid) process.kill(server.pid, 'SIGTERM'); // by PID: never by name
    }
  }
  const rendered = (Date.now() - began) / 1000;
  if (flag('no-video') || ONLY.length) { log(`frames in ${WORK}/frames (${rendered.toFixed(0)} s)`); return; }
  const { out, total } = encode(jobs);
  const pst = poster(jobs);
  const gif = previewGif(jobs, out);
  log(`preview ${gif} (${(statSync(gif).size / 1e6).toFixed(1)} MB)`);
  log(`${out}: ${total.toFixed(1)} s, ${(statSync(out).size / 1e6).toFixed(2)} MB; poster ${pst}; ${((Date.now() - began) / 60000).toFixed(1)} min in all`);
  if (!flag('keep')) rmSync(join(WORK, 'frames'), { recursive: true, force: true });
}

main().catch((e) => { console.error(e); process.exit(1); });

