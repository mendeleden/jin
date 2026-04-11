---
title: Version source of truth is split between package.json and src/updater.ts
date: 2026-04-08
tags: [config, daemon, migration]
related: [W3-SERVICE-01, W3-V2-01]
---

# Version source of truth is split between package.json and src/updater.ts

## Problem

The product version is not defined in one place.

Today there are two live version sources:

- `package.json`
- `src/updater.ts`

At the time of this note, both still say `0.8.2`.

That makes release prep easy to get wrong:

- `jin version` looks correct only if both are kept in sync
- updater/release logic can drift from the CLI version
- a release bump becomes a scavenger hunt instead of one explicit step

## Solution

For the immediate operational read:

- the version was **not** bumped yet
- the two locations that must currently be changed are:
  - `package.json`
  - `src/updater.ts`

For future cleanup, the version should have one source of truth and the other
surface should be generated or injected at build time.

## Key Insight

This is not just a “search harder” issue. It is a duplicated release contract.

If a release-critical value lives in more than one hand-edited file, release
work becomes error-prone even when engineers know the repo well.

## Prevention

- Treat version bumps as a packeted release step, not an implicit side task.
- Keep a short release checklist that explicitly names every version-bearing
  file until the duplication is removed.
- Follow up by collapsing the version to one source of truth, ideally
  `package.json` with build-time injection into updater code.

## Related

- `W3-SERVICE-01` already assumed the version bump but had not executed it yet.
- `W3-V2-01` established the release-prep checklist pattern; version bump
  should stay an explicit line item there until the duplication is removed.

## Files Changed

- `docs/solutions/2026-04-08-version-source-of-truth-is-split.md`
