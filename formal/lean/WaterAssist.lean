/-!
Effective Aguamenti cooperation shares the killer's existing XP, never new XP.
Mirrors src/kernel/water-assist.ts; vectors are checked by test/water-assist.test.ts.
-/
namespace WaterAssist

def divisor : Nat := 4
def maximum : Nat := 8
def lifetime : Nat := 60
def reach : Nat := 30

def count (helpers : Nat) : Nat := min maximum helpers
def pool (xp helpers : Nat) : Nat := if count helpers = 0 then 0 else xp / divisor
def killer (xp helpers : Nat) : Nat := xp - pool xp helpers
def part (xp helpers i : Nat) : Nat :=
  let n := count helpers
  if n = 0 then 0 else xp / divisor / n + if i < xp / divisor % n then 1 else 0

theorem count_bounded (helpers : Nat) : count helpers ≤ 8 := by
  exact Nat.min_le_left _ _

theorem pool_bounded (xp helpers : Nat) : pool xp helpers ≤ xp / 4 := by
  unfold pool divisor; split <;> omega

theorem conserves_existing_xp (xp helpers : Nat) : killer xp helpers + pool xp helpers = xp := by
  have h := pool_bounded xp helpers
  have hdiv : xp / 4 ≤ xp := Nat.div_le_self _ _
  unfold killer; omega

theorem no_helpers_no_transfer (xp : Nat) : killer xp 0 = xp ∧ pool xp 0 = 0 := by
  simp [killer, pool, count]

theorem shared_parts_conserve (xp n : Nat) :
    n * (xp / 4 / n) + xp / 4 % n = xp / 4 := by
  have h := Nat.mod_add_div (xp / 4) n
  omega

/-- Records are committed only for a different real human's effective direct damage. -/
def effective (helper actor : Nat) (realHelper realActor wild direct damaged : Bool) : Bool :=
  helper != actor && realHelper && realActor && wild && direct && damaged

theorem no_self_credit (id : Nat) (h a w d p : Bool) : effective id id h a w d p = false := by
  simp [effective]

theorem needs_positive_damage (h a : Nat) (rh ra w d : Bool) : effective h a rh ra w d false = false := by
  simp [effective]

theorem needs_real_helper (h a : Nat) (ra w d p : Bool) : effective h a false ra w d p = false := by
  simp [effective]

theorem needs_real_actor (h a : Nat) (rh w d p : Bool) : effective h a rh false w d p = false := by
  simp [effective]

theorem needs_direct_hit (h a : Nat) (rh ra w p : Bool) : effective h a rh ra w false p = false := by
  simp [effective]

def record (ids : List Nat) (id : Nat) : List Nat := if id ∈ ids then ids else ids ++ [id]
theorem repeated_record_is_one_share (ids : List Nat) (id : Nat) :
    record (record ids id) id = record ids id := by
  unfold record; split <;> simp_all

def payable (deadline now : Nat) (active nearby human : Bool) : Bool :=
  now < deadline && active && nearby && human

theorem expired_is_not_payable (deadline now : Nat) (hd : deadline ≤ now) (a n h : Bool) :
    payable deadline now a n h = false := by
  simp [payable, Nat.not_lt.mpr hd]

/-- Shared spell-tags.ts prefixes every display field and keeps the two fields separate. -/
def userTag (text : List Char) : List Char := ['u', 's', 'e', 'r', ':'] ++ text
def engineTags : List (List Char) :=
  ["water", "conduct", "overload", "rune", "reflected", "whizbang", "sectumsempra"].map String.toList

theorem display_encoding_injective (a b : List Char) (h : userTag a = userTag b) : a = b := by
  simpa [userTag] using h

theorem display_cannot_forge_engine_provenance (text : List Char) : userTag text ∉ engineTags := by
  simp [userTag, engineTags]

def displayTags (name incantation : List Char) : List (List Char) := [userTag incantation, userTag name]
theorem display_fields_stay_two (name incantation : List Char) : (displayTags name incantation).length = 2 := by
  rfl

theorem neither_display_field_is_engine_provenance (name incantation tag : List Char)
    (h : tag ∈ displayTags name incantation) : tag ∉ engineTags := by
  simp [displayTags] at h
  rcases h with h | h <;> subst tag <;> exact display_cannot_forge_engine_provenance _

private def numbers (xs : List Nat) : String := "[" ++ String.intercalate "," (xs.map toString) ++ "]"
private def row (xp helpers : Nat) : String :=
  "[" ++ toString xp ++ "," ++ toString helpers ++ "," ++ toString (killer xp helpers) ++ "," ++
    numbers ((List.range (count helpers)).map (part xp helpers)) ++ "]"
def vectors : String :=
  let rows := [0, 3, 4, 12, 31, 32, 33, 140].flatMap fun xp => [0, 1, 7, 8, 12].map (row xp)
  let labels := ["water", "conduct", "overload", "rune", "reflected", "whizbang", "sectumsempra", "user:water", "ordinary | water", "Wingardium Leviosa"]
  let tags := labels.map fun s => "[\"" ++ s ++ "\",\"" ++ String.ofList (userTag s.toList) ++ "\"]"
  "{\"constants\":{\"WATER_ASSIST_DIVISOR\":4,\"WATER_ASSIST_MAX\":8,\"WATER_ASSIST_S\":60,\"WATER_ASSIST_R\":30},\"split\":[" ++ String.intercalate "," rows ++ "],\"displayTags\":[" ++ String.intercalate "," tags ++ "]}"

#eval IO.println ("WATER_ASSIST_VECTORS " ++ vectors)
end WaterAssist
