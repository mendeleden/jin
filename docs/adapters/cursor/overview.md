# Cursor Storage Architecture

**Scope:** Complete map of where Cursor stores conversation data on disk, what
each storage location contains, and how layers relate to each other.

**Cursor version investigated:** 2.6.20 (2026-03-23, macOS arm64)

---

## Architecture Overview

```
Cursor IDE (Electron)
  |
  +-- Layer 1: globalStorage/state.vscdb         IDE sessions
  |     Table: cursorDiskKV (key-value)
  |     Keys: composerData:*, bubbleId:*
  |
  +-- Layer 2: projects/<proj>/agent-transcripts/  JSONL transcripts
  |     Per-agent file, subagents/ subdirectory
  |     Created by IDE and CLI sessions
  |
  +-- Layer 3: chats/<hash>/<session>/store.db     CLI blob store
  |     Tables: meta + blobs (content-addressable)
  |     Only created by `cursor agent` CLI
  |
  +-- Layer 4: ai-tracking/ai-code-tracking.db    Code attribution
        Tables: ai_code_hashes, scored_commits, etc.
        No conversation messages
```

---

## Layer 1: IDE Sessions (`state.vscdb`)

### Location

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` |
| Linux | `~/.config/Cursor/User/globalStorage/state.vscdb` |
| Windows | `%APPDATA%\Cursor\User\globalStorage\state.vscdb` |

Per-workspace databases also exist at `.../workspaceStorage/<hash>/state.vscdb`
but conversation data lives in the global one.

### Schema

Two tables exist: `ItemTable` (legacy, VS Code inherited) and `cursorDiskKV`
(active). Both have the same schema:

```sql
CREATE TABLE cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);
```

### Key Namespace

| Prefix | Count (observed) | Purpose |
|--------|-----------------|---------|
| `composerData:<uuid>` | 65 | Session/conversation metadata |
| `bubbleId:<composerId>:<bubbleId>` | 901 | Individual messages |
| `agentKv:blob:<hash>` | 580 | Content-addressable agent context |
| `checkpointId:<id>` | 93 | File state snapshots before AI edits |
| `codeBlockDiff:<id>` | 55 | Diff accept/reject state |
| `messageRequestContext:<composerId>:<requestId>` | many | Per-request context |
| `ofsContent:<composerId>:<uri>` | varies | File content written by agents |
| `composer.content.<hash>` | varies | Composer content blobs |

### Data Model: `composerData`

The value is a JSON blob. Key fields:

| Field | Type | Description |
|-------|------|-------------|
| `_v` | number | Schema version (currently 3) |
| `composerId` | string | UUID — the session identity |
| `name` | string | Session name (user-set or auto-generated) |
| `createdAt` | number | Unix timestamp (ms) |
| `lastUpdatedAt` | number | Unix timestamp (ms) |
| `modelConfig` | `{modelName, maxMode}` | Model selection |
| `isAgentic` | boolean | Whether this is an agent-mode session |
| `usageData` | object | Token cost data (often empty `{}`) |
| `subagentComposerIds` | string[] | UUIDs of child sub-agent sessions |
| `subComposerIds` | string[] | UUIDs of child composer sessions |
| `totalLinesAdded` | number | Lines of code added |
| `totalLinesRemoved` | number | Lines of code removed |
| `fullConversationHeadersOnly` | `{bubbleId, type}[]` | Message index — `type: 1` = user, `type: 2` = assistant |
| `status` | string | Session status |
| `todos` | array | Task/todo items |
| `conversationState` | object | Internal state |

### Data Model: `bubbleId`

Each message (bubble) is stored as a separate key. Key fields:

| Field | Type | Description |
|-------|------|-------------|
| `bubbleId` | string | UUID of this message |
| `type` | number | `1` = user, `2` = assistant |
| `text` | string | Message content |
| `createdAt` | string | ISO 8601 timestamp (per-message!) |
| `tokenCount` | `{inputTokens, outputTokens}` | Token usage for this message |
| `toolFormerData` | object | Tool call details (see below) |
| `allThinkingBlocks` | array | Thinking/reasoning blocks |
| `requestId` | string | Links to messageRequestContext |
| `codeBlocks` | array | Code blocks shown in UI |
| `isAgentic` | boolean | Whether this was an agentic turn |

### `toolFormerData` Structure

```json
{
  "toolCallId": "tool_0a0af2fb-...",
  "toolIndex": 0,
  "modelCallId": "tool_0a0af2fb-...",
  "status": "completed",
  "name": "ripgrep_raw_search",
  "rawArgs": "{\"pattern\":\"init\",\"path\":\"/Users/.../jin\",...}",
  "tool": 41,
  "params": "{...}"
}
```

Tool names observed: `ripgrep_raw_search`, `edit_file`, `read_file`,
`run_command`, `Glob`, `Read`, `Shell`, etc.

### Jin Mapping (v2 ontology)

| state.vscdb field | v2 Entity.Field | Notes |
|-------------------|-----------------|-------|
| `composerData.composerId` | `Conversation.id` | UUID |
| `composerData.name` | `Conversation.name` | |
| `composerData.modelConfig.modelName` | `Conversation.model` | e.g. `"composer-2-fast"` |
| `composerData.createdAt` | `Conversation.started_at` | Unix ms → ISO 8601 |
| `composerData.lastUpdatedAt` | `Conversation.ended_at` | Unix ms → ISO 8601 |
| `composerData.usageData` | `Conversation.input_tokens` etc. | Often empty — sum from bubbles instead |
| `composerData.subagentComposerIds` | `relationship='spawned'`, `parent_id` | Sub-agent linking |
| `bubbleId.text` | `Message.content` | |
| `bubbleId.type` | `Message.role` | 1 → `"user"`, 2 → `"assistant"` |
| `bubbleId.createdAt` | `Message.timestamp` | Real per-message timestamp |
| `bubbleId.tokenCount.inputTokens` | `Message.inputTokens` | |
| `bubbleId.tokenCount.outputTokens` | `Message.outputTokens` | |
| `bubbleId.toolFormerData` | `ToolCall` rows | name, input (rawArgs), output |
| `bubbleId.allThinkingBlocks` | `Message.thinkingContent` | |

### Limitation

CLI agent sessions (`cursor agent --print`) do **not** appear in
`state.vscdb`. Verified empirically: 3 CLI sessions produced 0 entries in
globalStorage. This means Layer 1 only covers IDE sessions.

---

## Layer 2: Agent Transcripts (JSONL)

### Location

```
~/.cursor/projects/<workspace-slug>/agent-transcripts/<uuid>/<uuid>.jsonl
```

Sub-agents are stored in a `subagents/` subdirectory:

```
agent-transcripts/
  <parent-uuid>/
    <parent-uuid>.jsonl          # root agent transcript
    subagents/
      <sub-uuid-1>.jsonl         # sub-agent transcript
      <sub-uuid-2>.jsonl
