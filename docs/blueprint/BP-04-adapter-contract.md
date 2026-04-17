---
title: "BP-04: Adapter Contract"
status: reviewed
created: 2026-03-28
depends-on: [BP-01]
informs: [BP-02, BP-03, BP-05, BP-10]
---

# BP-04: Adapter Contract

## Principle

An adapter is a **read-only parser** that knows one tool's file format and
returns normalized data. It never writes to the store, never pushes to sinks,
never manages processes. It answers one question: "What conversations and
messages exist in this tool's storage?"

---

## Interface

```typescript
interface Adapter {
  /** Identifier: "claude-code", "codex", "cursor", etc. */
  id: string;

  /** Human-readable name for CLI output */
  name: string;

  /** Check if this tool's data directory exists on this machine */
  detect(): Promise<boolean>;

  /**
   * Return refs to conversations that have changed since the last call.
   *
   * The pipeline calls this on:
   *   - Cold start (initial ingest — everything is "changed")
   *   - File change events (watcher detected a change in watchPaths)
   *   - Periodic scans (catch anything the watcher missed)
   *
   * The adapter owns change detection entirely. It tracks its own
   * internal state (byte offsets, file stats, timestamps) and returns
   * refs to every conversation whose normalized output may have changed.
   *
   * This includes indirect changes: a single file mutation may require
   * re-emitting both an existing root conversation AND a newly created
   * compacted continuation or spawned child. The adapter returns refs
   * for all affected conversations, not just the directly touched one.
   *
   * hint is optional context about what triggered the call. Adapters
   * MAY use it to narrow their scan (e.g., only re-read the changed
   * file on an fs-change hint). Adapters MAY ignore it entirely.
   */
  findChanged(hint?: ChangeHint): Promise<ConversationRef[]>;

  /**
   * Load one conversation and all its messages.
   *
   * Returns a complete bundle: conversation metadata + messages
   * (with tool calls on each message). Returns null if the
   * conversation no longer exists in the source — the pipeline
   * skips the write and leaves existing store rows intact (per
   * the deletion policy: store data survives source disappearance).
   *
   * For tools that support compaction or sub-agents, a single source
   * file may produce multiple ConversationRefs from findChanged().
   * Each ref is loaded independently — the pipeline doesn't know or
   * care that they came from the same file.
   */
  loadConversation(ref: ConversationRef): Promise<ConversationBundle | null>;

  /** Directories the file watcher should monitor for this tool */
  watchPaths(): string[];
}
```

### Supporting Types

```typescript
/** Lightweight reference to a changed conversation */
type ConversationRef = {
  id: string;
  sourcePath: string;
  adapterId: string;
};

/** Complete conversation data ready for store write */
type ConversationBundle = {
  conversation: ParsedConversation;
  messages: ParsedMessage[];
};

/** Optional context about what triggered the findChanged call */
type ChangeHint = {
  kind: "startup-scan" | "fs-change" | "periodic-scan";
  /** For fs-change: which file(s) the watcher saw change */
  changedPaths?: string[];
};
```

### Why This Shape

**Two-phase discover/load.** `findChanged()` is lightweight and bounded.
Preferred discovery work is metadata/index-based (file stats, byte offsets,
timestamps, shared-DB headers). Some adapters may need a bounded structural
scan of one source unit to derive stable ref IDs or compaction boundaries when
the source offers no cheaper index. `loadConversation()` is the heavy step: it
materializes the full bundle, extracts tool calls, and resolves git info.
Separating them lets the pipeline apply backpressure between items: discover 65
refs, load 20, yield, load 20 more.

**Bundle eliminates temporal coupling.** The previous `conversations()` +
`messages(conversationId)` pattern required shared-database adapters to hold
a read transaction across both calls. The bundle pattern loads everything for
one conversation in one call — no cross-call state, no transaction lifecycle.

**Hint is advisory, not structural.** Simple adapters ignore it. Complex
adapters (Claude Code) can use `changedPaths` to re-read only the changed
file instead of scanning all files.

### Discover / Load Memory Contract

The discover/load split is a **memory contract**, not just an API shape.

`findChanged()`:
- MUST return lightweight refs, not retained full bundles
- MAY keep small in-memory checkpoint state across calls: stats, offsets,
  signatures, source-local ref IDs, parent/child indexes
- MAY do a bounded structural scan of one source unit when needed to derive
  deterministic ref IDs, compaction boundaries, or spawned refs
- MUST make any large temporary parse reclaimable before moving on to the next
  source unit
