/-!
# Hogwarts — machine-checked properties of the game kernel

Each definition here mirrors a TypeScript function (named in its doc comment). Where the mirror
is exact, `vectors` at the bottom prints test vectors that `test/formal.test.ts` compares against
the TypeScript implementation, so the proofs are about the code that actually runs.
Lean 4 core only (no Mathlib). Check with: `lean formal/lean/Hogwarts.lean`
-/

namespace Hogwarts

/-! ## Progression: years and titles -/

/-- `yearForXp` in src/kernel/progression.ts (XP_FOR_YEAR = 0,0,150,400,800,1400,2200,3300). -/
def yearForXp (xp : Nat) : Nat :=
  if 3300 ≤ xp then 7 else if 2200 ≤ xp then 6 else if 1400 ≤ xp then 5 else if 800 ≤ xp then 4
  else if 400 ≤ xp then 3 else if 150 ≤ xp then 2 else 1

theorem yearForXp_bounds (xp : Nat) : 1 ≤ yearForXp xp ∧ yearForXp xp ≤ 7 := by
  unfold yearForXp; repeat (first | split | omega)

theorem yearForXp_mono {a b : Nat} (h : a ≤ b) : yearForXp a ≤ yearForXp b := by
  unfold yearForXp; repeat (first | split | omega)

/-- `titleIndex` in src/lore/titles.ts: the highest rung whose requirements are all met
    (0 Muggle … 9 Merlin). Written as the equivalent descending chain; `minister` is 1 if the
    wizard has served as Minister, else 0. -/
def titleIndex (year xp seals minister : Nat) : Nat :=
  if 7 ≤ year ∧ 4 ≤ seals ∧ 1 ≤ minister then 9
  else if 7 ≤ year ∧ 4 ≤ seals then 8
  else if 7 ≤ year ∧ 3 ≤ seals then 7
  else if 6 ≤ year ∧ 2 ≤ seals then 6
  else if 5 ≤ year ∧ 1 ≤ seals then 5
  else if 4 ≤ year ∧ 1 ≤ seals then 4
  else if 3 ≤ year then 3
  else if 2 ≤ year then 2
  else if 30 ≤ xp then 1
  else 0

theorem titleIndex_le_nine (y x s m : Nat) : titleIndex y x s m ≤ 9 := by
  unfold titleIndex; repeat (first | split | omega)

set_option maxHeartbeats 4000000 in
/-- Titles never go down as you progress (more years, XP, seals, or having been Minister). -/
theorem titleIndex_mono {y y' x x' s s' m m' : Nat}
    (hy : y ≤ y') (hx : x ≤ x') (hs : s ≤ s') (hm : m ≤ m') :
    titleIndex y x s m ≤ titleIndex y' x' s' m' := by
  unfold titleIndex
  repeat (first | split | omega)

/-! ## The duel economy -/

/-- Reputation stolen when stunning a wizard (world.ts `stun`): ⌊victim · pct / 100⌋. -/
def steal (victim pct : Nat) : Nat := victim * pct / 100

theorem steal_le (v p : Nat) (hp : p ≤ 100) : steal v p ≤ v := by
  unfold steal
  apply Nat.div_le_of_le_mul
  have : v * p ≤ v * 100 := Nat.mul_le_mul_left v hp
  omega

/-- After a duel, the victim keeps a non-negative balance and the total grows by exactly `base`:
    the stolen share is moved, never created. -/
theorem duel_conserves (k v base p : Nat) (hp : p ≤ 100) :
    (k + base + steal v p) + (v - steal v p) = k + v + base := by
  have := steal_le v p hp
  omega

/-! ## Casting is a transaction -/

def planCost (overhead : Nat) (plan : List Nat) : Nat := overhead + plan.foldl (· + ·) 0

/-- `execute` in src/kernel/magic.ts: commit only if the caster can pay for the whole plan. -/
def commit (mana overhead : Nat) (plan : List Nat) : Option Nat :=
  if planCost overhead plan ≤ mana then some (mana - planCost overhead plan) else none

