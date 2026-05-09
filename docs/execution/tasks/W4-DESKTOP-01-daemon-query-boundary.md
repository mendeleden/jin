# W4-DESKTOP-01: Daemon Query Boundary For Desktop

## Role

Worker packet.

## Goal

Implement the first daemon-hosted read-only query boundary for future Desktop
clients so the long-lived runtime can answer overview, conversation, and search
queries without creating a second runtime or reviving the removed dashboard
surface.

## Depends On

- `W2-DAEMON-02-local-control-boundary.md`
- `W2-CMD-01-read-only-query-surface.md`
- `W3-UI-01-remove-tui-and-spa.md`

## Unblocks

- future Electron/Desktop daemon-client work
- daemon-backed local query flows that should not require direct SQLite access

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/blueprint/BP-07-process-lifecycle.md`
3. `docs/blueprint/BP-Product-Strategy.md`
4. `docs/blueprint/BP-01-module-map.md`
5. `docs/execution/tasks/W2-DAEMON-02-local-control-boundary.md`
6. `docs/execution/tasks/W2-CMD-01-read-only-query-surface.md`
7. `docs/execution/tasks/W3-UI-01-remove-tui-and-spa.md`
8. `docs/proposals/unix-socket-daemon-boundary.md`
9. Current code:
   - `src/api/control.ts`
   - `src/api/routes.ts`
   - `src/api/server.ts`
   - `src/commands/watch.ts`
   - `src/commands/status.ts`
   - `src/daemon/runtime-state.ts`
   - `test/local-control-boundary.test.ts`
   - `test/read-only-query-surface.test.ts`

## Owned Files

- `src/api/control.ts`
- `src/api/routes.ts`
- `src/api/server.ts`
- `src/commands/watch.ts`
- `src/commands/status.ts`
- `src/daemon/runtime-state.ts`
- focused daemon-query tests under `test/`
- this packet file if acceptance details need refresh during handoff

## Forbidden Files

- `src/pipeline/**`
- `src/adapters/**`
- `src/sinks/**`
- `src/index.ts`
- `src/commands/start.ts`
- `src/commands/stop.ts`
- dashboard/TUI assets or any removed UI files
- future Electron app code

## Frozen Contracts

- one runtime owner per local store
- read-only CLI queries still work without the daemon
- Desktop is a client of the daemon boundary
- no second ingestion/storage/runtime path

## Deliverables

- a daemon-hosted local query server started by the long-lived runtime
- deterministic local query endpoint discovery for future Desktop clients
- read-only query routes covering overview, conversation detail/trace, and
  full-text search
- focused tests for the daemon query boundary
- no restoration of the removed dashboard or embedded SPA surface

## Non-Goals

- building the Electron app itself
- redesigning lifecycle control beyond narrow reuse of the existing boundary
- write-capable daemon work queues or mutation commands
- Windows named-pipe parity
- resurrecting `ui.port`, `ui.pid`, or a browser-first dashboard server

## Acceptance Checks

- long-lived daemon startup exposes a read-only local query boundary without
  changing runtime ownership or creating a second coordinator
- future clients can deterministically discover the daemon query endpoint path
- daemon-backed query routes return v2 store data for overview, conversation,
  trace/tree semantics where already supported, and full-text search
- stopped-runtime CLI read commands still work directly against SQLite
- no dashboard/TUI files, port files, or browser-serving behavior are
  reintroduced

## BP Acceptance Matrix

| Requirement | Blueprint | Expected evidence |
|-------------|-----------|-------------------|
| Desktop remains a daemon client rather than a second runtime | BP-07, BP-Product | `src/api/server.ts`, `src/commands/watch.ts`, focused daemon-query tests |
| Query commands still work without the daemon | BP-07 | no CLI query changes that require daemon ownership; focused read-only regression tests |
| Runtime ownership stays single-owner and long-lived modes share one runtime path | BP-07 | daemon server is hosted from `watch.ts` without parallel ingest/runtime wiring |
| Module layout keeps daemon/query serving inside the API/lifecycle surface | BP-01 | `src/api/**`, `src/commands/watch.ts`, `src/daemon/runtime-state.ts` |
| Local-first query/search value remains in the daemon/Desktop product boundary | BP-Product | query routes + deterministic socket discovery; no Team/integration coupling |

## V1 Comparison

The prior browser/dashboard HTTP surface was removed by `W3-UI-01`.
This packet must not restore that surface.

Required comparison in the handoff:

- intentional change: add a daemon-query boundary for future Desktop clients
- parity not required: removed dashboard/browser bindings stay removed
- explicit confirmation that no `ui.port`, `ui.pid`, embedded SPA, or browser
  asset serving returned

## Notes

- The canonical workspace currently contains an aborted provisional diff from
  `codex-BRAIN` in some owned files. The worker may absorb or replace that diff,
  but must stay within the packet boundary and treat it as untrusted until
  validated by tests.

## Stop And Escalate

Stop if:

- the lane needs pipeline/coordinator changes beyond daemon startup wiring
- Windows transport support becomes required for correctness in this packet
- the boundary needs new frozen lifecycle semantics or a wider transport policy
  decision

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

V1 comparison:
- parity kept / intentional BP-backed change / deferred regression
- or `no prior v1 surface`

BP alignment:
- BP-XX: sections implemented

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
