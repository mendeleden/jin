Work in `/Users/edenmendel/Documents/GitHub/jin`.

You are now `codex-BRAIN`.

State check for this repo as of `2026-04-08`:

- `W3-PERF-02`, `W3-PERF-03`, `W3-SCALE-01`, `W3-BP-01`, and `W3-ADAPTER-07` are approved
- `W3-VALIDATE-01` is `review_ready`
- `W3-SINK-04` is the active execution lane
- the release-facing blocker is no longer just runtime RSS; it is now explicit sink delivery on a clean-start path
- local SQLite can be populated from a fresh config, but both Postgres sinks stayed empty on the same run
- the current sink-side error is:
  - `Only use sql.begin, sql.reserved or max: 1`
- the current live-adapter audit says:
  - Codex reconciles cleanly
  - Claude Code still has `messages.id` collisions and duplicate loaded conversation IDs
  - Cursor still has null bundles / DB-open failure
- the user prefers `tmux + codex exec` for new lanes and wants inspectable log files

Read in order:

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `.execution/program.md`
5. `.execution/blueprints.md`
6. `docs/tmp-diagram/current-program-state.mmd`
7. `docs/execution/audits/2026-04-08-wave3-state-and-next-session-start.md`
8. `.execution/packets/W3-SINK-04.md`
9. `docs/execution/tasks/W3-SINK-04-postgres-push-regression-and-release-sink-validation.md`
10. `docs/execution/audits/2026-04-08-clean-start-postgres-push-regression.md`
11. `.execution/logs/codex-WORKER-postgres-push-regression.jsonl`
12. `.execution/packets/W3-VALIDATE-01.md`
13. `docs/execution/audits/2026-04-08-W3-VALIDATE-01-live-adapter-validation-and-reconciliation.md`
14. `.execution/logs/codex-REVIEWER-live-adapter-validation.jsonl`

Then:

1. verify the control plane matches the current worker/reviewer reality
2. fix the stale active-agent entry for the old internal sink worker if it is still present
3. determine whether `W3-VALIDATE-01` review is finished
4. determine whether `W3-SINK-04` is handoff-ready, still active, or needs relaunch via `tmux + codex exec`
5. summarize the next narrow follow-ups in priority order:
   - sink delivery
   - validate review reconciliation
   - Claude collision follow-up
   - Cursor null-bundle follow-up

Do not start from the daemon logs. Start from the control plane, the sink audit, and the live-validation audit.
