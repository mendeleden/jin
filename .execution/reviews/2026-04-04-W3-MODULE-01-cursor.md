# Review: W3-MODULE-01 — Layout Alignment

- reviewer: `cursor-REVIEWER-layout-alignment`
- packet: `W3-MODULE-01`
- date: `2026-04-04`

## verdict

`approved` — Codex can move `W3-MODULE-01` to `approved`.

## scope of review

Re-review of the same layout-alignment integration pass after the packet/handoff
was backfilled with the missing completeness artifacts.

Audited against:

- `docs/execution/00-global-rules.md`
- `docs/execution/01-dispatch-protocol.md`
- `docs/execution/tasks/W3-MODULE-01-layout-alignment.md`
- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-MODULE-01.md`
- upstream packet cards and reviews for `W1-ROUTING-01`, `W1-LIFECYCLE-01`,
  `W1-PIPE-01`, `W2-CONFIG-02`, `W2-DAEMON-02`, and `W2-CMD-01`
- `docs/blueprint/BP-01-module-map.md`
- `docs/blueprint/BP-02-data-flow.md`
- `docs/blueprint/BP-07-process-lifecycle.md`
- `docs/blueprint/BP-08-routing-and-config.md`
- the packet-scoped code and tests named in the review brief

Focused verification rerun:

- `bun test test/lifecycle-boundary.test.ts`
- `bun test test/config-mutation-control.test.ts`
- `bun test test/local-control-boundary.test.ts`
- `bun test test/read-only-query-surface.test.ts`
- `bun test test/routing.test.ts`

All 27 tests passed.

## blocking findings

None.

The two prior blockers are now addressed:

- the task packet now includes a BP Acceptance Matrix at
  `docs/execution/tasks/W3-MODULE-01-layout-alignment.md:59-68`
- the packet handoff now includes both a BP Acceptance Matrix and a V1
  Comparison at `.execution/packets/W3-MODULE-01.md:43-60`

## BP Acceptance Matrix verification

All matrix rows now exist and match the audited code:

- `BP-01 daemon ownership lives under daemon/`:
  `src/daemon/process-state.ts:22-120`,
  `src/daemon/runtime-state.ts:25-196`, and
  `src/daemon/daemonize.ts:8-43` are the canonical daemon modules; command/API
  imports point at them directly in `src/commands/start.ts:1-13`,
  `src/commands/stop.ts:1-6`, `src/commands/status.ts:5-13`,
  `src/commands/service.ts:1-11`, `src/commands/config-control.ts:1-4`,
  `src/commands/connect.ts:22-25`, `src/commands/init.ts:1-8`, and
  `src/api/control.ts:1-5`. Focused lifecycle/control tests still pass.
- `BP-01 / BP-02 watcher implementation lives under pipeline/`:
  the concrete wrapper now lives in `src/pipeline/file-watcher.ts:1-60`, and
  the pipeline-facing controller/factory remains in
  `src/pipeline/watcher.ts:1-81`. `src/commands/watch.ts:6-9` imports the
  canonical wrapper. Direct diff against deleted `src/watcher.ts` still shows an
  import-only move, and the previously approved W1-PIPE-01 watcher coverage
  remains the behavioral evidence for this row.
- `BP-08 routing stays pure conversation-based without the legacy wrapper`:
  `src/routing.ts:11-115` now exposes only the pure conversation-based routing
  surface; no `sinksForSession()` call sites remain; `src/commands/watch.ts:317-321`
  calls `sinksForConversation()` directly. `test/routing.test.ts:52-176` passes.
- `BP-07 / BP-08 API route factory uses the v2 options path only`:
  `src/api/routes.ts:32-43` now exposes only the options-object entrypoint, and
  call sites were updated in `src/api/server.ts:24-43`,
  `test/local-control-boundary.test.ts:134-205`, and
  `test/read-only-query-surface.test.ts:116-140`. The focused API tests pass.
- `BP-Product command/help reframing -> out of scope`:
  this remains properly deferred to `W3-PRODUCT-01` per the packet boundary.
- `BP-04 / BP-06 removal of live adapter and sink compatibility shims -> out of scope`:
  this remains properly deferred because current v1 command surfaces still
  depend on those shims, consistent with the packet notes.

## V1 comparison

The newly recorded V1 Comparison in `.execution/packets/W3-MODULE-01.md:54-60`
is accurate.

- `src/lifecycle.ts` -> `src/daemon/process-state.ts`: parity preserved. Direct
  diff still shows import-path changes only; exported process-state functions
  and types are intact.
- `src/runguard.ts` -> `src/daemon/runtime-state.ts`: parity preserved. Direct
  diff still shows import-path changes only; exported runtime-state functions
  and types are intact.
- `src/watcher.ts` -> `src/pipeline/file-watcher.ts`: parity preserved. Direct
  diff still shows only the adapter import path changing.
- `sinksForSession()` removal: parity preserved for remaining in-tree callers.
  The old bridge only projected `gitRemote`, `adapterId`, `branch`, and `name`;
  `src/commands/watch.ts:317-321` now passes the same session-shaped object
  directly, and `test/routing.test.ts:160-176` covers wider callers without the
  bridge.
- `createRoutes(store)` removal: parity preserved. The parameter was already a
  dead compatibility bridge from W2; `src/api/routes.ts:37-43` now matches the
  actual behavior, and the updated server/tests still pass.
- retained v1 store/adapter/sink compatibility bridges: intentionally deferred.
  That deferral remains explicit and matches the packet boundary.

## aligned

- Directory ownership now matches the packet intent and BP-01 ownership model:
  daemon/runtime state lives under `src/daemon/`, and watcher implementation
  lives under `src/pipeline/`.
- Both named temporary bridges from the packet state are retired safely:
  `sinksForSession()` and `createRoutes(store)`.
- Import cleanup is real: no audited command/API/test file still imports the
  deleted top-level `src/lifecycle.ts`, `src/runguard.ts`, or `src/watcher.ts`.
- Focused packet-scoped regression coverage passed again: 27 tests across the
  five cited files.

## drift

- `docs/blueprint/BP-01-module-map.md:69-73` still names
  `pipeline/watcher.ts` as the concrete `fs.watch` wrapper, while the current
  implementation splits that wrapper into `src/pipeline/file-watcher.ts:1-60`
  and uses `src/pipeline/watcher.ts:12-81` as the controller/factory layer.
  Ownership is aligned; this is a file-level wording drift, not a behavioral
  blocker.

## unowned spread

None in the audited packet scope.

## progress

- The prior completeness blockers are resolved.
- The code move remains clean and parity-preserving.
- The focused tests remain green.

## Codex decisions needed

1. Codex can move `W3-MODULE-01` to `approved`.
2. Decide whether the minor BP-01 file-level wording drift should be cleaned up
   in the blueprint text later or simply carried as informational while the
   code layout stands.
