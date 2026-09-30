/**
 * The client performance pass (docs/PERF.md "Client"): the parts that can be checked without a GPU.
 */
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mergeStatic } from '../client/batch';
import { createDynRes } from '../client/dynres';
import { createLightBudget } from '../client/lights';
import { makeTerrain, rayGround } from '../client/terrain';
import { serveStatic } from '../src/server/static';

describe('rayGround (controls: the pointer on the terrain)', () => {
  const t = makeTerrain(new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial());
  const ground = t.ground as THREE.Mesh;
  ground.updateMatrixWorld(true);
  const rc = new THREE.Raycaster();
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 5000);
  it('finds the same point as raycasting the mesh, much faster', () => {
    let rnd = 7;
    const r = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
    const out = new THREE.Vector3();
    let n = 0, tRay = 0, tMarch = 0;
    for (let i = 0; i < 300; i++) {
      const x = (r() - 0.5) * 400, z = (r() - 0.5) * 400;
      cam.position.set(x, 30 + r() * 20, z);
      cam.lookAt(x + (r() - 0.5) * 60, 0, z + (r() - 0.5) * 60);
      cam.updateMatrixWorld();
      rc.setFromCamera(new THREE.Vector2(r() * 2 - 1, r() * 2 - 1), cam);
      let t0 = performance.now();
      const hits = rc.intersectObject(ground, false);
      tRay += performance.now() - t0;
      t0 = performance.now();
      const ok = rayGround(rc.ray, out);
      tMarch += performance.now() - t0;
      if (!hits.length) continue;
      n++;
      expect(ok).toBe(true);
      expect(out.distanceTo(hits[0].point)).toBeLessThan(0.05);
    }
    if (process.env.FAST_LOG) console.log(`rayGround: ${n} hits, raycast ${(tRay / 300).toFixed(3)} ms/ray, march ${(tMarch / 300).toFixed(4)} ms/ray`);
    expect(n).toBeGreaterThan(100);
    expect(tMarch).toBeLessThan(tRay / 10);
  });
});

describe('mergeStatic (batch.ts)', () => {
  it('merges what never changes, per material, and leaves anything that moves, hides or swaps alone', () => {
    const scene = new THREE.Scene();
    const a = new THREE.MeshStandardMaterial(), b = new THREE.MeshStandardMaterial();
    const box = new THREE.BoxGeometry(1, 1, 1);
    const still = [0, 1, 2, 3].map((i) => { const m = new THREE.Mesh(box, a); m.position.set(i * 3, 0, 0); return m; });
    const other = [0, 1].map((i) => { const m = new THREE.Mesh(box, b); m.position.set(i * 3, 5, 0); return m; });
    const spinner = new THREE.Mesh(box, a);
    const blinker = new THREE.Mesh(box, a);
    const group = new THREE.Group();
    const child = new THREE.Mesh(box, a); // moves with its parent
    group.add(child);
    const swapper: THREE.Mesh<THREE.BufferGeometry> = new THREE.Mesh(box, a);
    scene.add(...still, ...other, spinner, blinker, group, swapper);
    const r = mergeStatic(scene, [...scene.children], (step) => {
      spinner.rotation.y = 1; step();
      blinker.visible = false; step(); blinker.visible = true;
      group.position.x = 4; step();
      swapper.geometry = new THREE.SphereGeometry(); step();
    });
    expect(r.moving).toBe(4);
    expect(r.merged).toBe(6); // 4 + 2
    expect(r.meshes).toBe(2);
    for (const m of [...still, ...other]) expect(m.parent).toBeNull();
    for (const m of [spinner, blinker, child, swapper]) expect(m.parent).not.toBeNull();
    const merged = r.group.children as THREE.Mesh[];
    expect(merged.map((m) => m.material).sort()).toEqual([a, b].sort());
    // baked in world space: the box at x = 9 is there
    const withA = merged.find((m) => m.material === a)!;
    withA.geometry.computeBoundingBox();
    expect(withA.geometry.boundingBox!.max.x).toBeCloseTo(9.5);
  });
});

