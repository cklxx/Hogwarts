# Performance: one world, many clients, many cores

This page records what was measured, on what, and how, before and after the performance pass
(branch `wf/perf`, base commit `9b159fa`), and in the review fix pass after it (`wf/perf-fix`,
[below](#fix-pass-frame-rate-input-full-snapshots-aoi-churn)). Every number comes from
`scripts/bench.ts`; you can re-run all of them (see [Reproduce](#reproduce)).

## Summary

| | before | after |
|---|---:|---:|
| Kernel, 2 000 wizards: ms per 20 Hz tick (mean / p95) | 347 / 493 | **5.9 / 7.8** (59x) |
| Kernel, 1 000 wizards | 94.0 / 129 | **2.8 / 3.7** (34x) |
| Kernel, 5 000 wizards | not run (would be ~2 s/tick) | **27 / 34**, inside the 50 ms budget |
| Server, 500 WebSocket clients spread over the map: event-loop delay p99 | 2 275 ms (overloaded) | **22.8 ms** |
| … cast round trip p50 / p99 | 1 065 / 2 202 ms | **1.9 / 21.7 ms** |
| … snapshots actually delivered per client per second (target 10) | 0.47 | **9.95** |
| … bytes per client at the full 10 Hz, today's browser client (full snapshots) | ~1.39 MB/s (139 KB x 10) | **~0.98 MB/s** (98 KB x 10) ¹ |
| … bytes per client, a client that asks for area-of-interest snapshots (`aoi=1`) | — | **~275 KB/s** ¹ |
| … server CPU (one core = 100 %) | 96 % (saturated) | 69 % ² |
| … casts answered when clients send input at 144 Hz (a 144 Hz monitor, walking + turning) | — | **100 %** (wf/perf: 5-9 %) ³ |
| Behaviour (determinism fingerprint, 150 and 400 wizards) | `91c02680a4fb3bb0`, `227ed0eaa177a481` | **identical** |

¹ Area-of-interest snapshots are **opt-in per socket** since the fix pass: the shipped client removes
an entity's model without disposing it and plays a "vanish" puff whenever an entity leaves its snapshot,
so it keeps getting the full snapshot (smaller than before: the "before" message was built per client).
See [For the client streams](#for-the-client-streams). ² 20 Hz input, AOI clients; with full-snapshot
clients 43-47 %. ³ The wf/perf rate limiter dropped frame-rate input and, through a shared budget, the
casts sent between them; see the fix pass.

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
  client sends `input` at **20 Hz** unless stated (`--input-hz`) and a `cast` every second, and
  counts what it receives without parsing snapshots. 5 s warm-up, 15 s measured.
  *How often a real browser sends input*: on every animation frame in which its rounded
  (dx, dz, facing) changed, plus a 4 Hz heartbeat (`client/main.ts` `sendInput`). Standing still that
  is 4 Hz; walking while turning the camera (mouse drag, Q/E, or the controls stream's camera that
  swings in behind you as you run) it is the display's frame rate: 60 Hz, 120-165 Hz on gaming
  monitors, 240 Hz and more on some. (The first version of this page said "at most ~4 Hz"; that was
  wrong — 4 Hz is only the idle heartbeat.)
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

**After** (wf/perf, where every client got AOI snapshots; since the fix pass that takes `aoi=1`, which
the benchmark clients send — the shipped browser client does not, see the fix pass for its numbers)

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
(3.5x more), loop p99 49.9 ms, cast RTT p99 143 ms. (Re-measured in the fix pass on a less loaded box:
981 KB/s, loop p99 19.6 ms, CPU 47 %: one shared full snapshot costs *less* CPU than per-cell payloads,
it just costs 3.6x the bandwidth.) The crowd layout shows the other end: when everyone stands within
140 m of everyone, AOI cannot cut anything (75 KB snapshots), and the savings come from encoding each
payload once, batching writes and the 5 Hz private state.

**Memory**: RSS 234 MB for one world with 500 clients (spread), 277 MB with 1 000.

## Fix pass: frame-rate input, full snapshots, AOI churn

A review of wf/perf found four problems; all were real and are fixed on `wf/perf-fix`:

1. **The rate limiter dropped normal browser input and starved casts.** Input came at frame rate (see
   [method](#machine-and-method)) against a 40/s input budget, and every message — rejected input
   included — first spent a shared 80/s budget, so casts and chat arriving between inputs were dropped
   (with a "slow down" toast), and a dropped key-release left the wizard walking until the next 0.25 s
   heartbeat. Now (`net.ts`): input never spends the shared budget; within its own budget (250/s, burst
   300 — above common frame rates) it is applied at once as before; beyond it, it is *merged* into one
   pending input per socket, applied before that socket's next other message and before every world
   tick and broadcast, leaving exactly the state applying each would (last direction, last facing given,
   walk-to goal cancelled if any of them moved — tested against applying them one by one). Both budgets
   are checked before either is spent. `goto` (the controls stream's click-to-move, which runs A*) got
   its own budget (10/s, burst 20; that client sends at most ~8/s).
2. **REALMS routed tokenless requests to realm 0**, so the in-game board (`fetch('/api/leaderboard')`,
   no token) showed realm 0's term, house points and Minister to everyone, and MCP `login` only worked
   if the tokenless session happened to be in the token's realm. Now the front door sets a routing
   cookie on /api/enroll and /api/me answers, and moves an MCP session to the realm of the token it
   logs in with ([REALMS](#multi-core-realmsn)).
3. **AOI turned the client's entity add/remove path from rare into continuous**, and the client never
   disposes what it removes (geometries, materials, label canvas textures stay in three.js's caches and
   on the GPU) and puffs smoke for every creature that leaves its snapshot. That needs client work
   (below), so AOI is now **opt-in per socket** (`/ws?...&aoi=1`; `AOI_ALL=1` forces it for everyone):
   the shipped client gets full snapshots again — nothing enters or leaves except by dying, spawning or
   logging on/off, exactly as at `9b159fa`. And AOI got **hysteresis** (`fanout.ts`): an entity stays
   filed under its cell, and a viewer anchored to its cell, until it is `AOI_MARGIN` (10 m) past it, so
   wobbling across a cell edge changes nothing. The margin is carved from the inside of the area, so
   payloads are exactly as big as before: `AOI_RADIUS` is still the cell-to-cell reach (140 m),
   everything within 120 m is always sent, nothing beyond ~205 m.
4. **The rate-limit error was a mixed Chinese/English string.** It is English now, like every other
   server error; the translation belongs in `client/i18n.ts` ERRORS (controls stream, below).

**Frame-rate input, A/B against wf/perf, interleaved** (500 clients, spread, AOI, cast every second;
the box was busy with other agents' jobs — load average 5-7 on 4 cores — so compare rows pairwise):

| server | input Hz | loop p99 ms | bcast p95 ms | server CPU % | KB/s per client | casts answered % | cast RTT p50 / p99 ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| wf/perf | 20 | 36.8 / 37.4 | 41.1 / 42.5 | 60.0 / 60.9 | 273 / 275 | 100 / 100 | 4.5 / 4.9 · 56 / 45 |
| wf/perf-fix | 20 | 33.1 / 34.9 | 37.9 / 40.0 | 58.8 / 56.8 | 269 / 274 | 100 / 99.9 | 4.2 / 4.4 · 149 / 50 |
| wf/perf | 144 | 68.6 / 41.9 | 44.2 / 41.2 | 62.3 / 72.2 | 165 / 166 | **8.8 / 5.5** | **4 205 / 2 135 · 13 490 / 6 217** |
| wf/perf-fix | 144 | 176 / 31.9 | 57.3 / 34.2 | 70.7 / 93.3 | 220 / 273 | **100 / 100** | 32 / 8.2 · 221 / 61 |

(two runs each, "a / b"; the RTTs of the wf/perf 144 Hz rows are inflated — the benchmark pairs each
reply with the oldest unanswered cast, and over 90 % were never answered — and with fewer bolts flying
its snapshots were smaller.) At 20 Hz the fix pass costs nothing (the differences are noise).
At 144 Hz nothing is lost any more; what remains is the price of receiving and parsing ~72 000 input
messages a second (next table).

**What input costs, and the shipped client's full snapshots** (this branch, one process, spread; load
average 3-7 from other jobs during these runs, so latencies are pessimistic and ±10 % CPU is noise):

| clients | snapshots | input Hz | loop p99 ms | bcast p95 ms | server CPU % | KB/s per client | snap KB | cast RTT p50 / p99 ms |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 500 | full | 20 | 19.6 / 33.9 | 22.8 / 43.8 | 47.0 / 43.0 | 981 / 986 | 97.7 | 2.1 / 8.9 · 3.3 / 77 |
| 500 | full | 60 | 21.3 / 20.3 | 23.0 / 21.5 | 58.3 / 58.0 | 990 / 981 | 99.0 | 3.8 / 27.5 · 3.6 / 24.2 |
| 500 | AOI | 60 | 59.9 | 50.2 | 63.2 | 267 | 27.1 | 10.7 / 106 |
| 500 | AOI | 144 | 140 | 60.2 | 72.9 | 242 | 27.2 | 27.7 / 188 |
| 300 | full | 60 | 13.1 | 22.2 | 36.6 | 613 | 61.0 | 2.4 / 30.4 |
| 300 | AOI | 60 | 17.4 | 30.0 | 49.7 | 170 | 16.7 | 2.4 / 25.9 |
| 200 | full | 60 | 8.51 | 10.2 | 24.2 | 426 | 42.3 | 2.0 / 7.9 |
| 200 | AOI | 60 | 11.2 | 13.9 | 26.0 | 116 | 11.3 | 2.1 / 13.0 |

Going from 20 to 60 Hz input costs 5-15 % of a core at 500 clients (20 000 more messages a second:
~3-7 µs each for WebSocket framing, UTF-8 decoding and `JSON.parse`), 20 → 144 Hz 12-36 %. The world
reads input once per 50 ms tick, so anything above 20 Hz changes nothing in the simulation: a client
that sent at most one input per 50 ms (always including the final state) would cut this to the 20 Hz
rows (see [For the client streams](#for-the-client-streams)). Full snapshot bandwidth grows with the
realm's population: ≈ 55 KB/s + 1.85 KB/s per other player online (426 / 613 / 981 KB/s at
200 / 300 / 500).

**AOI churn** (`bench.ts churn`: the kernel scenario, 300 wizards walking and casting, 5 of them watched
as clients for 120 s — each walked ~770 m; counts per observer):

| AOI | snap KB | wizard models created / removed | …removed but still in the world | creature models created / removed | …still alive (a bogus "puff") | flicker: removed, back within 3 s |
|---|---:|---:|---:|---:|---:|---:|
| off (full snapshots; the shipped client) | 56.1 | 0 / 0 | 0 | 186 / 249 | 0 | 0 |
| 140 m, no hysteresis (wf/perf) | 13.5 | 401 / 402 | 402 | 88.8 / 104 | 45.4 | 219 |
| **140 m, margin 10 m (default)** | 13.6 | 198 / 203 | 203 | 60.4 / 76.6 | 17.0 | 45.8 |
| 140 m, margin 20 m | 13.6 | 170 / 175 | 175 | 57.4 / 73.8 | 14.8 | 16.6 |

Hysteresis halves the churn and cuts flicker by 80 % at no cost in bytes; what is left is inherent —
a walking viewer sweeps its area across the map, taking in ~2.6 wizards per 10 m walked (at this
density). That is why AOI waits for a client that disposes or pools what it removes (every model it
rebuilds is ~12 geometries / ~40 KB of vertex data plus a 512x160 label canvas) and does not puff for
entities that merely left its area.

## Multi-core: REALMS=N

`REALMS=N npm start` runs N independent worlds (shards) as N processes behind one front door on
`PORT` (`src/server/realms.ts`). The front door proxies HTTP (MCP, enrolment, static files) to the
realm that owns the request and **hands WebSocket sockets to the realm process** (file-descriptor
passing), so game traffic never crosses the front door. Routing is by the realm prefix `rK.` that a
realm puts on the tokens and MCP session ids it mints; newcomers go to the realm with the fewest
players; `?realm=K` forces one; `GET /api/realms` lists realms with player/connection counts (it also
exists without `REALMS`, listing the single world). Requests without a token (the in-game board's
`/api/leaderboard`, `/api/rules`, `/api/history`) follow a routing cookie `hogwarts_realm=K` that the
front door sets on every successful `/api/enroll` and `/api/me` answer (the browser calls one of them
at the gate, before anything else), so a player in realm 1 sees realm 1's term, house points and
Minister. An MCP session opened without a token lives where it was sent; when it calls `login` with a
token of another realm, the front door replays the session's `initialize` in the token's realm under
the same session id, routes the session there from then on and closes the old one, so `login` works
whatever realm the session started in. (Checked live with REALMS=2: a realm-1 player's board now shows
realm 1; sessions minted by realm 0 log in as realm-1 wizards and vice versa, `whoami` included; a
client-supplied `x-hogwarts-*` header is stripped.) Each realm saves to `data/world.rK.json` (realm 0
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
scale linearly because they share nothing (measured above on 2 realms); NUMA and NIC interrupt
placement are left to the OS; and — corrected in the fix pass — **every connected player sends input
at 60 Hz all the time**. That is pessimistic for idle players (4 Hz) and optimistic for 120-240 Hz
monitors; the first version of this estimate assumed 4 Hz, which only the idle heartbeat is. Players
are spread over the map; a crowd in one spot costs more bytes (see the crowd rows).

* **Processes**: `REALMS=56` — one realm per core, leaving ~8 cores for the front door, V8's GC and
  compiler threads, and the kernel's network stack (softirq), which at these rates is not free.
  (`REALMS=60` if the NIC work is offloaded.)
* **Memory**: ~235 MB RSS per realm at 500 clients → 56 x 0.25 GB ≈ **14 GB** of 128 GB. Plenty of
  room; `--max-old-space-size` does not need raising. Memory is never the limit.
* **Today's browser client (full snapshots)**: CPU is not the limit (500 clients at 60 Hz input: 58 %
  of a core); bandwidth is, because every player receives every other player of its realm:
  ≈ 55 KB/s + 1.85 KB/s x N per client in a realm of N, i.e. ≈ R·N·(55 + 1.85·N) KB/s for the box.
  With 56 realms that fills a 10 GbE link at ~95 players per realm (**~5 300 players**), 25 GbE at
  ~160 per realm (**~9 000**), 100 GbE at ~330 per realm (**~18 500**, each realm ~40 % CPU). Smaller
  realms carry more players per byte; how few players make a good world is a game-design question.
* **A client that takes AOI snapshots (`aoi=1`)**: CPU-bound. At 60 Hz input a realm serves ~400
  spread-out players at ~55 % of a core (measured: 300 → 50 %, 500 → 63 %, p99 latency 17-60 ms on a
  loaded box), leaving headroom for GC and crowding; with input capped at 20 Hz by the client, ~500
  (69 %, p99 23 ms). 56 x 400 = **~22 000 concurrent players** (~28 000 with a 20 Hz input cap). They
  receive ~270 KB/s each: 22 000 x 270 KB/s ≈ 6 GB/s ≈ 48 Gbit/s — a 100 GbE box (or 2 x 25 GbE); a
  single 25 GbE link carries ~11 500 of them, 10 GbE ~4 600. `AOI_RADIUS` trades bytes for view
  distance (bandwidth scales roughly with the area).
* A binary/delta snapshot protocol would cut bandwidth by several times in both cases, and one input
  message per tick would cut the per-message cost; both need the client, which this stream does not
  own.

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

* **Snapshots built and serialised once per broadcast** (`fanout.ts`), lazily in the form someone needs:
  one shared full snapshot (every socket that did not ask for AOI — the shipped client) and/or
  **area-of-interest** payloads for sockets that connected with `aoi=1`: each entry is serialised and
  UTF-8 encoded once and filed by 16 m cell; each grid row is one buffer with byte offsets, so a
  client's payload (all cells within `AOI_RADIUS` = 140 m of its anchor cell) is ~4 x 19 memcpys, shared
  by everyone anchored to the same cell. Hysteresis: entities and viewers keep their cell until
  `AOI_MARGIN` = 10 m past it, so everything within 120 m is always sent and nothing beyond ~205 m.
  The JSON is exactly the old `{t:'snap', s: snapshot}` with the four arrays filtered — but an AOI
  client sees entities leave and re-enter as it travels, which is why AOI is opt-in (fix pass).
* **Private state** at most 5 Hz (sockets alternate broadcasts) and only when it changed.
* **Batched writes**: world events are queued for exactly the sockets connected when they happened and
  written, in order, with the next snapshot; each socket's events + snapshot + `me` go out in one
  corked write. The tick never writes to sockets. (Events arrive up to 100 ms later than before.)
* **Back-pressure**: a socket with more than 1 MB queued skips snapshots (they are idempotent state);
  one with more than 16 MB queued is dropped (`WS_SLOW_BYTES`, `WS_DEAD_BYTES`).
* **Rate limits** per socket (`net.ts` `admit()`, around `handleClient`, which is unchanged): token
  buckets per message kind — cast 10/s (burst 15), chat 1/s (burst 5), goto 10/s, the expensive ones
  (simulate, forge, book, seals, …) 2-4/s, any other type 30/s — plus 80/s for all of them together,
  both checked before either is spent; over budget the message is dropped and the sender told (in
  English) at most once a second. **Movement input is never dropped**: 250/s (burst 300) are applied
  at once, more are merged into one pending input applied before the socket's next message and before
  every tick and broadcast (same end state as applying each), and input never touches the shared budget.
* **REALMS=N** as above; `/api/realms`, routing cookie, MCP `login` across realms.

## Known remaining costs

* `save()` still serialises the whole world synchronously every 30 s: ~23 ms for 2 000 wizards (4.5 MB).
* Per-client bandwidth (above) is the binding limit on a big box; the protocol is unchanged JSON, and
  the shipped client still takes full snapshots.
* Input messages are parsed individually: ~3-7 µs each, so a frame-rate client costs the server
  5-15 % of a core per 500 players at 60 Hz and up to a third of a core at 144 Hz, for nothing the
  20 Hz simulation can use. The fix is on the client (below).
* One world's snapshot fan-out is single-threaded; beyond ~500-700 clients in *one* world, split into
  realms (or, future work, encode payloads in worker threads).

## Configuration

| variable | default | meaning |
|---|---|---|
| `REALMS` | unset | `N` > 1: N realm processes behind one front door on `PORT` (above) |
| `AOI_RADIUS` | 140 | area-of-interest reach in metres (cell to cell); 0 turns AOI off for everyone |
| `AOI_MARGIN` | 10 | hysteresis margin in metres (≤ radius/4); everything within radius − 2·margin is always sent |
| `AOI_CELL` | 16 | AOI grid cell in metres |
| `AOI_ALL` | unset | `1`: AOI snapshots for every client, not only those connecting with `aoi=1` |
| `WS_SLOW_BYTES` / `WS_DEAD_BYTES` | 1 MB / 16 MB | skip snapshots / drop the socket when this much is queued |
| `HOGWARTS_VERIFY_SPATIAL` | unset | `1`: cross-check every spatial query against a full scan (debugging) |

## For the client streams

Things this stream cannot do from the server, in the order they pay off:

1. **Enable AOI for browsers** (3.6x less bandwidth): in `client/main.ts` `apply()`, when a wizard,
   creature or bolt is missing from a snapshot, dispose its geometries, materials and textures
   (including the label's `CanvasTexture`) — or keep a pool and hide/reuse models; puff only for a real
   death (e.g. a creature that vanished within ~100 m, inside the guaranteed 120 m; beyond that it
   merely left the area). Then add `&aoi=1` to the `/ws` URL in `connect()`. (The dispose half is worth
   doing anyway: today every death or logout leaks one model's GPU buffers.)
2. **Send at most one `input` per 50 ms** (the world tick), always including the final state (e.g.
   send immediately if 50 ms have passed since the last one, else schedule one for when they have).
   Nothing in the simulation changes; the server saves 5-35 % of a core per 500 players.
3. `client/i18n.ts` ERRORS: `[/^Slow down: too many messages/, () => '慢一点——消息发得太快了']`.
4. Optional: `/api/leaderboard?token=…` — no longer needed for REALMS (the routing cookie does it), but
   harmless and explicit.

## Reproduce

```bash
npx tsx scripts/bench.ts kernel --n=100,500,1000,2000,5000       # --secs=30 --warm=10 by default
npx tsx scripts/bench.ts trace --n=150 --secs=30                   # prints the fingerprint
npx tsx scripts/bench.ts net --k=50,200,500 --layout=spread,crowd --secs=15 --warm=5 --port=7900
npx tsx scripts/bench.ts net --k=500 --env=AOI_RADIUS=0            # AOI off for everyone
npx tsx scripts/bench.ts net --k=400 --realms=2                    # REALMS mode
npx tsx scripts/bench.ts net --k=500 --input-hz=144                # frame-rate input (fix pass)
npx tsx scripts/bench.ts net --k=500 --aoi=0 --input-hz=60         # the shipped client: full snapshots
npx tsx scripts/bench.ts churn --n=300 --secs=120 --aoi=0,140/0,140/10,140/20   # AOI enter/leave per client
# --out=results.jsonl appends machine-readable rows; BENCH_NODE_FLAGS="--cpu-prof" profiles the server.
```

To measure "before", check out `9b159fa`, copy `scripts/bench*.ts` into it and run the same commands.
