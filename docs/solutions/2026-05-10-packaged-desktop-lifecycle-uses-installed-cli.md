---
title: Packaged Desktop lifecycle uses installed CLI
date: 2026-05-10
tags: [desktop, release, cli, electron]
related: [W4-DESKTOP-03, PR-55]
---

# Packaged Desktop lifecycle uses installed CLI

## Problem

Desktop lifecycle controls passed in development because Electron ran inside the
repo and could call `bun run src/index.ts start|stop|restart`. A packaged
Electron app does not contain the repo checkout, may not contain `src/index.ts`,
and cannot assume Bun is installed for the user.

## Solution

Packaged Desktop lifecycle actions resolve an installed `jin` CLI first, using
an explicit environment override, `PATH`, and known install locations. Repo-local
Bun entrypoints remain available only outside Electron so development and tests
can still exercise the CLI directly.

## Key Insight

Desktop release behavior must be validated from the packaged artifact boundary,
not only from repo-local development execution. Any packaged Electron code that
spawns Jin should target the installed CLI or bundled runtime artifact, never a
source-tree TypeScript path.

## Prevention

Add boundary tests for release-only process resolution whenever Desktop shells
out to Jin. Review packaged Desktop changes for repo path, Bun, or TypeScript
entrypoint assumptions before treating them as shippable.

## Related

- `W4-DESKTOP-03`
- PR #55 review finding: packaged Desktop starts the wrong command

## Files Changed

- `src/api/control.ts`
- `test/local-control-boundary.test.ts`
