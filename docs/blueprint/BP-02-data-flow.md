---
title: "BP-02: Data Flow — Adapter → Store → Sink"
status: reviewed
created: 2026-03-28
depends-on: [BP-01, BP-04, BP-05]
informs: [BP-05, BP-06, BP-10]
---

# BP-02: Data Flow

## Principle

Jin is a loop. Data flows in one direction:

```
Source files → Adapters → Store → Sinks
```

The pipeline module (BP-01) owns this flow. It calls adapters, writes to
the store, and pushes to sinks. The store is the **buffer** between ingest
and push — they never communicate directly.

Execution strategy is also pipeline-owned. The pipeline MAY execute adapter
work inline or in a subprocess worker, but that is an internal execution
policy, not an adapter contract change.

If subprocess workers are used, parent/worker communication is an internal
pipeline transport. It is not adapter API surface and is not part of BP-04.

### Worker Transport Standard

When the pipeline uses subprocess workers for adapter execution, the preferred
transport is:

- **JSON-RPC 2.0**
- over **stdio**
- with **header-delimited framing** using `Content-Length`

This follows the same general transport shape used by LSP/DAP-style local tool
protocols: structured requests/responses/notifications over stdio, with logs
written to `stderr` and protocol traffic reserved for `stdin` / `stdout`.

Transport rules:

- `stdin` / `stdout` are reserved for protocol traffic
- `stderr` is reserved for logs and diagnostics
- the parent owns worker lifecycle, request IDs, timeout handling, and process
  cleanup
- the worker owns only the execution of the requested adapter operation

Ad hoc newline-delimited frame formats may exist as transitional internal
implementations, but they are not the architectural target. External
contributors should treat **JSON-RPC 2.0 over stdio with `Content-Length`
framing** as the intended standard for parent/worker IPC.

---

## The Loop

```
                    ┌─────────────────────────────────┐
                    │         pipeline/loop.ts         │
                    │                                  │
  file change ──────► discover → load → store          │
  (watcher)         │                  │               │
                    │                  ▼               │
                    │           store (SQLite)          │
                    │                  │               │
                    │                  ▼               │
  timer ────────────► push (store → routing → sinks)   │
  (debounce/periodic)│                                 │
                    └─────────────────────────────────┘
```

**Two triggers, two actions:**

| Trigger | What Happens |
|---------|-------------|
| File change (watcher event) | Discover changed refs for that adapter. Load and store each. Schedule a push. |
| Periodic timer | Re-detect adapters (discover newly installed tools). Discover changed refs for all active adapters (full scan). Load, store, and push. |

Ingest and push are **decoupled by the store**. Ingest writes conversations
and messages. Push reads conversations that need pushing. They share no
in-memory state — the store is the contract.

---

## Serialization

**Invariant: no concurrent calls to the same adapter instance.**

Adapters own in-memory change-detection state (byte offsets, file stats,
per-conversation timestamps). Concurrent calls to `findChanged()` or
`loadConversation()` on the same adapter corrupt that state. The pipeline
must guarantee serialization.

The v2 implementation uses a **single serial ingest loop**. All events
(watcher, periodic, startup) feed into one queue. The pipeline drains the
queue one adapter at a time. No concurrent adapter calls, no locks, no
dirty flags — correct by construction.

If a watcher event arrives while an adapter is being ingested, the event
is coalesced into the queue. The watcher debounce (500ms) already reduces
event volume; the serial loop processes whatever accumulated since the
last run.

---

## Ingest Phase

### What Happens

```
pipeline/ingest.ts:

  for each active adapter:
    refs = adapter.findChanged(hint)
    for each batch of refs (batch size 20):
      for each ref in batch:
        bundle = adapter.loadConversation(ref)
        if bundle is null: continue        // source disappeared
        const { changed } = store.writeBundle(bundle)
        // writeBundle is the convenience wrapper over the store's
        // canonical write engine and returns { changed, revision }.
        // If hash unchanged, changed=false, no revision bump, no push needed.
        // See BP-05 for write semantics and revision tracking.
        if (changed) needsPush = true
      yield between batches (backpressure)
```

### Atomicity

The atomic unit is **one conversation's full bundle**: upsert conversation +
replace messages + replace tool_calls + recompute derived + update sync,
wrapped in a single SQLite transaction. If anything fails, the transaction
rolls back entirely. Push never sees partial data.

