Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-WORKER-live-runtime-store-cutover`.

You are not alone in the shared canonical workspace. Other workers may be active. Stay strictly inside this packet's owned files, do not revert anyone else's edits, and do not absorb team/bootstrap, startup privacy, sink-internal, or unrelated product-surface work.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/execution/tasks/W3-RUNTIME-01-live-runtime-store-cutover.md`

Then execute the packet exactly.

Read the shared control plane first:
- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-RUNTIME-01.md`
- `.execution/packets/W3-STARTUP-01.md`
- `.execution/packets/W3-TEAM-01.md`
- `.execution/reviews/2026-04-04-AUDIT-bp-drift-claude.md`
- `.execution/reviews/2026-04-04-AUDIT-v1-bridges-claude.md`

Before coding, create or update your heartbeat at `.execution/agents/codex-WORKER-live-runtime-store-cutover.md` with:
- preferred session name: `codex-WORKER-live-runtime-store-cutover`
- packet id: `W3-RUNTIME-01`
- branch / worktree / container: `feat/rewrite-ontology` / `canonical repo workspace` / `local`
- status: `in_progress`

Only then read the exact BP docs and code files named in the packet:
- `docs/blueprint/BP-01-module-map.md`
- `docs/blueprint/BP-02-data-flow.md`
- `docs/blueprint/BP-05-store-and-migration.md`
- `docs/blueprint/BP-07-process-lifecycle.md`
- `docs/blueprint/BP-08-routing-and-config.md`
- `src/commands/start.ts`
- `src/commands/watch.ts`
- `src/commands/ingest.ts`
- `src/commands/status.ts`
- `src/commands/analyze.ts`
- `src/tui/app.tsx`
- `src/store.ts`
- `src/adapters/types.ts`
- `src/pipeline/**`
- `src/db/**`

Current program context:
- `W3-TEAM-01` is approved and ready to commit
- `W3-STARTUP-01` is approved and committed
- the main remaining architectural drift is the live runtime/store path:
  - `jin start` still uses `src/commands/watch.ts`
  - production writes still flow through `src/store.ts`
  - the v2 `src/pipeline/loop.ts` + `src/db/store.ts` path exists but is not the live runtime

Constraints:
- only edit packet-owned runtime/store/pipeline files and focused tests
- do not edit `src/contracts/**`
- do not edit `src/sinks/**` except read-only inspection
- do not widen into team/bootstrap or startup privacy lanes
- if the smallest safe cut cannot fully land in one packet, stop and escalate with a precise split recommendation

Target deliverables:
- live runtime entry uses the v2 coordinator/store path
- live writes no longer depend on `src/store.ts`
- one-shot ingest no longer bypasses the single-brain invariant, or is explicitly deferred with Codex approval
- focused verification proving the live path changed for real

Acceptance checks:
- `jin start` / foreground runtime path reaches the BP-02 coordinator path
- runtime writes reach `src/db/store.ts`, not `src/store.ts`
- focused tests validate the cutover rather than only dormant v2 modules
- completion report states clearly whether the repo can now honestly claim the v2 rewrite is the live runtime

Return the completion report in the exact format from `docs/execution/00-global-rules.md`.
