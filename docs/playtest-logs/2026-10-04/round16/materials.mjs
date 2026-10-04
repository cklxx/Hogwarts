// Production build, real browser login and legal movement. The server uses an isolated, private
// saved-world fixture reset to noon (or night) before each run; never archive its credentials.
import fs from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const { chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const origin = process.env.GAME_URL || 'http://127.0.0.1:7777';
const label = process.env.LABEL || 'before';
const out = process.env.SCREEN_OUT || '/tmp/materials';
const state = process.env.PRIVATE_STATE;
if (!state) throw Error('PRIVATE_STATE must name a credential file outside the repository');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
let client, transport;
try {
  const context = await browser.newContext({ viewport: { width: 900, height: 600 }, storageState: state });
  const page = await context.newPage();
  const errors = [], shaderErrors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (/THREE.WebGLProgram|VALIDATE_STATUS|shader error/i.test(m.text())) shaderErrors.push(m.text()); });
  await page.goto(origin + '/?capture=1&perf=1&q=high' + (process.env.STYLE === 'real' ? '&style=real' : ''), { waitUntil: 'domcontentloaded' });
  await page.locator('#veil').waitFor({ state: 'hidden', timeout: 120000 });
  await page.locator('#gate').waitFor({ state: 'hidden', timeout: 120000 });
  if (await page.locator('.tut-skip').isVisible()) await page.locator('.tut-skip').click();
  const token = await page.evaluate(() => localStorage.getItem('hogwarts.token'));
  client = new Client({ name: 'material-study', version: '1' });
  transport = new StreamableHTTPClientTransport(new URL('/mcp', origin), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  await client.connect(transport);
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    if (r.isError) throw Error(`Game action failed: ${name}`);
    return JSON.parse(r.content.filter(c => c.type === 'text').map(c => c.text).join('\n'));
  };
  const result = { label, renderer: 'ANGLE / SwiftShader software renderer', errors, shaderErrors, movement: [], shots: [], menu: false };
  // Walk away first so wait can observe an actual route, rather than an already-nearby goal
  // that can complete before the MCP wait request begins.
  for (const z of [-50, -46]) {
    await call('move_to', { x: 0, z });
    const arrival = await call('wait', { until: 'arrived', seconds: 20 });
    result.movement.push(arrival.reason);
    if (arrival.reason !== 'arrived') {
      await fs.writeFile(`${out}/${label}-navigation-failure.json`, JSON.stringify({ label, target: { x: 0, z }, reason: arrival.reason }));
      throw Error(`Did not arrive in the hall: ${arrival.reason}`);
    }
  }
  await page.locator('#prompt').waitFor({ state: 'visible', timeout: 60000 });
  await page.addStyleTag({ content: '#perf { display: none }' });
  const shots = [
    ['hall', { pos: [0, 11, -58], look: [0, 1, -46] }, [900, 600]],
    ['castle', { pos: [26, 19, 5], look: [0, 10, -48] }, [900, 600]],
    ['phone', { pos: [0, 11, -58], look: [0, 1, -46] }, [390, 844]],
  ].filter(s => !process.env.SHOTS || process.env.SHOTS.split(',').includes(s[0]));
  for (const [name, camera, size] of shots) {
    await page.setViewportSize({ width: size[0], height: size[1] });
    await page.evaluate(shot => { window.__capture = shot; }, camera);
    await page.waitForTimeout(3500);
    // Require enough rendered samples even when the software renderer is very slow.
    await page.evaluate(() => window.__perf.reset());
    await page.waitForFunction(n => window.__perf.frames.length >= n, Number(process.env.SAMPLES || 20), { timeout: 90000 });
    const perf = await page.evaluate(() => ({ frames: window.__perf.frames.map(f => ({ dt: f.dt, calls: f.calls, tris: f.tris })), info: window.__perf.info(), scale: window.__perf.scale(), travel: window.__perf.detail('travel') }));
    await page.screenshot({ path: `${out}/${label}-${name}.png` });
    const time = (await call('look', { radius: 1 })).time;
    result.shots.push({ name, camera, viewport: size, time, perf });
  }
  await page.keyboard.press('f');
  await page.locator('#floo').waitFor({ state: 'visible' });
  result.destinations = await page.locator('#floo [data-to]:not([data-to=""])').count();
  await page.keyboard.press('Escape');
  await page.locator('#floo').waitFor({ state: 'detached' });
  result.menu = true;
  if (errors.length || shaderErrors.length) throw Error('Browser or shader errors');
  await fs.writeFile(`${out}/${label}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ label, movement: result.movement, destinations: result.destinations, shots: result.shots.map(s => ({ name: s.name, samples: s.perf.frames.length, info: s.perf.info })), errors, shaderErrors }));
} finally {
  await transport?.terminateSession().catch(() => {});
  await client?.close().catch(() => {});
  await browser.close();
}
