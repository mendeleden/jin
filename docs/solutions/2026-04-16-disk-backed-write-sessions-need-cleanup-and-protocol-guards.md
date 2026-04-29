---
title: Disk-backed write sessions need cleanup and protocol guards, not just staging tables
date: 2026-04-16
tags: [pipeline, schema, daemon, migration]
related: [W3-PERF-11, W3-PERF-10, BP-02, BP-05]
---

# Disk-backed write sessions need cleanup and protocol guards, not just staging tables

## Problem

Moving the parent-side store session from an in-memory buffer to SQLite staging
removes the largest RSS smell, but it also changes the main failure modes:

- aborted or failed staged sessions can leak `_jin_stage_*` rows if the session
  marks itself inactive before cleanup runs
- staged byte accounting exists, but without a hard guard it does not stop
  runaway worker/session writes
- the hidden `__worker` entrypoint can hang when invoked without the expected
  parent JSON-RPC handshake

These are easy to miss because the public store contract still looks correct.

## Solution

Keep the frozen `beginWrite(...)` / `appendMessage(...)` / `finish(bundleHash)`
surface, but harden the staged implementation around it:

- keep session state explicit so `abort()` still works after append/finish
  failures
- stage message/tool-call rows atomically and track staged bytes on every append
- enforce a staged byte ceiling in addition to warning logs
- route abort paths through a logging helper so cleanup failures are visible
- make `__worker` fail fast unless JSON-RPC traffic appears on stdio

## Key Insight

For Jin, “disk-backed” is not the finish line. Once persistence becomes staged,
correct cleanup and worker-entry safeguards are part of the store/pipeline
contract in practice, even if they stay off the formal frozen surface.

## Prevention

- Keep tests that inspect `_jin_stage_*` rows directly, not just final canonical
  rows.
- When a staged API is added, review failure transitions (`finish` throws,
  `abort` retries, direct worker invocation) before treating the packet as done.
- Treat hidden worker entrypoints as protocol surfaces: they need fast-fail
  behavior when the parent handshake is missing.

## Related

- packet: `W3-PERF-11`
- follows: `docs/solutions/2026-04-15-store-owned-write-session-unifies-bundle-and-worker-persistence.md`
- blueprint alignment: `BP-02` parent-owned worker transport, `BP-05` canonical
  store-owned write semantics

## Files Changed

- `src/db/write-session.ts`
- `src/db/bundle.ts`
- `src/db/ordering.ts`
- `src/pipeline/ingest-worker.ts`
- `test/db-write-session.test.ts`
