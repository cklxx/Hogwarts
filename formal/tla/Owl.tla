-------------------------------- MODULE Owl --------------------------------
(* The private owlbox between a player and their agent: src/kernel/world.ts owl / answerAsk / expireAsks /
   makeOwlRoom / takeOwls (docs/AGENT_LINK.md §C.2). The box holds at most Max messages. To make room it
   drops the oldest message that is neither a question still waiting for its answer nor a player's owl the
   agent has not read yet (id above the watermark `read`). Only a newer owl from the player may push out an
   unread player owl, and never silently: its count moves to the next unread player owl (`lost`, which the
   agent sees when it listens), or onto the incoming owl itself. An agent's owl that finds no such room is
   refused (OWLBOX_UNREAD: listen first), as is any owl when only open questions are left. A question is
   answered once, with one of its options, before it is TTL ticks old; the tick marks it expired after
   that. An answer is itself appended as a new owl from the player. *)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS Max, MaxSeq, TTL, Options

VARIABLES box, seq, read, answers, evictedOpen, agentEvictedUnread, dropped, told
vars == <<box, seq, read, answers, evictedOpen, agentEvictedUnread, dropped, told>>
\* box: a sequence of [id, from, ask, answered, answer, age, lost]; seq: the last id (owlSeq), bounded for
\* TLC; read: the agent's watermark (agentReadUpTo). History: answers = how often each question was
\* answered; evictedOpen = an open question was dropped; agentEvictedUnread = an agent's owl pushed out an
\* unread player owl; dropped = unread player owls evicted; told = lost counts the agent has been handed

Ids == 0..MaxSeq
Answers == Options \cup {"none", "expired"}
Msg(id, from, isAsk, lost) == [id |-> id, from |-> from, ask |-> isAsk, answered |-> FALSE, answer |-> "none", age |-> 0, lost |-> lost]
Open(m) == m.ask /\ ~m.answered
Unread(m) == m.from = "player" /\ m.id > read
Idx(b) == 1..Len(b)
Plain(b) == {i \in Idx(b) : ~Open(b[i]) /\ ~Unread(b[i])}   \* evicted first
UnreadIdx(b) == {i \in Idx(b) : Unread(b[i])}
Oldest(S) == CHOOSE i \in S : \A j \in S : i <= j
Remove(b, i) == SubSeq(b, 1, i - 1) \o SubSeq(b, i + 1, Len(b))
RECURSIVE SumSeq(_)
SumSeq(s) == IF s = << >> THEN 0 ELSE Head(s) + SumSeq(Tail(s))
PendingLost(b) == SumSeq([i \in Idx(b) |-> IF Unread(b[i]) THEN b[i].lost ELSE 0])

\* makeOwlRoom(incoming)
CanMakeRoom(b, from) == Len(b) < Max \/ Plain(b) # {} \/ (from = "player" /\ UnreadIdx(b) # {})
Full(b) == Len(b) >= Max
GoesUnread(b) == Full(b) /\ Plain(b) = {}                   \* the one evicted is an unread player owl
Victim(b) == IF Plain(b) # {} THEN Oldest(Plain(b)) ELSE Oldest(UnreadIdx(b))
\* the box after making room, and the `lost` count the incoming owl carries
Room(b) ==
  IF ~Full(b) THEN [box |-> b, carry |-> 0]
  ELSE LET r == Remove(b, Victim(b))
           n == IF GoesUnread(b) THEN b[Victim(b)].lost + 1 ELSE 0
       IN IF n > 0 /\ UnreadIdx(r) # {}
          THEN [box |-> [r EXCEPT ![Oldest(UnreadIdx(r))].lost = r[Oldest(UnreadIdx(r))].lost + n], carry |-> 0]
          ELSE [box |-> r, carry |-> n]
\* history: some question still open in `before` is gone from `after`
Lost(before, after) == \E i \in Idx(before) : Open(before[i]) /\ ~\E j \in Idx(after) : after[j].id = before[i].id
\* what the player may send back: an option, or anything else (which answerAsk refuses)
Choices == Options \cup {"something else"}

Init == /\ box = << >> /\ seq = 0 /\ read = 0 /\ answers = [n \in Ids |-> 0]
        /\ evictedOpen = FALSE /\ agentEvictedUnread = FALSE /\ dropped = 0 /\ told = 0

