// A phone for an agent playtester: one headless touch phone (390×844) on the game, driven over local HTTP so an
// agent can look (a screenshot it reads) and act (the stick, taps, buttons) like a person with a phone.
//
//   node scripts/playtest/phone.mjs --port=7901 --url=http://127.0.0.1:7831/?view=top --out=/tmp/p1 \
//        --playwright=<playwright-core/index.mjs> [--chromium=/opt/pw-browsers/chromium]
//
//   GET /enroll?name=Luna          board the train (the gate), then /shot
//   GET /shot                      screenshot → {png, text}: the file to look at, and the visible words
//   GET /stick?dx=0&dy=-1&ms=1500  push the stick (dx right +, dy down +; -1..1) for ms, then let go
//   GET /tap?x=195&y=400           tap a point (CSS pixels, 390 wide × 844 tall)
//   GET /btn?id=tb-tab             tap an element by id (tb-tab target, tb-act interact, tb-book, tb-zin, tb-zout,
//                                  tb-more, tb-menu, tb-owl, tb-trunk, tb-chat, tb-help, tb-view, tb-roll)
//   GET /slot?n=1                  tap hotbar slot n (1..6)
//   GET /say?text=hello            open chat, type, send
//   GET /wait?ms=2000              let time pass
// Every action answers with a fresh screenshot too. Never prints a key.
import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const s = a.replace(/^--/, ''), i = s.indexOf('='); return i < 0 ? [s, '1'] : [s.slice(0, i), s.slice(i + 1)]; }));
const PORT = Number(args.port ?? 7901), URL0 = args.url ?? 'http://127.0.0.1:7777/', OUT = args.out ?? '/tmp/phone';
const { chromium } = await import(args.playwright ?? process.env.PLAYWRIGHT_CORE);
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: args.chromium ?? '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
const cdp = await page.context().newCDPSession(page);
await page.goto(URL0, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#gate-name', { timeout: 120000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;

async function shot() {
  const png = join(OUT, `s${String(++n).padStart(4, '0')}.png`);
  await page.screenshot({ path: png });
  const text = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05; };
    const out = [];
    for (const el of document.querySelectorAll('body *')) { if (!vis(el) || el.children.length) continue; const t = el.textContent.trim(); if (t.length > 1) out.push(t); }
    return [...new Set(out)].join(' | ').slice(0, 1500);
  });
  return { png, text };
}
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
async function stick(dx, dy, ms) {
  const box = await page.evaluate(() => { const r = document.getElementById('stick').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const l = Math.hypot(dx, dy) || 1, R = 50;
  await touch('touchStart', box.x, box.y);
  for (let t = 0; t < ms; t += 100) { await touch('touchMove', box.x + (dx / l) * R, box.y + (dy / l) * R); await sleep(100); }
  await touch('touchEnd', 0, 0);
}
async function tapAt(x, y) { await touch('touchStart', x, y); await sleep(60); await touch('touchEnd', 0, 0); }
async function tapId(id) {
  const c = await page.evaluate((i) => { const el = document.getElementById(i); if (!el) return null; const r = el.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; }, id);
  if (!c) return false;
  await page.tap(`#${id}`).catch(() => tapAt(c.x, c.y));
  return true;
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), q = (k, d) => u.searchParams.get(k) ?? d;
  let note = '';
  try {
    switch (u.pathname) {
      case '/enroll': await page.fill('#gate-name', q('name', 'Phone Kid')); await page.click('#gate-go'); await sleep(6000); break;
      case '/shot': break;
      case '/stick': await stick(Number(q('dx', 0)), Number(q('dy', -1)), Math.min(8000, Number(q('ms', 1000)))); await sleep(300); break;
      case '/tap': await tapAt(Number(q('x', 195)), Number(q('y', 400))); await sleep(600); break;
      case '/btn': note = (await tapId(q('id', ''))) ? '' : `no visible #${q('id', '')}`; await sleep(700); break;
      case '/slot': { const i = Math.max(1, Math.min(6, Number(q('n', 1)))); await page.tap(`#hotbar > div:nth-child(${i})`).catch(() => { note = 'no such slot'; }); await sleep(900); break; }
      case '/say': await tapId('tb-more'); await sleep(300); await tapId('tb-chat'); await sleep(300); await page.keyboard.type(q('text', '')); await page.keyboard.press('Enter'); await sleep(600); break;
      case '/wait': await sleep(Math.min(20000, Number(q('ms', 2000)))); break;
      default: res.writeHead(404); res.end('unknown'); return;
    }
    const s = await shot();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ...s, ...(note ? { note } : {}) }));
  } catch (e) { res.writeHead(500); res.end(String(e.message)); }
}).listen(PORT, '127.0.0.1', () => console.log(`phone on http://127.0.0.1:${PORT}  (${URL0})`));
