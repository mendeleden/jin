---
title: Live config reload needs atomic writes and coordinator-owned apply
date: 2026-05-03
tags: [config, daemon, pipeline, lifecycle, routing]
related: ["#19", BP-08, BP-07]
---

# Live config reload needs atomic writes and coordinator-owned apply

## Problem

`#19` started as a stale-config complaint, but the real bug class was narrower
and more dangerous: config mutation was still a plain load/mutate/save flow with
direct writes to `config.json`, while the runtime held a startup snapshot in
memory. That left two failure modes:

- concurrent config writers could race and lose route or sink changes
- any future live-reload path could observe partial or invalid config content

## Solution

The fix split the problem into two explicit boundaries.

First, durable config mutation now goes through a shared locked helper and
atomic temp-file rename. That makes the on-disk config safe to observe.

Second, the runtime now owns one prioritized `config-reload` transition.
Commands update durable config; the running daemon observes the config file
change, reloads the full config generation, rebuilds sinks, refreshes route and
adapter inputs, and reconciles watcher paths before ordinary queued push work.

## Key Insight

Live config apply is not a command-layer feature. It is a coordinator feature
that only becomes safe after durable writes are atomic.

If commands and runtime code both reread or patch config ad hoc, route
selection, sink lifecycle, and watcher ownership become nondeterministic.

## Prevention

- Treat config mutation as a shared infrastructure concern. New mutating
  commands should use the locked update helper instead of bespoke save logic.
- Keep reload ownership in the coordinator. Do not let individual subsystems
  watch `config.json` and patch themselves independently.
- Test the control path, not just the queue surface: prove that a queued push
  sees refreshed routes after a prioritized reload.
- Keep blueprint wording precise about how live apply happens. If later work
  adds direct command-to-daemon IPC, update BP-07/BP-08 explicitly rather than
  implying it.

## Related

- [BP-08-routing-and-config.md](/Users/edenmendel/Documents/GitHub/jin/docs/blueprint/BP-08-routing-and-config.md)
- [BP-07-process-lifecycle.md](/Users/edenmendel/Documents/GitHub/jin/docs/blueprint/BP-07-process-lifecycle.md)
- [config.ts](/Users/edenmendel/Documents/GitHub/jin/src/config.ts)
- [watch.ts](/Users/edenmendel/Documents/GitHub/jin/src/commands/watch.ts)
- [loop.ts](/Users/edenmendel/Documents/GitHub/jin/src/pipeline/loop.ts)

## Files Changed

- [config.ts](/Users/edenmendel/Documents/GitHub/jin/src/config.ts)
- [config-control.ts](/Users/edenmendel/Documents/GitHub/jin/src/commands/config-control.ts)
- [watch.ts](/Users/edenmendel/Documents/GitHub/jin/src/commands/watch.ts)
- [loop.ts](/Users/edenmendel/Documents/GitHub/jin/src/pipeline/loop.ts)
- [queue.ts](/Users/edenmendel/Documents/GitHub/jin/src/pipeline/queue.ts)
- [types.ts](/Users/edenmendel/Documents/GitHub/jin/src/pipeline/types.ts)
- [config-mutation-control.test.ts](/Users/edenmendel/Documents/GitHub/jin/test/config-mutation-control.test.ts)
- [pipeline-spine.test.ts](/Users/edenmendel/Documents/GitHub/jin/test/pipeline-spine.test.ts)
