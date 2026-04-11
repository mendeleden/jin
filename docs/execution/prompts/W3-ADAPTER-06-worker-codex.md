Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-WORKER-claude-code-memory-hardening`.

You are not alone in the shared canonical workspace. Other workers may be
active. Stay strictly inside this packet's owned files, do not revert anyone
else's edits, and do not absorb pipeline/store/recovery, sink, Team/bootstrap,
or unrelated product work.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/execution/tasks/W3-ADAPTER-06-claude-code-discover-load-memory-hardening.md`

Then execute the packet exactly.

Read the shared control plane first:
- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-ADAPTER-05.md`
- `.execution/packets/W3-ADAPTER-06.md`
- `.execution/reviews/2026-04-07-W3-ADAPTER-05-codex.md`

Before coding, create or update your heartbeat at
`.execution/agents/codex-WORKER-claude-code-memory-hardening.md` with:
- preferred session name: `codex-WORKER-claude-code-memory-hardening`
- packet id: `W3-ADAPTER-06`
- branch / worktree / container: `feat/rewrite-ontology` / `canonical repo workspace` / `local`
- status: `in_progress`

Only then read the exact BP docs and code files named in the packet:
- `docs/blueprint/BP-02-data-flow.md`
- `docs/blueprint/BP-04-adapter-contract.md`
- `docs/execution/audits/2026-04-07-adapter-memory-contract-audit.md`
- `src/adapters/claude-code.ts`
- `test/claude-code-reference-adapter.test.ts`
- any focused packet-local Claude Code memory tests you add

Current program context:
- `W3-ADAPTER-05` is approved and identified `claude-code` as the one explicit
  follow-on adapter-side memory hazard
- do not broaden this into a generic adapter or pipeline rewrite
- the required outcome is a bounded discover/load split for Claude Code with
  representative packet-local proof

Constraints:
- only edit packet-owned files
- do not edit `src/contracts/**`
- do not edit sink/store/runtime/Team/bootstrap code
- preserve deterministic IDs and current bundle semantics
- stop and escalate if the fix would require widening frozen contracts

Target deliverables:
- Claude Code discovery no longer retains full bundles across changed files
- focused tests keep existing semantics intact
- packet-local validation states the measurement path and why it closes the
  Claude Code follow-on from `W3-ADAPTER-05`

Acceptance checks:
- focused Claude Code adapter tests stay green
- the retained-bundle discovery path identified in the audit is removed or
  explicitly bounded with eviction
- completion report cites code + tests for every BP Acceptance Matrix row

Return the completion report in the exact format from
`docs/execution/00-global-rules.md`.
