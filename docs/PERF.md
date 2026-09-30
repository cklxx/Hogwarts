# Performance: one world, many clients, many cores

This page records what was measured, on what, and how, before and after the performance pass
(branch `wf/perf`, base commit `9b159fa`), and in the review fix pass after it (`wf/perf-fix`,
[below](#fix-pass-frame-rate-input-full-snapshots-aoi-churn)). Every number comes from
`scripts/bench.ts`; you can re-run all of them (see [Reproduce](#reproduce)). The browser client's own pass
(`wf/fast`: draw calls, lights, level of detail, instancing, AOI in the client, load) is in
[Client (browser)](#client-browser-wffast), and the move to WebGPU (`wf/webgpu`: TSL, compute, node
post-processing, both backends measured) in [Client (browser): WebGPU](#client-browser-webgpu-wfwebgpu) at the end (since reverted: the client is back on WebGLRenderer).

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

(Items 1 and 2 are done in the client pass, [below](#client-browser-wffast).)

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

## Client (browser): wf/fast

The owner's complaint was the browser: 「太卡了」. This pass measured the client first, fixed what the
measurements pointed at, and measured again. Base: `main` at `c7665c4` (storybook art style and the
collision pass merged) plus the probe below; after: branch `wf/fast`.

### How it is measured

* **`?perf=1`** (`client/perf.ts`): an overlay (fps, frame ms mean / worst, pixel ratio, JS ms per frame,
  draw calls, triangles, programs, textures) and `window.__perf` for scripts: per-frame JS time split by
  section (`msg` = WebSocket messages incl. `JSON.parse` and `apply`, `hud` = the 10 Hz HUD, `anim` = entity
  interpolation and animation, `world` = sky/decor/scene tick, `fx` = particles, `ctl` = controls, `render` =
  the composer's submit), `renderer.info` summed over every pass of a frame (three.js resets it per
  `render()` call otherwise), draw calls per pass (shadow map, lake mirror, main, bloom mips, output),
  a census of what the scene holds (drawables and shadow casters per top-level object), WebSocket bytes,
  load milestones. Every hook is one boolean test when the probe is off.
* **`scripts/perf-client.ts`**: writes a world save with 60 enrolled bots (30 within 15 m of the courtyard
  spawn, 30 spread over the map), 12 NPCs, the wild pre-filled to 3x (80 creatures), and one viewer wizard
  at the spawn; starts the real server on it; drives the bots over WebSocket (`scripts/bench-clients.ts`:
  20 Hz input, random walk, a cast a second); opens the client in headless Chromium (SwiftShader) at
  `/?perf=1&capture=1&q=…#k=<viewer key>` with the pointer over the view, and records 8 s at each camera
  spot after 3 s: `follow` (the game camera behind you, in the crowd), `crowd` (the courtyard from 70 m),
  `castle` (the castle and grounds from above), `lake` (the Black Lake and its mirror), `overview` (the
  whole map from 220 m). Also Chrome's own counters (CDP `Performance.getMetrics`: layouts, style recalcs),
  long tasks, JS heap growth and drops, bytes over the wire per type, and optional CPU profiles
  (`--profile`), per-object census (`--census`, `--detail=`) and screenshots (`--shots=`).
* **Caveat**: SwiftShader renders on the CPU, and this 4-core box was shared with other agents' jobs
  (load average 7-10 during the runs), so frame rates (well under 1 fps) and absolute milliseconds are not
  what a laptop sees. Read **draw calls, triangles, shader programs, passes and bytes** as the GPU and
  network numbers, and the JS milliseconds as relative CPU costs measured the same way before and after
  (`render` includes the time the page waits on SwiftShader, so it tracks the GPU load too). Both builds ran
  back to back with identical settings, `&dyn=0` (no dynamic resolution) and 640x360.

### Summary

| | before | after |
|---|---:|---:|
| Draw calls per frame, 'high': in the crowd (game camera) / courtyard from 70 m / castle / lake / whole map | 1010 / 1478 / 2931 / 125 / 3832 | **348 / 446 / 540 / 106 / 500** |
| … 'low' | 815 / 1390 / 1365 / 179 / 1950 | **219 / 359 / 283 / 78 / 280** |
| Shadow-map draw calls per frame, in the crowd, 'high' | 243 | **37** (batched parts, far models instanced, redrawn every other frame) |
| Point lights every lit pixel evaluates (and that are compiled into every shader) | 77 (one per wizard online + lamps + spell pool) | **6** ('low' start: 4), fixed |
| Shader programs compiled after the first frame (20 s over five spots) | 2-4, plus **every lit shader again whenever a wizard came or went** (the light count changed) | **0** |
| Terrain picking under the pointer (every frame the pointer is over the view) | 7.9 ms | **0.016 ms** (500x) |
| Controls JS per frame with the pointer over the view (harness, all spots) | 9-48 ms | **0.3-2.3 ms** |
| `apply()` per snapshot | 2.0-14 ms | **0.25-0.9 ms** |
| Snapshot size (this 60-bot world; AOI now on) | 15-19 KB | **8-12 KB** (500 players spread: 98 → 27 KB, [fix pass](#fix-pass-frame-rate-input-full-snapshots-aoi-churn)) |
| Snapshots the page read per second in the harness (the server sends 10) | 1.0-2.1 (the page fell behind) | **6.2-13** |
| Movement input messages at 144 Hz (turning the camera) | 144 /s | **≤ 20 /s** (+4 Hz heartbeat) |
| Bytes to load the game (default style) | 967 KB | **240 KB** (Brotli; repeat visits: bundles cached for a year, the page revalidated) |
| … the two HDRIs of `?style=real` (files, measured compressed size) | 3.15 MB | 2.33 MB (Brotli 9; the WebP textures are already compressed) |
| Time to the first frame with the world in it (SwiftShader; ±30 % run to run on this box) | 63 s ('high') / 75 s ('low') | **50 s / 38 s** (the shader warm-up overlaps the gate and the WebSocket handshake) |
| JS heap growth / GCs per 8 s while playing | 0.0-0.45 MB/s / 0-1 | 0.17-1.2 MB/s / 0-4 (the page now parses 5-10x more snapshots a second; effects, labels and the frame loop no longer allocate per use) |
| Textures on the GPU (whole-map view) | 288 | **124** |
| fps in SwiftShader (not a GPU number; for the direction only) | 0.19-0.37 | 0.39-1.39 |

### Before / after per camera spot

Both builds back to back, same world, same bots, 8 s per spot after 3 s, 640x360, `&dyn=0`, pointer over
the view. JS columns are CPU milliseconds on this (shared, SwiftShader) box, averaged over only 3-8 frames
per spot: compare them within a row, not with a laptop. "render submit" is the composer's `render()`, which
includes waiting on SwiftShader.


**q=high** (before → after)

| | follow | crowd | castle | lake | overview |
|---|---:|---:|---:|---:|---:|
| draw calls | 1010 → **348** | 1478 → **446** | 2931 → **540** | 125 → **106** | 3832 → **500** |
| triangles (k) | 555 → **429** | 673 → **403** | 1261 → **514** | 335 → **361** | 1349 → **499** |
| shader programs | 73 → **120** | 76 → **122** | 78 → **126** | 80 → **128** | 82 → **129** |
| textures | 115 → **72** | 168 → **100** | 201 → **117** | 164 → **119** | 288 → **124** |
| render submit ms/frame | 35.6 → **17.5** | 37.5 → **13.9** | 102 → **17.2** | 28.1 → **6.6** | 133 → **10.0** |
| anim ms/frame | 3.02 → **10.33** | 3.13 → **1.40** | 4.90 → **1.10** | 4.90 → **1.37** | 4.67 → **0.73** |
| controls ms/frame | 22.02 → **1.15** | 9.10 → **0.93** | 10.03 → **2.32** | 47.67 → **0.34** | 9.17 → **0.60** |
| WebSocket ms/s | 8.3 → **5.5** | 4.5 → **7.7** | 4.7 → **4.2** | 10.4 → **9.0** | 7.6 → **3.3** |
| HUD ms/s | 1.16 → **4.66** | 0.06 → **0.20** | 0.24 → **0.15** | 0.34 → **0.51** | 0.16 → **0.47** |
| apply ms/snapshot | 3.65 → **0.78** | 2.85 → **0.90** | 1.98 → **0.70** | 2.39 → **0.52** | 2.89 → **0.32** |
| parse ms/snapshot | 0.29 → **0.10** | 0.17 → **0.17** | 0.10 → **0.14** | 0.34 → **0.11** | 0.54 → **0.10** |
| snapshot KB | 15.2 → **11.0** | 16.2 → **11.7** | 16.3 → **11.1** | 16.9 → **10.8** | 16.7 → **10.4** |
| style recalcs/s | 0.27 → **0.89** | 0.06 → **0.42** | 0.06 → **0.35** | 0.18 → **0.69** | 0.10 → **0.46** |
| layouts/s | 0.14 → **0.39** | 0.00 → **0.00** | 0.00 → **0.00** | 0.00 → **0.00** | 0.00 → **0.00** |
| fps (SwiftShader) | 0.27 → **0.39** | 0.19 → **0.63** | 0.19 → **0.47** | 0.37 → **1.04** | 0.30 → **0.69** |

**q=low** (before → after)

| | follow | crowd | castle | lake | overview |
|---|---:|---:|---:|---:|---:|
| draw calls | 815 → **219** | 1390 → **359** | 1365 → **283** | 179 → **78** | 1950 → **280** |
| triangles (k) | 445 → **276** | 517 → **267** | 513 → **265** | 231 → **200** | 550 → **256** |
| shader programs | 65 → **112** | 70 → **113** | 72 → **116** | 74 → **116** | 75 → **117** |
| textures | 68 → **55** | 173 → **74** | 212 → **83** | 171 → **84** | 296 → **89** |
| render submit ms/frame | 53.8 → **10.9** | 29.2 → **8.7** | 36.9 → **8.2** | 29.0 → **4.5** | 112 → **7.0** |
| anim ms/frame | 8.87 → **8.48** | 3.05 → **2.64** | 2.63 → **0.94** | 2.87 → **0.95** | 3.83 → **0.66** |
| controls ms/frame | 18.13 → **0.78** | 8.65 → **0.49** | 9.77 → **0.70** | 10.23 → **0.41** | 9.03 → **0.32** |
| WebSocket ms/s | 14.4 → **11.6** | 5.7 → **10.3** | 8.6 → **4.7** | 15.0 → **3.9** | 8.3 → **5.8** |
| HUD ms/s | 2.01 → **1.85** | 0.55 → **0.63** | 0.18 → **0.60** | 0.38 → **0.77** | 0.25 → **0.34** |
| apply ms/snapshot | 14.34 → **0.68** | 2.13 → **0.53** | 2.81 → **0.27** | 3.61 → **0.25** | 3.79 → **0.49** |
| parse ms/snapshot | 0.43 → **0.18** | 0.21 → **0.18** | 0.60 → **0.09** | 0.20 → **0.09** | 0.21 → **0.12** |
| snapshot KB | 18.8 → **9.4** | 19.2 → **9.0** | 16.6 → **9.3** | 17.3 → **8.5** | 17.1 → **8.2** |
| style recalcs/s | 0.24 → **1.62** | 0.29 → **0.78** | 0.24 → **0.77** | 0.35 → **1.51** | 0.21 → **0.61** |
| layouts/s | 0.08 → **0.75** | 0.00 → **0.00** | 0.00 → **0.00** | 0.00 → **0.00** | 0.00 → **0.00** |
| fps (SwiftShader) | 0.24 → **0.86** | 0.39 → **1.01** | 0.36 → **0.99** | 0.69 → **1.39** | 0.31 → **0.97** |




Notes on the rows that went up: *shader programs* — the instanced variants (crowd, statues, batched parts,
glow quads) are extra programs, but all of them are compiled while the veil is up (see warm-up below) and
none after; *anim* in the crowd at 'high' now also copies ~30 wizards' part matrices and runs the level of
detail (and, averaged over 4 frames, is mostly label repaints — the canvas work moved from `apply` to the
frame that shows a tag); *style recalcs* rose from ~0.2 to ~0.4-1.6 a second because the client now reads
all ~10 snapshots a second instead of 1-2 (still nothing next to a frame's budget).

### What changed, by measured impact

1. **Draw calls, 3-8x fewer** (GPU and the renderer's CPU submit alike):
   * *Far wizards* (beyond 42 m at 'high', 24 m at 'low', with 4 m of hysteresis; your own wizard, your
     target and a stunned wizard never) are one instanced low-poly model (`crowd.ts`, `models.ts`
     `farWizardGeometry`: ~230 triangles, closed robe, sleeves, head, hat, scarf; robe and trim colour per
     instance from the house or the glamour worn; a stride bob) plus one instanced ink outline: 2 draw calls
     (1 in the shadow map) for all of them, where each full model is ~17 (5).
   * *Near wizards' shared parts* (legs, jumper, arms, head, hat, wand, head and hat outlines: same geometry
     and material across wizards) are drawn instanced across every near wizard (`partbatch.ts`): the parts
     stay in their models and animate as before, on a layer the cameras skip, and their world matrices are
     copied into one InstancedMesh per kind each frame. Beyond 22 m the scarf tails and an unlit wand are
     left out (`setMid`).
   * *Far creatures* (beyond 70 m, where they stopped animating anyway) are statues, one instanced mesh per
     kind baked from the kind's own model (`herd.ts`); beyond 170 m (110 m at 'low') they are not drawn.
   * *Spells in flight* (a sphere and two sprites each) are one instanced core mesh and one batch of
     camera-facing glow quads (`bolts.ts`, `billboards.ts`): 2 draw calls for any number of bolts.
   * *Name tags* are drawn within 45 m (30 m at 'low') and always on your target; a hidden tag is not
     repainted or re-uploaded until it is shown again (the 512x160 canvas upload per hp change was the
     costliest part of `apply`).
   * *Static world* (castle walls, towers, roofs, huts, props): merged per material, per 64 m cell and per
     shadow flag into world-space meshes (`batch.ts`): 106 of 259 meshes into 31. What may be merged is
     measured, not listed: the scene's own tick is run at several times, hours and player positions and
     through a quality switch, and anything whose matrix, visibility, geometry or material changed (83:
     clock hands, the Willow, the squid, candles, the Great Hall roof, quality-dependent frames) is left alone.
   * *Floating candles* (48 meshes + 48 glow sprites, bobbed by `scene.ts`) are drawn instanced from their
     live transforms (`instancer.ts`).
   * *Effects* (rings, puffs, pillars, damage numbers, lightning) are pooled with shared geometry, and damage
     number textures cached by text and colour (`effects.ts`): no geometry, material or canvas texture per
     effect any more — and disposing the last material of a kind no longer frees its shader program (the
     next puff recompiled it).
   * *Lake mirror* leaves wizards, creatures and spells out and refreshes every other frame (the instanced
     crowd and statues still reflect).
   * *Shadow map* redrawn every other frame (`shadowMap.autoUpdate = false`): the light's shadow matrix is
     updated only with it, so what is drawn always matches the map; a moving wizard's shadow lags one frame.
2. **Lights** (`lights.ts`): every wizard carried a Lumos point light (intensity 0 unless lit), so with 60
   online every lit pixel looped over 77 point lights, and each wizard who came or went changed the count
   compiled into every shader — all ~60 lit programs recompiled, a hitch of seconds on Windows/ANGLE. Now
   every point light is a *source*, hidden, and each frame the 6 that matter (lit, nearest the player
   relative to their range, with hysteresis) are copied into 6 real lights that never change in number
   (4 when the game starts at 'low'; the automatic switch to 'low' recompiles nothing).
3. **Controls: terrain picking** (`terrain.ts` `rayGround`): the pointer's ground point was a raycast
   against the 131 000-triangle terrain mesh on every frame the pointer was over the view — **7.9 ms** a
   frame on this box, half a 60 Hz budget; it is now marched along the height grid the mesh is built from
   (`surfaceAt`, exact on the rendered triangles): **0.016 ms**, same point (tested to 5 cm on 300 rays).
4. **Network**: the client takes **area-of-interest snapshots** by default (`&aoi=1`; `?aoi=0` asks for the
   whole world). Wizards who leave the area are *parked* (kept out of the scene for 90 s, up to 96) and come
   back as the same model; creatures go back to a pool per kind; only a creature or bolt that vanishes within
   100 m of you (the server always sends everything within 120 m) gets its death puff or impact burst.
   Parked models past their time and pool overflow are **disposed** (their own materials, geometries, tag
   texture, lights — the old client leaked one model's GPU buffers per death or logout). **Input** is sent at
   most once per 50 ms world tick, always ending on the latest state (it was every frame the rounded input
   changed: 144 messages a second on a 144 Hz display while turning). Bandwidth and server CPU for both are
   in the [fix pass](#fix-pass-frame-rate-input-full-snapshots-aoi-churn) tables (500 players: 981 → ~270 KB/s
   per client; input 144 → 20 Hz saves 12-36 % of a server core).
5. **Load**: the server (`src/server/static.ts`) serves the build from memory with the `.br` / `.gz` files the
   build writes (`vite.config.ts`), `Cache-Control: immutable` for the hashed bundles, ETag / 304 for the
   page and assets (it read every file from disk on every request, uncompressed, uncached): **967 → 240 KB**.
   Shaders are **compiled while the veil and the gate are up** (`compileAsync`, `KHR_parallel_shader_compile`
   where available) for the composer's render target — the world, a wizard, every creature kind, the
   crowd, statues, bolts, effects, tags — and three.js's per-program error check (a synchronous GPU
   read-back) is off outside development: **0 programs compiled after the first frame** in any spot (before:
   the lake's mirror on first sight, a puff after the last one faded, every lit shader on each join/leave).
6. **Post-processing and resolution**: the colour grade runs inside the output pass (`post.ts`: one
   full-screen HDR pass fewer, same result); **dynamic resolution** (`dynres.ts`) steps the pixel ratio down
   15 % when frames average over 20 ms and back up 10 % after 8 s steady at 60 Hz (a step up that fails
   within 3 s is undone and the next try waits 4x longer), within 0.6x-min(2, DPR) at 'high' and
   0.5-0.75x at 'low'; `?dyn=0` turns it off. 'low' uses 2x MSAA instead of 4x. Phones and tablets (coarse
   pointer, small screen) start at 'low' instead of spending 3 s at 'high' first.
7. **DOM / allocations**: the 10 Hz HUD writes a text, style or attribute only when it changed (hotbar,
   bars, overlay, target frame), the action prompt's width is measured once per label instead of every
   frame (a forced layout), and the frame loop no longer allocates per frame (bolt light list, willow
   check, focus vector). The DOM was never the big cost here (under 1 layout a second before and after);
   these changes are structural, so the coming UI reskin keeps them.

### Known issues and what is left

* **SwiftShader is not a GPU**: no frame rate here says what a laptop will do. The GPU-side claims rest on
  draw calls, triangles, passes, lights and programs; a real-device check (Intel Iris Xe laptop at 'high',
  a mid-range phone at 'low') is still owed.
* The crowd's far model has one skin tone, no walk cycle (a bob), no hands or legs, and glamours show only
  as robe and trim colours; statues do not animate. Both only beyond 42 m / 70 m (24 m at 'low').
* Snapshots are still JSON (parse is 0.1-0.2 ms each with AOI); a binary or delta encoding would cut bytes
  3-5x more but needs server work, and the MCP/JSON APIs must stay — not done.
* The terrain is one 131 000-triangle mesh (culled whole); tiling it would let frustum culling drop the half
  behind the camera. The storybook bakes three sky environment maps at start (PMREM), which dominates the
  SwiftShader load time; lazily baking dusk and night would help weak GPUs.
* The light budget shows at most 6 point lights near you; in a crowd of Lumos wands and bolts the farther
  ones stay dark. A decree that builds a statue still adds its spotlight (one recompile, rare).
* Per-frame averages in the tables cover 3-8 frames per spot (SwiftShader's frame rate); the load timings
  moved by ±30 % between runs on this shared box.

### Reproduce

```bash
npx vite build
npx tsx scripts/perf-client.ts --port=8820 --q=high,low --secs=8 --warm=3 --size=640x360 --census --url='&dyn=0'
#   --spots=follow,crowd,castle,lake,overview,close  --bots=60 --crowd=30 --npcs=12  --aoi=0|1
#   --shots=dir (screenshots, HUD hidden)  --profile | --profile=spot (CPU profile)  --detail=Mesh,Group
#   --out=results.jsonl  --label=after ;  PLAYWRIGHT_CORE=… CHROMIUM=… to point at your own
# in the game: ?perf=1 (overlay) · ?lod=0 (every model in full) · ?dyn=0 · ?aoi=0 · ?q=low|high
```
For "before", check out `c7665c4`, cherry-pick `32c5bbe` (the probe hooks in `client/main.ts`), copy
`client/perf.ts` and `scripts/perf-client.ts` from this branch, build, and run the same command.


## Client (browser): WebGPU (wf/webgpu)

> **Reverted on `wf/webgl`.** The client is back on `WebGLRenderer`. Players who open the game over LAN HTTP get no WebGPU (secure contexts only), and the WebGPU renderer's WebGL 2 fallback was slower than the classic renderer. Same machine (SwiftShader), 1280x720, 'high', `perf-client.ts --spots=crowd,follow --secs=8`: 0.24 / 0.25 fps → **0.54 / 0.49 fps**, first frame 42.3 → **25.0 s**, shader warm-up 18.5 → **0.16 s**, JS 355 → **268 KB**. The notes below record the WebGPU work (merge `205ed7b`) for a possible desktop micro-client.

The owner's ask: 「能极致的使用 webgpu 吗」. This pass moved the client to three.js's `WebGPURenderer` (r186),
rewrote every shader in TSL, put particles and grass on compute shaders, and rebuilt post-processing as one
node graph; then measured it on both of the new renderer's backends against `main`. Before: `main` at
`e9ff002` (wf/view merged: `WebGLRenderer`, shader-chunk patches, `EffectComposer`), plus the capture hook the
screenshots need. After: branch `wf/webgpu`, run twice: on WebGPU, and with `?gpu=webgl` (the same renderer's
WebGL 2 backend, which is what a browser without WebGPU gets).

### What changed

* **Renderer** (`client/gpu.ts`, `client/render.ts`): `WebGPURenderer`, `await renderer.init()`; it falls back to
  WebGL 2 by itself when there is no `navigator.gpu`, no adapter, or `init()` fails, and `?gpu=webgl` forces the
  fallback. The `?perf=1` overlay shows the backend and why WebGPU was not used, GPU ms (timestamp queries,
  WebGPU only), pipelines, live particles and grass sites. Automatic quality, dynamic resolution and `?capture=1`
  work as before.
* **All shading in TSL**, one source compiled to WGSL or GLSL (`onBeforeCompile`, `ShaderChunk` and
  `ShaderMaterial` are gone from the client):
  * the storybook look (`client/storybook.ts`): a lighting model (a `PhysicalLightingModel` subclass: the banded
    light ramp, the rim light, the lining colour of cloth seen from behind), registered for
    `MeshStandardMaterial` / `MeshPhysicalMaterial`, so every plain material in the game becomes a storybook node
    material when the renderer converts it; the height-tinted fog is the scene's `fogNode`;
  * wind (grass, tree crowns, pennants, banners, robes: one shared node graph, the per-object sway read from the
    object), glamour materials (starlight, flame, ghost), ink outlines, particles, glow billboards, the painted sky,
    clouds, stars (sized point sprites: WebGPU points are 1 px), aurora, the lake (`ReflectorNode`), and for
    `?style=real` three.js's `SkyMesh` and `LensflareMesh`;
  * `client/view.ts` (merged from wf/view): the occluder fade is a `maskNode` (4x4 ordered dither in the cut-outs
    around the player and the target), the x-ray silhouette a node material drawn with depth Greater and
    stencil Equal 1 (the scene pass has a depth-stencil target). Both checked in an isolated scene on both
    backends; `scripts/view-audit.ts --gpu=webgpu|webgl`: **100 %** of 500 camera
    samples see the player on both (92.8 % before the camera rig).
* **Compute (WebGPU)**:
  * *Particles* (`client/fx.ts`): the CPU writes only spawn records (position, velocity, colour, gravity and drag)
    into a ring buffer; a compute pass integrates drag and gravity over **the live window only** (the span of the
    ring that can still hold a living particle) and bounces sparks and embers off the terrain (a 257² height
    texture); the vertex shader reads the simulated state. Budgets: **131 072** at 'high' (98 304 glow +
    32 768 smoke), 32 768 at 'low'; the WebGL 2 fallback keeps the analytic vertex-shader path, 20 480 (sparks
    fall through the ground there, as before). `?particles=N` overrides the budget.
  * *Grass* (`client/grass.ts`): every frame a compute pass visits a lattice of clump sites around the camera
    (**23 716** at 'high', 2 601 at 'low'), grows a clump where the ground's density texture says so, culls it
    against the view frustum and thins it with distance, and appends the survivors with an atomic counter that is
    the instance count of one **indirect draw**: the whole field is one draw call and the CPU sets four uniforms. The
    WebGL 2 fallback keeps the CPU chunks.
  * *GPU culling of props*: not done. Trees, candles, the far crowd and creature statues are already one or two
    instanced draws each (wf/fast); there was nothing left to measure.
* **Post-processing** (`client/post.ts`): a `RenderPipeline`: the scene pass (HDR, 4x MSAA at 'high', 2x at
  'low', depth-stencil) → bloom (half resolution, bright parts only; not at 'low') → one output pass with the
  colour grade, paper grain, vignette, tone mapping and sRGB. One full-screen pass fewer than `main`'s composer.
* **Compile hitches** (see the next table for what each fix measured): the warm-up compiles for the post pass's
  target with frustum culling off, then draws one frame from above the lake (shadow map, mirror and post
  pipelines, which `compileAsync` does not build); instanced meshes use instanced attributes instead of uniform
  buffers (three.js otherwise gives every instanced mesh with ≤1024 instances a program of its own); the sky
  environment is one render target re-baked per phase (a new environment texture recompiled ~57 programs);
  hidden-until-used meshes (empty grass chunks, particle pools) and the particle compute are warmed too; the
  warm-up wizards' Lumos lights are hidden like every other wizard's.
* **Texture uploads**: every canvas that becomes a texture (name tags, damage numbers, the procedural textures) is
  a CPU canvas (`willReadFrequently`). Uploading a GPU-backed 2D canvas into a WebGPU texture waits for the GPU
  to finish its queue: ~1 s per name tag on SwiftShader in a busy frame (a 0.5-0.8 s stall whenever tags
  appeared), 1-4 ms from a CPU canvas.

### How it is measured

The same harness as wf/fast (`scripts/perf-client.ts`), with these differences:

* **`--url=&dyn=0` now means it.** The harness split every argument at each `=`, so `--url='&dyn=0'` arrived as
  `&dyn` and dynamic resolution stayed **on** in all of wf/fast's runs (the before/after comparisons there are
  still like for like). Arguments are now split at the first `=`; the tables below are at a fixed 640x360.
* **Browser flags** (all three builds): `--enable-unsafe-webgpu --enable-features=Vulkan --use-vulkan=swiftshader
  --use-angle=swiftshader --use-webgpu-adapter=swiftshader`: WebGPU on SwiftShader's Vulkan, WebGL on ANGLE's
  SwiftShader (with the WebGPU adapter alone, this Chromium loses the WebGPU device).
* **A quiet world** for the main tables: `--bots=0 --npcs=0` (the viewer, 80 creatures). With 60 bots casting
  every second, SwiftShader's ~1 fps turns the harness into slow motion (the frame step is capped at 0.1 s, so every
  effect lives ten times longer in wall time, and 100 000+ particles were alive at once on WebGPU), which measures
  the harness more than the renderer. A busy run is at the end, with that caveat.
* Three builds back to back, same world, 8 s per spot after 3 s, `--census` (programs compiled after the first
  frame). New columns: backend, pipelines, GPU ms (WebGPU timestamp queries, averaged over resolved frames),
  particles simulated and drawn, particle and grass budgets. `--dump=dir` logs what every program compiled after
  the first frame was built for and why (it found the Lumos-light and texture-upload problems above).
* **SwiftShader is still not a GPU**, and it is a slower WebGPU than it is a WebGL: frame rates and GPU ms here do not
  predict a laptop. Read draw calls, triangles, programs, pipelines and compile counts as the renderer's work, and
  compare the millisecond rows only within a row.

### Summary

| | main (WebGLRenderer) | **WebGPU** | WebGL 2 fallback |
|---|---:|---:|---:|
| Draw calls, 'high': follow / crowd / castle / lake / overview | 121 / 229 / 259 / 65 / 254 | **119 / 222 / 254 / 62 / 234** | 118 / 243 / 287 / 59 / 250 |
| … 'low' | 103 / 190 / 160 / 32 / 167 | **102 / 176 / 155 / 31 / 162** | 98 / 190 / 155 / 30 / 162 |
| Full-screen post draws per frame at 'high' (bloom mips, composite, output) | 14 | **13** (the bloom is added in the output pass, with the grade, grain, tone mapping and sRGB) | 13 |
| Shader programs compiled after the first frame (5 spots, 'high' / 'low') | 0 / 0 | **0 / 0** (was 7-9 / 4-6 before the fixes below) | 0 / 0 |
| Programs at the first frame ('high') | 121 | **179 stages, 121 pipelines** (was 225 / 149) | 160 (89 pipelines) |
| Time to the first frame with the world ('high' / 'low') | 21.4 / 18.3 s | **21.4 / 17.6 s** | 21.3 / 17.9 s |
| Shader warm-up before it ('high' / 'low'; SwiftShader) | 0.14 s ¹ | **20.4 / 16.7 s** | 14.6 / 6.7 s |
| Particle budget ('high' / 'low') | 20 480 (vertex shader) | **131 072 / 32 768** (compute, live window only, ground bounce) | 20 480 / 20 480 |
| Grass | CPU chunks (7x7 at 'high', culled per chunk) | **23 716 sites culled one by one, 1 indirect draw** ('low': 2 601) | CPU chunks |
| fps, 'low' (SwiftShader; direction only) | 1.75-3.25 | **3.25-5.5** | 1.37-2.87 |
| fps, 'high' | 0.75-1.75 | **0.87-1.5** | 0.75-1.37 |
| Render submit (CPU ms/frame, 'high') | 3.3-7.5 | **6.0-9.9** | 5.5-15.2 |
| JS heap peak | 38 MB | **92 MB** ('low': 113) | 152 MB |
| JavaScript to download (Brotli) ² | 257 KB (one chunk, 1 040 KB raw) | **346 KB** (three 216 + game 118 + layout 10.5; 1 374 KB raw) | same build |

¹ `main` compiles with `KHR_parallel_shader_compile` in the background and links on first use; its first frame
still arrives at the same time because it waits on the gate and the snapshot. The node renderer builds its
programs itself (node graph → WGSL/GLSL) before it can compile them, which is the CPU time in the warm-up; on
SwiftShader the WebGPU pipeline compile is also slower than the WebGL one. ² Current `main` (`79d215a`) built the
same way; the three.js chunk (WebGPU renderer, node system, both backends) is cached separately from the game code.

### Per camera spot

Quiet world, 640x360, `&dyn=0`, 8 s per spot after 3 s. Each cell: `main` → **WebGPU** / WebGL 2 fallback.
"programs" counts shader stages on WebGPU (a vertex and a fragment module per pipeline) and linked programs on
WebGL. "particles simulated + drawn" is the live window on WebGPU and the ring drawn up to its newest particle on
WebGL 2 (dead quads are discarded in the vertex shader).

**q=high** (main → **WebGPU** / WebGL 2)

| | follow | crowd | castle | lake | overview |
|---|---:|---:|---:|---:|---:|
| draw calls | 121 → **119** / 118 | 229 → **222** / 243 | 259 → **254** / 287 | 65 → **62** / 59 | 254 → **234** / 250 |
| triangles (k) | 253 → **254** / 263 | 297 → **261** / 305 | 432 → **415** / 464 | 246 → **247** / 250 | 426 → **374** / 439 |
| shader programs (WebGPU: stages) | 121 → **179** / 160 | 126 → **179** / 160 | 128 → **179** / 160 | 129 → **179** / 160 | 130 → **179** / 160 |
| render pipelines | **121** / 89 | **121** / 89 | **121** / 89 | **121** / 89 | **121** / 89 |
| render submit ms/frame | 3.9 → **7.5** / 8.8 | 6.3 → **9.8** / 11.0 | 7.5 → **9.9** / 15.2 | 3.3 → **6.0** / 5.5 | 7.0 → **9.9** / 12.4 |
| JS ms/frame (all sections) | 5.8 → **10.2** / 11.4 | 8.3 → **12.8** / 14.2 | 8.8 → **11.5** / 17.0 | 4.9 → **7.4** / 7.3 | 8.1 → **11.1** / 13.6 |
| GPU ms/frame (timestamp queries) | **314** | **353** | **339** | **199** | **398** |
| frame p50 ms | 807 → **1011** / 960 | 900 → **1033** / 999 | 1137 → **1146** / 1293 | 588 → **683** / 755 | 1039 → **1321** / 1405 |
| fps (SwiftShader) | 1.00 → **1.00** / 1.00 | 1.25 → **1.12** / 1.00 | 0.75 → **0.87** / 0.87 | 1.75 → **1.50** / 1.37 | 1.00 → **0.87** / 0.75 |
| particles simulated + drawn | **20** / 4096 | **37** / 4096 | **52** / 4096 | **77** / 4096 | **93** / 4096 |
| JS heap peak MB | 38 → **92** / 152 | 38 → **92** / 152 | 38 → **92** / 152 | 38 → **92** / 152 | 38 → **92** / 152 |

**q=low** (main → **WebGPU** / WebGL 2)

| | follow | crowd | castle | lake | overview |
|---|---:|---:|---:|---:|---:|
| draw calls | 103 → **102** / 98 | 190 → **176** / 190 | 160 → **155** / 155 | 32 → **31** / 30 | 167 → **162** / 162 |
| triangles (k) | 219 → **218** / 225 | 222 → **220** / 229 | 234 → **232** / 240 | 163 → **162** / 171 | 226 → **223** / 243 |
| shader programs (WebGPU: stages) | 111 → **170** / 150 | 117 → **171** / 150 | 119 → **171** / 150 | 120 → **171** / 150 | 120 → **171** / 150 |
| render pipelines | **116** / 82 | **117** / 82 | **117** / 82 | **117** / 82 | **117** / 82 |
| render submit ms/frame | 3.2 → **5.8** / 7.0 | 4.6 → **6.6** / 9.0 | 3.9 → **6.3** / 6.7 | 2.2 → **3.2** / 3.7 | 4.1 → **5.7** / 8.1 |
| JS ms/frame (all sections) | 4.7 → **7.3** / 8.6 | 6.0 → **8.1** / 10.5 | 5.3 → **7.7** / 8.0 | 3.5 → **4.4** / 4.8 | 5.1 → **6.7** / 9.1 |
| GPU ms/frame (timestamp queries) | **94** | **75** | **65** | **38** | **71** |
| frame p50 ms | 490 → **307** / 599 | 525 → **257** / 602 | 479 → **287** / 598 | 300 → **168** / 341 | 565 → **298** / 698 |
| fps (SwiftShader) | 2.00 → **3.25** / 1.62 | 1.87 → **3.87** / 1.62 | 2.00 → **3.50** / 1.62 | 3.25 → **5.50** / 2.87 | 1.75 → **3.25** / 1.37 |
| particles simulated + drawn | **21** / 4096 | **61** / 4096 | **66** / 4096 | **49** / 4096 | **44** / 4096 |
| JS heap peak MB | 36 → **113** / 111 | 36 → **113** / 111 | 36 → **113** / 111 | 36 → **113** / 111 | 36 → **113** / 111 |

What the rows say:

* **Draw calls** are the same or lower on WebGPU (one indirect draw for the grass, one pass fewer in post); the
  WebGL 2 fallback draws a few more at the crowd and castle spots (the CPU grass chunks).
* **Triangles** are lower on WebGPU where there is grass in view (it culls clump by clump, the CPU field chunk
  by chunk).
* **Programs** are higher on both new backends: the node renderer compiles one program per material *and* per
  object kind (instanced or not, shadow receiver or not), and the post pipeline, bloom, mirror and compute are
  programs of their own. All are compiled behind the loading veil (0 after the first frame).
* **CPU per frame** (render submit, JS): the node renderer does more per draw on the CPU than `WebGLRenderer`
  (render objects, bind groups, node updates): +2-4 ms a frame here. That is the price of the new renderer on
  this box; on a real GPU the WebGPU backend's own submit (no GL state machine, pipelines prebuilt) should be
  cheaper than WebGL's, which SwiftShader cannot show.
* **fps**: WebGPU is ahead at 'low' (3.25-5.5 against 1.75-3.25), about level at 'high'; the WebGL 2 fallback is
  a little behind `main` everywhere (the same GPU work plus the node renderer's CPU cost). GPU ms (timestamp
  queries) are SwiftShader's: 200-400 ms at 'high', 40-95 ms at 'low'.

### What was fixed by measuring (compile hitches and stalls)

| Measured | Before | After |
|---|---:|---:|
| Programs compiled after the first frame, first WebGPU build (walking into a crowd) | 124-177 | uniform-buffer instancing off: 9-15 |
| … frustum culling during `compileAsync`, shadow / mirror / post pipelines, one env target, 4 houses warmed | 9-15 | 7-9 |
| … the warm-up wizards' Lumos lights (4 extra point lights: every lit shader was compiled for a light set the game never draws with, then again on the first frame) | 7-9 ('high'), 225 at the first frame | **0**, 179 at the first frame |
| … empty grass chunks (WebGL 2), hidden particle pools and their compute, pools sized before the warm-up | 2-6 ('low') | **0** |
| Worst stall at the crowd spot, WebGPU 'high' (name tags uploaded from GPU canvases) | 510-800 ms average render per frame over 8 s, 1 s per tag | **9.8 ms** |
| Warm-up, WebGPU 'high' (±20 % run to run) | 24-26 s | 20-21 s |

### A busy world (with the caveat)

The default harness world (60 bots casting every second, 12 NPCs), 'high', same flags. On SwiftShader every
backend runs at under 1 fps here, so the game runs in slow motion (0.1 s of game time per frame) while the bots
keep casting in wall time: effects and particles pile up, and the slower a backend is, the more it has to draw.
WebGPU keeps every particle its budget allows (106 000-117 000 alive, against the 20 480 the others are capped
at), so it is also run with `?particles=16384`, the WebGL budget.

| 'high', follow / crowd / castle / lake / overview | main | WebGPU | WebGPU, `?particles=16384` | WebGL 2 fallback |
|---|---:|---:|---:|---:|
| draw calls | 382 / 527 / 704 / 106 / 724 | 592 / 976 / 806 / 130 / 874 | **440 / 699 / 583 / 93 / 713** | 416 / 562 / 614 / 134 / 808 |
| triangles (k) | 465 / 395 / 507 / 348 / 504 | 641 / 629 / 958 / 689 / 818 | **470 / 444 / 505 / 433 / 563** | 536 / 458 / 538 / 491 / 589 |
| particles alive | ≤ 20 480 | 106 000-117 000 | **20 480** | 20 480 |
| fps (SwiftShader) | 0.62-0.75 | 0.25-0.37 | **0.37-0.50** | 0.37-0.50 |
| GPU ms/frame (timestamp queries) | - | 640-9 900 | **370-3 000** | - |
| programs compiled after the first frame | 0 | 0 | **0-2** | 0 |
| shader warm-up / first frame | 0.16 / 25.5 s | 113 / 114 s | **68 / 69 s** | 14 / 22 s |

Read with the caveat above: with the same particle budget WebGPU draws what the WebGL 2 fallback draws and runs
at the same frame rate, both a little behind `main` (the node renderer's CPU cost); the larger budget is what
costs SwiftShader. The one number that looks bad for WebGPU is the warm-up under load: with the server, 60 bot
connections and the browser on 4 cores, SwiftShader's WebGPU pipeline compiles took 68-113 s where its WebGL
ones took 14 s (quiet: 20 s against 15 s). That is SwiftShader's compiler competing for the CPU, not something a
GPU driver does, but it is why the WebGPU warm-up time must be re-measured on real hardware.

### Screenshots

`scripts/gpu-shots.ts` (a world with seven glamour wizards and 24 bots, fixed hours and weather, HUD hidden)
shoots castle at dusk, the courtyard by day, the forest, night with the aurora, a glamour close-up, spells in
flight, the lake and a meadow, from `main`, WebGPU and the WebGL 2 fallback: `wg-main2-*.png`, `wg-gpu2-*.png`,
`wg-gl2-*.png` (not committed; the command is under Reproduce). The three agree in light, fog, sky, outlines, glamours, water and grass; the
differences are live things (bots in other places, clouds drifting, more dust in the air on WebGPU, which keeps
every particle of a burst that the old budget dropped).

### Known issues and what is left

* **No real GPU was measured**: this box has only SwiftShader. Frame time and GPU time on an integrated-graphics
  laptop and a mid-range phone (`?perf=1` shows both) are still owed, and are where WebGPU's lower draw overhead
  and the compute paths should show.
* **Warm-up time**: 15-21 s on SwiftShader before the first frame, most of it building and compiling ~120 pipelines;
  real GPUs compile far faster, but the node renderer's CPU-side build (~2-3 s here) remains.
* **CPU per draw**: the node renderer's submit costs more CPU than `WebGLRenderer` for the same draws. Render bundles
  (WebGPU) for the static batches would cut it; not done.
* The lake is no longer darkened by shadows (the TSL water does not sample the shadow map).
* Sparks bounce off the ground only on WebGPU (the WebGL 2 fallback has no compute; they fall through, as before).
* The automatic switch from 'high' to 'low' rebuilds the particle pools: 2 programs compile then (once).
* JS heap is higher (92-150 MB against 38 MB): node graphs, render objects and bind groups per object.
* The bundle is ~89 KB larger (Brotli), all of it in the separately cached three.js chunk.

### Reproduce

```bash
npx vite build
npx tsx scripts/perf-client.ts --port=9002 --gpu=webgpu --q=high,low --secs=8 --warm=3 --size=640x360 --census \
  --url='&dyn=0' --bots=0 --npcs=0 --label=webgpu --out=results.jsonl
#   --gpu=webgl: the WebGL 2 fallback (?gpu=webgl)   --dump=dir: what compiled after the first frame, and why
npx tsx scripts/gpu-shots.ts --gpu=webgpu --label=wg --out=shots        # castle-dusk, courtyard-day, forest, …
npx tsx scripts/view-audit.ts --gpu=webgpu                              # camera audit on either backend
# in the game: ?perf=1 · ?gpu=webgl · ?compute=0 (WebGPU without compute: the fallback paths) · ?particles=N
```
For "before", build `e9ff002` with this branch's `scripts/perf-client.ts` and `scripts/gpu-shots.ts`, and
`client/capture.ts`'s hour and weather fields wired into its `render.update` (the screenshots set both); a build
from before the WebGPU renderer ignores `?gpu=webgl`.

## Kernel: gameplay as feature plugins (wf/plugins)

决斗俱乐部、魁地奇、事件轮盘、集市和 O.W.L. 考试从 `world.ts` 里拆成了 `Feature`（`src/kernel/feature.ts`）。
内核改为遍历预先建好的钩子表（`HOOKS`，模块加载时只建一次），不再按名字调用。开销来自每个巫师每 tick
一次 `moveMult`，以及每发弹道一次 `bolt`（1000 人时约 1–3 千次提前返回的函数调用，约 10 µs/tick）。

`npx tsx scripts/bench.ts kernel --n=100,500,1000,2000 --secs=15 --warm=5`，同一台空闲机器，`main` = `729768b`：

| wizards | main mean (p50 / p95) ms | plugins mean (p50 / p95) ms | Δ mean |
|---:|---:|---:|---:|
| 100  | 1.03 (0.94 / 1.94) | 1.07 (1.03 / 2.15) | +4% |
| 500  | 2.86 (2.40 / 4.71) | 3.18 (2.92 / 5.14) | +11% |
| 1000 | 3.40 (3.00 / 6.37) | 3.47 (3.39 / 4.89) | +2% |
| 2000 | 6.71 (6.45 / 8.73) | 6.82 (6.64 / 8.92) | +2% |

500 人那一行又交替跑了 3 轮（main / plugins / main / …）：main 的 mean 为 3.14 / 3.15 / 3.22，plugins 为
3.22 / 3.77 / 3.34。取中位数是 +6%。plugins 自己三轮之间的波动（0.55 ms）大于两个分支的差值，
所以 +11% 按噪声处理。两边的生物、弹道、施法和成功率统计完全一致：行为没变。

## Kernel: the Dark Lord, the DA, 偷师, the lawless zone and the seals as plugins (wf/plugins2)

黑魔王、邓布利多军、偷师、无规则区的提示（`src/kernel/unfair.ts`）和禁书区封印（`src/kernel/seals.ts`）从 `world.ts`
拆成了 `Feature`；集市的每日结算和法令新闻也挂到了同样的钩子上。新钩子里 tick 会走到的只有 `hit`：每次直接命中
（和每次定身 / 缴械落地）调 3 个函数（黑魔王 ×1.15、DA 的联合守护神、偷师记下咒语），和原来内联的判断做同样的事；
`sweep` 每秒一次，`bounty` 每次击晕一次，`view` 只在 `privateState` / whoami / look / 排行榜里走，都不在内核压测的
tick 里。`world.ts` 从 3872 行减到 3423 行。

`npx tsx scripts/bench.ts kernel --n=100,500,1000,2000 --secs=15 --warm=5`，`main` = `3eb90af`（内核和 `34d5f4e`
相同），main / plugins2 交替跑了 11 轮，下表是每格 11 个数的中位数。**机器不空闲**：另外两个 Agent 同时在跑
tsc、vitest、TLC、Lean 和浏览器压测，4 核的 load average 一直在 3–7.5 之间；同一分支同一行各轮之间差到 2.5 倍
（main 100 人：1.25–3.21 ms），所以只看方向。

| wizards | main mean (p50 / p95) ms | plugins2 mean (p50 / p95) ms | Δ mean |
|---:|---:|---:|---:|
| 100  | 1.74 (1.14 / 5.83) | 1.68 (1.15 / 5.41) | −3% |
| 500  | 4.21 (3.43 / 9.56) | 4.12 (3.29 / 10.06) | −2% |
| 1000 | 4.71 (4.24 / 9.00) | 4.24 (3.97 / 7.63) | −10% |
| 2000 | 8.22 (7.77 / 12.61) | 8.50 (8.08 / 13.21) | +3% |

差值都在噪声里（最早 3 轮的中位数曾是 +25% / +21% / +1% / +4%，再跑 8 轮就翻了过来）。两边 88 行结果的生物、
弹道、施法和成功率统计逐项一致。

行为：`bench.ts trace` 的原始指纹变了（n=150 30 s：`fb50b7791df5f1b1` → `7cced859b491d9c8`），因为线上的形状变了：
`privateState().unfair` 拆成了各功能的 `darkLord` / `da` / `studyable` 和内核的 `focus` / `lawless`，快照去掉了
`V` 标记（`dl` 说的是同一件事），`dl` 在快照里挪了位置。把 JSON 按键排序、再把 main 的 `unfair` 映射到新字段之后，
四组参数（150 人 30 s / 150 人 120 s / 300 人 60 s / 40 人 300 s）两边指纹完全一致（`ab086b6c4d8d069f` /
`bdc4837570848220` / `2395164633057644` / `9eafc5850ca9fab0`）。压测场景里没有黑魔王、没有 DA、没有自创咒语，所以
另写了一个真正走到这些功能的场景：黑魔王上位、被广播、×1.15 命中、被击晕夺走 30%；四名 DA 成员入会、联合守护神、
部长颁法令、投票否决；自创咒语打中人、原形立现、偷师并抄进咒语书；走进走出无规则区；读两页封印、答错一次答对一次；
中途存档重启。每 tick 哈希快照、6 个人的私有状态、每次调用的返回值、所有巫师（数值取 9 位有效数字）和每条事件，
两边都是 `3178fb84a0fcb994`（200 秒里 7 条 `dark`、18 条 `da`、3 条 `decree` 事件）。

合入 `037dabe`（聊天、触发式铁甲咒、飞路网、今日课表、以大欺小规则）之后又对新的 main 交替跑了 8 轮（load 6.3–7.5）：
100 / 500 / 1000 / 2000 人的 mean 中位数 main 2.42 / 5.72 / 4.72 / 9.05 ms，plugins2 2.01 / 5.08 / 4.56 / 8.73 ms，
仍在噪声里。注意：新 main 的内核场景**本身不再可复现**——今日课表按登记号挑任务，而登记号是入学时随机生成的，
所以同一分支两次 `bench.ts trace` 的指纹不同，压测里生物数、弹道数、成功率也在几个值之间跳（main 自己的 8 轮就有
7 组不同的值，plugins2 的每一组都落在同一范围）。把 `node:crypto` 的 `randomBytes` 换成固定种子再比，四组参数的
规范指纹和上面的功能场景两边仍然完全一致（`2f8aa41c32a67012` / `623839fce79f7438` / `4af2b482c0e68ca9` /
`729e572e0d8529b7`；场景 `d98778f052e88cff`）。

## Client polish and GC (wf/client-polish)

Two passes on `wf/client-polish`, measured against `main` at `31956f1` with the same harness, back to back:
the leftovers from docs/TODO.md (Great Hall roof, candles, forest, mountains, hotbar) and, measured first,
the garbage the client made every frame (「GC 卡顿」: the owner saw the JS heap grow 24–45 MB/s in the follow
camera, and frames over 50 ms).

### How it is measured

* `scripts/perf-client.ts` as in [wf/fast](#client-browser-wffast), 640x360, `q=high`, `&dyn=0`, two new flags:
  **`--nodraw`** runs every frame's JavaScript at the display's rate (60 Hz here) but draws nothing
  (`window.__capture = { skip: true }`): the page's own CPU and allocation work without SwiftShader's ~1 fps in
  the way, which is what a GPU player's frame looks like to the garbage collector. **`--heap`** records a CDP
  sampling heap profile per spot (objects already collected included) and prints the top allocating functions,
  builtins such as `Math.random` or an iterator's `next` shown with their caller. New spots `hall` (the Great
  Hall from its doorway) and `forest`, and `--viewer=x,z` to stand the viewer somewhere else (`-1.3,-61.5`: in
  the Great Hall, so `follow` is the indoor camera with a candle between it and the wizard).
* "heap MB/s" is the JS heap's growth between collections (`performance.memory`, sampled every 50 ms), "GCs"
  the drops in it (≈ collections) per 10 s window; "GC %" the `(garbage collector)` share of a CDP CPU profile of
  the window (`--profile=spot`, which itself causes one ~70–140 ms frame when it starts, in both builds).
* **SwiftShader renders on the CPU**: fps and render milliseconds say only which way things moved. The box
  (4 cores) was shared with two other agents' jobs (load average 5–7).

### GC: before / after

60 bots (30 round the spawn) casting every second, 12 NPCs, `--nodraw`, 10 s per spot after 3 s:

| | follow (game camera, in the courtyard crowd) | crowd (the courtyard from 70 m) |
|---|---:|---:|
| **JS heap growth, MB/s** (three rounds) | 18.0 / 19.0 / 19.1 → **3.9 / 4.2 / 4.1** (4.6x) | 17.2 / 17.7 / 18.6 → **3.2 / 3.5 / 3.0** (5.5x) |
| collections per 10 s | 41 / 47 / 48 → **3 / 4 / 12** | 30 / 31 / 29 → **3 / 3 / 4** |
| GC share of the main thread (CPU profile, rounds 1–2) | 1.1 % / 1.0 % → **0.1 % / 0.8 %** | 1.3 % / 0.9 % → **0.1 % / 0.5 %** |
| frames over 50 ms in 10 s, without the profiler (round 3) | 0 → **0** (worst 24 → 37 ms) | 0 → **0** (worst 32 → 21 ms) |
| … with the CPU profiler on (rounds 1–2; its start costs a 70–100 ms frame in both) | 1 / 1 → 1 / 1 | 1 / 1 → 1 / 1 |
| frame p95, ms | 18.6–18.7 → 18.1–19.4 | 17.8–18.9 → 17.6–18.2 |
| JS per frame (all sections but the message handler and the HUD), ms | 1.65–1.76 → **1.19–1.37** | 1.36–1.44 → **0.93–1.01** |

Rounds alternate main / branch, one server and one browser each. (Intermediate builds of this branch measured on the
way: 4.8 / 5.9 / 6.0 MB/s.) The owner's 24–45 MB/s was measured on another machine; this harness shows main at
~19 MB/s at 60 Hz. The target was ≥ 5x and no GC hitch over 50 ms: **5.5x in the crowd view, 4.6x in the follow
camera** (short of 5x there), and no frame over 50 ms in either build here once the profiler is off, so the hitches
the owner saw could not be reproduced on this box as GC pauses; what the branch does guarantee is 4–12x fewer
collections to pause for.

What allocated, from `--heap` (main, follow, KB/s): `heightAt` and its helpers ~6 000–8 000 (Math.hypot, for-of
destructuring over array literals, doubles returned from calls V8 does not inline), bolt trails' `Math.random`
~800 (V8 boxes every result) plus two new Colors per trail per frame, the partbatch's group key string per part per
frame ~2 350, picking under the pointer (`zonesAt().filter().map()` per entity, a new `{x, y}` per projected point,
`allKeys()` arrays) ~2 000, for-of over Map entries and closures made per frame in the entity loops, the grass'
`` `${cx},${cz}` `` chunk keys, the light budget's candidate objects and sort. After, the largest left are
`JSON.parse` of the snapshots (~200 KB/s, 10 a second) and doubles passed to calls V8 does not inline
(~100–400 KB/s each in the wizard, creature and bolt visitors). See the commit for the list of changes.

Drawn by SwiftShader (same world, follow, 10 s): 0.9 → 0.7 fps, every frame over 50 ms in both (1.8–2.3 s each: the
software renderer), heap growth 0.46 → 0.36 MB/s (at ~1 fps the per-frame garbage hardly shows), GC share 0.2 % →
0.1 %: under SwiftShader the GC is not what makes frames long, the renderer is.

### The scene: before / after

No bots (a quiet world: the scene's own cost), `--census`, 8 s per spot:

| spot | draw calls | triangles | frame JS ms ¹ | fps (SwiftShader) |
|---|---:|---:|---:|---:|
| follow (courtyard) | 131 → 141 ² | 253 136 → **220 047** | 6.83 → 9.47 | 0.86 → 0.79 |
| castle (from above) | 326 → 314 | 430 987 → **370 983** | 12.8 → 14.8 | 0.88 → 0.78 |
| forest | 105 → 152 ² | 184 885 → **155 103** | 4.12 → 6.20 | 1.83 → 0.92 |
| follow in the Great Hall (a candle between camera and wizard) | 110 → 105 | 251 559 → **214 549** | 5.94 → 6.10 | 1.54 → 1.36 |
| hall (the Great Hall from its doorway) | 124 → 120 | 254 373 → **216 329** | 6.65 → 4.71 | 0.63 → 0.83 |

¹ Mostly the renderer's submit, which waits on SwiftShader (render 2.9–11 ms of it): on this shared box it moved
±40 % between runs of the same build; read it as noise. ² Not the scene: creatures wander, and in these runs more of
them were in view (census: 112 → 162 actor objects in the forest shot; the static scene's draws are unchanged, the
forest is still one instanced crown mesh and its shadow-map draw). Triangles fell by 30–60 k everywhere: the inner
terrain is a disc now (below). Shader programs at the warm-up 86 → 87.

* **Roof** (`scene.ts`, view.ts `dissolvable`): dissolves over 0.3 s on the fade's dither instead of vanishing;
  its own copies of six materials sharing the originals' programs. While fully in or out nothing changes.
* **Candles**: soft view solids (`HALL_CANDLES`); their instanced glow fades by alpha inside the cut-out
  (`fadeGlow`). One more shader program at the warm-up (the candle glows no longer share the other billboards'
  program): 86 → 87.
* **Forest**: one instanced crown per tree (145 instances, was 290) of three tiers with their ink outline in the
  same geometry: the same one draw call (plus its shadow-map draw), 56 → 96 triangles per tree at 'high'
  (+5 800 in all; 'low' has no ink: 48).
* **Mountains**: the inner terrain mesh is a 300 m disc (was a 640 m square overlapping the Highlands' ring):
  fewer triangles, no z-fighting.

Screenshots (not committed; `gpu-shots.ts --shots=hall-candles,forest,mountains,castle-dusk --viewer=-1.3,-61.5`):
the candle over the wizard is cut away and its glow faded; the forest has three-tier crowns with ink outlines;
the green blotches on the mountains are gone; the roof at dissolve 0 / 0.35 / 0.7 / 1 dithers away evenly.
`scripts/view-audit.ts` (500 spots, seed 11): **100 %** (main: 100 %); `--n=1000 --seed=3`: **100 %**. (A first cut of the
crowns had its lowest hem and outline a few centimetres outside the camera's soft crown solids: 99.4 %; they are inside now.)

### Reproduce

```bash
npx vite build
npx tsx scripts/perf-client.ts --port=9310 --q=high --spots=follow,crowd --secs=10 --warm=3 --size=640x360 --nodraw --url='&dyn=0'
#   --heap (what allocates)   --profile=spot (GC share)   --nodraw off: drawn by SwiftShader
npx tsx scripts/perf-client.ts --port=9310 --q=high --spots=follow,castle,forest --bots=0 --npcs=0 --secs=8 --warm=3 --size=640x360 --census --url='&dyn=0'
npx tsx scripts/perf-client.ts --port=9310 --q=high --spots=follow,hall --viewer=-1.3,-61.5 --bots=0 --npcs=0 --secs=8 --warm=3 --size=640x360 --census --url='&dyn=0'
npx tsx scripts/gpu-shots.ts --gpu=webgl --size=640x360 --viewer=-1.3,-61.5 --shots=hall-candles,forest,mountains,castle-dusk --wait=8
```
For "before", build `31956f1` and run the same commands with this branch's scripts.

## Server: the tick and the broadcast, profiled (wf/perf-server)

A profile-driven pass over the 20 Hz tick and the 10 Hz broadcast. Behaviour is unchanged: every fast path
returns what the code it replaced returned, in the same order.

### Method and load

* `main` = `ee87261` (its kernel and server are the same as `31e3f40`). The branch is the same tree plus this
  pass, and `scripts/bench.ts` is identical on both. main and the branch ran **alternately, 5 rounds per
  size** (main, branch, main, …). Tables give the **median of the 5 runs, with
  [min–max] in brackets**.
* **Load**: the 4-core box was shared with other agents (vitest, TLC, dev servers). The kernel was measured
  twice. The first 5 rounds ran at load average 7.4–11.7 (medians 500 / 1000 / 2000 wizards: main
  5.74 / 5.06 / 8.51 ms, branch 3.10 / 3.69 / 6.21). The second 5 rounds, in the table, ran at load 0.7–1.4.
  The net rounds ran at load 0.9–6.3.
* **Profiles**: `node --cpu-prof --import tsx scripts/bench.ts kernel --n=1000 --secs=15 --warm=5`, and for the
  network `BENCH_NODE_FLAGS="--cpu-prof …" bench.ts net --k=500`. A small script sums self time by function
  from the `.cpuprofile` (samples × time deltas), optionally only below a given function (`tick`). For line
  numbers, `esbuild --bundle scripts/bench.ts` was profiled too: tsx reports every function at line 1–4.
  Production runs on tsx (`npm start`), so the tables are tsx runs.
* The broadcast was also isolated without sockets: the kernel scenario with 500 wizards, and per broadcast
  `snapshot()` + `fanout.load` + one AOI payload per wizard + `privateState`/`JSON` for half of them (main.ts
  minus the sockets).

### Where the time went (profile, before → after)

Kernel, 1 000 wizards, self time below `World#tick` (main 2 178 ms → branch 1 559 ms of samples over the
same 400 ticks):

| function | main ms | branch ms | what it was |
|---|---:|---:|---|
| `SpatialHash#near` | 366 | 195 | 6 grid queries per spell per tick: an ordinal sort, a new array, and a `for…of` over the (always empty) loose list for each |
| `step` (inlined callees) | 260 | 234 | |
| `stepProjectiles` | 221 | 137 | |
| `around` | 177 | 4 | called 3× per spell per tick with `() => true`: a view (with `derived()`) per candidate, a sort, a slice |
| `moveWizard` | 126 | 120 | |
| `tick` | 114 | 83 | |
| `hitSegment` | 95 | 74 | |
| `clashSpells` | 93 | 0 | O(n²) pair loop with a `Map#has` + `Math.hypot` per pair, while ≤ 400 spells fly |
| `derived` | 65 | 47 | |
| `Separator#solve` | 55 | 54 | |
| `boltTargets` (new) | — | 99 | replaces `around` in the bolt loop |

Network, 500 AOI clients (whole server process, 20 s). The top functions besides idle: `writev` (the
syscall: 12.5 %; after the pass 13.5 %), GC 4.3 %, the broadcast closure in main.ts (JSON of `me`) 4.2 %,
`clashSpells` 2.5 % → 0.1 %, `payloadFor` 2.3 %, `encode` 1.4 %, ws `Sender#send`, `createUnsafeBuffer`
(one 29 KB payload per anchor cell), UTF-8 decoding of input messages, the kernel. Below the per-socket
`corked` send, **half of the broadcast time is the `writev` syscall** (on loopback the kernel's TCP work for
the receiver is charged to the sender too). User space can't make that smaller without sending fewer bytes.
One profiled run per side is noisy, and the medians below are what count. (That profile showed more GC
time on the branch, but the socket-less broadcast bench with `--trace-gc` has the branch doing 340 GCs and
0.84–0.90 s of pauses against main's 420 and 1.06–1.18 s.)

### What changed

Kernel (`src/kernel`):

* **Bolt collision without views** (`World#boltTargets`): exactly `around(p, 2.2, () => true, owner, 4)` —
  active wizards, then live creatures, from the same grid queries in the same Map order — but it keeps the
  nearest four by insertion into a reused array (after equal distances, as the stable sort did). There is no
  `EntityView`, no `derived()`, no closure, no sort and no slice. It rejects a candidate on one axis before
  `Math.hypot` (hypot ≥ each |axis|). If anything has a non-finite distance (a NaN position, which `around`
  keeps and sorts its own way), it returns `around`'s own answer. Under `HOGWARTS_VERIFY_SPATIAL=1` every
  call is checked against `around`.
* **`SpatialHash#near`**: a small insertion sort by ordinal instead of `Array#sort` for ≤ 16 candidates, an
  indexed loop over the loose list, a packed (not holey) cell array, `× 1/size` instead of `/ size` (the same
  number for the power-of-two cell used), and an optional caller-owned output array. With that array, the
  bolt loop's three sub-steps usually ask for the same cells while nothing has been re-filed; a version
  counter (bumped on every file/unfile) then returns the previous answer as it stands.
* **Spell clashes** (`closePairs` in spatial.ts): a sort-and-sweep along x lists, for each spell, the later
  spells within `CLASH_R` on both axes. Those are exactly the pairs the old loop did not reject by distance,
  in the same order, so the same pairs get the same `has` / owner / `hypot` / `canHarm` tests and clash in
  the same order. With a non-finite position anywhere, every pair is tested, as before. At 500 wizards the
  spells in flight hover around `CLASH_MAX` = 400, so main paid the O(n²) loop on many ticks: its
  500-wizard tick was about as slow as its 1 000-wizard one.
* `around`: no sort for 0–1 results, no copy when nothing is cut. `moveWizard`: no `{ ...pos }` copy per
  walker per tick.

Server (`src/server`):

* **`fanout.ts` encode/payload**: each category is encoded into one buffer, reused from broadcast to broadcast
  (payloads are copies). Entries are sorted row-major once, and each entry's JSON is written straight in
  with `buf.write`: there is no Map of Maps, no `Buffer` per cell and no buffer per row. Rows sit in a dense
  array, and payload building uses typed scratch arrays. Output is **byte-identical**: a scratch check
  compared the old and new `SnapshotFanout` on 72 000 payloads (4 radius / cell / margin settings, 60
  broadcasts, 300 viewers with hysteresis, CJK / emoji / quote names, NaN and far-off positions, empty
  snapshots, the full payload).
* **Input fast path** (`handleClient`): `{t: 'input'}` (frame-rate traffic) goes straight to `setInput` on
  `actingAs(…)`, without creating the three reply closures (tsx's `keepNames` wraps each in a
  `defineProperty`) or looking up a feature. The admit handler is created once per socket, not once per
  message.

Tests (`test/perf.test.ts`): `near(…, out)` equals `near()` through moves and removals, the memo is
invalidated by update/remove/insert, `closePairs` against brute force (ties and edge distances), and the
verified busy world runs 20 more ticks with a NaN-positioned wizard (the `around` fallback).

### Kernel: before / after (ms per 20 Hz tick, 1 core; load 0.7–1.4)

`npx tsx scripts/bench.ts kernel --n=500,1000,2000 --secs=15 --warm=5`, 5 alternating rounds, median [min–max]:

| wizards | main mean | branch mean | main p50 | branch p50 | main p95 | branch p95 | Δ mean |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 500 | 4.07 [3.99–4.23] | **2.02** [1.97–2.11] | 3.79 | **1.82** | 8.03 | **3.59** | −50 % |
| 1 000 | 4.27 [4.14–4.40] | **3.00** [2.88–3.01] | 4.05 | **2.81** | 6.77 | **4.46** | −30 % |
| 2 000 | 8.19 [7.93–8.40] | **6.01** [5.74–6.13] | 7.93 | **5.82** | 10.9 | **8.07** | −27 % |

The scenario statistics are identical in all 60 runs (creatures / projectiles / casts/s / cast ok %:
25.7 / 473 / 500 / 64.0, 15.1 / 852 / 1000 / 63.7, 8.60 / 1208 / 2000 / 62.1). Syscall time (casts, outside the
tick) is unchanged: 0.49 / 0.72 / 1.14 ms against 0.51 / 0.73 / 1.14.

### Network: before / after (single process; load 0.9–6.3)

`npx tsx scripts/bench.ts net --k=200,500 --secs=15 --warm=5` (spread, AOI clients, 20 Hz input, a cast a
second), 5 alternating rounds, median [min–max]:

| | 200 main | 200 branch | 500 main | 500 branch |
|---|---:|---:|---:|---:|
| world.tick p50 / p95 ms | 2.70 / 5.65 | **1.36 / 2.30** | 4.61 / 9.22 | **2.46 / 4.38** |
| broadcast p50 ms | 8.89 [8.55–9.13] | **8.18** [7.67–8.44] | 22.8 [22.5–28.5] | **21.6** [21.2–22.9] |
| broadcast p95 ms | 12.8 | **10.8** | 44.5 [30.6–47.5] | **29.2** [28.4–32.6] |
| server CPU % (100 = a core) | 48.5 [46.8–52.6] | **42.5** [39.6–43.3] | 77.2 [68.1–91.7] | **74.7** [69.2–76.4] |
| … per client | 0.24 % | **0.21 %** | 0.15 % | 0.15 % |
| event-loop delay p99 ms | 11.2 | **10.5** | 35.5 [25.6–48.3] | **25.4** [24.2–28.2] |
| cast round trip p50 / p99 ms | 1.10 / 9.73 | **0.90** / 10.3 | 4.71 / 48.3 | **1.97 / 24.4** |
| KB/s per client (snap KB) | 124 (11.7) | 125 (11.7) | 283 (27.8) | 285 (27.8) |

The wire is unchanged (the same bytes per client, and every client got its 10 snapshots and 5 `me` a
second). The broadcast bench without sockets (500 wizards, bundled, load 0.8, 3 rounds each) puts encoding +
payloads at 7.6–7.9 ms per broadcast on main and 7.0–7.2 on the branch, and the whole broadcast at 11.5–12.0
against 10.7–11.2. So the broadcast gains less than the tick. What is left of it is mostly `writev`, then the
payload copies (one 28 KB buffer per anchor cell), `privateState` and its JSON (~3 ms per broadcast for 250
wizards), and GC.

### Behaviour

`bench.ts trace` fingerprints are identical on main (run twice) and on the branch: n=150 30 s
`8980a426ebada6b7`, n=400 30 s `7bd7fa59c361599c` (more than `CLASH_MAX` spells in flight at times), n=50 120 s
`74bd6987d70ce47b`. The 150-wizard trace sees 75 spell clashes and ~1 000 `hit` effects in its 30 s, so both
rewritten paths are covered.

### Left

* `writev` and the loopback TCP stack are now the largest single cost of a broadcast. They go down only with
  fewer bytes (a binary or delta protocol, or permessage-deflate paid for in CPU) or with more processes
  (`REALMS`).
* A payload is a fresh 28 KB `Buffer` per anchor cell (~3 µs to allocate). Carving them out of a slab would
  save ~1 % of a core at 500 clients. But a slow socket that holds one payload would then pin the whole
  slab, so that was left out.
* `privateState` costs ~12 µs per socket at 5 Hz, spread thin over many small views (DA state, hotbar,
  title…). It would need per-view change tracking to skip.
* Kernel: `near()` is still ~12 % of the tick (cell loads for 2 grids × 3 sub-steps × spells in flight). One
  swept query per spell per tick would need the candidates re-checked per sub-step to stay exact.

## Wire v2: binary delta snapshots, sliced fan-out (perf/extreme)

Machine: digest, 64 × Xeon Platinum 8457C, Node v22.23.3. `bench.ts net --layout=spread`, one realm,
clients at 20 Hz input and a cast a second, 5 s warm-up, 15 s measured. Load generator on the same box.

**What a snapshot was made of** (1 000 spread wizards, measured in-process): an AOI payload averaged
53 KB; wizards 60 % of the bytes, projectiles 33 %, fx 4.5 %. Between two broadcasts 91 % of wizards had
moved, 0.4 % had any other field change: each broadcast re-sent ~128 B of JSON per wizard for 6 changing
numbers. fx coordinates went out unrounded (`-201.39637030804573`).

**What changed**
1. `src/shared/snapwire.ts`, `src/server/binfanout.ts`: sockets that connect with `v=2` get binary frames.
   Per entity, position / facing / health travel as zigzag varints every frame; the other fields travel as
   JSON only when the entity is new to its cell, the field changed, the cell is new to the client's area,
   or the client missed a frame (then the next frame carries everything). Same grid, hysteresis and
   per-row buffers as the JSON fan-out; each cell is encoded once as `delta` and once as `full`.
   The browser client asks for `v=2` (`?v=1` in the page address gets JSON). `test/snapwire.test.ts`
   decodes 2 000+ frames (moving viewers, births and deaths, missed frames) and compares each with the
   JSON AOI snapshot entity by entity.
2. v=2 sockets get their queued events as one `{t:'evs', es:[…]}` message per broadcast instead of one
   WebSocket frame per event.
3. The fan-out runs in slices of `FANOUT_SLICE` (100) sockets with `setImmediate` between them, so ticks,
   casts and input are held up by at most one slice. It also creates no closure per socket or per input
   message: under tsx each closure costs an `Object.defineProperty` (`__name`), 9.9 % of the server's CPU
   at 1 000 clients before this change.
4. `npm start` runs Node with `--max-semi-space-size=64` (fewer scavenges; see the table).

In-process, 1 000 wizards, mean payload per client: JSON AOI 53 344 B → v2 8 189 B (6.5×); the first frame
after connecting or a missed frame is 59.6 KB.

| 1 000 clients | loop p99 ms | loop max ms | cast RTT p50 / p99 ms | KB/s per client | server CPU % |
|---|---:|---:|---:|---:|---:|
| before (v1 JSON, 2 runs) | 96.8 / 127 | 125 / 140 | 28.1 / 79.8, 33.2 / 109 | 514 / 476 | 142 / 152 |
| v2 frames only | 136 | 221 | 33.6 / 132 | 100 | 122 |
| + sliced fan-out, no closures, default heap (3 runs) | 85.8 / 67.8 / 74.0 | 135 / 106 / 134 | 17.5 / 85.9, 14.6 / 64.2, 15.4 / 92.4 | 101 | 123 |
| + `--max-semi-space-size=64` (3 runs) | **63.3 / 60.2 / 55.2** | 86.7 / 97.3 / 89.2 | **13.4 / 56.6, 14.5 / 45.7, 11.9 / 56.3** | **~103** | 119 |

| 500 clients | loop p99 ms | cast RTT p50 / p99 ms | KB/s per client |
|---|---:|---:|---:|
| before (v1 JSON, 2 runs) | 31.8 / 29.5 | 3.84 / 33.2, 2.97 / 33.8 | 285 |
| after | **18.1** | **3.43 / 15.1** | **57** |

v2 frames alone cut bandwidth 5× but not latency: the fan-out's cost was per socket (payload assembly
with a closure per row, one `writev` per socket), not per byte. Slicing and removing the closures did that.
The `bcast` column of `bench.ts net` now times only the first slice of each broadcast.

Browser (headless Chrome on a Mac GPU, `perf-client.ts --q=high`, 60 bots): v1 → v2 WebSocket 103-110 →
16-19 KB/s, 60 fps and no frame over 50 ms either way, frame decode 0.10 ms (JSON.parse 0.05 ms). The
client's heap churn (~30-45 MB/s, 7-12 GCs in 6 s) is the same on both and is not addressed here.
`perf-client.ts` now splits arguments at the first `=` only (`--url=&v=1` used to arrive as `&v`).

**Together with wf/perf-server** (this branch merged with main `e84488a`), 1 000 clients, main and the
branch alternating, 3 rounds each, same box and command (the branch with `--max-semi-space-size=64` and
`--v=2`, as `npm start` and the browser client run it):

| 1 000 clients | loop p99 ms | loop max ms | cast RTT p50 / p99 ms | KB/s per client | server CPU % |
|---|---:|---:|---:|---:|---:|
| main `e84488a` (v1 JSON) | 98.4 / 98.8 / 95.4 | 119 / 114 / 110 | 26.0 / 90.1, 28.3 / 87.6, 29.0 / 81.3 | 508 / 509 / 525 | 147 / 140 / 140 |
| this branch (v2) | **43.5 / 36.3 / 36.1** | 84.9 / 70.6 / 76.0 | **12.2 / 40.4, 9.16 / 35.8, 8.29 / 38.7** | **104 / 104 / 103** | 116 / 109 / 115 |

One realm now holds 1 000 spread clients inside the 50 ms tick budget at p99. What is left at that size
(profile before the merge): receiving input (20 000 JSON messages a second through the ws receiver), one
`writev` per socket per broadcast, and the tick. Beyond it the step is structural: gateway processes that
own the sockets (parse input, assemble and write frames from the rows the world process publishes once per
broadcast), leaving the world process with the tick and one encode.
