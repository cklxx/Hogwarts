------------------------- MODULE BoundedGovernance -------------------------
(* One Minister, one decree, a leaf budget, and automatic expiry at term end. *)
EXTENDS Naturals

CONSTANTS Budget, TermMax
VARIABLES term, minister, charge, changed, active, enactedTerm
vars == <<term, minister, charge, changed, active, enactedTerm>>

Init == term = 1 /\ minister = 0 /\ charge = 0 /\ changed = 0 /\ active = FALSE /\ enactedTerm = 0

Elect(m) ==
  /\ term < TermMax
  /\ m \in 1..2
  /\ term' = term + 1
  /\ minister' = m
  /\ charge' = 1
  /\ changed' = 0
  /\ active' = FALSE
  /\ enactedTerm' = 0

Decree(n) ==
  /\ charge = 1
  /\ n \in 1..Budget
  /\ charge' = 0
  /\ changed' = n
  /\ active' = TRUE
  /\ enactedTerm' = term
  /\ UNCHANGED <<term, minister>>

Expire ==
  /\ active
  /\ term < TermMax
  /\ term' = term + 1
  /\ active' = FALSE
  /\ changed' = 0
  /\ minister' = 0
  /\ charge' = 0
  /\ enactedTerm' = 0

Next == (\E m \in 1..2 : Elect(m)) \/ (\E n \in 1..Budget : Decree(n)) \/ Expire

BudgetBounded == changed <= Budget
ChargeBounded == charge \in {0, 1}
ActiveHasTerm == active => enactedTerm = term
ExpiredPolicyAbsent == enactedTerm = 0 => ~active
=============================================================================
