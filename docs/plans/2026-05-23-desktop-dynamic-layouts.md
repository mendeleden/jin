---
title: Desktop Dynamic Layouts
phase: W4 Desktop
status: draft
created: 2026-05-23
---

# Desktop Dynamic Layouts

## Context

Jin Desktop is moving from a large renderer/CSS surface toward modular,
surface-owned React components with Tailwind utilities and explicit layout
models. W4-DESKTOP-08 created the first dynamic-layout seam: Home panels now
render from a typed registry and `{ panelId, x, y, w, h }` layout data instead
of hard-coded panel placement.

The next step is to make Home panels user-adjustable without weakening the
Desktop daemon boundary or reintroducing renderer inline-style/CSP regressions.
The layout state is Desktop UI preference state. It must not become daemon
state, and the renderer must not gain generic filesystem, socket, or daemon
access.

Relevant source material:

- `docs/execution/tasks/W4-DESKTOP-08-modular-layout-foundation.md`
- `docs/brainstorms/2026-05-22-desktop-modular-css-dynamic-layout.md`
- `docs/blueprint/BP-11-desktop-daemon-boundary.md`
- `docs/solutions/2026-05-11-desktop-csp-requires-class-based-renderer-visuals.md`
- `desktop/views/home/layout.ts`
- `desktop/views/home/dashboard-grid.tsx`
- `desktop/preferences.tsx`

## Approach

Keep layout as versioned data and isolate the interaction engine behind a narrow
`EditableDashboardGrid` adapter. Home is the first target because it already has
panel registry data, stable panel IDs, and predictable chart/list panels. Other
surfaces can opt in later only after Home proves the model.

The implementation should preserve the current read-only dashboard by default.
Users enter an explicit edit mode before panels become draggable or resizable.
Save, cancel, and reset must be first-class controls so customization remains
reversible.

## Engine Decision

`react-grid-layout` was the mature candidate. It supports draggable and
resizable widgets, responsive breakpoints, serializable layouts, min/max
constraints, collision resolution, compaction, and TypeScript in v2. Its React
DOM renderer places grid items using inline styles and CSS transforms, but v2
also exposes a framework-agnostic `react-grid-layout/core` entrypoint.

Because Desktop currently treats CSP-safe class-based visuals as a hard-earned
constraint, do not adopt a dashboard-grid dependency blindly. The first
implementation step is a small CSP/package spike:

- If the `react-grid-layout` DOM renderer works in packaged Desktop without
  inline-style CSP violations or unacceptable bundle/style compromises, use it
  through the adapter.
- If the DOM renderer requires relaxing packaged CSP, keep rendering owned by
  Jin but test whether `react-grid-layout/core` can provide collision,
  compaction, and constraint algorithms behind a narrow adapter.
- If even the core entrypoint leaks styling or renderer assumptions, keep the
  layout adapter but implement snapped pointer drag/resize over the existing
  class-bucket CSS grid.

The product-facing layout model must not depend on which engine wins.

### Spike Result: react-grid-layout DOM Rejected, Core Accepted

On 2026-05-23, a local spike installed `react-grid-layout@2.2.3` and routed
Home through a narrow `EditableDashboardGrid` adapter without persistence. The
package rendered grid placement with inline `style` attributes for container
height, item transforms, width, height, and absolute positioning. The evidence
appeared immediately in `renderToStaticMarkup` output while running
`bun test test/desktop-renderer.test.ts test/desktop-shell-service.test.ts`.

That violates the packaged Desktop `style-src 'self'` constraint documented in
`docs/solutions/2026-05-11-desktop-csp-requires-class-based-renderer-visuals.md`.
Keeping the package would require weakening CSP or building an extensive custom
positioning layer around the package, which defeats the purpose of adopting it.

Decision: do not adopt the `react-grid-layout` React DOM renderer or its CSS for
Jin Desktop dynamic layouts.

A follow-up spike kept the package but imported only `react-grid-layout/core`
from `desktop/layout/grid-engine.ts`. The adapter maps Jin layout data to RGL
layout data, clones at the boundary because several RGL helpers mutate their
arguments, and returns `{ panelId, x, y, w, h }` data without RGL DOM metadata.
Focused tests proved movement, collision blocking, resize compaction, min-size
clamping, and renderer isolation. A temporary Bun bundle of the adapter built in
5 modules at 5.77 KB and did not include `react-draggable`, `react-resizable`,
React JSX, RGL CSS, or RGL style helpers.

