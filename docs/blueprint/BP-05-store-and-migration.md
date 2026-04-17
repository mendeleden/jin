---
title: "BP-05: Store & Migration"
status: reviewed
created: 2026-03-28
depends-on: [BP-01, BP-03, BP-04]
informs: [BP-06]
---

# BP-05: Store & Migration

## Principle

The store is a **local SQLite database** that acts as the buffer between
ingest and push. It is the single source of truth for all CLI queries, the
durable buffer that survives adapter and sink failures, and the materialized
view of source files on disk.

The store never communicates with external systems. It doesn't know about
adapters, sinks, or the pipeline. It provides typed CRUD operations and
lets callers compose them.

The store owns one canonical write engine for conversation data. Callers may
arrive with either:

- a fully materialized `ConversationBundle`
- a staged sequence of conversation metadata + messages

but both routes must converge on the same persistence, hash, revision, and
derived-field semantics.

Those staged inputs may come from:

- an in-process pipeline caller
- or a worker subprocess transport owned by the pipeline

In both cases, the store remains parent-owned and subprocess transport stays
outside the store contract. The preferred pipeline-owned worker transport is
JSON-RPC 2.0 over stdio with `Content-Length` framing; the store does not
depend on that transport directly.

---

## Access Pattern

### Singleton

The store is accessed through a singleton getter:

```typescript
function getStore(configDir: string): Store
```

The first call opens the database, runs pending migrations, and returns
the instance. Subsequent calls return the same instance. The database
file lives at `{configDir}/store.db`.

### Migration on Open

Migrations run automatically when the store is opened. This means:
- Daemon startup runs migrations (it opens the store)
- One-shot commands (`jin ingest`, `jin show`) run migrations
- Read-only commands (`jin conversations`, `jin search`) also run
  migrations — safe because migrations are idempotent and forward-only

There is no separate "migrate" step. If the binary is newer than the
database, opening it brings the schema up to date.

### PRAGMA user_version

Schema versioning uses SQLite's built-in `PRAGMA user_version`. This is
an integer that SQLite persists in the database file header — no extra
table needed.

```typescript
const migrations: Migration[] = [
  { version: 1, up: createV2Schema },
  // ...
];

function migrate(db: Database) {
  const current = db.pragma("user_version") as number;
  for (const m of migrations) {
    if (m.version > current) {
      m.up(db);
      db.pragma(`user_version = ${m.version}`);
    }
  }
}
```

Each migration runs in its own transaction. If a migration fails, the
database stays at the previous version — partially applied migrations
are impossible.

---

## Write Semantics

The pipeline persists conversation data through a **store-owned canonical
write engine**. `writeBundle(bundle)` remains the convenience wrapper for
callers that already have a full `ConversationBundle`, but it is no longer a
separate write implementation.

### Canonical Write Session

```typescript
interface ConversationWriteSession {
  appendMessage(message: ParsedMessage): void;
  finish(bundleHash: string): { changed: boolean; revision: number };
  abort(): void;
}

interface Store {
  beginWrite(conversation: ParsedConversation): ConversationWriteSession;
  writeBundle(bundle: ConversationBundle): { changed: boolean; revision: number };
}
```

Contract:

- `beginWrite(...)` opens a store-owned session for one conversation
- `appendMessage(...)` records the message set for that conversation in
  canonical order
- `finish(bundleHash)` applies hash-gated replace/upsert semantics and returns
  the canonical `{ changed, revision }` result
- `abort()` discards any staged work for that conversation

The store still owns:

- conversation upsert
- message/tool-call replacement
- derived-field recomputation
- FTS refresh
- sync-state update
- revision bump logic

Callers do not get a second persistence engine.

### writeBundle

```typescript
function writeBundle(bundle: ConversationBundle): { changed: boolean; revision: number } {
  const session = this.beginWrite(bundle.conversation);

  try {
    for (const msg of orderedMessages(bundle.messages)) {
      session.appendMessage(msg);
    }
    return session.finish(computeBundleHash(bundle));
  } catch (error) {
    session.abort();
    throw error;
  }
}
```