### Contracts

| From | To | Data | Contract |
|------|----|------|----------|
| Pipeline | Adapter | `ChangeHint` (optional) | Pipeline calls `findChanged(hint?)`. Adapter returns `ConversationRef[]`. |
| Pipeline | Adapter | `ConversationRef` | Pipeline calls `loadConversation(ref)`. Adapter returns `ConversationBundle \| null`. |
| Pipeline | Store | `ConversationBundle` or staged conversation/messages | Pipeline persists through the store-owned canonical write engine. `writeBundle()` is the convenience wrapper for full bundles; staged writers use the same engine and return the same `{ changed, revision }` result. |

Execution note:
- the pipeline MAY call adapters directly in-process
- or the pipeline MAY delegate a `findChanged()` / `loadConversation()` call to
  a worker subprocess
- if a worker subprocess is used, the preferred transport is JSON-RPC 2.0 over
  stdio with `Content-Length` framing
- any emitted frames/messages are internal pipeline transport only
- adapters still conceptually return refs and bundles; the worker transport
  does not widen the BP-04 adapter interface

### Adapter Memory Contract

The ingest loop assumes the discover/load split is also a **memory contract**.
Batching, yielding, RSS warnings, and the hard limit only work if adapters keep
discovery bounded.

**Required adapter behavior:**
- `findChanged()` returns `ConversationRef[]`, not retained `ConversationBundle`s
- adapter-side checkpoint state may live in memory, but it must stay small
  (stats, offsets, signatures, source-local ref IDs, parent maps)
- if discovery must inspect source content to derive stable ref IDs or
  compaction boundaries, it must do so one source unit at a time and release
  that temporary parse before scanning the next source
- if one source can fan out to many refs, the reclamation point is the source
  boundary, not the end of the whole adapter cycle
- `loadConversation()` is where full bundle materialization belongs; any reuse
  of a parsed source must be bounded to one source or another explicit
  eviction policy

**Out of contract:**
- parsing and caching full bundles for many sources during `findChanged()`
- treating the pipeline RSS hard limit as the primary reclamation mechanism
- timeout helpers or caches that pin successful large results after the call no
  longer needs them

### Backpressure

Ingest processes refs in batches. Between batches, yield to the event loop
so the GC can reclaim parsed file buffers. This caps RSS during cold ingest
(loading hundreds of conversations at once).

Batch size is configurable but defaults to 20 conversations per yield.

Backpressure is therefore a **shared responsibility**:
- the pipeline limits how many refs are loaded before yielding
- the adapter keeps discovery memory bounded so the runtime is yielding between
  small ref-producing steps, not after retaining many fully parsed sources

### Watcher Debounce (Not Pipeline Cooldown)

During streaming writes (e.g., Claude Code appends every ~200ms while an
assistant is responding), the watcher fires rapidly. The **watcher**
debounces events per `adapterId:filename` with a configurable window
(default 500ms). After the debounce fires, the pipeline calls the adapter's
`findChanged()` once.

There is no separate pipeline-level cooldown. If the watcher fires and
the adapter's change detection says "nothing new since my last read," the
`findChanged()` returns an empty list — a no-op. Two layers of "wait a bit"
would be redundant — the watcher debounce and the adapter's change detection
are sufficient.

### Per-Adapter Timeout

If an adapter hangs during `findChanged()` or `loadConversation()`, the
pipeline must not stall. Each adapter call has a timeout (default 30 seconds
per `loadConversation`, 60 seconds per `findChanged`). On timeout:

- The error is logged
- That adapter is skipped for this cycle
- Other adapters continue
- The adapter's consecutive error count increments

After 3 consecutive failures, the adapter is disabled until the next
periodic scan (which resets the error count and retries).

### Error Handling

If an adapter throws during `findChanged()` or `loadConversation()`:
- The error is logged with the adapter ID and conversation ref
- That conversation (or adapter, if `findChanged` failed) is skipped
- Other adapters and conversations continue
- No silent `catch {}` blocks — errors are always surfaced
- `jin status` shows per-adapter health: last success, last error, error count

---

## The Store as Buffer

The store sits between ingest and push. Neither side reaches into the
other. The store provides:

