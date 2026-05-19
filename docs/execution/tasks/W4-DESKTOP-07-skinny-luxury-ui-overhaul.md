# W4-DESKTOP-07: Skinny Luxury Desktop UI Overhaul

## Role

Worker packet with visual review lanes.

## Goal

Overhaul the Desktop Home and Conversations surfaces so they feel like a
clean expert tool: skinny, high-density, precise, Stripe/Linear-inspired, with
Apple-style material depth and restraint.

The product goals are:

- make Home feel like a premium operations cockpit, not a collection of large
  placeholder cards
- make Conversations feel like a fast expert workbench for scanning, filtering,
  and inspecting conversations
- keep visual density high without crowding: slimmer cards, tighter type scale,
  lower chrome, cleaner hierarchy, richer graph content
- preserve the typed daemon boundary and existing view-model contract
- capture screenshots of the major screens and design iterations into the repo
  so the operator can review visual direction

## Depends On

- `W4-DESKTOP-06-full-react-cutover-and-home-observatory.md`
- `docs/blueprint/BP-11-desktop-daemon-boundary.md`
- `docs/blueprint/BP-Product-Strategy.md`

## Unblocks

- first-class Desktop visual system iteration
- future component extraction once the visual direction stabilizes
- screenshot-driven UX/UI review lanes

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `.execution/program.md`
5. `.execution/packets/W4-DESKTOP-07.md`
6. `docs/execution/tasks/W4-DESKTOP-06-full-react-cutover-and-home-observatory.md`
7. `docs/blueprint/BP-11-desktop-daemon-boundary.md`
8. `docs/blueprint/BP-Product-Strategy.md`
9. Current code:
   - `desktop/components/app-shell.tsx`
   - `desktop/graph-components.tsx`
   - `desktop/styles.css`
   - `desktop/renderer.ts`
   - `desktop/react-renderer.tsx`
   - `test/desktop-renderer.test.ts`
   - `test/desktop-shell-service.test.ts`
   - `test/desktop-home-route.test.ts`
10. Current visual references:
    - `ChatGPT Image May 16, 2026, 12_44_25 PM.png`
    - `Gemini_Generated_Image_78crpv78crpv78cr.png`
    - `ed-screenshot-for-jin-desktop/`

## Owned Files

- `desktop/components/app-shell.tsx`
- `desktop/graph-components.tsx`
- `desktop/styles.css`
- `test/desktop-renderer.test.ts`
- new screenshot/reference artifacts under
  `docs/execution/artifacts/W4-DESKTOP-07/**`

## Forbidden Files

- `src/api/**`
- `src/contracts/**`
- `src/db/**`
- `src/pipeline/**`
- `src/adapters/**`
- `src/sinks/**`
- `src/commands/**`
- `src/daemon/**`
- package manifests and lockfiles unless Codex explicitly approves a new UI
  dependency
- blueprint docs

If the UI needs data that is not present in the existing Desktop view models,
stop and return a BP-11/API contract proposal. Do not add renderer-side direct
DB/file/socket reads.

## Frozen Contracts

- Desktop remains a typed client of the daemon boundary.
- Renderer must not read SQLite, log files, config files, sockets, or daemon
  auth tokens directly.
- Desktop IPC endpoint shape must not change in this packet.
- Routing, sink, config, pipeline, lifecycle, and identity semantics remain
  unchanged.

## Visual Direction

- Aim for skinny, refined, low-chrome UI similar in density and polish to
  Stripe dashboards and Linear issue surfaces.
- Prefer thin borders, restrained gradients, quiet shadows, compact controls,
  and a crisp type hierarchy over large pill cards.
- Preserve the current dark product direction, but make it less heavy:
  deep glass surfaces, subtle cool highlights, compact expert controls, and
  fewer bulky panels.
- Home should emphasize:
  - a tight top operating strip
  - a visually meaningful conversation-flow or mission-control graph
  - a real token/cost chart surface with clear readouts
  - recent conversations and project activity without overwhelming the page
