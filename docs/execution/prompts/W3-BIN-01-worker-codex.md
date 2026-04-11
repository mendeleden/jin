Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-WORKER-local-binary-smoke`.

You are not alone in the shared canonical workspace. Other workers may be
active. This lane is build/smoke only. Do not edit product code. You may write
only the packet-owned audit artifact plus your heartbeat.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/execution/tasks/W3-BIN-01-rebuild-and-local-binary-smoke.md`

Then execute the packet exactly.

Read the shared control plane first:
- `.execution/program.md`
- `.execution/packets/W3-BIN-01.md`
- `.execution/packets/W3-PERF-01.md`

Before running commands, create or update your heartbeat at
`.execution/agents/codex-WORKER-local-binary-smoke.md` with:
- preferred session name: `codex-WORKER-local-binary-smoke`
- packet id: `W3-BIN-01`
- branch / worktree / container: `feat/rewrite-ontology` / `canonical repo workspace` / `local`
- status: `in_progress`

Then run only the bounded smoke command set from the packet and write the audit
artifact at:
- `docs/execution/audits/2026-04-08-W3-BIN-01-local-binary-smoke.md`

Constraints:
- do not edit product code
- do not install the binary outside the repo
- do not use service mode or launchd
- do not overclaim beyond the exact smoke commands you ran

Return the completion report in the exact format from
`docs/execution/00-global-rules.md`.
