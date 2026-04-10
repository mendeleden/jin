Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-REVIEWER-v1-surface-cleanup`.

You are the Codex reviewer/committer for `W3-CLEANUP-01`.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/tasks/W3-CLEANUP-01-remove-ui-and-v1-bridges.md`
5. `.execution/program.md`
6. `.execution/blueprints.md`
7. `.execution/packets/W3-PRODUCT-01.md`
8. `.execution/packets/W3-RUNTIME-01.md`
9. `.execution/packets/W3-CLEANUP-01.md`
10. `.execution/agents/codex-WORKER-v1-surface-cleanup.md`
11. `.execution/logs/codex-WORKER-v1-surface-cleanup-last.txt`

Then review only the packet-owned code/test files and the cleanup diff.

Your job:
- verify the cleanup worker stayed inside packet scope
- look for regressions or missed deletions around TUI/dashboard/v1 bridge removal
- if the lane is clean, create `.execution/reviews/2026-04-09-W3-CLEANUP-01-codex.md`
- sync the control plane for the cleanup lane
- stage only the cleanup packet files plus the cleanup review/control-plane files
- make one focused commit for the cleanup lane

Required control-plane behavior:
- update `.execution/agents/codex-REVIEWER-v1-surface-cleanup.md` on start and as review progresses
- if approved, update `.execution/packets/W3-CLEANUP-01.md` to `approved`
- update `.execution/program.md` and `docs/tmp-diagram/current-program-state.mmd` so the cleanup lane status is synchronized

Commit boundary:
- include only the cleanup lane and its control-plane artifacts
- do not stage or commit sink/schema validation files, perf/BP lanes, or unrelated docs
- if `package.json` is included, keep its current `0.8.4` version and the cleanup build-surface changes together

Cleanup lane file boundary for staging:
- `docs/blueprint/BP-09-cli-split.md`
- `package.json`
- `src/index.ts`
- `src/commands/connect.ts`
- `src/commands/start.ts`
- `src/commands/stop.ts`
- `src/commands/team-bridge.ts`
- `src/db/schema.ts`
- `src/store.ts`
- `src/daemon/process-state.ts`
- `src/api/control.ts`
- `src/commands/init.ts`
- `src/commands/team-config.ts`
- `src/api/server.ts`
- `src/api/_spa.ts`
- `scripts/embed-spa.ts`
- `src/tui/**`
- `dashboard/**`
- `test/connect.test.ts`
- `test/config-mutation-control.test.ts`
- `test/local-control-boundary.test.ts`
- `test/lifecycle-boundary.test.ts`
- `test/team-bootstrap.test.ts`
- `test/runtime-store-cutover.test.ts`
- `test/cli-surface-cleanup.test.ts`
- `test/init.test.ts`
- `test/perf-harness/harness.sh`
- `.execution/packets/W3-CLEANUP-01.md`
- `.execution/agents/codex-REVIEWER-v1-surface-cleanup.md`
- `.execution/reviews/2026-04-09-W3-CLEANUP-01-codex.md`
- `.execution/program.md`
- `docs/tmp-diagram/current-program-state.mmd`

Validation expectation:
- rerun focused cleanup checks if needed, at minimum the reviewer should leave a defensible reason for the final commit

Commit message:
- `cleanup: remove tui and v1 bridge surfaces`

Stop and escalate instead of committing if:
- you find a blocker or a packet-scope violation
- the commit would need sink/schema files or other unrelated lanes
- the cleanup diff is not internally coherent yet
