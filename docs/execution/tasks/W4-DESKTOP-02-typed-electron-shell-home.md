# W4-DESKTOP-02: Typed Electron Shell And Home Surface

## Role

Worker packet.

## Goal

Implement the first typed Electron Desktop slice against the approved daemon
boundary:

- shared Desktop/daemon contract types that reuse v2 entities for canonical
  objects
- a type-safe Electron main/preload/renderer shell
- the first live Home surface using daemon status + overview data

This packet starts the Desktop app without restoring the removed browser or SPA
stack.

## Depends On

- `W4-DESKTOP-01-daemon-query-boundary.md`
- `W3-UI-01-remove-tui-and-spa.md`
- `W3-CLEANUP-01-remove-ui-and-v1-bridges.md`

## Unblocks

- future Desktop screen packets for Conversations, Search, Detail, Trace, Tree
- richer typed Desktop/daemon contract work
- packaging and launch lanes for the native app

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/blueprint/BP-07-process-lifecycle.md`
3. `docs/blueprint/BP-03-conversation-model.md`
4. `docs/blueprint/BP-Product-Strategy.md`
5. `docs/jin-desktop-prd.md`
6. `docs/desktop-daemon-architecture.md`
7. `docs/jin-desktop-stitch-mock-data.md`
8. `docs/solutions/2026-04-20-desktop-boundary-should-reuse-v2-entities-and-only-type-composed-views.md`
9. Current code:
   - `src/api/control.ts`
   - `src/api/routes.ts`
   - `src/api/server.ts`
   - `src/contracts/conversations.ts`
   - `src/contracts/store.ts`
   - `package.json`
   - `tsconfig.json`
   - `test/local-control-boundary.test.ts`
   - `test/daemon-query-boundary.test.ts`

## Owned Files

- `desktop/**`
- `src/contracts/desktop.ts`
- `src/api/control.ts`
- `src/api/routes.ts`
- `package.json`
- `bun.lock`
- focused Desktop/contract tests under `test/`
- this packet file if acceptance details need refresh during handoff

## Forbidden Files

- `src/pipeline/**`
- `src/adapters/**`
- `src/sinks/**`
- `src/db/**`
- `src/commands/watch.ts`
- `src/commands/status.ts`
- `src/daemon/**`
- removed browser/dashboard/TUI files
- Team or remote product surfaces

## Frozen Contracts

- one runtime owner per local store
- Desktop is a client of the daemon boundary
- renderer must not scrape SQLite directly
- v2 conversation identity and relationship semantics remain unchanged
- no restored browser/dashboard runtime

## Deliverables

- a first Electron app scaffold under `desktop/`
- a type-safe preload boundary so the renderer talks to Electron main, not the
  daemon socket directly
- shared Desktop contract types that reuse v2 entity types for canonical
  objects and define explicit composed response types only where needed
- a live Home surface that reflects the Stitch direction and renders stopped /
  healthy runtime states from daemon status + overview data
- focused tests and typecheck coverage for the typed contract layer and the
  first Desktop slice

## Non-Goals

- full multi-screen parity with the Stitch project
- live streaming/event subscriptions
- packaging, signing, installers, or auto-update
- Team login or remote sync UX
- Windows transport parity
- widening daemon lifecycle/runtime semantics

## Acceptance Checks

- shared Desktop contracts reuse v2 entities for canonical objects instead of
  cloning every entity into a second DTO layer
- Electron renderer only consumes typed preload IPC and does not talk to the
  daemon socket directly
- the first Desktop shell reads daemon-backed local status/overview data
- the Home UI clearly handles stopped and healthy states
- the Stitch project direction is visibly reflected in layout and tokens without
  copying generated HTML blindly
- no removed browser/dashboard stack or direct SQLite renderer path returns

## BP Acceptance Matrix

| Requirement | Blueprint | Implemented evidence |
|-------------|-----------|-------------------|
| Desktop remains a daemon client rather than a second runtime | BP-07, BP-Product | `desktop/daemon-client.ts`, `desktop/shell-service.ts`, `desktop/main.ts`, and `desktop/preload.ts` keep Desktop on the control/query boundary with renderer IPC only; tested by `test/desktop-shell-service.test.ts` and `test/daemon-query-boundary.test.ts` |
| Core conversation semantics stay on the frozen v2 model | BP-03 | `src/contracts/desktop.ts` reuses `Conversation` / `Message` / `ToolCall`, and `src/api/routes.ts` returns canonical `recentConversations` without new identity aliases; tested by `test/desktop-home-route.test.ts` |
| Module/layout changes keep Desktop code separate from daemon/pipeline ownership | BP-01, BP-07 | all new UI/runtime code lives under `desktop/**`, with narrow shared typing in `src/contracts/desktop.ts` and additive route/control changes in `src/api/control.ts` + `src/api/routes.ts`; tested by `test/desktop-shell-service.test.ts`, `test/local-control-boundary.test.ts`, and `bun run desktop:typecheck` |
| The first Desktop slice provides local-first value with the approved daemon boundary | BP-Product | `src/api/routes.ts` builds daemon-backed Home data, `desktop/shell-service.ts` composes runtime status + daemon query data, and `desktop/renderer.ts` renders healthy/stopped Home states in the Stitch-derived shell; tested by `test/desktop-home-route.test.ts`, `test/desktop-shell-service.test.ts`, and `bun run desktop:build` |
| Removed browser/dashboard code stays removed | BP-Product, W3-UI-01 | `desktop/main.ts` boots a local `BrowserWindow.loadFile(...)` shell and `package.json` adds Electron-only build/start scripts without restoring browser-serving paths; validated by `test/desktop-shell-service.test.ts`, `bun run desktop:build`, and the handoff V1 comparison |

## V1 Comparison

The old browser/TUI surface was intentionally removed.

Required comparison in the handoff:

- intentional change: add a native Electron shell that consumes the daemon
  boundary
- parity not required: removed browser/dashboard hosting stays removed
- explicit confirmation that no browser-serving or port-file behavior returned

## Notes

- The visual source of truth is the locally available Stitch MCP project and its
  screens, but that MCP project metadata should remain local and should not be
  persisted in the repo.
- For this first slice, prioritize the `Home (Healthy)` and `Home (Stopped)`
  screens while laying the typed contract foundation for later Detail/Tree
  packets.
- If dependency installation is required, use Bun tooling only.

## Stop And Escalate

Stop if:

- the lane needs pipeline, adapter, sink, or daemon-runtime ownership changes
- the renderer needs direct SQLite access to be viable
- the packet requires package/install policy beyond a narrow Electron app
  scaffold
- daemon route semantics must change in a way that widens beyond typed boundary
  cleanup

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