- Conversations should emphasize:
  - fast scanning
  - compact filter row
  - dense conversation rows
  - a polished inspector/detail panel with less vertical waste
  - consistent collapse/rail affordances

## Screenshot Artifacts

Capture screenshots after meaningful iterations into:

- `docs/execution/artifacts/W4-DESKTOP-07/home-iteration-*.png`
- `docs/execution/artifacts/W4-DESKTOP-07/conversations-iteration-*.png`
- `docs/execution/artifacts/W4-DESKTOP-07/routing-reference-*.png` only if a
  routing regression is relevant

Screenshots are review artifacts for this packet. They should be committed
with the iteration so reviewers can inspect the exact visual state.

## Acceptance Checks

- `bun run desktop:typecheck` passes.
- `bun test test/desktop-renderer.test.ts test/desktop-shell-service.test.ts test/desktop-home-route.test.ts` passes.
- `bun run desktop:build` passes.
- Home renders the mission graph and token/cost chart visibly in the first
  viewport at normal Desktop window size.
- Conversations renders a compact filter/search area, dense library rows, and
  detail/inspector content without reverting to legacy HTML.
- Sidebar `Cost (estimated)` remains full-width/full-value and keeps a working
  tooltip affordance.
- Static-render tests still assert the componentized Home and Conversations
  surfaces exist.
- No daemon API, route matching, sink, pipeline, config, or contract semantics
  change is introduced.
- At least one Home screenshot and one Conversations screenshot are saved under
  `docs/execution/artifacts/W4-DESKTOP-07/`.
- At least one UX/UI design review artifact is produced under `.execution/reviews/`.

## BP Acceptance Matrix

| Requirement | Blueprint | Packet expectation |
|-------------|-----------|--------------------|
| Desktop remains daemon client | BP-11 | use existing typed Desktop state only |
| Renderer-safe IPC only | BP-11 | no generic request bridge, no direct DB/file/socket access |
| Desktop APIs return view models | BP-11 | preserve existing view model shape |
| Product value is local-first observability | BP-Product | Home surfaces local conversation, token, project, and flow data |
| Expert Desktop UI is usable for real workflows | BP-Product | Conversations scanning/detail UI is dense and readable |
| Visual changes do not mutate runtime semantics | BP-07/BP-08 by boundary | UI-only changes; no lifecycle/routing/config behavior changes |

## V1 Comparison

Intentional change: Home and Conversations receive a visual overhaul after the
React cutover. The underlying controller behavior, typed Desktop bridge calls,
filters, selection, timeline/trace/tree subviews, and runtime controls must
preserve parity.

No prior v1 visual design contract is preserved beyond existing functional
surfaces. This packet intentionally replaces bulky early Desktop chrome with a
more compact, expert visual system.

## 2026-05-17 Iteration Checkpoint

UX/UI reviewer lanes found the same core issues: clipped Conversations library
rows, bulky Home cards, unfinished collapsed Stats bars, noisy raw GitHub labels,
and over-padded detail/inspector chrome. The folded iteration:

- removes the Home collapsed Stats bars from the primary dashboard
- slims Home KPI/action/chart surfaces while keeping Mission Control and Token
  & Cost Observatory visible
- shortens GitHub/project labels for graph and project-list readability
- normalizes long conversation titles for display while preserving full tooltip
  values
- densifies Conversations rows, message cards, tabs, and inspector sections
- hides low-value timeline metadata when turns are negative or model is absent

Current visual checkpoint:

- `docs/execution/artifacts/W4-DESKTOP-07/home-iteration-4.png`
- `docs/execution/artifacts/W4-DESKTOP-07/conversations-iteration-4.png`

Review artifact:

- `docs/execution/audits/2026-05-17-W4-DESKTOP-07-ux-review.md`

Validation passed:

- `bun run desktop:typecheck`
- `bun test test/desktop-renderer.test.ts test/desktop-shell-service.test.ts test/desktop-home-route.test.ts`
- `bun run desktop:build`

