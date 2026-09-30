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

/-! ## Owl Post agent link (docs/AGENT_LINK.md §A.5, §B.8)

Constants shared with src/shared/constants.ts (each is printed into `vectors` and compared). Stats use
the integer units the TypeScript computes exactly: health and mana in points, percentages as integers
(speed, power, ward, slow), mana regeneration in tenths of a point per second. Enchantments are
integers and may be negative (a cursed item). -/

def PAIR_ALPHABET_LEN : Nat := 31
def PAIR_LEN : Nat := 6
def PAIR_TTL_S : Nat := 600
def PAIR_FAIL_PER_IP_PER_MIN : Nat := 10
def PAIR_FAIL_PER_REALM_PER_MIN : Nat := 30
def LOGIN_FAIL_PER_IP_PER_MIN : Nat := 20
def HP_FLOOR : Int := 40
def HP_FLOOR_PCT : Int := 60
def MANA_FLOOR : Int := 20
def MANA_FLOOR_PCT : Int := 50
def MANAREGEN_FLOOR_PCT : Int := 50
def SPEED_FLOOR_PCT : Int := 50
def MOVE_SLOW_FLOOR_PCT : Int := 25
def POWER_FLOOR_PCT : Int := 25
def WARD_MIN_PCT : Int := -25
def WARD_MAX_PCT : Int := 50
def HEX_HP_FLOOR_PCT : Nat := 25
def HEX_MALICE_TAX : Nat := 3
def CURSED_ITEM_BIND_S : Nat := 300
def HEX_MIN_YEAR : Nat := 2
def HEX_PAIR_COOLDOWN_S : Nat := 300
def VICTIM_HEX_CAP : Nat := 3
def VICTIM_CURSED_ITEMS_MAX : Nat := 2
def VICTIM_BOUND_CAP : Nat := 1
def VICTIM_HEX_PER_10MIN : Nat := 3
def HEX_WINDOW_S : Nat := 600
def HEX_RESPITE_S : Nat := 60
def SILENCE_MAX_S : Nat := 5
def SILENCE_COOLDOWN_S : Nat := 20
def FORGE_FAIL_PER_MIN : Nat := 12
def OWLBOX_MAX : Nat := 50
def OWL_MAX_CHARS : Nat := 400
def OWL_PER_MIN : Nat := 30
def ASK_TTL_S : Nat := 45
def LISTEN_MAX_S : Nat := 45
def PLAYER_GRACE_S : Nat := 2
/-- NEG_LIMITS: maxHp, maxMana, manaRegen, speed, power, ward. -/
def NEG_LIMITS : List (String × Int) :=
  [("maxHp", -30), ("maxMana", -30), ("manaRegen", -3), ("speed", -20), ("power", -15), ("ward", -20)]
/-- JINX_DEFAULTS: (kind, magnitude in tenths, seconds). -/
def JINX_DEFAULTS : List (String × Nat × Nat) :=
  [("jelly", 4, 20), ("dance", 10, 20), ("boils", 30, 12), ("bats", 30, 5), ("langlock", 10, 5)]

/-! ### Pairing codes: brute force is hopeless (§A.5) -/

/-- PAIR_SPACE = 31^6. -/
def pairSpace : Nat := PAIR_ALPHABET_LEN ^ PAIR_LEN
theorem pair_space_val : pairSpace = 887503681 := rfl

/-- How many codes in [0, S) a list of guesses hits (the codes it contains). -/
def hits : Nat → List Nat → Nat
  | 0, _ => 0
  | S + 1, g => hits S g + (if g.contains S then 1 else 0)

theorem filter_lt_succ (g : List Nat) (S : Nat) :
    (g.filter (fun x => decide (x < S + 1))).length = (g.filter (fun x => decide (x < S))).length + g.count S := by
  induction g with
  | nil => simp
  | cons x xs ih =>
    simp only [List.filter_cons, List.count_cons]
    by_cases h1 : x < S
    · have h2 : x < S + 1 := by omega
      have h3 : (x == S) = false := by simp; omega
      simp [h1, h2, h3, ih]; omega
    · by_cases h4 : x = S
      · subst h4; simp [ih]; omega
      · have h5 : ¬ x < S + 1 := by omega
        have h3 : (x == S) = false := by simp; omega
        simp [h1, h5, h3, ih]

theorem hits_le (S : Nat) (g : List Nat) : hits S g ≤ (g.filter (fun x => decide (x < S))).length := by
  induction S with
  | zero => simp [hits]
  | succ S ih =>
    unfold hits
    rw [filter_lt_succ]
    by_cases h : S ∈ g
    · have : 0 < g.count S := List.count_pos_iff.mpr h
      simp [h]; omega
    · simp [h]; omega

/-- A list of guesses can hit at most as many codes as it has guesses. -/
theorem guesses_hit_at_most (S : Nat) (g : List Nat) : hits S g ≤ g.length :=
  Nat.le_trans (hits_le S g) (List.length_filter_le _ _)

/-- pair_guess_bound: in one window a realm checks at most `cap` wrong guesses (World.redeemPairCode
    refuses every attempt beyond PAIR_FAIL_PER_REALM_PER_MIN failures a minute), and those guesses cover
    at most `cap` of the pairSpace codes. So, summed over the `live` codes (each uniformly random), the
    expected number of codes guessed in a window is at most cap × live / pairSpace:
    live · hits ≤ cap · live, with hits counted out of pairSpace. -/
theorem pair_guess_bound (g : List Nat) (cap live : Nat) (hg : g.length ≤ cap) :
    live * hits pairSpace g ≤ cap * live := by
  have := Nat.le_trans (guesses_hit_at_most pairSpace g) hg
  rw [Nat.mul_comm cap live]
  exact Nat.mul_le_mul_left live this

/-- Over a code's whole life (PAIR_TTL_S = 3 windows of PAIR_FAIL_PER_REALM_PER_MIN guesses) the chance of
    guessing it is below one in a million. -/
theorem pair_lifetime_odds : PAIR_FAIL_PER_REALM_PER_MIN * (PAIR_TTL_S / 60) * 1000000 < pairSpace := by
  rw [pair_space_val]; decide

/-- The failures a realm counts in a window, given each source's count (World.redeemPairCode refuses a
    source at PAIR_FAIL_PER_IP_PER_MIN before counting, so no source adds more than that). -/
def realmFails : List Nat → Nat
  | [] => 0
  | f :: fs => f + realmFails fs
theorem realm_fails_le (cap : Nat) : ∀ fs : List Nat, (∀ f ∈ fs, f ≤ cap) → realmFails fs ≤ fs.length * cap
  | [], _ => by simp [realmFails]
  | f :: fs, h => by
    have h1 := h f (by simp)
    have h2 := realm_fails_le cap fs (fun x hx => h x (by simp [hx]))
    simp only [realmFails, List.length_cons, Nat.succ_mul]; omega
/-- realm_lock_needs_sources: filling the realm's window (which refuses everyone, the right code
    included) takes failures from at least 3 sources; one address alone never locks a realm. -/
theorem realm_lock_needs_sources (fs : List Nat) (h : ∀ f ∈ fs, f ≤ PAIR_FAIL_PER_IP_PER_MIN)
    (full : PAIR_FAIL_PER_REALM_PER_MIN ≤ realmFails fs) : 3 ≤ fs.length := by
  have := realm_fails_le PAIR_FAIL_PER_IP_PER_MIN fs h
  unfold PAIR_FAIL_PER_REALM_PER_MIN PAIR_FAIL_PER_IP_PER_MIN at *; omega

/-! ### derived() floors (progression.ts, §B.7): a curse scales you down, never out -/

