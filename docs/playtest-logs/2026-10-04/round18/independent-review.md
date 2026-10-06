# Read-only market and assist review

Date: 2026-10-04 UTC. Isolated World fixtures only; no production server or registration involved.

## Market read path

Scenario: an established buyer paid 3 Galleons for v1; the author published v2. Read v1 and v2 metadata 30 times each, then compare the complete serialized World before and after those reads.

Observed: `metadataStateUnchanged: true`, `checks: 60`. No spell creation, money transfer, copier insertion, reward mutation, or other serialized state change occurred during metadata reads.

## Assist natural-water boundary

Scenario: helper waters a dry-ground hostile troll at (40,20); the troll moves to lawn dew at (31.5,10); another active human triggers fire before the next environment sweep, then kills the troll.

Observed: helper 35 XP, killer 105 XP; the original 140 XP budget is conserved.

Confirmed intended semantics from root: dry-ground player water establishes a valid source. Until the next environment sweep actually overwrites the wet state, that active player source remains valid even if the creature has just entered naturally wet ground. This is active-water contribution, not a natural-water reward. Watering a target already in a natural supply zone cannot establish attribution. The observed pre-sweep boundary is not a defect.

## Scope

Reviewed current prop hints, NPC mist exclusion, route cancellation, market metadata admission, and water attribution. Targeted initial regressions were run; main integration validation and browser verification belong to root. No source edits were made. Only root-authorized `test/route-reset.test.ts` and these scratch notes were created.
