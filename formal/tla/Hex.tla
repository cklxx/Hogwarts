-------------------------------- MODULE Hex --------------------------------
(* Hostile parcels (docs/AGENT_LINK.md §B): one recipient and a handful of senders. SendHex is
   src/kernel/world.ts guardHostileGift clause by clause, followed by deliverHostile/applyJinx/silence;
   Tick is the world tick (aura timers, the jinx damage over time, the 1 Hz sweep that unbinds cursed items
   and ages the 10-minute window); Cleanse is Finite Incantatem cast on yourself; Earn is a sender earning
   Galleons again (so money is never what ends the harassment: only the gate is); Decree flips PvP.
   Every jinx effect asks World.jinxBites: the recipient in play and outside a safe zone, and the PvP rules
   letting the sender harm them (a housemate without friendly fire never can: the gate refuses them).
   Durations and caps are scaled down. Hex.cfg checks the safety properties with a window generous
   enough (WinCap > Cap) that every cap of the gate binds; HexLive.tla adds the liveness properties under
   the ratio the real constants keep (Lean hexes_leave_gaps): the window admits fewer parcels than it
   takes jinxes to cover it, WinCap * the longest effect < WinLen.
   The lawless zone (无规则区, the deep Forbidden Forest): `lawless` = the recipient stands in it (they walked in,
   and may walk out: ToggleLawless; it is never a safe zone). There SendHex skips exactly two clauses, the
   per-pair cooldown and the 10-minute window cap, and such a parcel does not count toward the window. Every
   other clause, the HP floor and the silence caps still hold, and every invariant below is checked with it:
   newcomers, NPCs, first-years and unready senders stay immune (FreshAndNpcImmune). *)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS Senders, Unready, Housemates, Cap, MaxCursed, BoundCap, WinCap, WinLen, Cool, Respite, BindT,
          Dur, BatsDur, SilMax, SilCool, MaxHp, Dmg, Gold0, Cost,
          Lawless   \* TRUE: the model has the lawless zone (the recipient may walk in and out of it)

Auras  == {"jelly", "boils", "bats"}     \* jinx auras (Tarantallegra, like Jelly-Legs, only acts on movement)
Jinxes == Auras \cup {"lang", "none"}    \* what a parcel's lore carries; "none" = only negative enchantments
Chills == {0, 30, 40, 60}                \* chill the rest of the world may add (an ice bolt 30, an Inferius 40)
None   == "none"
Max(a, b) == IF a > b THEN a ELSE b
Min(a, b) == IF a < b THEN a ELSE b
Floor == Max(1, (MaxHp * 25) \div 100)   \* progression.ts hexHpFloor

\* the fairness ratio: the window cannot hold enough parcels to keep someone jinxed without a gap (HexLive)
LeavesGaps == WinCap * Max(Max(Dur, BatsDur), SilMax) < WinLen
ASSUME Unready \subseteq Senders /\ Housemates \subseteq Senders /\ Cost >= 1

VARIABLES hex, sil, silBy, silCd, cursed, boundN, boundT, window, cool, resp, safe, online, pvp, hp, gold,
          ever, last, protected, quiet, lawless
vars == <<hex, sil, silBy, silCd, cursed, boundN, boundT, window, cool, resp, safe, online, pvp, hp, gold,
          ever, last, protected, quiet, lawless>>
\* history: ever[s] = s has delivered a parcel; last = the sender whose parcel this step delivered (else None);
\* quiet = ticks since the recipient was last silenced, capped at SilCool

Init ==
  /\ hex = [k \in Auras |-> 0] /\ sil = 0 /\ silBy = None /\ silCd = 0
  /\ cursed = 0 /\ boundN = 0 /\ boundT = 0 /\ window = << >>
  /\ cool = [s \in Senders |-> 0] /\ resp = 0
  /\ safe \in BOOLEAN /\ online \in BOOLEAN /\ pvp \in BOOLEAN /\ hp = MaxHp
  /\ lawless \in (IF Lawless THEN BOOLEAN ELSE {FALSE}) /\ ~(safe /\ lawless)   \* the deep forest is no safe zone
  /\ gold = [s \in Senders |-> Gold0] /\ ever = [s \in Senders |-> FALSE] /\ last = None
  /\ protected \in BOOLEAN   \* the recipient is an NPC, a first-year or a newcomer
  /\ quiet = SilCool