- MUST NOT parse and cache full bundles for many sources so `loadConversation()`
  becomes a cache lookup

`loadConversation()`:
- MAY fully parse the source material needed for the requested ref
- MAY reuse a parsed source when sibling refs share that same source
- any such reuse MUST be explicitly bounded: one-source cache, size limit, or
  another eviction rule that makes large results reclaimable promptly

**Allowed simple-adapter exception:** if one source unit maps to exactly one
root conversation and the source offers no cheaper stable ID/index, discovery
MAY parse that source to derive the ref ID and `loadConversation()` MAY reparse
it. This is only acceptable when:
- the parse is local to one source per returned ref
- no full bundles are cached across multiple sources
- one source does not fan out to many refs

### Memory Review Questions

Every rich adapter review must answer:
1. Is `findChanged()` metadata/index-only, or does it perform a bounded
   structural scan?
2. If discovery scans source content, where is the reclamation point before the
   next source is scanned?
3. Does `loadConversation()` reparse source already consumed by discovery, and
   if so is that duplicate work bounded and intentional?
4. Can one source unit emit many refs, and if so how is sibling-ref reuse
   bounded?
5. Do helper caches or timeout wrappers retain successful large results longer
   than the adapter/store boundary needs them?

Rich-adapter fixture tests are not enough on their own. If an adapter packet
changes discovery, sibling-ref reuse, or startup-scan behavior, it also needs
the representative local and CI-facing validation described in `BP-10`.

**What's NOT on the interface:**
- No `conversations()` / `messages()` split — replaced by bundle
- No snapshot tokens or transaction lifecycle — eventual consistency
- No `newMessages()` — delta logic is internal to the adapter
- No `artifacts()` — deferred, not core to the conversation model
- No worker/subprocess lifecycle hooks
- No worker transport protocol surface (no JSON-RPC, frame, or NDJSON methods)
- No `streamConversation()` or equivalent streaming method in this blueprint

The adapter contract ends at normalized output. The pipeline/store side may
persist that output either through `writeBundle(bundle)` or through a
store-owned staged write session, but that persistence choice is outside the
adapter contract. Adapters remain read-only.

If the pipeline chooses to run adapter work inside a subprocess worker, that is
an execution detail owned by BP-02/BP-01. The preferred worker transport is
JSON-RPC 2.0 over stdio with `Content-Length` framing, but that transport is
still outside the adapter contract. The adapter contract remains
`findChanged()` plus `loadConversation()`.

---

## Consistency Model

Jin does **not** require a globally consistent snapshot across an ingest cycle.

Jin reads from databases and files owned by other processes (Cursor, Claude
Code, Codex). These sources change continuously as the developer works.
Imposing snapshot consistency (read transactions, locks) on external tools
is fragile and unnecessary.

Instead, jin relies on:

- **Deterministic IDs** — re-ingesting the same source produces the same IDs
- **Idempotent writes** — upserts and replaces converge on the same result
- **Full per-conversation replacement** — each ingest replaces the complete
  message set for that conversation, correcting any stale data
- **Repeated cycles** — if the source changes during a read, the next cycle
  corrects the store

**Convergence guarantee:** If the source is stable (no active writes), the
store converges to match the source within one ingest cycle. If the source
is actively changing (streaming response), the store converges within one
cycle after the source settles.

This model is simpler for adapter authors (no transaction lifecycle to manage)
and safer for external tools (no long-lived read transactions that prevent
WAL checkpointing in shared SQLite databases).

---

---

## Seven Responsibilities

### 1. Change Detection

Each adapter knows its storage format and owns its own change detection.
The pipeline has **no cache** — it calls `findChanged()` and trusts the
adapter to return only what needs re-ingesting.

**Storage model categories:**

| Category | Strategy |
|----------|----------|
| **One file per conversation** (append-only) | Byte-offset cache: track last read position per file. On call, check if file grew. |
| **One file per conversation** (rewrite) | File stat (size + mtime). Changed stat = re-parse. |
| **Shared database** (many conversations in one file) | Per-conversation timestamp from DB. Query only rows where timestamp > last seen. |

**Why the adapter owns this:** A file-level cache breaks for shared-database
adapters where one SQLite file contains dozens of conversations. Only the
adapter knows how to detect per-conversation changes within a shared database.

**Memory consequence:** change detection is allowed to remember only enough to
decide which refs changed. If an adapter needs full parsed bundles to answer
that question, it must either bound that state to one source at a time or be
treated as a follow-on hardening target.

