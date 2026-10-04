# Server startup commit capture

The live hour began on `54cd8e0`, but its first `contribute` call at 12:13 reported the later checkout `ea648b3`. The existing `commitOf()` resolves and caches Git HEAD only on the first `contributeInfo()` call. A checkout or commit between startup and that call therefore changes the purported running version.

`src/server/main.ts` statically imports `createMcpServer` from `src/mcp/server.ts`. Module evaluation happens before the main server body and before any client session exists. The candidate moves the existing resolver into a module-level immutable `runningCommit` constant and returns that value. This fixes startup capture, rather than capturing at session creation. A nonempty `HOGWARTS_COMMIT` still wins; an empty override still falls back to Git; missing Git still produces `unknown`. Overrides are captured at startup too.

Candidate: `running-commit-candidate.patch`. This changes only version metadata, with no kernel rules, constants, or invariants changed. Git resolution retains the existing process working-directory semantics. An explicitly configured override remains the appropriate source when deployed artifacts do not correspond to the checkout HEAD.

The isolated regression imports the real module in a child process whose working directory is a temporary Git repository. It creates a second commit after import, then makes the first `contributeInfo()` call. No server or MCP session is created. The temporary repositories are deleted afterwards; the live checkout and server are untouched. An async loader substitutes the candidate module only in candidate children.

Four cases cover HEAD changed after import, override changed after import, empty override fallback, and no repository. The original has three failures and one pass; the candidate has four passes. `git apply --check` also passes. This is targeted offline validation, not a full repository build or production restart.

Run from `/workspace/Hogwarts`:

```sh
CANDIDATE=0 node --test /workspace/scratch/playtest-hour-2026-10-04/repro/running-commit-regression.test.mjs
CANDIDATE=1 node --test /workspace/scratch/playtest-hour-2026-10-04/repro/running-commit-regression.test.mjs
git apply --check /workspace/scratch/playtest-hour-2026-10-04/repro/running-commit-candidate.patch
```

Fixtures: `running-commit-regression.test.mjs`, `running-commit-probe.mjs`, `commit-loader-hooks.mjs`, `running-commit-candidate.ts`. Results: `commit-tests-before.txt`, `commit-tests-candidate.txt`.

Archive note: commands above describe the historical private scratch reproduction. The final portable tests are committed as `test/running-commit.test.ts` and `test/fixtures/running-commit-probe.mjs` in implementation d6a41db. Full scratch copies of the MCP server are omitted from this archive.
