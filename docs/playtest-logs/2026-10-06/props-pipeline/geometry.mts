import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const roots = process.argv.slice(2, 4);
assert.equal(roots.length, 2, 'Pass baseline and candidate checkout paths');
const builds = [];
for (const [index, checkout] of roots.entries()) {
  const label = index === 0 ? 'before' : 'after';
  const tile = Number(readFileSync(`${checkout}/client/props3d.ts`, 'utf8').match(/const TILE = (\d+);/)?.[1]);
  assert.ok(Number.isFinite(tile));
  const { propsFeature } = await import(pathToFileURL(`${checkout}/client/props3d.ts`).href);
  const { PROPS } = await import(pathToFileURL(`${checkout}/src/shared/props.ts`).href);
  let state = {};
  const feature = propsFeature({ wire: () => state });
  const meshes = feature.group.children.filter((m: any) => m.isInstancedMesh);
  const geometry = new Map<string, any>();
  for (const mesh of meshes) geometry.set(mesh.name.split('|')[0] + (mesh.name.endsWith(':ring') ? ':ring' : mesh.name.endsWith(':glow') ? ':glow' : ''), mesh.geometry);
  const bytes = [...new Set(geometry.values())].reduce((n, g) => n + Object.values(g.attributes).reduce((s: number, a: any) => s + a.array.byteLength, 0) + (g.index?.array.byteLength ?? 0), 0);
  const states = [];
  for (const mode of ['initial', 'broken', 'awake', 'reset']) {
    state = mode === 'broken' ? { b: Object.fromEntries(PROPS.filter((_: any, i: number) => i % 3 === 0).map((p: any) => [p.id, 100])) } : mode === 'awake' ? { a: Object.fromEntries(PROPS.map((p: any) => [p.id, 100])) } : {};
    feature.frame(0.05);
    const matrices = new Map();
    for (const mesh of meshes) {
      const key = mesh.name.slice(6).split(':')[0];
      const list = PROPS.filter((p: any) => `${p.kind}|${Math.floor(p.x / tile)},${Math.floor(p.z / tile)}` === key);
      assert.equal(list.length, mesh.count);
      list.forEach((p: any, i: number) => matrices.set(p.id + (mesh.name.endsWith(':ring') ? ':ring' : mesh.name.endsWith(':glow') ? ':glow' : ''), Array.from(mesh.instanceMatrix.array.slice(i * 16, (i + 1) * 16))));
    }
    states.push(matrices);
  }
  builds.push({ label, geometry, states, summary: { label, kinds: new Set(PROPS.map((p: any) => p.kind)).size, props: PROPS.length, geometryBytes: bytes, bodyBuckets: meshes.filter((m: any) => !m.name.endsWith(':glow') && !m.name.endsWith(':ring')).length, totalBuckets: meshes.length, instanceMatrixBytes: meshes.reduce((n: number, m: any) => n + m.instanceMatrix.array.byteLength, 0) } });
}
for (const [key, before] of builds[0].geometry) {
  const after = builds[1].geometry.get(key);
  assert.ok(after, key);
  assert.equal(after.getAttribute('uv'), undefined, key);
  assert.deepEqual(after.index?.array, before.index?.array, key);
  for (const name of Object.keys(before.attributes).filter(n => n !== 'uv')) assert.deepEqual(after.getAttribute(name).array, before.getAttribute(name).array, `${key}:${name}`);
  before.computeBoundingBox(); after.computeBoundingBox();
  assert.deepEqual(after.boundingBox, before.boundingBox, key);
}
for (let i = 0; i < 4; i++) assert.deepEqual(builds[0].states[i], builds[1].states[i]);
const result = { summaries: builds.map(b => b.summary), verified: ['all non-UV attributes and indices byte-identical', 'bounding boxes identical', 'every prop body/glow/ring matrix identical in initial/broken/awake/reset states'] };
if (process.argv[4]) writeFileSync(process.argv[4], JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
