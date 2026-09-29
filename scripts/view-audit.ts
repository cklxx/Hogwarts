/**
 * Can you always see your wizard? The camera audit of client/view.ts, on the real scene in headless Chromium.
 *
 *   npx vite build && npx tsx scripts/view-audit.ts [--port=8840] [--n=500] [--seed=11] [--q=high|low]
 *        [--min=99] [--chromium=/opt/pw-browsers/chromium] [--playwright=<playwright-core/index.mjs>]
 *
 * Starts `src/server/main.ts` on a scratch world, opens the client with `?debug=view`, and runs
 * `window.__view.audit(n, seed)` twice: with the camera as it is (spring arm, occluder fading) and as it was
 * before view.ts. Each of the n samples puts a wizard somewhere around the castle, in the Great Hall, round
 * Hogsmeade or in the Forest, with a random yaw, pitch and zoom; a fresh rig runs for 1.5 s; then rays go from
 * the camera to the wizard's head, chest and knees through the scene's own static meshes (merged batches,
 * instanced trees, the terrain), letting a ray on through what the fade dithers away there. Prints the share of
 * samples where the head or chest is seen, and exits 1 below `--min` percent.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? '1'] as [string, string]; }));
const opt = (k: string, d: string) => args.get(k) ?? d;
const PORT = Number(opt('port', '8840')), N = Number(opt('n', '500')), SEED = Number(opt('seed', '11')), Q = opt('q', 'high'), MIN = Number(opt('min', '99'));
const PW = process.env.PLAYWRIGHT_CORE ?? opt('playwright', '/tmp/claude-0/-home-user-Hogwarts/f6d5f4cd-c14a-5196-b6e5-05eb73ec4d18/scratchpad/node_modules/playwright-core/index.mjs');
const CHROMIUM = opt('chromium', process.env.CHROMIUM ?? '/opt/pw-browsers/chromium');

const data = join(mkdtempSync(join(tmpdir(), 'view-audit-')), 'world.json');
const server = spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), HOGWARTS_DATA: data }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise<void>((ok, fail) => {
  server.stdout!.on('data', (b: Buffer) => { if (String(b).includes(`:${PORT}`)) ok(); });
  server.on('exit', () => fail(new Error('server exited')));
});
let code = 0;
try {
  const base = `http://127.0.0.1:${PORT}`;
  const { token } = (await (await fetch(`${base}/api/enroll`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Audit' + Math.floor(Math.random() * 900 + 100) }) })).json()) as { token: string };
  const { chromium } = await import(pathToFileURL(PW).href);
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await page.goto(`${base}/?q=${Q}&debug=view#k=${encodeURIComponent(token)}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window as unknown as { __view?: { me(): unknown } }).__view?.me(), null, { timeout: 300000 });
  type Report = { n: number; pct: number; pctNoFade: number; head: number; chest: number; knees: number; fadeOn: number; byArea: Record<string, [number, number]>; misses: unknown[]; ms: number };
  const run = (old: boolean) => page.evaluate(([n, seed, old]: [number, number, boolean]) => (window as unknown as { __view: { audit(n: number, s: number, o: boolean): Report } }).__view.audit(n, seed, old), [N, SEED, old] as [number, number, boolean]) as Promise<Report>;
  const now = await run(false), before = await run(true);
  const row = (name: string, r: Report) => console.log(`${name.padEnd(8)} seen ${String(r.pct).padStart(5)} %  (head ${r.head}, chest ${r.chest}, knees ${r.knees} of ${r.n}; without the fade ${r.pctNoFade} %; fade on in ${r.fadeOn})  ` +
    Object.entries(r.byArea).map(([a, [n, ok]]) => `${a} ${ok}/${n}`).join(', ') + `  [${r.ms} ms]`);
  console.log(`camera audit: ${N} samples, seed ${SEED}, q=${Q}`);
  row('now', now);
  row('before', before);
  if (now.misses.length) console.log('missed:', JSON.stringify(now.misses, null, 1));
  if (now.pct < MIN) { console.log(`FAIL: below ${MIN} %`); code = 1; }
  await browser.close();
} finally {
  server.kill();
}
process.exit(code);