```

The workspace slug is the project path with `/` replaced by `-`
(e.g., `Users-edenmendel-Documents-GitHub-jin`).

### Format

One JSON object per line. Each line has `role` and `message.content`:

```json
{"role":"user","message":{"content":[{"type":"text","text":"<user_query>\n...\n</user_query>"}]}}
{"role":"assistant","message":{"content":[{"type":"text","text":"..."},{"type":"tool_use","name":"Read","input":{"path":"..."}}]}}
{"role":"assistant","message":{"content":[{"type":"text","text":"Final response..."}]}}
```

### Content Block Types

| Block type | Fields | Notes |
|-----------|--------|-------|
| `text` | `text` | Message text content |
| `tool_use` | `name`, `input` | Tool call — **no `id`, no result** |

### What's Present vs Missing

| Data point | Present | Notes |
|-----------|---------|-------|
| Message text | Yes | In `content[].text` |
| Message role | Yes | `role` field |
| Tool call name | Yes | `tool_use.name` (e.g., `"Read"`, `"Glob"`, `"Shell"`) |
| Tool call input | Yes | `tool_use.input` (args object) |
| Tool call result | **No** | Not recorded in transcripts |
| Token counts | **No** | Not present in any field |
| Thinking/reasoning | **No** | Not recorded |
| Per-message timestamps | **No** | No timestamp field |
| Model name | **No** | Not in transcript |

### Sub-Agent Linking

The `subagentComposerIds` array in Layer 1's `composerData` contains UUIDs
that match the filenames in the `subagents/` directory. This is the link
between Layer 1 (who spawned whom) and Layer 2 (what the sub-agent said).

### Jin Mapping

| Transcript field | v2 Entity.Field | Notes |
|-----------------|-----------------|-------|
| Directory UUID | `Conversation.id` | |
| `role` | `Message.role` | Direct |
| `content[type=text].text` | `Message.content` | Concatenate text blocks |
| `content[type=tool_use]` | `ToolCall` (partial) | Name + input only, no output |
| Parent dir → `subagents/` dir | `relationship='spawned'`, `parent_id` | Directory structure = relationship |
| File path | `Conversation.source_path` | |

---

## Layer 3: CLI Blob Store (`store.db`)

This is what the current adapter (`src/adapters/cursor.ts`) reads.

### Location

```
~/.cursor/chats/<workspace-hash>/<session-id>/store.db
```

Only created by `cursor agent` CLI sessions. Not created by IDE sessions.

### Schema

```sql
CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
```

### Meta Table

Key `0` contains hex-encoded JSON:

```json
{
  "agentId": "d553b0e2-d949-4dc3-a6f5-8a4e496c85ea",
  "latestRootBlobId": "1844a7e1ca7671077474a3a2b79bbcf6120428b51be...",
  "name": "New Agent",
  "mode": "search",
  "createdAt": 1774308018582
}
```

### Blob Tree

Blob IDs are SHA-256 hashes of their content (content-addressable storage).
Blob data is a **mix of formats**:

| Format | Identified by | Contains |
|--------|--------------|----------|
| Raw JSON | Starts with `{` | `{role, content, id, providerOptions}` — tool results, assistant responses |
| Protobuf-framed | Starts with `0A` (field 1, length-delimited) | Embedded strings (file paths, message text), hash references to other blobs |

The conversation is reconstructed by starting at `latestRootBlobId` and
following `parentId` links backward through the blob chain.

JSON blobs contain:

| Role | Contents |
|------|----------|
| `assistant` | `content[]` with `reasoning` blocks (thinking text, model name, signature) and `tool-call` blocks |
| `tool` | `content[]` with `tool-result` blocks (full tool output including file contents) |
| `user` | User prompt text |

### Current Adapter Implementation

`src/adapters/cursor.ts` (219 lines):

- `readSessionMeta()` (lines 106-126) — hex-decodes meta key `0`, extracts `agentId`, `name`, `createdAt`
- `readMessages()` (lines 128-168) — loads all blobs into a Map, traverses from root via `collectMessages()`
- `collectMessages()` (lines 170-205) — recursive: follows `parentId`, tries JSON parse, extracts `role` and `content`
- Timestamps are **interpolated** linearly between file creation and modification time

### Known Limitations

| Issue | Detail |
|-------|--------|
| Tokens always 0 | No token data in store.db |
| Tool uses always `[]` | `collectMessages()` doesn't extract `tool-call` or `tool-result` blocks |
| Thinking blocks empty | Reasoning blocks in blobs are not parsed |
| Timestamps fake | Linearly interpolated, not real per-message times |
| No sub-agent detection | CLI store.db doesn't reference sub-agents |
| Protobuf blobs skipped | `JSON.parse()` silently catches errors on protobuf blobs |

---

## Layer 4: AI Tracking (`ai-code-tracking.db`)

### Location

```
~/.cursor/ai-tracking/ai-code-tracking.db
```

### Tables

| Table | Purpose | Row count (observed) |
|-------|---------|---------------------|
| `ai_code_hashes` | Hashes of AI-generated code | 115 |
| `scored_commits` | Git commit AI attribution | 398 |
| `conversation_summaries` | Session summaries | 0 |
| `tracked_file_content` | Tracked file snapshots | 0 |
| `ai_deleted_files` | Files deleted by AI | 0 |
| `tracking_state` | Internal state | varies |

### Key Schema

```sql
CREATE TABLE ai_code_hashes (
  hash TEXT PRIMARY KEY,
  source TEXT NOT NULL,        -- "composer", "autocomplete", etc.
  fileExtension TEXT,
  fileName TEXT,
  requestId TEXT,
  conversationId TEXT,         -- links to composerData UUID
  timestamp INTEGER,
  createdAt INTEGER NOT NULL,
  model TEXT                   -- e.g. "composer-2-fast"
);

CREATE TABLE scored_commits (
  commitHash TEXT NOT NULL,
  branchName TEXT NOT NULL,
  scoredAt INTEGER NOT NULL,
  tabLinesAdded INTEGER,       -- via Tab completion
  composerLinesAdded INTEGER,  -- via Composer/Agent
  humanLinesAdded INTEGER,     -- typed manually
  v1AiPercentage TEXT,
  v2AiPercentage TEXT,
  PRIMARY KEY (commitHash, branchName)
);
```

### Jin Relevance

Low priority for conversation ingestion. Potential future uses:
- `conversationId` in `ai_code_hashes` links code output to conversations
- `scored_commits` provides AI vs human code attribution per git commit
- Could enrich `Conversation.metadata` with attribution data

---

## Layer Relationships and Recommended Strategy

### How Layers Overlap

```
                    IDE (GUI)   CLI --print   ACP    CDP→IDE    AppleScript→IDE
Layer 1 (vscdb)       Yes          No         No      Yes           Yes
Layer 2 (JSONL)       Yes          Yes        No      Yes           Yes
Layer 3 (store.db)    No           Yes        Yes     No            No
Layer 4 (tracking)    Yes          Partial    ?       Yes           Yes
Sub-agents            Yes          No         No      Yes (Max)     Untested
```

**CDP** (Chrome DevTools Protocol) is the best programmatic interface: it drives
the real IDE renderer, writes to Layer 1, and triggers sub-agents with Max mode.
Requires `--remote-debugging-port=9222` on launch.

See [orchestration.md](./orchestration.md) for all experiments and results.

### ID Correlation

- `composerData.composerId` (Layer 1) = agent-transcript directory UUID (Layer 2)
- `composerData.subagentComposerIds` (Layer 1) = `subagents/*.jsonl` filenames (Layer 2)
- `ai_code_hashes.conversationId` (Layer 4) = `composerData.composerId` (Layer 1)
- Layer 3 `agentId` matches Layer 2 transcript directory UUID

### Recommended Adapter Strategy

1. **Primary: Layer 1 (`state.vscdb`)** for IDE sessions — richest data with
   tokens, timestamps, tool details, sub-agent links
2. **Supplement: Layer 2 (`agent-transcripts/`)** for sub-agent content and
   CLI sessions that have no Layer 1 entry
3. **Fallback: Layer 3 (`store.db`)** for CLI-only sessions with no Layer 2
   transcript (rare edge case)
4. **Defer: Layer 4** for future enrichment, not core conversation ingestion

### Cross-References

- [ontology.md Section 6.3](../../ontology.md) — Current Cursor mapping table
- [index.md](./index.md) — Coverage gap summary
- [investigation.md](./investigation.md) — How these layers were discovered
- [examples.md](./examples.md) — Real data from each layer