**The pipeline uses `changed` to gate push scheduling.** If `changed` is
false, no push is scheduled — the data in sinks is already up to date.
This eliminates push storms on cold restart: 500 conversations re-ingested
but only the actually-changed ones trigger pushes.

### Why Upsert Conversations, Replace Messages

**Conversations: Upsert (ON CONFLICT UPDATE).**

The conversation row accumulates data from multiple sources:
- Adapter provides: name, model, timestamps, cwd, git_remote, etc.
- Store computes: message_count, tool_count, est_cost, duration_ms, etc.

Upsert updates adapter-sourced fields without destroying store-computed
fields.

```sql
INSERT INTO conversations (...) VALUES (...)
ON CONFLICT(id) DO UPDATE SET
  -- relationship fields (repairable by re-ingest per BP-03)
  trace_id = excluded.trace_id,
  parent_id = excluded.parent_id,
  relationship = excluded.relationship,
  fork_point = excluded.fork_point,
  adapter_id = excluded.adapter_id,
  -- display fields
  name = excluded.name,
  model = excluded.model,
  started_at = excluded.started_at,
  ended_at = excluded.ended_at,
  cwd = excluded.cwd,
  git_remote = excluded.git_remote,
  branch = excluded.branch,
  source_path = excluded.source_path,
  source_format = excluded.source_format
  -- derived fields (message_count, est_cost, etc.) are NOT here:
  -- they are recomputed after message replacement
```

**Messages + Tool Calls: Replace (DELETE + INSERT).**

Messages are a snapshot of the source file. When the adapter re-reads a
conversation, the result is the current truth. Replace semantics handle
content corrections, reordering, and deletions in the source. The source
is the authority, the store is the materialized view.

### Derived Fields

After replacing messages and tool calls, the store recomputes aggregates
on the conversation row:

```sql
UPDATE conversations SET
  duration_ms = (julianday(ended_at) - julianday(started_at)) * 86400000,
  message_count = (SELECT COUNT(*) FROM messages WHERE conversation_id = ?),
  tool_count = (SELECT COUNT(*) FROM tool_calls WHERE conversation_id = ?),
  turn_count = (SELECT COALESCE(MAX(turn), 0) FROM messages WHERE conversation_id = ?),
  input_tokens = (SELECT COALESCE(SUM(input_tokens), 0) FROM messages WHERE conversation_id = ?),
  output_tokens = (SELECT COALESCE(SUM(output_tokens), 0) FROM messages WHERE conversation_id = ?),
  cache_read = (SELECT COALESCE(SUM(cache_read), 0) FROM messages WHERE conversation_id = ?),
  cache_write = (SELECT COALESCE(SUM(cache_write), 0) FROM messages WHERE conversation_id = ?),
  est_cost = ?  -- computed in application code from tokens + pricing.ts
WHERE id = ?
```

Derived fields are never set by adapters. They are always computed from
the current message set.

---

## Push Eligibility

Push eligibility is based on **revision mismatch**, not timestamp
comparison.

```
dirty = local_revision > last_successful_revision for this sink
```

This is stronger than timestamp comparison because:
- Revisions are monotonic integers — no clock skew, no ordering ambiguity
- The revision is captured at load time and recorded at push completion
  time, making it race-free even if ingest runs between load and push
- Unchanged data does not bump the revision (hash-gated), so cold
  restarts do not create false dirty state

### How It Works

```
writeBundle(bundle)
  │
  ├─ hash unchanged → revision stays → sinks NOT dirty
  │
  └─ hash changed → revision bumps → sinks with
                     last_successful_revision < local_revision ARE dirty
```

```sql
-- Conversations needing push to a specific sink
SELECT s.conversation_id
FROM _jin_sync s
LEFT JOIN _jin_push_state p
  ON p.conversation_id = s.conversation_id AND p.sink_id = ?
WHERE COALESCE(p.last_successful_revision, 0) < s.local_revision;
```

