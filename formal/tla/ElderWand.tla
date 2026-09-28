----------------------------- MODULE ElderWand -----------------------------
(* The Elder Wand (world.ts placeEggs / transferElderWand / elderWandUpkeep).
   It is always in exactly one place: the tomb, or one wizard's trunk; mastery follows defeat. *)
EXTENDS Naturals, FiniteSets

CONSTANTS W, Grace
VARIABLES holder, has, online, away
vars == <<holder, has, online, away>>
Tomb == "tomb"

Init == holder = Tomb /\ has = [w \in W |-> FALSE] /\ online \in [W -> BOOLEAN] /\ away = [w \in W |-> 0]

TakeFromTomb(w) == holder = Tomb /\ online[w] /\ holder' = w /\ has' = [has EXCEPT ![w] = TRUE] /\ UNCHANGED <<online, away>>
\* stunning or disarming the master transfers allegiance (and the item)
Defeat(a, b) == a # b /\ holder = b /\ online[a] /\ online[b]
                /\ holder' = a /\ has' = [has EXCEPT ![b] = FALSE, ![a] = TRUE] /\ UNCHANGED <<online, away>>
GoOffline(w) == online[w] /\ online' = [online EXCEPT ![w] = FALSE] /\ UNCHANGED <<holder, has, away>>
GoOnline(w) == ~online[w] /\ online' = [online EXCEPT ![w] = TRUE] /\ away' = [away EXCEPT ![w] = 0] /\ UNCHANGED <<holder, has>>
Tick == away' = [w \in W |-> IF online[w] THEN 0 ELSE IF away[w] < Grace THEN away[w] + 1 ELSE Grace]
        /\ (IF holder # Tomb /\ ~online[holder] /\ away[holder] >= Grace
            THEN holder' = Tomb /\ has' = [has EXCEPT ![holder] = FALSE]
            ELSE UNCHANGED <<holder, has>>)
        /\ UNCHANGED online

Next == Tick \/ \E w \in W : TakeFromTomb(w) \/ GoOffline(w) \/ GoOnline(w) \/ \E v \in W : Defeat(w, v)

\* exactly one Elder Wand: held by the holder and nobody else, or by nobody while in the tomb
ExactlyOne == /\ holder = Tomb => \A w \in W : ~has[w]
              /\ holder # Tomb => (has[holder] /\ \A w \in W \ {holder} : ~has[w])
AtMostOneCopy == Cardinality({w \in W : has[w]}) <= 1
=============================================================================