### Checkpoint Persistence

Adapters maintain change detection state (byte offsets, file stats, last-seen
timestamps) **in memory**. On daemon restart, this state is lost, and the
next `findChanged()` call with `kind: "startup-scan"` triggers a full scan.

This is acceptable because:
- Full scan is idempotent — deterministic IDs + replace semantics mean
  re-ingesting unchanged conversations is a no-op (same data replaces itself)
- Full scan is bounded — a typical machine has 500-1000 conversations total,
  taking 2-5 minutes on cold start
- Persisting adapter state adds complexity (schema, migration, corruption
  recovery) for marginal benefit (saving 2-5 minutes on daemon restart)

If cold-start performance becomes a problem at scale, adapter state can be
persisted to a `_jin_adapter_state` table in the store only when:
- the persisted data is still lightweight checkpoint metadata
  (offsets, file stats, signatures, source-local ref IDs, parent maps, scan
  cursors)
- losing or corrupting that state degrades to a bounded full scan, not wrong
  conversation data
- no full bundles, message bodies, tool calls, whole-source parses, or sink
  payloads are persisted as adapter state
- representative validation shows the default in-memory startup path no longer
  meets the `BP-10` release budget

This is a future optimization, not a launch requirement.

### Deletion Policy

If a source file is deleted (user removes a JSONL, Cursor purges old
sessions), the conversation remains in jin's store. Jin's store is
**append-only** from a conversation perspective — conversations are never
removed because the source disappeared.

Rationale: the store is the historical record. If a developer deletes their
Claude Code session files, the analytics and push history should survive.

### 2. ID Generation

IDs are **deterministic**: re-ingesting the same source file produces the
same IDs. This is non-negotiable because:
- Push logs track conversations by ID
- Sinks use ON CONFLICT (id) for upserts
- Changed IDs = push log invalidation = duplicate data in sinks

| Entity | ID Derivation |
|--------|--------------|
| Conversation (root) | From source: session UUID, filename hash, or composer ID |
| Conversation (compacted) | `hash(root_conversation_id + compaction_boundary_identifier)` |
| Conversation (spawned) | From source: sub-agent session ID or file path hash |
| Message | From source: record UUID, line-index hash, or bubble ID |
| ToolCall | From source: tool_use ID, or `hash(message_id + sequence)` if source has none |

**Rule:** No `crypto.randomUUID()` in ID generation. No `Math.random()`.
If the source doesn't provide a stable ID, derive one deterministically
from the conversation ID + a sequence number.

### 3. Compaction Splitting

When a tool compacts a conversation (summarizes history to free context),
the adapter detects the boundary and returns **multiple ConversationRefs**
from `findChanged()`. Each ref is loaded independently via
`loadConversation()`, producing separate bundles linked by `trace_id`
and `parent_id`.

The root conversation keeps its original ID. Continuations get a
deterministic hash: `hash(root_id + boundary_identifier)`. Both share
`trace_id = root_id`. The continuation's `relationship = 'compacted'`.

**Why adapters own splitting:** Each tool has different compaction signals.
Centralizing splitting would require the pipeline to understand every tool's
compaction format — that defeats the purpose of adapters as format-specific
parsers. See adapter investigation docs for per-tool compaction signals.

### 4. Sub-Agent Detection

When a tool spawns sub-agents, the adapter detects them and returns
separate ConversationRefs with `relationship = 'spawned'` and `parent_id`
pointing to the parent conversation.

**Bidirectional linking:** The adapter captures the parent-to-child link from
BOTH metadata (arrays of child IDs) AND the parent's message stream
(orchestration tool calls that spawned the child). The metadata link
populates `parent_id`. The tool call populates the `tool_calls` table.
Both are needed — metadata gives you the tree, tool calls give you the
timeline of when spawning happened.

See adapter investigation docs for per-tool sub-agent detection methods.

### 5. Git Resolution

The adapter resolves `git_remote` and `branch` from the conversation's
`cwd` during `loadConversation()`.

```typescript
// Per unique cwd, run once and cache within the adapter instance
function resolveGit(cwd: string): { remote: string; branch: string } {
  const remote = execSync("git remote get-url origin", { cwd }).trim();
  const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd }).trim();
  return { remote, branch };
}
```

**Performance:** Many conversations share the same `cwd`. The adapter
caches git results by `cwd` within the adapter instance, reducing
hundreds of subprocess spawns to a handful of unique lookups.

