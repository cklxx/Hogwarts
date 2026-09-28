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
| `Hostility` | `World.canHarm` | 10 invariants over every combination of houses, activity, safe zones, liveness, PvP and friendly-fire (1,048,576 states): no self-harm, safe zones are safe, the stunned are untouchable, benign creatures never attack, the phoenix can't be harmed, summons never harm their owner and harm exactly what their owner may, wild creatures only hunt wizards and summons, attacking a summon counts as attacking its owner. **Re-checked on 3,000 random real worlds in `test/formal.test.ts`**, whose wizards carry random jinx auras, silences, shields and cursed wards: every jinx effect must obey `World.jinxBites` (implied by `canHarm(sender, victim)`), bite whenever it should, never exceed its table rate and never go below the hex floor. |
| `CastTxn` | `magic.ts execute`, `(after …)` | mana never negative; a fizzle changes nothing; each transaction applies ≤ E effects; only top-level casts schedule delayed blocks (≤ A each); the pending queue is bounded. |
| `Lifecycle` | `tick`, `stun`, `revive`, `sendToAzkaban`, summons | summons exist only while their owner is active; *liveness*: nobody stays stunned or in Azkaban forever; a summon vanishes when its life runs out unless recast. |
| `ElderWand` | `placeEggs`, `transferElderWand`, `elderWandUpkeep` | exactly one Elder Wand, ever: in the tomb or in one wizard's trunk. |
| `TermDecree` | `endTerm`, `decree`, `applyPatch` | at most one decree charge in the world; NPCs never rule; only the Minister decrees; ≤ 1 decree per term; rules stay within their constitutional bounds. |
| `Seals` | `readSealPage`, `breakSeal` | seals break in order and only for a qualified wizard holding every page; ≤ 3 attempts per window; progress is monotone. |
| `Pairing` | `mintPairCode`, `redeemPairCode(code, source)`, the 1 Hz sweep | a code binds at most once, never after its TTL, one live code per wizard, failed attempts per window ≤ the realm cap (every attempt is refused beyond it) and ≤ the per-source cap; a throttled source spends nothing, so a realm lock needs ≥ FailCap / IpCap sources; a used or dead code never comes back; *liveness*: every code is eventually used or dead. |
| `Hex` | `guardHostileGift` + `deliverHostile` / `applyJinx` / `silence`, `jinxBites`, `cleanse`, the sweep | one recipient, ready, unready and housemate senders who may earn Galleons again, PvP decrees: ≤ Cap active jinxes, ≤ 2 cursed items, ≤ 1 bound curse, ≤ WinCap parcels per window, jinx damage never below max(1, 25 % max health), movement never below 25 %, silence bounded and always followed by a casting window, newcomers/NPCs/first-years never hexed, unready senders never send, the PvP rules are respected, the sender pays exactly (the recipient nothing), a safe zone or PvP off suspends everything, per-pair cooldown and respite hold. Each clause of the gate was removed in turn and TLC found the violation. |
| `HexLive` | `Hex` under the ratio of the real constants | *liveness* with weak fairness on Tick alone (the senders do anything): every hex and every silence ends. Jinxes and silences last 2 ticks and the window admits fewer parcels than it takes to cover it (Lean `hexes_leave_gaps`), so the gate, not the clock, is what makes it hold: with the window clause dropped TLC finds a never-clean behaviour. |
| `Owl` | `owl`, `answerAsk`, `expireAsks`, `makeOwlRoom`, `takeOwls` | the owlbox is bounded; an unanswered question is never evicted; an agent's owl never pushes out a player owl it has not read (it is refused instead); an unread player owl pushed out by a newer one is never lost silently (its count rides on the next unread owl until the agent reads it); a question is answered at most once and only with one of its options (or expires); ids increase; *liveness*: every question is answered or expires. |
| `Control` | `setInput`, `setGoal(…, by)`, `playerSteering`, `setAgentPaused`, `agentMayAct` | a paused agent never acts (only AGENT_PAUSE_ALLOWED tools run) and has no walk; WASD always ends the agent's walk; an agent never overrides nor cancels the player's click walk, and only starts a walk once the player has let go for the grace; the player's own controls are never refused; *liveness*: a player who wants the wheel gets it. |

## Lean proofs (`lean/Hogwarts.lean`)

`yearForXp` bounded and monotone · `titleIndex` monotone (titles never go down) · duel economy
conserves reputation (only the base is created, the victim never goes negative) · a committed cast
spends exactly its cost and a fizzle is free · **effects per cast ≤ E·(1+A)** (the bound the TLA+ step
properties imply) · caps clamp · healing never exceeds max health · aura stacking never exceeds a
cap · summons never exceed the cap · decrees stay constitutional · **Feistel rounds are injective
for any round function**, so every seal has exactly one answer.

Agent link (docs/AGENT_LINK.md §A.5, §B.8): `pair_guess_bound` (a window's checked guesses hit at most
as many of the 31⁶ codes as there are guesses, so live · hits ≤ cap · live) and `pair_lifetime_odds`
(< 10⁻⁶ to guess a code during its life) · the `derived()` floors `hp_floor`, `mana_floor`,
`manaregen_floor` (+ `manaregen_pos`: mana never drains), `speed_floor`, `move_floor` (+ `always_moves`),
`power_pos` ⇒ `damage_nonneg`, `ward_bounded` (+ `ward_scale`) · `hex_dot_floor` (and over any number
of ticks, `hex_dots_floor`), `hex_dot_never_stuns`, `hex_tick_capped` (+ `hex_tick_softens`, `hex_tick_worst_ward`) ·
`realm_lock_needs_sources` · `hexes_leave_gaps` · `hex_cost_pos`, `hex_cost_mono`, `sender_pays` ·
timing constants fit together (`cooldown_covers_binding`, `silence_duty`, `open_questions_fit`, `grace_short`). Every
shared constant is printed into the vectors and compared with `src/shared/constants.ts`.

## Scope, honestly

These verify *models* and *pure functions*. The TypeScript is not itself extracted from Lean or TLA+.
The bridge is (1) the conformance vectors and (2) the randomized re-check of the hostility invariants
against the real `World.canHarm`. Timing (continuous physics, AI steering) is not modelled.

Tool versions used: TLA+ Tools 2.0 (2026-03-02), Lean 4.33.0.
