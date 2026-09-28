---------------------------- MODULE Hostility ----------------------------
(* The hostility relation of src/kernel/world.ts `canHarm`, over every combination of
   entity states. Checked invariants are the rules the rest of the kernel relies on. *)
EXTENDS Naturals, FiniteSets

Wizards   == {"a", "b"}
Summons   == {"sa", "sb"}           \* sa belongs to a, sb to b
Wild      == {"pixie"}              \* hostile
Benign    == {"unicorn"}
Invuln    == {"phoenix"}
Entities  == Wizards \cup Summons \cup Wild \cup Benign \cup Invuln
Owner(s)  == IF s = "sa" THEN "a" ELSE "b"

VARIABLES house, active, safe, alive, pvp, ff
vars == <<house, active, safe, alive, pvp, ff>>

Init ==
  /\ house  \in [Wizards -> {"G", "S"}]
  /\ active \in [Wizards -> BOOLEAN]            \* not stunned / jailed / offline
  /\ safe   \in [Entities -> BOOLEAN]           \* standing in a safe zone
  /\ alive  \in [Entities -> BOOLEAN]
  /\ pvp    \in BOOLEAN
  /\ ff     \in BOOLEAN
Next == UNCHANGED vars                          \* a static relation: TLC checks every initial state

PvP(x, y) == pvp /\ (house[x] # house[y] \/ ff)

RECURSIVE CanHarm(_, _)
CanHarm(src, dst) ==
  IF src = dst THEN FALSE
  ELSE IF ~alive[dst] THEN FALSE
  ELSE IF dst \in Wizards /\ ~active[dst] THEN FALSE
  ELSE IF dst \in Invuln THEN FALSE
  ELSE IF safe[dst] THEN FALSE
  ELSE IF src \in Summons THEN
         IF dst = Owner(src) \/ (dst \in Summons /\ Owner(dst) = Owner(src)) THEN FALSE
         ELSE CanHarm(Owner(src), dst)
  ELSE IF src \in Wild THEN dst \in Wizards \cup Summons
  ELSE IF src \in Benign \cup Invuln THEN FALSE
  ELSE IF safe[src] THEN FALSE                   \* src is a wizard from here on
  ELSE IF dst \in Summons THEN
         IF Owner(dst) = src THEN FALSE ELSE PvP(src, Owner(dst))
  ELSE IF dst \in Wizards THEN PvP(src, dst)
  ELSE TRUE

\* ---- invariants
NoSelfHarm          == \A e \in Entities : ~CanHarm(e, e)
SafeZonesAreSafe    == \A s, d \in Entities : safe[d] => ~CanHarm(s, d)
StunnedUntouchable  == \A s \in Entities, w \in Wizards : ~active[w] => ~CanHarm(s, w)
BenignNeverAttack   == \A b \in Benign \cup Invuln, d \in Entities : ~CanHarm(b, d)
PhoenixUntouchable  == \A s \in Entities, p \in Invuln : ~CanHarm(s, p)
SummonLoyal         == \A s \in Summons : ~CanHarm(s, Owner(s))
SummonProxy         == \A s \in Summons, d \in Entities :
                         (d # Owner(s) /\ ~(d \in Summons /\ Owner(d) = Owner(s)))
                           => (CanHarm(s, d) = (alive[d] /\ ~safe[d] /\ ~(d \in Invuln) /\ ~(d \in Wizards /\ ~active[d]) /\ CanHarm(Owner(s), d)))
WildOnlyHuntsWizardsAndSummons == \A w \in Wild, d \in Entities : CanHarm(w, d) => d \in Wizards \cup Summons
NoPvPMeansNoPvP     == ~pvp => \A x, y \in Wizards : ~CanHarm(x, y)
AttackSummonIsAttackOwner == \A w \in Wizards, s \in Summons :
                         (Owner(s) # w /\ alive[s] /\ ~safe[s] /\ ~safe[w]) => (CanHarm(w, s) = PvP(w, Owner(s)))
============================================================================
