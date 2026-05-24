# W4-DESKTOP-09: Home Dynamic Layout Foundation And Edit Mode

## Role

Worker and review packet.

## Goal

Create the durable, user-adjustable Home dashboard layout lane as one
self-contained packet.

The immediate goal is:

- use a mature layout algorithm behind a data-only adapter without adopting
  package DOM/CSS that violates Desktop CSP constraints
- keep Home layout as explicit data with stable panel IDs and resettable
  defaults
- support explicit Home edit mode with reversible drag, resize, reset, cancel,
  and save actions
- persist Home layout state as renderer-local Desktop UI preference state
- make Home panels respond to live grid units so resized panels compact instead
  of clipping incoherently
- validate the implementation with static tests and visual review

## Depends On

- `W4-DESKTOP-07-skinny-luxury-ui-overhaul.md`
- `docs/plans/2026-05-23-desktop-dynamic-layouts.md`
- `docs/solutions/2026-05-11-desktop-csp-requires-class-based-renderer-visuals.md`
- `docs/solutions/2026-05-23-desktop-dynamic-layout-csp-package-spike.md`
- `docs/blueprint/BP-11-desktop-daemon-boundary.md`
- `docs/blueprint/BP-Product-Strategy.md`

## Unblocks

- user-customizable Home panel arrangement
- future dynamic layout support on other Desktop surfaces
- reviewable layout preference migration policy
- screenshot-driven validation for editable Desktop dashboards

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/context/W4-DESKTOP-09-bootstrap.md`
5. `.execution/program.md`
6. `.execution/packets/W4-DESKTOP-09.md`
7. `docs/plans/2026-05-23-desktop-dynamic-layouts.md`
8. `docs/solutions/2026-05-11-desktop-csp-requires-class-based-renderer-visuals.md`
9. `docs/solutions/2026-05-23-desktop-dynamic-layout-csp-package-spike.md`
10. `docs/blueprint/BP-11-desktop-daemon-boundary.md`
11. `docs/blueprint/BP-Product-Strategy.md`
12. Current code:
    - `desktop/layout/grid-engine.ts`
    - `desktop/layout/editable-dashboard-grid.tsx`
    - `desktop/layout/layout-storage.ts`
    - `desktop/layout/preferences.tsx`
    - `desktop/layout/types.ts`
    - `desktop/react-renderer.tsx`
    - `desktop/views/home/layout.ts`
    - `desktop/views/home/dashboard-grid.tsx`
    - `desktop/views/home/workspace.tsx`
    - `desktop/views/home/panels.tsx`
    - `desktop/views/home/token-usage-chart.tsx`
    - `desktop/views/home/usage-chart-model.ts`
    - `desktop/views/home/usage-visuals.ts`
    - `desktop/ui/button.tsx`
    - `desktop/ui/primitives.tsx`
    - `test/desktop-layout-engine.test.ts`
    - `test/desktop-renderer.test.ts`
    - `test/desktop-shell-service.test.ts`
    - `package.json`
    - `bun.lock`

## Owned Files

- `desktop/layout/**`
- `desktop/react-renderer.tsx`
- `desktop/views/home/**`
- `desktop/ui/button.tsx`
- `desktop/ui/primitives.tsx`
- `test/desktop-layout-engine.test.ts`
- `test/desktop-renderer.test.ts`
- `test/desktop-shell-service.test.ts`
- `docs/plans/2026-05-23-desktop-dynamic-layouts.md`
- `docs/execution/tasks/W4-DESKTOP-09-home-dynamic-layout.md`
- `docs/execution/context/W4-DESKTOP-09-bootstrap.md`
- `docs/execution/prompts/W4-DESKTOP-09-worker-codex.md`
- `docs/execution/prompts/W4-DESKTOP-09-review-codex.md`
- `.execution/packets/W4-DESKTOP-09.md`
- `.execution/agents/codex-WORKER-home-dynamic-layout.md`

## Forbidden Files

- `src/api/**`
- `src/contracts/**`
- `src/db/**`
- `src/pipeline/**`
- `src/adapters/**`
- `src/sinks/**`
- `src/commands/**`
- `src/daemon/**`
- `desktop/bridge.ts`
- `desktop/daemon-client.ts`
- `desktop/shell-service.ts`
- `desktop/preload.ts`
- `desktop/main.ts`
- blueprint docs

Package manifest and lockfile edits are allowed only for the already-approved
`react-grid-layout@2.2.3` core algorithm dependency. Do not import
`react-grid-layout` DOM renderer or package CSS.

If layout persistence needs filesystem, daemon, or IPC access, stop and return
a BP-11 preference proposal. Renderer `localStorage` is the approved first
storage target for this lane.

## Frozen Contracts

- Desktop remains a typed client of the daemon boundary.
- Renderer must not read SQLite, logs, config files, sockets, daemon auth
  tokens, or arbitrary user files directly.
- Desktop IPC endpoint shape must not change in this packet.
- Runtime, routing, sink, config, lifecycle, identity, and conversation
  semantics remain unchanged.
- Packaged Desktop must keep restrictive CSP. No `style-src 'unsafe-inline'`
  relaxation is authorized by this packet.

## Current Implementation State

As of the 2026-05-24 review-resolution pass:

- `f1af14b` recorded the dynamic layout plan.
- `331dc1e` recorded the package/CSP spike result.
- `0b456da` added the `react-grid-layout/core` data adapter and tests.
- `59bc75a` added Home edit mode, layout preference storage, and drag/resize
  interaction.
- `22e2af7` made Home panels layout-aware from live grid units.

The prior foundation packet was removed from the active execution surface. This
packet now owns both the Home layout foundation and edit-mode follow-through for
review and future packet-scoped fixes.

The first review pass found row-budget overflow, missing edit lifecycle
persistence tests, missing stacked breakpoint context, and incomplete resized
visual evidence. The row-budget, lifecycle, and stacked-context findings are
resolved in the owned file set. Resized-state screenshot evidence remains a
visual follow-up because Computer Use screenshots are stale relative to the
Electron accessibility tree during HMR.

The lane is ready for re-review. Any follow-up worker should fix review
findings inside the owned file set rather than widening contracts.

## Acceptance Checks

- `bun run desktop:typecheck` passes.
- `bun test test/desktop-layout-engine.test.ts test/desktop-renderer.test.ts test/desktop-shell-service.test.ts` passes.
- `bun run desktop:build` passes.
- `git diff --check` passes.
- Home default layout remains stable in view mode.
- Home edit mode exposes move/resize handles only after explicit edit action.
- Save, cancel, and reset behavior are reversible and covered by tests.
- Layout storage validates schema and invalid data falls back safely.
- Resized Home panels compact chart/list content without incoherent overflow.
- No Desktop daemon API, IPC, route, config, lifecycle, sink, pipeline, or
  contract semantics change.
- Packaged renderer remains free of layout-engine inline style/CSS dependency
  adoption.

## BP Acceptance Matrix

| Requirement | Blueprint | Packet expectation |
|-------------|-----------|--------------------|
| Desktop remains daemon client | BP-11 | renderer-owned layout preference state; no daemon/client/bridge edits |
| Renderer-safe IPC only | BP-11 | no generic IPC bridge or filesystem preference store |
| Desktop APIs return daemon view models | BP-11 | Home layout metadata stays UI preference state and does not change Desktop API payloads |
| Restrictive Desktop security posture | BP-11 | reject RGL DOM renderer/CSS; use data-only `react-grid-layout/core` adapter |
| Product value remains local-first observability | BP-Product | Home usage/project/harness panels remain backed by existing daemon view models |
| Developer customization is reversible | BP-Product | edit mode uses explicit save/cancel/reset and schema-backed defaults |
| Expert Desktop UI remains maintainable | BP-Product | layout logic lives in `desktop/layout/**`; panel adaptation uses typed grid context |

## V1 Comparison

Intentional product change: Home layout is now user-adjustable in explicit edit
mode. Default read-only Home behavior and daemon-backed data are preserved.

This replaces no prior persisted v1 dynamic layout surface; the old behavior was
static Home placement only.

## Review Notes

Review should focus on whether the current implementation is a durable base for
customizable Desktop surfaces:

- layout algorithm integration remains renderer/CSP-safe
- storage remains bounded to renderer UI preferences
- panel adaptation is deterministic and not a hidden DOM-measurement system
- edit-mode affordances are usable but absent from normal view mode
- tests prove schema, layout, and renderer boundaries rather than brittle visual
  details
