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
