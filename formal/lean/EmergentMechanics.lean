/-!
Proof obligations for regional ecology, bounded decrees, and capped graduation legacies.
The runtime tests compare these bounds and transitions with the TypeScript pure functions.
-/
namespace EmergentMechanics


def clamp (lo hi x : Nat) : Nat := min hi (max lo x)
def yieldPct (resource : Nat) : Nat := clamp 60 140 (60 + ((clamp 20 100 resource - 20) * 80 / 80))
def hunt (resource cost : Nat) : Nat := clamp 20 100 (resource - cost)
def recover (resource gain : Nat) : Nat := clamp 20 100 (resource + gain)

theorem yield_bounded (resource : Nat) : 60 ≤ yieldPct resource ∧ yieldPct resource ≤ 140 := by
  constructor
  · unfold yieldPct clamp
    omega
  · unfold yieldPct clamp
    exact Nat.min_le_left _ _

theorem hunt_bounded (resource cost : Nat) : 20 ≤ hunt resource cost ∧ hunt resource cost ≤ 100 := by
  constructor
  · unfold hunt clamp
    omega
  · unfold hunt clamp
    exact Nat.min_le_left _ _

theorem recover_bounded (resource gain : Nat) : 20 ≤ recover resource gain ∧ recover resource gain ≤ 100 := by
  constructor
  · unfold recover clamp
    omega
  · unfold recover clamp
    exact Nat.min_le_left _ _


def decreeAccepted (budget changed : Nat) : Bool := changed > 0 && changed ≤ budget

theorem decree_respects_budget (budget changed : Nat) (h : decreeAccepted budget changed = true) : changed ≤ budget := by
  simp [decreeAccepted] at h
  exact h.2


def legacyRank (cap rank : Nat) : Nat := min cap rank
def chooseLegacy (cap available rank : Nat) : Nat × Nat :=
  if available = 0 ∨ cap ≤ rank then (available, rank) else (available - 1, rank + 1)

theorem legacy_bounded (cap rank : Nat) : legacyRank cap rank ≤ cap := by
  exact Nat.min_le_left _ _

theorem legacy_choice_conserves (cap available rank : Nat)
    (ha : 0 < available) (hr : rank < cap) :
    let out := chooseLegacy cap available rank
    out.1 + out.2 = available + rank := by
  simp [chooseLegacy, Nat.ne_of_gt ha, Nat.not_le.mpr hr]
  omega

end EmergentMechanics
