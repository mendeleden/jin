# Packet State

- packet: `W3-RUNTIME-01`
- title: `Live Runtime and Store Cutover`
- status: `approved`
- assigned agent: `codex-WORKER-live-runtime-store-cutover`
- branch: `feat/rewrite-ontology`
- worktree/container: `canonical repo workspace` / `local`
- depends on: `W3-STARTUP-01`, `W3-TEAM-01`
- unblocks: `true v2 runtime claim`, `persona E2E confidence`, `release caveat reduction`
- last transition: `2026-04-07`
- next Codex action: `commit the scoped runtime/store cutover diff and use it as the first gate for W3-V2-01 and W3-E2E-01`
- latest review: `2026-04-07-W3-RUNTIME-01-codex-recheck`

## Notes

- the main drift is already recorded in `.execution/blueprints.md` under
  `BP-05`:
  - `jin start` still routes into `src/commands/watch.ts`
  - the production runtime still writes through `src/store.ts`
  - the v2 `src/pipeline/loop.ts` + `src/db/store.ts` path exists but is not
    the live runtime
- prior audits agree on the same gap:
  - `.execution/reviews/2026-04-04-AUDIT-bp-drift-claude.md`
  - `.execution/reviews/2026-04-04-AUDIT-v1-bridges-claude.md`
  - Codex explorer `Descartes` result from `2026-04-06`
- initial expected scope:
  - runtime entrypoints: `src/commands/start.ts`, `src/commands/watch.ts`,
    `src/commands/ingest.ts`
  - store cutover: `src/store.ts`, `src/db/store.ts`, `src/db/query-surface.ts`
  - coordinator path: `src/pipeline/**`
  - residual read surfaces if they block `src/store.ts` retirement:
    `src/commands/status.ts`, `src/commands/analyze.ts`, `src/tui/app.tsx`
- this is the main remaining blocker to calling the v2 rewrite the live
  production runtime rather than a compatibility product surface over v1
- worker heartbeat now reports `review_ready` with:
  - `src/commands/watch.ts` launching `runPipeline(...)` against the v2 store
  - `src/commands/ingest.ts` moved to the v2 ingest/push/store path
  - `src/commands/status.ts` and `src/commands/analyze.ts` reading from v2 db/query APIs
  - `src/db/schema.ts` carrying the v1-compat table rename guard
  - `test/runtime-store-cutover.test.ts` added and focused packet-local tests passing
- detached Codex review completed and confirmed the main live write/runtime cutover is real, but it blocked approval on completeness:
  - missing packet-local `analyze.ts` cutover test evidence
  - only indirect `status.ts` evidence today
  - `src/tui/app.tsx` remains the explicit `LegacyStore` defer
- a narrow follow-up worker added packet-local evidence in `test/runtime-store-cutover.test.ts` for:
  - `analyze.ts` reading from the v2 query surface
  - direct `status.ts` store-stat evidence
  - heartbeat: `.execution/agents/codex-WORKER-runtime-store-evidence-gap.md`
- detached Codex re-review `2026-04-07-W3-RUNTIME-01-codex-recheck` approved the packet:
  - no blocking findings remain
  - packet-local evidence for `analyze.ts` and `status.ts` is now accepted
  - `src/tui/app.tsx` remains the explicit `LegacyStore` defer, so BP-05 stays `mostly_aligned`
