# Packet State

- packet: `W3-VALIDATE-01`
- title: `Live Adapter Validation And Store Reconciliation`
- status: `approved`
- assigned agent: `codex-WORKER-live-adapter-validation`
- branch: `feat/rewrite-ontology`
- worktree/container: `canonical repo workspace` / `local`
- depends on: `W3-PERF-03`, `W3-ADAPTER-07`
- unblocks: `repeatable live-data validation before local dogfood`, `source-vs-store sanity checks`, `future pre-release adapter confidence`
- last transition: `2026-04-08`
- next Codex action: `treat the Claude Code duplicate-ID / messages.id collision fix plus live revalidation as the next adapter priority, then do the Cursor null-bundle / DB-open follow-up, then return to sink reconciliation`
- latest review: `2026-04-08-W3-VALIDATE-01-codex.md`

## Notes

- the current perf/dataset work improves repeatability, but we still lack a
  dedicated lane that runs against live local adapter data before declaring the
  runtime safe for dogfood
- recent failures were only visible on real `~/.codex` and `~/.claude`
  directories, not fixture-only runs
- we need a durable harness and audit that compare:
  - source files / discovered refs / loaded bundles
  - stored conversations / messages / tool calls in the temp SQLite store
  - mismatches by adapter and likely root cause
