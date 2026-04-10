# Review — `W3-CLEANUP-01`

- reviewer: `codex`
- session: `codex-REVIEWER-v1-surface-cleanup`
- date: `2026-04-09`

## verdict

`approved` — no blocking findings. The cleanup lane can move to `approved`
once the commit is staged narrowly to the cleanup-specific hunks.

## scope of review

- Re-read `docs/execution/00-global-rules.md`,
  `docs/execution/01-dispatch-protocol.md`,
  `docs/execution/05-live-control-plane.md`, and
  `docs/execution/tasks/W3-CLEANUP-01-remove-ui-and-v1-bridges.md`.
- Re-read live control-plane state in `.execution/program.md`,
  `.execution/blueprints.md`, `.execution/packets/W3-PRODUCT-01.md`,
  `.execution/packets/W3-RUNTIME-01.md`, `.execution/packets/W3-CLEANUP-01.md`,
  `.execution/agents/codex-WORKER-v1-surface-cleanup.md`, and
  `.execution/logs/codex-WORKER-v1-surface-cleanup-last.txt`.
- Reviewed the packet-owned cleanup diff for `docs/blueprint/BP-09-cli-split.md`,
  `package.json`, `src/index.ts`, `src/commands/connect.ts`,
  `src/commands/start.ts`, `src/commands/stop.ts`,
  `src/commands/team-bridge.ts`, `src/db/schema.ts`, `src/store.ts`,
  `src/daemon/process-state.ts`, `src/api/control.ts`, removed UI/build files,
  and the packet-owned tests.
- Searched packet-adjacent code for stale `jin ui`, dashboard, `LegacyStore`,
  `prepareLegacyStoreForV2`, `team-config`, `jin init`, `jin sessions`,
  `--postgres`, `--s3`, and `--webhook` references.
- Ran:
  - `git diff --check -- docs/blueprint/BP-09-cli-split.md package.json src/index.ts src/commands/connect.ts src/commands/start.ts src/commands/stop.ts src/db/schema.ts src/store.ts src/daemon/process-state.ts src/api/control.ts src/commands/init.ts src/commands/team-config.ts src/api/server.ts scripts/embed-spa.ts src/tui dashboard test/connect.test.ts test/config-mutation-control.test.ts test/local-control-boundary.test.ts test/lifecycle-boundary.test.ts test/team-bootstrap.test.ts test/runtime-store-cutover.test.ts test/perf-harness/harness.sh`
  - `bun test test/connect.test.ts`
  - `bun test test/config-mutation-control.test.ts`
  - `bun test test/local-control-boundary.test.ts`
  - `bun test test/lifecycle-boundary.test.ts`
  - `bun test test/team-bootstrap.test.ts`
  - `bun test test/runtime-store-cutover.test.ts`
  - `bun test test/cli-surface-cleanup.test.ts`
  - `bun test test/perf-harness/benchmark-v2.test.ts`

## blocking findings

No blocking findings.

- The top-level CLI now removes the old surfaces explicitly instead of silently
  aliasing them: removed-command failures and removed-flag failures are wired in
  `src/index.ts:323-727`, while the active help surface only advertises the
  daemon-first commands and `jin team bridge` path.
- `jin connect` no longer offers one-step sink creation and now reads repo
  identity from the v2 store/query path in `src/commands/connect.ts:60-104`
  and `src/commands/connect.ts:393-398`.
- Runtime control/status state no longer models a second `dashboard`
  component: `src/daemon/process-state.ts:21-70` and `src/api/control.ts:1-123`
  only report the watcher/runtime owner.
- The build surface no longer embeds the SPA: `package.json:9-16` keeps only
  the binary build, and the old `scripts/embed-spa.ts`, `src/api/server.ts`,
  `src/tui/**`, and `dashboard/**` paths are removed from the cleanup diff.
- The legacy onboarding/store bridge removal is real: `src/db/schema.ts:15-156`
  no longer carries `prepareLegacyStoreForV2(...)`, and `src/store.ts` no
  longer exports `LegacyStore`.

## BP Acceptance Matrix verification

- Local CLI surface is daemon-first and no longer exposes removed dashboard /
  onboarding compatibility commands
  - Implemented in `src/index.ts:323-727`, `src/commands/start.ts:18-95`, and
    `src/commands/stop.ts:1-82`.
  - Tested by `test/cli-surface-cleanup.test.ts:17-64` and
    `test/lifecycle-boundary.test.ts:125-240`.

