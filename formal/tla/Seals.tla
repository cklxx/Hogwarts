------------------------------- MODULE Seals -------------------------------
(* The Restricted Section (world.ts readSealPage / breakSeal): seals break in order, only for a
   wizard of the right year holding every page, and at most three attempts per cooling window. *)
EXTENDS Naturals, Sequences

CONSTANTS Window, MaxYear
YearReq == <<2, 4, 5, 7>>   \* SEAL_TIERS[t].year in seals.ts
Pages   == <<2, 3, 4, 5>>   \* number of pages per tier

VARIABLES seals, year, pages, tries, clock
vars == <<seals, year, pages, tries, clock>>
Tiers == 1..4

Init == seals = 0 /\ year = 1 /\ pages = [t \in Tiers |-> 0] /\ tries = [t \in Tiers |-> << >>] /\ clock = 0

Recent(t) == SelectSeq(tries[t], LAMBDA x : clock - x < Window)
Grow == year < MaxYear /\ year' = year + 1 /\ UNCHANGED <<seals, pages, tries, clock>>
Read(t) == seals < t /\ pages[t] < Pages[t] /\ pages' = [pages EXCEPT ![t] = pages[t] + 1] /\ UNCHANGED <<seals, year, tries, clock>>
Tick == clock < 2 * Window /\ clock' = clock + 1 /\ UNCHANGED <<seals, year, pages, tries>>
\* an attempt is only *accepted for checking* if every precondition holds; right answers open it
Attempt(t, right) ==
  /\ seals = t - 1 /\ year >= YearReq[t] /\ pages[t] = Pages[t] /\ Len(Recent(t)) < 3
  /\ IF right THEN seals' = t /\ tries' = [tries EXCEPT ![t] = << >>]
              ELSE tries' = [tries EXCEPT ![t] = Recent(t) \o <<clock>>] /\ UNCHANGED seals
  /\ UNCHANGED <<year, pages, clock>>

Next == Grow \/ Tick \/ \E t \in Tiers : Read(t) \/ Attempt(t, TRUE) \/ Attempt(t, FALSE)

InOrder == seals \in 0..4
BrokenMeansQualified == \A t \in Tiers : seals >= t => (year >= YearReq[t] /\ pages[t] = Pages[t])
RateLimited == \A t \in Tiers : Len(Recent(t)) <= 3
Monotone == [][seals' >= seals]_vars
=============================================================================
