# Collision

Everything solid in the world is described once, in [`src/shared/layout.ts`](../src/shared/layout.ts)
(with the big drawn things still listed in `src/shared/map.ts` `OBSTACLES`). The kernel's colliders
(`src/kernel/physics.ts`), the A* grid (`src/kernel/pathfind.ts`), bolts, and the client's placement of
every solid prop (`client/scene.ts`, `client/decor.ts`) all read it, so what you see is what you bump into.
Open the game with **`?debug=colliders`** to see every collider outlined over the scene (`client/debug.ts`):
magenta stops walkers and bolts, orange stops walkers only (bolts fly over), cyan is a Minister's statue
(dynamic), yellow is the edge of the walkable world.

## What is solid, and how

| thing | drawn as | collider |
|---|---|---|
| Castle Keep, West/East Wings, Great Hall walls, greenhouse, Hogsmeade houses, Shrieking Shack | boxes | the same boxes |
| towers | cylinder `r` at the top, `1.06 r` at the foot | disc `1.06 r` |
| courtyard pillars | cylinder `r` → `1.1 r` | disc `1.1 r` |
| Great Hall buttresses (14), door jambs (2) | boxes (`HALL_BUTTRESSES`, `HALL_DOOR`) | the same boxes |
| house tables (4) | boxes 0.9 m high (`HALL_TABLES`) | boxes; bolts fly over them |
| Dumbledore's tomb | box `2.2 r x 1.3 r` | that box (was a disc) |
| Whomping Willow, Hagrid's hut | cylinders | discs |
| Quidditch hoops | poles, 0.25 m at the foot | disc 0.25 |
| torch posts (4) | posts (`TORCH_POSTS`) | disc 0.12 |
| Mirror of Erised | gilt frame (`MIRROR`) | box |
| Azkaban | hexagonal cone, 8 m at the foot | disc 7.46 (between the hexagon's apothem and corner) |
| trees (145, seeded, shared generator `OBSTACLES`) | trunk `0.5 r` at the foot, crown from ~3 m up | the trunk: disc `0.5 r` (`TRUNK`); you walk under the crowns |
| Ministers' statues (up to 8) | plinth 2.1 m square + figure, spot i of `STATUE_SPOTS` | oriented box per statue, added and removed per world as `flags.statues` changes (a decree adds one, a veto removes it); a statue rising on someone shoves them off |
| the Black Lake | water, r 55 | disc 55: **blocks walking at the waterline**; bolts skim over it (h 0) |

Not solid (nothing at walking height): turrets and clock faces (corbelled high on the walls), roofs, the
Great Hall's lintel, pennants, candles, floating lanterns, fireflies, the squid (inside the lake collider),
roads, the courtyard, the hall floor, the 1.4 m Azkaban plinth.

**Water.** The Black Lake blocks at its waterline (the rendered shore is sand down to the water; the
lake bed drops away right after). No wading: a hard edge is honest about where you can go and keeps
pathfinding simple. **The sea** is out of reach: inside the walkable world the ground never dips below
-7 m, the sea plane is at -9 m and only opens beyond 260 m to the south.

**The edge of the world** is the square `|x|, |z| <= 240` intersected with the circle `WORLD_EDGE`
(centre (0, -20), radius 280), where the Highlands start to climb (`client/terrain.ts`: the mountain ring is
`ss(270, 420, hypot(x, z + 20))`). Before, the square's corners reached 29 m up the mountainsides (slope
0.74). Now everywhere a walker can stand is within 5 m of the grounds' level, with slopes under 0.45
(checked by `test/collide.test.ts`).

## Audit (before this change)

