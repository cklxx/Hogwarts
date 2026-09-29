---------------------------- MODULE HexLawless ----------------------------
(* Hex.tla with the lawless zone (无规则区, the deep Forbidden Forest), under the fairness ratio of the real
   constants (as HexLive). The recipient may walk in and out of the zone at will (opt-in); inside it the gate
   waives the per-pair cooldown and the window cap. Checked: every safety invariant and action property of
   Hex (newcomers, NPCs, first-years and unready senders stay immune; the HP floor and silence caps hold),
   EventuallyCanCast unconditionally (the silence caps never lapse, even in the forest), and
   EventuallyCleanOutside: once the recipient stays out of the forest, every hex ends. The unconditional
   EventuallyClean does NOT hold here, on purpose: swap it in and TLC finds a sender that keeps a victim who
   stays in the forest jinxed forever (that is what "lawless" means). One ready sender keeps the state space
   small; HexLive keeps the two-sender pair for the lawful liveness. *)
EXTENDS Hex

ASSUME LeavesGaps /\ Lawless
=============================================================================
