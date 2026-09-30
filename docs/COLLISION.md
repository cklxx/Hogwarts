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

## The camera

The third-person camera (`client/view.ts`) uses a 3D version of the same layout: `viewSolids()` in
`src/shared/layout.ts` stands every footprint up to its drawn height and adds what the kernel ignores because
it is above head height: roofs (tower and hut cones, the Great Hall's gable, and the houses' four-sided roofs,
which scene.ts draws as a scaled, turned cone: a rhombus that overhangs a long house's ends by up to a metre),
as stacks of prisms each as wide as the shape at its foot; battlements, the corbelled turrets (`TURRETS`), the
lintel, pillar caps, pinnacles, and tree crowns (marked *soft*). 720 prisms in a 12 m grid; a sweep allocates
nothing.

- **Spring arm.** Each frame the arm from the orbit centre (1.5 m over the feet) to where the camera wants
  to be is swept as a 0.3 m sphere through the hard prisms (walls, roofs, towers, houses, the hut, tree trunks,
  pillars, statues; not crowns) and over the terrain. The camera snaps in front of the first hit at once and
  eases back out (~1.5 s) once it lets go; in open space it is exactly where it always was, zoom included.
  Only posts and poles thinner than 0.6 m (torches, hoop poles) let it pass behind (they fade). Pressed short,
  it first tries to climb (at most 31° more pitch) if that frees 6 m of arm, which clears low things (the tomb,
  a roof's edge); whatever arm is left then sets the framing: from 4.5 m down to 2.5 m it moves over your
  right shoulder and looks on past you; with a wall right behind you (under 1.6 m) it rises up the wall and
  looks down at you. The view's centre never strays more than 14° from your head, and your own name plate
  fades out under 5 m.
- **Fading.** When a wall, roof or crown still stands between the camera and you (or your locked target) — or
  the camera is in the leaves — a circle round you on screen is cut through everything nearer the camera than
  you by more than ~0.6 m and above your feet, with a 4x4 screen-door dither over ~0.2 s. It is a discard at
  the top of the fragment shader (`VIEW_FADE_GLSL`, appended to three.js's clipping-plane chunks, opted into
  per material with the `VIEW_FADE` define), so it works on the merged static batches (`batch.ts` keeps the
  materials), instanced trees, the storybook shading and the merged ink outline alike, and depth and shadows
  are unchanged. The terrain, grass, roads and floors never fade; characters are never marked. The Great
  Hall's 48 floating candles are soft solids (`HALL_CANDLES`): one in the way turns the cut-out on, and their
  glows (one instanced billboard) fade by alpha inside it (`fadeGlow`) rather than dithering.
- **X-ray.** You, your locked target and up to four allies (your house) within 12 m, while something hides
  them, get a house-coloured rim drawn through walls: a second pass of their meshes with depth *Greater* and a
  stencil test (world materials write 1, bodies write 0), so a body never rims itself. The composer's render
  target has a stencil buffer for this. The rim meshes are children of the model's own meshes (so they follow
  its animation, and a part drawn instanced by `partbatch.ts` still has its rim); wizards drawn as the far
  crowd (`crowd.ts`) and far herds are never x-rayed (your target and allies within 12 m are always full models).
- **Indoors.** `INTERIORS` (the Great Hall, doorway included) dissolves its roof over 0.3 s on the same dither
  (`scene.ts`, view.ts `dissolvable`: its own copies of the roof's materials, same shader programs; at once with
  prefers-reduced-motion), and the camera's
  arm shortens to 11 m and its pitch range moves up to 36°–81°; outside it eases back.
- A scripted shot (`?capture=1`) drives the camera itself: no arm, no fading, no x-ray. `?debug=view` exposes
  `window.__view` (the orbit, the rig, timings, and the audit below).

**Audit** (`npx vite build && npx tsx scripts/view-audit.ts --n=1000 --seed=3`): 1 000 random spots around
the castle, in the Great Hall, round Hogsmeade and in the Forest, random yaw, pitch 0.1–1.1 and zoom 3.5–23 m;
after 1.5 s, rays from the camera to the wizard's head, chest and knees through the scene's own static meshes
(merged batches, instanced trees, terrain), passing what the fade dithers away. Head or chest seen: **100 %**
(97.1 % without the fade); the camera before view.ts: 91.7 % (castle 291/313, forest 180/210, Hogsmeade
323/327, Great Hall 123/150). `test/view.test.ts` checks the same on the layout (1 500 spots: never inside
anything hard, nothing hard between the camera and your head, your head within 14° of the view's centre).

Cost: 15–30 µs per frame in Node, 1.3–3 µs in Chromium, for the arm, the climb search and four occlusion
sweeps (random spots in the forest, the castle and Hogsmeade; `test/view.test.ts` fails above 0.3 ms).