| thing drawn | collider before | problem |
|---|---|---|
| Great Hall buttresses (14) | none | walked into the wall's buttresses |
| door jambs (2), torch posts (4), house tables (4), Mirror of Erised | none | walked through them |
| Ministers' statues (dynamic) | none | walked through them |
| trees (145) | disc of the crown scale `r` | 2x the trunk: stopped 0.45-0.85 m short of the bark |
| Quidditch hoops (6) | disc 0.5 | 2x the pole |
| towers (6), pillars (4) | disc `r` | the flared foot is 6-10 % wider: walked 0.1-0.4 m into the stone |
| tomb | disc 1.6 | wrong shape (a 3.5 x 2.1 box): into its ends, 0.5 m of air at its sides |
| Azkaban rock | disc 2 | the rock is 8 m wide at the foot |
| Highlands | square ±240 only | walked up to 29 m up the mountainsides in the corners |
| wizards, creatures | none between bodies | walked through each other |
| bolts | a point test at 3 sub-steps | at 60-80 m/s (decrees allow 80) a bolt stepped over a 1 m wall; torch posts and hoops were thinner than a step |
| A* routes | cells with 0.7 m clearance, legs checked on the grid only | legs between open cells could cut a corner or pass through a thin post |

Colliders with nothing drawn: none.

## Bodies

`src/kernel/separation.ts`: every tick, wizards in play and walking creatures that overlap are pushed apart
by 80 % of the overlap, shared by mass (radius²: a troll shoves a pixie, a pixie barely moves a troll),
each body at most 0.5 m per tick, so crowds ease apart instead of popping. Pairs are settled once, for both
at the same time (the result does not depend on iteration order). Devil's Snare and anything rooted do
not budge; flying things (Dementors, Fawkes, conjured birds) pass over everyone; the stunned and the jailed
are left alone. Safe zones change nothing: bodies still collide there. After a push, the body is resolved
against the colliders again (nobody is shoved into a wall), and a wild creature that would be shoved into a
safe zone stays put. The grid is a dense counting sort over flat typed arrays: O(n), no allocation.

## Bolts

Each sub-step sweeps the segment it travelled (`Solids.hitSegment`), so nothing is tunnelled through at any
speed; a bolt cast with your nose to a wall starts in it. Things lower than 1.2 m (tables, the lake) are
flown over.

## Pathfinding

The 2 m A* grid is baked from the same colliders (a cell is open if a 0.7 m circle at its centre touches
nothing), and every step between neighbouring cells is swept once at startup (0.3 m clearance), so no
route passes through a thin post or cuts a corner; string-pulled legs keep 0.45 m clear. Each world lays
its statues over the grid (re-derived when they change). A walker that starts inside something is walked to
the nearest open cell first; one that makes no headway for a second (a crowd, a statue that rose on its
route) re-plans from where it stands, and gives up after three re-plans.

## The client

The client does no local prediction: it eases each model toward the server's position (10 Hz snapshots,
at most 0.7 m apart), so it cannot rubber-band through walls. Placement of every prop listed above comes
from `layout.ts`.

## Performance

`npx tsx scripts/bench.ts kernel --n=500,1000,2000` (method: [PERF.md](PERF.md)), main (`fe36e4a`) and
this branch run alternately twice on the same machine (4 vCPU Xeon 2.1 GHz, Node 22), ms per tick:

| wizards | before: mean / p50 / p95 | after: mean / p50 / p95 |
|---:|---|---|
| 500 | 1.40 / 1.31 / 2.05 · 1.37 / 1.28 / 2.05 | 1.29 / 1.17 / 1.96 · 1.42 / 1.21 / 2.38 |
| 1000 | 3.13 / 2.95 / 4.22 · 3.03 / 2.93 / 4.04 | 2.59 / 2.45 / 3.86 · 2.51 / 2.45 / 3.31 |
| 2000 | 6.40 / 6.27 / 8.37 · 6.37 / 6.27 / 7.89 | 6.02 / 5.98 / 7.63 · 6.23 / 6.14 / 7.99 |

The body-separation pass, the swept bolts and the extra colliders cost less than the single-cell static
grid saves (a circle of radius <= 1.6 m now looks at the colliders filed under one 8 m cell, instead of
the 3x3 neighbourhood of 16 m cells). Bolts now stop on tree trunks and posts they used to pass, so a few
fewer are in flight (660 vs 703 at 2 000 wizards). The A* bake (grid + swept steps) takes ~70 ms at startup.
