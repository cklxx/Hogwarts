/**
 * Mac input on the real page, in headless WebKit (the engine of the macOS desktop client's WKWebView; headless, so
 * it runs with the lid closed or the screen locked, when macOS suspends every window's web view).
 *
 *   npm i --no-save playwright-core && npx playwright-core install webkit
 *   npx vite build && npx tsx scripts/mac-input.ts [--port=8850] [--playwright=<playwright-core/index.mjs>]
 *
 * Checks, on macOS (navigator.platform says Mac, so the Mac-only paths run):
 * - 拼音 input: the Enter that commits a candidate (keyCode 229, which is how WebKit reports it) does not enrol
 *   you with half a name, nor send half a chat line; the next Enter does;
 * - trackpad: two-finger scroll zooms, a sideways swipe turns the camera, a pinch zooms (ctrl+wheel, and WebKit's
 *   own gesture events); Ctrl+drag turns the camera instead of walking;
 * - ⌘ combinations never reach the game's letter keys (⌘B does not open the spellbook, ⌘V does not toggle
 *   watching), and a key whose keyup macOS swallowed while ⌘ was down stops when ⌘ goes up.
 * Exits 1 on any failure.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? '1'] as [string, string]; }));
const opt = (k: string, d: string) => args.get(k) ?? d;
const PORT = Number(opt('port', '8850'));
const PW = process.env.PLAYWRIGHT_CORE ?? opt('playwright', join(ROOT, 'node_modules/playwright-core/index.mjs'));

const data = join(mkdtempSync(join(tmpdir(), 'mac-input-')), 'world.json');
const server = spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', HOGWARTS_DATA: data, NPC_COUNT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise<void>((ok, fail) => {
  server.stdout!.on('data', (b: Buffer) => { if (String(b).includes(`:${PORT}`)) ok(); });
  server.on('exit', () => fail(new Error('server exited')));
});
let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Cam = { yaw: number; pitch: number; dist: number };
type View = { __view?: { cam: Cam; me(): { x: number; z: number } | undefined } };

try {
  const base = `http://127.0.0.1:${PORT}`;
  const { webkit } = await import(pathToFileURL(PW).href);
  const browser = await webkit.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.addInitScript('window.__name = (f) => f'); // tsx names the functions handed to evaluate() with a helper the page lacks
  page.on('pageerror', (e: Error) => console.log('pageerror', String(e).slice(0, 200)));
  check(await page.evaluate(() => /Mac/.test(navigator.platform)), 'WebKit reports a Mac (the Mac-only paths run)');
  // an IME Enter: WebKit fires compositionend first, so the keydown says isComposing false, keyCode 229
  const imeEnter = (sel: string) => page.evaluate((s: string) => {
    const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    Object.defineProperty(e, 'keyCode', { get: () => 229 });
    document.querySelector(s)!.dispatchEvent(e);
  }, sel);

  // 1. enrol with a Chinese name: the Enter that commits 拼音 does not submit the form
  await page.goto(`${base}/?debug=view`, { waitUntil: 'load' });
  await page.waitForSelector('#gate-name', { state: 'visible', timeout: 60000 });
  await page.fill('#gate-name', '赫敏');
  await imeEnter('#gate-name');
  await sleep(1500);
  check(await page.evaluate(() => !localStorage.getItem('hogwarts.token')), '拼音 Enter in the name field: not enrolled yet');
  await page.focus('#gate-name');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !!localStorage.getItem('hogwarts.token'), null, { timeout: 30000 }).catch(() => {});
  check(await page.evaluate(() => !!localStorage.getItem('hogwarts.token')), 'a real Enter enrols');
  await page.waitForFunction(() => !!(window as unknown as View).__view?.me(), null, { timeout: 120000 });
  await sleep(1500);
  const cam = () => page.evaluate(() => ({ ...(window as unknown as View).__view!.cam }));
  const me = () => page.evaluate(() => { const p = (window as unknown as View).__view!.me()!; return { x: p.x, z: p.z }; });

  // 2. chat: 拼音 Enter keeps the line, a real Enter sends it
  await page.mouse.click(640, 300); // focus the page (walks a little; fine)
  await page.keyboard.press('Enter');
  await page.waitForSelector('#chat', { state: 'visible' });
  await page.keyboard.type('你好');
  await imeEnter('#chat');
  check(await page.evaluate(() => document.activeElement?.id === 'chat' && (document.getElementById('chat') as HTMLInputElement).value === '你好'), '拼音 Enter in chat: the line stays, unsent');
  await page.keyboard.press('Enter');
  check(await page.evaluate(() => (document.getElementById('chat') as HTMLInputElement).value === '' && document.activeElement?.id !== 'chat'), 'a real Enter sends the chat line');

  // 3. trackpad over the scene
  await page.mouse.move(640, 400);
  let c0 = await cam();
  await page.mouse.wheel(0, 120);
  await sleep(100);
  let c1 = await cam();
  check(c1.dist > c0.dist && Math.abs(c1.yaw - c0.yaw) < 1e-6, `two-finger scroll zooms (${c0.dist.toFixed(2)} → ${c1.dist.toFixed(2)}), no turn`);
  c0 = c1;
  await page.mouse.wheel(-150, 4); // fingers to the right, natural scrolling
  await sleep(100);
  c1 = await cam();
  check(c1.yaw < c0.yaw - 0.1 && Math.abs(c1.dist - c0.dist) < 1e-6, `a sideways swipe turns the camera (yaw ${c0.yaw.toFixed(2)} → ${c1.yaw.toFixed(2)}), no zoom`);
  c0 = c1;
  const wheelPinch = await page.evaluate(() => {
    const cv = document.querySelector('canvas')!;
    const e = new WheelEvent('wheel', { deltaY: -40, ctrlKey: true, bubbles: true, cancelable: true, clientX: 640, clientY: 400 });
    cv.dispatchEvent(e);
    return e.defaultPrevented;
  });
  c1 = await cam();
  check(c1.dist < c0.dist && wheelPinch, `a pinch (ctrl+wheel) zooms in (${c0.dist.toFixed(2)} → ${c1.dist.toFixed(2)}) and the page itself does not zoom`);
  c0 = c1;
  const gestureStopped = await page.evaluate(() => {
    const cv = document.querySelector('canvas')!;
    const g = (type: string, scale: number) => { const e = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(e, 'scale', { get: () => scale }); cv.dispatchEvent(e); return e.defaultPrevented; };
    return g('gesturestart', 1) && g('gesturechange', 2) && g('gestureend', 2);
  });
  c1 = await cam();
  check(Math.abs(c1.dist - Math.max(3.5, c0.dist / 2)) < 1e-6 && gestureStopped, `a WebKit pinch gesture (scale 2) halves the distance (${c0.dist.toFixed(2)} → ${c1.dist.toFixed(2)})`);

  // 4. Ctrl+drag turns the camera and does not walk
  await sleep(2500);
  const p0 = await me();
  c0 = await cam();
  await page.keyboard.down('Control');
  await page.mouse.move(500, 420);
  await page.mouse.down();
  // Playwright's WebKit moves carry movementX 0, so the drag's moves are dispatched by hand (the press and the
  // release above and below are real: button 0 with ctrlKey, as a Mac sends a Ctrl+click)
  await page.evaluate(() => { for (let i = 1; i <= 8; i++) dispatchEvent(new MouseEvent('mousemove', { movementX: 25, clientX: 500 + i * 25, clientY: 420, buttons: 1, ctrlKey: true })); });
  await page.mouse.up();
  await page.keyboard.up('Control');
  await sleep(1500);
  c1 = await cam();
  const p1 = await me();
  check(c1.yaw < c0.yaw - 0.3, `Ctrl+drag turns the camera (yaw ${c0.yaw.toFixed(2)} → ${c1.yaw.toFixed(2)})`);
  check(Math.hypot(p1.x - p0.x, p1.z - p0.z) < 0.5, `…and does not walk (moved ${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(2)} m)`);

  // 5. ⌘ combinations are not game keys
  await page.keyboard.press('Meta+b');
  await page.keyboard.press('Meta+v');
  await sleep(300);
  check(await page.evaluate(() => (document.getElementById('book') as HTMLElement).hidden), '⌘B does not open the spellbook');
  check(await page.evaluate(() => !document.body.classList.contains('observing')), '⌘V does not toggle watching');

  // 6. W held, ⌘ pressed, W released under ⌘ (macOS sends no keyup), ⌘ released: the wizard stops. Judged by the
  // movement the page sends (input dx/dz, every 0.25 s), not by position: a wall may stop the wizard anyway
  if (await page.evaluate(() => document.body.classList.contains('observing'))) await page.keyboard.press('v'); // walking needs control
  let lastMove: number;
  await page.evaluate(() => {
    const ws = WebSocket.prototype.send;
    (window as unknown as { __moves: number[] }).__moves = [];
    WebSocket.prototype.send = function (this: WebSocket, data: string) {
      try { const m = JSON.parse(data); if (m.t === 'input') (window as unknown as { __moves: number[] }).__moves.push(Math.hypot(m.dx, m.dz)); } catch { /* not JSON */ }
      return ws.call(this, data);
    };
  });
  const moving = async () => page.evaluate(() => { const m = (window as unknown as { __moves: number[] }).__moves; return m.length ? m[m.length - 1] : -1; });
  await page.keyboard.down('w');
  await sleep(700);
  lastMove = await moving();
  check(lastMove > 0.5, `W held: the page sends movement (${lastMove.toFixed(2)})`);
  await page.keyboard.down('Meta');
  await page.keyboard.up('Meta'); // no keyup for w: the one macOS would have swallowed
  await sleep(700);
  lastMove = await moving();
  check(lastMove === 0, `a key released under ⌘ does not stay held: after ⌘ goes up the page sends no movement (${lastMove.toFixed(2)})`);
  await page.keyboard.up('w');
  await browser.close();
} catch (e) {
  console.log('FAIL', e);
  fails++;
} finally {
  server.kill('SIGTERM');
}
process.exit(fails ? 1 : 0);
