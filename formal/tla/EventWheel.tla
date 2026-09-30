----------------------------- MODULE EventWheel -----------------------------
(* 校园事件轮盘 the event wheel (src/kernel/wheel.ts: stepWheel, choose, startEvent, settle, finish; World.slay /
   stepProjectiles / placeEggs calling the wheel's hooks, which settle an event early when it is won).
   The world clock ticks; when nothing runs, the wheel is on (a decree may switch it off) and the clock has passed
   nextAt, an event from the pool is rolled with its deadline (its own length, clamped to MaxDur = EVENT_MAX_S, and
   cut shorter by the end of the term: startEvent ends it with the term, never less than TERM_TAIL_S away, and none
   is rolled in the term's last TERM_TAIL_S — so here any deadline from 1 up to that length).
   While it runs it can be won (the troll falls, the snitch is caught, Peeves is hit…) — possibly by two hooks in
   the same tick, which is why Settle may be attempted again — and at its deadline it is lost. settle pays once (the
   `paid` flag); finish removes it and schedules the next roll no sooner than Gap later. The history variable `pays`
   counts payments afresh, not through the guard.
   Checked: at most one event runs at a time; a running event never outlives its deadline (the clock cannot pass a
   deadline with the event still on: stepWheel settles it in the tick that reaches it); no event lasts longer than
   MaxDur; rewards are paid at most once per event, only for a decided event, and every decided event was paid;
   every event that starts eventually ends (liveness, weak fairness on the clock, the deadline and finish).
   Non-vacuity: EventWheelWitness asks TLC for a behaviour in which one event was won and paid and a later one lost
   at its deadline and paid, after a decree switched the wheel off and on — and TLC finds it. *)
EXTENDS Naturals, FiniteSets

CONSTANTS Events, Dur, MaxDur, MaxT, MaxN, Gap, Interval

\* the events' own lengths (the troll 150 s, the snitch 90 s, Peeves 60 s — scaled down; the troll's is over MaxDur,
\* so startEvent's clamp to EVENT_MAX_S is exercised)
DurDef == [e \in Events |-> CASE e = "troll" -> 6 [] e = "snitch" -> 3 [] OTHER -> 2]

VARIABLES now, running, status, deadline, startAt, paidFlag, pays, n, nextAt, enabled, toggled
vars == <<now, running, status, deadline, startAt, paidFlag, pays, n, nextAt, enabled, toggled>>

Ids == 1..MaxN
Status == {"idle", "on", "won", "lost", "done"}
Max(a, b) == IF a > b THEN a ELSE b
Min(a, b) == IF a < b THEN a ELSE b

Init == /\ now = 0 /\ running = {} /\ status = [i \in Ids |-> "idle"] /\ deadline = [i \in Ids |-> 0]
        /\ startAt = [i \in Ids |-> 0] /\ paidFlag = [i \in Ids |-> FALSE] /\ pays = [i \in Ids |-> 0]
        /\ n = 0 /\ nextAt = Interval /\ enabled = TRUE /\ toggled = FALSE

\* the clock: never past the deadline of an event still on (the tick that reaches it settles it)
Tick == /\ now < MaxT
        /\ \A i \in running : status[i] = "on" => now < deadline[i]
        /\ now' = now + 1
        /\ UNCHANGED <<running, status, deadline, startAt, paidFlag, pays, n, nextAt, enabled, toggled>>

\* stepWheel -> choose -> startEvent: only when nothing runs (startEvent refuses a second event)
Roll(e) == /\ running = {} /\ enabled /\ now >= nextAt /\ n < MaxN /\ now + Min(Dur[e], MaxDur) <= MaxT
           /\ LET i == n + 1 IN
                /\ n' = i /\ running' = {i} /\ status' = [status EXCEPT ![i] = "on"]
                /\ \E d \in 1..Min(Dur[e], MaxDur) : deadline' = [deadline EXCEPT ![i] = now + d] \* the bell may cut it short
                /\ startAt' = [startAt EXCEPT ![i] = now]
           /\ UNCHANGED <<now, paidFlag, pays, nextAt, enabled, toggled>>

\* settle(e, outcome): decides once and pays once (the paid flag); a second call changes nothing
Settle(i, o) == /\ i \in running
                /\ IF paidFlag[i]
                   THEN UNCHANGED <<status, paidFlag, pays>>
                   ELSE /\ paidFlag' = [paidFlag EXCEPT ![i] = TRUE]
                        /\ pays' = [pays EXCEPT ![i] = @ + 1]
                        /\ status' = [status EXCEPT ![i] = o]
                /\ UNCHANGED <<now, running, deadline, startAt, n, nextAt, enabled, toggled>>

\* won early by a hook (slay / a bolt / the Room), while it is on and before its deadline
Win(i) == /\ i \in running /\ status[i] = "on" /\ now <= deadline[i] /\ Settle(i, "won")
\* a second hook in the same tick, after it was decided
Again(i) == /\ i \in running /\ status[i] \in {"won", "lost"} /\ Settle(i, "won")
\* the deadline: lost
Expire(i) == /\ i \in running /\ status[i] = "on" /\ now >= deadline[i] /\ Settle(i, "lost")

\* finish: tidy up and schedule the next roll (start + Interval, never sooner than Gap after the end)
Finish(i) == /\ i \in running /\ status[i] \in {"won", "lost"}
             /\ running' = {} /\ status' = [status EXCEPT ![i] = "done"]
             /\ nextAt' = Max(startAt[i] + Interval, now + Gap)
             /\ UNCHANGED <<now, deadline, startAt, paidFlag, pays, n, enabled, toggled>>

\* a decree switches the wheel off or on (a running event runs to its end either way)
Toggle == /\ enabled' = ~enabled /\ toggled' = TRUE
          /\ UNCHANGED <<now, running, status, deadline, startAt, paidFlag, pays, n, nextAt>>

Next == \/ Tick \/ Toggle
        \/ \E e \in Events : Roll(e)
        \/ \E i \in Ids : Win(i) \/ Again(i) \/ Expire(i) \/ Finish(i)

Spec == Init /\ [][Next]_vars /\ WF_vars(Tick) /\ \A i \in Ids : WF_vars(Expire(i)) /\ WF_vars(Finish(i))

TypeOK == /\ now \in 0..MaxT /\ running \subseteq Ids /\ status \in [Ids -> Status] /\ n \in 0..MaxN
          /\ paidFlag \in [Ids -> BOOLEAN] /\ pays \in [Ids -> 0..MaxN] /\ enabled \in BOOLEAN

AtMostOneActive == Cardinality(running) <= 1
RunningAreOn == \A i \in running : status[i] \in {"on", "won", "lost"}
EndsByDeadline == \A i \in Ids : status[i] = "on" => now <= deadline[i]
DeadlineBounded == \A i \in Ids : status[i] # "idle" => deadline[i] - startAt[i] <= MaxDur
PaidAtMostOnce == \A i \in Ids : pays[i] <= 1
PaidOnlyDecided == \A i \in Ids : pays[i] = 1 => status[i] \in {"won", "lost", "done"}
DecidedArePaid == \A i \in Ids : status[i] \in {"won", "lost", "done"} => pays[i] = 1

\* liveness: every event that starts ends (won, or lost at its deadline) and is tidied away
EveryEventEnds == \A i \in Ids : (status[i] = "on") ~> (status[i] = "done")
=============================================================================
