# W4-DESKTOP-03: Desktop Conversation Viewer

## Role

Worker packet.

## Goal

Implement the first real conversation-viewing slice in the Electron app against
the approved daemon boundary:

- replace fake `Conversations` navigation with real in-app navigation
- render a conversations library with filters and selection
- render conversation detail, trace, and tree views from the typed daemon
  boundary
- keep the renderer behind preload IPC and reuse v2 entities directly for
  canonical conversation objects

This packet is the first step from "shell prototype" to a usable Desktop
conversation workbench.

## Visual Direction

The current shell is too soft, too card-heavy, and too prototype-like.

Use a more disciplined `Linear`-style direction for this packet:

- dark, restrained, high-contrast work surface
- crisp hierarchy and compact spacing
- fewer oversized hero treatments
- stronger list/detail ergonomics than dashboard-card ergonomics
- a clear inspector rhythm: list on the left, active conversation in the center,
  metadata on the right when space allows
- subtle borders and panels instead of inflated rounded blocks everywhere
- information-dense rows with clear selection state
- keyboard-first workbench feel, not a marketing dashboard

Specifically avoid:

- giant KPI-card-first layouts dominating the screen
- loose spacing that wastes horizontal width
- decorative shell chrome without interaction depth
- soft prototype styling that makes data surfaces feel fake
- fake navigation or placeholder panels presented as real product

## Depends On

- `W4-DESKTOP-01-daemon-query-boundary.md`
- `W4-DESKTOP-02-typed-electron-shell-home.md`
- `W3-UI-01-remove-tui-and-spa.md`
- `W3-CLEANUP-01-remove-ui-and-v1-bridges.md`

## Unblocks

