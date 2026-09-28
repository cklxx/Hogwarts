------------------------------ MODULE Pairing ------------------------------
(* Pairing codes: src/kernel/world.ts mintPairCode / redeemPairCode / sweep (docs/AGENT_LINK.md §A.2).
   A code is minted for a wizard by an explicit human action, lives TTL ticks, binds a session at most
   once, and each wizard has at most one live code (minting again kills the previous one). A failed
   attempt — an unknown or guessed code, a used one, one past its TTL — is recorded in a sliding window;
   while the window holds FailCap failures every attempt is refused, the right code included
   (PAIR_FAIL_PER_REALM_PER_MIN), so checked guesses are bounded. Lean pair_guess_bound turns that bound
   into odds over the 31^6 codes. *)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS Wizards, Codes, TTL, FailCap, Window

VARIABLES state, owner, age, fails, redeems, usedAge
vars == <<state, owner, age, fails, redeems, usedAge>>

None == "none"
States == {"free", "fresh", "used", "dead"}

Init == /\ state = [c \in Codes |-> "free"]
        /\ owner = [c \in Codes |-> None]
        /\ age = [c \in Codes |-> 0]
        /\ fails = << >>                 \* ages of the failed attempts still in the window, oldest first
        /\ redeems = [c \in Codes |-> 0]  \* history: how often each code bound a session
        /\ usedAge = [c \in Codes |-> 0]  \* history: the code's age when it was redeemed

Live(c) == state[c] = "fresh" /\ age[c] < TTL
Throttled == Len(fails) >= FailCap

\* mintPairCode: a new code for w; w's previous fresh code dies (dropPairCode)
Mint(w, c) ==
  /\ state[c] = "free"
  /\ state' = [d \in Codes |-> IF d = c THEN "fresh" ELSE IF state[d] = "fresh" /\ owner[d] = w THEN "dead" ELSE state[d]]
  /\ owner' = [owner EXCEPT ![c] = w]
  /\ age' = [age EXCEPT ![c] = 0]
  /\ UNCHANGED <<fails, redeems, usedAge>>

\* redeemPairCode with the right code, in time, while the realm is not throttled: the code is used up
Redeem(c) ==
  /\ ~Throttled
  /\ Live(c)
  /\ state' = [state EXCEPT ![c] = "used"]
  /\ redeems' = [redeems EXCEPT ![c] = redeems[c] + 1]
  /\ usedAge' = [usedAge EXCEPT ![c] = age[c]]
  /\ UNCHANGED <<owner, age, fails>>

\* redeemPairCode with anything else (a guess, a used code, an expired one not yet swept): a failure
Guess ==
  /\ ~Throttled
  /\ fails' = Append(fails, 0)
  /\ UNCHANGED <<state, owner, age, redeems, usedAge>>

\* the 1 Hz sweep deletes codes past their TTL
Expire(c) ==
  /\ state[c] = "fresh" /\ age[c] >= TTL
  /\ state' = [state EXCEPT ![c] = "dead"]
  /\ UNCHANGED <<owner, age, fails, redeems, usedAge>>

\* time passes: fresh codes age (capped at TTL); failures older than the window drop out
Tick ==
  /\ age' = [c \in Codes |-> IF state[c] = "fresh" /\ age[c] < TTL THEN age[c] + 1 ELSE age[c]]
  /\ fails' = SelectSeq([i \in 1..Len(fails) |-> fails[i] + 1], LAMBDA a : a < Window)
  /\ UNCHANGED <<state, owner, redeems, usedAge>>

Next == Tick \/ Guess \/ \E c \in Codes : Redeem(c) \/ Expire(c) \/ \E w \in Wizards : Mint(w, c)
Spec == Init /\ [][Next]_vars /\ WF_vars(Tick) /\ \A c \in Codes : WF_vars(Expire(c))

TypeOK == /\ state \in [Codes -> States] /\ owner \in [Codes -> Wizards \cup {None}]
          /\ age \in [Codes -> 0..TTL] /\ \A i \in 1..Len(fails) : fails[i] \in 0..(Window - 1)
\* ---- invariants
CodeSingleUse          == \A c \in Codes : redeems[c] <= 1
ExpiredNeverRedeemable == \A c \in Codes : state[c] = "used" => usedAge[c] < TTL
AtMostOneLivePerWizard == \A w \in Wizards : Cardinality({c \in Codes : state[c] = "fresh" /\ owner[c] = w}) <= 1
GuessesBounded         == Len(fails) <= FailCap
\* ---- properties
\* a used or dead code never comes back
UsedAndDeadAreFinal == [][\A c \in Codes : state[c] \in {"used", "dead"} => state'[c] = state[c]]_vars
\* liveness: every code is eventually used or dead (it cannot linger live forever)
EveryCodeSettles == \A c \in Codes : (state[c] = "fresh") ~> (state[c] \in {"used", "dead"})
=============================================================================
