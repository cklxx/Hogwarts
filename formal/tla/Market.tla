------------------------------- MODULE Market -------------------------------
(* 咒语集市 the spell market (src/kernel/market.ts; World.cast / decree / enactVeto / sweep).
   Listings are published and unpublished by their authors; the Minister's decree bans and promotes listings
   (rules.market.banned / promoted, validated like World.decree: promoted must be published and not banned);
   Dumbledore's Army may veto that decree (DAVeto.tla checks who may; here Veto just restores the rules the decree
   replaced, then sanitizeMarket drops from the shelf what is no longer published or is banned). Wizards cast
   copies of listings: a banned one fizzles; a successful one runs the royalty ledger step (royaltyStep, proved
   bounded in Lean): the author (not the caster) and a fork's parent author (neither the caster nor the author) are
   paid once per (spell, caster) per day, each within the daily cap. Days turn over, terms end. The history
   variables (castOkBanned, selfPaid, npcPaid) are measured afresh from the state, not through the guards. *)
EXTENDS Naturals, FiniteSets

CONSTANTS A, B, N, S1, S2, S3, None, AShare, PShare, Cap, MaxDay, MaxTerm

\* Three listings: S1 by A; S2 by B, a fork of S1 (parent author A); S3 by A, a fork of S2 (parent author B).
\* N is an NPC. Anyone casts a copy of any listing (its author their own original).
Spells == {S1, S2, S3}
Wizards == {A, B, N}
NPCs == {N}
NoParent == None
Author == [s \in Spells |-> CASE s = S1 -> A [] s = S2 -> B [] s = S3 -> A]
Parent == [s \in Spells |-> CASE s = S1 -> None [] s = S2 -> A [] s = S3 -> B]

VARIABLES published, banned, promoted, before, dstate, charges, term, day,
          paid, given, earned, castOkBanned, selfPaid, npcPaid, royaltiesOn
vars == <<published, banned, promoted, before, dstate, charges, term, day, paid, given, earned, castOkBanned, selfPaid, npcPaid, royaltiesOn>>

Min(a, b) == IF a < b THEN a ELSE b
Grant(e, s) == Min(s, IF Cap >= e THEN Cap - e ELSE 0)       \* royaltyGrant
Sanitize(p, pub, b) == {s \in p : s \in pub /\ s \notin b}    \* sanitizeMarket
ParentOf(s, c) == IF Parent[s] # NoParent /\ Parent[s] # c /\ Parent[s] # Author[s] THEN Parent[s] ELSE NoParent

Init == /\ published = {} /\ banned = {} /\ promoted = {} /\ before = <<{}, {}, TRUE>> /\ dstate = "none"
        /\ charges \in 0..1 /\ term = 1 /\ day = 1
        /\ paid = {} /\ given = [p \in Spells \X Wizards |-> 0] /\ earned = [w \in Wizards |-> 0]
        /\ castOkBanned = FALSE /\ selfPaid = FALSE /\ npcPaid = FALSE /\ royaltiesOn \in BOOLEAN

\* publishSpell / unpublishSpell (an unpublished listing leaves the shelf at once)
Publish(s)   == /\ s \notin published /\ published' = published \cup {s}
                /\ UNCHANGED <<banned, promoted, before, dstate, charges, term, day, paid, given, earned, castOkBanned, selfPaid, npcPaid, royaltiesOn>>