- Desktop search implementation against the same viewer/navigation model
- packet-local review of whether the shell is now a credible Desktop slice
- later trace/tree polish and keyboard flow work

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/blueprint/BP-07-process-lifecycle.md`
3. `docs/blueprint/BP-03-conversation-model.md`
4. `docs/blueprint/BP-Product-Strategy.md`
5. `docs/jin-desktop-prd.md`
6. `docs/desktop-daemon-architecture.md`
7. `docs/solutions/2026-04-20-desktop-boundary-should-reuse-v2-entities-and-only-type-composed-views.md`
8. Current code:
   - `desktop/main.ts`
   - `desktop/preload.ts`
   - `desktop/bridge.ts`
   - `desktop/daemon-client.ts`
   - `desktop/shell-service.ts`
   - `desktop/renderer.ts`
   - `src/contracts/desktop.ts`
   - `src/api/routes.ts`
   - `test/desktop-home-route.test.ts`
   - `test/desktop-shell-service.test.ts`
   - `test/desktop-renderer.test.ts`
   - `test/daemon-query-boundary.test.ts`

## Owned Files

- `desktop/**`
- `src/contracts/desktop.ts`
- `src/api/routes.ts`
- focused Desktop/viewer tests under `test/`
- this packet file if acceptance details need refresh during handoff

## Forbidden Files

- `src/pipeline/**`
- `src/adapters/**`
- `src/sinks/**`
- `src/db/**`
- `src/commands/**`
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

- real app navigation state for at least:
  - `Home`
  - `Conversations`
  - conversation detail workbench
- typed daemon client methods for:
  - conversations list
  - conversation detail
  - trace view
  - tree view
- preload/IPC wiring so the renderer continues to depend on typed IPC instead
  of the daemon socket directly
- a conversations library view with:
  - reverse-chronological rows
  - adapter filter
  - time-range filter if practical within packet scope
  - relationship chips
  - selection/open behavior
- a conversation detail workbench with:
  - split layout tuned for desktop browsing instead of stacked dashboard cards
  - timeline/details view
  - trace view
  - tree view
  - visible parent/child/trace metadata
  - a metadata/inspector panel for the selected conversation with at least:
    - adapter
    - model
    - timestamps
    - token/cost summary if available
    - trace id / conversation id
    - relationship / parent linkage
- focused tests for typed viewer contracts and renderer behavior
- materially improved visual discipline on the conversation surfaces:
  - tighter shell
  - cleaner navigation
  - stronger row selection and hierarchy
  - less card-bloat than the current Home prototype
  - a denser, calmer desktop workbench closer to `Linear` than to a
    dashboard-style AI shell

## Non-Goals

- full Search implementation
- Projects or Health redesign
- live event streaming
- packaging/signing/installers
- Team login or remote sync UX
- Windows transport parity
- daemon lifecycle/runtime ownership changes

## Acceptance Checks

- `Conversations` nav is no longer fake and opens a real viewer surface
- renderer still consumes typed preload IPC only
- list/detail/trace/tree use the approved daemon boundary instead of direct
  SQLite access
- conversation detail uses canonical v2 entities without reintroducing v1
  aliases like `parentSessionId`
- the selected conversation exposes a real metadata inspector rather than
  burying key identity/trace fields in row chrome
- trace/tree semantics remain visible as a first-class differentiator
- the shell quality materially improves beyond the current single-screen
  prototype
- the visual result reads as a serious, sleek developer workbench closer to
  `Linear` than to a generic AI dashboard

## BP Acceptance Matrix

| Requirement | Blueprint | Implemented evidence |
|-------------|-----------|-------------------|
| Desktop remains a daemon client rather than a second runtime | BP-07, BP-Product | `desktop/daemon-client.ts`, `desktop/shell-service.ts`, `desktop/bridge.ts`, and `desktop/preload.ts` keep the renderer on typed IPC and the main process on the daemon boundary; tested by focused Desktop/viewer tests |
| Core conversation semantics stay on the frozen v2 model | BP-03 | `src/contracts/desktop.ts` and `src/api/routes.ts` reuse canonical `Conversation` / `Message` / `ToolCall` semantics for detail/trace/tree; tested by focused route/client tests |
| Desktop surfaces trace-aware browsing rather than flat session-only lists | BP-03, BP-Product | `desktop/renderer.ts` renders relationship chips, detail, trace, and tree workbench states from the approved boundary; tested by focused renderer/viewer tests |
| Module/layout changes stay inside Desktop and typed boundary ownership | BP-01, BP-07 | new viewer/navigation logic stays in `desktop/**` plus narrow contract/route shaping in `src/contracts/desktop.ts` and `src/api/routes.ts`; tested by focused Desktop/viewer tests |
| Removed browser/dashboard code stays removed | BP-Product, W3-UI-01 | the Electron shell remains file-loaded with typed IPC and does not restore browser-serving paths or direct SQLite renderer access; validated by diff scope and focused tests |

## V1 Comparison

The old browser/TUI surface was intentionally removed.

Required comparison in the handoff:

- intentional change: implement native Desktop conversation browsing instead of
  restoring the prior browser/dashboard surface
- parity not required: browser-hosted navigation stays removed
- explicit confirmation that no browser-serving or port-file behavior returned

## Notes

- The local Stitch project remains the visual source of truth, specifically the
  `Conversations`, `Conversation Detail`, `Trace View`, and `Tree View`
  screens. Do not persist Stitch screen metadata into the repo.
- The current Desktop screenshot on the operator's Desktop is only a capture of
  the existing Home shell; it is not a second source of truth.
- Favor a split workbench or inspector layout if that keeps list/detail/trace
  navigation fast and dense.
- When tradeoffs appear between showier UI and denser, calmer workflow UI,
  prefer the denser workflow UI.

## Stop And Escalate

Stop if:

- the lane needs daemon/runtime ownership changes
- the viewer needs direct SQLite access to be viable
- detail/trace/tree route semantics require widening beyond packet-owned typed
  cleanup
- the packet needs a search architecture decision rather than just a
  conversation viewer implementation

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
