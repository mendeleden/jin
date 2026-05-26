---
title: Desktop Dynamic Layout Package Spike Split Renderer From Core
date: 2026-05-23
tags: [desktop, security, ui, csp]
related: [W4-DESKTOP-08, BP-11]
---

# Desktop Dynamic Layout Package Spike Split Renderer From Core

## Problem

Jin Desktop needs user-adjustable dashboard panels, and `react-grid-layout`
looked like the fastest mature package path for draggable and resizable React
grids. Packaged Desktop keeps `style-src 'self'`, so renderer-generated inline
style attributes are not acceptable for core visual behavior. At the same time,
fully repo-owned collision and compaction logic risks rediscovering dashboard
edge cases that mature tools already solved.

## Solution

A local spike installed `react-grid-layout@2.2.3` and routed Home through an
adapter without persistence. The package's React DOM renderer immediately
emitted inline `style` attributes for grid height, item transforms, width,
height, and absolute positioning in static render output, so the DOM renderer
and package CSS were rejected.

A second spike imported only `react-grid-layout/core` through
`desktop/layout/grid-engine.ts`. That adapter maps Jin panel layouts to RGL
layout items, clones at the boundary because RGL helpers mutate their arguments,
and returns Jin-shaped `{ panelId, x, y, w, h }` data. Focused tests cover
movement, collision blocking, resize compaction, min-size clamping, immutability,
and renderer isolation. A temporary Bun bundle of the adapter built to 5.77 KB
and did not include `react-draggable`, `react-resizable`, React JSX, RGL CSS, or
RGL style helpers.

## Key Insight

Dashboard layout packages commonly use inline styles as their positioning API,
but `react-grid-layout@2` exposes its algorithm layer separately. For Jin
Desktop, the right boundary is not "package or no package"; it is "package DOM
renderer or data-only algorithm adapter." Use mature collision/compaction logic
where possible, but keep Desktop rendering and CSP posture owned by Jin.

## Prevention

Before adopting layout, chart, graph, or drag/resize packages in Desktop,
validate both rendered output and subpath bundle behavior under the packaged CSP
model. Static render output that contains placement-critical `style` attributes
is enough to reject the DOM renderer unless an explicit CSP proposal is
approved. If a package has a core/headless entrypoint, wrap it in a data-only
adapter and test that the live renderer does not import package CSS or DOM
components.

## Related

- `docs/plans/2026-05-23-desktop-dynamic-layouts.md`
- `docs/solutions/2026-05-11-desktop-csp-requires-class-based-renderer-visuals.md`
- `docs/blueprint/BP-11-desktop-daemon-boundary.md`

## Files Changed

- `docs/plans/2026-05-23-desktop-dynamic-layouts.md`
- `docs/solutions/2026-05-23-desktop-dynamic-layout-csp-package-spike.md`
- `desktop/layout/grid-engine.ts`
- `test/desktop-layout-engine.test.ts`
- `package.json`
- `bun.lock`