Unpublish(s) == /\ s \in published /\ published' = published \ {s} /\ promoted' = Sanitize(promoted, published', banned)
                /\ UNCHANGED <<banned, before, dstate, charges, term, day, paid, given, earned, castOkBanned, selfPaid, npcPaid, royaltiesOn>>

\* World.decree with a market patch: marketDecreeErrors refuses an unpublished or banned promotion (nothing changes then)
Decree(Bn, Pr, Ro) ==
  /\ charges > 0
  /\ Pr \subseteq published /\ Pr \cap Bn = {}
  /\ banned' = Bn /\ promoted' = Pr /\ royaltiesOn' = Ro
  /\ before' = <<banned, promoted, royaltiesOn>> /\ dstate' = "enacted" /\ charges' = charges - 1
  /\ UNCHANGED <<published, term, day, paid, given, earned, castOkBanned, selfPaid, npcPaid>>

\* enactVeto: the rulebook from before the decree, re-sanitised against what is published now
Veto == /\ dstate = "enacted"
        /\ banned' = before[1] /\ royaltiesOn' = before[3]
        /\ promoted' = Sanitize(before[2], published, before[1])
        /\ dstate' = "vetoed"
        /\ UNCHANGED <<published, before, charges, term, day, paid, given, earned, castOkBanned, selfPaid, npcPaid>>

\* World.cast of a copy of s by c: a banned spell fizzles (nothing else changes); a success runs royaltyStep
Cast(s, c) ==
  IF s \in banned
  THEN UNCHANGED vars
  ELSE
    LET a == Author[s]
        p == ParentOf(s, c)
        toA == c # a
        skip == ~royaltiesOn \/ c \in NPCs \/ (~toA /\ p = NoParent) \/ <<s, c>> \in paid
        g1 == IF toA THEN Grant(earned[a], AShare) ELSE 0
        e1 == [earned EXCEPT ![a] = @ + g1]
        g2 == IF p # NoParent THEN Grant(e1[p], PShare) ELSE 0
        e2 == IF p # NoParent THEN [e1 EXCEPT ![p] = @ + g2] ELSE e1
    IN /\ castOkBanned' = (castOkBanned \/ s \in banned)
       /\ IF skip THEN UNCHANGED <<paid, given, earned, selfPaid, npcPaid>>
          ELSE /\ paid' = paid \cup {<<s, c>>}
               /\ given' = [given EXCEPT ![<<s, c>>] = @ + g1]
               /\ earned' = e2
               /\ selfPaid' = (selfPaid \/ e2[c] # earned[c])
               /\ npcPaid' = (npcPaid \/ (c \in NPCs /\ e2 # earned))
       /\ UNCHANGED <<published, banned, promoted, before, dstate, charges, term, day, royaltiesOn>>

\* rollDay: a new day's ledger
NewDay == /\ day < MaxDay /\ day' = day + 1
          /\ paid' = {} /\ given' = [p \in Spells \X Wizards |-> 0] /\ earned' = [w \in Wizards |-> 0]
          /\ UNCHANGED <<published, banned, promoted, before, dstate, charges, term, castOkBanned, selfPaid, npcPaid, royaltiesOn>>

\* endTerm: the decree can no longer be vetoed; a new Minister may get a charge
EndTerm == /\ term < MaxTerm /\ term' = term + 1 /\ charges' \in 0..1 /\ dstate' = "none"
           /\ UNCHANGED <<published, banned, promoted, before, day, paid, given, earned, castOkBanned, selfPaid, npcPaid, royaltiesOn>>

Next == \/ \E s \in Spells : Publish(s) \/ Unpublish(s)
        \/ \E Bn \in SUBSET Spells, Pr \in SUBSET Spells, Ro \in BOOLEAN : Decree(Bn, Pr, Ro)
        \/ Veto
        \/ \E s \in Spells, c \in Wizards : Cast(s, c)
        \/ NewDay \/ EndTerm
Spec == Init /\ [][Next]_vars

TypeOK == /\ published \subseteq Spells /\ banned \subseteq Spells /\ promoted \subseteq Spells
          /\ paid \subseteq Spells \X Wizards /\ dstate \in {"none", "enacted", "vetoed"}
          /\ \A w \in Wizards : earned[w] \in 0..Cap
\* ---- invariants
BannedNeverCast     == ~castOkBanned                       \* a banned spell never casts successfully (no royalty either)
PromotedPublished   == promoted \subseteq published         \* the 推荐 shelf only shows published listings
PromotedNotBanned   == promoted \cap banned = {}
RoyaltyCapped       == \A w \in Wizards : earned[w] <= Cap  \* Lean royalty_day_capped
RoyaltyPerPair      == \A s \in Spells, c \in Wizards : given[<<s, c>>] <= AShare   \* Lean royalty_per_pair
UnpaidPairsGaveNothing == \A s \in Spells, c \in Wizards : <<s, c>> \notin paid => given[<<s, c>>] = 0
NoSelfRoyalty       == ~selfPaid
NoNpcRoyalty        == ~npcPaid
VetoRestoresBan     == dstate = "vetoed" => banned = before[1]
\* ---- action properties
\* a veto lifts exactly the bans the decree added (and restores the old ones)
VetoLiftsBans == [][dstate' = "vetoed" /\ dstate = "enacted" => banned' = before[1]]_vars
\* earnings only grow within a day, and only by royalties
EarnedMonotone == [][day' = day => \A w \in Wizards : earned'[w] >= earned[w]]_vars
=============================================================================
