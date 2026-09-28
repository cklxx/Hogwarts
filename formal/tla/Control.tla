------------------------------ MODULE Control ------------------------------
(* A player and their agent share one wizard: src/kernel/world.ts setInput / setGoal(…, by) /
   setAgentPaused / agentMayAct (docs/AGENT_LINK.md §C.1). The player's hands always win: WASD cancels
   any walk, an agent cannot start one while the player steers or while paused, pausing cancels the
   agent's walk, and a paused agent can only call the tools on AGENT_PAUSE_ALLOWED. *)
EXTENDS Naturals

CONSTANTS Tools, Allowed   \* Allowed \subseteq Tools: AGENT_PAUSE_ALLOWED; "move_to" \in Tools \ Allowed

VARIABLES paused, input, goal, want, actedPaused, last
vars == <<paused, input, goal, want, actedPaused, last>>
\* input: the player's WASD ("idle" | "moving"); goal: who set the current walk ("none" | "agent" | "player")
\* want (history): the player has decided to take the wheel; actedPaused (history): an action ran while paused

Init == paused = FALSE /\ input = "idle" /\ goal = "none" /\ want = FALSE /\ actedPaused = FALSE /\ last = "none"

\* setInput with a direction: every walk ends, whoever set it
PlayerMove == input' = "moving" /\ goal' = "none" /\ want' = FALSE /\ UNCHANGED <<paused, actedPaused, last>>
PlayerStop == input' = "idle" /\ UNCHANGED <<paused, goal, want, actedPaused, last>>
\* click-to-move: setGoal(…, 'player')
PlayerGoto == goal' = "player" /\ want' = FALSE /\ UNCHANGED <<paused, input, actedPaused, last>>
\* setAgentPaused(on): pausing also cancels the walk the agent set
Pause(on) == /\ paused' = on
             /\ goal' = IF on /\ goal = "agent" THEN "none" ELSE goal
             /\ UNCHANGED <<input, want, actedPaused, last>>
\* the player decides to take over; Reclaim is them doing it (a key press)
Want == ~want /\ want' = TRUE /\ UNCHANGED <<paused, input, goal, actedPaused, last>>
Reclaim == want /\ PlayerMove

\* one MCP tool call: the MCP layer asks agentMayAct first; move_to then goes through setGoal(…, 'agent'),
\* which refuses while paused (AGENT_PAUSED) or while the player steers (PLAYER_STEERING)
AgentCall(t) ==
  /\ ~paused \/ t \in Allowed
  /\ IF t = "move_to" THEN ~paused /\ input = "idle" /\ goal' = "agent" ELSE UNCHANGED goal
  /\ last' = t
  /\ actedPaused' = (actedPaused \/ (paused /\ t \notin Allowed))
  /\ UNCHANGED <<paused, input, want>>

\* the walk reaches its goal
Arrive == goal # "none" /\ input = "idle" /\ goal' = "none" /\ UNCHANGED <<paused, input, want, actedPaused, last>>

Next == PlayerMove \/ PlayerStop \/ PlayerGoto \/ Pause(TRUE) \/ Pause(FALSE) \/ Want \/ Arrive \/ \E t \in Tools : AgentCall(t)
Spec == Init /\ [][Next]_vars /\ WF_vars(Reclaim)

\* who moves the wizard in the next tick (moveWizard: WASD first, then the goal)
Driver == IF input = "moving" THEN "player" ELSE goal

TypeOK == paused \in BOOLEAN /\ input \in {"idle", "moving"} /\ goal \in {"none", "agent", "player"} /\ last \in Tools \cup {"none"}
\* ---- invariants
PausedBlocksAgent         == (paused => goal # "agent") /\ ~actedPaused
HumanInputClearsAgentGoal == input = "moving" => goal # "agent"
PlayerDrivesWhenSteering  == input = "moving" => Driver = "player"
\* ---- properties
\* the player's own controls are never refused
PlayerNeverBlocked == [](ENABLED PlayerMove /\ ENABLED Pause(TRUE))
\* liveness: once the player wants the wheel, they have it
HumanCanAlwaysReclaim == want ~> (Driver = "player")
=============================================================================
