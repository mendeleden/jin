# Cursor Data Investigation

**Scope:** Reproducible forensics log documenting how Cursor's storage layers
were discovered. Every finding is backed by a command you can run yourself.

**Date:** 2026-03-23
**Cursor version:** 2.6.20 (`b29eb4ee5f9f6d1cb2afbc09070198d3ea6ad760`, arm64)
**Platform:** macOS (darwin 25.2.0)
**Investigator:** Claude Code (Opus 4.6) + Eden Mendel

---

## Prerequisites

- Cursor installed with at least one conversation
- `sqlite3` CLI
- `xxd` for hex decoding (standard on macOS/Linux)
- `python3` for JSON parsing
- `strings` for binary inspection

---

## 1. Discovery: Finding All Storage Locations

### 1.1 Cursor CLI and Config

```bash
which cursor
# /usr/local/bin/cursor

cursor --version
# 2.6.20

cat ~/.cursor/cli-config.json
# Contains: permissions, model, authInfo, approvalMode, sandbox settings
```

### 1.2 Finding All Databases

```bash
find ~/.cursor -name "*.sqlite" -o -name "*.db" -o -name "*.sqlite3" -o -name "*.vscdb" 2>/dev/null
```

Result:
```
~/.cursor/ai-tracking/ai-code-tracking.db          # Layer 4
```

```bash
find ~/Library/Application\ Support/Cursor -name "*.vscdb" 2>/dev/null
```

Result:
```
~/Library/Application Support/Cursor/User/globalStorage/state.vscdb
~/Library/Application Support/Cursor/User/workspaceStorage/<hash>/state.vscdb  (multiple)
```

### 1.3 Finding JSONL Transcripts

```bash
find ~/.cursor -name "*.jsonl" 2>/dev/null
```

Result: files under `~/.cursor/projects/<workspace>/agent-transcripts/`

### 1.4 Finding store.db Files

```bash
find ~/.cursor/chats -name "store.db" 2>/dev/null
```

Result: files under `~/.cursor/chats/<workspace-hash>/<session-id>/`

---

## 2. Layer 1: `state.vscdb` Investigation

### 2.1 Schema Discovery

```bash
DB="$HOME/Library/Application Support/Cursor/User/globalStorage/state.vscdb"
sqlite3 "$DB" ".tables"
# ItemTable     cursorDiskKV
sqlite3 "$DB" ".schema"
# CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);
# CREATE TABLE cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);
```

### 2.2 Key Namespace Enumeration

```bash
sqlite3 "$DB" "
  SELECT
    CASE
      WHEN key LIKE 'composerData:%' THEN 'composerData'
      WHEN key LIKE 'bubbleId:%' THEN 'bubbleId'
      WHEN key LIKE 'agentKv:%' THEN 'agentKv'
      WHEN key LIKE 'checkpointId:%' THEN 'checkpointId'
      WHEN key LIKE 'codeBlockDiff:%' THEN 'codeBlockDiff'
      ELSE key
    END as prefix,
    count(*)
  FROM cursorDiskKV
  GROUP BY prefix
  ORDER BY count(*) DESC;"
```

Result (observed):
```
bubbleId         901
agentKv          580
checkpointId      93
composerData      65
codeBlockDiff     55
... (messageRequestContext, ofsContent, inlineDiff, etc.)
```

### 2.3 composerData Examination

```bash
# List all session IDs and names
sqlite3 "$DB" "SELECT key FROM cursorDiskKV WHERE key LIKE 'composerData%' LIMIT 5;"
```

```bash
# Extract and parse a single composerData entry
sqlite3 "$DB" "SELECT cast(value as text) FROM cursorDiskKV
  WHERE key='composerData:<uuid>';" | python3 -c "
import sys, json
obj = json.loads(sys.stdin.read().strip())
print('Keys:', sorted(obj.keys()))
print('name:', obj.get('name'))
print('isAgentic:', obj.get('isAgentic'))
print('modelConfig:', json.dumps(obj.get('modelConfig')))
print('subagentComposerIds:', obj.get('subagentComposerIds'))
print('usageData:', json.dumps(obj.get('usageData')))
print('createdAt:', obj.get('createdAt'))
"
```

Key findings:
- `composerData` has 70+ top-level keys
- `subagentComposerIds` is an array of UUIDs linking to child agents
- `usageData` is often empty `{}` (token data may be per-bubble instead)
- `modelConfig.modelName` identifies the model (e.g., `"composer-2-fast"`)

