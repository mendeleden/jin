---
title: Exact file watches avoid SQLite sidecar churn
date: 2026-04-17
tags: [adapter, pipeline, daemon]
related: []
---

# Exact file watches avoid SQLite sidecar churn

## Problem

Cursor Layer 1 watched the entire `globalStorage` directory instead of the
owned `state.vscdb` file. SQLite sidecar files such as `state.vscdb-wal` and
`state.vscdb-shm` changed frequently, so the daemon kept enqueueing `fs-change`
ingest work that loaded `0` conversations and burned CPU while parent RSS
stayed hot.

## Solution

Treat file watch targets as first-class paths in the watcher and let Cursor
watch the exact `state.vscdb` file for Layer 1. Tighten path matching so a
changed path only counts as touching a target when it is the exact path or a
real descendant, not a sibling that merely shares a prefix.

## Key Insight

For SQLite-backed sources, watching the parent directory is often too broad.
`foo.db-wal` and `foo.db-shm` are siblings of `foo.db`, not descendants. Prefix
matching turns allocator and checkpoint churn into fake semantic changes.

## Prevention

- Prefer exact file watches when the adapter owns a single SQLite database file.
- Use path-boundary checks, not raw `startsWith`, for descendant detection.
- Add adapter regressions for `fs-change` hints on `-wal` and `-shm` sidecars.

## Related

- [cursor.ts](/Users/edenmendel/Documents/GitHub/jin/src/adapters/cursor.ts)
- [file-watcher.ts](/Users/edenmendel/Documents/GitHub/jin/src/pipeline/file-watcher.ts)
- [cursor-adapter.test.ts](/Users/edenmendel/Documents/GitHub/jin/test/cursor-adapter.test.ts)

## Files Changed

- [cursor.ts](/Users/edenmendel/Documents/GitHub/jin/src/adapters/cursor.ts)
- [file-watcher.ts](/Users/edenmendel/Documents/GitHub/jin/src/pipeline/file-watcher.ts)
- [cursor-adapter.test.ts](/Users/edenmendel/Documents/GitHub/jin/test/cursor-adapter.test.ts)
