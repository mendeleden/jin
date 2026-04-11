# Cursor Data Examples

**Scope:** Real data samples from each storage layer, copy-pasteable queries,
and the normalized jin output they should produce.

All samples are from actual Cursor sessions on the jin project (2026-03-23).
UUIDs and paths are real (not anonymized) since this is the jin repo itself.

---

## 1. Layer 1: `state.vscdb`

### 1.1 Querying Sessions

```bash
DB="$HOME/Library/Application Support/Cursor/User/globalStorage/state.vscdb"
```

```sql
-- List all sessions with name, model, creation time
SELECT
  substr(key, 15) as composerId,
  json_extract(value, '$.name') as name,
  json_extract(value, '$.modelConfig.modelName') as model,
  json_extract(value, '$.isAgentic') as agentic,
  json_extract(value, '$.createdAt') as created,
  json_extract(value, '$.totalLinesAdded') as lines_added
FROM cursorDiskKV
WHERE key LIKE 'composerData:%'
ORDER BY json_extract(value, '$.lastUpdatedAt') DESC
LIMIT 10;
```

### 1.2 Raw `composerData` (abridged)

```json
{
  "_v": 3,
  "composerId": "0f3b2f51-10f6-4e93-a4c6-31c2f081e0eb",
  "name": "Exploration of jin init process",
  "createdAt": 1774308214542,
  "lastUpdatedAt": 1774309800000,
  "modelConfig": {
    "modelName": "composer-2-fast",
    "maxMode": false
  },
  "isAgentic": true,
  "usageData": {},
  "subagentComposerIds": [
    "929c6fa8-219c-4b50-8e65-864f28996fd3",
    "d3579ebf-f5cf-400f-bb3b-b3b3790d6be9",
    "a09a3f98-a08a-4bf1-999b-fa56e35e7c08",
    "5afaeddf-dfc6-45dc-a2ed-9c2e356fb452",
    "38967f4d-5e67-4c6d-966d-e764dc14874e",
    "2b28d4ae-b87c-4afd-b6da-49866eac8d9d",
    "7c02789e-5a4a-4e5c-a1f7-3e7978b4c93b",
    "39af46db-e10f-4a32-b701-a83cf8da5d9b",
    "088cf592-38fc-47d5-bb7d-8b544f35e569"
  ],
  "subComposerIds": [],
  "totalLinesAdded": 703,
  "totalLinesRemoved": 0,
  "fullConversationHeadersOnly": [
    {"bubbleId": "9be9ea53-615e-4598-a153-0decef695dff", "type": 1},
    {"bubbleId": "bd63c0b0-a367-40a1-8108-89b7ce5d5966", "type": 2},
    {"bubbleId": "bd41155c-4854-4ad4-9ae4-26a3555d801b", "type": 2}
  ]
}
```

### 1.3 Raw `bubbleId` — Assistant with Tokens

```sql
-- Find bubbles with non-zero token counts
SELECT key,
  json_extract(value, '$.type') as msg_type,
  json_extract(value, '$.tokenCount') as tokens,
  json_extract(value, '$.createdAt') as created,
  substr(json_extract(value, '$.text'), 1, 80) as text_preview
FROM cursorDiskKV
WHERE key LIKE 'bubbleId:%'
  AND json_extract(value, '$.tokenCount.inputTokens') > 0
LIMIT 5;
```

Sample bubble (from a different project session):

```json
{
  "bubbleId": "0af06047-45c2-49bc-aa5b-7913cdf023ba",
  "type": 2,
  "text": "## Package Overview\n\nThe `@open-permit/shared` package is a shared library...",
  "tokenCount": {
    "inputTokens": 11619,
    "outputTokens": 1124
  },
  "createdAt": "2025-12-20T20:21:30.661Z",
  "toolFormerData": {}
}
```

### 1.4 Raw `bubbleId` — Tool Call

