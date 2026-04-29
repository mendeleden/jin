# Jin Data Ontology v2

Jin ingests conversation data from AI coding tools and normalizes it into a
universal data model. This document defines that model — the entity hierarchy,
field taxonomy, adapter contracts, and how each tool's native format maps to
jin's representation.

**Decision log:** See `ontology-discussion.md` for the full rationale behind
every design choice in this document.

---

## 1. Entity Hierarchy

```
Conversation
  |
  +-- Message [1..N]        Individual records (user, assistant, system, progress)
  |
  +-- ToolCall [0..N]       Extracted from messages, queryable via SQL
  |
  +-- Related Conversations  Linked via trace_id / parent_id / relationship
       - compacted           Post-compaction continuation
       - spawned             Sub-agent / Task tool child
       - forked              Branch from a specific turn
```

**Everything is a Conversation.** Each compacted segment, each sub-agent, each
fork is its own Conversation — not a subdivision of a larger container. Related
conversations are linked by three columns, not nested inside each other.

**Progressive detail:** Every adapter produces Conversations and Messages. Tool
call extraction happens automatically when adapters provide `toolUses` data.
Relationship linking (trace, parent, relationship) is optional enrichment —
simple adapters work fine with a single root conversation.

---

## 2. Entity Definitions

### 2.1 Conversation

A Conversation is the primary entity. It maps to one source file (JSONL,
SQLite row, JSON file) and represents a single human-AI interaction segment.

When a tool compacts a conversation, the result is two linked Conversations:
the original (up to the compaction boundary) and the continuation (from the
boundary onward), connected by `trace_id` and `parent_id`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique identifier (UUID, filename hash, etc.) |
| `trace_id` | string | yes | Groups all related conversations (one indexed scan vs recursive CTE). For root conversations, `trace_id = id` |
| `parent_id` | string | no | ID of the conversation that created this one (empty for roots) |
| `relationship` | string | yes | `root` \| `compacted` \| `forked` \| `spawned` |
| `fork_point` | integer | no | Which turn in the parent triggered this conversation (-1 if unknown) |
| `adapter_id` | string | yes | Adapter identifier (e.g., `"claude-code"`) |
| `name` | string | yes | Derived from first user message (truncated to 120 chars) |
| `cwd` | string | yes | Working directory where the conversation ran |
| `git_remote` | string | no | Git remote origin URL — the project identity (see Section 5) |
| `branch` | string | no | Git branch at conversation start (empty if non-git or unknown) |
| `model` | string | no | Primary model used (most frequent across messages) |
| `started_at` | ISO 8601 | yes | Timestamp of first message |
| `ended_at` | ISO 8601 | yes | Timestamp of last message |
| `duration_ms` | number | derived | `ended_at - started_at` in milliseconds |
| `input_tokens` | number | yes | Sum of input tokens across all messages |
| `output_tokens` | number | yes | Sum of output tokens across all messages |
| `cache_read` | number | yes | Sum of cache read tokens |
| `cache_write` | number | yes | Sum of cache write tokens |
| `est_cost` | number | derived | Estimated USD cost based on model pricing |
| `message_count` | number | derived | Count of messages |
| `tool_count` | number | derived | Count of tool calls |
| `turn_count` | number | derived | Count of turns (user prompt cycles) |
| `source_path` | string | yes | Absolute path to the raw source file |
| `source_format` | string | yes | `jsonl` \| `sqlite` \| `json` |

**Relationship types:**

| Relationship | Meaning | Example |
|-------------|---------|---------|
| `root` | Original conversation, no parent | A new `jin show` or Claude Code session |
| `compacted` | Continuation after context compaction | Claude Code compacts at token limit, new segment continues |
| `spawned` | Child created by parent (sub-agent) | Claude Code Task tool, Codex agent_message, Cursor sub-agent |
| `forked` | Branch from a specific turn | IDE "try a different approach" from turn N |

**Why `trace_id`:** Without it, "show me everything related" requires a
recursive CTE with N round-trips (where N = compaction depth). With it,
it's `WHERE trace_id = ?` — one indexed scan regardless of depth.

### 2.2 Message

