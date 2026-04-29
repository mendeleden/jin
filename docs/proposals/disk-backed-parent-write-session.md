# Disk-Backed Parent Write Session

**Status:** Implemented  
**Created:** 2026-04-16  
**Relates to:** BP-02, BP-04, BP-05, W3-PERF-10

---

## Problem

This proposal's core implementation is landed. The staged parent write session
now exists in code and backs both bundle writes and worker writes.

The remaining problem is the next memory boundary beyond that work:

- child workers still build a full `ConversationBundle`
- the parent write path is fixed, but total family RSS can still spike on very
  large sources

## Invariants

These should not change:

- adapters remain read-only and still expose `findChanged()` /
  `loadConversation()`
- worker execution remains pipeline-owned
- store remains parent-owned
- hash/revision semantics remain BP-05 semantics
- `writeBundle()` remains a convenience wrapper over the same canonical store
  engine

## Landed Shape

The current store contract is:

- `beginWrite(conversation)`
- `appendMessage(message)`
- `finish(bundleHash)`
- `abort()`

The implementation is a **disk-backed staged write session** in the parent.

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

## Why This Unlocked The Design

This keeps the good parts of the current direction:

- adapters still do not own persistence
- parent still owns SQLite
- worker subprocesses still provide a real OS memory boundary

It removed the parent-side full-conversation buffering smell:

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

## Follow-On

This is no longer a rollout plan. The follow-on work is:

1. keep worker transport as JSON-RPC over stdio
2. continue measuring family RSS under heavy live runs
3. decide whether heavy child parsing needs a lower-level implementation or
   finer-grained stream-first loading

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

## Related Follow-On

This proposal fixes parent-side write buffering. It does **not** solve restart
replay of heavy adapter discovery by itself.

That follow-on is captured in:

- [durable-discovery-cache.md](/Users/edenmendel/Documents/GitHub/jin/docs/proposals/durable-discovery-cache.md)