New sinks automatically see all conversations as eligible (no rows in
`_jin_push_state` → `COALESCE(null, 0) < any positive revision`).

### Push Recording

When a push completes:

```typescript
// On success:
store.upsertPushState(convId, sinkId, {
  lastAttemptedRevision: attemptedRevision,
  lastSuccessfulRevision: attemptedRevision,
  lastAttemptedAt: now(),
  lastSuccessfulAt: now(),
  lastError: "",
});

// On failure:
store.upsertPushState(convId, sinkId, {
  lastAttemptedRevision: attemptedRevision,
  lastAttemptedAt: now(),
  lastError: error.message,
  // lastSuccessfulRevision/At unchanged
});
```

**Why `attemptedRevision`, not `local_revision` at push time:** The push
payload was loaded when `local_revision` was N. If ingest bumps to N+1
while the push is in flight, recording success as N+1 would be wrong —
the sink only has N's data. Recording the revision captured at load time
is always correct.

---

## Internal Tables

Three tables track pipeline state. Prefixed with `_jin_` to distinguish
them from consumer-facing data tables.

### _jin_sync

Tracks the current local state of each conversation.

```sql
CREATE TABLE _jin_sync (
  conversation_id TEXT PRIMARY KEY,
  bundle_hash TEXT NOT NULL,
  local_revision INTEGER NOT NULL,
  ingested_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
```

| Column | Meaning |
|--------|---------|
| `bundle_hash` | Deterministic hash of the normalized bundle. Same data = same hash. |
| `local_revision` | Monotonic version number. Bumps only when hash changes. |
| `ingested_at` | When this conversation was last processed by ingest. Updates every cycle (useful for debugging "is the adapter seeing this file?"). |

### _jin_push_state

Tracks current per-sink sync state. **One row per (conversation, sink).**

```sql
CREATE TABLE _jin_push_state (
  conversation_id TEXT NOT NULL,
  sink_id TEXT NOT NULL,
  last_attempted_revision INTEGER DEFAULT 0,
  last_successful_revision INTEGER DEFAULT 0,
  last_attempted_at TEXT DEFAULT '',
  last_successful_at TEXT DEFAULT '',
  last_error TEXT DEFAULT '',
  PRIMARY KEY (conversation_id, sink_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
```

This is a **state table**, not a log. It answers the current question:
"What revision has this sink successfully received?" One row, one
comparison, one answer.

### _jin_push_attempts (deferred)

Optional audit history. Created in the migration but not populated at
launch. Reserved for future use when push failure debugging needs
historical depth beyond `last_error`.

```sql
CREATE TABLE _jin_push_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  sink_id TEXT NOT NULL,
  attempted_revision INTEGER NOT NULL,
  attempted_at TEXT NOT NULL,
  status INTEGER NOT NULL,
  response TEXT DEFAULT '',
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
```

---

## Bundle Hash

The bundle hash is a deterministic content hash of the canonical normalized
conversation content. It is the mechanism that prevents false dirty state:
if the source file hasn't changed, the hash is the same, the revision doesn't
bump, and no push is scheduled.

### Algorithm

The canonical definition is full JSON serialization of a canonical object,
then SHA-256.

