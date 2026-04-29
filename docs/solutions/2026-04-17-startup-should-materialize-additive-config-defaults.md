---
title: Startup should materialize additive config defaults
date: 2026-04-17
tags: [config, daemon, lifecycle]
related: [BP-08, BP-07]
---

# Startup should materialize additive config defaults

## Problem

`jin start` bootstrapped `config.json` on first run, but it did not update an
existing config file with newly introduced adapter stanzas or missing default
sections. That left an odd operator gap: the runtime could act on normalized
in-memory adapter defaults while `~/.config/jin/config.json` still looked stale.

## Solution

Startup now materializes missing default config stanzas into an existing
`config.json` before taking the runtime snapshot. The write is additive only:
missing adapter entries and missing required default sections are added, while
explicit user values are preserved.

This lane also preserved `watch.debounceMs` through config normalization so the
startup materialization path does not silently strip operator-set watch tuning.

## Key Insight

In a bootstrap-first CLI with no separate `jin init`, `jin start` has to do
more than create a missing config file. It also has to keep the persisted config
legible to operators by materializing safe defaults that the runtime already
depends on.

## Prevention

- Test startup against an existing partial `config.json`, not just the first-run
  empty-dir case.
- Treat additive config materialization as a startup concern; do not mix runtime
  telemetry or detected state into `config.json`.
- Preserve operator-owned extensions during normalization so writeback does not
  erase unrelated config tuning.

## Related

- [BP-08-routing-and-config.md](/Users/edenmendel/Documents/GitHub/jin/docs/blueprint/BP-08-routing-and-config.md)
- [config.ts](/Users/edenmendel/Documents/GitHub/jin/src/config.ts)
- [config.test.ts](/Users/edenmendel/Documents/GitHub/jin/test/config.test.ts)

## Files Changed

- [config.ts](/Users/edenmendel/Documents/GitHub/jin/src/config.ts)
- [config.test.ts](/Users/edenmendel/Documents/GitHub/jin/test/config.test.ts)
- [BP-08-routing-and-config.md](/Users/edenmendel/Documents/GitHub/jin/docs/blueprint/BP-08-routing-and-config.md)
