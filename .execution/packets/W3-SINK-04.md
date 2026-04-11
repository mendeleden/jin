# Packet State

- packet: `W3-SINK-04`
- title: `Postgres Push Regression and Release Sink Validation`
- status: `needs_codex`
- assigned agent: `codex-WORKER-postgres-push-regression`
- branch: `feat/rewrite-ontology`
- worktree/container: `canonical repo workspace` / `local`
- depends on: `W2-SINK-02`, `W3-RUNTIME-01`
- unblocks: `clean-start local+remote Postgres sink confidence`, `honest release validation for sink delivery`, `follow-on local dogfood with real remote rows`
- last transition: `2026-04-08`
- next Codex action: `hold the remaining sink proof as a narrow follow-up while Claude Code and Cursor validation fixes are prioritized first, then rerun the clean-start validation on an unrestricted host before approval`
- latest review: `2026-04-08-W3-SINK-04-codex.md`

## Notes

- the fresh-start litmus rebuilt the binary, removed `~/.config/jin`,
  reprovisioned both Postgres sinks, and populated a clean SQLite store
- both configured Postgres sinks still stayed empty after ingest
- local `_jin_push_state.last_error` shows:
  - `Only use sql.begin, sql.reserved or max: 1`
- the worker handoff is code-complete and reviewed, but the packet still lacks
  unrestricted clean-start row-count proof because sandbox TCP/DNS blocked the
  post-fix local+remote validation rerun
- this lane is intentionally narrower than adapter/store validation:
  - `W3-VALIDATE-01` owns source-to-store reconciliation
  - `W3-SINK-04` owns store-to-sink delivery and the release-facing local /
    remote sink proof
