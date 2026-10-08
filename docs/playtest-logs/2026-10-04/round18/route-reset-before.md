# Route reset regression before repair

UTC test start: 2026-10-04 15:41:06.

Command: `npx vitest run test/route-reset.test.ts`.

Result: 9 tests, 8 failed and 1 passed. Every failed case completed its actual reset/placement API and cleared `goal`, `route`, and `goalBy`, but retained `world.via.has(wizard.id) === true`.

Failed cases:

- Floo arrival at Hagrid's fireplace.
- Real duel queue followed by `stepDuelClub` starting the match.
- Joining a Quidditch match already in play.
- Quidditch whistle placing a waiting player on the pitch.
- Disabling Quidditch chase for an agent-owned route.
- Leaving Quidditch while chase owned the route.
- Quidditch match ending while chase owned the route.
- Spell ice melting and pushing the walker ashore.

The control case, preserving a human-owned route when chase is disabled and the player leaves, passed.

Fixtures use isolated `World` objects and real public functions / feature lifecycle hooks. No production server, registered player, or browser was used. No full test suite was run.
