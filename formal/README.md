# Formal verification

Two tools, two jobs:

* **TLA+ / TLC** model-checks the *closed loops* of the world — state machines that run forever and
  must never reach a bad state.
* **Lean 4** proves the *arithmetic* those loops rely on, and prints test vectors that
  `test/formal.test.ts` compares against the TypeScript, so the proofs are about the running code.

Run everything: `TLA2TOOLS=/path/to/tla2tools.jar LEAN=/path/to/lean formal/run.sh` (CI does this on every push).

## TLA+ specs (`tla/`)

| Spec | Mirrors | Checked |
|---|---|---|
| `Hostility` | `World.canHarm`, `allies.ts` `strikes` | 15 invariants over every combination of houses, activity, safe zones, liveness, PvP, friendly-fire and a Duelling Club match (1,572,864 states): no self-harm, safe zones are safe, the stunned are untouchable, benign creatures never attack, the phoenix can't be harmed, summons never harm their owner and harm exactly what their owner may, wild creatures only hunt wizards and summons, attacking a summon counts as attacking its owner (or its owner's duel), **`DuelMutual`** (the two duellists, and their summons, may harm each other whatever their houses, outside a safe zone) and **`DuelIsolated`** (while they fight nobody else harms them and they harm nobody else); and 误伤 (`allies.ts` `strikes`): **`NoAllyStray`** (a spell meant for someone else never strikes an ally in its way), **`FriendlyFireOffUnchanged`**, **`DuellistsNotAllied`**. Beyond the model (a strict reduction, re-checked on the random worlds): an NPC's spell passes players other than its target by. Dropping the duel branch's isolation or its safe-zone clause each makes TLC fail. **Re-checked on 3,000 random real worlds in `test/formal.test.ts`**, whose wizards carry random jinx auras, silences, shields and cursed wards: every jinx effect must obey `World.jinxBites` (implied by `canHarm(sender, victim)`), bite whenever it should, never exceed its table rate and never go below the hex floor. |
| `CastTxn` | `magic.ts execute`, `(after …)` | mana never negative; a fizzle changes nothing; each transaction applies ≤ E effects; only top-level casts schedule delayed blocks (≤ A each); the pending queue is bounded. |
| `Lifecycle` | `tick`, `stun`, `revive`, `sendToAzkaban`, summons | summons exist only while their owner is active; *liveness*: nobody stays stunned or in Azkaban forever; a summon vanishes when its life runs out unless recast. |
| `ElderWand` | `placeEggs`, `transferElderWand`, `elderWandUpkeep` | exactly one Elder Wand, ever: in the tomb or in one wizard's trunk. |
| `TermDecree` | `endTerm` (`progression.ts` `electMinister`), `decree`, `applyPatch` | at most one decree charge in the world; NPCs never rule and **`MinisterIsPlayer`** (the office is a player's or vacant, whatever the NPCs' reputation); only the Minister decrees; ≤ 1 decree per term; rules stay within their constitutional bounds. The election itself is proved in Lean (`elect_never_npc`, `elect_top_player`, `elect_vacant`) and bound to the kernel by the `minister` vectors. |
| `DAVeto` | `World.decree`, `endTerm`; `unfair.ts` `vetoDecree`, `enactVeto`, the DA's sweep closing the window | (315,648 states) Dumbledore's Army's veto, with members coming and going online and a Minister allowed up to 2 decrees a term (so the budget, not the single charge, is what limits vetoes): ≤ 1 veto per term, only within the window, only with a quorum online and a strict majority *of those online* (the history is measured afresh, not through the guard's own terms), the decree state agrees with the rulebook (an enacted decree is in force, a vetoed one restored exactly what it replaced), rules stay constitutional. Each guard (window, quorum, majority, budget, restore, counting offline votes) was broken in turn and TLC found the violation. |
| `Seals` | `seals.ts` `readSealPage`, `breakSeal` | seals break in order and only for a qualified wizard holding every page; ≤ 3 attempts per window; progress is monotone. |
| `Pairing` | `mintPairCode`, `redeemPairCode(code, source)`, the 1 Hz sweep | a code binds at most once, never after its TTL, one live code per wizard, failed attempts per window ≤ the realm cap (every attempt is refused beyond it) and ≤ the per-source cap; a throttled source spends nothing, so a realm lock needs ≥ FailCap / IpCap sources; a used or dead code never comes back; *liveness*: every code is eventually used or dead. |
| `Hex` | `guardHostileGift` + `deliverHostile` / `applyJinx` / `silence`, `jinxBites`, `cleanse`, the sweep | one recipient, ready, unready and housemate senders who may earn Galleons again, PvP decrees: ≤ Cap active jinxes, ≤ 2 cursed items, ≤ 1 bound curse, ≤ WinCap parcels per window, jinx damage never below max(1, 25 % max health), movement never below 25 %, silence bounded and always followed by a casting window, newcomers/NPCs/first-years never hexed, unready senders never send, the PvP rules are respected, the sender pays exactly (the recipient nothing), a safe zone or PvP off suspends everything, per-pair cooldown and respite hold. Each clause of the gate was removed in turn and TLC found the violation. The spec has a `Lawless` flag (the recipient may walk into the deep forest, opt-in, never a safe zone; the gate then skips the pair cooldown and the window cap, and such parcels do not count toward the window); `Hex.cfg` is the lawful world (`Lawless = FALSE`, the same 3.85 M states as before) and `HexLawless` checks every one of these invariants with it on. The Hex specs don't model Duelling Club matches: during a fight `jinxBites` admits only the opponent (or the sender-less sweep), which `test/formal.test.ts` re-checks on random worlds with live matches. |
| `HexLive` | `Hex` under the ratio of the real constants | *liveness* with weak fairness on Tick alone (the senders do anything): every hex and every silence ends. Jinxes and silences last 2 ticks and the window admits fewer parcels than it takes to cover it (Lean `hexes_leave_gaps`), so the gate, not the clock, is what makes it hold: with the window clause dropped TLC finds a never-clean behaviour. (`Lawless = FALSE`: the lawful world.) |
| `HexLawless` | `Hex` with `Lawless = TRUE`, under HexLive's ratio (one ready sender, an unready one, a housemate) | (1,212,876 states) every invariant and action property of `Hex` with the lawless zone in play — newcomers/NPCs/first-years and unready senders never hex, the housemate rule, ≤ Cap jinxes, ≤ 2 cursed items, ≤ 1 bound curse, the lawful window ≤ WinCap, the HP floor, movement, the silence caps, the sender pays, safe zones / PvP off suspend, respite; the pair cooldown holds outside the zone. Letting the zone also skip the newcomer gate, the unready-sender gate or the jinx cap, count its parcels in the window, or skipping the cooldown everywhere, each makes TLC fail. Plus *liveness* with weak fairness on Tick alone: `EventuallyCanCast` unconditionally (the silence caps never lapse, even in the forest) and `EventuallyCleanOutside` (once the recipient stays out of the deep forest, every hex ends). The unconditional `EventuallyClean` fails here on purpose — a victim who stays inside can be kept jinxed — and TLC shows the behaviour. |
| `Owl` | `owl`, `answerAsk`, `expireAsks`, `makeOwlRoom`, `takeOwls` | the owlbox is bounded; an unanswered question is never evicted; an agent's owl never pushes out a player owl it has not read (it is refused instead); an unread player owl pushed out by a newer one is never lost silently (its count rides on the next unread owl until the agent reads it); a question is answered at most once and only with one of its options (or expires); ids increase; *liveness*: every question is answered or expires. |
| `Market` | `market.ts` `publishSpell` / `unpublishSpell` / `sanitizeMarket` / `payRoyalty` + `royaltyStep`, `World.decree` (`marketDecreeErrors`), `enactVeto`, `cast`'s ban check, `rollDay` | (1,451,430 states) three listings (an original, a fork of it, a fork of the fork), two players and an NPC; publish, unpublish, the Minister's decree banning / promoting / switching royalties, a veto restoring the rules from before it, casts, a new day, the end of term: a banned spell never casts successfully, promoted ⊆ published and never banned (after an unpublish, a decree or a veto), royalties ≤ the daily cap per wizard, ≤ one author share per (spell, caster) per day, never to the caster, never from an NPC, a veto restores the bans exactly, earnings only grow within a day. Removing each guard (the ban check, either sanitise, the decree's two checks, the cap, once-per-pair, the not-the-caster rules for author and parent, the NPC rule) makes TLC fail. Not modelled: NPC *authors* (the NPC stalls, `npcStock`): their ledger step runs as for anyone, but `payRoyalty` adds no reputation to an NPC author — a strict reduction of what the model allows. |
| `EventWheel` | `wheel.ts` `stepWheel` / `choose` / `startEvent` / `settle` / `finish`, the hooks that settle an event early (`wheelSlain`, `wheelBolt`, `wheelRoom`), a decree switching the wheel off and on | (335,037 states) three events (the bell may cut a deadline short) (one longer than `MaxDur` = `EVENT_MAX_S`, so the clamp is exercised), up to three instances, the clock, early wins, a second settle in the same tick: at most one event runs at a time, a running event never outlives its deadline and no event lasts longer than `MaxDur`, rewards are paid at most once, only for a decided event, and every decided event was paid; *liveness*: every event that starts ends. Breaking each guard in turn (one-at-a-time, the paid flag, the clock stopping at a deadline, the clamp, the deadline's fairness) makes TLC fail. |
| `EventWheelWitness` | `EventWheel` | non-vacuity: its invariant says "this never happens" and `run.sh` passes it only when TLC finds the behaviour — a decree switched the wheel off and on, one event was won and paid, a later one lost at its deadline and paid. (Any `*Witness` spec is checked this way.) |
| `Control` | `setInput`, `setGoal(…, by)`, `playerSteering`, `setAgentPaused`, `agentMayAct` | a paused agent never acts (only AGENT_PAUSE_ALLOWED tools run) and has no walk; WASD always ends the agent's walk; an agent never overrides nor cancels the player's click walk, and only starts a walk once the player has let go for the grace; the player's own controls are never refused; *liveness*: a player who wants the wheel gets it. |

## Lean proofs (`lean/Hogwarts.lean`)

`yearForXp` bounded and monotone · `titleIndex` monotone (titles never go down) · duel economy
conserves reputation (only the base is created, the victim never goes negative) · a committed cast
spends exactly its cost and a fizzle is free · **effects per cast ≤ E·(1+A)** (the bound the TLA+ step
properties imply) · caps clamp · healing never exceeds max health · aura stacking never exceeds a
cap · summons never exceed the cap · decrees stay constitutional · **Feistel rounds are injective
for any round function**, so every seal has exactly one answer. · **the Duelling Club pays at most DUEL_TERM_CAP × DUEL_WIN_REP reputation per wizard per term** (`duel_step_capped`, `duel_step_pay`, `duel_run_inv`, `duel_club_term_bounded`, whatever the order of wins; its `duelStep` vectors are compared with `duelGrant` in `test/formal.test.ts`). · **a Quidditch match pays each player at most QD_REP_MAX reputation and QD_CUP_MAX house points**, and never less for more goals or a higher score (`qd_rep_bounded`, `qd_rep_mono`, `qd_cup_bounded`, `qd_cup_mono`; vectors vs `qdRep` / `qdCup`).

Agent link (docs/AGENT_LINK.md §A.5, §B.8): `pair_guess_bound` (a window's checked guesses hit at most
as many of the 31⁶ codes as there are guesses, so live · hits ≤ cap · live) and `pair_lifetime_odds`
(< 10⁻⁶ to guess a code during its life) · the `derived()` floors `hp_floor`, `mana_floor`,
`manaregen_floor` (+ `manaregen_pos`: mana never drains), `speed_floor`, `move_floor` (+ `always_moves`),
`power_pos` ⇒ `damage_nonneg`, `ward_bounded` (+ `ward_scale`) · `hex_dot_floor` (and over any number
of ticks, `hex_dots_floor`), `hex_dot_never_stuns`, `hex_tick_capped` (+ `hex_tick_softens`, `hex_tick_worst_ward`) ·
`realm_lock_needs_sources` · `hexes_leave_gaps` · `hex_cost_pos`, `hex_cost_mono`, `sender_pays` ·
timing constants fit together (`cooldown_covers_binding`, `silence_duty`, `open_questions_fit`, `grace_short`).

不公平，但好玩 (README, docs/UNFAIR.md): the steal curve `stealTier`/`stealPct`/`duelSteal` — `steal_tier_mono`,
`steal_tier_dark`, `duel_steal_cap` (a stun takes ≤ 30 % of the victim, whatever the rulebook or the lawless
zone), `duel_steal_mono` (monotone in the victim's reputation), `duel_steal_dark`, `steal_newcomer` (5 %),
`steal_normal` (10 %), `steal_dark_lord` (30 %), `duel_conserves_any` / `duel_conserves_curve` (the old
`duel_conserves` generalised: any share ≤ the victim is moved, only the base is created) · the Dark Lord's
hysteresis `dark_lord_no_flap`, `dark_lord_tie_stays` · `joint_bounded`, `joint_mono`, `veto_strict_majority`,
`bonus_max` · concentration `focus_bounded`, `spend_focus_exact` · `study_before_forgotten`,
`joint_window_short`.

学院杯 (README 学院杯): the house-point ledger `cupMult` / `cupAward` / `cupDeduct` / `cupStep` / `cupRun` — `cup_term_bounded`
(whatever happens in a term, one wizard's house points stay in [0, cap]), `cup_award_capped`, `cup_award_mono`, `cup_award_gain`,
`cup_final_minute_gain` (one award adds at most n · CUP_MULT_MAX whatever the decree), `cup_mult_bounded`, `cup_mult_outside`,
`cup_deduct_nonneg` / `cup_deduct_le` / `cup_deduct_agrees` (over the integers too: never negative), `house_points_bounded`
(a house of k wizards ≤ k · cap + the 十分梗 cap), `cup_defaults_ok`; vectors: samples of each function and whole terms of
pseudo-random awards and deductions, replayed by `cupRun` in `test/formal.test.ts`.

咒语集市 (README): the royalty ledger `royaltyGrant` / `royaltyStep` / `runDay` — `royalty_day_capped` (for any day of casts, nobody earns more than the cap), `royalty_per_pair` (a (spell, caster) pair pays the author ≤ 1 point a day, however often it is cast), `royalty_parent_per_pair` (≤ 0.3 to a fork's parent), `royalty_points` (in reputation: ≤ dailyCap), `royalty_not_self`, `royalty_npc`, `royalty_once`, `market_cap_default_ok`; vectors: `royaltyGrant` samples and seven whole days of pseudo-random casts (ledger replayed by `test/formal.test.ts`). Every
shared constant is printed into the vectors and compared with `src/shared/constants.ts`.

## Scope, honestly

These verify *models* and *pure functions*. The TypeScript is not itself extracted from Lean or TLA+.
The bridge is (1) the conformance vectors and (2) the randomized re-check of the hostility invariants
against the real `World.canHarm`. Timing (continuous physics, AI steering) is not modelled.

Tool versions used: TLA+ Tools 2.0 (2026-03-02), Lean 4.33.0.
