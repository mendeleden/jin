Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-WORKER-remove-tui-and-spa`.

You are executing the Codex-owned cleanup packet `W3-UI-01`.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/tasks/W3-UI-01-remove-tui-and-spa.md`

Then execute the packet exactly.

Read the shared control plane first:
- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-RUNTIME-01.md`
- `.execution/packets/W3-UI-01.md`

Then read the packet-owned code and tests:
- `package.json`
- `src/index.ts`
- `src/commands/start.ts`
- `src/commands/stop.ts`
- `src/daemon/process-state.ts`
- `src/api/server.ts`
- `src/api/routes.ts`
- `src/api/control.ts`
- `scripts/embed-spa.ts`
- `src/api/_spa.ts`
- `src/tui/**`
- `dashboard/**`
- focused lifecycle/help/API tests under `test/`

Constraints:
- do not redesign the future desktop app
- do not redesign the future local daemon query mechanism
- if `src/api/routes.ts` / `src/api/control.ts` can stay as library code, prefer
  leaving them rather than widening scope
- if `W3-RUNTIME-01` is still actively changing the same files, stop and
  escalate instead of conflicting with it

Required output:
- concise completion report in the `00-global-rules.md` format
- BP Acceptance Matrix
- explicit list of removed UI bindings
- explicit list of any query/control library surfaces intentionally left in
  place for future desktop work
