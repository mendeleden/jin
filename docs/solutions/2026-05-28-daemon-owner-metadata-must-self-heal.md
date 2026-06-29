---
title: Daemon Owner Metadata Must Self-Heal Before Lifecycle Actions
date: 2026-05-28
tags: [daemon, lifecycle, desktop]
related: [BP-11, W3-RUNTIME-01]
---

# Daemon Owner Metadata Must Self-Heal Before Lifecycle Actions

## Problem

A live Jin runtime can keep serving the local API socket after `jin.pid` and
`jin.runtime.json` disappear or drift. In that state, file-based status reports
`stopped` while the socket still belongs to a running process. A subsequent
`jin start` can then try to create a second runtime owner against the same
store/socket surface.

## Solution

Keep daemon ownership policy centralized in `runtime-state.ts` and make cleanup
compare the expected owner before deleting metadata. A running local control
boundary now reports status from the current process, and control actions repair
that owner metadata before delegating to CLI lifecycle commands. CLI start paths
also probe the local control socket when file metadata says stopped, and refuse
to spawn a second owner if the socket is already responding.

## Key Insight

PID files are only hints unless every writer treats them as conditional owner
records. Lifecycle actions need a second source of truth: either the supervisor
or the daemon's own control socket. For Jin, the socket is the local arbiter
that can self-identify the active process and restore missing metadata.

## Prevention

- Clear `jin.pid` and `jin.runtime.json` only when the current file still
  belongs to the expected owner.
- Treat persisted runtime state from a drifted owner as stale before applying
  states such as `stopping` or `degraded`.
- Compare PID, mode, paths, and process start time when detecting owner drift.
- Before spawning a detached daemon or enabling service mode from a stopped
  file state, probe `/api/control/status` on the local socket.
- Repair current-process owner metadata before a live control API delegates
  `start`, `stop`, or `restart` to the CLI.
- Cover lifecycle edge cases with contained temp-config tests instead of using
  the developer's real daemon state.

## Related

- `docs/blueprint/BP-11-desktop-daemon-boundary.md`
- `test/runtime-state-local-owner.test.ts`
- `test/lifecycle-boundary.test.ts`

## Files Changed

- `src/daemon/runtime-state.ts`
- `src/daemon/process-state.ts`
- `src/commands/start.ts`
- `src/commands/watch.ts`
- `src/api/control.ts`
- `src/api/client.ts`
- `test/runtime-state-local-owner.test.ts`
- `test/lifecycle-boundary.test.ts`
- `test/local-control-boundary.test.ts`
