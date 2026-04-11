Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-WORKER-v1-surface-cleanup`.

You are executing the Codex-owned cleanup packet `W3-CLEANUP-01`.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/tasks/W3-CLEANUP-01-remove-ui-and-v1-bridges.md`

Then execute the packet exactly.

Read the shared control plane first:
- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-PRODUCT-01.md`
- `.execution/packets/W3-RUNTIME-01.md`
- `.execution/packets/W3-CLEANUP-01.md`

Then read only the BP docs, code files, and tests named in the packet.

Required live-state behavior:
- create or update `.execution/agents/codex-WORKER-v1-surface-cleanup.md` on start
- keep heartbeat, focus, and blockers current while working

Constraints:
- do not redesign future desktop work
- do not redesign the future daemon query mechanism
- do not change adapter/sink frozen contracts
- if packet scope must widen beyond UI + explicit v1-bridge cleanup, stop and
  escalate instead of drifting
- generic BYO sinks remain first-class; remove only the compatibility shortcut
  paths that bypass the explicit `jin sink` / `jin route` flow

Required output:
- concise completion report in the `00-global-rules.md` format
- BP Acceptance Matrix
- V1 Comparison section
- explicit list of removed CLI/runtime compatibility surfaces
- explicit list of any intentionally retained compatibility surfaces, if any
