# Performance evidence, 2026-10-03

This directory accompanies [the performance report](../../../PERF.md#2026-10-03--flat-ground-cpu-cost-and-persistent-name-tag-decluttering).
The baseline was `4d968113a31b56b59c8b91215384244965968bd1`. The after build included the flat-ground
optimization, persistent name-tag suppression, and the accompanying basic UI fixes. It was measured before
the final optimization commit was created.

## Recorded files

| File | Contents |
|---|---|
| `terrain-cpu.json` | Final repeated eight-region CPU comparison, all seven samples per version, exact-height check count |
| `browser-dynamic.jsonl` | Moving-world before/after, both no-draw and draw-enabled; load and per-view results |
| `browser-static.jsonl` | Only the final strict `static-before-fixed` and `static-after-fixed` load/view records |
| `static-before-witness.json`, `static-after-witness.json` | Frozen time, entity/connection counts and identical protocol-snapshot SHA-256 |
| `static-before.log`, `static-after.log` | Final strict render-pass/scene census and summary output |
| `terrain-bench.ts` | Extracts each revision's numeric terrain functions, checks equality and times them |
| `static-perf.ts`, `freeze-world.mjs` | Portable copy of the frozen-world harness and its server preload |

The raw records are unchanged except that preliminary static runs were excluded. No world save, protocol
snapshot, identity metadata or key is included. The portable scripts replace the original machine's absolute
paths with environment variables; `freeze-world.mjs` writes only a snapshot hash witness. The original run
also compared the two transient protocol snapshot files byte for byte before excluding them from this archive.

Freezing applies only to this dedicated synthetic performance server. The separate UI playtest screenshots
and reports were gathered through gameplay; this preload was not applied to their game state.

Measured environment: Node **v24.19.0**, Chromium **151.0.7922.173** on Debian GNU/Linux 13, SwiftShader,
`playwright-core`, repository npm dependencies. CPU time is `process.cpuUsage` user + system, not wall time.
The default world asks for 12 NPCs but creates six here: the strict witness has 27 wizards including 20 bots
and one viewer, plus 83 creatures.

## Prepare both builds

Run from the checkout containing the optimization. Install the repository dependencies with `npm ci` if
necessary. Keep other browser playtests, compilation, tests and model checking stopped during measurement.
Use the same Node, Chromium executable and viewport for both builds.

```bash
task_repo="$(pwd)"
evidence="$task_repo/docs/playtest-logs/2026-10-03/perf"
baseline_root="$(mktemp -d /tmp/hogwarts-perf-baseline.XXXXXX)"
scratch_root="$(mktemp -d /tmp/hogwarts-perf-results.XXXXXX)"
git worktree add --detach "$baseline_root" 4d968113a31b56b59c8b91215384244965968bd1
ln -s "$task_repo/node_modules" "$baseline_root/node_modules"
npm install --prefix "$scratch_root/browser" playwright-core
export PLAYWRIGHT_CORE="$scratch_root/browser/node_modules/playwright-core/index.mjs"
export CHROMIUM=/usr/bin/chromium
npx vite build
(cd "$baseline_root" && npx vite build)
```

The benchmark creates a private synthetic save and login metadata under `PERF_FIXTURE`; reuse that directory
for the pair of runs. Keep these generated files in the temporary directory. Use a fresh fixture directory
if changing bot/crowd/NPC settings.

## Terrain comparison

```bash
TERRAIN_BEFORE="$baseline_root/client/terrain.ts" \
TERRAIN_AFTER="$task_repo/client/terrain.ts" \
  npx tsx "$evidence/terrain-bench.ts" "$scratch_root/terrain-cpu.json"
```

The seed is `20261003`; each of eight regions has 8,192 points. Each timing sample makes 163,840 calls,
with seven alternating before/after samples following warm-up. Any unequal sampled height aborts the run.
The final report records the median CPU nanoseconds per call and all individual samples. The archived result
has 65,536 matching points and zero maximum difference. This isolates the height query; it does not time a frame.

## Strict static rendering comparison

Run the following commands sequentially. They use the real game server, WebSocket transport and compiled
browser client from `BENCH_ROOT`. Only the benchmark preload freezes time and input/facing. The shared fixture
also restores wild creatures, which the normal game save does not persist. Browser `Math.random` is seeded so
procedural decorations match. Bots connect but never start their driving/casting loop.

The camera first settles for two seconds with drawing skipped, then warms for four seconds and samples sixteen.
The `crowd` camera is fixed, low quality is forced, and dynamic resolution is disabled.

```bash
BENCH_ROOT="$baseline_root" PERF_FIXTURE="$scratch_root/fixture" \
PERF_TMP="$scratch_root/before" \
  npx tsx "$evidence/static-perf.ts" --port=8850 --q=low \
  --bots=20 --crowd=10 --npcs=12 --spots=crowd --warm=4 --secs=16 \
  --size=1280x720 --url='&dyn=0' --census --label=static-before-fixed \
  --out="$scratch_root/static-results.jsonl" > "$scratch_root/before.log" 2>&1

BENCH_ROOT="$task_repo" PERF_FIXTURE="$scratch_root/fixture" \
PERF_TMP="$scratch_root/after" \
  npx tsx "$evidence/static-perf.ts" --port=8851 --q=low \
  --bots=20 --crowd=10 --npcs=12 --spots=crowd --warm=4 --secs=16 \
  --size=1280x720 --url='&dyn=0' --census --label=static-after-fixed \
  --out="$scratch_root/static-results.jsonl" > "$scratch_root/after.log" 2>&1

diff -u "$scratch_root/before/witness.json" "$scratch_root/after/witness.json"
```

The witness is generated only after the viewer and all bots are connected. Matching witnesses are required
before comparing calls/triangles. Inspect `callsUnique`, `trisUnique`, `passes` and `census` as well as averages:
shadow refreshes alternate, so an extra shadow frame can change the average without changing scene complexity.
The shadow-map pass is included in the scene-render pass count; do not add those two rows together.

For the archived pair, both snapshots have SHA-256
`7ae2842dd33e858cce2b1348ada538f144cb00f36e426495a6b9d7af92e99a9c`.
The two 17-frame samples have identical scene and shadow work. Overlay calls fall from 29.59 to 19 per frame;
the final census loses 12 overlapping name-tag quads. Total calls fall from 689 to 678.41.

## Moving-world diagnostic

The ordinary repository harness produced `browser-dynamic.jsonl`. For each checkout, run this from its root,
once with `--nodraw` and once without; use separate labels and scratch directories:

```bash
PERF_TMP="$scratch_root/dynamic-run" npx tsx scripts/perf-client.ts \
  --port=8852 --q=low --bots=20 --crowd=10 --npcs=12 \
  --spots=follow,crowd --warm=4 --secs=8 --size=1280x720 --url='&dyn=0' \
  --nodraw --label=before-nodraw --out="$scratch_root/dynamic-results.jsonl"
```

No-draw windows had 480 frames each, but total JS changed in opposite directions across the two views.
Draw-enabled windows had only 15 follow and 9 crowd frames while the simulated world kept moving, and initially
showed higher calls after the change. This is why the strict frozen-world check was added. The moving results
and startup numbers are retained rather than presented as a consistent improvement.

SwiftShader's approximately 1–2 fps is software rendering on this machine, not player hardware performance.
Neither these fps values nor terrain microbench percentages establish a real-GPU frame-time gain.