/-- progression.ts `yearBaseHp`. -/
def yearBaseHp (year : Nat) : Int := 100 + 15 * ((year : Int) - 1)
/-- progression.ts `hpFloor`: max(40, 60% of the year's base). -/
def hpFloor (year : Nat) : Int := max HP_FLOOR (yearBaseHp year * HP_FLOOR_PCT / 100)
/-- derivedUncached maxHp (without the unicorn's curse). -/
def maxHpOf (year : Nat) (mods : Int) : Int := max (hpFloor year) (yearBaseHp year + mods)

theorem hp_floor (y : Nat) (m : Int) : HP_FLOOR ≤ maxHpOf y m ∧ yearBaseHp y * HP_FLOOR_PCT / 100 ≤ maxHpOf y m := by
  unfold maxHpOf hpFloor; omega

/-- progression.ts `manaFloor` and derivedUncached maxMana (`base` = the year's base mana). -/
def manaFloor (base : Int) : Int := max MANA_FLOOR (base * MANA_FLOOR_PCT / 100)
def maxManaOf (base mods : Int) : Int := max (manaFloor base) (base + mods)

theorem mana_floor (b m : Int) : MANA_FLOOR ≤ maxManaOf b m ∧ b * MANA_FLOOR_PCT / 100 ≤ maxManaOf b m := by
  unfold maxManaOf manaFloor; omega

/-- derivedUncached manaRegen, in tenths: max(50% of the rule, rule + item + wand core). -/
def manaRegenOf (rule mods core : Int) : Int := max (rule * MANAREGEN_FLOOR_PCT / 100) (rule + mods + core)

theorem manaregen_floor (r m c : Int) : r * MANAREGEN_FLOOR_PCT / 100 ≤ manaRegenOf r m c := by
  unfold manaRegenOf; omega

/-- The rulebook keeps magic.manaRegen ≥ 1 per second, so mana never drains (CastTxn.ManaNeverNegative's Regen). -/
theorem manaregen_pos (r m c : Int) (hr : 10 ≤ r) : 0 < manaRegenOf r m c := by
  unfold manaRegenOf MANAREGEN_FLOOR_PCT; omega

/-- progression.ts `speedMultFor`, in percent. -/
def speedPct (mods : Int) : Int := max SPEED_FLOOR_PCT (100 + mods)
theorem speed_floor (m : Int) : SPEED_FLOOR_PCT ≤ speedPct m := by unfold speedPct; omega

/-- progression.ts `moveSlow`, in percent: chill and Jelly-Legs together. -/
def moveSlowPct (chill jelly : Int) : Int := max MOVE_SLOW_FLOOR_PCT (100 - chill - jelly)
theorem move_floor (c j : Int) : MOVE_SLOW_FLOOR_PCT ≤ moveSlowPct c j := by unfold moveSlowPct; omega
/-- You can always move: speed × slow > 0 whatever you wear and whatever is on you. -/
theorem always_moves (m c j : Int) : 0 < speedPct m * moveSlowPct c j :=
  Int.mul_pos (by have := speed_floor m; unfold SPEED_FLOOR_PCT at this; omega)
              (by have := move_floor c j; unfold MOVE_SLOW_FLOOR_PCT at this; omega)

/-- progression.ts `powerFor`, in percent. -/
def powerPct (p : Int) : Int := max POWER_FLOOR_PCT (100 + p)
theorem power_pos (p : Int) : 0 < powerPct p := by unfold powerPct POWER_FLOOR_PCT; omega
/-- ⇒ damage is never healing. -/
theorem damage_nonneg (a p : Int) (ha : 0 ≤ a) : 0 ≤ a * powerPct p := Int.mul_nonneg ha (Int.le_of_lt (power_pos p))

/-- progression.ts `wardFor`, in percent. -/
def wardPct (w : Int) : Int := min WARD_MAX_PCT (max WARD_MIN_PCT w)
theorem ward_bounded (w : Int) : WARD_MIN_PCT ≤ wardPct w ∧ wardPct w ≤ WARD_MAX_PCT := by
  unfold wardPct WARD_MIN_PCT WARD_MAX_PCT; omega
/-- Damage taken is scaled by (100 − ward)% ∈ [50%, 125%]: a ward never heals, a cursed ward at most adds a quarter. -/
theorem ward_scale (w : Int) : 50 ≤ 100 - wardPct w ∧ 100 - wardPct w ≤ 125 := by
  have := ward_bounded w; unfold WARD_MIN_PCT WARD_MAX_PCT at this; omega

/-! ### Jinx damage over time never knocks anyone out (§B.3) -/

/-- progression.ts `hexHpFloor`: max(1, 25% of max health). -/
def hexFloor (maxHp : Nat) : Nat := max 1 (maxHp * HEX_HP_FLOOR_PCT / 100)
/-- progression.ts `hexDotHp`: health after `d` jinx damage. -/
def hexDot (hp maxHp d : Nat) : Nat := max (min hp (hexFloor maxHp)) (hp - d)

theorem hex_dot_floor (hp maxHp d : Nat) (h : hexFloor maxHp ≤ hp) : hexFloor maxHp ≤ hexDot hp maxHp d := by
  unfold hexDot; omega
theorem hex_dot_never_stuns (hp maxHp d : Nat) (h : 1 ≤ hp) : 1 ≤ hexDot hp maxHp d := by
  unfold hexDot hexFloor; omega
theorem hex_dot_le (hp maxHp d : Nat) : hexDot hp maxHp d ≤ hp := by unfold hexDot; omega
/-- Any number of jinx ticks, of any size, keep a wizard above the floor. -/
theorem hex_dots_floor (maxHp : Nat) : ∀ (ds : List Nat) (hp : Nat), hexFloor maxHp ≤ hp →
    hexFloor maxHp ≤ ds.foldl (fun h d => hexDot h maxHp d) hp
  | [], _, h => h
  | d :: ds, hp, h => hex_dots_floor maxHp ds _ (hex_dot_floor hp maxHp d h)

/-- progression.ts `hexTickDmg`: one jinx tick after every multiplier (rules, the victim's ward), capped
    at the jinx's own rate for the tick. -/
def hexTick (rate scaled : Nat) : Nat := min rate scaled
/-- hex_tick_capped: a cursed ward (or a decree) never makes a jinx outgrow its table. -/
theorem hex_tick_capped (r s : Nat) : hexTick r s ≤ r := by unfold hexTick; omega
/-- …while a protective ward still softens it. -/
theorem hex_tick_softens (r s : Nat) (h : s ≤ r) : hexTick r s = s := by unfold hexTick; omega
/-- With the worst cursed ward (the damage scaled to 125 %), the tick is still the table's rate. -/
theorem hex_tick_worst_ward (r : Nat) : hexTick r (r * (100 - WARD_MIN_PCT).toNat / 100) = r := by
  unfold hexTick WARD_MIN_PCT; simp; omega

/-! ### What a curse costs its sender (§B.2, §B.4) -/

/-- progression.ts `itemPrice` for whole points. -/
def itemPrice (points : Nat) : Nat := max 5 (points * 3)
/-- progression.ts `hexPrice`: the item's price plus the malice tax. -/
def hexCost (points : Nat) : Nat := itemPrice points + HEX_MALICE_TAX

theorem hex_cost_pos (p : Nat) : 8 ≤ hexCost p := by unfold hexCost itemPrice HEX_MALICE_TAX; omega
theorem hex_cost_mono {p q : Nat} (h : p ≤ q) : hexCost p ≤ hexCost q := by unfold hexCost itemPrice; omega
/-- Galleons are conserved: the sender loses exactly the cost (the recipient's balance is untouched). -/
theorem sender_pays (g p : Nat) (h : hexCost p ≤ g) : (g - hexCost p) + hexCost p = g := by omega

/-! ### The timing constants fit together -/

/-- One sender cannot re-bind a victim before the previous binding has worn off. -/
theorem cooldown_covers_binding : CURSED_ITEM_BIND_S ≤ HEX_PAIR_COOLDOWN_S := by decide
/-- Silence is at most a fifth of any stretch of time: ≤ SILENCE_MAX_S, then SILENCE_COOLDOWN_S free. -/
theorem silence_duty : SILENCE_MAX_S * 5 ≤ SILENCE_MAX_S + SILENCE_COOLDOWN_S := by decide
/-- Questions last less than the owl rate window, so at most OWL_PER_MIN are ever open: they always fit in the owlbox. -/
theorem open_questions_fit : ASK_TTL_S ≤ 60 ∧ OWL_PER_MIN < OWLBOX_MAX := by decide
/-- The longest a parcel's effect lasts: any jinx of JINX_DEFAULTS, or a silence. -/
def longestHex : Nat := (JINX_DEFAULTS.map fun (_, _, s) => s).foldl max SILENCE_MAX_S
theorem longest_hex_val : longestHex = 20 := by decide
/-- hexes_leave_gaps: the parcels the 10-minute window admits (from all senders together) cannot cover
    it, so no group of senders keeps anyone jinxed without a gap — the ratio formal/tla/HexLive.tla's
    liveness is checked under (LeavesGaps: WinCap × the longest effect < WinLen). -/
theorem hexes_leave_gaps : VICTIM_HEX_PER_10MIN * longestHex < HEX_WINDOW_S := by decide
/-- The player's grace is shorter than a question's life: an agent that asks first is never locked out by it. -/
theorem grace_short : PLAYER_GRACE_S < ASK_TTL_S := by decide

/-! ## 不公平，但好玩 — unfair, but fun (README; src/kernel/progression.ts)

Constants shared with src/shared/constants.ts (printed into `vectors` and compared). -/

def STEAL_CAP_PCT : Nat := 30
def STEAL_DARK_LORD_PCT : Nat := 30
def STEAL_BASE_PCT : Nat := 10
/-- STEAL_TIERS: (reputation threshold, percent), ascending. -/
def STEAL_TIERS : List (Nat × Nat) := [(0, 5), (50, 10), (200, 15), (500, 20)]
def DARK_LORD_MIN_REP : Nat := 150
def DARK_LORD_SEEN_S : Nat := 180
def DARK_LORD_HYSTERESIS_PCT : Nat := 10
def DARK_LORD_POWER_PCT : Nat := 115
def DARK_LORD_BROADCAST_S : Nat := 60
def DA_REP_CEILING : Nat := 100
def DA_MAX_MEMBERS : Nat := 24
def DA_QUORUM : Nat := 3
def DA_VETO_WINDOW_S : Nat := 180
def DA_VETOES_PER_TERM : Nat := 1
def DA_JOINT_MIN : Nat := 3
def DA_JOINT_WINDOW_S : Nat := 20
def DA_JOINT_PCT : Nat := 125
def STUDY_DELAY_S : Nat := 120
def STUDY_MEMORY_S : Nat := 600
def STUDY_KEEP : Nat := 8
def STUDIED_KEEP : Nat := 64
def LAWLESS_MULT : Nat := 2

/-! ### 输赢代价不对称: the steal curve -/

/-- progression.ts `stealTier`: the victim's tier in percent (STEAL_TIERS by reputation; the Dark Lord 30). -/
def stealTier (rep : Nat) (dark : Bool) : Nat :=
  if dark then STEAL_DARK_LORD_PCT
  else if 500 ≤ rep then 20 else if 200 ≤ rep then 15 else if 50 ≤ rep then 10 else 5

/-- progression.ts `stealPct`: the tier scaled by the rulebook's duelRepStealPct (`base`, default 10) and by
    `mult` (LAWLESS_MULT in the lawless zone), capped at STEAL_CAP_PCT. -/
def stealPct (rep : Nat) (dark : Bool) (base mult : Nat) : Nat :=
  min STEAL_CAP_PCT (stealTier rep dark * base * mult / STEAL_BASE_PCT)

/-- progression.ts `duelSteal`: what a duel stun takes from the victim, ⌊rep · stealPct / 100⌋ (`steal` above). -/
def duelSteal (rep : Nat) (dark : Bool) (base mult : Nat) : Nat := steal rep (stealPct rep dark base mult)

theorem steal_tier_le (r : Nat) (d : Bool) : stealTier r d ≤ STEAL_CAP_PCT := by
  unfold stealTier STEAL_DARK_LORD_PCT STEAL_CAP_PCT; repeat (first | split | omega)

/-- The richer the victim, the bigger the tier. -/
theorem steal_tier_mono {a b : Nat} (h : a ≤ b) (d : Bool) : stealTier a d ≤ stealTier b d := by
  unfold stealTier; repeat (first | split | omega)

/-- The Dark Lord's tier is at least anyone's. -/
theorem steal_tier_dark (r : Nat) : stealTier r false ≤ stealTier r true := by
  have h : stealTier r true = STEAL_CAP_PCT := by simp [stealTier, STEAL_DARK_LORD_PCT, STEAL_CAP_PCT]
  rw [h]; exact steal_tier_le r false

theorem steal_pct_le (r : Nat) (d : Bool) (b m : Nat) : stealPct r d b m ≤ STEAL_CAP_PCT := Nat.min_le_left _ _

theorem steal_pct_tier_mono {t t' : Nat} (h : t ≤ t') (b m : Nat) :
    min STEAL_CAP_PCT (t * b * m / STEAL_BASE_PCT) ≤ min STEAL_CAP_PCT (t' * b * m / STEAL_BASE_PCT) := by
  have h1 : t * b * m ≤ t' * b * m := Nat.mul_le_mul_right _ (Nat.mul_le_mul_right _ h)
  have h2 : t * b * m / STEAL_BASE_PCT ≤ t' * b * m / STEAL_BASE_PCT := Nat.div_le_div_right h1
  omega

theorem steal_pct_mono {a b' : Nat} (h : a ≤ b') (d : Bool) (base mult : Nat) :
    stealPct a d base mult ≤ stealPct b' d base mult :=
  steal_pct_tier_mono (steal_tier_mono h d) base mult

/-- duel_steal_cap: a stun never takes more than 30 % of the victim's reputation (whatever the rulebook or the zone). -/
theorem duel_steal_cap (v : Nat) (d : Bool) (b m : Nat) : duelSteal v d b m * 100 ≤ v * STEAL_CAP_PCT := by
  unfold duelSteal steal
  have := Nat.div_mul_le_self (v * stealPct v d b m) 100
  have := Nat.mul_le_mul_left v (steal_pct_le v d b m)
  omega

theorem duel_steal_le (v : Nat) (d : Bool) (b m : Nat) : duelSteal v d b m ≤ v :=
  steal_le v _ (by have := steal_pct_le v d b m; unfold STEAL_CAP_PCT at this; omega)

/-- duel_steal_mono: monotone in the victim's reputation — being richer never makes you cheaper to rob. -/
theorem duel_steal_mono {v v' : Nat} (h : v ≤ v') (d : Bool) (b m : Nat) : duelSteal v d b m ≤ duelSteal v' d b m := by
  unfold duelSteal steal
  exact Nat.div_le_div_right (Nat.mul_le_mul h (steal_pct_mono h d b m))

/-- The Dark Lord always loses at least as much as anyone with the same reputation would. -/
theorem duel_steal_dark (v b m : Nat) : duelSteal v false b m ≤ duelSteal v true b m := by
  unfold duelSteal steal
  exact Nat.div_le_div_right (Nat.mul_le_mul_left v (steal_pct_tier_mono (steal_tier_dark v) b m))

/-- At the default rulebook (duelRepStealPct = 10, outside the lawless zone): newcomers 5 %, normal 10 %, the Dark Lord 30 %. -/
theorem steal_newcomer (v : Nat) (h : v < 50) : stealPct v false 10 1 = 5 := by
  unfold stealPct stealTier STEAL_CAP_PCT STEAL_BASE_PCT
  simp only [Bool.false_eq_true, if_false]
  repeat (first | split | omega)
theorem steal_normal (v : Nat) (h1 : 50 ≤ v) (h2 : v < 200) : stealPct v false 10 1 = 10 := by
  unfold stealPct stealTier STEAL_CAP_PCT STEAL_BASE_PCT
  simp only [Bool.false_eq_true, if_false]
  repeat (first | split | omega)
theorem steal_dark_lord (v : Nat) : stealPct v true 10 1 = 30 := by
  simp [stealPct, stealTier, STEAL_DARK_LORD_PCT, STEAL_CAP_PCT, STEAL_BASE_PCT]

/-- duel_conserves generalised: moving any share s ≤ v from the victim to the victor creates exactly `base`. -/
theorem duel_conserves_any (k v base s : Nat) (hs : s ≤ v) : (k + base + s) + (v - s) = k + v + base := by omega

/-- duel_conserves_curve: with the curve (any rank, the Dark Lord, any rulebook, the lawless zone's doubled
    base), the stolen share is moved, never created; the victim never goes negative. -/
theorem duel_conserves_curve (k v base : Nat) (d : Bool) (b m : Nat) :
    (k + base + duelSteal v d b m) + (v - duelSteal v d b m) = k + v + base :=
  duel_conserves_any k v base _ (duel_steal_le v d b m)

/-- The old flat rule is the curve's special case: duel_conserves is duel_conserves_any at s = steal v p. -/
theorem duel_conserves_flat (k v base p : Nat) (hp : p ≤ 100) :
    (k + base + steal v p) + (v - steal v p) = k + v + base := duel_conserves_any k v base _ (steal_le v p hp)

/-! ### 黑魔王: the mark does not flap -/

/-- progression.ts `darkLordTakes`: the challenger needs (100 + DARK_LORD_HYSTERESIS_PCT) % of the holder's reputation. -/
def darkLordTakes (holder challenger : Nat) : Bool := decide (holder * (100 + DARK_LORD_HYSTERESIS_PCT) ≤ challenger * 100)

/-- dark_lord_no_flap: right after a challenger takes the mark, the old holder cannot take it back without
    gaining reputation (for any holder with reputation > 0). -/
theorem dark_lord_no_flap (a b : Nat) (hb : 0 < b) (h : darkLordTakes b a = true) : darkLordTakes a b = false := by
  unfold darkLordTakes DARK_LORD_HYSTERESIS_PCT at *
  simp only [decide_eq_true_eq, decide_eq_false_iff_not] at *
  omega

/-- A tie never moves the mark. -/
theorem dark_lord_tie_stays (a : Nat) (ha : 0 < a) : darkLordTakes a a = false := by
  unfold darkLordTakes DARK_LORD_HYSTERESIS_PCT; simp only [decide_eq_false_iff_not]; omega

/-! ### 邓布利多军: a bounded joint spell, a real majority -/

/-- progression.ts `jointPct`. -/
def jointPct (n : Nat) : Nat := if DA_JOINT_MIN ≤ n then DA_JOINT_PCT else 100
theorem joint_bounded (n : Nat) : 100 ≤ jointPct n ∧ jointPct n ≤ DA_JOINT_PCT := by
  unfold jointPct DA_JOINT_PCT; split <;> omega
theorem joint_mono {a b : Nat} (h : a ≤ b) : jointPct a ≤ jointPct b := by
  unfold jointPct DA_JOINT_MIN DA_JOINT_PCT; repeat (first | split | omega)

/-- World.vetoDecree: passes with ≥ DA_QUORUM members in play and ⌊n/2⌋ + 1 of their votes. -/
def vetoPasses (online votes : Nat) : Bool := decide (DA_QUORUM ≤ online ∧ online / 2 + 1 ≤ votes)
/-- A passing veto is a strict majority of a quorum. -/
theorem veto_strict_majority (n v : Nat) (h : vetoPasses n v = true) : DA_QUORUM ≤ n ∧ n < 2 * v := by
  unfold vetoPasses DA_QUORUM at *; simp only [decide_eq_true_eq] at h; omega

/-! ### 专注力: the concentration pool -/

/-- progression.ts `focusAfter` (whole points): regeneration never overfills the pool. -/
def focusAfter (pts max regen dt : Nat) : Nat := min max (pts + regen * dt)
theorem focus_bounded (p m r d : Nat) : focusAfter p m r d ≤ m := Nat.min_le_left _ _
/-- World.spendConcentration: spend only what is there (like `commit`: a refusal spends nothing). -/
def spendFocus (cur cost : Nat) : Option Nat := if cost ≤ cur then some (cur - cost) else none
theorem spend_focus_exact {cur cost c' : Nat} (h : spendFocus cur cost = some c') : c' + cost = cur := by
  unfold spendFocus at h; split at h
  · cases h; omega
  · contradiction

/-! ### The timing constants fit together -/

/-- A spell that keeps hitting you becomes studyable long before it is forgotten. -/
theorem study_before_forgotten : STUDY_DELAY_S < STUDY_MEMORY_S := by decide
/-- The joint-spell window is shorter than the Dark Mark's broadcast period (a real ambush, not a standing buff). -/
theorem joint_window_short : DA_JOINT_WINDOW_S < DARK_LORD_BROADCAST_S := by decide
/-- The Dark Lord's bonus and the joint bonus never meet (the Dark Lord cannot be a member): the most any hit is
    multiplied by the two is the larger of them. -/
theorem bonus_max : max DARK_LORD_POWER_PCT DA_JOINT_PCT = 125 := by decide

/-- The 不公平，但好玩 part of the vectors. -/
def unfairVectors : String :=
  let q (s : String) : String := "\"" ++ s ++ "\""
  let arr (xs : List String) : String := "[" ++ ",".intercalate xs ++ "]"
  let obj (xs : List (String × String)) : String := "{" ++ ",".intercalate (xs.map fun (k, v) => q k ++ ":" ++ v) ++ "}"
  let b2n (b : Bool) : Nat := if b then 1 else 0
  let consts := obj [
    ("STEAL_CAP_PCT", toString STEAL_CAP_PCT), ("STEAL_DARK_LORD_PCT", toString STEAL_DARK_LORD_PCT), ("STEAL_BASE_PCT", toString STEAL_BASE_PCT),
    ("DARK_LORD_MIN_REP", toString DARK_LORD_MIN_REP), ("DARK_LORD_SEEN_S", toString DARK_LORD_SEEN_S),
    ("DARK_LORD_HYSTERESIS_PCT", toString DARK_LORD_HYSTERESIS_PCT), ("DARK_LORD_POWER_PCT", toString DARK_LORD_POWER_PCT),
    ("DARK_LORD_BROADCAST_S", toString DARK_LORD_BROADCAST_S), ("DA_REP_CEILING", toString DA_REP_CEILING),
    ("DA_MAX_MEMBERS", toString DA_MAX_MEMBERS), ("DA_QUORUM", toString DA_QUORUM), ("DA_VETO_WINDOW_S", toString DA_VETO_WINDOW_S),
    ("DA_VETOES_PER_TERM", toString DA_VETOES_PER_TERM), ("DA_JOINT_MIN", toString DA_JOINT_MIN),
    ("DA_JOINT_WINDOW_S", toString DA_JOINT_WINDOW_S), ("DA_JOINT_PCT", toString DA_JOINT_PCT),
    ("STUDY_DELAY_S", toString STUDY_DELAY_S), ("STUDY_MEMORY_S", toString STUDY_MEMORY_S), ("STUDY_KEEP", toString STUDY_KEEP),
    ("STUDIED_KEEP", toString STUDIED_KEEP), ("LAWLESS_MULT", toString LAWLESS_MULT)]
  let tiers := arr (STEAL_TIERS.map fun (a, p) => s!"[{a},{p}]")
  let reps : List Nat := [0, 1, 49, 50, 99, 100, 149, 150, 199, 200, 333, 499, 500, 999, 12345]
  let tierV := Id.run do
    let mut out : List String := []
    for r in reps do
      for d in [false, true] do
        out := out ++ [s!"[{r},{b2n d},{stealTier r d}]"]
    return out
  let pctV := Id.run do
    let mut out : List String := []
    for r in reps do
      for d in [false, true] do
        for b in [0, 5, 10, 20, 50] do
          for m in [1, 2] do
            out := out ++ [s!"[{r},{b2n d},{b},{m},{stealPct r d b m},{duelSteal r d b m}]"]
    return out
  let takesV := Id.run do
    let mut out : List String := []
    for h in [0, 1, 100, 150, 1000] do
      for c in [0, 100, 109, 110, 111, 150, 165, 1099, 1100] do
        out := out ++ [s!"[{h},{c},{b2n (darkLordTakes h c)}]"]
    return out
  let jointV := [0, 1, 2, 3, 4, 10].map fun n => s!"[{n},{jointPct n}]"
  let vetoV := Id.run do
    let mut out : List String := []
    for n in [0, 1, 2, 3, 4, 5, 6, 7] do
      for v in [0, 1, 2, 3, 4, 5] do
        if v ≤ n then out := out ++ [s!"[{n},{v},{b2n (vetoPasses n v)}]"]
    return out
  let focusV := Id.run do
    let mut out : List String := []
    for p in [0, 3, 59, 60] do
      for m in [10, 60] do
        for r in [1, 2] do
          for d in [0, 1, 5, 100] do
            out := out ++ [s!"[{p},{m},{r},{d},{focusAfter p m r d}]"]
    return out
  obj [("constants", consts), ("stealTiers", tiers), ("stealTier", arr tierV), ("stealPct", arr pctV), ("darkLordTakes", arr takesV),
    ("jointPct", arr jointV), ("vetoPasses", arr vetoV), ("focusAfter", arr focusV)]

/-! ## 咒语集市 — the spell market's royalties (src/kernel/market.ts `royaltyStep`, README 咒语集市)

Royalties are counted in tenths of a reputation point. A successful cast of a market spell by an eligible
caster pays the spell's author MARKET_AUTHOR_TENTHS (unless the caster is the author) and a fork's parent
author MARKET_PARENT_TENTHS (unless that is the caster or the author), once per (spell, caster) per day, each
within the day's cap. Proved: nobody earns more than the cap in a day (`royalty_day_capped`), a (spell,
caster) pair pays the author at most one reputation point a day however often it is cast (`royalty_per_pair`)
and the parent at most its share (`royalty_parent_per_pair`), the caster is never paid by their own cast
(`royalty_not_self`), an NPC or a fresh enrolee pays nothing (`royalty_npc`). -/

def MARKET_AUTHOR_TENTHS : Nat := 10
def MARKET_PARENT_TENTHS : Nat := 3
def MARKET_DAY_S : Nat := 86400
def MARKET_CAP_DEFAULT : Nat := 20
def MARKET_CAP_MAX : Nat := 50
def MARKET_ANNOUNCE_S : Nat := 600
def MARKET_MAX_VERSIONS : Nat := 16
def MARKET_MAX_PER_AUTHOR : Nat := 12
def MARKET_BAN_MAX : Nat := 16
def MARKET_PROMOTE_MAX : Nat := 8

/-- market.ts `royaltyGrant`: the share, or what is left under the cap. -/
def royaltyGrant (earned share cap : Nat) : Nat := min share (cap - earned)

theorem royalty_grant_le (e s c : Nat) : royaltyGrant e s c ≤ s := Nat.min_le_left _ _
theorem royalty_grant_cap {e c : Nat} (s : Nat) (h : e ≤ c) : e + royaltyGrant e s c ≤ c := by
  unfold royaltyGrant; rw [Nat.min_def]; split <;> omega

/-- One successful cast of a market spell (ids as numbers). `npc`: the caster pays no royalty. -/
structure RCast where
  spell : Nat
  caster : Nat
  author : Nat
  parent : Option Nat
  npc : Bool

/-- A table of numbers by id. (A structure, not a bare function, so that `#eval` builds each update once
    instead of re-running the whole chain on every lookup; `t a` reads it.) -/
structure Tab where
  app : Nat → Nat
structure Tab2 where
  app : Nat → Nat → Nat
instance : CoeFun Tab (fun _ => Nat → Nat) := ⟨Tab.app⟩
instance : CoeFun Tab2 (fun _ => Nat → Nat → Nat) := ⟨Tab2.app⟩

/-- The day's ledger: the (spell, caster) pairs spent, what each pair paid the author (`given`) and the
    parent (`pgiven`), and each wizard's earnings today. -/
structure Ledger where
  paid : List (Nat × Nat)
  given : Tab2
  pgiven : Tab2
  earned : Tab

def Ledger.empty : Ledger := ⟨[], ⟨fun _ _ => 0⟩, ⟨fun _ _ => 0⟩, ⟨fun _ => 0⟩⟩

@[noinline] def upd (f : Tab) (k v : Nat) : Tab := ⟨fun x => if x = k then v else f x⟩
@[noinline] def upd2 (f : Tab2) (s c v : Nat) : Tab2 := ⟨fun x y => if x = s ∧ y = c then v else f x y⟩

/-- Pay `a` up to `share` under the cap. -/
def bump (cap share : Nat) (f : Tab) (a : Nat) : Tab := upd f a (f a + royaltyGrant (f a) share cap)

/-- The parent who may be paid: not the caster, not the author. -/
def parentOf (e : RCast) : Option Nat :=
  match e.parent with
  | some p => if p = e.caster ∨ p = e.author then none else some p
  | none => none

def authorGrant (cap : Nat) (d : Ledger) (e : RCast) : Nat :=
  if e.caster = e.author then 0 else royaltyGrant (d.earned e.author) MARKET_AUTHOR_TENTHS cap
def afterAuthor (cap : Nat) (d : Ledger) (e : RCast) : Tab :=
  if e.caster = e.author then d.earned else bump cap MARKET_AUTHOR_TENTHS d.earned e.author
def parentGrant (cap : Nat) (f : Tab) : Option Nat → Nat
  | some p => royaltyGrant (f p) MARKET_PARENT_TENTHS cap
  | none => 0
def afterParent (cap : Nat) (f : Tab) : Option Nat → Tab
  | some p => bump cap MARKET_PARENT_TENTHS f p
  | none => f

/-- Nothing to do: an NPC, nobody but the caster to pay, or this pair already paid today. -/
def skip (d : Ledger) (e : RCast) : Bool :=
  e.npc || (decide (e.caster = e.author) && (parentOf e).isNone) || decide ((e.spell, e.caster) ∈ d.paid)

/-- market.ts `royaltyStep`. -/
def royaltyStep (cap : Nat) (d : Ledger) (e : RCast) : Ledger :=
  if skip d e then d
  else
    let f := afterAuthor cap d e
    { paid := (e.spell, e.caster) :: d.paid,
      given := upd2 d.given e.spell e.caster (d.given e.spell e.caster + authorGrant cap d e),
      pgiven := upd2 d.pgiven e.spell e.caster (d.pgiven e.spell e.caster + parentGrant cap f (parentOf e)),
      earned := afterParent cap f (parentOf e) }

/-- A day of casts. -/
def runDay (cap : Nat) (es : List RCast) : Ledger := es.foldl (royaltyStep cap) Ledger.empty

/-- What stays true all day. -/
def Good (cap : Nat) (d : Ledger) : Prop :=
  (∀ a, d.earned a ≤ cap) ∧ (∀ s c, d.given s c ≤ MARKET_AUTHOR_TENTHS) ∧ (∀ s c, d.pgiven s c ≤ MARKET_PARENT_TENTHS)
  ∧ (∀ s c, (s, c) ∉ d.paid → d.given s c = 0 ∧ d.pgiven s c = 0)

theorem bump_le {cap share : Nat} {f : Tab} (a : Nat) (h : ∀ x, f x ≤ cap) : ∀ x, bump cap share f a x ≤ cap := by
  intro x; simp only [bump, upd]
  split
  · exact royalty_grant_cap share (h a)
  · exact h x

theorem bump_other {cap share : Nat} {f : Tab} {a x : Nat} (hx : x ≠ a) : bump cap share f a x = f x := by
  simp [bump, upd, hx]

theorem afterAuthor_le {cap : Nat} {d : Ledger} (e : RCast) (h : ∀ x, d.earned x ≤ cap) : ∀ x, afterAuthor cap d e x ≤ cap := by
  unfold afterAuthor; split
  · exact h
  · exact bump_le _ h

theorem afterParent_le {cap : Nat} {f : Tab} (o : Option Nat) (h : ∀ x, f x ≤ cap) : ∀ x, afterParent cap f o x ≤ cap := by
  cases o with
  | none => exact h
  | some p => exact bump_le p h

theorem authorGrant_le (cap : Nat) (d : Ledger) (e : RCast) : authorGrant cap d e ≤ MARKET_AUTHOR_TENTHS := by
  unfold authorGrant; split
  · exact Nat.zero_le _
  · exact royalty_grant_le _ _ _

theorem parentGrant_le (cap : Nat) (f : Tab) (o : Option Nat) : parentGrant cap f o ≤ MARKET_PARENT_TENTHS := by
  cases o with
  | none => exact Nat.zero_le _
  | some p => exact royalty_grant_le _ _ _

theorem step_good {cap : Nat} {d : Ledger} (e : RCast) (h : Good cap d) : Good cap (royaltyStep cap d e) := by
  obtain ⟨h1, h2, h3, h4⟩ := h
  unfold royaltyStep
  split
  · exact ⟨h1, h2, h3, h4⟩
  · rename_i hs
    have hk : (e.spell, e.caster) ∉ d.paid := by
      intro m; apply hs; unfold skip; simp [m]
    have ⟨g0, p0⟩ := h4 _ _ hk
    refine ⟨afterParent_le _ (afterAuthor_le e h1), ?_, ?_, ?_⟩
    · intro s c; simp only [upd2]; split
      · rename_i hsc; obtain ⟨rfl, rfl⟩ := hsc; rw [g0]; simpa using authorGrant_le cap d e
      · exact h2 s c
    · intro s c; simp only [upd2]; split
      · rename_i hsc; obtain ⟨rfl, rfl⟩ := hsc; rw [p0]; simpa using parentGrant_le cap _ _
      · exact h3 s c
    · intro s c hn
      have hne : ¬ (s = e.spell ∧ c = e.caster) := by
        rintro ⟨rfl, rfl⟩; exact hn (List.mem_cons_self ..)
      have hn' : (s, c) ∉ d.paid := fun m => hn (List.mem_cons_of_mem _ m)
      simp only [upd2, hne, if_false]
      exact h4 s c hn'

theorem good_empty (cap : Nat) : Good cap Ledger.empty :=
  ⟨fun _ => Nat.zero_le _, fun _ _ => Nat.zero_le _, fun _ _ => Nat.zero_le _, fun _ _ _ => ⟨rfl, rfl⟩⟩

theorem good_foldl {cap : Nat} (es : List RCast) : ∀ d, Good cap d → Good cap (es.foldl (royaltyStep cap) d) := by
  induction es with
  | nil => intro d h; exact h
  | cons e es ih => intro d h; exact ih _ (step_good e h)

theorem good_run (cap : Nat) (es : List RCast) : Good cap (runDay cap es) := good_foldl es _ (good_empty cap)

/-- royalty_day_capped: whatever the day's casts, nobody earns more than the cap from royalties. -/
theorem royalty_day_capped (cap : Nat) (es : List RCast) (a : Nat) : (runDay cap es).earned a ≤ cap := (good_run cap es).1 a
/-- royalty_per_pair: one caster casting one spell any number of times pays its author at most one point a day. -/
theorem royalty_per_pair (cap : Nat) (es : List RCast) (s c : Nat) : (runDay cap es).given s c ≤ MARKET_AUTHOR_TENTHS := (good_run cap es).2.1 s c
theorem royalty_parent_per_pair (cap : Nat) (es : List RCast) (s c : Nat) : (runDay cap es).pgiven s c ≤ MARKET_PARENT_TENTHS := (good_run cap es).2.2.1 s c
/-- In reputation points: at most `dailyCap` a day (the cap in tenths is dailyCap · 10), at most 1 per pair. -/
theorem royalty_points (dailyCap : Nat) (es : List RCast) (a s c : Nat) :
    (runDay (dailyCap * 10) es).earned a ≤ dailyCap * 10 ∧ (runDay (dailyCap * 10) es).given s c ≤ 1 * 10 :=
  ⟨royalty_day_capped _ es a, royalty_per_pair _ es s c⟩

/-- royalty_npc: an NPC's (or a fresh enrolee's) cast changes nothing. -/
theorem royalty_npc (cap : Nat) (d : Ledger) (e : RCast) (h : e.npc = true) : royaltyStep cap d e = d := by
  unfold royaltyStep skip; simp [h]

/-- royalty_not_self: a cast never pays its caster. -/
theorem royalty_not_self (cap : Nat) (d : Ledger) (e : RCast) : (royaltyStep cap d e).earned e.caster = d.earned e.caster := by
  unfold royaltyStep; split
  · rfl
  · have hp : ∀ p, parentOf e = some p → e.caster ≠ p := by
      intro p hp; unfold parentOf at hp
      cases h : e.parent with
      | none => simp [h] at hp
      | some q => simp [h] at hp; obtain ⟨⟨h1, _⟩, rfl⟩ := hp; exact fun h => h1 h.symm
    have ha : afterAuthor cap d e e.caster = d.earned e.caster := by
      unfold afterAuthor; split
      · rfl
      · rename_i hne; exact bump_other hne
    show afterParent cap (afterAuthor cap d e) (parentOf e) e.caster = d.earned e.caster
    cases hq : parentOf e with
    | none => simpa [afterParent] using ha
    | some p => simp only [afterParent]; rw [bump_other (hp p hq)]; exact ha

/-- A cast of an already-paid pair pays nothing more. -/
theorem royalty_once (cap : Nat) (d : Ledger) (e : RCast) (h : (e.spell, e.caster) ∈ d.paid) : royaltyStep cap d e = d := by
  unfold royaltyStep skip; simp [h]

/-- The default cap is inside its constitutional bound. -/
theorem market_cap_default_ok : MARKET_CAP_DEFAULT ≤ MARKET_CAP_MAX := by decide

/-- The market part of the vectors: constants, and whole days of pseudo-random casts replayed by the TypeScript. -/
def marketVectors : String :=
  let q (s : String) : String := "\"" ++ s ++ "\""
  let arr (xs : List String) : String := "[" ++ ",".intercalate xs ++ "]"
  let obj (xs : List (String × String)) : String := "{" ++ ",".intercalate (xs.map fun (k, v) => q k ++ ":" ++ v) ++ "}"
  let consts := obj [
    ("MARKET_AUTHOR_TENTHS", toString MARKET_AUTHOR_TENTHS), ("MARKET_PARENT_TENTHS", toString MARKET_PARENT_TENTHS),
    ("MARKET_DAY_S", toString MARKET_DAY_S), ("MARKET_CAP_DEFAULT", toString MARKET_CAP_DEFAULT), ("MARKET_CAP_MAX", toString MARKET_CAP_MAX),
    ("MARKET_ANNOUNCE_S", toString MARKET_ANNOUNCE_S), ("MARKET_MAX_VERSIONS", toString MARKET_MAX_VERSIONS),
    ("MARKET_MAX_PER_AUTHOR", toString MARKET_MAX_PER_AUTHOR), ("MARKET_BAN_MAX", toString MARKET_BAN_MAX), ("MARKET_PROMOTE_MAX", toString MARKET_PROMOTE_MAX)]
  let grants := Id.run do
    let mut out : List String := []
    for e in [0, 3, 10, 19, 20, 25, 60] do
      for s in [3, 10] do
        for c in [0, 5, 20, 26, 200] do
          out := out ++ [s!"[{e},{s},{c},{royaltyGrant e s c}]"]
    return out
  let lcg (x : Nat) : Nat := (x * 1103515245 + 12345) % 2147483648
  let days := Id.run do
    let mut out : List String := []
    let mut x := 2026
    for cap in [0, 5, 13, 25, 40, 200, 500] do
      let mut es : List RCast := []
      for _ in [0:60] do
        x := lcg x; let s := x / 65536 % 6
        x := lcg x; let c := x / 65536 % 7
        x := lcg x; let a := x / 65536 % 5
        x := lcg x; let pr := x / 65536 % 9
        x := lcg x; let n := x / 65536 % 11
        es := es ++ [⟨s, c, a, if pr < 6 then none else some (pr - 6), n == 0⟩]
      let d := runDay cap es
      let evs := es.map fun e => s!"[{e.spell},{e.caster},{e.author},{match e.parent with | some p => (p : Int) | none => (-1 : Int)},{if e.npc then 1 else 0}]"
      let earned := (List.range 7).map fun a => toString (d.earned a)
      let given := Id.run do
        let mut g : List String := []
        for s in List.range 6 do
          for c in List.range 7 do
            if d.given s c + d.pgiven s c > 0 then g := g ++ [s!"[{s},{c},{d.given s c},{d.pgiven s c}]"]
        return g
      out := out ++ [obj [("cap", toString cap), ("casts", arr evs), ("earned", arr earned), ("given", arr given)]]
    return out
  obj [("constants", consts), ("royaltyGrant", arr grants), ("days", arr days)]

/-! ## 学院杯 — the house-point ledger (src/kernel/housecup.ts, README 学院杯)

Every house point a wizard earns in a term, from any source, goes through `cupAward`: multiplied in the final
minute (`cupMult`, bounded by the rulebook's constitution CUP_MULT_MAX), and capped per wizard per term (the cap is
`rules.terms.wizardPointsCap`). Filch takes points away with `cupDeduct`, never below zero. Proved: a term's
ledger never exceeds the cap whatever happens in it (`cup_term_bounded`), an award never lowers it
(`cup_award_mono`) and adds at most n · CUP_MULT_MAX (`cup_award_gain`), a deduction never goes below zero — also
over the integers (`cup_deduct_nonneg`), the final-minute multiplier stays in [1, CUP_MULT_MAX] whatever a decree
says (`cup_mult_bounded`), and a house of k wizards holds at most k · cap + the 十分梗 cap (`house_points_bounded`).
Vectors: samples of each function and whole terms of pseudo-random awards and deductions, replayed by the
TypeScript `cupRun`. -/

def CUP_FINAL_S : Nat := 60
def CUP_MULT_DEFAULT : Nat := 2
def CUP_MULT_MAX : Nat := 3
def CUP_CAP_DEFAULT : Nat := 400
def CUP_CAP_MIN : Nat := 50
def CUP_CAP_MAX : Nat := 5000
def SNITCH_POINTS : Nat := 150
def SNITCH_CAP_PER_TERM : Nat := 150
def CURFEW_PENALTY : Nat := 5
def EVENT_MAX_S : Nat := 150
def EVENT_INTERVAL_MIN : Nat := 60
def EVENT_INTERVAL_DEFAULT : Nat := 180
def EVENT_INTERVAL_MAX : Nat := 1800
/-- "Ten points to Ravenclaw!": the most one house can receive that way in a term (lore/memes.ts MEME.HOUSE_POINTS_CAP). -/
def TEN_POINTS_CAP : Nat := 100

/-- housecup.ts `cupMult`: `mult` clamped to [1, CUP_MULT_MAX] in the last `finalS` seconds, else 1. -/
def cupMult (left finalS mult : Nat) : Nat := if left ≤ finalS then min CUP_MULT_MAX (max 1 mult) else 1

theorem cup_mult_bounded (left finalS mult : Nat) : 1 ≤ cupMult left finalS mult ∧ cupMult left finalS mult ≤ CUP_MULT_MAX := by
  unfold cupMult CUP_MULT_MAX; split
  · constructor
    · simp only [Nat.le_min]; omega
    · exact Nat.min_le_left _ _
  · omega

/-- Outside the final minute nothing is multiplied. -/
theorem cup_mult_outside (left finalS mult : Nat) (h : finalS < left) : cupMult left finalS mult = 1 := by
  unfold cupMult; simp; omega

/-- housecup.ts `cupAward`: add n at multiplier m under the cap; a ledger at or over the cap gains nothing. -/
def cupAward (cur n cap m : Nat) : Nat := if n = 0 ∨ cap ≤ cur then cur else min cap (cur + n * m)

theorem cup_award_capped (cur n cap m : Nat) (h : cur ≤ cap) : cupAward cur n cap m ≤ cap := by
  unfold cupAward; split
  · exact h
  · exact Nat.min_le_left _ _

theorem cup_award_mono (cur n cap m : Nat) : cur ≤ cupAward cur n cap m := by
  unfold cupAward; split
  · exact Nat.le_refl _
  · rename_i h; simp only [Nat.le_min]; constructor <;> omega

theorem cup_award_gain (cur n cap m : Nat) : cupAward cur n cap m ≤ cur + n * m := by
  unfold cupAward; split
  · omega
  · exact Nat.min_le_right _ _

/-- With the rulebook's multiplier, one award adds at most n · CUP_MULT_MAX. -/
theorem cup_final_minute_gain (cur n cap left finalS mult : Nat) :
    cupAward cur n cap (cupMult left finalS mult) ≤ cur + n * CUP_MULT_MAX := by
  have h1 := cup_award_gain cur n cap (cupMult left finalS mult)
  have h2 := (cup_mult_bounded left finalS mult).2
  have h3 : n * cupMult left finalS mult ≤ n * CUP_MULT_MAX := Nat.mul_le_mul_left n h2
  omega

/-- housecup.ts `cupDeduct` over the natural numbers (truncated subtraction). -/
def cupDeduct (cur n : Nat) : Nat := cur - n

/-- And over the integers, as the TypeScript computes it: `max(0, cur − max(0, n))` — never negative. -/
def cupDeductI (cur n : Int) : Int := max 0 (cur - max 0 n)
theorem cup_deduct_nonneg (cur n : Int) : 0 ≤ cupDeductI cur n := by unfold cupDeductI; omega
theorem cup_deduct_le (cur n : Int) (h : 0 ≤ cur) : cupDeductI cur n ≤ cur := by unfold cupDeductI; omega
theorem cup_deduct_agrees (cur n : Nat) : cupDeductI cur n = (cupDeduct cur n : Int) := by unfold cupDeductI cupDeduct; omega

/-- One operation on a ledger. -/
inductive CupOp where
  | award (n m : Nat)
  | deduct (n : Nat)

/-- housecup.ts `cupStep` / `cupRun`: a whole term from an empty ledger. -/
def cupStep (cap : Nat) (cur : Nat) : CupOp → Nat
  | .award n m => cupAward cur n cap m
  | .deduct n => cupDeduct cur n
def cupRun (cap : Nat) (ops : List CupOp) : Nat := ops.foldl (cupStep cap) 0

theorem cup_step_capped (cap cur : Nat) (op : CupOp) (h : cur ≤ cap) : cupStep cap cur op ≤ cap := by
  cases op with
  | award n m => exact cup_award_capped cur n cap m h
  | deduct n => show cupDeduct cur n ≤ cap; unfold cupDeduct; omega

theorem cup_foldl_capped (cap : Nat) (ops : List CupOp) : ∀ cur, cur ≤ cap → ops.foldl (cupStep cap) cur ≤ cap := by
  induction ops with
  | nil => intro cur h; exact h
  | cons op ops ih => intro cur h; exact ih _ (cup_step_capped cap cur op h)

/-- cup_term_bounded: whatever happens in a term, one wizard's house points stay within [0, cap]. -/
theorem cup_term_bounded (cap : Nat) (ops : List CupOp) : cupRun cap ops ≤ cap :=
  cup_foldl_capped cap ops 0 (Nat.zero_le _)

/-- A house: its members' ledgers plus the 十分梗 bonus (itself ≤ TEN_POINTS_CAP). -/
def housePoints (ledgers : List Nat) (ten : Nat) : Nat := ledgers.foldl (· + ·) 0 + ten

theorem foldl_sum_bounded (cap : Nat) : ∀ (ls : List Nat) (acc : Nat), (∀ x ∈ ls, x ≤ cap) → ls.foldl (· + ·) acc ≤ acc + ls.length * cap := by
  intro ls
  induction ls with
  | nil => intro acc _; simp
  | cons x xs ih =>
    intro acc h
    have hx := h x (List.mem_cons_self ..)
    have := ih (acc + x) (fun y hy => h y (List.mem_cons_of_mem _ hy))
    simp only [List.foldl_cons, List.length_cons]
    rw [Nat.succ_mul]; omega

/-- house_points_bounded: a house of k wizards, each playing any term, holds at most k · cap + TEN_POINTS_CAP. -/
theorem house_points_bounded (cap ten : Nat) (terms : List (List CupOp)) (hten : ten ≤ TEN_POINTS_CAP) :
    housePoints (terms.map (cupRun cap)) ten ≤ terms.length * cap + TEN_POINTS_CAP := by
  unfold housePoints
  have := foldl_sum_bounded cap (terms.map (cupRun cap)) 0 (by
    intro x hx; simp only [List.mem_map] at hx; obtain ⟨o, _, rfl⟩ := hx; exact cup_term_bounded cap o)
  simp only [List.length_map] at this; omega

/-- The constitution: the defaults are inside their bounds, and the snitch fits its cap. -/
theorem cup_defaults_ok : CUP_MULT_DEFAULT ≤ CUP_MULT_MAX ∧ 1 ≤ CUP_MULT_DEFAULT ∧ CUP_CAP_MIN ≤ CUP_CAP_DEFAULT ∧ CUP_CAP_DEFAULT ≤ CUP_CAP_MAX
    ∧ SNITCH_POINTS ≤ SNITCH_CAP_PER_TERM ∧ EVENT_MAX_S < EVENT_INTERVAL_DEFAULT ∧ EVENT_INTERVAL_MIN ≤ EVENT_INTERVAL_DEFAULT ∧ EVENT_INTERVAL_DEFAULT ≤ EVENT_INTERVAL_MAX := by decide

/-- The 学院杯 part of the vectors: constants, samples of each function, and whole terms of pseudo-random operations. -/
def cupVectors : String :=
  let q (s : String) : String := "\"" ++ s ++ "\""
  let arr (xs : List String) : String := "[" ++ ",".intercalate xs ++ "]"
  let obj (xs : List (String × String)) : String := "{" ++ ",".intercalate (xs.map fun (k, v) => q k ++ ":" ++ v) ++ "}"
  let consts := obj [
    ("CUP_FINAL_S", toString CUP_FINAL_S), ("CUP_MULT_DEFAULT", toString CUP_MULT_DEFAULT), ("CUP_MULT_MAX", toString CUP_MULT_MAX),
    ("CUP_CAP_DEFAULT", toString CUP_CAP_DEFAULT), ("CUP_CAP_MIN", toString CUP_CAP_MIN), ("CUP_CAP_MAX", toString CUP_CAP_MAX),
    ("SNITCH_POINTS", toString SNITCH_POINTS), ("SNITCH_CAP_PER_TERM", toString SNITCH_CAP_PER_TERM), ("CURFEW_PENALTY", toString CURFEW_PENALTY),
    ("EVENT_MAX_S", toString EVENT_MAX_S), ("EVENT_INTERVAL_MIN", toString EVENT_INTERVAL_MIN), ("EVENT_INTERVAL_DEFAULT", toString EVENT_INTERVAL_DEFAULT),
    ("EVENT_INTERVAL_MAX", toString EVENT_INTERVAL_MAX), ("TEN_POINTS_CAP", toString TEN_POINTS_CAP)]
  let mults := Id.run do
    let mut out : List String := []
    for l in [0, 30, 59, 60, 61, 900] do
      for m in [0, 1, 2, 3, 7] do
        out := out ++ [s!"[{l},{CUP_FINAL_S},{m},{cupMult l CUP_FINAL_S m}]"]
    return out
  let awards := Id.run do
    let mut out : List String := []
    for c in [0, 5, 399, 400, 450] do
      for n in [0, 1, 10, 150] do
        for m in [1, 2, 3] do
          out := out ++ [s!"[{c},{n},400,{m},{cupAward c n 400 m}]"]
    return out
  let deducts := Id.run do
    let mut out : List String := []
    for c in [0, 3, 5, 40] do
      for n in [0, 5, 100] do
        out := out ++ [s!"[{c},{n},{cupDeduct c n}]"]
    return out
  let lcg (x : Nat) : Nat := (x * 1103515245 + 12345) % 2147483648
  let terms := Id.run do
    let mut out : List String := []
    let mut x := 1991
    for cap in [50, 100, 400, 1000] do
      let mut ops : List CupOp := []
      let mut enc : List String := []
      for _ in [0:80] do
        x := lcg x; let k := x / 65536 % 5
        x := lcg x; let n := x / 65536 % 61
        x := lcg x; let m := 1 + x / 65536 % 3
        if k == 0 then
          ops := ops ++ [CupOp.deduct (n % 11)]; enc := enc ++ [s!"[1,{n % 11},0]"]
        else
          ops := ops ++ [CupOp.award n m]; enc := enc ++ [s!"[0,{n},{m}]"]
      out := out ++ [obj [("cap", toString cap), ("ops", arr enc), ("final", toString (cupRun cap ops))]]
    return out
  obj [("constants", consts), ("cupMult", arr mults), ("cupAward", arr awards), ("cupDeduct", arr deducts), ("terms", arr terms)]

/-! ## 决斗俱乐部 — the Duelling Club's rewards (src/kernel/duelclub.ts `duelStep`, `duelGrant`)

A finished match counts for the winner only when it is fresh (against a player, not a rematch of the same pair
within DUEL_PAIR_GAP_S) and the winner is still under the term's cap of rewarded wins; a counted win pays
DUEL_WIN_REP reputation, anything else nothing. Proved: the count never passes the cap (`duel_step_capped`), a
step pays DUEL_WIN_REP exactly when it counts and 0 otherwise (`duel_step_pay`), and whatever sequence of matches
a term holds, a wizard's Duelling-Club reputation is at most cap · DUEL_WIN_REP (`duel_club_term_bounded`).
The rematch gap and the NPC rule feed the `fresh` flag; the TypeScript test checks that flag on its own. -/

def DUEL_WIN_REP : Nat := 6
def DUEL_TERM_CAP : Nat := 5

/-- duelclub.ts `duelStep`: (wins', reputation paid). -/
def duelStep (wins cap : Nat) (fresh : Bool) : Nat × Nat :=
  if fresh ∧ wins < cap then (wins + 1, DUEL_WIN_REP) else (wins, 0)

theorem duel_step_capped (wins cap : Nat) (fresh : Bool) (h : wins ≤ cap) : (duelStep wins cap fresh).1 ≤ cap := by
  unfold duelStep; split
  · rename_i hc; omega
  · exact h

theorem duel_step_pay (wins cap : Nat) (fresh : Bool) :
    (duelStep wins cap fresh).2 = ((duelStep wins cap fresh).1 - wins) * DUEL_WIN_REP := by
  unfold duelStep; split <;> simp [DUEL_WIN_REP]

/-- A term: the wins count and the reputation paid so far, after each match's `fresh` flag. -/
def duelRun (cap : Nat) (ms : List Bool) : Nat × Nat :=
  ms.foldl (fun (acc : Nat × Nat) f => let s := duelStep acc.1 cap f; (s.1, acc.2 + s.2)) (0, 0)

theorem duel_run_inv (cap : Nat) : ∀ (ms : List Bool) (w r : Nat), w ≤ cap → r = w * DUEL_WIN_REP →
    (ms.foldl (fun (acc : Nat × Nat) f => let s := duelStep acc.1 cap f; (s.1, acc.2 + s.2)) (w, r)).1 ≤ cap ∧
    (ms.foldl (fun (acc : Nat × Nat) f => let s := duelStep acc.1 cap f; (s.1, acc.2 + s.2)) (w, r)).2
      = (ms.foldl (fun (acc : Nat × Nat) f => let s := duelStep acc.1 cap f; (s.1, acc.2 + s.2)) (w, r)).1 * DUEL_WIN_REP := by
  intro ms
  induction ms with
  | nil => intro w r hw hr; exact ⟨hw, hr⟩
  | cons f fs ih =>
    intro w r hw hr
    simp only [List.foldl_cons]
    apply ih
    · exact duel_step_capped w cap f hw
    · unfold duelStep; split
      · rename_i hc; subst hr; simp [DUEL_WIN_REP]; omega
      · simp [hr]

/-- duel_club_term_bounded: whatever a term holds, a wizard's Duelling-Club reputation ≤ cap · DUEL_WIN_REP. -/
theorem duel_club_term_bounded (cap : Nat) (ms : List Bool) : (duelRun cap ms).2 ≤ cap * DUEL_WIN_REP := by
  have ⟨h1, h2⟩ := duel_run_inv cap ms 0 0 (Nat.zero_le _) (by simp)
  unfold duelRun
  rw [h2]
  exact Nat.mul_le_mul_right _ h1

/-- The 决斗俱乐部 part of the vectors: constants, the step on a grid, and whole terms of pseudo-random matches. -/
def duelVectors : String :=
  let q (s : String) : String := "\"" ++ s ++ "\""
  let arr (xs : List String) : String := "[" ++ ",".intercalate xs ++ "]"
  let obj (xs : List (String × String)) : String := "{" ++ ",".intercalate (xs.map fun (k, v) => q k ++ ":" ++ v) ++ "}"
  let b (x : Bool) : String := if x then "1" else "0"
  let steps := Id.run do
    let mut out : List String := []
    for w in [0, 1, 4, 5, 6] do
      for c in [0, 3, 5] do
        for f in [false, true] do
          let s := duelStep w c f
          out := out ++ [s!"[{w},{c},{b f},{s.1},{s.2}]"]
    return out
  let lcg (x : Nat) : Nat := (x * 1103515245 + 12345) % 2147483648
  let terms := Id.run do
    let mut out : List String := []
    let mut x := 2718
    for cap in [0, 3, 5, 9] do
      let mut ms : List Bool := []
      for _ in [0:30] do
        x := lcg x
        ms := ms ++ [x / 65536 % 3 != 0]
      let r := duelRun cap ms
      out := out ++ [obj [("cap", toString cap), ("fresh", arr (ms.map b)), ("wins", toString r.1), ("rep", toString r.2)]]
    return out
  obj [("constants", obj [("DUEL_WIN_REP", toString DUEL_WIN_REP), ("DUEL_TERM_CAP", toString DUEL_TERM_CAP)]), ("step", arr steps), ("terms", arr terms)]


/-! ## 魁地奇 — a match's rewards (src/kernel/quidditch.ts `qdRep`, `qdCup`)

Per player, once a match (one match a term): reputation QD_GOAL_REP per goal for at most QD_GOALS_PAID goals, plus
QD_CATCH_REP for catching the Snitch and QD_WIN_REP for the win; house points ⌊score / 5⌋, at most QD_CUP_MAX.
Proved: both are bounded whatever the match (`qd_rep_bounded`, `qd_cup_bounded`), and more goals or a higher score
never pay less (`qd_rep_mono`, `qd_cup_mono`).
-/

def QD_GOAL_REP : Nat := 2
def QD_GOALS_PAID : Nat := 5
def QD_CATCH_REP : Nat := 10
def QD_WIN_REP : Nat := 5
def QD_CUP_MAX : Nat := 60
def QD_REP_MAX : Nat := QD_GOAL_REP * QD_GOALS_PAID + QD_CATCH_REP + QD_WIN_REP

/-- quidditch.ts `qdRep`. -/
def qdRep (goals : Nat) (caught won : Bool) : Nat :=
  QD_GOAL_REP * min goals QD_GOALS_PAID + (if caught then QD_CATCH_REP else 0) + (if won then QD_WIN_REP else 0)

/-- quidditch.ts `qdCup`. -/
def qdCup (score : Nat) : Nat := min QD_CUP_MAX (score / 5)

theorem qd_rep_bounded (g : Nat) (c w : Bool) : qdRep g c w ≤ QD_REP_MAX := by
  unfold qdRep QD_REP_MAX
  have h1 : QD_GOAL_REP * min g QD_GOALS_PAID ≤ QD_GOAL_REP * QD_GOALS_PAID := Nat.mul_le_mul_left _ (Nat.min_le_right _ _)
  have h2 : (if c = true then QD_CATCH_REP else 0) ≤ QD_CATCH_REP := by split <;> simp
  have h3 : (if w = true then QD_WIN_REP else 0) ≤ QD_WIN_REP := by split <;> simp
  omega

theorem qd_rep_mono (g : Nat) (c w : Bool) : qdRep g c w ≤ qdRep (g + 1) c w := by
  unfold qdRep
  have : min g QD_GOALS_PAID ≤ min (g + 1) QD_GOALS_PAID := by omega
  have := Nat.mul_le_mul_left QD_GOAL_REP this
  omega

theorem qd_cup_bounded (s : Nat) : qdCup s ≤ QD_CUP_MAX := Nat.min_le_left _ _

theorem qd_cup_mono (s t : Nat) (h : s ≤ t) : qdCup s ≤ qdCup t := by
  unfold qdCup
  have : s / 5 ≤ t / 5 := Nat.div_le_div_right h
  omega

/-- The 魁地奇 part of the vectors: constants, qdRep on a grid, qdCup on a range. -/
def qdVectors : String :=
  let b (x : Bool) : String := if x then "1" else "0"
  let reps := Id.run do
    let mut out : List String := []
    for g in [0, 1, 2, 4, 5, 6, 9, 30] do
      for c in [false, true] do
        for w in [false, true] do
          out := out ++ [s!"[{g},{b c},{b w},{qdRep g c w}]"]
    return out
  let cups := (List.range 80).map fun i => let sc := i * 7; s!"[{sc},{qdCup sc}]"
  "{\"constants\":{\"QD_GOAL_REP\":" ++ toString QD_GOAL_REP ++ ",\"QD_GOALS_PAID\":" ++ toString QD_GOALS_PAID ++ ",\"QD_CATCH_REP\":" ++ toString QD_CATCH_REP ++
    ",\"QD_WIN_REP\":" ++ toString QD_WIN_REP ++ ",\"QD_CUP_MAX\":" ++ toString QD_CUP_MAX ++ ",\"QD_REP_MAX\":" ++ toString QD_REP_MAX ++ "},\"rep\":[" ++ ",".intercalate reps ++ "],\"cup\":[" ++ ",".intercalate cups ++ "]}"
/-! ## Conformance vectors (compared with the TypeScript code in test/formal.test.ts) -/

/-- The agent-link part of the vectors: every shared constant, and samples of each floor/cost function. -/
def agentLinkVectors : String :=
  let q (s : String) : String := "\"" ++ s ++ "\""
  let arr (xs : List String) : String := "[" ++ ",".intercalate xs ++ "]"
  let obj (xs : List (String × String)) : String := "{" ++ ",".intercalate (xs.map fun (k, v) => q k ++ ":" ++ v) ++ "}"
  let consts := obj [
    ("PAIR_ALPHABET_LEN", toString PAIR_ALPHABET_LEN), ("PAIR_LEN", toString PAIR_LEN), ("PAIR_SPACE", toString pairSpace),
    ("PAIR_TTL_S", toString PAIR_TTL_S), ("PAIR_FAIL_PER_IP_PER_MIN", toString PAIR_FAIL_PER_IP_PER_MIN),
    ("PAIR_FAIL_PER_REALM_PER_MIN", toString PAIR_FAIL_PER_REALM_PER_MIN), ("LOGIN_FAIL_PER_IP_PER_MIN", toString LOGIN_FAIL_PER_IP_PER_MIN),
    ("HP_FLOOR", toString HP_FLOOR), ("HP_FLOOR_PCT", toString HP_FLOOR_PCT), ("MANA_FLOOR", toString MANA_FLOOR),
    ("MANA_FLOOR_PCT", toString MANA_FLOOR_PCT), ("MANAREGEN_FLOOR_PCT", toString MANAREGEN_FLOOR_PCT),
    ("SPEED_FLOOR_PCT", toString SPEED_FLOOR_PCT), ("MOVE_SLOW_FLOOR_PCT", toString MOVE_SLOW_FLOOR_PCT),
    ("POWER_FLOOR_PCT", toString POWER_FLOOR_PCT), ("WARD_MIN_PCT", toString WARD_MIN_PCT), ("WARD_MAX_PCT", toString WARD_MAX_PCT),
    ("HEX_HP_FLOOR_PCT", toString HEX_HP_FLOOR_PCT), ("HEX_MALICE_TAX", toString HEX_MALICE_TAX),
    ("CURSED_ITEM_BIND_S", toString CURSED_ITEM_BIND_S), ("HEX_MIN_YEAR", toString HEX_MIN_YEAR),
    ("HEX_PAIR_COOLDOWN_S", toString HEX_PAIR_COOLDOWN_S), ("VICTIM_HEX_CAP", toString VICTIM_HEX_CAP),
    ("VICTIM_CURSED_ITEMS_MAX", toString VICTIM_CURSED_ITEMS_MAX), ("VICTIM_BOUND_CAP", toString VICTIM_BOUND_CAP),
    ("VICTIM_HEX_PER_10MIN", toString VICTIM_HEX_PER_10MIN), ("HEX_WINDOW_S", toString HEX_WINDOW_S),
    ("HEX_RESPITE_S", toString HEX_RESPITE_S), ("SILENCE_MAX_S", toString SILENCE_MAX_S),
    ("SILENCE_COOLDOWN_S", toString SILENCE_COOLDOWN_S), ("FORGE_FAIL_PER_MIN", toString FORGE_FAIL_PER_MIN),
    ("OWLBOX_MAX", toString OWLBOX_MAX), ("OWL_MAX_CHARS", toString OWL_MAX_CHARS), ("OWL_PER_MIN", toString OWL_PER_MIN),
    ("ASK_TTL_S", toString ASK_TTL_S), ("LISTEN_MAX_S", toString LISTEN_MAX_S), ("PLAYER_GRACE_S", toString PLAYER_GRACE_S)]
  let negs := obj (NEG_LIMITS.map fun (k, v) => (k, toString v))
  let jinx := obj (JINX_DEFAULTS.map fun (k, m, s) => (k, s!"[{m},{s}]"))
  let hpF := [1, 2, 3, 4, 5, 6, 7].map fun y => s!"[{y},{hpFloor y}]"
  let maxHp := Id.run do
    let mut out : List String := []
    for y in [1, 2, 4, 7] do
      for m in ([-500, -45, -30, -10, 0, 25] : List Int) do
        out := out ++ [s!"[{y},{m},{maxHpOf y m}]"]
    return out
  let maxMana := Id.run do
    let mut out : List String := []
    for b in ([50, 100, 160, 220] : List Int) do
      for m in ([-500, -30, -10, 0, 30] : List Int) do
        out := out ++ [s!"[{b},{m},{maxManaOf b m}]"]
    return out
  let regen := Id.run do
    let mut out : List String := []
    for r in ([10, 70, 400] : List Int) do
      for m in ([-500, -30, 0, 30] : List Int) do
        for c in ([0, 15] : List Int) do
          out := out ++ [s!"[{r},{m},{c},{manaRegenOf r m c}]"]
    return out
  let speed := ([-500, -60, -50, -20, 0, 25] : List Int).map fun m => s!"[{m},{speedPct m}]"
  let power := ([-500, -80, -75, -15, 0, 8, 45] : List Int).map fun p => s!"[{p},{powerPct p}]"
  let ward := ([-500, -25, -20, 0, 20, 70] : List Int).map fun w => s!"[{w},{wardPct w}]"
  let slow := Id.run do
    let mut out : List String := []
    for c in ([0, 30, 40, 60] : List Int) do
      for j in ([0, 40] : List Int) do
        out := out ++ [s!"[{c},{j},{moveSlowPct c j}]"]
    return out
  let hexF := [1, 3, 4, 40, 100, 115, 190, 277].map fun mh => s!"[{mh},{hexFloor mh}]"
  let hexD := Id.run do
    let mut out : List String := []
    for hp in [0, 1, 10, 25, 26, 60, 190] do
      for mh in [100, 190] do
        for d in [0, 1, 3, 50, 1000] do
          out := out ++ [s!"[{hp},{mh},{d},{hexDot hp mh d}]"]
    return out
  let hexC := [0, 1, 2, 8, 14, 34].map fun p => s!"[{p},{hexCost p}]"
  let hexT := Id.run do
    let mut out : List String := []
    for r in [0, 3, 30] do
      for s in [0, 2, 3, 4, 30, 37] do
        out := out ++ [s!"[{r},{s},{hexTick r s}]"]
    return out
  obj [("constants", consts), ("negLimits", negs), ("jinxDefaults", jinx), ("hpFloor", arr hpF), ("maxHp", arr maxHp),
    ("maxMana", arr maxMana), ("manaRegen", arr regen), ("speed", arr speed), ("power", arr power), ("ward", arr ward),
    ("moveSlow", arr slow), ("hexFloor", arr hexF), ("hexDot", arr hexD), ("hexCost", arr hexC),
    ("hexTick", arr hexT), ("longestHex", toString longestHex)]


/-! ## 魔法部长 — who takes office at the end of a term (src/kernel/progression.ts `electMinister`, World.endTerm)

The highest-reputation candidate not barred with at least the bar becomes Minister; ties go to the earlier wizard.
Barred (the Bool, `npc` below): an NPC, or a player not seen this term (World.ministerElect). NPCs stand on
the leaderboard but never hold office, nor does an absentee (formal/tla/TermDecree.tla `NPCsNeverRule`, `MinisterIsPlayer`, `MinisterWasPresent`). Proved: the
Minister is a player who reached the bar (`elect_never_npc`), has at least every player's reputation, NPCs not
counted (`elect_top_player`), and the post stays vacant only when no player reaches the bar (`elect_vacant`). -/

/-- progression.ts `electMinister`'s scan: (index, reputation) of the first highest-reputation *player* (npc = false). -/
def bestPlayer : List (Nat × Bool) → Option (Nat × Nat)
  | [] => none
  | (r, npc) :: t =>
    let rest := (bestPlayer t).map fun (p : Nat × Nat) => (p.1 + 1, p.2)
    if npc then rest
    else match rest with
      | some (i, r') => if r < r' then some (i, r') else some (0, r)
      | none => some (0, r)

/-- progression.ts `electMinister`: the index of the Minister, or none for a vacant post. -/
def electMinister (cs : List (Nat × Bool)) (bar : Nat) : Option Nat :=
  match bestPlayer cs with
  | some (i, r) => if bar ≤ r then some i else none
  | none => none

theorem best_player_is_player : ∀ (cs : List (Nat × Bool)) (i r : Nat), bestPlayer cs = some (i, r) → cs[i]? = some (r, false) := by
  intro cs
  induction cs with
  | nil => intro i r h; simp [bestPlayer] at h
  | cons c t ih =>
    intro i r h
    obtain ⟨r0, npc⟩ := c
    cases hb : bestPlayer t with
    | none =>
      cases npc <;> simp [bestPlayer, hb] at h
      obtain ⟨rfl, rfl⟩ := h; simp
    | some p =>
      obtain ⟨j, rj⟩ := p
      have hj := ih j rj hb
      cases npc
      · by_cases hlt : r0 < rj
        · simp [bestPlayer, hb, hlt] at h; obtain ⟨rfl, rfl⟩ := h; simpa using hj
        · simp [bestPlayer, hb, hlt] at h; obtain ⟨rfl, rfl⟩ := h; simp
      · simp [bestPlayer, hb] at h; obtain ⟨rfl, rfl⟩ := h; simpa using hj

theorem best_player_none : ∀ (cs : List (Nat × Bool)), bestPlayer cs = none → ∀ (k r : Nat), cs[k]? ≠ some (r, false) := by
  intro cs
  induction cs with
  | nil => intro _ k r; simp
  | cons c t ih =>
    intro h k r
    obtain ⟨r0, npc⟩ := c
    cases hb : bestPlayer t with
    | none =>
      cases npc
      · simp [bestPlayer, hb] at h
      · cases k with
        | zero => simp
        | succ m => simpa using ih hb m r
    | some p =>
      obtain ⟨j, rj⟩ := p
      cases npc
      · by_cases hlt : r0 < rj <;> simp [bestPlayer, hb, hlt] at h
      · simp [bestPlayer, hb] at h

theorem best_player_top : ∀ (cs : List (Nat × Bool)) (i r : Nat), bestPlayer cs = some (i, r) →
    ∀ (j r' : Nat), cs[j]? = some (r', false) → r' ≤ r := by
  intro cs
  induction cs with
  | nil => intro i r h; simp [bestPlayer] at h
  | cons c t ih =>
    intro i r h j r' hj
    obtain ⟨r0, npc⟩ := c
    cases hb : bestPlayer t with
    | none =>
      cases npc <;> simp [bestPlayer, hb] at h
      obtain ⟨rfl, rfl⟩ := h
      cases j with
      | zero => simp at hj; omega
      | succ k => simp at hj; exact (best_player_none t hb k r' hj).elim
    | some p =>
      obtain ⟨k, rk⟩ := p
      have htop := ih k rk hb
      cases npc
      · by_cases hlt : r0 < rk
        · simp [bestPlayer, hb, hlt] at h; obtain ⟨rfl, rfl⟩ := h
          cases j with
          | zero => simp at hj; omega
          | succ m => simp at hj; exact htop m r' hj
        · simp [bestPlayer, hb, hlt] at h; obtain ⟨rfl, rfl⟩ := h
          cases j with
          | zero => simp at hj; omega
          | succ m => simp at hj; have := htop m r' hj; omega
      · simp [bestPlayer, hb] at h; obtain ⟨rfl, rfl⟩ := h
        cases j with
        | zero => simp at hj
        | succ m => simp at hj; exact htop m r' hj

/-- elect_never_npc: whoever takes office is a player who reached the bar, never an NPC — however far it leads. -/
theorem elect_never_npc (cs : List (Nat × Bool)) (bar i : Nat) (h : electMinister cs bar = some i) :
    ∃ r, cs[i]? = some (r, false) ∧ bar ≤ r := by
  unfold electMinister at h
  cases hb : bestPlayer cs with
  | none => simp [hb] at h
  | some p =>
    obtain ⟨j, r⟩ := p
    simp [hb] at h
    obtain ⟨hbar, rfl⟩ := h
    exact ⟨r, best_player_is_player cs j r hb, hbar⟩

/-- elect_top_player: the Minister has at least the reputation of every player (NPCs do not count). -/
theorem elect_top_player (cs : List (Nat × Bool)) (bar i : Nat) (h : electMinister cs bar = some i) :
    ∃ r, cs[i]? = some (r, false) ∧ ∀ (j r' : Nat), cs[j]? = some (r', false) → r' ≤ r := by
  unfold electMinister at h
  cases hb : bestPlayer cs with
  | none => simp [hb] at h
  | some p =>
    obtain ⟨j, r⟩ := p
    simp [hb] at h
    obtain ⟨_, rfl⟩ := h
    exact ⟨r, best_player_is_player cs j r hb, best_player_top cs j r hb⟩

/-- elect_vacant: the post stays empty only when no player reaches the bar (an NPC never fills it). -/
theorem elect_vacant (cs : List (Nat × Bool)) (bar : Nat) (h : electMinister cs bar = none) :
    ∀ (j r : Nat), cs[j]? = some (r, false) → r < bar := by
  intro j r hj
  unfold electMinister at h
  cases hb : bestPlayer cs with
  | none => exact (best_player_none cs hb j r hj).elim
  | some p =>
    obtain ⟨k, rk⟩ := p
    simp [hb] at h
    have := best_player_top cs k rk hb j r hj
    omega

/-- The 魔法部长 part of the vectors: candidate lists [reputation, npc] with a bar, and the index elected (-1: vacant). -/
def ministerVectors : String :=
  let enc (cs : List (Nat × Bool)) : String := "[" ++ ",".intercalate (cs.map fun (r, n) => s!"[{r},{if n then 1 else 0}]") ++ "]"
  let res (cs : List (Nat × Bool)) (bar : Nat) : String := match electMinister cs bar with | some i => toString i | none => "-1"
  let fixed : List (List (Nat × Bool) × Nat) :=
    [([], 0), ([(40, true)], 3), ([(40, true), (5, false)], 3), ([(40, true), (2, false)], 3), ([(5, false), (5, false)], 1),
     ([(3, false), (9, true), (7, false), (7, false)], 7), ([(0, false)], 0)]
  Id.run do
    let mut out : List String := fixed.map fun (cs, bar) => s!"[{enc cs},{bar},{res cs bar}]"
    let mut seed : Nat := 20260929
    for n in [1, 2, 3, 4, 5, 6, 8] do
      for k in [0, 1, 2, 3] do
        let mut cs : List (Nat × Bool) := []
        for _ in List.range n do
          seed := (seed * 1103515245 + 12345) % 2147483648
          let r := seed / 65536 % 12
          seed := (seed * 1103515245 + 12345) % 2147483648
          cs := cs ++ [(r, seed / 65536 % 3 == 0)]
        out := out ++ [s!"[{enc cs},{k * 3},{res cs (k * 3)}]"]
    return "[" ++ ",".intercalate out ++ "]"

/-! ## 以大欺小 — no glory in bullying (src/kernel/progression.ts `stunPaysRep`, World.stun, duelclub.ts `duelGrant`)

A knock-out (in the open or a Duelling-Club win) pays reputation only when the victim is at most BULLY_YEAR_GAP years
below the victor: then nothing is stolen and nothing is created. Proved: the underdog (or an equal) is always paid
(`stun_pays_underdog`), a victim further up never pays less (`stun_pays_mono`), and a refusal means a gap of more
than BULLY_YEAR_GAP years (`bully_gap`). -/

def BULLY_YEAR_GAP : Nat := 2

/-- progression.ts `stunPaysRep`. -/
def stunPaysRep (killer victim : Nat) : Bool := decide (killer ≤ victim + BULLY_YEAR_GAP)

theorem stun_pays_underdog (k v : Nat) (h : k ≤ v + BULLY_YEAR_GAP) : stunPaysRep k v = true := by
  unfold stunPaysRep; simp [h]

theorem stun_pays_mono (k v v' : Nat) (h : v ≤ v') (hp : stunPaysRep k v = true) : stunPaysRep k v' = true := by
  unfold stunPaysRep at *; simp at *; omega

theorem bully_gap (k v : Nat) (h : stunPaysRep k v = false) : v + BULLY_YEAR_GAP < k := by
  unfold stunPaysRep at h; simp at h; omega

/-- The 以大欺小 part of the vectors: the gap, and [killer year, victim year, pays] over every pair of years. -/
def bullyVectors : String :=
  let rows := Id.run do
    let mut out : List String := []
    for k in [1, 2, 3, 4, 5, 6, 7] do
      for v in [1, 2, 3, 4, 5, 6, 7] do
        out := out ++ [s!"[{k},{v},{if stunPaysRep k v then 1 else 0}]"]
    return out
  "{\"BULLY_YEAR_GAP\":" ++ toString BULLY_YEAR_GAP ++ ",\"pays\":[" ++ ",".intercalate rows ++ "]}"

/-! ## No one-shots (playtest round 3)
No wild creature's single blow takes more than CREATURE_HIT_CAP_PCT % of a wizard's maximum health, however an event
scaled it (`creature_hit_capped`); so from full health it takes at least three blows to knock anyone out
(`creature_two_blows_survive`): there is always a moment to shield, heal or run. src/kernel/world.ts damageInner. -/
def CREATURE_HIT_CAP_PCT : Nat := 40
def creatureHit (a maxHp : Nat) : Nat := min a (maxHp * CREATURE_HIT_CAP_PCT / 100)

theorem creature_hit_capped (a m : Nat) : creatureHit a m ≤ m * CREATURE_HIT_CAP_PCT / 100 := Nat.min_le_right _ _

theorem creature_two_blows_survive (a b m : Nat) (hm : 0 < m) : creatureHit a m + creatureHit b m < m := by
  unfold creatureHit CREATURE_HIT_CAP_PCT; omega

def creatureVectors : String := Id.run do
  let mut out : List String := []
  for a in [0, 7, 28, 40, 100, 140, 1000] do
    for m in [1, 5, 35, 100, 115, 190, 250] do
      out := out ++ [s!"[{a},{m},{creatureHit a m}]"]
  return "{\"CAP_PCT\":" ++ toString CREATURE_HIT_CAP_PCT ++ ",\"hits\":[" ++ ",".intercalate out ++ "]}"

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
    "],\"steal\":[" ++ ",".intercalate steals ++ "],\"agentLink\":" ++ agentLinkVectors ++ ",\"unfair\":" ++ unfairVectors ++ ",\"market\":" ++ marketVectors ++ ",\"cup\":" ++ cupVectors ++ ",\"duel\":" ++ duelVectors ++ ",\"quidditch\":" ++ qdVectors ++ ",\"minister\":" ++ ministerVectors ++ ",\"bully\":" ++ bullyVectors ++ ",\"creature\":" ++ creatureVectors ++ "}"

#eval IO.println ("VECTORS " ++ vectors)

end Hogwarts