A Message is an individual record in the conversation: a user prompt, an
assistant response, a system event, or a progress update.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique identifier from source |
| `conversation_id` | string | yes | Parent conversation |
| `parent_message_id` | string | no | Parent message ID — the DAG edge (empty if linear) |
| `role` | `"user" \| "assistant" \| "system"` | yes | Message role |
| `content` | string | yes | Flattened text content |
| `record_type` | string | yes | Source record type (see Section 3) |
| `model` | string | yes | Model name (empty string if unavailable) |
| `sequence` | number | yes | Ordinal position in source file (preserves order when timestamps collide) |
| `turn` | number | yes | Which turn this message belongs to (-1 = unassigned) |
| `is_sidechain` | boolean | yes | Whether this is a sidechain/aside message |
| `input_tokens` | number | yes | Input tokens (0 if unavailable) |
| `output_tokens` | number | yes | Output tokens (0 if unavailable) |
| `cache_read` | number | yes | Cache read tokens (0 if unavailable) |
| `cache_write` | number | yes | Cache write tokens (0 if unavailable) |
| `est_cost` | number | derived | Per-message estimated cost |
| `thinking_content` | string | no | Extended thinking text (empty if none) |
| `thinking_tokens` | number | no | Token count for thinking content (0 if none) |
| `timestamp` | ISO 8601 | yes | When the record was created |