**Non-git directories:** `git_remote` = empty string, `branch` = empty
string. The conversation's `cwd` becomes the fallback grouping key for
routing.

### 6. Tool Call Extraction

The adapter extracts tool calls from the source format and returns them
as `ParsedToolCall[]` on each message's `toolUses` array. The store
writes these to the `tool_calls` table.

**All tool calls are extracted.** Both leaf tools (file reads, searches,
edits) and orchestration tools (sub-agent spawning). The distinction
between orchestration and leaf is a query-time concern, not an ingest-time
filter.

See adapter investigation docs for per-tool extraction formats.

### 7. Thinking Block Extraction

The adapter extracts extended thinking content from the source format and
returns it as `thinkingContent` (text) and `thinkingTokens` (count) on
each message. These are columns, not JSON blobs.

See adapter investigation docs for per-tool thinking block formats.

---

## What the Adapter Does NOT Own

| Concern | Owner | Why Not Adapter |
|---------|-------|-----------------|
| Writing to SQLite | db/ | Adapters are read-only parsers |
| Push tracking | db/sync | Adapters don't know about sinks |
| Sink routing | routing.ts | Adapters don't know which sinks exist |
| File watching | pipeline/watcher | Adapter provides `watchPaths()` but doesn't run the watcher |
| Cost estimation | pricing.ts | Pricing is model-specific, not adapter-specific |
| Process lifecycle | daemon/ | Adapters don't know about PIDs or services |
| Store write semantics | pipeline/ingest | Adapter returns bundles; pipeline decides upsert vs replace |
| Derived field computation | db/ | Counts, costs, durations computed by the store after writes |

---

## Data Shapes

Adapters return **parsed** types. The store adds derived fields (counts,
costs, durations) after writing messages. This separation prevents adapters
from computing fields they can't accurately know (e.g., messageCount before
all messages are parsed).

### ParsedConversation (adapter output)

```typescript
interface ParsedConversation {
  id: string;                    // Deterministic from source
  traceId: string;               // Groups related conversations. Root: traceId = id
  parentId: string;              // Who created this. Empty for roots.
  relationship: 'root' | 'compacted' | 'spawned' | 'forked';
  forkPoint: number;             // Turn in parent that triggered this. -1 if unknown.
  adapterId: string;             // "claude-code", "codex", "cursor", etc.
  name: string;                  // From first user message or tool-specific title
  cwd: string;                   // Working directory
  gitRemote: string;             // git remote get-url origin (empty if non-git)
  branch: string;                // git branch (empty if non-git or unknown)
  model: string;                 // Primary model (most frequent across messages)
  startedAt: string;             // ISO 8601
  endedAt: string;               // ISO 8601
  sourcePath: string;            // Absolute path to primary source file
  sourceFormat: 'jsonl' | 'sqlite' | 'json';
}
// NOT here: messageCount, toolCount, turnCount, inputTokens, outputTokens,
// cacheRead, cacheWrite, estCost, durationMs — derived by store after writes.
```

### ParsedMessage (adapter output)

```typescript
interface ParsedMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;               // Flattened text
  recordType: string;            // Source record type
  model: string;                 // Model name (empty if unavailable)
  sequence: number;              // Ordinal position in source
  turn: number;                  // Turn number (-1 if unassigned)
  isSidechain: boolean;          // Main thread vs aside
  parentMessageId: string;       // DAG edge (empty if linear)
  inputTokens: number;           // Per-message from source (0 if unavailable)
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  thinkingContent: string;       // Extended thinking text
  thinkingTokens: number;        // Thinking token count
  timestamp: string;             // ISO 8601
  toolUses: ParsedToolCall[];    // Extracted to tool_calls table by store
}
```

### ParsedToolCall (adapter output)

```typescript
interface ParsedToolCall {
  id: string;                    // From source or deterministic hash
  name: string;                  // Tool name (Read, Edit, Bash, etc.)
  input: string;                 // Tool input (JSON or text)
  output: string;                // Tool output/result
  isError: boolean;
  durationMs: number;            // -1 if unknown
  timestamp: string;             // ISO 8601 (empty if unknown)
}
```

### Stored types (db/ adds derived fields)

The store persists `Conversation` (extends `ParsedConversation` with
derived aggregates) and `Message` / `ToolCall` (adds `conversationId`
foreign key). See BP-05 (Store & Migration) for the full stored schema.