**For ingest (write side):**
- `writeBundle(bundle)` — convenience wrapper for callers that already
  materialize a complete `ConversationBundle`.
- `beginWrite(...)` / write session — canonical store-owned write engine for
  staged callers. The store still owns replacement, derived recomputation,
  sync tracking, and the final `{ changed, revision }` decision. See BP-05.

**For push (read side):**
- `conversationsNeedingPush(sinkId)` — returns IDs where `local_revision > last_successful_revision`
- `getConversation(id)` — full conversation data (with derived fields)
- `getMessages(conversationId)` — all messages for a conversation
- `getToolCalls(conversationId)` — all tool calls for a conversation
- `recordPushResult(conversationId, sinkId, attemptedRevision, result)` — update push state

**For both:**
- `_jin_sync` table tracks per-conversation revision state (hash, revision, ingested_at)
- `_jin_push_state` table tracks per-conversation-per-sink sync state (last successful revision)

The store is the **only shared state** between ingest and push. This means:
- Ingest failures do not lose pushable data — previously ingested
  conversations remain in the store and are still pushed on schedule
- Sink failures do not lose ingested data — data accumulates in the store
  until sinks recover
- A crash during push loses no data — un-pushed conversations remain in
  the store and will be pushed on the next cycle (at-least-once delivery)

---

## Push Phase

### What Happens

```
pipeline/push.ts:

  for each sink:
    ids = store.conversationsNeedingPush(sink.id)
    for each batch of ids (batch size 20):
      for each id in batch:
        conversation = store.getConversation(id)
        messages = store.getMessages(id)
        toolCalls = store.getToolCalls(id)
        revision = store.getRevision(id)
        targetSinks = route(conversation, config.routes, allSinks)
        if sink in targetSinks:
          payload = { attemptedRevision: revision, conversation, messages, toolCalls }
      sink.push(payloads)
      store.recordPushResult(id, sink.id, revision, result)
    yield between batches (backpressure)
```

### Contracts

| From | To | Data | Contract |
|------|----|------|----------|
| Pipeline | Store | sink ID | `conversationsNeedingPush(sinkId)` returns conversation IDs. |
| Pipeline | Routing | conversation + routes | `route(conversation, routes, sinks)` returns matching sinks. Pure function. |
| Pipeline | Sink | `PushPayload` | `{ attemptedRevision, conversation, messages, toolCalls }`. Sink formats and transmits. See BP-06. |
| Sink | Pipeline | `PushResult` | `{ pushed, failed, errors }`. Pipeline logs the result. |

### Routing

Routing is a **pure function**: given a conversation and a set of route
rules, return which sinks should receive it. See BP-08 (Routing &
Configuration) for matching semantics.

### Push Payload

The push payload is `{ attemptedRevision, conversation, messages, toolCalls }`
— a complete snapshot of one conversation plus the local revision being pushed.
The revision enables idempotency (webhook dedup keys) and auditing (Postgres
can store it). See BP-06 (Sink Contract) for the full payload type and
per-family semantics.

### Push Scheduling

Push is **change-gated and queue-coalesced.** When a canonical store write
completes with `changed: true` — whether via `writeBundle()` or a staged
write session — the coordinator enqueues a `{ kind: "push" }` work item.
If multiple ingest events fire before the coordinator drains the queue,
adjacent push items coalesce into a single push — the coordinator only
runs `pushDirty()` once for the batch.

This naturally prevents push storms during rapid file changes (e.g.,
Claude Code streaming a long response) without an explicit debounce timer.
The periodic scan (default 60 seconds) catches anything the watcher missed.

### Backpressure

Push processes payloads in batches of 20. Between batches, yield to the
event loop. This caps peak RSS — message arrays for 20 conversations are
loaded, pushed, then freed before the next batch loads.

### Error Handling

If a sink throws during `push()`:
- The error is logged with the sink name
- That sink is skipped for remaining payloads in this cycle
- Un-pushed conversations remain in `conversationsNeedingPush` for the
  next cycle
- No data is lost — the store is the persistent buffer

---

## The Brain (Complete Pseudo-Code)

This is the end-state pipeline coordinator, combining ingest and push.

