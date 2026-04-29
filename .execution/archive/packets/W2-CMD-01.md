# Packet State

- packet: `W2-CMD-01`
- title: `Read-Only Query Surface`
- status: `approved`
- assigned agent: `codex-WORKER-read-only-query-surface`
- branch: `feat/rewrite-ontology`
- worktree/container: `canonical repo workspace`
- depends on: `W1-DB-01`, `W1-LIFECYCLE-01`
- unblocks: `read-only v2 usability`
- last transition: `2026-04-02`
- next Codex action: `carry the API-shape and export-command bridges as informational follow-up while the read-only v2 surface is considered stable`
- latest review: `2026-04-02-W2-CMD-01-cursor`

## Notes

- verified worker heartbeat exists at
  `.execution/agents/codex-WORKER-read-only-query-surface.md`
- preferred session name: `codex-WORKER-read-only-query-surface`
- verified branch/worktree are `feat/rewrite-ontology` in the canonical repo
  workspace
- verified actual diff: `src/commands/show.ts`, `src/commands/list.ts`,
  `src/commands/search.ts`, `src/commands/export.ts`,
  `src/api/routes.ts`, `src/db/query-surface.ts`, and
  `test/read-only-query-surface.test.ts`
- verified packet test run: `bun test test/read-only-query-surface.test.ts`
- `2026-04-02-W2-CMD-01-cursor` approves the packet with informational drift
  notes only
