# Review — `W3-RUNTIME-01`

- reviewer: `codex`
- session: `codex-REVIEWER-runtime-store-cutover`
- date: `2026-04-07`

## verdict

`needs_codex` — not approved yet.

## scope of review

- Read in order:
  - `docs/execution/00-global-rules.md`
  - `docs/execution/01-dispatch-protocol.md`
  - `docs/execution/05-live-control-plane.md`
  - `docs/execution/tasks/W3-RUNTIME-01-live-runtime-store-cutover.md`
- Read live control plane:
  - `.execution/program.md`
  - `.execution/blueprints.md`
  - `.execution/packets/W3-RUNTIME-01.md`
  - `.execution/agents/codex-WORKER-live-runtime-store-cutover.md`
  - `.execution/reviews/2026-04-04-AUDIT-bp-drift-claude.md`
  - `.execution/reviews/2026-04-04-AUDIT-v1-bridges-claude.md`
- Read packet-owned BP/code/tests only:
  - `docs/blueprint/BP-01-module-map.md`
  - `docs/blueprint/BP-02-data-flow.md`
  - `docs/blueprint/BP-05-store-and-migration.md`
  - `docs/blueprint/BP-07-process-lifecycle.md`
  - `docs/blueprint/BP-08-routing-and-config.md`
  - `src/commands/start.ts`
  - `src/commands/watch.ts`
  - `src/commands/ingest.ts`
  - `src/commands/status.ts`
  - `src/commands/analyze.ts`
  - `src/tui/app.tsx`
  - `src/store.ts`
  - `src/adapters/types.ts`
  - `src/pipeline/**`
  - `src/db/**`
  - `test/runtime-store-cutover.test.ts`
  - `test/init.test.ts`
  - `test/lifecycle-boundary.test.ts`
  - `test/config-mutation-control.test.ts`
- Tests rerun:
  - `bun test test/runtime-store-cutover.test.ts`
  - `bun test test/init.test.ts`
  - `bun test test/lifecycle-boundary.test.ts`
  - `bun test test/config-mutation-control.test.ts`

## blocking findings

1. `BP Acceptance Matrix` row 5 is still incomplete because the read-surface cutover is not fully backed by in-scope test evidence.
   - `src/commands/status.ts:223-238` and `src/commands/analyze.ts:14-42` now read from the v2 db/query surface.
   - `src/tui/app.tsx:3,67` and `src/store.ts:765-768` make the residual TUI legacy-store dependency explicit, so the defer itself is not silent.
   - The focused packet test only proves the `watchCommand`/`ingestCommand` cutover (`test/runtime-store-cutover.test.ts:106-173`).
   - Existing `status` coverage is generic lifecycle/progress coverage, not a direct store-surface cutover assertion (`test/init.test.ts:415-496`, `test/lifecycle-boundary.test.ts:243-253`).
   - There is no in-scope `analyzeCommand` test at all.
   - Per `00-global-rules.md`, implemented rows require code and test citations. Row 5 cannot be signed off as implemented yet.

No other blocking issues were found in the packet-owned code path.

## BP Acceptance Matrix verification

- `jin start` / foreground runtime path uses the BP-02 pipeline coordinator instead of the v1 watcher brain
  - Implemented in `src/commands/start.ts:84-88`, `src/commands/watch.ts:92-128`, and `src/pipeline/loop.ts:38-125,203-339`.
  - Focused test citation: `test/runtime-store-cutover.test.ts:106-131` proves the foreground `watchCommand` cutover; detached `jin start` parity is inferred through the unchanged daemon wrapper plus `start.ts` delegation.

- Live runtime writes use the BP-05 store spine in `src/db/**`, not `src/store.ts`
  - Implemented in `src/commands/watch.ts:92-109`, `src/pipeline/ingest.ts:82-139`, `src/pipeline/push.ts:19-127`, and `src/db/store.ts:30-110`.
  - Focused test citation: `test/runtime-store-cutover.test.ts:106-131`.

- One-shot ingest does not bypass the single-brain invariant
  - Implemented in `src/commands/ingest.ts:12-65`.
  - Focused test citations: `test/runtime-store-cutover.test.ts:133-173` and `test/init.test.ts:273-293`.

