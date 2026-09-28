----------------------------- MODULE CastTxn -----------------------------
(* The casting transaction of src/kernel/magic.ts `execute`, including (after ...) blocks.
   A cast plans effects, then commits all of them or none. A delayed block is its own
   transaction and may not schedule further blocks. *)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS MaxMana, Overhead, Costs, E, A, MaxPending
\* Costs: possible per-effect costs; E: effects allowed per cast; A: (after ...) blocks per cast

VARIABLES mana, applied, pending, lastOk
\* applied = effects applied by the most recent transaction (keeps the state space finite)
vars == <<mana, applied, pending, lastOk>>

Plans == UNION { [1..n -> Costs] : n \in 0..(E + 1) }     \* includes over-long plans (must fizzle)
Sum(p) == LET RECURSIVE S(_) S(i) == IF i = 0 THEN 0 ELSE p[i] + S(i - 1) IN S(Len(p))

Init == mana = MaxMana /\ applied = 0 /\ pending = << >> /\ lastOk = TRUE

\* A top-level cast: plan p (effects) and k delayed blocks, each with its own plan
Cast(p, blocks) ==
  LET total == Overhead + Sum(p)
      ok == Len(p) <= E /\ Len(blocks) <= A /\ total <= mana /\ Len(pending) + Len(blocks) <= MaxPending
  IN /\ lastOk' = ok
     /\ IF ok THEN /\ mana' = mana - total
                   /\ applied' = Len(p)
                   /\ pending' = pending \o blocks
              ELSE /\ applied' = 0 /\ UNCHANGED <<mana, pending>>

\* A delayed block runs as its own transaction (pays overhead, cannot schedule more)
RunDelayed ==
  /\ pending # << >>
  /\ LET p == Head(pending) total == Overhead + Sum(p) ok == Len(p) <= E /\ total <= mana
     IN /\ pending' = Tail(pending)
        /\ lastOk' = ok
        /\ IF ok THEN mana' = mana - total /\ applied' = Len(p) ELSE mana' = mana /\ applied' = 0

Regen == mana < MaxMana /\ mana' = mana + 1 /\ applied' = 0 /\ UNCHANGED <<pending, lastOk>>

Next ==
  \/ \E p \in Plans, n \in 0..(A + 1) : \E blocks \in [1..n -> Plans] : Cast(p, blocks)
  \/ RunDelayed
  \/ Regen

\* ---- invariants
ManaNeverNegative == mana \in 0..MaxMana
\* Per-cast effect bound, as two step properties whose conjunction gives <= E * (1 + A)
\* effects per cast (the arithmetic is proved in formal/lean/Hogwarts.lean, effects_per_cast_bound):
\*   every transaction applies at most E effects, and only top-level casts schedule blocks (at most A)
StepBound == applied <= E
OnlyCastsSchedule == [][Len(pending') > Len(pending) => Len(pending') - Len(pending) <= A]_vars
PendingBounded == Len(pending) <= MaxPending
\* fizzles are free: a failed transaction leaves mana and applied effects untouched (checked as an action property)
Atomic == [][~lastOk' => (mana' >= mana /\ applied' = 0)]_vars
=============================================================================
