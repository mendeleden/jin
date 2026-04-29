---
title: Cursor Layer 1 should be periodic only
date: 2026-04-17
tags: [adapter, pipeline, daemon]
related: []
---

# Cursor Layer 1 should be periodic only

## Problem

Cursor's shared `state.vscdb` changes frequently for reasons that are not
conversation updates. Even with warm discovery cache, treating every Layer 1
file write as `fs-change` caused the daemon to schedule repeated no-op ingest
work and keep the parent process hot.

## Solution

Keep Cursor Layer 3 on file-watch driven `fs-change`, but stop treating Cursor
Layer 1 as a watcher-driven source. Layer 1 is now discovered on `startup-scan`
and `periodic-scan` only.

## Key Insight

Some sources are semantically expensive but operationally noisy. For those
sources, a warm periodic check is a better trigger than raw file activity.

## Prevention

- Do not assume every SQLite file is a good `fs-change` source.
- Separate "responsive enough" from "react to every write" in adapter policy.
- Add adapter regressions that prove noisy shared state does not create endless
  no-op ingest loops.

## Related

- [cursor.ts](/Users/edenmendel/Documents/GitHub/jin/src/adapters/cursor.ts)
- [cursor-adapter.test.ts](/Users/edenmendel/Documents/GitHub/jin/test/cursor-adapter.test.ts)

## Files Changed

- [cursor.ts](/Users/edenmendel/Documents/GitHub/jin/src/adapters/cursor.ts)
- [cursor-adapter.test.ts](/Users/edenmendel/Documents/GitHub/jin/test/cursor-adapter.test.ts)