Updated decision: keep `react-grid-layout@2.2.3` as an algorithm dependency
behind the `desktop/layout/grid-engine.ts` adapter. Keep the renderer owned by
Jin through CSS Grid/Tailwind classes so packaged Desktop does not need
`style-src 'unsafe-inline'`.

## Files to Change

### Create

- `desktop/layout/preferences.tsx` - layout preference provider, storage key
  handling, schema-version migration, reset helpers.
- `desktop/layout/types.ts` - shared layout schema types for surfaces,
  breakpoints, panel constraints, and saved layouts.
- `desktop/layout/grid-engine.ts` - RGL-core-backed layout algorithm adapter
  that exposes Jin-shaped movement and resize operations without DOM rendering.
- `desktop/layout/editable-dashboard-grid.tsx` - repo-owned snapped engine that
  renders draggable/resizable panels in edit mode and read-only panels
  otherwise.
- `desktop/layout/layout-storage.ts` - local renderer persistence helpers with
  defensive parsing and schema validation.
- `desktop/layout/collision.ts` - collision and bounds helpers for the
  repo-owned snapped grid engine.

### Modify

- `desktop/react-renderer.tsx` - wrap the app in the layout preferences
  provider beside the existing Desktop preferences provider.
- `desktop/views/home/layout.ts` - extend Home definitions with resize handles,
  max sizes where needed, breakpoint defaults, and schema migration metadata.
- `desktop/views/home/dashboard-grid.tsx` - delegate rendering to
  `EditableDashboardGrid` while preserving current static data attributes.
- `desktop/views/home/workspace.tsx` - add edit/save/cancel/reset layout
  actions and pass Home layout state into the grid.
- `desktop/views/home/panels.tsx` - make panel content size-aware, especially
  chart heights, scroll regions, compact variants, and minimum usable states.
- `desktop/views/home/token-usage-chart.tsx` - ensure chart rendering responds
  cleanly to panel height/width changes.
- `desktop/views/settings/workspace.tsx` - expose layout reset or layout
  storage status only if it fits naturally after Home edit mode exists.
- `desktop/ui/primitives.tsx` and `desktop/ui/button.tsx` - add any missing
  shared edit-mode controls without one-off local styling.
- `test/desktop-renderer.test.ts` - cover schema normalization, edit-mode
  markup, save/cancel/reset affordances, and default layout preservation.
- `package.json` and `bun.lock` - keep `react-grid-layout@2.2.3` only for the
  `react-grid-layout/core` algorithm entrypoint. Do not import the package DOM
  renderer or CSS.

### Delete

- None planned. Existing `DashboardGrid` should evolve rather than be replaced
  outright so current tests and layout metadata remain useful.

## Implementation Sequence

1. **Write package/CSP spike**
   Completed on 2026-05-23 in two passes. The `react-grid-layout@2.2.3` DOM
   renderer was rejected because it rendered inline style attributes for core
   placement. The `react-grid-layout/core` algorithm entrypoint was accepted
   behind `desktop/layout/grid-engine.ts`, with focused tests covering movement,
   collision blocking, resize compaction, min constraints, immutability, and
   renderer isolation.

2. **Create layout preference model**
   Add a provider and storage helpers for versioned layout state. Support
   schema defaults, invalid-state fallback, and reset-to-defaults. Keep storage
   renderer-local at first, matching the refresh interval preference pattern.

   Completed on 2026-05-23. Home layout preferences now live behind
   `DesktopLayoutPreferencesProvider`, read/write `jin.desktop.layouts.v1` in
   renderer `localStorage`, and normalize invalid or stale data back to
   `home-grid-v1` defaults.

3. **Add Home edit mode**
   Add explicit edit/save/cancel/reset controls. Read-only mode must be visually
   identical to the current dashboard except for an unobtrusive edit affordance.
   Edit mode should show handles, drag cursor affordances, and subtle grid
   guides.

   Initial implementation completed on 2026-05-23. Home exposes an `Edit layout`
   action, then switches to Reset/Cancel/Save controls with per-panel move and
   resize handles. Save persists the draft layout; Cancel discards draft changes;
   Reset restores the draft to defaults before saving.

4. **Wire drag and resize**
   Implement movement and resizing through the repo-owned snapped renderer and
   the `grid-engine.ts` algorithm adapter. Snap to a 12-column grid and row
   units. Respect `minW`, `minH`, and panel-specific max constraints. Prevent
   unusable panel sizes.

   Initial implementation completed on 2026-05-23. Pointer drag/resize and
   keyboard arrow interactions mutate draft Home layout through
   `moveDesktopGridPanel` and `resizeDesktopGridPanel`, while rendering remains
   CSS Grid/Tailwind owned.