**Content flattening:** When source messages contain structured content blocks
(Claude Code's `ContentBlock[]`), jin flattens them:

- `text` blocks → concatenated into `content` with `\n\n` separator
- `thinking` blocks → extracted to `thinking_content` / `thinking_tokens`
- `tool_use` blocks → extracted to `tool_calls` table
- `tool_result` blocks → matched to prior `tool_use` by ID, merged into `tool_calls.output`

**Turn detection strategies by adapter:**

| Adapter | Strategy |
|---------|----------|
| Claude Code | `parentUuid` chain — new turn starts when a `user` record's parent is the last `assistant` in the main thread |
| Codex | Role transitions — increment on each `user` message |
| All others | Role transitions — increment on each `user` message |

### 2.3 ToolCall

A ToolCall is a single tool invocation extracted from a message. This is a
proper table — not a JSON blob — making tool usage patterns queryable via SQL.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique identifier (from source or generated) |
| `message_id` | string | yes | Parent message |
| `conversation_id` | string | yes | Denormalized for efficient queries without joining through messages |
| `name` | string | yes | Tool name (e.g., `Read`, `Edit`, `Bash`, `WebFetch`) |
| `input` | string | yes | Tool input (JSON string or plain text) |
| `output` | string | yes | Tool output/result |
| `is_error` | boolean | yes | Whether the tool call resulted in an error |
| `duration_ms` | number | no | Execution duration (-1 if unknown) |
| `timestamp` | ISO 8601 | no | When the tool was invoked |

**Why a separate table:** Prismatic currently parses `tool_uses` JSON blobs in
`assess.ts` to detect tool patterns, agentic loops, and sub-agent spawning.
With a proper table, these become simple SQL:

```sql
-- Tool usage by name across all conversations
SELECT name, COUNT(*) FROM tool_calls GROUP BY name ORDER BY 2 DESC;

-- Detect agentic loops (3+ consecutive tool calls in a conversation)
SELECT conversation_id, COUNT(*) as tool_streak
FROM tool_calls tc
JOIN messages m ON m.id = tc.message_id
WHERE m.role = 'assistant'
GROUP BY conversation_id
HAVING COUNT(*) >= 3;

-- Find conversations that used a specific tool
SELECT DISTINCT conversation_id FROM tool_calls WHERE name = 'Bash';
```

---

## 3. Record Type Taxonomy

Every Message carries a `record_type` string that identifies what kind of
source record it came from. This is the **source** type, not the jin role.

### 3.1 Observed Record Types (from survey of 749 Claude Code JSONL files)

| record_type | Count | Description |
|-------------|-------|-------------|
| `user` | 14,983 | Human message or tool result injected as user turn |
| `assistant` | 20,955 | AI response (one per streaming chunk) |
| `progress` | 20,446 | Sub-agent live streaming output |
| `system:compact_boundary` | 25 | Compaction event marker |
| `system:turn_duration` | 361 | Wall-clock duration of a turn |
| `system:local_command` | 34 | Local slash-command echo |
| `system:bridge_status` | 4 | Bridge connection status |
| `custom-title` | 3 | User-set conversation title via `/rename` |
| `pr-link` | 24 | GitHub PR URL created in conversation |
| `queue-operation` | 490 | Prompt queue enqueue/remove |
| `file-history-snapshot` | 989 | IDE file backup state |
| `last-prompt` | 30 | Cached last user prompt |

### 3.2 Currently Captured vs Dropped

| Status | Record Types |
|--------|-------------|
| **Captured as Messages** | `user`, `assistant`, `system:*` |
| **Captured as conversation metadata** | `custom-title` (→ name override) |
| **To be captured** | `progress` |
| **Dropped (low value)** | `file-history-snapshot`, `last-prompt`, `queue-operation` |
| **Deferred** | `pr-link` (see mendeleden/jin#32) |

### 3.3 Compaction Records

Compaction in Claude Code produces **two** records, neither of which is
`type: "summary"`:

1. `type: "system"`, `subtype: "compact_boundary"` — the marker record with
   `compactMetadata: { trigger, preTokens }`
2. `type: "user"`, `isCompactSummary: true` — the summary text injected as a
   regular user message

The adapter's existing check for `type: "summary"` is **dead code** — this
type was never observed in any of the 749 files surveyed.

**v2 handling:** When a compaction boundary is detected, the adapter creates
two linked Conversations: the original (messages before the boundary) and
the continuation (messages after), connected by `trace_id`, `parent_id`,
and `relationship = 'compacted'`. The summary text becomes the first message
of the continuation conversation.

---

## 4. Adapter Capability Matrix

| Capability | Claude Code | Codex | Cursor | Gemini CLI | Amp | Kiro | OpenCode | Pi | PiAgent | Warp |
|------------|:-----------:|:-----:|:------:|:----------:|:---:|:----:|:--------:|:--:|:-------:|:----:|
| **Source format** | JSONL | JSONL | SQLite | JSON | JSONL | SQLite | JSON/JSONL | JSONL | JSONL | SQLite |
| **Tokens** | 4 types | 3 types | 2 types* | - | 2 types | - | - | 2 types | 2 types | - |
| **Tool calls** | full I/O | full I/O | full I/O* | - | calls only | - | - | - | - | - |
| **Thinking blocks** | yes | yes | yes* | - | - | - | - | - | - | - |
| **DAG (parentUuid)** | yes | - | yes | - | - | - | - | - | - | - |
| **Compaction** | yes | yes | - | - | - | - | - | - | - | - |
| **Sub-agents** | yes | yes* | yes* | yes | - | - | - | - | - | - |
| **Sidechains** | yes | - | - | - | - | - | - | - | - | - |
| **Custom titles** | yes | - | - | - | - | - | - | - | - | - |

**Legend:** `yes` = adapter provides this data. `-` = not available in source
format. `*` = data exists in source but adapter doesn't capture it yet.

**Token types:** Claude Code provides `input`, `output`, `cache_read`,
`cache_write`. Codex provides `input`, `output`, `cached_input`. Amp/Pi/PiAgent
provide `input`, `output`. Cursor provides `input`, `output` (in `state.vscdb`
bubbleId entries — not in the CLI store.db the adapter currently reads).

**Sub-agent sources:**
- Codex (verified 2026-03-28): `spawn_agent`/`wait_agent` function_calls in
  parent JSONL, sub-agent JSONL files in same `sessions/YYYY/MM/DD/` directory
  with `session_meta.source.subagent.thread_spawn` and `forked_from_id`.
  See [docs/adapters/codex/overview.md](adapters/codex/overview.md).
- Cursor (not yet captured): `~/.cursor/projects/<project>/agent-transcripts/<uuid>/<uuid>.jsonl`,
  `create-subagent` skill, sub-agents can spawn sub-agents (tree)

**Deep dive:** See [docs/adapters/cursor/](adapters/cursor/) for a full
investigation of Cursor's 4 storage layers, including `state.vscdb` (IDE
sessions with tokens and tool data), agent transcripts (JSONL with sub-agent
tree), CLI blob store, and AI tracking database.

---

## 5. Projects: git_remote, Not a Table

**Projects are NOT first-class entities.** There is no `projects` table.

The key insight: `cwd` is an accident of where someone cloned the repo. Three
engineers on the same project have three different `cwd` values. But they all
share one `git_remote` — that's the project identity.

```sql
-- git_remote as a column on conversations, not a separate table
SELECT git_remote, COUNT(*), SUM(est_cost)
FROM conversations
WHERE git_remote != ''
GROUP BY git_remote;
```

**What this replaces from v1:**
- `projects` table — gone
- `session_projects` M:N join — gone
- `refreshProjectStats()` — gone (use `GROUP BY git_remote`)
- `projectIdFromCwd()` hashing — gone

**How git_remote is populated:** `git remote get-url origin` in the
conversation's `cwd`. Returns the same URL regardless of which worktree or
local clone — so conversations across machines link back automatically.

**Non-git conversations:** `git_remote` is empty, `cwd` is the fallback
grouping key.

**Routing:** Sink routing matches directly on `git_remote`:
```json
{ "match": { "remote": "github.com/company/*" }, "sinks": ["postgres-company"] }
```

---

## 6. Adapter Mapping Tables

### 6.1 Claude Code

| Source (JSONL) | v2 Field | Notes |
|----------------|----------|-------|
| `sessionId` | `Conversation.id` | UUID from first record |
| `cwd` | `Conversation.cwd` | Working directory (was in metadata) |
| `type` | `Message.record_type` | `"user"`, `"assistant"`, `"system:<subtype>"` |
| `uuid` | `Message.id` | Per-record UUID |
| `parentUuid` | `Message.parent_message_id` | DAG edge |
| `isSidechain` | `Message.is_sidechain` | Main vs aside thread |
| `timestamp` | `Message.timestamp` | ISO 8601 |
| `message.role` | `Message.role` | `"user"` or `"assistant"` |
| `message.content` | `Message.content` | Flattened from `ContentBlock[]` |
| `message.model` | `Message.model` / `Conversation.model` | Model name |
| `message.usage.input_tokens` | `Message.input_tokens` | |
| `message.usage.output_tokens` | `Message.output_tokens` | |
| `message.usage.cache_read_input_tokens` | `Message.cache_read` | |
| `message.usage.cache_creation_input_tokens` | `Message.cache_write` | |
| `message.content[type=tool_use]` | `ToolCall` rows | Extracted to tool_calls table |
| `message.content[type=tool_result]` | `ToolCall.output` | Matched to prior tool_use by ID |
| `message.content[type=thinking]` | `Message.thinking_content` / `thinking_tokens` | Column, not JSON blob |
| `compactMetadata` | Creates linked `relationship='compacted'` conversation | Boundary detection |
| `isCompactSummary` | First message of continuation conversation | Summary text |
| `customTitle` | `Conversation.name` override | From `custom-title` records |
| `slug` | Deferred (see mendeleden/jin#32) | URL-friendly name |
| File path pattern | `relationship='spawned'`, `parent_id` | `*/subagents/agent-*.jsonl` |
| `git remote get-url origin` (at cwd) | `Conversation.git_remote` | Populated during ingest |

### 6.2 Codex

| Source (JSONL) | v2 Field | Notes |
|----------------|----------|-------|
| `session_meta.id` | `Conversation.id` | UUIDv7 from session_meta |
| `response_item[message]` | `Message.role`, `Message.content` | Direct mapping |
| `response_item[function_call]` | `ToolCall` row | CLI sessions: name + arguments (JSON) |
| `response_item[function_call_output]` | `ToolCall.output` | Matched to prior call via `call_id` |
| `response_item[custom_tool_call]` | `ToolCall` row | Desktop sessions: name + input (raw string) |
| `response_item[custom_tool_call_output]` | `ToolCall.output` | JSON with output + metadata (`exit_code`, `duration_seconds`) |
| `response_item[reasoning]` | `Message.thinking_content` | **Encrypted** — not recoverable |
| `response_item[web_search_call]` | `ToolCall` row | Minimal payload, `status: "completed"` |
| `compacted` record | Creates linked `relationship='compacted'` conversation | `replacement_history` array (not `type: "compaction"`) |
| `event_msg[token_count].last_token_usage` | `Message.input_tokens`, `.output_tokens` | Per-turn |
| `event_msg[token_count].total_token_usage` | `Conversation` totals | Cumulative |
| `turn_context.model` | `Message.model` | Per-turn model (e.g. `"gpt-5.4"`) |
| `session_meta.source.subagent` | `relationship='spawned'`, `parent_id` | Sub-agent detection via `forked_from_id` |
| `spawn_agent` function_call | Sub-agent creation | Output contains `{agent_id, nickname}` |
| `wait_agent` function_call | Sub-agent join | `targets` = array of agent IDs |

### 6.3 Cursor

See [docs/adapters/cursor/overview.md](adapters/cursor/overview.md) for
the full 4-layer storage analysis.

**Current adapter** (reads Layer 1 `state.vscdb` plus Layer 3 CLI `store.db`):

| Source (SQLite) | v2 Field | Notes |
|-----------------|----------|-------|
| `composerData.composerId` | `Conversation.id` | Layer 1 IDE session UUID |
| `composerData.name` | `Conversation.name` | User-set or auto-generated |
| `modelConfig.modelName` | `Conversation.model`, `Message.model` | Layer 1 model name |
| `subagentComposerIds` + `task_v2` bubbles | `relationship='spawned'`, `parent_id` | Layer 1 sub-agent linkage |
| `bubbleId.workspaceUris[0]` | `Conversation.cwd` | Preferred workspace path when present |
| `bubbleId.createdAt` | `Message.timestamp` | Real per-message timestamp for Layer 1 |
| `bubbleId.tokenCount.*` | `Message.input_tokens`, `Message.output_tokens` | Layer 1 only; model-dependent |
| `bubbleId.toolFormerData` | `ToolCall` rows | name, args, status, partial result payloads |
| `bubbleId.thinking.text` / `allThinkingBlocks[]` | `Message.thinking_content` | Current local data is mostly empty signatures |
| Blob tree traversal | `Message.content` | Layer 3 walks from `latestRootBlobId` via pointer blobs |
| `role` | `Message.role` | Direct |
| `data.model` | `Message.model` | Optional Layer 3 model |
| `parentId` | `Message.parent_message_id` | Layer 3 blob DAG |
| Layer 3 `tool-result` blobs | `ToolCall.output` | Matched to prior tool use by `toolCallId`, then name fallback |
| File ctime/mtime | `Message.timestamp` | Layer 3 fallback only; still interpolated |

**Not yet captured:**

| Source | Missing v2 Field | Notes |
|--------|------------------|-------|
| Layer 2 agent transcripts JSONL | transcript-only CLI/ACP fallback | not implemented yet |
| Agent transcripts dir | `relationship='spawned'` for transcript-only sessions | only Layer 1 spawned sessions are captured today |

### 6.4 Gemini CLI

| Source (JSON) | v2 Field | Notes |
|---------------|----------|-------|
| `turns[]` or `messages[]` | Messages | Flexible array field name |
| `role` or `type` | `Message.role` | `"model"` → `"assistant"` |
| `content` or `parts[]` | `Message.content` | String or parts array |
| `kind === "subagent"` | `relationship='spawned'`, `parent_id` | Sub-agent detection |

### 6.5 Simple Adapters (Amp, Kiro, OpenCode, Pi, PiAgent, Warp)

These adapters produce flat message lists with minimal metadata. They map
`role` and `content` directly, have limited or no token data, and provide
none of the enrichment fields (DAG, compaction, sub-agents, sidechains).
All conversations from simple adapters have `relationship = 'root'`.

---

## 7. Schema

### 7.1 SQLite (Local — Jin Owns)

```sql
-- Consumer-facing data tables

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,              -- groups related conversations
  parent_id TEXT DEFAULT '',           -- who created this conversation
  relationship TEXT NOT NULL DEFAULT 'root',  -- root|compacted|forked|spawned
  fork_point INTEGER DEFAULT -1,       -- which turn in parent triggered this
  adapter_id TEXT NOT NULL,
  name TEXT,
  cwd TEXT DEFAULT '',
  git_remote TEXT DEFAULT '',
  branch TEXT DEFAULT '',
  model TEXT DEFAULT '',
  started_at TEXT,
  ended_at TEXT,
  duration_ms INTEGER DEFAULT 0,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_read INTEGER DEFAULT 0,
  cache_write INTEGER DEFAULT 0,
  est_cost REAL DEFAULT 0,
  message_count INTEGER DEFAULT 0,
  tool_count INTEGER DEFAULT 0,
  turn_count INTEGER DEFAULT 0,
  source_path TEXT,
  source_format TEXT DEFAULT '',
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  parent_message_id TEXT DEFAULT '',
  role TEXT NOT NULL,
  content TEXT,
  record_type TEXT DEFAULT '',
  model TEXT DEFAULT '',
  sequence INTEGER DEFAULT 0,
  turn INTEGER DEFAULT -1,
  is_sidechain INTEGER DEFAULT 0,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_read INTEGER DEFAULT 0,
  cache_write INTEGER DEFAULT 0,
  est_cost REAL DEFAULT 0,
  thinking_content TEXT DEFAULT '',
  thinking_tokens INTEGER DEFAULT 0,
  timestamp TEXT,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE tool_calls (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,       -- denormalized for efficient queries
  name TEXT NOT NULL,
  input TEXT DEFAULT '',
  output TEXT DEFAULT '',
  is_error INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT -1,
  timestamp TEXT,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- Internal tables (not consumer-facing)
-- See BP-05 for write semantics and push eligibility logic.

CREATE TABLE _jin_sync (
  conversation_id TEXT PRIMARY KEY,
  bundle_hash TEXT NOT NULL,
  local_revision INTEGER NOT NULL,
  ingested_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

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

-- Indexes

CREATE INDEX idx_conv_trace ON conversations(trace_id);
CREATE INDEX idx_conv_parent ON conversations(parent_id);
CREATE INDEX idx_conv_remote ON conversations(git_remote);
CREATE INDEX idx_conv_adapter ON conversations(adapter_id);
CREATE INDEX idx_conv_ended ON conversations(ended_at);

CREATE INDEX idx_msg_conv ON messages(conversation_id);
CREATE INDEX idx_msg_turn ON messages(conversation_id, turn);
CREATE INDEX idx_msg_sequence ON messages(conversation_id, sequence);
CREATE INDEX idx_msg_parent ON messages(parent_message_id);
CREATE INDEX idx_msg_timestamp ON messages(timestamp);

CREATE INDEX idx_tc_conv ON tool_calls(conversation_id);
CREATE INDEX idx_tc_msg ON tool_calls(message_id);
CREATE INDEX idx_tc_name ON tool_calls(name);

CREATE INDEX idx_sync_revision ON _jin_sync(local_revision);
```

### 7.2 Optional Postgres Integration (Remote — Jin Does NOT Own)

Jin's generic Postgres integration is a **parameterized INSERT writer** — it
writes data to tables that already exist. It never creates tables, never
alters columns, never runs DDL.

This section describes the optional Postgres integration path only. Per
BP-Product-Strategy, `jin team` owns its own backend storage and migration
story; it is not defined by this integration contract.

**Schema ownership:**
- **With Jin Team / Prismatic:** the remote product deployment owns tables and
  migrations
- **Standalone integration:** an admin provisions a compatible schema using
  versioned SQL, migration tooling, or another explicit admin workflow

The Postgres schema mirrors SQLite with Postgres-native types:

| SQLite | Postgres |
|--------|----------|
| `TEXT` for timestamps | `TIMESTAMPTZ` |
| `INTEGER` for booleans | `BOOLEAN` |
| `REAL` for cost | `DOUBLE PRECISION` |

Additional Postgres-only columns:
- `team_id TEXT` — team identifier for multi-tenant scoping
- `user_id TEXT` — export-side user identifier
- `content_tsv tsvector` — auto-populated FTS column on messages

`content_tsv` is schema-owner populated. `team_id` and `user_id` are
integration metadata columns that Jin may write when the sink is configured
with those values.

### 7.3 Removed from v1

| v1 Entity | v2 Replacement |
|-----------|---------------|
| `sessions` table | `conversations` table |
| `is_sub_agent` / `parent_session_id` | `relationship` + `parent_id` on conversations |
| `is_compacted` boolean | `relationship = 'compacted'` exists in trace |
| `tool_uses` JSON blob on messages | `tool_calls` table |
| `thinking_blocks` JSON blob | `thinking_content` + `thinking_tokens` columns |
| `projects` table | `git_remote` column on conversations |
| `session_projects` M:N join | Gone (GROUP BY git_remote) |
| `tags` / `session_tags` | Deferred (not core to conversation model) |
| `tool_usage` aggregate table | Query `tool_calls` directly |
| `artifacts` table | Separate concern, not core conversation model |
| `adapter_name` column | Derivable from `adapter_id`, not stored |
| `is_active` boolean | Derivable from `ended_at` recency, not stored |
| `total_tokens` | Replaced by `input_tokens` + `output_tokens` (granular) |

---

## 8. Postgres Integration Handshake

When jin pushes to the optional Postgres integration sink, it reads the schema
version from a `jin_meta` table (one read, not DDL) and compares it to its
local `SCHEMA_VERSION`:

```
versions match     → push normally
remote > local     → PAUSE pushing, tell engineer to update jin
local > remote     → PAUSE pushing, tell admin to run migrations
```

Data stays in local SQLite when paused — nothing is lost.

**Major vs minor version drift:**

```
schema_version = "2.3"
  major = 2 → must match (new tables, restructured data)
  minor = 3 → warn but continue (added nullable column with default)
```

Major mismatch → block pushes, show in `jin status`.
Minor mismatch → warn, push what you can, log the gap.

This handshake is for the generic Postgres integration path. Jin Team may use
different backend migration machinery behind its API.

**What engineers see:**

```
$ jin status

  Daemon:    running (PID 4821)
  Database:  ~/.config/jin/store.db (schema v7)
  Conversations: 342, 12,847 messages

  Sinks:
    ✓ postgres-team    schema v7, last push 2m ago, 340/342 synced
    ⚠ postgres-finance schema v5, PAUSED — remote schema outdated
                       2 conversations queued, waiting for admin migration
                       Admin action: run the Postgres integration's migration workflow
```

---

## 9. Raw Export Specification

`jin export --raw <conversation-id>` copies the original source file
byte-for-byte.

| Adapter | What Gets Exported |
|---------|-------------------|
| Claude Code | The `.jsonl` file from `~/.claude/projects/` |
| Codex | The `.jsonl` file from `~/.codex/sessions/` |
| Cursor | The `store.db` SQLite file |
| Gemini CLI | The `session-*.json` file |
| Warp | The shared `warp.sqlite` (filtered export TBD) |
| Others | The source file at `Conversation.source_path` |

For sub-agents (Claude Code), the parent conversation's source file AND all
sub-agent files in the `subagents/` directory are included.

---

## 10. Views

Jin provides views over conversations at different levels of detail:

### 10.1 Single Conversation (`jin show <id>`)

Shows one conversation's messages in order.

```
Query: WHERE conversation_id = ? ORDER BY sequence ASC
```

### 10.2 Full Trace (`jin show <id> --trace`)

Shows all conversations sharing the same `trace_id` — the complete history
across compaction boundaries and sub-agent spawns. Compaction boundaries
appear as visual separators. Sub-agent conversations are shown at the turn
where they were spawned.

**Data fetch:**
```
SELECT * FROM conversations WHERE trace_id = (SELECT trace_id FROM conversations WHERE id = ?)
SELECT * FROM messages WHERE conversation_id IN (...)
```

**Rendering is application logic, not a SQL sort.** The `parent_id` graph
is the causal order — reconstruct the tree, walk the compaction chain, and
interleave spawned children at their `fork_point`. See BP-03 (Conversation
Model) for the full rendering algorithm.

### 10.3 Conversation Tree (`jin show <id> --tree`)

Shows the parent/child hierarchy for a conversation — who spawned whom.

```
Query: WHERE trace_id = ? to get all related, then reconstruct tree from parent_id
```

---

## 11. Adding a New Adapter

### Checklist

1. **Create `src/adapters/<tool>.ts`** implementing the `Adapter` interface
2. **Implement `id`** — unique adapter identifier (e.g., `"claude-code"`)
3. **Implement `detect()`** — check if the tool's data directory exists
4. **Implement `findChanged(hint?)`** — discover conversations that need
   (re-)ingestion, return `ConversationRef[]`. Each ref identifies one
   conversation. The optional `ChangeHint` narrows the scan (e.g., a
   specific file path from the watcher).
5. **Implement `loadConversation(ref)`** — parse a single conversation
   into a `ConversationBundle | null`. The bundle contains the parsed
   conversation, its messages, and its tool calls. Return `null` if the
   conversation is no longer loadable (deleted, locked, corrupt).
6. **Implement `watchPaths()`** — return directories to monitor for changes
7. **Register in `src/adapters/registry.ts`** — add to `allAdapters()` array

See BP-04 (Adapter Contract) for the full interface specification, eventual
consistency model, and checkpoint semantics.

### Minimum Viable Adapter

A minimal adapter produces flat ConversationBundles. All enrichment fields
(`parentMessageId`, `turn`, relationship linking, etc.) are optional and
default to safe values. Every conversation gets `relationship = 'root'`
and `traceId = id` by default.

```typescript
// Minimal ConversationBundle — all enrichment fields omitted, defaults applied
const bundle: ConversationBundle = {
  conversation: {
    id: "conv-001",
    adapterId: "my-tool",
    name: "Hello session",
    cwd: "/path/to/project",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    sourcePath: "/path/to/source.jsonl",
    sourceFormat: "jsonl",
    // relationship defaults to "root", traceId defaults to id
  },
  messages: [
    {
      id: "msg-001",
      role: "user",
      content: "Hello",
      timestamp: new Date().toISOString(),
      recordType: "user",
      sequence: 0,
    },
  ],
  toolCalls: [],
};
```

### Full-Featured Adapter

A rich adapter additionally:
- Populates `parentMessageId` from the source DAG
- Computes `turn` from the message chain
- Sets `isSidechain` for branched conversations
- Sets `sequence` to preserve source ordering
- Detects compaction boundaries and returns multiple linked bundles
  (connected by `traceId` / `parentId` / `relationship = 'compacted'`)
- Detects sub-agent spawning and returns `relationship = 'spawned'` bundles
- Resolves `gitRemote` from `cwd`
- Maintains internal checkpoints for efficient `findChanged()` scans

---

## 12. Access Layer

The ontology defines *what the data means*. This section defines *how
consumers get to it*. Jin runs as a local daemon that continuously ingests
conversation data. All access starts from the local machine.

### 12.1 Local Commands (CLI)

The jin CLI is the primary interface. Every command supports `--json` for
machine-readable output.

**Daemon lifecycle:**

| Command | What it does |
|---------|-------------|
| `jin start` | Start the background daemon (file watcher + ingest loop) |
| `jin stop` | Stop the daemon |
| `jin restart` | Stop + start |
| `jin status` | Show daemon health, adapter status, ingest progress, sink state, schema versions |

**Data queries:**

| Command | Entity | Flags | Output |
|---------|--------|-------|--------|
| `jin conversations` | Conversation[] | `--adapter`, `--since`, `--limit`, `--remote`, `--json` | List conversations |
| `jin show <id>` | Conversation + Message[] | `--json` | Single conversation |
| `jin show <id> --trace` | Trace (all related) | `--json` | Full trace across compaction + sub-agents |
| `jin show <id> --tree` | Conversation tree | `--json` | Parent/child hierarchy |
| `jin search "<query>"` | Message[] | `--adapter`, `--since`, `--limit`, `--json` | FTS5 ranked results with snippets |
| `jin stats` | Analytics | `--adapter`, `--since`, `--json` | Token/cost breakdown by adapter, model, git_remote |
| `jin export` | Conversations | `--format=json\|md`, `--output` | Bulk export |
| `jin export --raw <id>` | Raw source file | | Byte-for-byte copy of original |

**Configuration & connectivity:**

| Command | What it does |
|---------|-------------|
| `jin start` | Create default local config on first run if needed, then start the runtime |
| `jin sink add <type>` | Add a Postgres/S3/webhook sink definition |
| `jin sink remove <id>` | Remove a sink and its routes |
| `jin sink disable <id>` | Disable pushing to a sink (durable, immediate) |
| `jin sink enable <id>` | Re-enable a disabled sink |
| `jin route add ...` | Add a routing rule |
| `jin route remove ...` | Remove a routing rule |
| `jin sync-status` | Show per-sink push state |

Standalone Postgres integrations may also have an admin-only migration
workflow, but that is operator-facing and not part of the core daemon/user
command surface.

There is no `jin init` command. `jin start` handles first-run bootstrap
(adapter detection, config creation) automatically.

### 12.2 Direct SQLite Access

The local database at `~/.config/jin/store.db` is a standard SQLite file.
Any tool that reads SQLite can query it directly — no daemon required.

```sh
# Conversations by cost
sqlite3 ~/.config/jin/store.db \
  "SELECT name, est_cost FROM conversations ORDER BY est_cost DESC LIMIT 10"

# Tool usage patterns
sqlite3 ~/.config/jin/store.db \
  "SELECT name, COUNT(*) FROM tool_calls GROUP BY name ORDER BY 2 DESC"

# All conversations in a trace
sqlite3 ~/.config/jin/store.db \
  "SELECT id, relationship, name FROM conversations WHERE trace_id = '...'"
```

### 12.3 Sinks (Push-Based Distribution)

Sinks push data to external systems as conversations are ingested. They run
inside the daemon and push automatically.

All sinks receive a full snapshot payload that includes
`attemptedRevision`, `conversation`, `messages`, and `toolCalls`. They differ
in transport, remote layout, and readiness checks.

| Sink | Protocol | What gets pushed | Use case |
|------|----------|-----------------|----------|
| **Postgres** | SQL (ON CONFLICT upsert) | Full snapshot written into `conversations` + `messages` + `tool_calls` | BYO analytics warehouse, reporting dashboards |
| **S3** | HTTPS (AWS Sig V4) | Full snapshot serialized to JSON objects at `prefix/team/dev/adapter/conversation.json` | Archival, data lake, compliance |
| **Webhook** | HTTPS POST | `PushPayload` or `{ batch: [{ attemptedRevision, conversation, messages, toolCalls }] }` | Real-time notifications, custom pipelines |

### 12.4 MCP Server (Planned)

An MCP server would let AI tools query jin's data directly during
conversations.

**Proposed MCP tools:**

```
jin_list_conversations
  Params:  adapter?, since?, limit?, git_remote?
  Returns: Conversation[]

jin_get_conversation
  Params:  id, include_trace?
  Returns: { conversation, messages, toolCalls, related? }

jin_search
  Params:  query, adapter?, since?, limit?
  Returns: { results: [{ conversationId, snippet, rank }] }

jin_conversation_tree
  Params:  id
  Returns: { parent?, children: Conversation[] }

jin_analytics
  Params:  type ("timeline" | "adapters" | "models" | "tools" | "cost")
  Returns: Aggregated stats
```
