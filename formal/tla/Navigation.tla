----------------------------- MODULE Navigation -----------------------------
(* Movement safeguards (world.ts, pathfind.ts, duelclub.ts), alongside the existing Control/Lifecycle.
   Geometry is a finite abstraction: a candidate contains all points on the resolved segment, not just
   its endpoint. The concrete circle/box intersection and collision sweeps are checked by kernel tests.
   Windows represent one second with no new goal request; distance is remaining net waypoint distance.
   Replacing goals intentionally starts a new walk: no liveness claim about endless replacement. *)
EXTENDS Naturals, FiniteSets

VARIABLES active, scene, routeScene, owner, via, paused, manual, npc,
          distance, retries, rollPos, crossedForbidden
vars == <<active, scene, routeScene, owner, via, paused, manual, npc,
          distance, retries, rollPos, crossedForbidden>>
Owners == {"none", "agent", "player"}
Scenes == {"castle", "forest"}
Legal == {0, 1, 3, 4}

Init == /\ active = TRUE /\ scene = "castle" /\ routeScene = "castle"
        /\ owner = "none" /\ via = FALSE /\ paused = FALSE /\ manual = FALSE
        /\ npc \in BOOLEAN /\ distance = 0 /\ retries = 0
        /\ rollPos = 1 /\ crossedForbidden = FALSE

Start(by, crossing, connection) ==
  /\ active /\ owner = "none" /\ connection
  /\ ~(npc /\ crossing)
  /\ (by = "player" \/ (~paused /\ ~manual))
  /\ owner' = by /\ via' = crossing /\ routeScene' = scene
  /\ distance' = 4 /\ retries' = 0
  /\ UNCHANGED <<active, scene, paused, manual, npc, rollPos, crossedForbidden>>

Stop(by) ==
  /\ owner' = IF by = "player" \/ owner = "agent" THEN "none" ELSE owner
  /\ via' = IF by = "player" \/ owner = "agent" THEN FALSE ELSE via
  /\ distance' = IF owner' = "none" THEN 0 ELSE distance
  /\ UNCHANGED <<active, scene, routeScene, paused, manual, npc, retries, rollPos, crossedForbidden>>

HumanKey == /\ manual' = TRUE /\ owner' = "none" /\ via' = FALSE /\ distance' = 0
            /\ UNCHANGED <<active, scene, routeScene, paused, npc, retries, rollPos, crossedForbidden>>
ReleaseKey == /\ manual' = FALSE
              /\ UNCHANGED <<active, scene, routeScene, owner, via, paused, npc, distance, retries, rollPos, crossedForbidden>>
Pause(on) == /\ paused' = on
             /\ owner' = IF on /\ owner = "agent" THEN "none" ELSE owner
             /\ via' = IF on /\ owner = "agent" THEN FALSE ELSE via
             /\ distance' = IF owner' = "none" THEN 0 ELSE distance
             /\ UNCHANGED <<active, scene, routeScene, manual, npc, retries, rollPos, crossedForbidden>>
Down == /\ active /\ active' = FALSE /\ owner' = "none" /\ via' = FALSE
        /\ distance' = 0 /\ manual' = FALSE
        /\ UNCHANGED <<scene, routeScene, paused, npc, retries, rollPos, crossedForbidden>>
Recover == /\ ~active /\ active' = TRUE /\ scene' = "castle"
           /\ owner' = "none" /\ via' = FALSE /\ distance' = 0 /\ manual' = FALSE
           /\ UNCHANGED <<routeScene, paused, npc, retries, rollPos, crossedForbidden>>
Cross == /\ active /\ via /\ ~npc
         /\ scene' = IF scene = "castle" THEN "forest" ELSE "castle"
         /\ routeScene' = scene' /\ via' = FALSE
         /\ UNCHANGED <<active, owner, paused, manual, npc, distance, retries, rollPos, crossedForbidden>>

(* Teleport/Floo/match placement/ice-shore rescue own the new location. stopWalk discards all route
   state so a stale gate cannot continue the old walk from the new body/scene. Keys remain the human's. *)
Relocate(destination) ==
  /\ active /\ (~npc \/ destination = scene)
  /\ scene' = destination /\ routeScene' = destination
  /\ owner' = "none" /\ via' = FALSE /\ distance' = 0 /\ retries' = 0
  /\ UNCHANGED <<active, paused, manual, npc, rollPos, crossedForbidden>>

(* Net progress is a distance decrease over the whole window. Sideways/backward motion is not progress.
   A completed leg crosses and replans before the next window; a final arrival or give-up clears via. *)
Window == /\ active /\ owner # "none"
          /\ \E advances \in BOOLEAN :
               /\ distance' = IF advances /\ distance > 0 THEN distance - 1 ELSE distance
               /\ retries' = IF advances THEN retries ELSE IF retries < 3 THEN retries + 1 ELSE retries
               /\ owner' = IF distance' = 0 \/ (~advances /\ retries = 3) THEN "none" ELSE owner
               /\ via' = IF owner' = "none" THEN FALSE ELSE via
          /\ UNCHANGED <<active, scene, routeScene, paused, manual, npc, rollPos, crossedForbidden>>

(* Each actual resolved dash segment is checked again; changing dt/solids after selection cannot bypass it.
   With no legal segment the roll holds position, retaining its cooldown/immunity in the concrete kernel. *)
Roll(path, endpoint) ==
  /\ active
  /\ LET accepted == path \subseteq Legal /\ endpoint \in path
     IN /\ rollPos' = IF accepted THEN endpoint ELSE rollPos
        /\ crossedForbidden' = crossedForbidden \/ (accepted /\ ~(path \subseteq Legal))
  /\ UNCHANGED <<active, scene, routeScene, owner, via, paused, manual, npc, distance, retries>>

Next == \/ \E by \in {"agent", "player"}, crossing \in BOOLEAN, connection \in BOOLEAN : Start(by, crossing, connection)
        \/ Stop("agent") \/ Stop("player") \/ HumanKey \/ ReleaseKey \/ Pause(TRUE) \/ Pause(FALSE)
        \/ Down \/ Recover \/ Cross \/ Window
        \/ \E destination \in Scenes : Relocate(destination)
        \/ \E path \in SUBSET (0..4), endpoint \in 0..4 : Roll(path, endpoint)
Spec == Init /\ [][Next]_vars /\ WF_vars(Window)

TypeOK == /\ active \in BOOLEAN /\ scene \in Scenes /\ routeScene \in Scenes /\ owner \in Owners
          /\ via \in BOOLEAN /\ paused \in BOOLEAN /\ manual \in BOOLEAN /\ npc \in BOOLEAN
          /\ distance \in 0..4 /\ retries \in 0..3 /\ rollPos \in Legal /\ crossedForbidden \in BOOLEAN
NoOrphanContinuation == via => owner # "none"
RouteInCurrentScene == owner # "none" => routeScene = scene
DownHasNoWalk == ~active => owner = "none" /\ ~via
NpcStaysInItsScene == npc => ~via /\ scene = "castle"
HumanAndPauseWin == (manual \/ paused) => owner # "agent"
ResolvedRollIsSafe == rollPos \in Legal /\ ~crossedForbidden
(* In this finite fixed-goal abstraction, progress consumes distance; no-progress consumes retries. *)
FixedWalkTerminates == owner # "none" ~> owner = "none"
=============================================================================
