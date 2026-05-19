---
title: Screenshot-driven Desktop UI iteration
date: 2026-05-17
tags: [desktop, ui, review, workflow]
related: [W4-DESKTOP-07, BP-11]
---

# Screenshot-driven Desktop UI iteration

## Problem

Desktop visual work can pass typecheck and static-render tests while still
regressing real layout. In W4-DESKTOP-07, a CSS density pass made Conversations
look cleaner in markup but compressed library rows to the point that metadata
was clipped in Electron.

## Solution

Keep screenshots as first-class packet artifacts and run visual review against
those images before committing the iteration. Use static tests for contract
coverage, then use Electron/CDP screenshots to verify actual layout, overflow,
and hierarchy.

## Key Insight

For Desktop UI work, screenshots are not cosmetic evidence. They are the only
cheap way to catch renderer/layout regressions that typed React and server-side
markup tests cannot observe.

## Prevention

- Capture Home/Conversations screenshots after meaningful visual changes.
- Ask reviewers for concrete P1/P2/P3 visual findings against the screenshots.
- Re-check real element dimensions when screenshots show clipping or overflow.
- Commit the final visual checkpoint with the packet so future reviewers inspect
  the exact state being discussed.

## Related

- `docs/execution/tasks/W4-DESKTOP-07-skinny-luxury-ui-overhaul.md`
- `docs/execution/audits/2026-05-17-W4-DESKTOP-07-ux-review.md`
- `docs/blueprint/BP-11-desktop-daemon-boundary.md`

## Files Changed

- `desktop/components/app-shell.tsx`
- `desktop/graph-components.tsx`
- `desktop/styles.css`
- `test/desktop-renderer.test.ts`
- `docs/execution/artifacts/W4-DESKTOP-07/`