### 2.4 bubbleId Examination

```bash
# List bubbles for a session
sqlite3 "$DB" "SELECT key FROM cursorDiskKV
  WHERE key LIKE 'bubbleId:<composerId>:%' LIMIT 5;"

# Extract a bubble with token and tool data
sqlite3 "$DB" "SELECT cast(value as text) FROM cursorDiskKV
  WHERE key='bubbleId:<composerId>:<bubbleId>';" | python3 -c "
import sys, json
obj = json.loads(sys.stdin.read().strip())
print('type:', obj.get('type'))  # 1=user, 2=assistant
print('tokenCount:', json.dumps(obj.get('tokenCount')))
print('toolFormerData name:', obj.get('toolFormerData',{}).get('name',''))
print('createdAt:', obj.get('createdAt'))
print('text[:100]:', obj.get('text','')[:100])
"
```

Key findings:
- `tokenCount` is `{inputTokens: N, outputTokens: N}` (not a scalar)
- `toolFormerData` contains `name`, `rawArgs` (JSON string), `status`
- `type: 1` = user, `type: 2` = assistant
- `createdAt` is a real per-message ISO 8601 timestamp
- Bubbles with non-zero token counts were found (e.g., `inputTokens: 52256, outputTokens: 1089`)

### 2.5 CLI Sessions in state.vscdb — Verification

```bash
# We created 3 CLI sessions: d553b0e2, 0ff480c6, 3c29dee7
# Check if they appear in globalStorage
for sid in d553b0e2-d949-4dc3-a6f5-8a4e496c85ea \
           0ff480c6-bdcd-4a4f-b94a-09158715eba0 \
           3c29dee7-efd4-46d1-984d-abad992f016a; do
  count=$(sqlite3 "$DB" "SELECT count(*) FROM cursorDiskKV WHERE key LIKE '%$sid%';")
  echo "$sid: $count entries"
done
```

Result: **0 entries for all 3 CLI sessions.** CLI sessions do not appear in
Layer 1.

---

## 3. Layer 2: Agent Transcripts Investigation

### 3.1 Discovery

```bash
find ~/.cursor/projects -name "*.jsonl" -path "*/agent-transcripts/*" | sort
```

Result: multiple `.jsonl` files organized as `<uuid>/<uuid>.jsonl`, with some
having `subagents/` subdirectories.

### 3.2 Format Analysis

```bash
# Parse a transcript and categorize content types
cat <path>.jsonl | python3 -c "
import json, sys
for i, line in enumerate(sys.stdin):
    obj = json.loads(line.strip())
    role = obj.get('role','?')
    content = obj.get('message',{}).get('content',[])
    types = [c.get('type','?') for c in content]
    tool_names = [c.get('name','') for c in content if c.get('type') == 'tool_use']
    print(f'Line {i+1}: role={role}, types={types}, tools={tool_names}')
"
```

### 3.3 What tool_use Blocks Contain

```bash
# Extract tool_use block structure
cat <path>.jsonl | python3 -c "
import json, sys
for line in sys.stdin:
    obj = json.loads(line.strip())
    for c in obj.get('message',{}).get('content',[]):
        if c.get('type') == 'tool_use':
            print('Keys:', sorted(c.keys()))
            print('Example:', json.dumps(c)[:300])
            break
"
```

Result: `tool_use` blocks have `{type, name, input}` — **no `id`, no result/output**.

### 3.4 Audit for Missing Data

```bash
# Check all transcripts for token data, tool results, thinking
for f in $(find ~/.cursor/projects/<proj>/agent-transcripts -name "*.jsonl"); do
  echo "=== $(basename $f) ==="
  python3 -c "
import json
has = {'tool_use':False,'tool_result':False,'thinking':False,'tokens':False}
for line in open('$f'):
    obj = json.loads(line.strip())
    for c in obj.get('message',{}).get('content',[]):
        if c.get('type') == 'tool_result': has['tool_result'] = True
        if c.get('type') == 'tool_use': has['tool_use'] = True
        if c.get('type') == 'thinking': has['thinking'] = True
    if 'tokenCount' in json.dumps(obj) or 'inputTokens' in json.dumps(obj):
        has['tokens'] = True
print(has)
"
done
```

Result: `tool_use: True` in some files, everything else `False` across all
transcripts.

### 3.5 Sub-Agent Discovery

