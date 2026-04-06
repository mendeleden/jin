Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-WORKER-protected-source-opt-in`.

You are not alone in the shared canonical workspace. Stay strictly inside this
packet's owned files, do not revert anyone else's edits, and do not widen into
pipeline, sink, or schema work.

Read in order:

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/tasks/W3-STARTUP-01-protected-source-opt-in.md`

Then execute the packet exactly.

Read the shared control plane first:

- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-STARTUP-01.md`
- `.execution/packets/W3-PRODUCT-01.md`
- `.execution/reviews/2026-04-04-W3-PRODUCT-01-claude.md`

Before coding, create or update your heartbeat at:

- `.execution/agents/codex-WORKER-protected-source-opt-in.md`

with:

- preferred session name: `codex-WORKER-protected-source-opt-in`
- packet id: `W3-STARTUP-01`
- branch / worktree / container: `feat/rewrite-ontology` / `canonical repo workspace` / `local`
- status: `in_progress`

Only then read the exact BP docs and current code named in the packet:

- `docs/execution/04-frozen-contract-surface.md`
- `docs/blueprint/BP-04-adapter-contract.md`
- `docs/blueprint/BP-07-process-lifecycle.md`
- `docs/blueprint/BP-08-routing-and-config.md`
- `src/config.ts`
- `src/adapters/registry.ts`
- `src/adapters/cursor.ts`
- `src/adapters/kiro.ts`
- `src/adapters/opencode.ts`
- `src/adapters/warp.ts`
- `src/adapters/claude-code.ts`
- `src/adapters/codex.ts`
- `src/commands/start.ts`
- `src/commands/watch.ts`
- `src/commands/init.ts`
- startup/detection-focused tests under `test/`

Current program context:

- `W3-PRODUCT-01` is approved
- `W3-STARTUP-01` is the next release-facing hardening lane
- current startup risk is protected/app-private adapter probing, especially
  macOS `Application Support` sources such as Cursor's `state.vscdb`

Constraints:

- only edit startup/detection/config files inside the packet boundary
- do not edit `src/contracts/**`, `src/db/**`, `src/pipeline/**`, or `src/sinks/**`
- do not widen into command-surface reframing outside startup/detection behavior
- do not use installer- or entitlement-level OS workarounds

Target deliverables:

- explicit startup policy for protected/app-private adapter sources by OS
- no startup probe of protected/app-private data without explicit opt-in
- no startup auto-enable/writeback of disabled adapters
- user-visible config/help wording for opt-in behavior where needed
- focused tests proving the gating behavior

Required output at handoff:

- updated packet/control-plane state
- concise completion report in the `00-global-rules.md` format
- BP Acceptance Matrix
- V1 Comparison
- explicit list of protected-source adapters covered
- explicit list of any adapters deferred and why