- Runtime/store cutover does not widen frozen adapter or sink contracts
  - Implemented by keeping frozen contract files untouched and routing the live path onto the existing v2 store/push surfaces in `src/commands/watch.ts:113-128`, `src/commands/ingest.ts:37-65`, `src/pipeline/push.ts:129-150`, and the unchanged legacy shim in `src/adapters/types.ts:6-42`.
  - Focused test citation: `test/runtime-store-cutover.test.ts:123-130,169-173`.

- Read surfaces touched by the cutover either migrate cleanly or are explicitly deferred with boundary citations
  - `status.ts` migrated in `src/commands/status.ts:223-238`.
  - `analyze.ts` migrated in `src/commands/analyze.ts:14-42`.
  - `tui/app.tsx` remains an explicit defer via `src/tui/app.tsx:3,67` and `src/store.ts:765-768`.
  - Blocking status: incomplete. `status` only has indirect coverage (`test/init.test.ts:415-496`, `test/lifecycle-boundary.test.ts:243-253`), and there is no in-scope `analyze` cutover test.

## V1 comparison

- `watch` / live runtime
  - Parity kept on runtime ownership checks, protected-source notices, update check, and shutdown ownership flow in `src/commands/watch.ts:28-90,137-206`.
  - Intentional BP-backed change: the live brain/store path is now `watch.ts -> runPipeline() -> src/db/store.ts` instead of the v1 watcher/store stack (`src/commands/watch.ts:92-128`, `src/pipeline/loop.ts:38-125`, `src/pipeline/ingest.ts:82-139`). This is the packet goal and matches BP-02/BP-05/BP-07.

- One-shot ingest
  - Intentional BP-backed change: `src/commands/ingest.ts:12-65` now fails fast when a long-lived runtime owns the store and uses `ingestAll()` + `pushDirty()` over the v2 store. That closes the prior v1 bypass and matches BP-02/BP-07.

- `status` / `analyze`
  - Parity mostly kept in operator-facing labels while the backing read surface changes to v2 queries (`src/commands/status.ts:232-238`, `src/commands/analyze.ts:21-42,49-93`).

- TUI
  - No parity claim. `src/tui/app.tsx:3,67` remains an explicit compatibility defer onto `LegacyStore`.

## aligned

- The packet closes the main BP-05 runtime write drift in packet-owned live paths: `watch.ts` now opens the v2 store and launches `runPipeline()`.
- The coordinator/store path is the real v2 path, not just dormant modules: `pipeline/ingest.ts` writes with `store.writeBundle(...)`, and `pipeline/push.ts` reads v2 conversations/messages/tool_calls and records push results.
- One-shot ingest now uses the same v2 ingest/push/store spine and respects the single-coordinator rule.
- `status.ts` and `analyze.ts` no longer read through `src/store.ts`.
- The remaining packet-owned legacy-store dependency is explicit rather than hidden: `src/tui/app.tsx` imports `LegacyStore`.

## drift

- The packet is close, but the read-surface acceptance row is not complete until the v2 `status`/`analyze` cutover has focused test citations.
- The foreground cutover is directly proven; detached daemon parity is still an inference from the unchanged daemon wrapper and `start.ts` delegation, not a packet-local test.

## unowned spread

- Prior audits still track broader repo `src/store.ts` compatibility users outside this packet. This review did not reopen those files.
- Inside the packet-owned surface, `src/tui/app.tsx` is the remaining explicit legacy-store bridge.

## progress

- `bun test test/runtime-store-cutover.test.ts` passed.
- `bun test test/init.test.ts` passed.
- `bun test test/lifecycle-boundary.test.ts` passed.
- `bun test test/config-mutation-control.test.ts` passed.
- The main runtime/store cutover code is in place; approval is blocked on completeness of the read-surface evidence, not on a discovered regression in the packet-owned runtime path.

## Codex decisions needed

- Add a focused packet-local test that proves the v2 `analyze.ts` read path, and preferably a direct `status.ts` store-stat assertion rather than only lifecycle/progress coverage.
- Decide whether detached `jin start` needs an explicit packet-local cutover test or whether the existing `start.ts` delegation plus prior daemon wrapper approval is enough for approval.
- Keep `src/tui/app.tsx` as an explicit compatibility defer for now, or open a follow-up packet if BP-05 should move beyond `mostly_aligned` after this cutover.
