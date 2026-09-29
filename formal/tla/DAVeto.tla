------------------------------- MODULE DAVeto -------------------------------
(* Dumbledore's Army's veto (src/kernel/world.ts decree / vetoDecree / enactVeto / unfairSweep / endTerm).
   A rule with constitutional bounds, a Minister holding decree charges, DA members who come and go
   online and vote. VoteVeto(m) is World.vetoDecree clause by clause: a member in play votes; the veto
   passes at that vote when at least Quorum members are online and a strict majority of THEM has voted,
   within Window ticks of the decree, and only if the DA has not vetoed this term. It restores the
   rulebook the decree replaced (VetoWindow.before). Charges models how many decrees a Minister may issue
   per term: the kernel gives one (TermDecree.OneDecreePerTerm), but the veto's budget clause is checked
   with 2 so that it is the budget, not the single charge, that keeps it at one veto per term. *)
EXTENDS Naturals, FiniteSets

CONSTANTS Members, Quorum, Window, Lo, Hi, Candidates, MaxTerm, Charges

VARIABLES term, charges, rule, before, decreed, dstate, age, votes, online, vetoTerm, vetoes, lastVeto
vars == <<term, charges, rule, before, decreed, dstate, age, votes, online, vetoTerm, vetoes, lastVeto>>
None == [a |-> 0, n |-> 0, v |-> 0, t |-> 0]   \* lastVeto before any veto (t = 0: no term)

Init == /\ term = 1 /\ charges \in 0..Charges /\ rule \in Lo..Hi /\ before = rule /\ decreed = rule
        /\ dstate = "none" /\ age = 0 /\ votes = {} /\ online \in SUBSET Members
        /\ vetoTerm = 0 /\ vetoes = 0 /\ lastVeto = None

\* endTerm: a new Minister (or none) gets the term's charges; the old decree can no longer be vetoed
EndTerm == /\ term < MaxTerm
           /\ term' = term + 1 /\ charges' \in 0..Charges
           /\ dstate' = "none" /\ age' = 0 /\ votes' = {} /\ vetoes' = 0
           /\ UNCHANGED <<rule, before, decreed, online, vetoTerm, lastVeto>>

\* decree (dry_run: false): applyPatch refuses out-of-bounds values; an enacted one opens the veto window
Decree(v) == /\ charges > 0
             /\ IF v >= Lo /\ v <= Hi
                THEN /\ rule' = v /\ before' = rule /\ decreed' = v /\ charges' = charges - 1
                     /\ dstate' = "enacted" /\ age' = 0 /\ votes' = {}
                ELSE UNCHANGED <<rule, before, decreed, charges, dstate, age, votes>>
             /\ UNCHANGED <<term, online, vetoTerm, vetoes, lastVeto>>

\* time passes: the window closes (age saturates just past it; the 1 Hz sweep drops the VetoWindow)
Tick == /\ age' = IF dstate = "enacted" /\ age <= Window THEN age + 1 ELSE age
        /\ UNCHANGED <<term, charges, rule, before, decreed, dstate, votes, online, vetoTerm, vetoes, lastVeto>>

Join(m)  == m \notin online /\ online' = online \cup {m} /\ UNCHANGED <<term, charges, rule, before, decreed, dstate, age, votes, vetoTerm, vetoes, lastVeto>>
Leave(m) == m \in online /\ online' = online \ {m} /\ UNCHANGED <<term, charges, rule, before, decreed, dstate, age, votes, vetoTerm, vetoes, lastVeto>>

\* World.vetoDecree(m): the guards, then the vote, then (maybe) the veto, in one step
VoteVeto(m) ==
  /\ m \in online                       \* a member in play
  /\ vetoTerm # term                    \* DA_VETOES_PER_TERM = 1
  /\ dstate = "enacted"                 \* a decree this term to veto
  /\ age <= Window                      \* DA_VETO_WINDOW_S
  /\ LET vs == votes \cup {m}
         n  == Cardinality(online)
         k  == Cardinality(vs \cap online)
     IN /\ votes' = vs
        /\ IF n >= Quorum /\ 2 * k > n  \* DA_QUORUM and a strict majority of the members online
           THEN /\ rule' = before /\ dstate' = "vetoed" /\ vetoTerm' = term /\ vetoes' = vetoes + 1
                \* history, measured afresh (not through n and k) so the invariants below judge the guard
                /\ lastVeto' = [a |-> age, n |-> Cardinality(online), v |-> Cardinality(vs \cap online), t |-> term]
           ELSE UNCHANGED <<rule, dstate, vetoTerm, vetoes, lastVeto>>
  /\ UNCHANGED <<term, charges, before, decreed, age, online>>

Next == EndTerm \/ Tick \/ \E v \in Candidates : Decree(v)
        \/ \E m \in Members : Join(m) \/ Leave(m) \/ VoteVeto(m)
Spec == Init /\ [][Next]_vars

TypeOK == /\ term \in 1..MaxTerm /\ charges \in 0..Charges /\ rule \in Lo..Hi /\ before \in Lo..Hi
          /\ dstate \in {"none", "enacted", "vetoed"} /\ age \in 0..(Window + 1)
          /\ votes \subseteq Members /\ online \subseteq Members /\ vetoTerm \in 0..MaxTerm
\* ---- invariants
AtMostOneVetoPerTerm == vetoes <= 1
VetoOnlyInWindow     == lastVeto.t > 0 => lastVeto.a <= Window
VetoOnlyWithQuorum   == lastVeto.t > 0 => lastVeto.n >= Quorum /\ 2 * lastVeto.v > lastVeto.n
\* the decree's state and the rulebook agree: an enacted decree is in force, a vetoed one is undone
DecreeStateConsistent == /\ dstate = "enacted" => rule = decreed
                         /\ dstate = "vetoed" => rule = before /\ vetoTerm = term
                         /\ vetoes = (IF vetoTerm = term THEN 1 ELSE 0)
RulesWithinConstitution == rule \in Lo..Hi
\* ---- action properties
\* a veto restores exactly the rulebook the decree replaced, and happens only to an enacted decree
VetoRestores == [][dstate' = "vetoed" /\ dstate # "vetoed" => dstate = "enacted" /\ rule' = before]_vars
\* a vetoed decree stays undone: its state changes only with a new term or a new decree (which the budget then keeps)
VetoSticks   == [][dstate = "vetoed" /\ dstate' # "vetoed" => term' = term + 1 \/ (dstate' = "enacted" /\ charges' < charges)]_vars
=============================================================================