```bash
find ~/.cursor/projects/<proj>/agent-transcripts -name "*.jsonl" -path "*/subagents/*"
```

Found 4 sub-agent transcripts under one session. The parent `composerData`
in Layer 1 has `subagentComposerIds` containing these exact UUIDs.

---

## 4. Layer 3: CLI Blob Store Investigation

### 4.1 Triggering a CLI Session

```bash
cursor agent --print --output-format stream-json \
  --workspace /path/to/project --trust --mode ask \
  "List the files in src/ and tell me what this project does"
```

This creates:
- `~/.cursor/chats/<hash>/<session-id>/store.db`
- `~/.cursor/projects/<proj>/agent-transcripts/<session-id>/<session-id>.jsonl`

### 4.2 Schema

```bash
sqlite3 store.db ".tables"
# blobs  meta
sqlite3 store.db ".schema"
# CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB);
# CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
```

### 4.3 Meta Decoding

```bash
sqlite3 store.db "SELECT value FROM meta WHERE key='0';" | xxd -r -p
```

Result (example):
```json
{
  "agentId": "d553b0e2-d949-4dc3-a6f5-8a4e496c85ea",
  "latestRootBlobId": "1844a7e1ca767107...",
  "name": "New Agent",
  "mode": "search",
  "createdAt": 1774308018582
}
```

Note: the raw value in the meta table is hex-encoded — the `xxd -r -p`
decodes it. The adapter uses `Buffer.from(value, "hex").toString("utf-8")`.

### 4.4 Blob Format Analysis

```bash
# Check blob count and sizes
sqlite3 store.db "SELECT id, length(data) FROM blobs ORDER BY length(data) DESC LIMIT 10;"

# Check magic bytes of first blob
sqlite3 store.db "SELECT hex(substr(data,1,4)) FROM blobs LIMIT 1;"
# 0A209EAF — 0x0A = protobuf field 1, length-delimited
```

Some blobs are valid JSON (try parsing):
```bash
sqlite3 store.db "SELECT writefile('/tmp/blob.bin', data) FROM blobs WHERE id='<id>';"
python3 -c "
import json
data = open('/tmp/blob.bin','rb').read()
try:
    obj = json.loads(data)
    print('JSON:', sorted(obj.keys()))
except:
    print('Not JSON — first 20 hex:', data[:20].hex())
"
```

Key findings:
- Large blobs (10KB+) tend to be JSON with `role: "tool"` containing full
  file contents as tool results
- Medium blobs may be JSON with `role: "assistant"` containing `reasoning`
  and `tool-call` blocks
- Small blobs tend to be protobuf-framed with embedded strings (file paths,
  short text) and hash references to other blobs
- The `reasoning` blocks contain model name and cryptographic signature

### 4.5 Blob Tree Traversal

The conversation is a chain: each blob references its parent via `parentId`
(in JSON blobs) or embedded hash (in protobuf blobs). The adapter starts
at `latestRootBlobId` and walks backward.

```bash
# Dump readable strings from blobs to understand structure
sqlite3 store.db "SELECT writefile('/tmp/blob.bin', data) FROM blobs WHERE id='<rootId>';"
strings /tmp/blob.bin | head -20
```

---

## 5. Layer 4: AI Tracking Investigation

### 5.1 Schema

```bash
sqlite3 ~/.cursor/ai-tracking/ai-code-tracking.db ".tables"
# ai_code_hashes  conversation_summaries  scored_commits
# tracked_file_content  ai_deleted_files  tracking_state

sqlite3 ~/.cursor/ai-tracking/ai-code-tracking.db ".schema"
```

### 5.2 Row Counts

```bash
sqlite3 ~/.cursor/ai-tracking/ai-code-tracking.db "
  SELECT 'ai_code_hashes', count(*) FROM ai_code_hashes
  UNION ALL SELECT 'scored_commits', count(*) FROM scored_commits
  UNION ALL SELECT 'conversation_summaries', count(*) FROM conversation_summaries
  UNION ALL SELECT 'tracked_file_content', count(*) FROM tracked_file_content
  UNION ALL SELECT 'ai_deleted_files', count(*) FROM ai_deleted_files;"
```

Result: `ai_code_hashes: 115`, `scored_commits: 398`, rest were 0.

### 5.3 Sample Data

```bash
sqlite3 ~/.cursor/ai-tracking/ai-code-tracking.db "
  SELECT hash, source, fileExtension, conversationId, model
  FROM ai_code_hashes ORDER BY createdAt DESC LIMIT 5;"
```

