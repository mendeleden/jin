Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-WORKER-live-config-cutover-blueprint`.

You are not alone in the shared canonical workspace. Other workers may be
active. Stay strictly inside this packet's owned files and do not revert anyone
else's edits.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `.execution/reviews/2026-05-03-config-reload-push-worker-tooling-council.md`
6. `docs/execution/tasks/W3-BP-02-live-config-cutover-blueprint-hardening.md`

Then read the shared control plane first:
- `.execution/program.md`
- `.execution/packets/W3-BP-02.md`

Then read the packet-owned docs:
- `docs/blueprint/BP-02-data-flow.md`
- `docs/blueprint/BP-06-sink-contract.md`
- `docs/blueprint/BP-07-process-lifecycle.md`
- `docs/blueprint/BP-08-routing-and-config.md`
- `docs/execution/audits/2026-05-03-W3-BP-02-live-config-cutover-cuj-matrix.md`
- `docs/solutions/2026-05-03-live-config-reload-needs-atomic-writes-and-coordinator-owned-apply.md`

Before editing, create or update your heartbeat at
`.execution/agents/codex-WORKER-live-config-cutover-blueprint.md` with:
- preferred session name: `codex-WORKER-live-config-cutover-blueprint`
- packet id: `W3-BP-02`
- branch / worktree / container: `main` / `canonical repo workspace` / `local`
- status: `in_progress`

Constraints:
- only edit packet-owned blueprint/docs files
- do not edit `src/**` or `test/**`
- do not widen sink interfaces
- do not reopen the ontology model

Deliverables:
- blueprint hardening that makes generation cutover and fail-closed behavior
  explicit
- operator-visible status/diagnostic requirements for interruption and replay
- a reusable CUJ matrix for later validation packets
- completion report in the packet format
