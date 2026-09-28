# Performance: one world, many clients, many cores

This page records what was measured, on what, and how, before and after the performance pass
(branch `wf/perf`, base commit `9b159fa`). Every number comes from `scripts/bench.ts`; you can re-run
all of them (see [Reproduce](#reproduce)).

## Summary

| | before | after |
|---|---:|---:|
| Kernel, 2 000 wizards: ms per 20 Hz tick (mean / p95) | 347 / 493 | **5.9 / 7.8** (59x) |
| Kernel, 1 000 wizards | 94.0 / 129 | **2.8 / 3.7** (34x) |
| Kernel, 5 000 wizards | not run (would be ~2 s/tick) | **27 / 34**, inside the 50 ms budget |
| Server, 500 WebSocket clients spread over the map: event-loop delay p99 | 2 275 ms (overloaded) | **22.8 ms** |
| … cast round trip p50 / p99 | 1 065 / 2 202 ms | **1.9 / 21.7 ms** |
| … snapshots actually delivered per client per second (target 10) | 0.47 | **9.95** |
| … bytes per client at the full 10 Hz | ~1.39 MB/s (139 KB x 10) | **275 KB/s** |
| … server CPU (one core = 100 %) | 96 % (saturated) | 69 % |
| Behaviour (determinism fingerprint, 150 and 400 wizards) | `91c02680a4fb3bb0`, `227ed0eaa177a481` | **identical** |

The "before" server could not keep up with 500 clients at all: its 50 ms clock ran 7 times in 15 s
(each run catching up 20 ticks), so the world moved at about half speed and clients got one snapshot
every two seconds. After the pass it runs every tick and every broadcast on time.

## Machine and method

* **Machine**: container with 4 vCPU (Intel Xeon @ 2.10 GHz), 16 GB RAM, Linux 6.18, Node v22.22.2.
  All numbers are per core unless stated: the kernel is single-threaded and each world (realm) is one
  process with one event loop; "CPU %" is process CPU time / wall time (100 % = one core busy).
* **Kernel benchmark** (`bench.ts kernel`): an in-process `World` (seeded) with N online wizards spread
  uniformly over the 480 m x 480 m map, 4 NPCs, `creatures.spawnMultiplier = 3`, the wild pre-filled to
  its x3 population. Every wizard walks (new random heading every 3 s) and casts *Stupefy* about once a
  second: at the nearest hostile creature within 30 m, otherwise at a random point 14 m away.
  10 s simulated warm-up, then 30 s (600 ticks) measured. "tick" is `world.tick()`; "syscalls" is the
  time spent in the casts/inputs of that tick (in the real server they run between ticks).
  Targeting is computed by the harness and is not timed.
* **Network benchmark** (`bench.ts net`): a save file with K wizards is generated (layout *spread*:
  uniform over the map; *crowd*: all within 15 m of the courtyard spawn), the real server
  (`src/server/main.ts`) is spawned with a probe preloaded (`scripts/bench-probe.ts`, which changes
  nothing: it wraps `setInterval` callbacks, `World#tick` and `World#snapshot` with timers, and runs
  `perf_hooks.monitorEventLoopDelay`), and K WebSocket clients connect from 2 worker threads. Each
  client sends `input` at **20 Hz** (a real browser sends at most ~4 Hz) and a `cast` every second, and
  counts what it receives without parsing snapshots. 5 s warm-up, 15 s measured.
  The load generator runs on the same 4 cores, so under heavy load server latency figures are
  pessimistic (the server competes with ~1-1.5 cores of client threads).
  The container was also shared with other jobs running in parallel (other agents' dev servers and
  software-rendered browser sessions), so expect a few percent of noise in absolute figures; before and
  after were measured with identical scripts, back to back.
* **Determinism fingerprint** (`bench.ts trace`): the kernel scenario, hashing after every tick the
  full snapshot, the private state of 5 wizards, every cast report, every wizard's and creature's
  position/health/mana/xp/target/damage ledger, and finally the event log (ids replaced by handles).
  Any change in behaviour — a different target chosen, a float rounded differently, an event in a
  different order — changes the hash.

## Kernel: before / after (ms per tick, 1 core)

| wizards | before p50 | before p95 | before max | before mean | **after p50** | **after p95** | **after max** | **after mean** | speed-up (mean) | syscalls ms/tick before → after |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | 2.58 | 3.88 | 7.91 | 2.65 | 0.39 | 0.83 | 2.43 | 0.45 | 5.9x | 0.19 → 0.12 |
| 500 | 28.3 | 36.6 | 55.5 | 27.5 | 1.22 | 1.97 | 3.59 | 1.29 | 21x | 0.47 → 0.29 |
| 1 000 | 95.3 | 129 | 266 | 94.0 | 2.67 | 3.74 | 7.36 | 2.78 | 34x | 0.84 → 0.52 |
| 2 000 | 346 | 493 | 733 | 347 | 5.74 | 7.84 | 11.5 | 5.88 | 59x | 1.46 → 0.90 |
| 5 000 | — | — | — | — | 28.0 | 34.1 | 57.9 | 27.1 | | — → 2.08 |

Scenario statistics are identical before and after (e.g. 2 000 wizards: 8.78 creatures and 702
projectiles alive on average, 51.3 % of casts succeed), as they must be for an unchanged simulation.
The old kernel was O(N²): every projectile sub-step, every creature and every NPC scanned every
wizard and allocated a view object per candidate. The budget is 50 ms per tick, so one core now runs
a 5 000-wizard world (without networking) where it previously could not run 500.

## Network: before / after (single process, 1 core for the world)

`loop` = event-loop delay; `world.tick` = time inside one `World#tick`; `bcast` = the 10 Hz broadcast
callback (snapshot + serialise + send to everyone); `snap KB` = average snapshot message size;
`me/s` = private-state messages per client per second; `ev/s` = event messages per client per second.

**Before** (`9b159fa`)

| clients | layout | loop p50 | loop p99 | loop max | world.tick p50 / p95 | bcast p50 | bcast p95 | server CPU % | KB/s per client | snap KB | snaps/s | me/s | cast RTT p50 | cast RTT p99 |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 50 | spread | 2.11 | 5.29 | 10.5 | 1.88 / 3.15 | 3.11 | 5.15 | 15.2 | 134 | 12.7 | 9.99 | 9.99 | 0.51 | 3.64 |
| 200 | spread | 2.08 | 30.9 | 77.8 | 14.6 / 25.5 | 22.0 | 31.7 | 59.8 | 419 | 42.0 | 9.81 | 9.81 | 2.47 | 39.5 |
| 500 | spread | 2 185 | 2 275 | 2 275 | 92.5 / 121 | 215 | 226 | 96.2 | 65.3 * | 139 | 0.47 | 0.47 | 1 065 | 2 202 |
| 50 | crowd | 2.07 | 5.36 | 16.7 | 1.41 / 2.84 | 3.08 | 7.08 | 12.4 | 121 | 11.4 | 9.99 | 9.99 | 0.52 | 5.84 |
| 200 | crowd | 2.11 | 20.5 | 35.9 | 6.57 / 12.6 | 17.3 | 27.8 | 44.9 | 348 | 34.0 | 9.95 | 9.95 | 0.90 | 24.0 |
| 500 | crowd | 438 | 1 046 | 1 046 | 23.2 / 75.6 | 145 | 201 | 87.9 | 198 * | 92.3 | 2.03 | 2.03 | 249 | 974 |

\* the server delivered only 0.47 (spread) / 2.03 (crowd) snapshots per second instead of 10; at
the full rate those clients would need 1.39 MB/s and 0.92 MB/s.

**After**

| clients | layout | loop p50 | loop p99 | loop max | world.tick p50 / p95 | bcast p50 | bcast p95 | server CPU % | KB/s per client | snap KB | snaps/s | me/s | cast RTT p50 | cast RTT p99 |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 50 | spread | 2.07 | 4.12 | 10.3 | 0.56 / 0.92 | 1.93 | 4.19 | 9.4 | 45.8 | 4.23 | 9.93 | 4.96 | 0.55 | 3.62 |
| 200 | spread | 2.08 | 10.1 | 41.2 | 1.26 / 2.31 | 7.89 | 15.8 | 21.8 | 119 | 11.5 | 9.99 | 4.99 | 0.88 | 8.03 |
| 500 | spread | 2.11 | 22.8 | 52.1 | 2.51 / 3.59 | 18.8 | 29.8 | 69.0 | 275 | 27.2 | 9.95 | 4.97 | 1.85 | 21.7 |
| 50 | crowd | 2.11 | 3.58 | 14.3 | 0.57 / 0.87 | 1.76 | 2.49 | 10.9 | 112 | 10.8 | 9.99 | 4.98 | 0.45 | 1.68 |
| 200 | crowd | 2.11 | 8.45 | 26.7 | 1.13 / 1.93 | 6.19 | 9.31 | 23.1 | 340 | 33.4 | 9.99 | 4.94 | 1.08 | 6.92 |
| 500 | crowd | 2.11 | 23.0 | 40.3 | 2.56 / 3.95 | 18.1 | 24.1 | 62.8 | 760 | 75.2 | 9.93 | 4.91 | 2.14 | 24.6 |
| 1 000 | spread | 31.1 | 258 | 330 | 5.61 / 14.2 | 84.7 | 155 | 86.8 | 345 | 52.0 | 6.46 | 3.22 | 72.9 | 264 |

(The event-loop monitor samples every 2 ms, so ~2.1 ms is its floor.) 1 000 clients in one process is
past one core's capacity: that is what realms are for (below).

**What area-of-interest buys** — 500 clients, spread, after the pass but with `AOI_RADIUS=0` (every
client gets the whole snapshot, still serialised once): 99.7 KB per snapshot, **966 KB/s per client**
(3.5x more), loop p99 49.9 ms, cast RTT p99 143 ms. The crowd layout shows the other end: when
everyone stands within 140 m of everyone, AOI cannot cut anything (75 KB snapshots), and the savings
come from encoding each payload once, batching writes and the 5 Hz private state.

**Memory**: RSS 234 MB for one world with 500 clients (spread), 277 MB with 1 000.

## Multi-core: REALMS=N

`REALMS=N npm start` runs N independent worlds (shards) as N processes behind one front door on
`PORT` (`src/server/realms.ts`). The front door proxies HTTP (MCP, enrolment, static files) to the
realm that owns the request and **hands WebSocket sockets to the realm process** (file-descriptor
passing), so game traffic never crosses the front door. Routing is by the realm prefix `rK.` that a
realm puts on the tokens and MCP session ids it mints; newcomers go to the realm with the fewest
players; `?realm=K` forces one; `GET /api/realms` lists realms with player/connection counts (it also
exists without `REALMS`, listing the single world). Each realm saves to `data/world.rK.json` (realm 0
keeps `data/world.json`, so an existing world becomes realm 0 and its old unprefixed tokens keep
working). Realms that crash are restarted; SIGINT/SIGTERM stops all of them (each saves). Without
`REALMS` none of this code runs.

Measured on the 4-core box (the load generator uses the other cores):

| setup | clients | per-realm loop p99 | per-realm bcast p95 | per-realm CPU % | front door CPU % | KB/s per client | cast RTT p50 / p99 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 process | 200 | 10.1 | 15.8 | 21.8 | — | 119 | 0.88 / 8.03 |
| REALMS=2 (200 each) | 400 | 9.7 / 9.5 | 10.8 / 10.9 | 36.1 / 23.6 | 2.3 | 128 | 1.63 / 10.7 |
| 1 process | 1 000 | 258 | 155 | 86.8 | — | 345 | 72.9 / 264 |
| REALMS=2 (500 each) | 1 000 | 93 / 101 | 92 / 95 | 51.5 / 49.3 | 1.05 | 247 | 19.4 / 179 |

Two realms serve twice the clients at the same per-client latency as one (first two rows). The last
row is CPU-starved on this box (2 realms + 2 busy client threads + GC on 4 cores): each realm only got
~50 % of a core although it wanted ~70 %, which is why its latency is worse than one realm with 500
clients alone. On a machine with free cores the realms do not interact at all (no shared state, no
locks, the front door is ~1 % CPU), so capacity scales with cores until something else saturates.

### Mapping to the 64-core / 128 GB production box

Assumptions (stated, not measured there): per-core speed at least that of this 2.1 GHz Xeon; realms
scale linearly because they share nothing; real browsers send input at ~4 Hz, not the benchmark's
20 Hz (input parsing was ~15 % of the busy time at 20 Hz); NUMA and NIC interrupt placement are left
to the OS.

* **Processes**: `REALMS=56` — one realm per core, leaving ~8 cores for the front door, V8's GC and
  compiler threads, and the kernel's network stack (softirq), which at these rates is not free.
  (`REALMS=60` if the NIC work is offloaded.)
* **Clients per realm**: ~500 spread-out clients per realm at <= 70 % of a core with p99 latency
  ~25 ms (measured, with the heavier 20 Hz input). A world with only the kernel and no clients handles
  5 000 wizards per core; with clients, the snapshot fan-out, not the simulation, is what fills the
  core.
* **CPU-bound capacity**: 56 x 500 = **~28 000 concurrent players** on one box.
* **Memory**: ~235 MB RSS per realm at 500 clients → 56 x 0.25 GB ≈ **14 GB** of 128 GB. Plenty of room;
  `--max-old-space-size` does not need raising.
* **Network is the real ceiling**: spread-out players receive ~275 KB/s each (crowded ones up to
  ~760 KB/s). 28 000 x 275 KB/s ≈ 7.7 GB/s ≈ 62 Gbit/s, more than most NICs: a 10 GbE link saturates
  at ~4 500 such players, 25 GbE at ~11 000, 100 GbE lets the CPUs be the limit. If the box sits
  behind 10/25 GbE, fewer realms (e.g. 16-24) already fill the link, or `AOI_RADIUS` can be lowered
  (bandwidth scales roughly with the AOI area). A binary/delta snapshot protocol would cut it by
  several times but needs a client change, which this pass deliberately avoided.

## What changed

Kernel (`src/kernel`), behaviour-preserving — the fingerprints above are byte-identical:

* **Spatial index** (`spatial.ts`): `world.wizards` / `world.creatures` are `EntityMap`s — Maps that
  keep an 8 m uniform grid in step with their membership (so `creatures.set(...)` from tests or
  restore is indexed too). Positions are re-filed wherever the kernel moves something, in bulk at the
  start of every tick, and before any query made from outside a tick (tests, MCP and WebSocket
  handlers may move things directly). Queries return a superset in Map insertion order, callers keep
  their exact distance tests, so results and their order (ties included) equal the old full scans.
  Used by `around()` (projectile hits, creature/summon targeting, spells' `enemies`/`allies`/…, nova,
  storm, chain), `fallen()`, `mend`, benign creatures (unicorn grace, phoenix), the dementor/patronus
  check, the Whomping Willow, spawn proximity checks and `look()`. Non-finite positions or radii fall
  back to exact full scans. `HOGWARTS_VERIFY_SPATIAL=1` cross-checks every query against the scan.
* **Zone raster** (`zones.ts`): zones rasterised once into a 2 m grid of "whole cell inside" /
  "boundary crosses cell" bitmasks; boundary cells fall back to the exact test, so every answer equals
  `inZone`. Which zones are *safe* is policy, so `inSafe` builds its mask from the live
  `rules.combat.safeZones` on every call (≤ 4 lookups): a decree changing safe zones applies at once.
* **`derived()` cache** (`progression.ts`): per wizard, validated against everything it depends on
  (year, wand core, items array identity/length, every equipped slot, the curse aura, the three
  rulebook numbers). Instead of call sites having to remember to invalidate on equip / unequip /
  level-up / aura / decree, the check makes a stale value impossible even when tools and tests mutate
  wizards directly. Tested against the uncached function through all of those changes.
* **Allocation-free `canHarm`** (same decisions; `test/formal.test.ts` re-checks the TLA+ invariants
  on 3 000 random worlds), homing bolts without view objects, cached 3x3 obstacle neighbourhoods in
  collision (`physics.ts`), and cast programs memoised per (source, caster limits) — `analyze()` is
  pure and the interpreter never mutates the tree.

Server (`src/server`):

* **Area-of-interest snapshots** (`fanout.ts`): the snapshot is built once per broadcast; each entry is
  serialised and UTF-8 encoded once and filed by 16 m cell; each grid row is one buffer with byte
  offsets, so a client's payload (all cells within `AOI_RADIUS` = 140 m of its cell: everything within
  140 m, nothing beyond ~185 m = radius + two cell diagonals) is ~4 x 19 memcpys. Payloads are shared
  by everyone in the same cell. The JSON is exactly the old `{t:'snap', s: snapshot}` with the four arrays filtered: the client is unchanged.
* **Private state** at most 5 Hz (sockets alternate broadcasts) and only when it changed.
* **Batched writes**: world events are queued for exactly the sockets connected when they happened and
  written, in order, with the next snapshot; each socket's events + snapshot + `me` go out in one
  corked write. The tick never writes to sockets. (Events arrive up to 100 ms later than before.)
* **Back-pressure**: a socket with more than 1 MB queued skips snapshots (they are idempotent state);
  one with more than 16 MB queued is dropped (`WS_SLOW_BYTES`, `WS_DEAD_BYTES`).
* **Rate limits** per socket, token buckets per message kind (input 40/s, cast 10/s, chat 1/s burst 5,
  the expensive ones — simulate, forge, book, seals — 2-4/s, any other type 30/s, 80/s overall), applied around `handleClient`, which is unchanged.
* **REALMS=N** as above; `/api/realms`.

## Known remaining costs

* `save()` still serialises the whole world synchronously every 30 s: ~23 ms for 2 000 wizards (4.5 MB).
* Per-client bandwidth (above) is the binding limit on a big box; the protocol is unchanged JSON.
* Input messages are parsed individually (at the benchmark's 20 Hz x 500 clients that is ~15 % of the
  busy time); real clients send far fewer.
* One world's snapshot fan-out is single-threaded; beyond ~500-700 clients in *one* world, split into
  realms (or, future work, encode payloads in worker threads).

## Reproduce

```bash
npx tsx scripts/bench.ts kernel --n=100,500,1000,2000,5000       # --secs=30 --warm=10 by default
npx tsx scripts/bench.ts trace --n=150 --secs=30                   # prints the fingerprint
npx tsx scripts/bench.ts net --k=50,200,500 --layout=spread,crowd --secs=15 --warm=5 --port=7900
npx tsx scripts/bench.ts net --k=500 --env=AOI_RADIUS=0            # AOI off
npx tsx scripts/bench.ts net --k=400 --realms=2                    # REALMS mode
# --out=results.jsonl appends machine-readable rows; BENCH_NODE_FLAGS="--cpu-prof" profiles the server.
```

To measure "before", check out `9b159fa`, copy `scripts/bench*.ts` into it and run the same commands.
