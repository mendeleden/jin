---
title: Desktop Dynamic Layout Package Spike Failed CSP
date: 2026-05-23
tags: [desktop, security, ui, csp]
related: [W4-DESKTOP-08, BP-11]
---

# Desktop Dynamic Layout Package Spike Failed CSP

## Problem

Jin Desktop needs user-adjustable dashboard panels, and `react-grid-layout`
looked like the fastest mature package path for draggable and resizable React
grids. Packaged Desktop keeps `style-src 'self'`, so renderer-generated inline
style attributes are not acceptable for core visual behavior.

## Solution

A local spike installed `react-grid-layout@2.2.3` and routed Home through an
adapter without persistence. The package immediately emitted inline `style`
attributes for grid height, item transforms, width, height, and absolute
positioning in static render output. The product and package changes were
reverted, and the dynamic layout plan now targets a repo-owned snapped CSS-grid
engine instead.

## Key Insight

Dashboard layout packages commonly use inline styles as their positioning API.
For Jin Desktop, that is not an implementation detail: it crosses the packaged
renderer CSP boundary. A package is only viable if its placement engine can be
made CSP-safe without relaxing Desktop security.

## Prevention

Before adopting layout, chart, graph, or drag/resize packages in Desktop,
validate their rendered output under the packaged CSP model. Static render
output that contains placement-critical `style` attributes is enough to reject
the package path unless an explicit CSP proposal is approved.

## Related

- `docs/plans/2026-05-23-desktop-dynamic-layouts.md`
- `docs/solutions/2026-05-11-desktop-csp-requires-class-based-renderer-visuals.md`
- `docs/blueprint/BP-11-desktop-daemon-boundary.md`

## Files Changed

- `docs/plans/2026-05-23-desktop-dynamic-layouts.md`
- `docs/solutions/2026-05-23-desktop-dynamic-layout-csp-package-spike.md`
