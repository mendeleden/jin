---
title: Release gates must drop dead compatibility lanes
date: 2026-04-29
tags: [routing, config, migration]
related: [W3-CLEANUP-02, BP-08, BP-09, BP-10]
---

# Release gates must drop dead compatibility lanes

## Problem

Jin had already moved routing and release behavior onto BP-owned v2 surfaces,
but release validation still exercised deleted compatibility paths:

- `test/progress.test.ts` imported the removed watch-path seam
- `test/search.test.ts` depended on `project` route matching, `defaultSinks`,
  and the dead `src/sink-resolver.ts` helper
- CI still ran the legacy search test even though the live product path no
  longer used it

That left `main` red for behavior Jin had already chosen to delete.

## Solution

The cleanup treated the stale tests and helper as part of the dead surface:

- delete `src/sink-resolver.ts`
- delete `test/search.test.ts`
- keep `test/progress.test.ts` focused on the live file-backed progress module
- remove legacy `project` / `directory` / `defaultSinks` / `routeUnmatchedToAll`
  hints from the exported config shape
- update CI to run only the surviving BP-backed tests

## Key Insight

In Jin, a hard cut is not complete when only the product code changes. The
release gate must also stop naming the deleted compatibility lane:

- dead helper files
- stale exported types
- test files built around removed semantics
- CI script entries that keep those tests alive

If any of those survive, the repo can fail release validation for behavior the
blueprints already disowned.

## Prevention

- When deleting a compatibility path, audit its tests and CI entries in the
  same packet.
- Treat exported type aliases as part of the live surface; remove legacy route
  fields there even if normalization already strips them.
- Prefer deleting dead compatibility tests over porting them unless the
  behavior is still BP-backed and owned.

## Related

- Packet: `W3-CLEANUP-02`
- Blueprint: `BP-08`
- Blueprint: `BP-09`
- Blueprint: `BP-10`

## Files Changed

- `.github/workflows/ci.yml`
- `src/config.ts`
- `src/sink-resolver.ts`
- `test/progress.test.ts`
- `test/search.test.ts`
