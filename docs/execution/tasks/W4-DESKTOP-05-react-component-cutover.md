# W4-DESKTOP-05: React Component Cutover

## Role

Worker packet.

## Goal

Make the Desktop renderer cross the React component seam for the core product
surfaces instead of continuing to grow string-template HTML.

The immediate goal is:

- `desktop/react-renderer.tsx` renders real React components for the app shell,
  sidebar, Home, and Routing
- Home and Routing use componentized cards/graphs rather than static HTML
  injected through `dangerouslySetInnerHTML`
- the sidebar runtime Cost row shows the full estimated cost, not a compact or
  truncated value, with an `(estimated)` info affordance backed by a real
  Radix/shadcn-style tooltip interaction
- the left sidebar no longer renders the placeholder `Next surfaces` panel
- Conversations, Logs, and Settings may remain behind a narrow legacy adapter
  for this packet so the cutoff is reviewable

The engineering goal is:

- stop adding visual work to `renderApp()` string templates
- preserve the existing Desktop controller/state model and typed daemon IPC
- create an explicit migration seam for remaining legacy views

## Depends On

- `W4-DESKTOP-04-react-ui-foundation-and-routing-graphs.md`
- `docs/blueprint/BP-11-desktop-daemon-boundary.md`
- `docs/blueprint/BP-Product-Strategy.md`

## Unblocks

- using Radix/lucide/Recharts/XYFlow as normal React dependencies
- Home and Routing visual iteration without legacy HTML string churn
- later removal of the legacy renderer adapter

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `.execution/program.md`
5. `.execution/packets/W4-DESKTOP-04.md`
6. `.execution/packets/W4-DESKTOP-05.md`
7. `docs/execution/tasks/W4-DESKTOP-04-react-ui-foundation-and-routing-graphs.md`
8. `docs/blueprint/BP-07-process-lifecycle.md`
9. `docs/blueprint/BP-08-routing-and-config.md`
10. `docs/blueprint/BP-Product-Strategy.md`
11. `docs/blueprint/BP-11-desktop-daemon-boundary.md`
12. Current code:
    - `desktop/react-renderer.tsx`
    - `desktop/react-entry.tsx`
    - `desktop/renderer.ts`
    - `desktop/graph-components.tsx`
    - `desktop/styles.css`
    - `desktop/bridge.ts`
    - `desktop/shell-service.ts`
    - `src/contracts/desktop.ts`
    - `test/desktop-renderer.test.ts`
    - `test/desktop-shell-service.test.ts`
    - `test/desktop-home-route.test.ts`

## Owned Files

- `desktop/react-renderer.tsx`
- `desktop/react-entry.tsx`
- `desktop/renderer.ts`
- `desktop/graph-components.tsx`
- `desktop/styles.css`
- new files under `desktop/components/**`
- new files under `desktop/views/**`
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
- release/install scripts
- blueprint docs
- package manifests and lockfiles unless Codex explicitly approves a package
  change

## Frozen Contracts

- Desktop remains a typed client of the daemon boundary.
- Renderer must not read SQLite directly.
- Desktop IPC endpoint shape must not change in this packet.
- Routing semantics are read-only visualization only.
- v2 conversation identity and relationship semantics remain unchanged.

## Implementation Direction

- Work graph-first. The first visible implementation milestone is:
  React `AppShell` + sidebar/topbar + Home graph + Routing graph rendering in
  the dev Electron app. Do not spend the first pass inventorying or converting
  Conversations, Logs, or Settings.
- Replace the `dangerouslySetInnerHTML={{ __html: renderApp(state) }}` app
  shell with real React component rendering.
- Create a componentized `AppShell` with sidebar, topbar, runtime actions, and
  view switching.
- Create componentized Home and Routing views using the existing typed
  `RendererState` data.
- Keep Conversations, Logs, and Settings temporarily behind a narrow
  `LegacyHtmlView` adapter if needed. The adapter should be explicit and local,
  not a hidden continuation of the old app shell.
- For the legacy adapter, reuse existing exported legacy render helpers or a
  small isolated legacy render function. Do not let legacy conversion block the
  Home/Routing graph cutover.
