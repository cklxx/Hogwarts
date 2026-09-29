------------------------- MODULE EventWheelWitness -------------------------
(* Non-vacuity for EventWheel: the invariant below says "this never happens"; formal/run.sh expects TLC to find
   it violated (a *Witness spec passes when TLC produces the behaviour). The behaviour: a decree switched the wheel
   off and back on, one event was won and paid, and a later one was lost at its deadline and paid — so rolls, early
   wins, deadlines, payment and the decree switch are all reachable, and EventWheel's invariants are not vacuous. *)
EXTENDS EventWheel

NoSuchHistory == ~(toggled /\ enabled /\ n >= 2
                   /\ \E i, j \in Ids : i < j /\ pays[i] = 1 /\ pays[j] = 1
                                     /\ status[j] = "lost" /\ now = deadline[j]
                                     /\ status[i] = "done" /\ deadline[i] > startAt[i])
=============================================================================
