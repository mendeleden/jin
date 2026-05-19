---
title: Snapshot chart geometry uses display buckets
date: 2026-05-16
tags: [desktop, renderer, chart]
related: [W4-DESKTOP-06]
---

# Snapshot Chart Geometry Uses Display Buckets

## Problem

The Desktop Home token chart can fall back from daily timeline rows to one
snapshot aggregate bucket. Rendering that canonical bucket directly gives the
stacked area only one x-coordinate, so the visible chart collapses into a
vertical strip even though the panel has height.

## Solution

Keep the snapshot bucket canonical for totals, callouts, and adapter ordering,
but derive display-only buckets for SVG geometry. A snapshot aggregate should
render as a constant two-point band labelled as a snapshot/current state, not as
a synthetic trend.

## Key Insight

Visualization helpers may need extra points to draw meaningful geometry, but
those points must not enter accounting paths. Duplicate only the render input
needed by the SVG layer, then continue computing KPIs from canonical daemon
data.

## Prevention

Renderer tests should inspect the SVG path coordinates for aggregate fallback
charts and assert that KPI totals still match the single canonical snapshot.

## Related

- `docs/execution/tasks/W4-DESKTOP-06-full-react-cutover-and-home-observatory.md`

## Files Changed

- `desktop/components/app-shell.tsx`
- `test/desktop-renderer.test.ts`