```typescript
import { createHash } from "crypto";

function computeBundleHash(bundle: ConversationBundle): string {
  const conv = bundle.conversation;

  const canonical = {
    conversation: {
      id: conv.id,
      traceId: conv.traceId,
      parentId: conv.parentId,
      relationship: conv.relationship,
      forkPoint: conv.forkPoint,
      adapterId: conv.adapterId,
      name: conv.name,
      cwd: conv.cwd,
      gitRemote: conv.gitRemote,
      branch: conv.branch,
      model: conv.model,
      startedAt: conv.startedAt,
      endedAt: conv.endedAt,
      sourcePath: conv.sourcePath,
      sourceFormat: conv.sourceFormat,
    },
    messages: [...bundle.messages]
      .sort((a, b) => a.sequence - b.sequence)
      .map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        recordType: m.recordType,
        model: m.model,
        sequence: m.sequence,
        turn: m.turn,
        isSidechain: m.isSidechain,
        parentMessageId: m.parentMessageId,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        cacheRead: m.cacheRead,
        cacheWrite: m.cacheWrite,
        thinkingContent: m.thinkingContent,
        thinkingTokens: m.thinkingTokens,
        timestamp: m.timestamp,
        toolUses: [...m.toolUses]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map(t => ({
            id: t.id,
            name: t.name,
            input: t.input,
            output: t.output,
            isError: t.isError,
            durationMs: t.durationMs,
            timestamp: t.timestamp,
          })),
      })),
  };

  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}
```

### Why This Approach

**Canonical JSON + SHA-256** is the contract. Callers may realize that
contract either by hashing a fully materialized canonical object or by an
equivalent incremental encoder that preserves the same field set and
ordering.

Why this definition was chosen:

- **Compile-time safety.** The canonical object is a typed literal. When
  a field is added to `ParsedConversation` or `ParsedMessage`, TypeScript
  can enforce its inclusion.
- **Correctness.** Every field is hashed by value. Content-only changes
  (same length, different text) are always detected. A structural
  fingerprint that hashes content *lengths* would miss these.
- **Implementation flexibility.** Full-bundle callers and future staged
  writers can share one hash contract without redefining revision semantics.

**Performance:** JSON.stringify on a 5MB bundle takes ~10-20ms. SHA-256
on the result takes ~2-3ms. At cold start with 500 bundles, that's
~10 seconds — acceptable for a one-time event. The 15-20MB intermediate
string is GC'd between batches (batch size 20 with yields).

### Scope

**Included:**
- All `ParsedConversation` fields
- All `ParsedMessage` fields, sorted by `sequence`
- All `ParsedToolCall` fields, sorted by `id` within each message
- `thinkingContent` and tool call `output` — semantically meaningful,
  sinks consume them

**Excluded:**
- Derived fields (`messageCount`, `estCost`, `durationMs`) — recomputed
  from messages, not adapter-provided
- `ingested_at`, `local_revision` — internal tracking, not content

### Determinism Contract

The hash must produce identical output for identical input across runs,
platforms, and Bun versions. This is guaranteed by:

- **Explicit key ordering.** The canonical object is a literal with
  fixed key order. `JSON.stringify` preserves insertion order in V8/JSC.
- **Integer-only numerics.** All numeric fields (token counts, sequence,
  turn, durationMs) are integers. No floating-point formatting variance.
- **Defined sort order.** Messages sorted by `sequence` (integer comparison).
  Tool calls sorted by `id` (string comparison).
- **Hash must match canonical stored content.** If the store normalizes data
  during staged writes, the final hash input must reflect that same canonical
  content. A convenience `writeBundle()` caller and a staged writer must
  converge on the same hash for the same logical conversation.

---

## Integrity Checks

### Orphan Detection

BP-03 allows temporary orphans (child ingested before parent).

```sql
SELECT c.id, c.parent_id, c.adapter_id, c.relationship
FROM conversations c
WHERE c.parent_id != ''
  AND NOT EXISTS (
    SELECT 1 FROM conversations p WHERE p.id = c.parent_id
  );
```

This query powers `jin status --check-integrity`.

This check may report temporary orphans during active ingest because
parent/child traces are not written atomically. Persistent orphans
after a full scan or idle period usually indicate an adapter bug,
incomplete first import, or a parent source that never made it into
this database.

This query only detects missing parents; wrong parent links (parent
exists but trace_id is inconsistent) require the separate trace
consistency check below.

Orphans are reported but not auto-repaired — the fix is to re-ingest
or investigate the adapter.

### Trace Consistency

Verify that trace_id is consistent with the parent_id graph:

```sql
-- Conversations whose trace_id doesn't match their root's id
-- (walk parent_id to the root, compare trace_id)
-- This is a diagnostic query, not a runtime check.
```