\* owl(from, text) — a question when isAsk (only an agent asks, with options)
Send(from, isAsk) ==
  /\ seq < MaxSeq
  /\ from = "player" => ~isAsk
  /\ CanMakeRoom(box, from)                  \* else: OWLBOX_UNREAD / "full of questions still waiting"
  /\ LET r == Room(box) IN
       /\ box' = Append(r.box, Msg(seq + 1, from, isAsk, r.carry))
       /\ evictedOpen' = (evictedOpen \/ Lost(box, box'))
       /\ agentEvictedUnread' = (agentEvictedUnread \/ (from = "agent" /\ GoesUnread(box)))
       /\ dropped' = dropped + (IF GoesUnread(box) THEN 1 ELSE 0)
  /\ seq' = seq + 1
  /\ UNCHANGED <<read, answers, told>>

\* answerAsk(id, choice): an open question, younger than TTL, and one of its options; the answer is a player owl
Answer(i, o) ==
  /\ i \in Idx(box) /\ Open(box[i]) /\ box[i].age < TTL /\ o \in Options
  /\ seq < MaxSeq
  /\ LET marked == [box EXCEPT ![i].answered = TRUE, ![i].answer = o]
         r == Room(marked)
     IN /\ CanMakeRoom(marked, "player")
        /\ box' = Append(r.box, Msg(seq + 1, "player", FALSE, r.carry))
        /\ evictedOpen' = (evictedOpen \/ Lost(marked, box'))
        /\ dropped' = dropped + (IF GoesUnread(marked) THEN 1 ELSE 0)
  /\ answers' = [answers EXCEPT ![box[i].id] = answers[box[i].id] + 1]
  /\ seq' = seq + 1
  /\ UNCHANGED <<read, agentEvictedUnread, told>>

\* MCP listen (takeOwls): the agent reads every player owl so far, and each `lost` count with it
Listen ==
  /\ read < seq
  /\ read' = seq
  /\ told' = told + PendingLost(box)
  /\ UNCHANGED <<box, seq, answers, evictedOpen, agentEvictedUnread, dropped>>

\* time passes: questions age; one that reaches TTL is marked expired (expireAsks)
Tick ==
  /\ box' = [i \in Idx(box) |->
               IF Open(box[i]) THEN
                 IF box[i].age + 1 >= TTL THEN [box[i] EXCEPT !.age = TTL, !.answered = TRUE, !.answer = "expired"]
                 ELSE [box[i] EXCEPT !.age = box[i].age + 1]
               ELSE box[i]]
  /\ UNCHANGED <<seq, read, answers, evictedOpen, agentEvictedUnread, dropped, told>>

Next == \/ Tick \/ Listen
        \/ \E from \in {"player", "agent"}, isAsk \in BOOLEAN : Send(from, isAsk)
        \/ \E i \in 1..Max, o \in Choices : Answer(i, o)
Spec == Init /\ [][Next]_vars /\ WF_vars(Tick)

TypeOK == /\ Len(box) <= Max /\ seq \in 0..MaxSeq /\ read \in 0..MaxSeq
          /\ \A i \in Idx(box) : /\ box[i].id \in Ids /\ box[i].answer \in Answers \cup Choices /\ box[i].age \in 0..TTL
                                 /\ box[i].from \in {"player", "agent"} /\ box[i].lost \in 0..MaxSeq
\* ---- invariants
BoxBounded                == Len(box) <= Max
UnansweredAskNeverEvicted == ~evictedOpen
AnsweredAtMostOnce        == \A n \in Ids : answers[n] <= 1
AnswerIsAnOption          == \A i \in Idx(box) : (box[i].ask /\ box[i].answered) => box[i].answer \in Options \cup {"expired"}
IdsIncrease               == \A i, j \in Idx(box) : i < j => box[i].id < box[j].id
\* a chatty agent never pushes out an owl its player wrote and it has not read
AgentNeverEvictsUnread    == ~agentEvictedUnread
\* every unread player owl that was dropped is still counted on an unread owl, or the agent was told
UnreadNeverSilentlyLost   == dropped = told + PendingLost(box)
\* only the player's own owls carry `lost`
LostOnlyOnPlayerOwls      == \A i \in Idx(box) : box[i].lost > 0 => box[i].from = "player"
\* ---- liveness: every question is eventually answered or expired
IsOpen(n) == \E i \in Idx(box) : box[i].id = n /\ Open(box[i])
AskEventuallySettles == \A n \in Ids : IsOpen(n) ~> ~IsOpen(n)
=============================================================================
