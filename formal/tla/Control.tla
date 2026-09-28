------------------------------ MODULE Control ------------------------------
(* A player and their agent share one wizard: src/kernel/world.ts setInput / setGoal(…, by) /
   playerSteering / setAgentPaused / agentMayAct (docs/AGENT_LINK.md §C.1). The player's hands always
   win: WASD cancels any walk and a click replaces any walk; an agent cannot start a walk while paused,
   while the player presses a direction, while the player's own click walk is under way, or within the
   grace (PLAYER_GRACE_S) after the player last steered; the agent's stop only ends a walk the agent set;
   pausing cancels the agent's walk; a paused agent can only call the tools on AGENT_PAUSE_ALLOWED. *)
EXTENDS Naturals

CONSTANTS Tools, Allowed   \* Allowed \subseteq Tools: AGENT_PAUSE_ALLOWED; "move_to", "stop" \in Tools \ Allowed

VARIABLES paused, input, goal, grace, want, actedPaused, tookWheel, last
vars == <<paused, input, goal, grace, want, actedPaused, tookWheel, last>>
\* input: the player's WASD ("idle" | "moving"); goal: who set the current walk ("none" | "agent" | "player");
\* grace: the player steered less than PLAYER_GRACE_S ago (steerAt). History: want = the player has decided
\* to take the wheel; actedPaused = an action ran while paused; tookWheel = an agent call changed a walk the
\* player set

Init == /\ paused = FALSE /\ input = "idle" /\ goal = "none" /\ grace = FALSE
        /\ want = FALSE /\ actedPaused = FALSE /\ tookWheel = FALSE /\ last = "none"

\* setInput with a direction: every walk ends, whoever set it
PlayerMove == input' = "moving" /\ goal' = "none" /\ grace' = TRUE /\ want' = FALSE
              /\ UNCHANGED <<paused, actedPaused, tookWheel, last>>
PlayerStop == input' = "idle" /\ UNCHANGED <<paused, goal, grace, want, actedPaused, tookWheel, last>>
\* click-to-move: setGoal(…, 'player') replaces any walk
PlayerGoto == goal' = "player" /\ grace' = TRUE /\ want' = FALSE /\ UNCHANGED <<paused, input, actedPaused, tookWheel, last>>
\* setAgentPaused(on): pausing also cancels the walk the agent set
Pause(on) == /\ paused' = on
             /\ goal' = IF on /\ goal = "agent" THEN "none" ELSE goal
             /\ UNCHANGED <<input, grace, want, actedPaused, tookWheel, last>>
\* the player decides to take over; Reclaim is them doing it (a key press)
Want == ~want /\ want' = TRUE /\ UNCHANGED <<paused, input, goal, grace, actedPaused, tookWheel, last>>
Reclaim == want /\ PlayerMove
\* PLAYER_GRACE_S passes without the player touching anything
GraceEnds == grace /\ input = "idle" /\ goal # "player" /\ grace' = FALSE
             /\ UNCHANGED <<paused, input, goal, want, actedPaused, tookWheel, last>>

\* World.playerSteering
Steering == input = "moving" \/ goal = "player" \/ grace

\* one MCP tool call: the MCP layer asks agentMayAct first; move_to then goes through setGoal(…, 'agent'),
\* refused while paused (AGENT_PAUSED) or while the player steers (PLAYER_STEERING); stop is
\* setGoal(null, 'agent'), which only ends the agent's own walk
AgentGoal(t) == CASE t = "move_to" -> IF ~paused /\ ~Steering THEN "agent" ELSE goal
                  [] t = "stop"    -> IF goal = "agent" THEN "none" ELSE goal
                  [] OTHER         -> goal
AgentCall(t) ==
  /\ ~paused \/ t \in Allowed
  /\ goal' = AgentGoal(t)
  /\ last' = t
  /\ actedPaused' = (actedPaused \/ (paused /\ t \notin Allowed))
  /\ tookWheel' = (tookWheel \/ (goal = "player" /\ goal' # "player"))
  /\ UNCHANGED <<paused, input, grace, want>>

\* the walk reaches its goal; the end of the player's own walk starts the grace
Arrive == goal # "none" /\ input = "idle" /\ goal' = "none"
          /\ grace' = (grace \/ goal = "player")
          /\ UNCHANGED <<paused, input, want, actedPaused, tookWheel, last>>

Next == \/ PlayerMove \/ PlayerStop \/ PlayerGoto \/ Pause(TRUE) \/ Pause(FALSE) \/ Want \/ GraceEnds \/ Arrive
        \/ \E t \in Tools : AgentCall(t)
Spec == Init /\ [][Next]_vars /\ WF_vars(Reclaim)

\* who moves the wizard in the next tick (moveWizard: WASD first, then the goal)
Driver == IF input = "moving" THEN "player" ELSE goal

TypeOK == /\ paused \in BOOLEAN /\ input \in {"idle", "moving"} /\ goal \in {"none", "agent", "player"}
          /\ grace \in BOOLEAN /\ last \in Tools \cup {"none"}
\* ---- invariants
PausedBlocksAgent         == (paused => goal # "agent") /\ ~actedPaused
HumanInputClearsAgentGoal == input = "moving" => goal # "agent"
PlayerDrivesWhenSteering  == input = "moving" => Driver = "player"
\* an agent never overrides nor cancels the walk the player clicked
PlayerGoalIsThePlayers    == ~tookWheel
\* ---- properties
\* the player's own controls are never refused
PlayerNeverBlocked == [](ENABLED PlayerMove /\ ENABLED PlayerGoto /\ ENABLED Pause(TRUE))
\* an agent's walk only ever starts once the player has let go for the whole grace
AgentWaitsItsTurn == [][(goal' = "agent" /\ goal # "agent") => (~paused /\ ~Steering)]_vars
\* liveness: once the player wants the wheel, they have it
HumanCanAlwaysReclaim == want ~> (Driver = "player")
=============================================================================