```json
{
  "bubbleId": "059c5b40-c508-45c4-88a2-5c11ca41f82c",
  "type": 2,
  "text": "",
  "tokenCount": {
    "inputTokens": 0,
    "outputTokens": 0
  },
  "createdAt": "2026-03-23T23:27:22.549Z",
  "toolFormerData": {
    "toolCallId": "tool_0a0af2fb-dee6-4112-afaa-d5b57211deb",
    "toolIndex": 0,
    "status": "completed",
    "name": "ripgrep_raw_search",
    "rawArgs": "{\"pattern\":\"init\",\"path\":\"/Users/edenmendel/Documents/GitHub/jin\",\"glob\":\"*.{ts,tsx,js,mjs}\",\"caseInsensitive\":false,\"headLimit\":80}",
    "tool": 41
  }
}
```

### 1.5 Querying Sub-Agent Relationships

```sql
-- Find sessions with sub-agents
SELECT
  substr(key, 15) as composerId,
  json_extract(value, '$.name') as name,
  json_extract(value, '$.subagentComposerIds') as subagents,
  json_array_length(json_extract(value, '$.subagentComposerIds')) as sub_count
FROM cursorDiskKV
WHERE key LIKE 'composerData:%'
  AND json_array_length(json_extract(value, '$.subagentComposerIds')) > 0;
```

---

## 2. Layer 2: Agent Transcripts

### 2.1 Root Agent Transcript

File: `~/.cursor/projects/Users-edenmendel-Documents-GitHub-jin/agent-transcripts/3c29dee7-efd4-46d1-984d-abad992f016a/3c29dee7-efd4-46d1-984d-abad992f016a.jsonl`

```jsonl
{"role":"user","message":{"content":[{"type":"text","text":"<user_query>\nI need you to do a thorough analysis. Find all adapter files in src/adapters/...\n</user_query>"}]}}
{"role":"assistant","message":{"content":[{"type":"text","text":"The user wants me to analyze all adapter files in `src/adapters/`. Let me start by finding all files in that directory and reading them."},{"type":"tool_use","name":"Glob","input":{"glob_pattern":"src/adapters/**/*"}}]}}
{"role":"assistant","message":{"content":[{"type":"text","text":"Let me read all the adapter files in `src/adapters/`."},{"type":"tool_use","name":"Read","input":{"path":"/Users/edenmendel/Documents/GitHub/jin/src/adapters/types.ts"}},{"type":"tool_use","name":"Read","input":{"path":"/Users/edenmendel/Documents/GitHub/jin/src/adapters/registry.ts"}},{"type":"tool_use","name":"Read","input":{"path":"/Users/edenmendel/Documents/GitHub/jin/src/adapters/cursor.ts"}}]}}
{"role":"assistant","message":{"content":[{"type":"text","text":"Here's the full structured analysis of all 10 adapters:\n\n---\n\n## Adapter Summary\n..."}]}}
```

Note: `tool_use` blocks have `name` and `input` but no `id` and no result.
The assistant response after tool calls contains the synthesized answer, not
the raw tool output.

### 2.2 Sub-Agent Transcript

File: `~/.cursor/projects/.../agent-transcripts/0f3b2f51-.../subagents/929c6fa8-219c-4b50-8e65-864f28996fd3.jsonl`

```jsonl
{"role":"user","message":{"content":[{"type":"text","text":"<user_query>\nWorkspace: /Users/edenmendel/Documents/GitHub/jin\n\nRead src/adapters/registry.ts (allAdapters). Skim one adapter's detect() pattern if quick...\n</user_query>"}]}}
{"role":"assistant","message":{"content":[{"type":"text","text":"Gathering adapter registry, ingest command, progress usage, and init → ingest flow."}]}}
{"role":"assistant","message":{"content":[{"type":"text","text":"Here is the section you asked for:\n\n## Adapters and auto-ingest\n\n**Adapter registry.** `allAdapters()` returns a fixed list..."}]}}
```

