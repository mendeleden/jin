---
title: Desktop Grid Layouts Need Board-Level Validity
date: 2026-05-24
tags: [desktop, ui, layout, testing]
related: [W4-DESKTOP-09, BP-11]
---

# Desktop Grid Layouts Need Board-Level Validity

## Problem

Home layout resize initially trusted per-panel clamping and RGL compaction to
produce usable dashboard data. A tall chart resize could push sibling panels
beyond the 12-row board. Later schema normalization clamped those siblings back
inside the board, creating overlapping persisted layout data.

## Solution

Treat the whole board as the validity boundary. The grid adapter now validates
candidate layouts against fixed row budgets, column bounds, and pairwise
collisions before returning them. If a requested move or resize would overflow
or collide, the adapter walks back along the snapped gesture vector and returns
the furthest valid layout. Stored Home layouts also reject overlaps and fall
back to defaults.

## Key Insight

Grid normalization is not a repair strategy for persisted user layouts. It can
turn an overflow bug into an overlap bug. Future dynamic surfaces should enforce
board-level invariants at the interaction boundary and again at the storage
boundary.

## Prevention

Every editable Desktop layout surface should have focused tests for:

- maximum resize inside a fixed row budget
- overlap rejection after storage normalization
- explicit Save/Cancel behavior so drafts do not persist accidentally
- built-artifact checks that layout engines remain data-only under Desktop CSP

## Related

- `docs/plans/2026-05-23-desktop-dynamic-layouts.md`
- `docs/solutions/2026-05-23-desktop-dynamic-layout-csp-package-spike.md`
- `.execution/reviews/2026-05-23-W4-DESKTOP-09-react-layout-codex.md`
- `.execution/reviews/2026-05-23-W4-DESKTOP-09-platform-ux-codex.md`

## Files Changed

- `desktop/layout/grid-engine.ts`
- `desktop/views/home/layout.ts`
- `desktop/views/home/layout-editor-state.ts`
- `desktop/views/home/workspace.tsx`
- `test/desktop-layout-engine.test.ts`
- `test/desktop-renderer.test.ts`
