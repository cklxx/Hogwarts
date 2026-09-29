# 不公平，但好玩 — kernel reference and client shapes

"Unfair, but fun": strength is visible, it has counterplay, and the leader is worth hunting. The rules are
in README.md (section 不公平，但好玩); this page is for whoever builds on them — the client panels, agents,
and the next person to change the numbers. Every number lives in `src/shared/constants.ts` and is compared
with `formal/lean/Hogwarts.lean` through `formal/vectors.json` (`unfair.constants`).

| Mechanic | Kernel | Formal |
|---|---|---|
| 黑魔王 Dark Lord | `World.updateDarkLord` (1 Hz sweep), `passDarkMark`, `broadcastDarkMark`, `darkPower` in `damage` | Lean `dark_lord_no_flap`, `dark_lord_tie_stays` |
| 输赢代价不对称 steal curve | `progression.ts stealTier / stealPct / duelSteal`, `World.stun` | Lean `steal_tier_mono`, `duel_steal_cap`, `duel_steal_mono`, `duel_steal_dark`, `steal_newcomer`, `steal_normal`, `steal_dark_lord`, `duel_conserves_curve` |
| 邓布利多军 DA | `joinDA`, `leaveDA`, `daState`, `vetoDecree`, `enactVeto`, `jointBonus` in `damage` | TLA+ `DAVeto.tla`; Lean `joint_bounded`, `joint_mono`, `veto_strict_majority` |
| 偷师 study | `noteSpellHit` (in `damage` and `hit`), `studyable`, `studySpell`, Revelio → `revealStudies` | Lean `study_before_forgotten` |
| 无规则区 lawless zone | `shared/map.ts LAWLESS_ZONE` (`deep_forest`), `inLawless`, `guardHostileGift`, `deliverHostile`, `slay`, `stun`, `lawlessSweep` | TLA+ `Hex.tla` (a `Lawless` flag) checked by `HexLawless.tla` |
| 专注力 concentration | `rules.agents`, `World.spendConcentration` (called by `src/mcp/server.ts` guard), `focusState` | Lean `focus_bounded`, `spend_focus_exact` |

## Numbers

- Dark Lord: reputation ≥ 150 (`DARK_LORD_MIN_REP`), a player (not an NPC), online or seen in the last 180 s.
  Damage ×1.15. Broadcast every 60 s while online. A challenger takes the mark with ≥ 110 % of the holder's
  reputation (`challenger · 100 ≥ holder · 110`).
- Steal: tier 5 % (< 50), 10 % (50–199), 15 % (200–499), 20 % (≥ 500), Dark Lord 30 %. Percent =
  `min(30, ⌊tier · duelRepStealPct · mult / 10⌋)`, stolen = `⌊rep · percent / 100⌋`; `mult` = 2 when the victim
  falls in the lawless zone (and the base `duelRepBase` doubles there too). Rematches within 60 s, NPCs and
  wizards enrolled < 10 min still pay nothing.
- DA: joins below 100 reputation or below the median (of players seen in the last 180 s); ≤ 24 members;
  Minister and Dark Lord excluded (a member who becomes either leaves). Veto: ≥ 3 members online (not in
  Azkaban), votes ≥ ⌊online / 2⌋ + 1 among them, within 180 s of the decree, one per term; restores the rulebook
  from before the decree (re-validated through `applyPatch`), marks the `DecreeRecord` `vetoed: true`, removes
  that decree's statue. Joint spell: ≥ 3 distinct members hitting one target within 4 s → their direct hits
  ×1.25 (summons count for their owner; damage over time does not).
- Study: a custom (non-curriculum) spell of another player that hit you (bolt damage, a root or a disarm,
  delayed `(after …)` blocks included) is remembered for 10 min after its last hit (≤ 8 per victim). Readable
  120 s after its first hit, once per spell (≤ 64 studies remembered). `copy` forges it through `forgeSpell`
  (your year, your seals, your banned primitives, your spellbook size); a failed copy spends nothing.
- Lawless zone: disc (205, 35) r 26 inside the Forbidden Forest. Hostile parcels to someone standing there
  skip the per-pair cooldown and the 10-minute window (and do not count toward it); everything else in
  `guardHostileGift` holds. Creature Galleons and XP ×2 (by where the creature dies).
