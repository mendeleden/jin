# Proposal: Disk-Backed Parent Write Session

**Status:** Draft  
**Created:** 2026-04-16  
**Relates to:** BP-02, BP-04, BP-05, W3-PERF-10

---

## Problem

We fixed the contract shape, but not the final memory shape.

Current direction is:

- adapters stay read-only
- heavy ingest can run in worker subprocesses
- parent owns persistence through `beginWrite(...)` / `finish(bundleHash)`

That is directionally correct. The remaining issue is implementation:

- child still builds a full `ConversationBundle`
- parent currently buffers all streamed messages in memory until
  `finish(bundleHash)`

So if worker ingest is wired into live runtime now, one large conversation can
exist in memory twice:

- once in the child
- once again in the parent write session

This keeps the architecture cleaner than adapter-to-store shortcuts, but it is
still the wrong low-memory end state.

## Invariants

These should not change:

- adapters remain read-only and still expose `findChanged()` /
  `loadConversation()`
- worker execution remains pipeline-owned
- store remains parent-owned
- hash/revision semantics remain BP-05 semantics
- `writeBundle()` remains a convenience wrapper over the same canonical store
  engine

## Proposal

Keep the current store contract:

- `beginWrite(conversation)`
- `appendMessage(message)`
- `finish(bundleHash)`
- `abort()`

But replace the in-memory buffered implementation with a **disk-backed staged
write session** in the parent.

### Implementation shape

Use parent-owned SQLite staging tables keyed by a session-local write id:

- `staged_conversations`
- `staged_messages`
- `staged_tool_calls`

Flow:

1. `beginWrite(conversation)`
   - allocate a write-session id
   - persist conversation header into staging
   - initialize small rolling aggregates in memory

2. `appendMessage(message)`
   - insert message row into staging immediately
   - insert tool calls immediately
   - update small rolling counters only:
     - message count
     - tool count
     - turn count
     - token totals
     - estimated cost

3. `finish(bundleHash)`
   - open one short canonical transaction
   - compare prior sync hash
   - if unchanged:
     - update `ingested_at`
     - drop staging rows
   - if changed:
     - replace canonical rows from staging
     - refresh FTS
     - persist derived fields
     - bump revision
     - update `_jin_sync`
     - drop staging rows

4. `abort()`
   - delete staging rows for that session

## Why This Unlocks The Design

This keeps the good parts of the current direction:

- adapters still do not own persistence
- parent still owns SQLite
- worker subprocesses still provide a real OS memory boundary

And removes the main remaining parent-side smell:

- parent no longer needs to hold a full conversation in memory just because
  the final hash arrives at the end

This is the missing bridge between:

- “clean contract”
- and
- “actually bounded parent memory”

## Why Not Other Options

### Not adapter-to-store writes

That reintroduces BP drift and grows adapter responsibility in the wrong place.

### Not long-lived SQLite transactions during stream

That would hold locks across IPC and make timeouts/failures harder to reason
about.

### Not immediate Rust rewrite

Rust workers may still be the right later move, but this parent-side staging fix
is needed even if the child becomes native.

## Rollout Plan

1. Replace buffered `ConversationWriteSession` with staging-backed session.
2. Keep `writeBundle()` as the same wrapper surface.
3. Keep worker transport as JSON-RPC over stdio.
4. Do **not** wire worker ingest into live runtime until the staging-backed
   session lands.
5. After that, test live worker ingest on heavy adapters.

## Success Criteria

- parent write session no longer stores full `ParsedMessage[]` in memory
- `writeBundle()` and staged writes still converge on identical canonical rows
- hash/revision semantics stay unchanged
- worker subprocess path can be enabled without obvious parent-side per-ref RSS
  spikes from buffering

## Decision Gate After This

If parent RSS is bounded after disk-backed staging, stay on Bun/TS for the
parent and keep iterating.

If child worker peaks are still the dominant problem after that, move heavy
workers (`claude-code`, `codex`) to Rust without changing the parent/store
boundary.