Since trace_id is denormalized (BP-03), it can drift if an adapter
produces inconsistent data. Re-ingesting from source files corrects it.

### Sync State Consistency

Verify that every conversation has a sync record:

```sql
SELECT c.id FROM conversations c
WHERE NOT EXISTS (
  SELECT 1 FROM _jin_sync s WHERE s.conversation_id = c.id
);
```

Missing sync records indicate a `writeBundle` transaction that partially
committed (should not be possible with SQLite transactions, but useful
as a sanity check).

---

## File Organization

Per BP-01, the store is split by entity:

```
src/db/
  store.ts           getStore() singleton, open/close, transaction helper
  schema.ts          PRAGMA user_version migrations array
  conversations.ts   upsertConversation, getConversation, listConversations
  messages.ts        insertMessage, getMessages (no upsert — replace semantics)
  tool-calls.ts      insertToolCall, getToolCalls (no upsert — replace semantics)
  sync.ts            _jin_sync + _jin_push_state CRUD, conversationsNeedingPush
  search.ts          FTS5 full-text search setup and queries
  write-session.ts   canonical store-owned write session + staged apply engine
  bundle.ts          writeBundle() convenience wrapper over write-session.ts
```

**The store write session is the composition point.** One implementation
owns the full write sequence (message/tool-call replacement, FTS refresh,
derived-field recomputation, sync update, and revision logic). `writeBundle()`
is the convenience wrapper over that same engine.

**No business logic in db/.** The store doesn't know about adapters,
sinks, or the pipeline. It provides typed operations; the pipeline
decides what to write and when.

---

## Schema

The full schema is defined in the ontology (§7.1). BP-05 does not
duplicate it — the ontology is the source of truth for column definitions
and types.

What BP-05 adds beyond the ontology:

- **Migration strategy:** PRAGMA user_version, forward-only
- **Write semantics:** upsert conversations, replace messages + tool_calls,
  hash-gated revision tracking
- **Internal tables:** _jin_sync (revision state), _jin_push_state
  (per-sink sync), _jin_push_attempts (deferred audit)
- **Integrity queries:** orphan detection, trace consistency, sync state

### Indexes

| Index | Serves |
|-------|--------|
| `idx_conv_trace` (trace_id) | `jin show --trace`, trace view |
| `idx_conv_parent` (parent_id) | Tree reconstruction |
| `idx_conv_remote` (git_remote) | Routing, `jin stats` by project |
| `idx_conv_adapter` (adapter_id) | `jin conversations --adapter` |
| `idx_conv_ended` (ended_at) | `jin conversations --since` |
| `idx_msg_conv` (conversation_id) | Message loading for a conversation |
| `idx_msg_sequence` (conversation_id, sequence) | Ordered message display |
| `idx_tc_conv` (conversation_id) | Tool call loading for a conversation |
| `idx_tc_name` (name) | `jin stats` tool usage patterns |
| `idx_push_state_lookup` (conversation_id, sink_id) | Push eligibility (covered by PK) |

### FTS5

Full-text search on message content using an external-content FTS5 table:

```sql
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  content=messages,
  content_rowid=rowid
);
```

**FTS5 external-content tables do not auto-sync.** The store must
explicitly maintain the index during `writeBundle`. FTS refresh runs
within the same transaction as message replacement, after new messages
are inserted. The exact mechanism (explicit statements vs triggers) is
an implementation choice.

---

## What This Blueprint Does NOT Cover

| Topic | Blueprint |
|-------|-----------|
| Postgres schema (remote, jin doesn't own it) | BP-06 |
| What adapters produce (ParsedConversation, ParsedMessage) | BP-04 |
| How the pipeline calls writeBundle | BP-02 |
| How conversations relate (trace_id, parent_id) | BP-03 |
| Schema version handshake with Postgres sinks | BP-06 |
| Sink-specific push optimization (delta, etc.) | BP-06 |
