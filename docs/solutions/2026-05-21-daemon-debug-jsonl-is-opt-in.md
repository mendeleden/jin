---
title: Daemon debug JSONL must be opt-in
date: 2026-05-21
tags: [daemon, pipeline, diagnostics, config]
related: [BP-07, BP-11]
---

# Daemon debug JSONL must be opt-in

## Problem

The long-lived daemon wrote structured diagnostic events to
`~/.config/jin/debug.jsonl` by default. Because the file was append-only and
fed by startup detection, pipeline work, and local API diagnostics, a normal
foreground daemon run could silently grow the file into tens of gigabytes.

## Solution

Gate daemon diagnostic JSONL behind a hidden startup option. Normal
`jin start`, `jin start --foreground`, service launches, and restarts now pass
no diagnostic log path into adapter detection, the pipeline, or the local API
server. When diagnostics are needed, the same path can still be enabled
explicitly and `JIN_DIAGNOSTIC_LOG` remains a path override under that opt-in.

## Key Insight

Long-lived developer daemons need bounded default observability. Append-only
diagnostic streams are useful during investigations, but they must require an
operator opt-in and should not appear in normal help text as a supported daily
surface.

## Prevention

Test the daemon command path both with and without the diagnostic opt-in. The
default path should assert that no `debug.jsonl` is created even when
`JIN_DIAGNOSTIC_LOG` is set, while the opt-in path should assert that the
diagnostic path reaches adapter detection, the pipeline, and the local API
server.

## Related

- BP-07: process lifecycle and runtime ownership
- BP-11: bounded local diagnostics across the Desktop daemon boundary

## Files Changed

- `src/index.ts`
- `src/commands/watch.ts`
- `src/commands/start.ts`
- `src/commands/service.ts`
- `src/daemon/daemonize.ts`
- `test/runtime-store-cutover.test.ts`
- `test/cli-surface-cleanup.test.ts`
- `test/acceptance/verify.ts`
