Work in `/tmp/jin-w3-pr-01`.

Use session name `codex-WORKER-pr-to-main`.

You are not alone in the broader project. The canonical workspace is dirty with
in-progress work and must not become the PR source. This packet must use the
isolated clean worktree only for git/PR operations.

Read in order:
1. `/Users/edenmendel/Documents/GitHub/jin/docs/execution/00-global-rules.md`
2. `/Users/edenmendel/Documents/GitHub/jin/docs/execution/01-dispatch-protocol.md`
3. `/Users/edenmendel/Documents/GitHub/jin/docs/execution/05-live-control-plane.md`
4. `/Users/edenmendel/Documents/GitHub/jin/docs/execution/tasks/W3-PR-01-prepare-pr-to-main.md`

Then execute the packet exactly.

Read the control plane first:
- `/Users/edenmendel/Documents/GitHub/jin/.execution/program.md`
- `/Users/edenmendel/Documents/GitHub/jin/.execution/blueprints.md`
- `/Users/edenmendel/Documents/GitHub/jin/.execution/packets/W3-PR-01.md`
- `/Users/edenmendel/Documents/GitHub/jin/.execution/packets/W3-PERF-01.md`
- `/Users/edenmendel/Documents/GitHub/jin/.execution/reviews/2026-04-08-W3-PERF-01-codex-recheck.md`

Before doing git/PR work, update your heartbeat at:
- `/Users/edenmendel/Documents/GitHub/jin/.execution/agents/codex-WORKER-pr-to-main.md`

Constraints:
- operate only in `/tmp/jin-w3-pr-01` for git/PR actions
- write the audit artifact only at `/Users/edenmendel/Documents/GitHub/jin/docs/execution/audits/2026-04-08-W3-PR-01-pr-prep.md`
- do not edit canonical workspace product files
- if GitHub auth is invalid, stop after preparing the branch and PR body and record the exact blocker

Use full host access because this packet may need `git push` and `gh pr create`.

Return the completion report in the exact format from
`/Users/edenmendel/Documents/GitHub/jin/docs/execution/00-global-rules.md`.
