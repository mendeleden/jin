# Packet State

- packet: `W3-MODULE-01`
- title: `Layout Alignment`
- status: `approved`
- assigned agent: `codex-BRAIN`
- branch: `feat/rewrite-ontology`
- worktree/container: `canonical repo workspace` / `local`
- depends on: `Wave 1 and enough Wave 2 coverage`
- unblocks: `clean BP-01 alignment`
- last transition: `2026-04-04`
- next Codex action: `decide whether the remaining user-facing bridges roll into W3-PRODUCT-01 or split into narrower hardening packets, then commit the module-layout diff`
- latest review: `2026-04-04-W3-MODULE-01-cursor`

## Notes

- integration lane completed in the canonical repo workspace on branch
  `feat/rewrite-ontology`
- bridges removed:
  - `src/routing.ts` legacy `sinksForSession()` wrapper
  - `src/api/routes.ts` legacy `createRoutes(store)` parameter bridge
- layout alignment completed:
  - canonical daemon ownership now lives under `src/daemon/`
  - canonical watcher implementation now lives under `src/pipeline/file-watcher.ts`
  - command/API imports now point at the canonical daemon/pipeline modules
- bridges intentionally left in place for `W3-PRODUCT-01` or later:
  - config parsing compatibility in `src/config.ts` and `src/sink-resolver.ts`
  - v1 store-backed command surfaces in `src/store.ts`, `src/commands/ingest.ts`,
    `src/commands/watch.ts`, `src/commands/init.ts`, and
    `src/commands/benchmark.ts`
  - adapter legacy `sessions()` / `messages()` / `toLegacy*()` methods and
    sink dual-interface shims in `src/sinks/{webhook,postgres,s3}.ts`
  - session-like API response bridges in `src/api/routes.ts`
- review blockers from `2026-04-04-W3-MODULE-01-cursor` have now been
  backfilled in this packet:
  - required BP Acceptance Matrix
  - required V1 Comparison for the moved modules and retired bridges
- re-review result: `2026-04-04-W3-MODULE-01-cursor` now approves the packet
  after the backfill; only informational BP-01 wording drift remains
- review confirmed the code move itself is parity-preserving:
  - daemon ownership now lives under `src/daemon/`
  - watcher implementation now lives under `src/pipeline/file-watcher.ts`
  - `sinksForSession()` and `createRoutes(store)` were retired safely

## BP Acceptance Matrix

| Requirement | Status | Evidence |
|-------------|--------|----------|
| BP-01 daemon ownership lives under `daemon/` | implemented | `src/daemon/process-state.ts`, `src/daemon/runtime-state.ts`, `src/daemon/daemonize.ts`; verified by `bun test test/lifecycle-boundary.test.ts` and `bun test test/config-mutation-control.test.ts` |
| BP-01 / BP-02 watcher implementation lives under `pipeline/` | implemented | `src/pipeline/file-watcher.ts`, `src/pipeline/watcher.ts`; verified by `bun test test/pipeline-spine.test.ts` |
| BP-08 routing stays pure conversation-based without the legacy wrapper | implemented | `src/routing.ts`, `src/commands/watch.ts`; verified by `bun test test/routing.test.ts` |
| BP-07 / BP-08 API route factory uses the v2 options path only | implemented | `src/api/routes.ts`, `src/api/server.ts`; verified by `bun test test/local-control-boundary.test.ts` and `bun test test/read-only-query-surface.test.ts` |
| BP-Product command/help reframing | out of scope | deferred to `W3-PRODUCT-01` per packet boundary |
| BP-04 / BP-06 removal of live adapter and sink compatibility shims | out of scope | deferred because current v1 command surfaces still depend on those shims |

## V1 Comparison

- parity kept: daemon lifecycle behavior remained unchanged while code moved from top-level lifecycle/runtime files into `src/daemon/`
- parity kept: watcher behavior remained unchanged while the concrete wrapper moved into `src/pipeline/file-watcher.ts`
- parity kept: routing semantics remained unchanged while `sinksForSession()` was retired and callers switched to the pure conversation routing path
- parity kept: read-only API behavior remained unchanged while the dead `createRoutes(store)` compatibility parameter was removed
- intentional deferral: product-facing v1 store/adapter/sink compatibility bridges remain for `W3-PRODUCT-01` or later hardening packets
