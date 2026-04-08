Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-WORKER-poisoned-local-store-recovery`.

You are not alone in the shared canonical workspace. Other workers may be active. Stay strictly inside this packet's owned files, do not revert anyone else's edits, and do not absorb Codex perf, sink-internal, Team/bootstrap, or unrelated product work.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/tasks/W3-RECOVERY-01-poisoned-local-store-reset-guidance.md`

Then execute the packet exactly.

Read the shared control plane first:
- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-RECOVERY-01.md`
- `.execution/packets/W3-E2E-01.md`
- `.execution/packets/W3-RUNTIME-01.md`
- `docs/solutions/2026-04-08-rss-shutdown-poisons-local-sqlite-store.md`

Before coding, create or update your heartbeat at `.execution/agents/codex-WORKER-poisoned-local-store-recovery.md` with:
- preferred session name: `codex-WORKER-poisoned-local-store-recovery`
- packet id: `W3-RECOVERY-01`
- branch / worktree / container: `feat/rewrite-ontology` / `canonical repo workspace` / `local`
- status: `in_progress`

Only then read the exact BP docs and code files named in the packet:
- `docs/blueprint/BP-05-store-and-migration.md`
- `docs/blueprint/BP-07-process-lifecycle.md`
- `docs/execution/experimental-v2-reset-and-install.md`
- `docs/solutions/2026-04-08-rss-shutdown-poisons-local-sqlite-store.md`
- `src/db/store.ts`
- `src/db/schema.ts`
- `src/commands/start.ts`
- `src/commands/ingest.ts`
- `src/commands/status.ts`
- focused store/runtime tests under `test/`

Current program context:
- after the RSS hard shutdown, local commands started surfacing raw SQLite errors such as `attempt to write a readonly database` and `unable to open database file`
- experimental v2 should tell the user to hard-reset local state instead of surfacing raw SQLite stacks
- do not add automatic repair or a new reset command

Constraints:
- only edit packet-owned files
- do not edit `src/contracts/**`
- do not silently delete user state
- if the smallest safe fix requires store-schema redesign, stop and escalate

Target deliverables:
- poisoned-store startup / ingest paths emit clear reset guidance
- focused tests prove the mapped recovery output
- docs and runtime messaging stay aligned

Acceptance checks:
- poisoned-store failures produce actionable reset output
- raw Bun/SQLite stack traces are not shown for the mapped signature
- no automatic destructive action is taken by the daemon

Return the completion report in the exact format from `docs/execution/00-global-rules.md`.
