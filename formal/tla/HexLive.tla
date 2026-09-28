------------------------------ MODULE HexLive ------------------------------
(* Hex.tla under the fairness ratio of the real constants: the window (VICTIM_HEX_PER_10MIN parcels per
   HEX_WINDOW_S) admits fewer parcels than it takes the longest jinx or silence to cover it (3 x 20 s
   < 600 s; Lean hexes_leave_gaps). With weak fairness on Tick alone — the victim does nothing, the
   senders do anything, earn Galleons again and again, and the victim may destroy every cursed item to
   make room — every hex and every silence still ends: EventuallyClean, EventuallyCanCast. Each jinx and
   silence lasts 2 ticks here, so it is the gate that makes these hold, not the clock: drop the window
   clause of SendHex and TLC finds a sender pair that keeps the victim jinxed forever. *)
EXTENDS Hex

ASSUME LeavesGaps
=============================================================================