```typescript
interface Conversation extends ParsedConversation {
  durationMs: number;            // endedAt - startedAt
  messageCount: number;          // COUNT from messages table
  toolCount: number;             // COUNT from tool_calls table
  turnCount: number;             // MAX(turn) from messages
  inputTokens: number;           // SUM from messages
  outputTokens: number;          // SUM from messages
  cacheRead: number;             // SUM from messages
  cacheWrite: number;            // SUM from messages
  estCost: number;               // Derived from tokens + pricing
}
```

---

## Minimum Viable Adapter

A new adapter needs four methods. All enrichment fields have safe
defaults — a minimal adapter produces flat root conversations.

```typescript
class NewToolAdapter implements Adapter {
  id = "new-tool";
  name = "New Tool";

  async detect(): Promise<boolean> {
    return existsSync("/path/to/tool/data");
  }

  async findChanged(hint?: ChangeHint): Promise<ConversationRef[]> {
    // List source files, check which ones changed (stat, mtime, etc.)
    // On startup-scan: return all
    // On fs-change: return only changed (or all — correctness over speed)
    // Return: [{ id, sourcePath, adapterId: this.id }]
  }

  async loadConversation(ref: ConversationRef): Promise<ConversationBundle | null> {
    // Parse the source file for this conversation
    // Return: { conversation: {...}, messages: [...] }
    // Defaults: traceId = id, parentId = "", relationship = "root"
    //           gitRemote = "", branch = "", forkPoint = -1
    // Return null if the source no longer exists
  }

  watchPaths(): string[] {
    return ["/path/to/tool/data"];
  }
}
```

**Progressive enrichment:** Start with flat conversations. Add compaction
splitting when the tool's compaction format is understood. Add sub-agent
detection when the spawning mechanism is mapped. Add tool call extraction
when the source format is documented. Each capability is additive — the
pipeline handles adapters at any maturity level.

---

## Testing Contract

Every adapter must pass these assertions:

```typescript
// Required fields present and non-empty
assertConversationValid(conv);   // id, adapterId, name, startedAt, endedAt, sourcePath
assertMessageValid(msg);          // id, role, content, timestamp

// IDs are deterministic — two loads produce the same IDs
const bundle1 = await adapter.loadConversation(ref);
const bundle2 = await adapter.loadConversation(ref);
expect(bundle1.conversation.id).toEqual(bundle2.conversation.id);
expect(bundle1.messages.map(m => m.id)).toEqual(bundle2.messages.map(m => m.id));

// Trace integrity (when relationships exist)
assertTraceIntegrity(conversations);  // trace_id consistent, parent_id references valid

// No duplicate IDs across all conversations and messages
assertNoDuplicateIds(conversations);
assertNoDuplicateIds(allMessages);

// Convergence: after two full ingest cycles with no source changes,
// store state is identical
```

---

## Adapter Capability Matrix

Not all adapters are equal. This matrix defines what each adapter provides
today and what's available in the source format for future extraction.

| Capability | Claude Code | Codex | Cursor | Gemini CLI | Simple* |
|------------|:-----------:|:-----:|:------:|:----------:|:-------:|
| Tokens (4 types) | yes | 3 types | partial** | - | varies |
| Tool calls (full I/O) | yes | yes | yes | - | - |
| Thinking blocks | yes | yes | yes | - | - |
| DAG (parent message ID) | yes | - | yes | - | - |
| Compaction splitting | yes | yes | - | - | - |
| Sub-agent detection | yes | yes | yes | yes | - |
| Sidechains | yes | - | - | - | - |
| Per-message timestamps | yes | yes | yes | - | varies |

*Simple = Amp, Kiro, OpenCode, Pi, PiAgent, Warp
**Cursor tokens: model-dependent (0 for default models, real for others)

For per-tool extraction details, field mappings, and source format
documentation, see:
- `docs/adapters/cursor/` — 4-layer storage investigation
- `docs/adapters/codex/` — 7-layer storage investigation
- `docs/ontology.md` §6 — adapter mapping tables

---

## References

- BP-01: Module Map — where adapters sit in the system
- BP-02: Data Flow — how the pipeline calls adapters and writes to the store
- BP-03: Conversation Model — how trace_id/parent_id/relationship work
- BP-05: Store & Migration — store write semantics, transaction boundaries
- BP-10: Performance Validation — how adapter memory changes are proven on
  representative workloads before release
- Ontology §4: Adapter capability matrix
- Ontology §6: Per-adapter field mapping tables
- Adapter investigations: `docs/adapters/cursor/`, `docs/adapters/codex/`