## 2026-05-17 Reopened Experiment

Operator feedback after the first skinny UI checkpoint:

- Conversations: move filter controls into a compact top row above the library
  and selected conversation content.
- Conversations: metadata should be collapsible. The collapsed state should be
  obvious and usable, and the expanded metadata should not consume excessive
  vertical space.
- Home: stop treating the first prototype as a final spec. Use the Home surface
  as an analytics experiment canvas with full-width chart treatments and
  multiple visualizations:
  - day-over-day token usage
  - day-over-day conversation volume
  - project-level activity
  - adapter mix
  - estimated cost
  - recent activity / outlier signals when derivable from existing data

Implementation boundaries remain unchanged:

- Use only the existing Desktop typed state and `DesktopHomeData` /
  `DesktopConversationListItem` view models.
- Do not add IPC endpoints, daemon routes, schema fields, package dependencies,
  or fake data.
- Do not edit BP docs.
- Continue from the current dirty W4-DESKTOP-07 Home iteration and screenshot
  artifacts. Do not revert the current Home redesign unless replacing it with a
  stronger implementation inside this packet.

Additional acceptance checks:

- Conversations filter controls render in one top-row surface.
- Metadata inspector can be collapsed and expanded from the conversation view.
- Home includes at least three distinct chart/visualization treatments using
  real existing view-model data.
- Home chart surfaces avoid the previous problem where narrow top cards crowd
  out the actual analytics.
- Save fresh Home and Conversations screenshots under
  `docs/execution/artifacts/W4-DESKTOP-07/`.

## 2026-05-17 Home Simplification Cut

Operator feedback after live Home inspection:

- There is too much happening on Home; the page should stop competing with
  itself.
- Graphs must be understandable, not just present.
- The same totals should not be repeated across multiple Home panels. Sidebar
  runtime totals can remain global, but the Home content should dedupe its own
  repeated totals.
- The primary analytics surface should support a period toggle, for example
  day-by-day versus month-over-month, plus previous/next navigation for the
  rendered window.
- The `Signals` section is not understandable enough to keep in the primary
  view.
- Remove the `Latest conversations` / `Recent` panel from Home for now.

Home simplification acceptance checks:

- Home has one clear primary analytics chart surface with period controls and
  previous/next navigation.
- Daily and monthly views are derived from existing `DesktopHomeData` fields
  only. If monthly data is not directly present, aggregate the available daily
  buckets client-side and keep the label honest.
- Graph labels and values are not visibly clipped at normal Desktop window
  size.
- Home no longer renders `Recent Activity`, `Signals`, `Latest conversations`,
  or `Open library`.
- Home keeps project-level and adapter-level rollups only if they do not
  duplicate the primary chart readouts.
- No daemon IPC, Desktop contract, schema, sink/routing, lifecycle, package, or
  blueprint changes.

## 2026-05-17 Home Graph Cleanup Cut

Live inspection after the first simplification showed the primary Home graph is
still not clean enough:

- The chart renders both the Recharts surface and the old static SVG fallback,
  causing duplicate axis labels and muddy visuals. Remove the static SVG
  fallback entirely; the graph should come from the chart library.
- The daily/monthly period control should be backed by enough history for a
  meaningful month-over-month view. A narrow Desktop Home data-window change is
  allowed if it does not change endpoint shape or contract fields.
- Duplicate day/adapter entries must be aggregated before chart rendering so
  monthly tooltips, callouts, and totals do not repeat the same adapter.
- Keep the Home information architecture simple: Token Usage, Project Activity,
  and Adapter Mix only. Do not re-add Signals, Recents, or Mission Control.

Additional boundary exception:

- `src/api/routes.ts` may be edited only to increase the Desktop Home
  `tokenUsageByDay` history window for the existing field. Do not add routes,
  query parameters, contract fields, IPC endpoints, or new payload shapes.