```typescript
// pipeline/loop.ts

interface PipelineHandle {
  shutdown(): Promise<void>;
}

function runPipeline(config, store, registry, sinks, log): PipelineHandle {
  let activeAdapters = detectAdapters(registry, config);
  // ── EVENT QUEUE ──────────────────────────────────────
  // All triggers (watcher, periodic, startup) enqueue work items.
  // The coordinator drains the queue serially — one piece of work
  // at a time. No concurrent ingest or push calls.
  const queue = new WorkQueue();

  // ── INITIAL WORK ─────────────────────────────────────
  queue.enqueue({ kind: "ingest-all", hint: { kind: "startup-scan" } });
  queue.enqueue({ kind: "push" });

  // ── FILE WATCHER ─────────────────────────────────────
  const watcher = new FileWatcher(log);
  setupWatchers(watcher, activeAdapters, (adapterId, changedPaths) => {
    queue.enqueue({ kind: "ingest-adapter", adapterId, hint: { kind: "fs-change", changedPaths } });
    // Push is not enqueued here — the coordinator schedules push
    // only if ingestOne/ingestAll reports changed bundles.
  });

  // ── PERIODIC TIMER ───────────────────────────────────
  const periodic = setInterval(() => {
    queue.enqueue({ kind: "reconcile-adapters" });
    queue.enqueue({ kind: "ingest-all", hint: { kind: "periodic-scan" } });
    queue.enqueue({ kind: "push" });
  }, config.scanIntervalMs ?? 60_000); // default 60s — must match Push Scheduling prose above

  // ── COORDINATOR (single serial loop) ─────────────────
  // This is the only thing that calls ingest or push functions.
  // Nothing else runs work directly.
  let stopping = false;
  const coordinatorDone = coordinator();
  async function coordinator() {
    while (true) {
      const work = await queue.take();  // blocks until work available

      // Stop preempts: skip all normal work once stopping is set
      if (stopping && work.kind !== "shutdown-flush") continue;
      if (work.kind === "shutdown-flush") {
        // Final best-effort: one full ingest scan + one push.
        // The frozen adapter hint contract does not define `shutdown-scan`,
        // so runtime reuses `periodic-scan` here as the shutdown full-scan
        // alias.
        await ingestAll(activeAdapters, store, { kind: "periodic-scan" }, log);
        await pushDirty(store, sinks, config.routes, log);
        return;  // coordinator exits
      }

      if (work.kind === "reconcile-adapters") {
        activeAdapters = detectAdapters(registry, config);
        watcher.reconcile(activeAdapters);
      }
      else if (work.kind === "ingest-all") {
        const { anyChanged } = await ingestAll(activeAdapters, store, work.hint, log);
        if (anyChanged) queue.enqueue({ kind: "push" });
      }
      else if (work.kind === "ingest-adapter") {
        const adapter = activeAdapters.find(a => a.id === work.adapterId);
        if (adapter) {
          const { anyChanged } = await ingestOne(adapter, store, work.hint, log);
          if (anyChanged) queue.enqueue({ kind: "push" });
        }
      }
      else if (work.kind === "push") {
        await pushDirty(store, sinks, config.routes, log);
      }
    }
  }

  // ── SHUTDOWN ─────────────────────────────────────────
  // Stop is a control-plane priority event, not a normal work item.
  // See BP-07 §Shutdown Sequence for the semantic rule.
  return {
    async shutdown() {
      // 1. Preempt: stop accepting normal work, close intake
      stopping = true;                     // coordinator skips queued work
      watcher.close();
      clearInterval(periodic);

      // 2. Wait for any in-flight work item to finish
      //    (the coordinator loop checks `stopping` before each item)

      // 3. Enqueue final flush (only item the coordinator will process)
      queue.enqueue({ kind: "shutdown-flush" });

      // 4. Wait for coordinator to complete final flush — or timeout
      const timedOut = await Promise.race([
        coordinatorDone.then(() => false),
        Bun.sleep(15_000).then(() => true),  // 15s drain budget (BP-07)
      ]);

      // 5. On timeout: log what was abandoned and exit uncleanly.
      //    We do NOT close sinks while the coordinator may still be
      //    pushing to them. The process exits, OS reclaims resources.
      if (timedOut) {
        log.warn("Shutdown budget exceeded — abandoning in-flight work");
        process.exit(1);
      }

      // 6. Clean path: coordinator finished, safe to close sinks
      await Promise.all(sinks.map(s => s.close()));
    }
  };
}
```