/-- A committed cast leaves mana ≥ 0 and spends exactly the plan's cost. -/
theorem commit_spends_exactly {mana o : Nat} {plan : List Nat} {m' : Nat}
    (h : commit mana o plan = some m') : m' + planCost o plan = mana := by
  unfold commit at h
  split at h
  · cases h; omega
  · contradiction

/-- A fizzle is free: if the caster cannot pay, nothing is committed. -/
theorem fizzle_is_free {mana o : Nat} {plan : List Nat} (h : mana < planCost o plan) :
    commit mana o plan = none := by
  unfold commit; split <;> first | rfl | omega

/-- Per-cast effect bound: a top-level plan of ≤ E effects plus ≤ A delayed blocks of ≤ E effects
    each (delayed blocks cannot schedule more) yields at most E · (1 + A) effects. -/
theorem effects_per_cast_bound (E A top : Nat) (blocks : List Nat)
    (htop : top ≤ E) (hlen : blocks.length ≤ A) (hb : ∀ b ∈ blocks, b ≤ E) :
    top + blocks.foldr (· + ·) 0 ≤ E * (1 + A) := by
  have hsum : blocks.foldr (· + ·) 0 ≤ blocks.length * E := by
    induction blocks with
    | nil => simp
    | cons b bs ih =>
      simp only [List.foldr_cons, List.length_cons]
      have h1 := hb b (List.mem_cons_self ..)
      have h2 := ih (by simp at hlen; omega) (fun x hx => hb x (List.mem_cons_of_mem _ hx))
      rw [Nat.succ_mul]; omega
  have : blocks.length * E ≤ A * E := Nat.mul_le_mul_right E hlen
  rw [Nat.mul_add, Nat.mul_one, Nat.mul_comm E A]
  omega

/-! ## Caps, healing, auras, summons, decrees -/

/-- Every requested magnitude is clamped to the caster's cap (magic.ts `clampNote`). -/
theorem clamp_le_cap (x cap : Nat) : min x cap ≤ cap := Nat.min_le_right x cap

/-- Healing, regeneration, phoenix tears and mending all use `min max (hp + amount)`. -/
theorem heal_le_max (hp amount max : Nat) : min max (hp + amount) ≤ max := Nat.min_le_left _ _

/-- Aura stacking keeps the stronger magnitude (auras.ts `addAura`), so re-casting can never exceed a cap. -/
theorem aura_stack_le_cap (a b cap : Nat) (ha : a ≤ cap) (hb : b ≤ cap) : max a b ≤ cap := Nat.max_le.mpr ⟨ha, hb⟩

/-- `summon` in world.ts: at the cap, the oldest are dismissed before the new one arrives. -/
def summonInto {α} (maxS : Nat) (l : List α) (x : α) : List α := (l.drop (l.length + 1 - maxS)) ++ [x]

theorem summons_capped {α} (maxS : Nat) (hm : 1 ≤ maxS) (l : List α) (x : α) :
    (summonInto maxS l x).length ≤ maxS := by
  unfold summonInto; simp [List.length_drop]; omega

/-- `applyPatch` in rulebook.ts, per numeric rule: out-of-bounds proposals are refused. -/
def decreeRule (lo hi cur v : Nat) : Nat := if lo ≤ v ∧ v ≤ hi then v else cur

theorem decree_stays_constitutional (lo hi cur v : Nat) (h : lo ≤ cur ∧ cur ≤ hi) :
    lo ≤ decreeRule lo hi cur v ∧ decreeRule lo hi cur v ≤ hi := by
  unfold decreeRule; split <;> omega

/-! ## The seals have exactly one answer

Tier 2–4 seals are Feistel networks (seals.ts `generateSeal`). A Feistel round is a bijection for
*any* round function F, so the whole program is injective and the seal accepts exactly one input. -/

abbrev W := BitVec 32

def round (F : W → W) (lr : W × W) : W × W := (lr.2, lr.1 ^^^ F lr.2)
def unround (F : W → W) (lr : W × W) : W × W := (lr.2 ^^^ F lr.1, lr.1)

theorem unround_round (F : W → W) (lr : W × W) : unround F (round F lr) = lr := by
  obtain ⟨l, r⟩ := lr
  simp [round, unround, BitVec.xor_assoc, BitVec.xor_self, BitVec.xor_zero]

theorem round_injective (F : W → W) {a b : W × W} (h : round F a = round F b) : a = b := by
  have := congrArg (unround F) h
  rwa [unround_round, unround_round] at this

/-- n rounds with (possibly different) round functions are still injective. -/
def rounds : List (W → W) → W × W → W × W
  | [], lr => lr
  | F :: Fs, lr => rounds Fs (round F lr)

theorem rounds_injective (Fs : List (W → W)) {a b : W × W} (h : rounds Fs a = rounds Fs b) : a = b := by
  induction Fs generalizing a b with
  | nil => simpa [rounds] using h
  | cons F Fs ih => exact round_injective F (ih h)

/-- Tier 3 folds r2 ^= r0 + r1 after the rounds: also invertible given r0, r1. -/
theorem fold_injective (x y s : W) (h : x ^^^ s = y ^^^ s) : x = y := by
  have := congrArg (· ^^^ s) h
  simpa [BitVec.xor_assoc, BitVec.xor_self, BitVec.xor_zero] using this

/-! ## Conformance vectors (compared with the TypeScript code in test/formal.test.ts) -/

def xpSamples : List Nat := (List.range 90).map (· * 50)

def vectors : String :=
  let years := xpSamples.map fun x => s!"[{x},{yearForXp x}]"
  let titles := Id.run do
    let mut out : List String := []
    for y in [1, 2, 3, 4, 5, 6, 7] do
      for x in [0, 29, 30, 150, 4000] do
        for s in [0, 1, 2, 3, 4] do
          for m in [0, 1] do
            out := out ++ [s!"[{y},{x},{s},{m},{titleIndex y x s m}]"]
    return out
  let steals := Id.run do
    let mut out : List String := []
    for v in [0, 7, 100, 999, 12345] do
      for p in [0, 10, 33, 50] do
        out := out ++ [s!"[{v},{p},{steal v p}]"]
    return out
  "{\"yearForXp\":[" ++ ",".intercalate years ++ "],\"titleIndex\":[" ++ ",".intercalate titles ++
    "],\"steal\":[" ++ ",".intercalate steals ++ "]}"

#eval IO.println ("VECTORS " ++ vectors)

end Hogwarts