- Preserve the existing `DesktopRendererController` behavior unless a small
  typed callback bridge is needed for React event handlers.
- Preserve current W4-DESKTOP-04 fixes: fixed Routing edge widths, bounded
  Routing labels, no sidebar `Traces`, `Cost` as final sidebar runtime row, and
  no duplicate Routing section Refresh.
- Remove the placeholder sidebar `Next surfaces` panel. The left rail should
  contain navigation plus runtime state, not planned/future-surface filler.
- Preserve full sidebar cost visibility: the sidebar runtime Cost row must show
  the full formatted dollar amount and label it as estimated.
- Add a small info affordance next to the estimated Cost label. On hover/focus,
  it must explain: this cost is calculated from API pricing estimates and does
  not represent subscription usage or billing-plan spend.
- The estimated-cost explanation must not be rendered as always-visible inline
  body copy. Use an actual React tooltip/popover-style component, preferably
  Radix Tooltip or a shadcn-style wrapper over it.
- Routing local-only projects must say `local only`, not `unrouted`, and should
  not draw dashed placeholder legs for projects that do not route to a sink.
- Prefer small React components and typed props over large monolithic JSX.
- Use installed packages only if they fit naturally; do not add dependencies.

## Acceptance Checks

- `bun run desktop:typecheck` passes.
- `bun test test/desktop-renderer.test.ts test/desktop-shell-service.test.ts test/desktop-home-route.test.ts` passes.
- `bun run desktop:build` passes if touched entry/build files make that
  practical.
- `desktop/react-renderer.tsx` no longer uses `dangerouslySetInnerHTML` for the
  full app shell.
- Home and Routing are rendered as React components, not through full-view
  string templates.
- Home shows the mission-control graph in the React path.
- Routing shows the project-to-sink graph in the React path.
- Any remaining legacy HTML path is explicitly limited to Conversations, Logs,
  Settings, or another documented deferred view.
- Renderer tests continue covering Home graph, Routing graph, sidebar metrics,
  and Routing refresh behavior.
- Renderer tests cover the sidebar Cost row showing the full formatted cost,
  remaining the final sidebar runtime metric, and exposing estimated-cost help
  text through a tooltip/popover-style affordance instead of inline copy.
- Renderer tests cover Routing local-only wording and reject dashed placeholder
  route legs for local-only projects.
- Renderer tests cover that the sidebar no longer renders `Next surfaces`,
  `Search`, `Projects`, or `Health` as placeholder sidebar items.
- No direct SQLite reads are introduced in Desktop renderer code.
- No daemon API, route matching, sink, pipeline, or contract semantics change is
  introduced.

## BP Acceptance Matrix

| Requirement | Blueprint | Packet expectation |
|-------------|-----------|--------------------|
| Desktop remains a daemon client | BP-07, BP-11 | no daemon/server/contract edits; component props consume existing `RendererState` |
| Routing visualization does not change routing semantics | BP-08 | Routing component uses existing routing snapshot data only |
| Desktop surfaces local-first value | BP-Product | Home/Routing remain first-class local observability surfaces |
| Component foundation replaces ad hoc UI growth | BP-Product, BP-11 | shell/Home/Routing become React components with tests |
| Existing W4-DESKTOP-04 visual fixes remain intact | BP-Product | tests preserve fixed edge widths, bounded labels, `local only` routing wording, no dashed local-only legs, sidebar Cost final row, and no duplicate Routing refresh |
| Cost semantics are clear | BP-Product | sidebar cost shows the full estimated API-pricing-derived amount with a real tooltip/popover affordance clarifying it is not subscription usage |
| Sidebar avoids placeholder filler | BP-Product | remove `Next surfaces` placeholder content and test it does not render |

## V1 Comparison

Intentional change: Desktop shell/Home/Routing move from renderer string
templates to React components. Behavior and daemon boundaries should remain
parity-preserving for users.

Deferred: Conversations, Logs, and Settings can remain legacy-rendered through a
named adapter in this packet if converting them would make the diff too large.
