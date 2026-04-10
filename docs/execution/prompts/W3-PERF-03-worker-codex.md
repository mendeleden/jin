Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-WORKER-v2-performance-harness`.

You are not alone in the shared canonical workspace. Other workers are active.
Stay strictly inside this packet's owned files and do not revert anyone else's
edits.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/execution/performance-persona-council.md`
6. `docs/execution/tasks/W3-PERF-03-repeatable-v2-performance-harness.md`

Then read the shared control plane first:
- `.execution/program.md`
- `.execution/packets/W3-PERF-03.md`
- `.execution/packets/W3-PERF-02.md`
- `.execution/packets/W3-SCALE-01.md`

Before coding, create or update your heartbeat at
`.execution/agents/codex-WORKER-v2-performance-harness.md` with:
- preferred session name: `codex-WORKER-v2-performance-harness`
- packet id: `W3-PERF-03`
- branch / worktree / container: `feat/rewrite-ontology` / `canonical repo workspace` / `local`
- status: `in_progress`

Then execute the packet exactly.

Constraints:
- only edit packet-owned files
- do not edit adapters, contracts, sinks, or blueprint files
- prefer a durable harness over one-off local commands
- if the lightest correct path is to replace `jin benchmark`, do so only if the
  result is clearly better than the legacy path and remains packet-local

Deliverables:
- repeatable v2 perf harness
- machine-readable phase artifacts
- local runbook / exact commands
- a short persona-council synthesis in the completion report
- completion report in the packet format
