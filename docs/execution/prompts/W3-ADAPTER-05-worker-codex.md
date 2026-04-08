Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-WORKER-adapter-memory-contract-audit`.

This packet is `W3-ADAPTER-05`: Adapter Memory Contract Audit and Blueprint Hardening.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/blueprint/BP-02-data-flow.md`
6. `docs/blueprint/BP-04-adapter-contract.md`
7. `docs/execution/tasks/W3-ADAPTER-05-adapter-memory-contract-audit.md`
8. `docs/solutions/2026-04-08-adapter-memory-contract-gap.md`
9. `docs/execution/audits/2026-04-07-v2-runtime-bug-audit.md`

Then inspect:
- `src/pipeline/ingest.ts`
- all active adapters in `src/adapters/*.ts`
- focused adapter/pipeline tests under `test/`

Your job:
- audit whether the Codex RSS failure points to a broader adapter memory-contract gap
- classify each adapter as:
  - safe
  - blueprint/doc gap only
  - follow-on packet needed
- harden `BP-02` and/or `BP-04` so adapter memory behavior is explicit and reviewable
- add one reusable prevention artifact only if it clearly improves future packet reviews

Boundaries:
- do not change frozen adapter/store/sink interfaces
- do not turn this into broad adapter rewrites
- if an adapter needs real code changes, identify the packet instead of doing the rewrite here unless the fix is truly packet-local and tiny

Deliverables:
- blueprint/doc updates that close the contract gap
- a durable audit artifact under `docs/execution/audits/`
- completion report in your heartbeat

When complete, update:
- `.execution/agents/codex-WORKER-adapter-memory-contract-audit.md`

Do not edit:
- `.execution/program.md`
- `.execution/packets/*.md`

If packet-local validation helps, prefer read-only commands and focused tests only.