\* World.activeHexes: live jinx auras, plus a Langlock silence (a Bat-Bogey's silence is part of that hex)
HexCount == Cardinality({k \in Auras : hex[k] > 0}) + (IF sil > 0 /\ silBy = "lang" THEN 1 ELSE 0)
RulesAllow(s) == pvp /\ s \notin Housemates                     \* World.rulesLetHarm
Bites    == online /\ ~safe /\ pvp        \* World.jinxBites for a parcel's jinx (its sender is never a housemate)
Silenced == sil > 0 /\ ~safe /\ pvp                              \* World.silenced
JellyNow == IF hex["jelly"] > 0 /\ Bites THEN 40 ELSE 0           \* moveWizard
MoveFactor(chill) == Max(25, 100 - chill - JellyNow)             \* progression.ts moveSlow, percent
Dotting == (hex["boils"] > 0 \/ hex["bats"] > 0) /\ Bites
HexDot(h) == Max(Min(h, Floor), h - Dmg)                          \* progression.ts hexDotHp (hexTickDmg caps Dmg)

\* World.silence: dropped during the cooldown after the last one
Silence(by) == IF silCd = 0 THEN sil' = SilMax /\ silBy' = by /\ silCd' = SilMax + SilCool
               ELSE UNCHANGED <<sil, silBy, silCd>>

\* forgeItem: j = the jinx in the lore, neg = negative enchantments, empty = the item's slot is free
SendHex(s, j, neg, empty) ==
  /\ j # "none" \/ neg                       \* hostile (and addressed to someone else)
  \* guardHostileGift, in order
  /\ s \notin Unready                        \* sender: not an NPC, year >= HEX_MIN_YEAR, enrolled >= FRESH_SECONDS
  /\ lawless \/ cool[s] = 0                  \* HEX_PAIR_COOLDOWN_S (not owed in the lawless zone)
  /\ gold[s] >= Cost                         \* can pay price + HEX_MALICE_TAX
  /\ ~protected                              \* recipient: not an NPC, year >= 2, not a newcomer
  /\ online /\ ~safe /\ resp = 0             \* in play, not in a safe zone, not in respite
  /\ RulesAllow(s)                           \* the PvP rules let the sender harm the recipient
  /\ HexCount < Cap                          \* VICTIM_HEX_CAP
  /\ cursed < MaxCursed                      \* VICTIM_CURSED_ITEMS_MAX
  /\ (neg => boundN < BoundCap)              \* VICTIM_BOUND_CAP (negative items only)
  /\ lawless \/ Len(window) < WinCap         \* VICTIM_HEX_PER_10MIN (not owed in the lawless zone)
  \* deliverHostile
  /\ gold' = [gold EXCEPT ![s] = gold[s] - Cost]
  /\ ever' = [ever EXCEPT ![s] = TRUE]
  /\ last' = s
  /\ cool' = [cool EXCEPT ![s] = Cool]
  /\ window' = IF lawless THEN window ELSE Append(window, 0)   \* the window counts lawful parcels
  /\ cursed' = cursed + 1
  /\ IF neg /\ empty THEN boundN' = boundN + 1 /\ boundT' = BindT ELSE UNCHANGED <<boundN, boundT>>
  /\ hex' = CASE j \in {"jelly", "boils"} -> [hex EXCEPT ![j] = Max(hex[j], Dur)]
              [] j = "bats"                -> [hex EXCEPT !["bats"] = Max(hex["bats"], BatsDur)]
              [] OTHER                     -> hex
  /\ IF j \in {"bats", "lang"} THEN Silence(j) ELSE UNCHANGED <<sil, silBy, silCd>>
  /\ UNCHANGED <<resp, safe, online, pvp, hp, protected, quiet, lawless>>

\* one tick: timers run down, the jinx damage ticks (only while it bites), otherwise health regenerates
Tick ==
  /\ hex' = [k \in Auras |-> Max(hex[k] - 1, 0)]
  /\ sil' = Max(sil - 1, 0)
  /\ silBy' = IF sil <= 1 THEN None ELSE silBy
  /\ silCd' = Max(silCd - 1, 0)
  /\ boundT' = Max(boundT - 1, 0)
  /\ boundN' = IF boundT <= 1 THEN 0 ELSE boundN        \* the sweep unbinds (the item stays in the trunk)
  /\ cool' = [s \in Senders |-> Max(cool[s] - 1, 0)]
  /\ resp' = Max(resp - 1, 0)
  /\ window' = SelectSeq([i \in 1..Len(window) |-> window[i] + 1], LAMBDA a : a < WinLen)
  /\ hp' = IF Dotting THEN HexDot(hp) ELSE Min(MaxHp, hp + 1)
  /\ quiet' = IF sil > 0 THEN 0 ELSE Min(SilCool, quiet + 1)
  /\ last' = None
  /\ UNCHANGED <<cursed, safe, online, pvp, gold, ever, protected, lawless>>

\* Finite Incantatem on yourself (you must be able to cast): every jinx and the silence end, bindings break, respite
Cleanse ==
  /\ online /\ ~Silenced
  /\ hex' = [k \in Auras |-> 0] /\ sil' = 0 /\ silBy' = None
  /\ boundN' = 0 /\ boundT' = 0
  /\ resp' = Respite
  /\ last' = None
  /\ UNCHANGED <<silCd, cursed, window, cool, safe, online, pvp, hp, gold, ever, protected, quiet, lawless>>

Others == <<hex, sil, silBy, silCd, boundN, boundT, window, cool, resp, hp, ever, protected, quiet>>
\* destroy_item: any cursed item that is not bound
Destroy == cursed > boundN /\ cursed' = cursed - 1 /\ last' = None /\ UNCHANGED <<Others, safe, online, pvp, gold, lawless>>
ToggleSafe   == ~lawless /\ safe' = ~safe /\ last' = None /\ UNCHANGED <<Others, cursed, online, pvp, gold, lawless>>
ToggleOnline == online' = ~online /\ last' = None /\ UNCHANGED <<Others, cursed, safe, pvp, gold, lawless>>
Decree       == pvp' = ~pvp       /\ last' = None /\ UNCHANGED <<Others, cursed, safe, online, gold, lawless>>
\* the recipient walks into (or out of) the deep forest: opt-in
ToggleLawless == Lawless /\ ~safe /\ lawless' = ~lawless /\ last' = None /\ UNCHANGED <<Others, cursed, safe, online, pvp, gold>>
\* a sender earns Galleons (creatures, quests): the gate, not poverty, has to stop them
Earn(s) == gold[s] < Gold0 /\ gold' = [gold EXCEPT ![s] = gold[s] + 1] /\ last' = None
           /\ UNCHANGED <<Others, cursed, safe, online, pvp, lawless>>

Next == \/ Tick \/ Cleanse \/ Destroy \/ ToggleSafe \/ ToggleOnline \/ Decree \/ ToggleLawless
        \/ \E s \in Senders : Earn(s)
        \/ \E s \in Senders, j \in Jinxes, neg \in BOOLEAN, empty \in BOOLEAN : SendHex(s, j, neg, empty)
Spec == Init /\ [][Next]_vars /\ WF_vars(Tick)

TypeOK == /\ hex \in [Auras -> 0..Max(Dur, BatsDur)] /\ sil \in 0..SilMax /\ silCd \in 0..(SilMax + SilCool)
          /\ cursed \in 0..MaxCursed /\ boundT \in 0..BindT /\ hp \in 0..MaxHp /\ pvp \in BOOLEAN
          /\ gold \in [Senders -> 0..Gold0] /\ resp \in 0..Respite /\ ever \in [Senders -> BOOLEAN] /\ last \in Senders \cup {None}
          /\ lawless \in BOOLEAN /\ ~(safe /\ lawless)
\* ---- invariants
HexCountBounded       == HexCount <= Cap
CursedItemsBounded    == cursed <= MaxCursed
BoundBounded          == boundN <= BoundCap
WindowBounded         == Len(window) <= WinCap
HpFloorUnderDot       == hp >= Floor                               \* a jinx never knocks anyone out
MovableAlways         == \A c \in Chills : MoveFactor(c) >= 25       \* whatever else slows you
SilenceNeverPermanent == sil <= SilMax /\ (sil > 0 => silCd >= sil + SilCool)   \* a casting window always follows
FreshAndNpcImmune     == /\ protected => \A s \in Senders : ~ever[s]
                         /\ \A s \in Unready : ~ever[s]
RulesRespected        == \A s \in Housemates : ~ever[s]            \* the PvP rules forbid it: never hexed by them
\* ---- action properties
\* the sender pays exactly the price on delivery (the recipient nothing); otherwise gold only grows by earning
SenderPays        == [][\A s \in Senders : /\ last' = s => gold'[s] = gold[s] - Cost
                                           /\ gold'[s] < gold[s] => last' = s]_vars
SafeSuspends      == [][safe => (hp' >= hp /\ last' = None)]_vars
RulesSuspend      == [][~pvp => (hp' >= hp /\ last' = None /\ JellyNow = 0 /\ ~Silenced)]_vars
PairCooldownHolds == [][\A s \in Senders : last' = s => (cool[s] = 0 \/ lawless)]_vars   \* owed outside the lawless zone
RespiteHolds      == [][resp > 0 => last' = None]_vars
\* a new silence only ever starts after SilCool silence-free ticks: there is always a window to cast in
CastingWindow     == [][(sil = 0 /\ sil' > 0) => quiet >= SilCool]_vars
\* ---- liveness (weak fairness on Tick only: the victim need not do anything, the senders may do anything)
EventuallyClean   == (HexCount > 0 \/ sil > 0) ~> (HexCount = 0 /\ sil = 0)
EventuallyCanCast == (sil > 0) ~> (sil = 0)                                   \* even in the lawless zone
\* once the recipient stays out of the lawless zone, every hex ends (inside it, by choice, it need not)
EventuallyCleanOutside == <>[]~lawless => ((HexCount > 0 \/ sil > 0) ~> (HexCount = 0 /\ sil = 0))
=============================================================================
