import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
import { AZKABAN, mulberry32 } from '../../../../src/shared/map.ts';
import { SCENES } from '../../../../src/shared/scenes.ts';

function load(path: string) {
  const file = readFileSync(path, 'utf8');
  const source = file.slice(file.indexOf('// ---- value noise'), file.indexOf('/** Vertex-coloured terrain:')).replace(/\bexport /g, '');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function('AZKABAN', `${js}\nreturn { heightAt, flatness };`)(AZKABAN) as { heightAt(x: number, z: number): number; flatness(x: number, z: number): number };
}
if (!process.env.TERRAIN_BEFORE || !process.env.TERRAIN_AFTER) throw new Error('Set TERRAIN_BEFORE and TERRAIN_AFTER to the two terrain.ts files.');
const before = load(process.env.TERRAIN_BEFORE);
const after = load(process.env.TERRAIN_AFTER);
const rng = mulberry32(20261003);
const regions = [{ id: 'spawn', box: [-15, -37, 15, -7] }, ...SCENES,
  { id: 'highlands', box: [-1600, -1600, 1600, 1600] },
  { id: 'azkaban', box: [AZKABAN.x - 45, AZKABAN.z - 45, AZKABAN.x + 45, AZKABAN.z + 45] }];
let checked = 0, maxDelta = 0;
const rows: any[] = [];
let sink = 0;
for (const region of regions) {
  const points = new Float64Array(8192 * 2), [x0, z0, x1, z1] = region.box;
  let flat = 0;
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i] = x0 + rng() * (x1 - x0), z = points[i + 1] = z0 + rng() * (z1 - z0);
    const a = before.heightAt(x, z), b = after.heightAt(x, z);
    maxDelta = Math.max(maxDelta, Math.abs(a - b));
    if (a !== b) throw new Error(`height differs at ${x},${z}: ${a} vs ${b}`);
    if (before.flatness(x, z) === 0) flat++;
    checked++;
  }
  function run(fn: typeof before.heightAt, laps: number) {
    let sum = 0;
    const start = process.cpuUsage();
    for (let lap = 0; lap < laps; lap++) for (let i = 0; i < points.length; i += 2) sum += fn(points[i], points[i + 1]);
    sink += sum;
    const cpu = process.cpuUsage(start);
    return (cpu.user + cpu.system) * 1000 / (points.length / 2 * laps);
  }
  run(before.heightAt, 8); run(after.heightAt, 8);
  const a: number[] = [], b: number[] = [];
  for (let r = 0; r < 7; r++) {
    if (r % 2) { b.push(run(after.heightAt, 20)); a.push(run(before.heightAt, 20)); }
    else { a.push(run(before.heightAt, 20)); b.push(run(after.heightAt, 20)); }
  }
  const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
  rows.push({ region: region.id, flatPercent: flat / 8192 * 100, beforeNs: median(a), afterNs: median(b), beforeSamplesNs: a, afterSamplesNs: b });
  console.log(JSON.stringify(rows.at(-1)));
}
const result = { checked, maxDelta, sink, node: process.version, timing: 'process.cpuUsage user+system ns/call; 7 alternating samples per version, 163840 calls/sample', rows };
writeFileSync(process.argv[2] ?? '/tmp/hogwarts-terrain-result.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify({ checked, maxDelta }));
