# W3-UI-01: Remove TUI and SPA Dashboard Surface

## Role

Codex-owned cleanup packet.

## Goal

Remove the current terminal UI, embedded SPA dashboard, and the CLI/build/runtime
bindings that exist only to support them.

This packet is a removal packet, not a redesign packet. It should simplify the
binary and CLI surface now, while leaving future desktop work and future local
daemon query mechanisms for later packets.

## Depends On

- `W3-RUNTIME-01-live-runtime-store-cutover.md`
- stable enough `W3-PRODUCT-01` command surface

## Unblocks

- simpler build and runtime surface
- removal of the explicit `src/tui/app.tsx` legacy-store defer
- future desktop/query work without carrying the current dashboard stack

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/blueprint/BP-01-module-map.md`
5. `docs/blueprint/BP-07-process-lifecycle.md`
6. `docs/blueprint/BP-08-routing-and-config.md`
7. `docs/blueprint/BP-09-cli-split.md`
8. `.execution/program.md`
9. `.execution/blueprints.md`
10. `.execution/packets/W3-RUNTIME-01.md`
11. `package.json`
12. `src/index.ts`
13. `src/commands/start.ts`
14. `src/commands/stop.ts`
15. `src/daemon/process-state.ts`
16. `src/api/server.ts`
17. `src/api/routes.ts`
18. `src/api/control.ts`
19. `scripts/embed-spa.ts`
20. `src/api/_spa.ts`
21. `src/tui/**`
22. `dashboard/**`
23. lifecycle/help/API tests under `test/`

## Owned Files

- `package.json`
- `src/index.ts`
- `src/commands/start.ts`
- `src/commands/stop.ts`
- `src/daemon/process-state.ts`
- `src/api/server.ts`
- `src/api/_spa.ts`
- `scripts/embed-spa.ts`
- `src/tui/**`
- `dashboard/**`
- focused lifecycle/help/build tests under `test/`

## Forbidden Files

- `src/contracts/**`
- sink, adapter, or pipeline internals outside read-only verification
- future desktop-app code
- redesign of the daemon query protocol

## Deliverables

- no `jin ui` command surface remains
- no `--ui`, `--all`, or dashboard-specific lifecycle flags remain
- the compiled build no longer embeds or builds the dashboard
- the current TUI and SPA files are removed
- runtime/control state no longer reports a `dashboard` component if the
  component no longer exists
- query/control library code that is not SPA-specific is left alone or clearly
  deferred

## Non-Goals

- designing the future desktop app
- redesigning `src/api/routes.ts` for the future query mechanism
- removing local read/query commands
- replacing the removed UI with another client

## BP Acceptance Matrix

| Requirement | Blueprint | Expected evidence |
|-------------|-----------|-------------------|
| CLI surface no longer exposes the current dashboard/TUI path | BP-07, BP-09 | `src/index.ts`, focused help tests |
| Lifecycle/state reporting no longer models a removed dashboard component | BP-07 | `src/commands/start.ts`, `src/commands/stop.ts`, `src/daemon/process-state.ts`, focused lifecycle/control tests |
| Build/install path no longer embeds or depends on the SPA dashboard | BP-01 | `package.json`, removal of `scripts/embed-spa.ts` / `src/api/_spa.ts`, build checks |
| Current TUI and SPA code are removed without widening into desktop/query redesign | BP-01, BP-Product | diff scope, deleted files, completion report |

Every row must be resolved in the completion report as:
- implemented, with code + test citation
- deferred, with Codex approval
- out of scope, with boundary citation

## Acceptance Checks

- `jin --help` no longer advertises `ui`
- `jin start` / `jin stop` help no longer mention dashboard flags
- `package.json` no longer builds the dashboard as part of the binary build
- `src/tui/**` and `dashboard/**` are removed or dead-free
- no runtime import still depends on `src/api/server.ts` or `src/tui/app.tsx`

## Stop And Escalate

Stop if:

- future desktop/query work is required to complete the removal
- packet scope must absorb unrelated API redesign
- the smallest safe slice is narrower than “remove bindings, leave library code”

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

BP acceptance matrix:
- <requirement> -> implemented in <file>, tested by <test>
- <requirement> -> deferred with Codex approval
- <requirement> -> out of scope per packet boundary

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
