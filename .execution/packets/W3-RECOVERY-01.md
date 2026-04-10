# Packet State

- packet: `W3-RECOVERY-01`
- title: `Poisoned Local Store Detection and Reset Guidance`
- status: `approved`
- assigned agent: `codex-WORKER-poisoned-local-store-recovery`
- branch: `feat/rewrite-ontology`
- worktree/container: `canonical repo workspace` / `local`
- depends on: `W3-RUNTIME-01`, `W3-E2E-01`
- unblocks: `clear experimental recovery story`, `less confusing post-crash local behavior`
- last transition: `2026-04-08`
- next Codex action: `commit only the recovery-owned repo files and leave perf/audit lanes isolated`
- latest review: `2026-04-07-W3-RECOVERY-01-codex`

## Notes

- after the RSS hard shutdown, the local SQLite store began surfacing
  `SQLITE_READONLY` / `SQLITE_CANTOPEN`
- experimental v2 should surface explicit hard-reset guidance instead of raw
  SQLite errors
