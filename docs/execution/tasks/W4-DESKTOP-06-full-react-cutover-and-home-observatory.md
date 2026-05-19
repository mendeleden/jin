# W4-DESKTOP-06: Full React Cutover And Home Observatory

## Role

Worker packet.

## Goal

Finish the Desktop renderer migration so future UI work happens in React
components, not string-template HTML.

The immediate product goals are:

- remove the remaining `LegacyHtmlView` / `dangerouslySetInnerHTML` adapter from
  Desktop source
- render Conversations, Logs, and Settings as React components inside
  `AppShell`
- keep Home and Routing as React surfaces
- make the Home page show a real Token & Cost Observatory inspired by the
  accepted mockup: a populated stacked burn chart, legend, current total/cost
  callout, and no blank/unpopulated center panels when aggregate data exists
- if `tokenUsageByDay` is empty but aggregate adapter/project/conversation data
  exists, render an explicitly labelled snapshot-derived chart instead of an
  empty div
- fix the sidebar `Cost (estimated)` info affordance so the `(i)` opens a real
  visible popup on hover/focus in the Electron UI, not just static hidden
  markup

The engineering goals are:

- delete or stop exporting full-view legacy string render paths
- keep the existing typed daemon IPC contract and controller state model
- keep renderer code testable through React static rendering
- avoid daemon/API contract changes unless a real BP-11 gap is found and
  escalated

## Depends On

- `W4-DESKTOP-05-react-component-cutover.md`
- `docs/blueprint/BP-11-desktop-daemon-boundary.md`
- `docs/blueprint/BP-Product-Strategy.md`

## Unblocks

- normal React iteration for all Desktop views
- deleting the old renderer string-template app shell
- visual iteration on Home charts without re-entering legacy HTML

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `.execution/program.md`
5. `.execution/packets/W4-DESKTOP-06.md`
6. `docs/execution/tasks/W4-DESKTOP-05-react-component-cutover.md`
7. `docs/blueprint/BP-07-process-lifecycle.md`
8. `docs/blueprint/BP-08-routing-and-config.md`
9. `docs/blueprint/BP-Product-Strategy.md`
10. `docs/blueprint/BP-11-desktop-daemon-boundary.md`
11. Current code:
    - `desktop/components/app-shell.tsx`
    - `desktop/react-renderer.tsx`
    - `desktop/react-entry.tsx`
    - `desktop/renderer.ts`
    - `desktop/graph-components.tsx`
    - `desktop/styles.css`
    - `desktop/legacy-entry.ts`
    - `scripts/build-desktop.ts`
    - `test/desktop-renderer.test.ts`
    - `test/desktop-shell-service.test.ts`
    - `test/desktop-home-route.test.ts`

## Owned Files

- `desktop/components/app-shell.tsx`
- new files under `desktop/components/**`
- new files under `desktop/views/**`
- `desktop/react-renderer.tsx`
- `desktop/react-entry.tsx`
- `desktop/renderer.ts`
- `desktop/graph-components.tsx`
- `desktop/styles.css`
- `desktop/legacy-entry.ts`
- `scripts/build-desktop.ts`
- `test/desktop-renderer.test.ts`
- `test/desktop-shell-service.test.ts`
- `test/desktop-home-route.test.ts`

## Forbidden Files

- `src/api/**`
- `src/contracts/**`
- `src/pipeline/**`
- `src/adapters/**`
- `src/sinks/**`
- `src/db/**`
- `src/commands/**`
- `src/daemon/**`
- package manifests and lockfiles
- blueprint docs

If the Home graph truly needs a daemon payload change, stop and return a
BP-11/API contract decision to `codex-BRAIN`. Do not smuggle API changes through
this renderer packet.

## Frozen Contracts

- Desktop remains a typed client of the daemon boundary.
- Renderer must not read SQLite, log files, config files, sockets, or daemon
  auth tokens directly.
- Desktop IPC endpoint shape must not change in this packet.
- Routing semantics remain read-only visualization only.
- v2 conversation identity and relationship semantics remain unchanged.
- No lifecycle, sink, push, or config reload behavior changes.

## Implementation Direction

- Replace `LegacyHtmlView` with React components for:
  - Conversations library and detail workspace
  - Logs workspace
  - Settings/runtime boundary workspace
- Convert only the necessary legacy renderer helpers from `desktop/renderer.ts`
  into typed data/format helpers or React components. Do not keep full-view
  HTML string renderers alive as a hidden second UI stack.