5. **Make panels size-aware**
   Ensure charts, project lists, harness timelines, and empty states adapt to
   smaller/larger panels. Small panels should compact content rather than clip
   text or overflow incoherently.

   Initial implementation completed on 2026-05-23. `DashboardGrid` now derives
   a normalized panel render context from live grid units and passes it to Home
   panels. The token chart switches compact/standard/expanded chrome and chart
   heights, while project and harness panels adjust visible item counts,
   compact labels, metadata, and mini-chart heights from the same context.

6. **Persist and migrate**
   Save only after explicit user confirmation in edit mode. Include layout
   schema version in storage. Unknown panel IDs, invalid numbers, or old
   versions should fall back to defaults or migrate safely.

7. **Validate visually and statically**
   Add static renderer tests for layout data and controls. Use Computer Use or
   browser-style screenshot checks for Home default, Home edit mode, resized
   chart panel, and reset behavior at desktop and narrow widths.

8. **Commit in small slices**
   Use one commit for the spike decision, one for preference/schema plumbing,
   one for Home edit mode, one for interaction/persistence, and one for visual
   polish/tests. Do not bury package, model, and UI changes in one commit.

## Risks & Mitigations

- **Risk**: A grid package relies on inline styles or CSS transforms that
  conflict with packaged Desktop CSP.
  **Mitigation**: Reject the package DOM renderer. Use only
  `react-grid-layout/core` behind a data-only adapter, and keep renderer tests
  guarding against package CSS, RGL DOM imports, and inline placement styles.

- **Risk**: Users create layouts that make panels unusable.
  **Mitigation**: Enforce panel min/max sizes, compact panel variants, and
  reset-to-defaults.

- **Risk**: Layout preference state becomes daemon or IPC sprawl.
  **Mitigation**: Keep layout as renderer-owned Desktop preference state unless
  a narrow BP-11 preference proposal is explicitly approved.

- **Risk**: Drag mode makes the normal dashboard feel unstable.
  **Mitigation**: Keep drag/resize disabled outside edit mode.

- **Risk**: Static tests pass while charts clip or render blank after resize.
  **Mitigation**: Add screenshot-driven checks for default, edited, and reset
  states.

- **Risk**: Responsive behavior breaks because one desktop layout is forced
  onto narrow widths.
  **Mitigation**: Store layouts by breakpoint or fall back to stacked defaults
  below the desktop breakpoint.

## Validation

- [ ] `bun run desktop:typecheck`
- [ ] `bun test test/desktop-renderer.test.ts test/desktop-shell-service.test.ts`
- [ ] `bun run desktop:build`
- [ ] `git diff --check`
- [ ] Packaged Desktop has zero inline-style CSP violations for Home layout
      interactions.
- [ ] Home default layout visually matches the current dashboard.
- [ ] Home edit mode visibly exposes drag/resize affordances.
- [ ] Resized chart/list panels remain readable and non-overlapping.
- [ ] Reset returns the exact default layout.
- [ ] Narrow viewport behavior stacks or adapts predictably.

### 2026-05-23 Layout Preference/Edit Validation

- [x] `bun run desktop:typecheck`
- [x] `bun test test/desktop-layout-engine.test.ts test/desktop-renderer.test.ts test/desktop-shell-service.test.ts`
- [x] `bun run desktop:build`
- [x] `git diff --check`
- [x] Computer Use visual pass: Home renders in dev, edit mode exposes
      Reset/Cancel/Save plus move/resize handles, keyboard movement mutates the
      draft, and Cancel restores the read-only dashboard.

### 2026-05-23 Size-Aware Panel Validation

- [x] `bun run desktop:typecheck`
- [x] `bun test test/desktop-layout-engine.test.ts test/desktop-renderer.test.ts test/desktop-shell-service.test.ts`
- [x] `bun run desktop:build`
- [x] `git diff --check`

## Open Questions

- Should Home layout changes save only after explicit Save, or autosave after
  each drag/resize with undo?
- Should we expose layout reset in Home only, Settings only, or both?
- Should layout preferences remain renderer `localStorage` for v1, or should we
  design a narrow Electron user-data preference store before shipping?
- Should mobile/narrow layout be user-customizable, or always derived from the
  desktop layout?
- Is a 12-column snapped grid enough, or do we need pixel-level resizing for any
  specific user workflow?

## Approval Gate

Do not implement dynamic dragging/resizing until this plan is approved or
revised. The next implementation commit should be the package/CSP spike so the
engine choice is evidence-based before we build persistence and product UI.
