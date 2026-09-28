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
| `Hostility` | `World.canHarm` | 10 invariants over every combination of houses, activity, safe zones, liveness, PvP and friendly-fire (1,048,576 states): no self-harm, safe zones are safe, the stunned are untouchable, benign creatures never attack, the phoenix can't be harmed, summons never harm their owner and harm exactly what their owner may, wild creatures only hunt wizards and summons, attacking a summon counts as attacking its owner. **Re-checked on 3,000 random real worlds in `test/formal.test.ts`.** |
| `CastTxn` | `magic.ts execute`, `(after …)` | mana never negative; a fizzle changes nothing; each transaction applies ≤ E effects; only top-level casts schedule delayed blocks (≤ A each); the pending queue is bounded. |
| `Lifecycle` | `tick`, `stun`, `revive`, `sendToAzkaban`, summons | summons exist only while their owner is active; *liveness*: nobody stays stunned or in Azkaban forever; a summon vanishes when its life runs out unless recast. |
| `ElderWand` | `placeEggs`, `transferElderWand`, `elderWandUpkeep` | exactly one Elder Wand, ever: in the tomb or in one wizard's trunk. |
| `TermDecree` | `endTerm`, `decree`, `applyPatch` | at most one decree charge in the world; NPCs never rule; only the Minister decrees; ≤ 1 decree per term; rules stay within their constitutional bounds. |
| `Seals` | `readSealPage`, `breakSeal` | seals break in order and only for a qualified wizard holding every page; ≤ 3 attempts per window; progress is monotone. |

## Lean proofs (`lean/Hogwarts.lean`)

`yearForXp` bounded and monotone · `titleIndex` monotone (titles never go down) · duel economy
conserves reputation (only the base is created, the victim never goes negative) · a committed cast
spends exactly its cost and a fizzle is free · **effects per cast ≤ E·(1+A)** (the bound the TLA+ step
properties imply) · caps clamp · healing never exceeds max health · aura stacking never exceeds a
cap · summons never exceed the cap · decrees stay constitutional · **Feistel rounds are injective
for any round function**, so every seal has exactly one answer.

## Scope, honestly

These verify *models* and *pure functions*. The TypeScript is not itself extracted from Lean or TLA+.
The bridge is (1) the conformance vectors and (2) the randomized re-check of the hostility invariants
against the real `World.canHarm`. Timing (continuous physics, AI steering) is not modelled.

Tool versions used: TLA+ Tools 2.0 (2026-03-02), Lean 4.33.0.
