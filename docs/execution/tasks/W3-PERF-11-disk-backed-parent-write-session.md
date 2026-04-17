# W3-PERF-11 — Disk-Backed Parent Write Session

## Goal

Replace the buffered parent-side `ConversationWriteSession` with a disk-backed
staging implementation so worker-driven ingest no longer requires the parent to
hold a full conversation in memory before `finish(bundleHash)`.

## Constraints

- Store remains parent-owned.
- Adapters remain read-only.
- Worker transport remains JSON-RPC 2.0 over stdio with `Content-Length`
  framing.
- `writeBundle()` must remain a wrapper over the same canonical store engine.
- Hash/revision semantics must remain BP-05 semantics.
- Heavy `claude-code` / `codex` startup and periodic ingest should use worker
  subprocesses by default once the parent write path is disk-backed and safe.

## Required Outcomes

1. Replace the buffered write-session implementation with a disk-backed staged
   implementation in the parent.
2. Keep `beginWrite(...)` / `appendMessage(...)` / `finish(bundleHash)` /
   `abort()` unchanged at the contract surface.
3. Preserve parity for:
   - canonical conversation row persistence
   - message/tool-call persistence
   - FTS refresh
   - sync state / revision behavior
   - unchanged-hash no-op behavior
4. Extract shared message ordering logic used by:
   - `src/db/bundle.ts`
   - `src/db/write-session.ts`
   - `src/pipeline/ingest-worker.ts`
5. Add worker/write-session safety improvements:
   - explicit buffered/staged byte accounting
   - abort failure logging
   - `__worker` direct-invocation guard
   - overlap-safe staged session cleanup
6. Add focused tests for:
   - staged session parity with `writeBundle()`
   - unchanged hash path
   - abort cleanup
   - worker path using the canonical store session
7. Make heavy `claude-code` / `codex` startup and periodic ingest use workers
   by default without reopening parent buffering.

## Non-Goals

- true adapter-side streaming
- native worker rewrite
- incremental row-level merge updates instead of replace-on-change

## Suggested Read Order

1. `docs/execution/04-frozen-contract-surface.md`
2. `docs/blueprint/BP-02-data-flow.md`
3. `docs/blueprint/BP-04-adapter-contract.md`
4. `docs/blueprint/BP-05-store-and-migration.md`
5. `docs/proposals/disk-backed-parent-write-session.md`
6. `src/contracts/store.ts`
7. `src/db/write-session.ts`
8. `src/db/bundle.ts`
9. `src/db/schema.ts`
10. `src/pipeline/ingest-worker.ts`
11. `test/db-write-session.test.ts`

## Deliverables

- staged store write-session implementation
- shared ordering utility
- worker/session safety hardening
- focused tests + build validation
- strict-pass notes that separate:
  - aligned
  - transitional but acceptable
  - not acceptable / follow-up
