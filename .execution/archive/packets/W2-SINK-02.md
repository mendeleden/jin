# Packet State

- packet: `W2-SINK-02`
- title: `Postgres Reference Sink`
- status: `approved`
- assigned agent: `codex-WORKER-postgres-reference-sink`
- branch: `feat/rewrite-ontology`
- worktree/container: `canonical repo workspace` / `local`
- depends on: `W1-SINK-01`
- unblocks: `table sink family validation`
- last transition: `2026-04-04`
- next Codex action: `commit the isolated Postgres sink fix and carry the remaining BP-06 notes as non-blocking follow-up`
- latest review: `2026-04-04-W2-SINK-02-cursor-recheck`

## Notes

- verified worker heartbeat exists at
  `.execution/agents/codex-WORKER-postgres-reference-sink.md`
- preferred session name: `codex-WORKER-postgres-reference-sink`
- verified branch/worktree are `feat/rewrite-ontology` in the canonical repo
  workspace
- verified actual diff: `src/sinks/postgres.ts` and
  `test/postgres-reference-sink.test.ts`
- verified packet test run: `bun test test/postgres-reference-sink.test.ts`
- `2026-04-04-W2-SINK-02-cursor-recheck` approves the packet:
  - missing-table detection now keys on actual missing-table signals
  - permission/auth failures on `jin_meta` surface the real error instead of
    the missing-schema message
  - regression coverage now includes the permission-denied case
- informational items remain explicitly non-blocking:
  - DELETE+INSERT write strategy for messages/tool calls
  - missing minor-version warning
  - legacy dual-interface bridge