- Team/workspace onboarding stays under `jin connect --team` and
  `jin team bridge`, while generic integrations stay under `jin sink` /
  `jin route`
  - Implemented in `src/index.ts:398-706`, `src/commands/connect.ts:60-104`,
    `src/commands/connect.ts:456-486`, and `src/commands/team-bridge.ts:5-72`.
  - Tested by `test/connect.test.ts:74-249`,
    `test/config-mutation-control.test.ts:111-224`, and
    `test/team-bootstrap.test.ts:95-252`.

- Lifecycle/status/control no longer model a removed dashboard component
  - Implemented in `src/commands/start.ts:18-95`,
    `src/commands/stop.ts:1-82`, `src/daemon/process-state.ts:21-70`, and
    `src/api/control.ts:1-123`.
  - Tested by `test/lifecycle-boundary.test.ts:125-240`,
    `test/local-control-boundary.test.ts:44-119`, and
    `test/runtime-store-cutover.test.ts:113-214`.

- Build/install path no longer embeds or depends on the SPA dashboard
  - Implemented in `package.json:9-16` plus removal of the old embed/server/UI
    files from the packet-owned diff.
  - Tested by `test/cli-surface-cleanup.test.ts:17-64`.

- Local read/onboarding surfaces no longer depend on `LegacyStore` or the v1
  schema carry-forward shim
  - Implemented in `src/commands/connect.ts:25-26`,
    `src/commands/connect.ts:393-398`, `src/db/schema.ts:15-156`, and
    `src/store.ts` removal of the `LegacyStore` export.
  - Tested by `test/connect.test.ts:74-249`,
    `test/config-mutation-control.test.ts:111-224`, and
    `test/runtime-store-cutover.test.ts:113-214`.

- BP-09 reflects the actual post-cleanup command surface
  - Implemented in `docs/blueprint/BP-09-cli-split.md:80-125` and
    `docs/blueprint/BP-09-cli-split.md:424-443`.
  - Tested by `test/cli-surface-cleanup.test.ts:17-64` and
    `test/team-bootstrap.test.ts:95-252`.

## V1 comparison

- Intentional BP-backed removal: `jin ui`, the dashboard lifecycle flags, the
  embedded server/build path, and the `src/tui/**` / `dashboard/**` surface
  are removed rather than preserved behind compatibility aliases.
- Intentional BP-backed removal: `jin init`, `jin sessions`, and
  `jin connect --postgres|--s3|--webhook` now fail with migration guidance
  instead of continuing the v1 path.
- Parity kept through a v2 replacement path: the operator onboarding bridge now
  lives at `jin team bridge` via `src/commands/team-bridge.ts:5-72`.
- Intentional BP-backed removal: the explicit v1 SQLite carry-forward shim and
  `LegacyStore` export are gone from the packet-owned onboarding/runtime path.

## aligned

- `docs/blueprint/BP-09-cli-split.md:80-125` and
  `docs/blueprint/BP-09-cli-split.md:424-443` now describe the actual command
  surface: no developer `ui`/`init`/`sessions`/`team-config` bridge and no
  `connect --postgres|--s3|--webhook` shortcut wiring.
- `src/index.ts:323-727` keeps the removals explicit and user-facing; this
  avoids hidden compatibility behavior while still giving migration guidance.
- `src/commands/connect.ts:393-398` uses the v2 conversation store/query path
  for repo discovery instead of the legacy project/session bridge.
- `git diff --check` passed for the tracked cleanup diff.

## drift

- Informational only: `src/commands/setup-skills.ts` still mentions
  `jin sessions`. It is outside this packet’s owned files and does not block
  cleanup approval.
- Informational only: running all packet-local mocked suites in one combined
  `bun test` command produced shared-mock contamination. The isolated per-file
  reruns above all passed and are the authoritative evidence for this review.

## unowned spread

- `test/runtime-store-cutover.test.ts` currently carries unrelated perf-lane
  assertions in the working tree (`pushBatchSize` / RSS env expectations). That
  delta is not required for the cleanup commit and should remain unstaged here.
- `test/team-bootstrap.test.ts` currently carries unrelated schema-lane
  expectation bumps (`PRIMARY KEY ...`, schema version `2.4`). Only the
  cleanup-specific `team-config` -> `team bridge` hunks belong in this commit.
- No cleanup-specific spread was found outside the packet-owned file boundary.

## progress

- The cleanup lane now has the required Codex review artifact.
- The worker diff stays inside the packet-owned implementation/test boundary.
- Focused isolated validation passed for the packet-local cleanup evidence.
- Codex can move `W3-CLEANUP-01` from `review_ready` to `approved` and make the
  scoped cleanup commit.

## Codex decisions needed

- None for approval.
