----------------------------- MODULE TermDecree -----------------------------
(* Terms, the Minister for Magic and decrees (world.ts endTerm / decree, rulebook.ts applyPatch).
   A rule is a number with constitutional bounds; a decree may set it to any value, but applyPatch
   rejects anything outside the bounds. *)
EXTENDS Naturals, FiniteSets

CONSTANTS Players, NPCs, MaxRep, MinRep, Lo, Hi, Candidates
Wizards == Players \cup NPCs

VARIABLES rep, charges, rule, decreesThisTerm, minister
vars == <<rep, charges, rule, decreesThisTerm, minister>>

Init == rep \in [Wizards -> 0..MaxRep] /\ charges = [w \in Wizards |-> 0] /\ rule = Lo
        /\ decreesThisTerm = 0 /\ minister = "none"

Gain(w) == rep[w] < MaxRep /\ rep' = [rep EXCEPT ![w] = rep[w] + 1] /\ UNCHANGED <<charges, rule, decreesThisTerm, minister>>

\* end of term: the highest-reputation *player* with >= MinRep becomes Minister; all other charges lapse; the
\* reputation of those who played this term halves (NPCs always play; the absent keep theirs: any subset may be absent)
EndTerm ==
  LET eligible == {p \in Players : rep[p] >= MinRep /\ \A q \in Players : rep[q] <= rep[p]}
  IN /\ IF eligible = {} THEN charges' = [w \in Wizards |-> 0] /\ minister' = "none"
        ELSE \E m \in eligible : charges' = [w \in Wizards |-> IF w = m THEN 1 ELSE 0] /\ minister' = m
     /\ \E absent \in SUBSET Players : rep' = [w \in Wizards |-> IF w \in absent THEN rep[w] ELSE rep[w] \div 2]
     /\ decreesThisTerm' = 0
     /\ UNCHANGED rule

\* a decree proposes any candidate value; out-of-bounds proposals are refused and keep the charge
Decree(w, v) ==
  /\ charges[w] = 1
  /\ IF v >= Lo /\ v <= Hi
     THEN rule' = v /\ charges' = [charges EXCEPT ![w] = 0] /\ decreesThisTerm' = decreesThisTerm + 1
     ELSE UNCHANGED <<rule, charges, decreesThisTerm>>
  /\ UNCHANGED <<rep, minister>>

Next == EndTerm \/ \E w \in Wizards : Gain(w) \/ \E v \in Candidates : Decree(w, v)

AtMostOneCharge == Cardinality({w \in Wizards : charges[w] > 0}) <= 1 /\ \A w \in Wizards : charges[w] \in {0, 1}
NPCsNeverRule == \A n \in NPCs : charges[n] = 0
RulesWithinConstitution == rule \in Lo..Hi
OneDecreePerTerm == decreesThisTerm <= 1
OnlyMinisterDecrees == \A w \in Wizards : charges[w] = 1 => w = minister
\* progression.ts electMinister (Lean elect_never_npc): the office is a player's or vacant, whatever the NPCs' reputation
MinisterIsPlayer == minister \in Players \cup {"none"}
=============================================================================
