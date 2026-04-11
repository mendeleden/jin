# Packet State

- packet: `W3-PERF-01`
- title: `Codex Ingest RSS Budget`
- status: `approved`
- assigned agent: `codex-WORKER-codex-ingest-rss-budget`
- branch: `feat/rewrite-ontology`
- worktree/container: `canonical repo workspace` / `local`
- depends on: `W3-RUNTIME-01`, `W3-E2E-01`
- unblocks: `successful installed-binary Codex ingest`, `experimental dogfood go/no-go`
- last transition: `2026-04-08`
- next Codex action: `rerun installed-binary validation on the committed baseline`
- latest review: `2026-04-08-W3-PERF-01-codex-recheck`

## Notes

- installed-binary validation repeatedly exceeded the `256 MB` RSS hard limit
  during Codex ingest
- do not treat this as a limit-tuning packet; the goal is memory-profile
  reduction while preserving the BP-02 guard
- durable representative validation now exists in
  `docs/execution/audits/2026-04-07-W3-PERF-01-codex-rss-validation.md`