- `desktop/renderer.ts` may continue to own controller/state transitions and
  pure formatting helpers, but it should not own full app/view HTML rendering
  after this packet.
- Delete `desktop/legacy-entry.ts` if it has no remaining production or test
  purpose.
- Keep `scripts/build-desktop.ts` on `react-entry.tsx`.
- Preserve current controller behavior:
  - view switching
  - refresh actions
  - conversation filters
  - conversation selection
  - subview switching for Timeline / Trace / Tree
  - log refresh
  - routing refresh through shell refresh
- Preserve existing visual fixes:
  - sidebar Cost is final, full, and estimated with real tooltip affordance
  - the Cost info affordance must be usable in the live app; prefer a Radix
    `Tooltip.Portal` or equivalent so the popup is not clipped by the sidebar
    panel's overflow
  - Routing graph uses fixed edge width
  - local-only projects say `local only`
  - local-only projects do not draw dashed placeholder legs
  - no duplicate Routing refresh button
  - sidebar does not render placeholder `Next surfaces`
- Update Home Token & Cost Observatory:
  - render a populated stacked chart when `tokenUsageByDay` has rows
  - if `tokenUsageByDay` is empty but `topAdapters` or overview totals exist,
    derive a snapshot chart from current aggregate data and label it clearly as
    snapshot-derived, not a real daily timeline
  - avoid large empty middle panels when aggregate data exists
  - include adapter legend, cost/tokens callout, and a visual density closer to
    the accepted mockup rather than sparse placeholder cards
- Prefer React component decomposition over one giant JSX function.
- Do not add dependencies. Reuse installed React/Radix/lucide/Recharts/graph
  dependencies if useful.

## Acceptance Checks

- `bun run desktop:typecheck` passes.
- `bun test test/desktop-renderer.test.ts test/desktop-shell-service.test.ts test/desktop-home-route.test.ts` passes.
- `bun run desktop:build` passes.
- `rg -n "dangerouslySetInnerHTML|data-legacy-html-view|LegacyHtmlView" desktop --glob '!dist/**'` returns no source hits.
- `rg -n "legacy-entry|mountDesktopRenderer" desktop scripts test --glob '!dist/**'` returns no live source/test hits, unless the file was intentionally kept with a packet-approved reason.
- React static-render tests cover:
  - Conversations renders without `data-legacy-html-view`
  - Logs renders without `data-legacy-html-view`
  - Settings renders without `data-legacy-html-view`
  - Home Token & Cost Observatory renders a populated chart from normal
    `tokenUsageByDay`
  - Home Token & Cost Observatory renders a non-empty snapshot-derived chart
    when `tokenUsageByDay` is empty but aggregate data exists
  - Home does not render blank/unpopulated center chart panels when aggregate
    data exists
- Tooltip implementation covers the live interaction risk:
  - cost info trigger is focusable and has accessible text
  - tooltip content is rendered through a portal/popover path or otherwise not
    clipped by the sidebar overflow container
  - no always-visible inline explanation replaces the popup
- Existing Routing graph tests continue passing.
- No direct SQLite/file/socket/auth access is introduced in renderer code.
- No daemon API, route matching, sink, pipeline, or contract semantics change is
  introduced.

## BP Acceptance Matrix

| Requirement | Blueprint | Packet expectation |
|-------------|-----------|--------------------|
| Desktop remains a daemon client | BP-07, BP-11 | renderer consumes existing typed state/IPC only |
| Renderer-safe IPC only | BP-11 | no generic request bridge, no direct socket/auth/file access |
| Desktop APIs return view models | BP-11 | use existing view-model contracts; no raw DB rows |
| Component foundation replaces ad hoc UI growth | BP-Product, BP-11 | all Desktop views render through React components |
| Home surfaces local-first value | BP-Product | Token & Cost Observatory is populated from local view-model data |
| Cost semantics are discoverable | BP-Product | `Cost (estimated)` info opens a live tooltip/popover, not clipped hidden markup |
| Routing visualization does not change routing semantics | BP-08 | Routing remains a pure display of existing routing snapshot |
| V1 compatibility views do not remain hidden dependencies | BP-11 | old full-view HTML adapter removed or explicitly deleted |

## V1 Comparison

Intentional change: Conversations, Logs, and Settings move from legacy
string-template views to React components. User-facing content and controller
behavior should preserve parity unless tests document an intentional
React-backed simplification.

Intentional change: Home no longer shows an empty Token & Cost panel when
aggregate data exists but daily timeline rows are absent. It should show a
clearly labelled snapshot-derived chart instead.