Sub-agent transcripts have the same format as root transcripts. The parent
provides the sub-agent's task as a `<user_query>` in the first line.

### 2.3 Directory Structure

```
agent-transcripts/
  0f3b2f51-10f6-4e93-a4c6-31c2f081e0eb/
    0f3b2f51-10f6-4e93-a4c6-31c2f081e0eb.jsonl     # root
    subagents/
      5afaeddf-dfc6-45dc-a2ed-9c2e356fb452.jsonl   # sub-agent 1
      929c6fa8-219c-4b50-8e65-864f28996fd3.jsonl   # sub-agent 2
      a09a3f98-a08a-4bf1-999b-fa56e35e7c08.jsonl   # sub-agent 3
      d3579ebf-f5cf-400f-bb3b-b3b3790d6be9.jsonl   # sub-agent 4
```

These 4 sub-agent UUIDs appear in the parent's `composerData.subagentComposerIds`
(Layer 1). The parent had 9 sub-agents total — the remaining 5 may have been
created later or stored elsewhere.

---

## 3. Layer 3: CLI `store.db`

### 3.1 Meta Row (Hex-Decoded)

```bash
sqlite3 store.db "SELECT value FROM meta WHERE key='0';" | xxd -r -p
```

```json
{
  "agentId": "d553b0e2-d949-4dc3-a6f5-8a4e496c85ea",
  "latestRootBlobId": "1844a7e1ca7671077474a3a2b79bbcf6120428b51be062e21d0d09263fae29c8",
  "name": "New Agent",
  "mode": "search",
  "createdAt": 1774308018582
}
```

### 3.2 Blob Types by Role

```sql
SELECT
  CASE
    WHEN cast(data as text) LIKE '%"assistant"%' THEN 'assistant'
    WHEN cast(data as text) LIKE '%"user"%' THEN 'user'
    WHEN cast(data as text) LIKE '%"tool"%' THEN 'tool'
    WHEN cast(data as text) LIKE '%reasoning%' THEN 'reasoning'
    ELSE 'structural'
  END as blob_type,
  count(*),
  sum(length(data)) as total_bytes
FROM blobs
GROUP BY blob_type;
```

### 3.3 JSON Blob — Tool Result

A `role: "tool"` blob containing a Read tool's full output:

```json
{
  "role": "tool",
  "content": [
    {
      "type": "tool-result",
      "toolCallId": "toolu_017bbizhpUfSLeTqjGMVkGhU",
      "toolName": "Read",
      "result": "     1|import { existsSync, readdirSync, ... } from \"fs\";\n     2|..."
    }
  ],
  "id": "3",
  "providerOptions": {}
}
```

### 3.4 JSON Blob — Reasoning + Tool Call

```json
{
  "role": "assistant",
  "content": [
    {
      "type": "reasoning",
      "text": "The user wants me to analyze all adapter files...",
      "providerOptions": {
        "cursor": {
          "modelName": "claude-4.6-opus-high-thinking"
        }
      },
      "signature": "ErECCkYICxgCKkDm..."
    },
    {
      "type": "tool-call",
      "toolCallId": "toolu_012sPVACsQbKxnogNYSbToa8",
      "toolName": "Glob",
      "args": {
        "glob_pattern": "src/adapters/**/*"
      }
    }
  ],
  "id": "1"
}
```

### 3.5 Protobuf Blob — Structural

Small blobs (~50-300 bytes) with protobuf framing. First bytes:

```
0A 37 0A 35 4C 65 74 20 6D 65 20 72 65 61 64 ...
```

`0A` = protobuf field 1, length-delimited. Contains embedded strings
(e.g., "Let me read all the adapter files...") and 32-byte SHA-256 hash
references to other blobs (the tree edges).

---

## 4. Stream-JSON Events (`cursor agent --print`)

### 4.1 Init Event

