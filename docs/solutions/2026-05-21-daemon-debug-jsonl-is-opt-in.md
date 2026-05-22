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

Gate diagnostic JSONL behind a hidden startup option and resolve that policy in
one module. Normal `jin start`, `jin start --foreground`, service launches,
restarts, and `jin sink repush` pass no diagnostic log path into adapter
detection, the pipeline, or the local API server. When diagnostics are needed,
the same path can still be enabled explicitly and `JIN_DIAGNOSTIC_LOG` remains
a path override under that opt-in.

## Key Insight

Long-lived developer daemons need bounded default observability. Append-only
diagnostic streams are useful during investigations, but they must require an
operator opt-in and should not appear in normal help text as a supported daily
surface.

The opt-in policy itself must be owned centrally. A scattered fix that updates
only the first command path is fragile: every future caller has to remember that
`JIN_DIAGNOSTIC_LOG` is not an enable switch and that `debug.jsonl` is not a
default runtime artifact. Centralizing the policy makes the intended behavior a
small API instead of a convention.

## Prevention

Test both the policy boundary and command paths. The policy test should assert
that `JIN_DIAGNOSTIC_LOG` is a path override, not an enable switch. The default
command path should assert that no `debug.jsonl` is created even when
`JIN_DIAGNOSTIC_LOG` is set, while the opt-in path should assert that the
diagnostic path reaches adapter detection, the pipeline, and the local API
server.

During review, search for direct `debug.jsonl` path construction,
`JIN_DIAGNOSTIC_LOG` reads, and `DiagnosticLogger` construction. Production
commands should go through the central debug JSONL policy; lower-level
diagnostic utilities may still write when an already-resolved path is passed in.

## Related

- BP-07: process lifecycle and runtime ownership
- BP-11: bounded local diagnostics across the Desktop daemon boundary

## Files Changed

- `src/index.ts`
- `src/diagnostics/debug-jsonl.ts`
- `src/commands/watch.ts`
- `src/commands/start.ts`
- `src/commands/service.ts`
- `src/commands/sink.ts`
- `src/daemon/daemonize.ts`
- `test/debug-jsonl-policy.test.ts`
- `test/runtime-store-cutover.test.ts`
- `test/config-mutation-control.test.ts`
- `test/cli-surface-cleanup.test.ts`
- `test/acceptance/verify.ts`