**Shutdown timeout contract:** If the 15-second drain budget expires
before the coordinator finishes, the process exits immediately (`exit(1)`)
without calling `sink.close()`. This avoids the race where `close()` runs
while `pushDirty()` is still in-flight on the same sink. Data is safe —
the store is durable, and un-pushed conversations will be retried on next
start. The unclean exit is the correct tradeoff: a hung sink should not
prevent the process from stopping.

The coordinator is the single arbiter. Watcher callbacks, periodic timers,
and shutdown all enqueue work — none of them call `ingestAll()` or
`pushDirty()` directly. The coordinator drains the queue one item at a
time, guaranteeing the serialization invariant.

**Stop is a control-plane priority event.** When `shutdown()` is called,
it sets `stopping = true` which causes the coordinator to skip all pending
normal work items (ingest, push, reconcile). Only the `shutdown-flush`
item is processed — one final ingest scan plus one final push. This
bounds stop latency to the cost of one in-flight work item plus the final
flush, not the full queue depth. The 15-second drain budget (BP-07) caps
worst-case shutdown time.

**Push is change-gated:** Push is only enqueued when the store's canonical
write engine reports `changed: true` for at least one conversation.
Unchanged re-ingests (cold restart, periodic scan of stable data) do not
trigger pushes. The queue can coalesce adjacent push items into one push.

**One-shot mode:** `jin ingest` (no daemon) calls `detectAdapters()` +
`ingestAll()` + `pushDirty()` directly, without the queue, watcher, or
timers. The brain functions are usable standalone — the coordinator is
only for daemon mode.

---

## Lifecycle Integration

The daemon (or the foreground command) calls `runPipeline()` and holds
the shutdown handle. On SIGINT/SIGTERM, it calls `shutdown()`, which:

1. Stops the file watcher
2. Cancels the periodic timer
3. Flushes any pending push (final push of accumulated data)
4. Closes all sinks
5. Returns (caller closes the store and cleans up PID)

---

## Timing

### Cold Start (Initial Ingest)

On first run or after a nuclear migration:
- Adapter state is empty — `findChanged()` returns all conversations
- Full ingest of all adapters runs
- Duration: 2-5 minutes for a typical developer machine (500+ conversations)
- Then full push to all sinks

### Steady State

| Event | Ingest | Push |
|-------|--------|------|
| File change detected | `findChanged(fs-change)` for that adapter only | Enqueue push if ingest changed (queue coalesces bursts — no separate push debounce) |
| Periodic timer fires | Re-detect adapters, `findChanged(periodic-scan)` for all | Push if anything changed |
| Sink was down, now up | No ingest needed | Push all un-pushed conversations |

### Resource Budget

| Resource | Limit | Enforcement |
|----------|-------|-------------|
| RSS | 256 MB hard, 200 MB warning | Pipeline checks RSS between ingest batches. Exceeding hard limit → graceful shutdown. |
| Ingest batch | 20 conversations | GC yield between batches |
| Push batch | 20 payloads | GC yield between batches |
| Watcher debounce | 500ms per adapterId:filename | Watcher-level, not pipeline-level |
| Adapter timeout | 30s per loadConversation, 60s per findChanged | Per-call, logged and skipped |

### Release Validation Handoff

The table above defines the **runtime contract**. It is not, by itself, the release verdict.

`BP-10` owns the repeatable validation ladder that proves these limits on the
paths that actually failed in practice:

- discovery-only for `findChanged({ kind: "startup-scan" })`
- ingest with representative store shape
- integrated startup `ingestAll -> pushDirty`
- real foreground/daemon runtime including shutdown flush

This blueprint owns the budgets and pipeline semantics. `BP-10` owns the
artifact rules, local-versus-CI split, and release-gate decision.

---

## What This Blueprint Does NOT Cover

| Topic | Blueprint |
|-------|-----------|
| How conversations relate (trace_id, compaction, sub-agents) | BP-03 |
| Adapter interface details and per-tool extraction | BP-04 |
| SQLite schema, migrations, singleton pattern | BP-05 |
| Sink interface, schema handshake, no-DDL rule | BP-06 |
| PID management, daemon modes, signal handling | BP-07 |
| Route matching semantics, config shape | BP-08 |
| Release perf-validation artifacts and packet-review gate | BP-10 |