```json
{
  "type": "system",
  "subtype": "init",
  "apiKeySource": "login",
  "cwd": "/Users/edenmendel/Documents/GitHub/jin",
  "session_id": "0ff480c6-bdcd-4a4f-b94a-09158715eba0",
  "model": "Opus 4.6 1M Thinking",
  "permissionMode": "default"
}
```

### 4.2 Thinking Events

```json
{"type": "thinking", "subtype": "delta", "text": "The user wants me to read src/config.ts and check for .env.example.", "session_id": "0ff480c6-...", "timestamp_ms": 1774308220953}
{"type": "thinking", "subtype": "delta", "text": " Let me do both in parallel.", "session_id": "0ff480c6-...", "timestamp_ms": 1774308221538}
{"type": "thinking", "subtype": "completed", "session_id": "0ff480c6-...", "timestamp_ms": 1774308221547}
```

### 4.3 Tool Call Events

Started:
```json
{
  "type": "tool_call",
  "subtype": "started",
  "call_id": "toolu_01JbVbthhkjqRS4FQupiFmUi",
  "tool_call": {
    "readToolCall": {
      "args": {"path": "/Users/edenmendel/Documents/GitHub/jin/src/config.ts"}
    }
  },
  "model_call_id": "40639484-70bc-42ef-8088-a81ace19f547-0-m2q5",
  "session_id": "0ff480c6-...",
  "timestamp_ms": 1774308222576
}
```

Completed (abridged — result contains full file content):
```json
{
  "type": "tool_call",
  "subtype": "completed",
  "call_id": "toolu_01JbVbthhkjqRS4FQupiFmUi",
  "tool_call": {
    "readToolCall": {
      "args": {"path": "/Users/edenmendel/Documents/GitHub/jin/src/config.ts"},
      "result": {
        "success": {
          "content": "import { existsSync, mkdirSync } from \"fs\";\n...",
          "isEmpty": false,
          "totalLines": 111,
          "fileSize": 2996,
          "path": "/Users/edenmendel/Documents/GitHub/jin/src/config.ts"
        }
      }
    }
  },
  "session_id": "0ff480c6-..."
}
```