- Concentration: `rules.agents = { concentration: true, maxPerMinute: 60 (10–600), regen: 1 (0.1–10) }`.
  Costs (`src/kernel/unfair.ts AGENT_TOOL_COST`): 1 for `cast use_item move_to say set_hotbar unlearn_spell
  equip_item unequip_item destroy_item read_seal_page decree join_dumbledores_army leave_dumbledores_army
  veto_decree unpublish_spell`; 2 for `break_seal study_spell publish_spell`; 3 for `forge_spell forge_item copy_spell fork_spell`; every other
  tool 0 (`market_browse` and `market_spell` too — 咒语集市, README). The refusal
  text ends with `retry_after=<seconds>`.

## For the client (drawn by `client/panels/*`: the Dark Mark and compass, the DA panel `J`, 偷师 in the spellbook, the concentration tube, the lawless vignette)

Snapshot (`{ t: 'snap', s }`):

- wizard entry `s` flags gain **`V`** = holds the Dark Mark.
- new top-level **`dl`**: `{ h: handle, n: name, x, z, p: placeName } | null` — the Dark Lord's whereabouts for
  everyone (outside the area-of-interest arrays, so every client gets it).
- zones: `shared/map.ts ZONES` has `deep_forest` ("The Deep Forest", 禁林深处); `LAWLESS_ZONE` names it.

Private state (`{ t: 'me' }` → `privateState()`), new key **`unfair`**:

```ts
unfair: {
  darkLord: { handle, name, house, reputation, place, placeZh, x, z, since } | null,
  youAreDarkLord: boolean,
  da: {
    member: boolean, eligible: boolean, size: number, online: number, quorum: 3,
    members?: { handle, name, online }[],            // only for members
    veto: { perTerm: 1, usedThisTerm: boolean, windowSeconds: 180,
            decree: { minister, changes: string[], secondsLeft } | null,
            votes: number, needed: number, voted: boolean },
  },
  study: { spell, from, handle, readyAt /* world time, compare with snapshot t */ }[],
  focus: { on: boolean, cur: number, max: number, regen: number },
  lawless: boolean,
}
```

WebSocket messages (rate limits in `src/server/net.ts LIMITS`: `da` 1/s burst 5, `study` 1/s burst 3):

- `{ t: 'da', op?: 'status' | 'join' | 'leave' | 'veto' }` → `{ t: 'da', op, r }` where `r` is `daState()` (the
  shape of `unfair.da` plus `why`/`whyZh` when you may not join, `max`, `admits: { belowReputation, orBelowMedian }`,
  `joint: { members, withinSeconds, damagePct }`), or for `veto` `{ vetoed, votes, needed, online, quorum, secondsLeft? }`.
- `{ t: 'study', spell, from?, copy?, name?, slot? }` → `{ t: 'study', r: { studied, author, handle, source, copied?, note } }`
  (and a fresh `book` when copied). Errors come back as `{ t: 'err', error }` like every other message.

Events: new types **`dark`** (public: the mark passes, fades, the Dark Mark over a place, the Dark Lord falls;
private: the lawless-zone warning) and **`da`** (private to members: joins, votes; public: the joint
Expecto Patronum). A veto is a public **`decree`** event (so it raises the banner). All carry `zh`.

MCP: `dumbledores_army` (read-only), `join_dumbledores_army`, `leave_dumbledores_army`, `veto_decree`,
`study_spell`; `whoami` gains `darkLord`, `dumbledoresArmy`, `lawless`, `studyable`, `agent.concentration`;
`look` gains `you.lawless` and `wizards[].darkLord`; `leaderboard` gains `darkLord` and `darkLordRule`;
`armory` spells gain `origin` for copies.

## Honest limits

- The veto window and the DA's votes are persisted in `flags.veto`; concentration, the joint-hit memory
  and the lawless warnings are not (a restart refills everyone's concentration).
- The Dark Mark's position broadcast is public by design; it names a place and whole-metre coordinates.
- A sender who hexed someone in the last 5 minutes can tell from the forge's answer whether that person is
  in the lawless zone (the cooldown message is skipped there). The zone is announced on entry anyway.