---

## 6. CLI Agent Experiment: `cursor agent --print`

### 6.1 Available Modes

```bash
cursor agent --help
```

Key options:
- `--print` — non-interactive, prints responses (required for scripting)
- `--output-format text|json|stream-json` — output format
- `--mode plan|ask` — read-only modes
- `--force` / `--yolo` — auto-approve all tools
- `--trust` — trust workspace without prompting
- `--workspace <path>` — set working directory

### 6.2 Stream-JSON Event Types

```bash
cursor agent --print --output-format stream-json \
  --workspace /path/to/project --trust --mode ask \
  "Read src/config.ts and tell me the default port" 2>&1
```

Event types observed:

| `type` | `subtype` | Contains |
|--------|-----------|----------|
| `system` | `init` | `apiKeySource`, `cwd`, `session_id`, `model`, `permissionMode` |
| `user` | — | `role`, `content[]` |
| `thinking` | `delta` | Reasoning text (streamed incrementally) |
| `thinking` | `completed` | End of thinking |
| `tool_call` | `started` | `call_id`, tool name, args |
| `tool_call` | `completed` | `call_id`, tool name, args, **full result** |
| `assistant` | — | Final response text |
| `result` | `success` | `duration_ms`, `session_id`, `request_id`, `usage` |

### 6.3 Usage Data in Stream Output

The `result` event includes token usage:
```json
{
  "type": "result",
  "subtype": "success",
  "duration_ms": 14266,
  "usage": {
    "inputTokens": 5,
    "outputTokens": 432,
    "cacheReadTokens": 45803,
    "cacheWriteTokens": 3983
  }
}
```

This is **per-session** usage (sum across all turns), not per-message.

### 6.4 What Gets Created

Each `cursor agent --print` invocation creates:
1. A Layer 2 transcript at `agent-transcripts/<session-id>/<session-id>.jsonl`
2. A Layer 3 store.db at `chats/<hash>/<session-id>/store.db`
3. A `worker.log` file in the project's agent-transcripts directory
4. **Does NOT create** a Layer 1 entry in `state.vscdb`

---

## 7. Cross-Layer Correlation

### 7.1 ID Matching Verification

We verified that for session `0f3b2f51-10f6-4e93-a4c6-31c2f081e0eb`:
- Layer 1: `composerData:0f3b2f51-...` exists with `subagentComposerIds: [929c6fa8-..., d3579ebf-..., a09a3f98-..., 5afaeddf-..., ...]`
- Layer 2: `agent-transcripts/0f3b2f51-.../subagents/` contains files matching those exact UUIDs
- The IDs are consistent across layers

### 7.2 Completeness Matrix

| Data point | Layer 1 | Layer 2 | Layer 3 | Layer 4 | Stream-JSON |
|-----------|---------|---------|---------|---------|-------------|
| Message text | Yes | Yes | Yes | No | Yes |
| Token counts | Yes (bubble) | No | No | No | Yes (session total) |
| Tool inputs | Yes | Yes | Yes | No | Yes |
| Tool results | Yes | No | Yes | No | Yes |
| Thinking | Yes | No | Yes | No | Yes |
| Timestamps | Yes (per-msg) | No | No (interpolated) | Yes | Yes |
| Sub-agents | Yes (IDs) | Yes (files) | No | No | No |
| Model info | Yes | No | Partial | Yes | Yes |
| IDE sessions | Yes | Yes | No | Yes | N/A |
| CLI sessions | No | Yes | Yes | Partial | N/A |

---

## 8. Open Questions

- [ ] Does `state.vscdb` lock while Cursor IDE is running? (may need WAL mode or retry logic)
- [ ] What happens to composerData when context is compacted? (new composerId or updated?)
- [ ] Can sub-agents spawn sub-agents? (tree depth > 2 in Layer 1?)
- [ ] Are there additional key prefixes in newer Cursor versions?
- [ ] Linux and Windows path verification needed for all 4 layers
- [ ] Does `usageData` on `composerData` ever get populated? (empty in all observed sessions)
- [ ] Does the stream-json `usage` data get written to any persistent storage?
- [ ] What is the `agentKv:blob:<hash>` namespace used for exactly?

---

## Cross-References

- [overview.md](./overview.md) — Structured summary of all findings
- [examples.md](./examples.md) — Concrete data samples from these investigations
- [index.md](./index.md) — Coverage gap summary
