---
title: Desktop release assets must match install targets
date: 2026-05-10
tags: [desktop, release, ci, cli]
related: [W4-DESKTOP-03, PR-55, ISSUE-56]
---

# Desktop release assets must match install targets

## Problem

The first Desktop release path could publish or advertise artifacts that were
not actually shippable. Windows Desktop could be packaged even though the
daemon query boundary has no Windows transport yet, and `jin desktop` could look
for platform/architecture assets that the release workflow does not produce.

## Solution

Keep Desktop distribution limited to targets that have both package artifacts
and daemon transport support. The first release publishes only macOS arm64,
macOS x64, and Linux x64 Desktop artifacts. Windows Desktop stays blocked
behind issue #56.

## Key Insight

A passing package job only proves that Electron can be zipped on a runner. It
does not prove that the installed Desktop can reach the daemon or that the CLI
installer can find a matching artifact for the user's platform.

## Prevention

Whenever Desktop release targets change, update the release matrix, packaging
script guard, `jin desktop` asset candidates, and tests in one patch.

## Related

- `W4-DESKTOP-03`
- PR #55 review findings on Windows Desktop distribution and missing assets
- Issue #56: Windows Desktop daemon transport

## Files Changed

- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `package.json`
- `scripts/package-desktop.ts`
- `src/commands/desktop.ts`
- `test/desktop-command.test.ts`
