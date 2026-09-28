-------------------------------- MODULE Owl --------------------------------
(* The private owlbox between a player and their agent: src/kernel/world.ts owl / answerAsk / expireAsks /
   makeOwlRoom (docs/AGENT_LINK.md §C.2). The box holds at most Max messages; to make room it drops the
   oldest message that is not a question still waiting for its answer, and refuses a new owl if there is
   none. A question is answered once, with one of its options, before it is TTL ticks old; the tick marks
   it expired after that. An answer is itself appended as a new owl from the player. *)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS Max, MaxSeq, TTL, Options

VARIABLES box, seq, answers, evictedOpen
vars == <<box, seq, answers, evictedOpen>>
\* box: a sequence of [id, ask, answered, answer, age]; seq: the last id (owlSeq), bounded for TLC;
\* answers (history): how often each question was answered; evictedOpen (history): an open question was dropped

Ids == 1..MaxSeq
Answers == Options \cup {"none", "expired"}
Msg(id, isAsk) == [id |-> id, ask |-> isAsk, answered |-> FALSE, answer |-> "none", age |-> 0]
Open(m) == m.ask /\ ~m.answered
Evictable(b) == {i \in 1..Len(b) : ~Open(b[i])}
Oldest(S) == CHOOSE i \in S : \A j \in S : i <= j
Remove(b, i) == SubSeq(b, 1, i - 1) \o SubSeq(b, i + 1, Len(b))
\* makeOwlRoom
CanMakeRoom(b) == Len(b) < Max \/ Evictable(b) # {}
MakeRoom(b) == IF Len(b) < Max THEN b ELSE Remove(b, Oldest(Evictable(b)))
\* history: some question still open in `before` is gone from `after`
Lost(before, after) == \E i \in 1..Len(before) : Open(before[i]) /\ ~\E j \in 1..Len(after) : after[j].id = before[i].id
\* what the player may send back: an option, or anything else (which answerAsk refuses)
Choices == Options \cup {"something else"}

Init == box = << >> /\ seq = 0 /\ answers = [n \in Ids |-> 0] /\ evictedOpen = FALSE

\* owl(from, text) — a question when isAsk (only an agent asks, with options)
Send(isAsk) ==
  /\ seq < MaxSeq
  /\ CanMakeRoom(box)                             \* else: "full of questions still waiting for an answer"
  /\ box' = Append(MakeRoom(box), Msg(seq + 1, isAsk))
  /\ evictedOpen' = (evictedOpen \/ Lost(box, box'))
  /\ seq' = seq + 1
  /\ UNCHANGED answers

\* answerAsk(id, choice): an open question, younger than TTL, and one of its options
Answer(i, o) ==
  /\ i \in 1..Len(box) /\ Open(box[i]) /\ box[i].age < TTL /\ o \in Options
  /\ seq < MaxSeq
  /\ LET marked == [box EXCEPT ![i].answered = TRUE, ![i].answer = o]
     IN /\ box' = Append(MakeRoom(marked), Msg(seq + 1, FALSE))
        /\ evictedOpen' = (evictedOpen \/ Lost(marked, box'))
  /\ answers' = [answers EXCEPT ![box[i].id] = answers[box[i].id] + 1]
  /\ seq' = seq + 1

\* time passes: questions age; one that reaches TTL is marked expired (expireAsks)
Tick ==
  /\ box' = [i \in 1..Len(box) |->
               IF Open(box[i]) THEN
                 IF box[i].age + 1 >= TTL THEN [box[i] EXCEPT !.age = TTL, !.answered = TRUE, !.answer = "expired"]
                 ELSE [box[i] EXCEPT !.age = box[i].age + 1]
               ELSE box[i]]
  /\ UNCHANGED <<seq, answers, evictedOpen>>

Next == Tick \/ Send(TRUE) \/ Send(FALSE) \/ \E i \in 1..Max, o \in Choices : Answer(i, o)
Spec == Init /\ [][Next]_vars /\ WF_vars(Tick)

TypeOK == /\ Len(box) <= Max /\ seq \in 0..MaxSeq
          /\ \A i \in 1..Len(box) : box[i].id \in Ids /\ box[i].answer \in Answers \cup Choices /\ box[i].age \in 0..TTL
\* ---- invariants
BoxBounded                == Len(box) <= Max
UnansweredAskNeverEvicted == ~evictedOpen
AnsweredAtMostOnce        == \A n \in Ids : answers[n] <= 1
AnswerIsAnOption          == \A i \in 1..Len(box) : (box[i].ask /\ box[i].answered) => box[i].answer \in Options \cup {"expired"}
IdsIncrease               == \A i, j \in 1..Len(box) : i < j => box[i].id < box[j].id
\* ---- liveness: every question is eventually answered or expired
IsOpen(n) == \E i \in 1..Len(box) : box[i].id = n /\ Open(box[i])
AskEventuallySettles == \A n \in Ids : IsOpen(n) ~> ~IsOpen(n)
=============================================================================
