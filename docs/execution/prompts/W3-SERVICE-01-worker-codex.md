Work in `/tmp/jin-w3-service-01`.

Use session name `codex-WORKER-local-service-rollout`.

You are not alone in the broader project. The canonical workspace contains
in-progress `W3-ADAPTER-06` changes, so this packet must stay in the isolated
clean worktree and must not read product code from the canonical workspace
except for the execution docs/control plane.

Read in order:
1. `/Users/edenmendel/Documents/GitHub/jin/docs/execution/00-global-rules.md`
2. `/Users/edenmendel/Documents/GitHub/jin/docs/execution/01-dispatch-protocol.md`
3. `/Users/edenmendel/Documents/GitHub/jin/docs/execution/04-frozen-contract-surface.md`
4. `/Users/edenmendel/Documents/GitHub/jin/docs/execution/05-live-control-plane.md`
5. `/Users/edenmendel/Documents/GitHub/jin/docs/execution/tasks/W3-SERVICE-01-bump-version-build-install-service.md`

Then execute the packet exactly.

Read the shared control plane first:
- `/Users/edenmendel/Documents/GitHub/jin/.execution/program.md`
- `/Users/edenmendel/Documents/GitHub/jin/.execution/blueprints.md`
- `/Users/edenmendel/Documents/GitHub/jin/.execution/packets/W3-SERVICE-01.md`
- `/Users/edenmendel/Documents/GitHub/jin/.execution/packets/W3-PERF-01.md`
- `/Users/edenmendel/Documents/GitHub/jin/.execution/reviews/2026-04-08-W3-PERF-01-codex-recheck.md`

Before coding, update your heartbeat at:
- `/Users/edenmendel/Documents/GitHub/jin/.execution/agents/codex-WORKER-local-service-rollout.md`

Constraints:
- edit product code only in this worktree
- owned product files are only `package.json` and `src/updater.ts`
- write the audit artifact only at `/Users/edenmendel/Documents/GitHub/jin/docs/execution/audits/2026-04-08-W3-SERVICE-01-local-service-rollout.md`
- do not edit canonical workspace product files
- do not widen into runtime or service bug fixing

Use full host access because this packet must install the binary under
`~/.local/bin` and operate launchd.

Return the completion report in the exact format from
`/Users/edenmendel/Documents/GitHub/jin/docs/execution/00-global-rules.md`.