describe('createLightBudget (lights.ts)', () => {
  it('shows a fixed number of real lights: the lit sources nearest the focus', () => {
    const scene = new THREE.Scene();
    Array.from({ length: 20 }, (_, i) => { const l = new THREE.PointLight(0xffffff, i === 3 ? 0 : 10, 14); l.position.set(i * 10, 1, 0); scene.add(l); return l; });
    const budget = createLightBudget(scene, 4);
    budget.adopt(scene);
    const visible = () => { const v: THREE.PointLight[] = []; scene.traverseVisible((o) => { if ((o as THREE.PointLight).isPointLight) v.push(o as THREE.PointLight); }); return v; };
    expect(visible()).toHaveLength(4);
    budget.update(new THREE.Vector3(0, 0, 0));
    const lit = visible().filter((l) => l.intensity > 0).map((l) => l.position.x).sort((x, y) => x - y);
    expect(lit).toEqual([0, 10, 20, 40]); // (30 is dark)
    // a source added later (a wand) joins, removing it frees its slot, and the count never changes
    const wand = new THREE.PointLight(0xfff2c0, 30, 14);
    wand.position.set(1, 1, 1);
    scene.add(wand);
    budget.add(wand);
    wand.updateMatrixWorld();
    budget.update(new THREE.Vector3(0, 0, 0));
    expect(visible()).toHaveLength(4);
    expect(visible().some((l) => l.intensity === 30)).toBe(true);
    budget.remove(wand);
    budget.update(new THREE.Vector3(0, 0, 0));
    expect(visible().some((l) => l.intensity === 30)).toBe(false);
  });
});

describe('createDynRes (dynres.ts)', () => {
  const g = globalThis as { document?: unknown };
  beforeAll(() => { g.document ??= { hidden: false }; });
  it('steps down when frames run long, back up after a steady minute-fraction, and backs off a failed step up', () => {
    const seen: number[] = [];
    const d = createDynRes({ min: 0.5, max: 1, apply: (r) => seen.push(r), settle: 3 });
    const run = (ms: number, secs: number) => { for (let t = 0; t < secs * 1000; t += ms) d.frame(ms); };
    run(16.7, 5);
    expect(d.ratio).toBe(1);
    run(30, 3);
    expect(d.ratio).toBeLessThan(0.75);
    run(30, 20);
    expect(d.ratio).toBe(0.5);
    run(16.7, 4);
    expect(d.ratio).toBeCloseTo(0.55);
    // that step was too much: undone, and the next try waits 4x longer
    run(30, 1.1);
    expect(d.ratio).toBeLessThan(0.55);
    const r = d.ratio;
    run(16.7, 6);
    expect(d.ratio).toBe(r);
    run(16.7, 8);
    expect(d.ratio).toBeGreaterThan(r);
    expect(seen.length).toBeGreaterThan(3);
  });
});

describe('serveStatic (static.ts): caching and compression', () => {
  let server: Server, base = '';
  const dist = mkdtempSync(join(tmpdir(), 'hogwarts-dist-'));
  const js = 'console.log("' + 'x'.repeat(5000) + '");';
  beforeAll(async () => {
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>t</title>' + ' '.repeat(2000));
    writeFileSync(join(dist, 'assets', 'app-abc123.js'), js);
    writeFileSync(join(dist, 'assets', 'app-abc123.js.gz'), gzipSync(js));
    server = createServer((req, res) => serveStatic(dist, req, res, new URL(req.url!, 'http://x').pathname));
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => server.close());
  const get = (path: string, headers: Record<string, string> = {}) => new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }>((ok, fail) => {
    // (node's fetch would decompress for us: read the raw bytes)
    import('node:http').then(({ get: hget }) => hget(base + path, { headers }, (res) => { const c: Buffer[] = []; res.on('data', (d) => c.push(d)); res.on('end', () => ok({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(c) })); }).on('error', fail));
  });
  it('sends hashed bundles compressed and immutable, revalidates the page, answers 304', async () => {
    const a = await get('/assets/app-abc123.js', { 'accept-encoding': 'gzip, deflate, br' });
    expect(a.status).toBe(200);
    expect(a.headers['content-encoding']).toBe('gzip'); // (no .br written for this one)
    expect(a.headers['cache-control']).toContain('immutable');
    expect(gunzipSync(a.body).toString()).toBe(js);
    const plain = await get('/assets/app-abc123.js');
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.body.toString()).toBe(js);
    const page = await get('/', { 'accept-encoding': 'gzip' });
    expect(page.headers['cache-control']).toBe('no-cache');
    expect(page.headers['content-encoding']).toBe('gzip'); // compressed on the fly, once
    const again = await get('/', { 'if-none-match': String(page.headers.etag) });
    expect(again.status).toBe(304);
    expect(again.body.length).toBe(0);
    const spa = await get('/some/where');
    expect(spa.headers['content-type']).toContain('text/html');
    expect(spa.headers['cache-control']).toBe('no-cache');
  });
});