### 4.4 Result Event

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "duration_ms": 9901,
  "duration_api_ms": 9901,
  "result": "There is **no default port number** in `src/config.ts`...",
  "session_id": "0ff480c6-bdcd-4a4f-b94a-09158715eba0",
  "request_id": "40639484-70bc-42ef-8088-a81ace19f547",
  "usage": {
    "inputTokens": 4,
    "outputTokens": 313,
    "cacheReadTokens": 29683,
    "cacheWriteTokens": 1607
  }
}
```

---

## 5. Cross-Layer Comparison: Same Session

Session `0f3b2f51-10f6-4e93-a4c6-31c2f081e0eb` (IDE session with 9 sub-agents):

| Data point | Layer 1 (state.vscdb) | Layer 2 (JSONL) |
|-----------|----------------------|-----------------|
| Session ID | `composerData:0f3b2f51-...` | Directory `0f3b2f51-...` |
| Name | `"Exploration of jin init process"` | Not present |
| Model | `"composer-2-fast"` | Not present |
| Sub-agents | `subagentComposerIds: [929c6fa8, d3579ebf, ...]` (9 IDs) | `subagents/` dir with 4 files |
| Message count | 61 bubbles in `fullConversationHeadersOnly` | 2 lines in root JSONL |
| Token data | Per-bubble `tokenCount` | Not present |
| Tool calls | Per-bubble `toolFormerData` | `tool_use` blocks (name+input only) |
| Timestamps | Per-bubble `createdAt` | Not present |
| Lines added | `totalLinesAdded: 703` | Not present |

**Key observation:** Layer 2 only captured the root agent's first exchange
(2 JSONL lines: user prompt + initial response). The full 61-message
conversation with all tool calls and sub-agent interactions lives in Layer 1.
Layer 2 is a summary transcript, not a complete record.

---

## 6. Normalized Jin Output

What the adapter should produce from Layer 1 data. Types follow
[BP-04](../../blueprint/BP-04-adapter-contract.md).

### 6.1 composerData → `ParsedConversation`

```typescript
const conversation: ParsedConversation = {
  id: "0f3b2f51-10f6-4e93-a4c6-31c2f081e0eb",   // from composerData.composerId
  name: "Exploration of jin init process",
  adapterId: "cursor",
  cwd: "",                                         // not in Layer 1 — resolve from workspace path
  gitRemote: "",                                   // resolve via `git remote get-url origin` at cwd
  branch: "",                                      // resolve via `git branch --show-current` at cwd
  model: "composer-2-fast",                        // from composerData.modelConfig.modelName
  startedAt: "2026-03-23T17:03:34.542Z",          // from composerData.createdAt
  endedAt: "2026-03-23T17:30:00.000Z",            // from composerData.lastUpdatedAt
  sourcePath: "~/Library/.../state.vscdb",
  sourceFormat: "sqlite",
  relationship: "root",                            // default for top-level sessions
  traceId: "0f3b2f51-10f6-4e93-a4c6-31c2f081e0eb", // root: traceId = id
  parentId: "",
};
```

### 6.2 Bubble → `ParsedMessage`

```typescript
const message: ParsedMessage = {
  id: "0af06047-45c2-49bc-aa5b-7913cdf023ba",
  role: "assistant",                               // type: 2 → "assistant"
  content: "## Package Overview\n\nThe `@open-permit/shared` package...",
  timestamp: "2025-12-20T20:21:30.661Z",          // real per-message timestamp from createdAt
  model: "",                                        // not per-message in Layer 1
  inputTokens: 11619,                              // from tokenCount.inputTokens
  outputTokens: 1124,                              // from tokenCount.outputTokens
  cacheRead: 0,
  cacheWrite: 0,
  recordType: "assistant",                         // derived from bubble type
  sequence: 5,                                     // ordinal position in bubble list
  turn: 2,                                         // computed from role transitions
  isSidechain: false,
  thinkingContent: "",                             // from allThinkingBlocks if present
  thinkingTokens: 0,
};
```

### 6.3 toolFormerData → `ParsedToolCall`

```typescript
const toolCall: ParsedToolCall = {
  id: "tool_0a0af2fb-dee6-4112-afaa-d5b57211deb", // from toolCallId
  name: "ripgrep_raw_search",                       // from name
  input: '{"pattern":"init","path":"/Users/..."}',  // from rawArgs
  output: "",                                        // not available in toolFormerData
  isError: false,
};
```

### 6.4 Sub-Agent → `ParsedConversation` with Relationship

```typescript
// See BP-03 for relationship model
const subAgent: ParsedConversation = {
  id: "929c6fa8-219c-4b50-8e65-864f28996fd3",
  name: "Sub-agent: Adapters and auto-ingest",
  adapterId: "cursor",
  cwd: "",
  gitRemote: "",
  branch: "",
  model: "",
  startedAt: "...",
  endedAt: "...",
  sourcePath: "~/.cursor/projects/.../subagents/929c6fa8-....jsonl",
  sourceFormat: "jsonl",
  relationship: "spawned",                          // sub-agent → spawned
  traceId: "0f3b2f51-10f6-4e93-a4c6-31c2f081e0eb", // inherits parent's traceId
  parentId: "0f3b2f51-10f6-4e93-a4c6-31c2f081e0eb", // parent conversation ID
};
```

---

## Cross-References

- [overview.md](./overview.md) — Data model details for each layer
- [investigation.md](./investigation.md) — How to reproduce these queries
- [index.md](./index.md) — Coverage gap summary
- [BP-04](../../blueprint/BP-04-adapter-contract.md) — `ParsedConversation`, `ParsedMessage`, `ParsedToolCall` type definitions
- [BP-03](../../blueprint/BP-03-conversation-model.md) — `traceId`, `parentId`, `relationship` model
