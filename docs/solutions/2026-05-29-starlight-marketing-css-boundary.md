---
title: Keep Starlight Theme CSS Separate From Marketing Page CSS
date: 2026-05-29
tags: [migration, frontend, docs]
related: []
---

# Keep Starlight Theme CSS Separate From Marketing Page CSS

## Problem

During the Astro and Starlight site migration, the first shared stylesheet mixed global marketing selectors such as `.hero`, `.button`, and heading resets with Starlight `customCss`. Because Starlight loads `customCss` across docs routes, the docs splash page inherited marketing layout rules and rendered with unreadable hero text.

## Solution

Split the styling boundary:

- `src/styles/theme.css` owns shared tokens and narrow Starlight theme overrides.
- `src/styles/marketing.css` owns the landing page layout and is imported only by `MarketingLayout.astro`.

This keeps the marketing page expressive without letting broad selectors restyle documentation routes.

## Key Insight

In Astro sites that combine a custom marketing page with Starlight docs, `customCss` is a docs-wide theming surface, not a general app stylesheet. Broad marketing selectors should stay behind a marketing layout import or an explicit page scope.

## Prevention

After future site styling changes, verify both `/` and `/docs/` in the browser. If a selector is meant only for the landing page, place it in the marketing stylesheet or scope it under a marketing-only root class.

## Related

No review ID or blueprint item.

## Files Changed

- `site/src/styles/theme.css`
- `site/src/styles/marketing.css`
- `site/src/layouts/MarketingLayout.astro`
