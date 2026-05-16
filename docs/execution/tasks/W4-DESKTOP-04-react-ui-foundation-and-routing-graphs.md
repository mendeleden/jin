# W4-DESKTOP-04: React UI Foundation And Routing Graphs

## Role

Worker packet.

## Goal

Stabilize the Desktop UI work currently in progress, then move the visual
implementation away from ad hoc string/CSS accretion toward a durable React UI
foundation.

The immediate business goal is:

- the Desktop app must compile and launch from source
- Home must expose a real graph/mission-control style surface
- Routing must expose project-to-sink flow without duplicated sink cards
- Conversations must keep improving as a dense developer workbench

The engineering goal is:

- stop growing one-off renderer string templates for every complex surface
- introduce or prepare a coherent component/library strategy before deeper UI
  work continues
- keep all Desktop data behind typed daemon IPC/contracts

## Depends On

- `W4-DESKTOP-01-daemon-query-boundary.md`
- `W4-DESKTOP-02-typed-electron-shell-home.md`
- `W4-DESKTOP-03-conversation-viewer.md`
- `docs/blueprint/BP-11-desktop-daemon-boundary.md`

## Unblocks

- further Desktop visual iteration without hand-authored CSS sprawl
- durable graph work for Home and Routing
- later Desktop package/release review

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/blueprint/BP-07-process-lifecycle.md`
5. `docs/blueprint/BP-08-routing-and-config.md`
6. `docs/blueprint/BP-Product-Strategy.md`
7. `docs/blueprint/BP-11-desktop-daemon-boundary.md`
8. `docs/jin-desktop-prd.md`
9. Current code:
   - `desktop/renderer.ts`
   - `desktop/react-renderer.tsx`
   - `desktop/react-entry.tsx`
   - `desktop/styles.css`
   - `desktop/bridge.ts`
   - `desktop/daemon-client.ts`
   - `desktop/shell-service.ts`
   - `src/contracts/desktop.ts`
   - `src/api/routes.ts`
   - `test/desktop-renderer.test.ts`
   - `test/desktop-shell-service.test.ts`
   - `test/desktop-home-route.test.ts`

## Owned Files

- `desktop/**`
- `src/contracts/desktop.ts`
- `src/api/routes.ts`
- `test/desktop-*.test.ts`
- `package.json`
- `bun.lock`
- this packet file if acceptance details need refresh during handoff

## Forbidden Files

- `src/pipeline/**`
- `src/adapters/**`
- `src/sinks/**`
- `src/db/**`
- `src/commands/**`
- `src/daemon/**`
- non-Desktop release/install scripts unless Codex explicitly expands scope

## Frozen Contracts

- Desktop remains a client of the daemon boundary.
- Renderer must not scrape SQLite directly.
- Desktop IPC endpoints must stay explicit and typed.
- Routing semantics are read-only visualization in this packet; do not change
  route matching behavior.
- v2 conversation identity and relationship semantics remain unchanged.

## Library Decision Guidance

The library cut is approved for this packet. Do not keep extending the current
large string-template renderer for complex Desktop surfaces.

Approved package direction:

- Use React components as the Desktop UI foundation.
- Use Radix primitives directly for shell controls, side nav, tabs, selects,
  tooltips, scroll areas, dialogs, and collapsible panels.
- Use `lucide-react` for iconography instead of hand-authored inline SVG
  strings.
- Use Recharts for conventional analytics charts.
- Use `@xyflow/react` for interactive project-to-sink node graphs.
- Use `d3-sankey` / `d3-shape` where a static flow/sankey visual is a better
  fit than an editable node canvas.
- Do not use Material UI unless Codex explicitly accepts the Material visual
  language.
- Do not use Three.js for current Home/Routing graphs; these are 2D information
  graphics and should be SVG/canvas/React graph components.
- Do not introduce Tailwind or shadcn CLI in this packet. shadcn can come after
  the React seam is stable; adding Tailwind before the seam would create four
  styling systems at once.

Dependencies already installed by Codex:

- `@radix-ui/react-select`
- `@radix-ui/react-tabs`
- `@radix-ui/react-tooltip`
- `@radix-ui/react-scroll-area`
- `@radix-ui/react-collapsible`
- `lucide-react`
- `recharts`
- `@xyflow/react`
- `d3-shape`
- `d3-sankey`
- `@types/d3-shape`
- `@types/d3-sankey`

## Deliverables

- Restore `bun run desktop:typecheck` from the current broken state.
- Use the approved UI/graph dependencies instead of adding another hand-rolled
  graph layer.
- Home shows a real mission-control/flow graph surface, not just KPI cards.
- Routing shows a fluid project-to-sink graph with one visual node per sink.
- Routing content scrolls naturally and uses available height without clipping.
- Routing graph text stays inside project/sink node cards. Long remotes and sink
  ids must truncate visually and expose full detail by hover/focus rather than
  leaking outside the graph card.
- Sidebar runtime metrics remove `Traces` and keep `Cost` as the final row in
  that component.
- Routing workspace uses the shell-level Refresh control only; do not render a
  duplicate Refresh button inside the Routing graph section.
- Conversation filter/metadata controls move toward a compact top-row +
  inspector pattern; do not widen daemon contracts unless needed and typed.
- Existing Desktop IPC remains typed through preload/main/shell-service.
- Newly touched complex UI surfaces are implemented as React components or have
  a narrow typed React component seam with tests.
- Focused renderer/shell/home tests cover the visible behavior.

## Current Known Failure

At packet creation, `bun run desktop:typecheck` fails in `desktop/renderer.ts`
because a partial graph patch references an undefined `sinks` variable, missing
`truncateMiddle`, and inferred `{}` sink types. Fix this first before visual
work.

## Acceptance Checks

- `bun run desktop:typecheck` passes.
- `bun test test/desktop-renderer.test.ts test/desktop-shell-service.test.ts test/desktop-home-route.test.ts` passes.
- If product code touches shared Desktop routes/contracts, `bun run typecheck`
  passes.
- The source dev app can be launched with `bun run desktop:dev`.
- Home contains a visible graph section with deterministic renderer-test
  assertions.
- Routing contains a visible project-to-sink graph with deterministic
  renderer-test assertions.
- Routing has deterministic overflow assertions for long project and sink
  labels: labels should be constrained, truncated, and available through detail
  affordances without extending past the graph viewport.
- Sidebar renderer tests assert the runtime card no longer shows `Traces` and
  that `Cost` remains present as the final runtime metric.
- Routing renderer tests assert the workspace no longer renders a section-level
  Refresh button while retaining the shell refresh control.
- No direct SQLite reads are introduced in Desktop renderer code.
- No runtime/pipeline/sink route semantics change is introduced.

## BP Acceptance Matrix

| Requirement | Blueprint | Packet expectation |
|-------------|-----------|--------------------|
| Desktop remains a daemon client | BP-07, BP-11, BP-Product | implement only through typed Desktop IPC/client files; test with shell/renderer tests |
| Routing visualization does not change routing semantics | BP-08 | graph uses existing routing snapshot data; no sink/router behavior edits |
| Desktop surfaces local-first value | BP-Product | Home/Routing expose useful local observability without Team/cloud coupling |
| Conversation identity semantics stay canonical | BP-03 via BP-11 | no v1 aliases or direct store scraping; typed contracts only |
| UI implementation becomes maintainable | BP-Product, BP-11 | component/library direction recorded; new complex UI avoids further ad hoc CSS sprawl where practical |

## V1 Comparison

Intentional change: improve the native Electron Desktop surfaces instead of
restoring the removed browser/dashboard UI.

Parity not required: removed browser-serving and TUI paths stay removed.

Required handoff confirmation: no browser-hosted dashboard runtime, port-file
behavior, or renderer-side SQLite access returned.

## Stop And Escalate

Stop if:

- Home/Routing needs a new daemon endpoint that is not already covered by the
  Desktop boundary docs.
- A graph dependency forces a broader bundler/build policy decision.
- The fix needs pipeline, adapter, sink, DB, or service ownership.
- Visual requirements conflict with BP-11's Desktop daemon boundary.

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
