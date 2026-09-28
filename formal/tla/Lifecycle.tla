----------------------------- MODULE Lifecycle -----------------------------
(* A wizard's life cycle (world.ts tick/stun/revive/sendToAzkaban) and the summons that depend on it.
   Timers count down in ticks. Summons exist only while their owner is active. *)
EXTENDS Naturals

CONSTANTS Respawn, Jail, SummonLife

VARIABLES state, timer, summon, slife
vars == <<state, timer, summon, slife>>
States == {"active", "stunned", "jailed"}

Init == state = "active" /\ timer = 0 /\ summon = FALSE /\ slife = 0

Stun      == state = "active" /\ state' = "stunned" /\ timer' = Respawn /\ summon' = FALSE /\ slife' = 0
ToAzkaban == state = "active" /\ state' = "jailed"  /\ timer' = Jail    /\ summon' = FALSE /\ slife' = 0
Revive    == state = "stunned" /\ state' = "active" /\ timer' = 0 /\ UNCHANGED <<summon, slife>>
Summon    == state = "active" /\ summon' = TRUE /\ slife' = SummonLife /\ UNCHANGED <<state, timer>>
\* one world tick: timers run down; expired stuns respawn, expired sentences release; summons age
Tick ==
  /\ timer' = IF timer > 0 THEN timer - 1 ELSE 0
  /\ state' = IF state # "active" /\ timer <= 1 THEN "active" ELSE state
  /\ slife' = IF slife > 0 THEN slife - 1 ELSE 0
  /\ summon' = (summon /\ slife > 1 /\ state = "active")

Next == Stun \/ ToAzkaban \/ Revive \/ Summon \/ Tick
Spec == Init /\ [][Next]_vars /\ WF_vars(Tick)

TypeOK == state \in States /\ timer \in 0..(IF Respawn > Jail THEN Respawn ELSE Jail) /\ slife \in 0..SummonLife
\* summons never outlive their owner being in play
SummonNeedsOwner == summon => state = "active"
ActiveHasNoTimer == state = "active" => timer = 0
\* liveness: nobody stays stunned or in Azkaban forever
EventuallyBack == (state # "active") ~> (state = "active")
\* a summon always has life left, and when it runs out it vanishes unless it was just recast
SummonHasLife == summon => slife \in 1..SummonLife
SummonsExpire == (summon /\ slife = 1) ~> (~summon \/ slife = SummonLife)
=============================================================================
