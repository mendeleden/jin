# Codex Data Examples

**Scope:** Real data samples from each storage layer, copy-pasteable queries,
and the normalized jin output they should produce.

All samples are from actual Codex sessions on the jin project (2026-03-25).
UUIDs and paths are real (not anonymized) since this is the jin repo itself.

---

## 1. Layer 1: `state_5.sqlite`

### 1.1 Querying Threads

```sql
-- List all threads with metadata
SELECT id, source, tokens_used, approval_mode,
       substr(first_user_message, 1, 60) as first_msg,
       git_branch, cli_version
FROM threads
ORDER BY updated_at DESC;
```

Result (observed):
```
019d279b-...|vscode|69589|on-request|how would we use sub-agents                |feat/rewrite-ontology|0.117.0-alpha.12
019d27a7-...|exec  |44861|never     |[JIN-CODEX-TRACE-01] 🔍🦔 You are in a tra|feat/rewrite-ontology|0.117.0-alpha.12
019d27a7-...|exec  |23174|never     |[JIN-CODEX-TRACE-04] 🔍🦔 Read the file sr|feat/rewrite-ontology|0.117.0-alpha.12
019d11c5-...|vscode|4214963|never   |hey! we have two open PRs for this repo    |main                |0.108.0-alpha.12
```

### 1.2 Source Breakdown

```sql
SELECT source, count(*) FROM threads GROUP BY source;
```

Result:
```
exec|2
vscode|5
```

### 1.3 Thread with Git Metadata

```sql
SELECT id, source, cwd, git_branch, git_origin_url, git_sha,
       cli_version, memory_mode
FROM threads
WHERE id = '019d27a7-1649-73a2-abd0-0d411f7e9849';
```

Result:
```
019d27a7-...|exec|/Users/edenmendel/Documents/GitHub/jin|feat/rewrite-ontology|https://github.com/mendeleden/jin.git||0.117.0-alpha.12|enabled
```

### 1.4 Dynamic Tools

```sql
SELECT thread_id, name, description, input_schema
FROM thread_dynamic_tools;
```

Result (only Desktop sessions register tools):
```
019d279b-...|read_thread_terminal|Read the current app terminal output...|{"type":"object","properties":{},"additionalProperties":false}
```

---

## 2. Layer 2: Session JSONL

### 2.1 Full Session Parse

```bash
cat <session>.jsonl | python3 -c "
import sys, json
for i, line in enumerate(sys.stdin, 1):
    obj = json.loads(line.strip())
    t = obj['type']
    p = obj.get('payload', {})
    ts = obj.get('timestamp', '')[:19]
    if t == 'session_meta':
        print(f'{i:2d} | {t:15s} | id={p[\"id\"][:36]} source={p.get(\"source\")}')
    elif t == 'response_item':
        pt = p.get('type','')
        role = p.get('role','')
        print(f'{i:2d} | {t:15s} | {pt:25s} role={role}')
    elif t == 'event_msg':
        et = p.get('type','')
        print(f'{i:2d} | {t:15s} | {et}')
    elif t == 'turn_context':
        print(f'{i:2d} | {t:15s} | model={p.get(\"model\")} effort={p.get(\"collaboration_mode\",{}).get(\"settings\",{}).get(\"reasoning_effort\")}')
"
```

### 2.2 Raw `session_meta` Record

```json
{
  "timestamp": "2026-03-26T00:59:14.893Z",
  "type": "session_meta",
  "payload": {
    "id": "019d27a7-1649-73a2-abd0-0d411f7e9849",
    "timestamp": "2026-03-26T00:59:14.893Z",
    "cwd": "/Users/edenmendel/Documents/GitHub/jin",
    "originator": "codex_exec",
    "cli_version": "0.117.0-alpha.12",
    "source": "exec",
    "model_provider": "openai",
    "base_instructions": {
      "text": "You are Codex, a coding agent based on GPT-5. You and the user share the same workspace..."
    }
  }
}
```

### 2.3 Raw `turn_context` Record

```json
{
  "timestamp": "2026-03-25T20:59:14.897Z",
  "type": "turn_context",
  "payload": {
    "turn_id": "019d27a7-1653-7892-82ca-9844241d7722",
    "cwd": "/Users/edenmendel/Documents/GitHub/jin",
    "current_date": "2026-03-25",
    "timezone": "America/New_York",
    "approval_policy": "never",
    "sandbox_policy": { "type": "read-only" },
    "model": "gpt-5.4",
    "personality": "pragmatic",
    "collaboration_mode": {
      "mode": "default",
      "settings": {
        "model": "gpt-5.4",
        "reasoning_effort": "xhigh",
        "developer_instructions": null
      }
    }
  }
}
```

### 2.4 Raw `function_call` + `function_call_output`

```json
{
  "timestamp": "2026-03-25T20:59:18.000Z",
  "type": "response_item",
  "payload": {
    "type": "function_call",
    "name": "exec_command",
    "arguments": "{\"cmd\":\"find src/adapters -maxdepth 1 -type f | sort\",\"workdir\":\"/Users/edenmendel/Documents/GitHub/jin\",\"yield_time_ms\":1000,\"max_output_tokens\":4000}",
    "call_id": "call_XU7iYq6KM4iMlOcgiznrBso7"
  }
}
```

```json
{
  "timestamp": "2026-03-25T20:59:19.000Z",
  "type": "response_item",
  "payload": {
    "type": "function_call_output",
    "call_id": "call_XU7iYq6KM4iMlOcgiznrBso7",
    "output": "Command: /bin/zsh -lc 'find src/adapters -maxdepth 1 -type f | sort'\nChunk ID: 947496\nWall time: 0.0000 seconds\nProcess exited with code 0\nOriginal token count: 70\nOutput:\nsrc/adapters/amp.ts\nsrc/adapters/claude-code.ts\nsrc/adapters/codex.ts\n..."
  }
}
```

### 2.5 Raw `token_count` Event

```json
{
  "timestamp": "2026-03-25T20:59:25.000Z",
  "type": "event_msg",
  "payload": {
    "type": "token_count",
    "info": {
      "total_token_usage": {
        "input_tokens": 32716,
        "cached_input_tokens": 29696,
        "output_tokens": 585,
        "reasoning_output_tokens": 268,
        "total_tokens": 33301
      },
      "last_token_usage": {
        "input_tokens": 11174,
        "cached_input_tokens": 10752,
        "output_tokens": 275,
        "reasoning_output_tokens": 138,
        "total_tokens": 11449
      },
      "model_context_window": 258400
    },
    "rate_limits": {
      "limit_id": "codex",
      "limit_name": null,
      "primary": {
        "used_percent": 2.0,
        "window_minutes": 300,
        "resets_at": 1774504009
      },
      "secondary": {
        "used_percent": 3.0,
        "window_minutes": 10080,
        "resets_at": 1774724455
      },
      "credits": null,
      "plan_type": "plus"
    }
  }
}
```

### 2.6 Raw `reasoning` Record (Encrypted)

```json
{
  "timestamp": "2026-03-25T20:59:16.000Z",
  "type": "response_item",
  "payload": {
    "type": "reasoning",
    "summary": [],
    "content": null,
    "encrypted_content": "gAAAAABpxITrkYJ56sMCr2tZ-57dLwRYCWQzTavAmshhT8JdVNTJBhHyPUDFVPhUsBkFRLxzUxDq..."
  }
}
```

Note: `content` is always `null`, `summary` is always `[]`, and the actual
reasoning is in `encrypted_content` (Fernet-encrypted, not recoverable).

### 2.7 Raw `custom_tool_call` + `custom_tool_call_output` (Desktop)

Desktop sessions use `custom_tool_call` instead of `function_call` for
IDE-integrated tools. Observed from a Desktop session (2026-03-28):

```json
{
  "timestamp": "2026-03-28T19:09:15.082Z",
  "type": "response_item",
  "payload": {
    "type": "custom_tool_call",
    "status": "completed",
    "call_id": "call_L5cHBm3o0Jw3Gf4Obvli0p9M",
    "name": "apply_patch",
    "input": "*** Begin Patch\n*** Update File: /Users/.../design-decisions.md\n@@\n ## Decided\n@@\n ### DEC-10: macOS launchd resource limits (Q28)\n...\n*** End Patch\n"
  }
}
```

```json
{
  "timestamp": "2026-03-28T19:09:15.201Z",
  "type": "response_item",
  "payload": {
    "type": "custom_tool_call_output",
    "call_id": "call_L5cHBm3o0Jw3Gf4Obvli0p9M",
    "output": "{\"output\":\"Success. Updated the following files:\\nM /Users/.../design-decisions.md\\n\",\"metadata\":{\"exit_code\":0,\"duration_seconds\":0.0}}"
  }
}
```

Key differences from CLI `function_call`:
- `input` field (raw string, e.g. unified diff) instead of `arguments` (JSON string)
- `status` field (`"completed"`)
- `output` is JSON with structured `metadata` (`exit_code`, `duration_seconds`)

### 2.8 Raw `compacted` Record

Observed from a 496-line Desktop session that hit context limits (2026-03-28,
5.1M cumulative input tokens):

```json
{
  "timestamp": "2026-03-28T21:07:18.902Z",
  "type": "compacted",
  "payload": {
    "message": "",
    "replacement_history": [
      {
        "type": "message",
        "role": "user",
        "content": [
          {
            "type": "input_text",
            "text": "we did a lot of digging within this project..."
          }
        ]
      },
      {
        "type": "message",
        "role": "assistant",
        "content": [
          {
            "type": "output_text",
            "text": "**Findings**\n1. High: the adapter boundary still..."
          }
        ]
      },
      // ... 36 more message items (condensed user/assistant pairs) ...
      {
        "type": "compaction",
        "encrypted_content": "gAAAAABpyEMGysVhbo45hcSD61zcWpc..."
      }
    ]
  }
}
```

**Key observations:**
- Record type is `compacted` (past tense), NOT `compaction` or `rollout_compaction`
- `replacement_history` contains 39 items: 38 condensed `message` items + 1 encrypted `compaction` summary
- The `message` field on the payload is empty string
- Each `message` in `replacement_history` has the same structure as `response_item:message` (`role`, `content[]`)
- The final `compaction` item has `encrypted_content` (Fernet) — the actual summary is not recoverable

### 2.9 Raw `context_compacted` Event (Companion)

Emitted alongside the `compacted` record:

```json
{
  "timestamp": "2026-03-28T21:07:18.904Z",
  "type": "event_msg",
  "payload": {
    "type": "context_compacted"
  }
}
```

Minimal payload — serves as a lifecycle marker.

### 2.10 Raw `turn_aborted` Event

Emitted when user interrupts a turn:

```json
{
  "timestamp": "2026-03-28T20:45:05.726Z",
  "type": "event_msg",
  "payload": {
    "type": "turn_aborted",
    "turn_id": "019d3631-0a9e-7ba0-a24b-f5c10c24eb21",
    "reason": "interrupted"
  }
}
```

### 2.11 Sequence Around Compaction Boundary

From the observed session, the records around the compaction point:

```
line 459: response_item:function_call_output  (last pre-compaction tool result)
line 460: response_item:function_call_output  (last pre-compaction tool result)
line 461: compacted                           (replacement_history: 39 items)
line 462: turn_context                        (new turn starts post-compaction)
line 463: event_msg:token_count               (5.1M cumulative input tokens)
line 464: event_msg:context_compacted          (companion lifecycle marker)
line 465: response_item:reasoning              (first post-compaction response)
line 466: event_msg:agent_message              (post-compaction assistant text)
line 467: response_item:message role=assistant  (post-compaction response)
```

### 2.12 Post-Compaction Message with `phase` Field

After compaction, assistant messages include a `phase` field:

```json
{
  "timestamp": "2026-03-28T21:10:09.923Z",
  "type": "response_item",
  "payload": {
    "type": "message",
    "role": "assistant",
    "content": [{ "type": "output_text", "text": "MARKER-FOR-CODEX-COMPACT-SESSION" }],
    "phase": "final_answer"
  }
}
```

The `event_msg:agent_message` companion also carries `phase` and `memory_citation`:

```json
{
  "type": "agent_message",
  "message": "MARKER-FOR-CODEX-COMPACT-SESSION",
  "phase": "final_answer",
  "memory_citation": null
}
```

---

## 3. Layer 3: Session Index

### 3.1 Raw Entry

```json
{"id":"019d279b-eabe-7481-b005-1089f954b3d0","thread_name":"Use sub-agents structure","updated_at":"2026-03-25T20:47:02.000Z"}
```

Note: Only Desktop (`source=vscode`) sessions appear in the index.

---

## 4. Normalized Jin Output

### 4.1 Expected Session Object

Given the raw data above, the adapter should produce:

```typescript
{
  id: "019d27a7-1649-73a2-abd0-0d411f7e9849",
  name: "[JIN-CODEX-TRACE-01] 🔍🦔 You are in a traced session...",
  adapterId: "codex",
  adapterName: "Codex",
  createdAt: "2026-03-26T00:59:14.893Z",
  updatedAt: "2026-03-26T01:00:25.000Z",
  durationMs: 70107,
  isActive: false,
  totalTokens: 33301,          // from token_count total_token_usage
  estCost: 0.42,               // calculated from model pricing
  messageCount: 5,
  sourcePath: "~/.codex/sessions/2026/03/25/rollout-...-019d27a7-....jsonl",
  isSubAgent: false,
  parentSessionId: "",
  isCompacted: false,
  metadata: {
    cwd: "/Users/edenmendel/Documents/GitHub/jin",
    source: "exec",             // NEW: from session_meta or threads table
    model: "gpt-5.4",          // NEW: from turn_context
    reasoningEffort: "xhigh",  // NEW: from turn_context
    gitBranch: "feat/rewrite-ontology",  // NEW: from threads table
    gitRemote: "https://github.com/mendeleden/jin.git",
    cliVersion: "0.117.0-alpha.12",
    sandboxPolicy: "read-only",
    approvalMode: "never",
  }
}
```

### 4.2 Expected Message Objects

**User message:**
```typescript
{
  id: "msg-0",
  role: "user",
  content: "[JIN-CODEX-TRACE-01] 🔍🦔 You are in a traced session...",
  timestamp: "2026-03-26T00:59:14.897Z",
  model: "",
  inputTokens: 10636,         // from last_token_usage on corresponding token_count
  outputTokens: 0,
  cacheRead: 9472,            // cached_input_tokens
  cacheWrite: 0,
  toolUses: [],
  thinkingBlocks: [],
  recordType: "message",
}
```

**Assistant message with tool calls:**
```typescript
{
  id: "msg-1",
  role: "assistant",
  content: "`src/adapters/` contains: `amp.ts`, `claude-code.ts`...",
  timestamp: "2026-03-26T00:59:25.000Z",
  model: "gpt-5.4",
  inputTokens: 11174,
  outputTokens: 275,
  cacheRead: 10752,
  cacheWrite: 0,
  toolUses: [
    {
      id: "call_XU7iYq6KM4iMlOcgiznrBso7",
      name: "exec_command",
      input: '{"cmd":"find src/adapters -maxdepth 1 -type f | sort","workdir":"..."}',
      output: "Command: /bin/zsh -lc ... Output:\nsrc/adapters/amp.ts\n...",
    }
  ],
  thinkingBlocks: [
    {
      content: "[encrypted]",  // reasoning is not recoverable
      tokenCount: 138,         // reasoning_output_tokens from token_count
    }
  ],
  recordType: "message",
}
```

---

## 5. CLI `exec --json` Event Stream

### 5.1 Full Event Stream (single turn, 2 tool calls)

```jsonl
{"type":"thread.started","thread_id":"019d27a7-1649-73a2-abd0-0d411f7e9849"}
{"type":"turn.started"}
{"type":"item.started","item":{"id":"item_0","type":"agent_message"}}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Inspecting `src/adapters/` first..."}}
{"type":"item.started","item":{"id":"item_1","type":"command_execution"}}
{"type":"item.completed","item":{"id":"item_1","type":"command_execution"}}
{"type":"item.started","item":{"id":"item_2","type":"agent_message"}}
{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"`src/adapters/` contains: ..."}}
{"type":"item.started","item":{"id":"item_3","type":"command_execution"}}
{"type":"item.completed","item":{"id":"item_3","type":"command_execution"}}
{"type":"turn.completed","usage":{"input_tokens":32716,"cached_input_tokens":29696,"output_tokens":585}}
```

### 5.2 Event Type Reference

| Stream event | Persisted in JSONL as | Notes |
|---|---|---|
| `thread.started` | `session_meta` | Thread ID |
| `turn.started` | `event_msg:task_started` + `turn_context` | |
| `item.completed` (agent_message) | `response_item:message` (role=assistant) + `event_msg:agent_message` | |
| `item.completed` (command_execution) | `response_item:function_call` + `response_item:function_call_output` | CLI sessions |
| `item.completed` (command_execution) | `response_item:custom_tool_call` + `response_item:custom_tool_call_output` | Desktop sessions |
| `turn.completed` | `event_msg:task_complete` + `event_msg:token_count` | Usage data |
| (user interrupts) | `event_msg:turn_aborted` | Includes `turn_id` and `reason` |
| (context compacted) | `compacted` + `event_msg:context_compacted` | `replacement_history` array |

---

## 6. Sub-Agent Data (Observed 2026-03-28)

A Desktop session spawned 5 sub-agents simultaneously. Each sub-agent
got its own JSONL file in the same `sessions/YYYY/MM/DD/` directory.

### 6.1 Parent `spawn_agent` Call

```json
{
  "timestamp": "2026-03-28T21:58:39.123Z",
  "type": "response_item",
  "payload": {
    "type": "function_call",
    "name": "spawn_agent",
    "call_id": "call_MdxGRTsh6H6RF1wXYZ",
    "arguments": "{\"agent_type\":\"explorer\",\"model\":\"gpt-5.4-mini\",\"reasoning_effort\":\"high\",\"fork_context\":true,\"message\":\"Act as a distributed systems architect reviewing...\"}"
  }
}
```

### 6.2 Parent `spawn_agent` Output (Agent ID + Nickname)

```json
{
  "timestamp": "2026-03-28T21:58:40.001Z",
  "type": "response_item",
  "payload": {
    "type": "function_call_output",
    "call_id": "call_MdxGRTsh6H6RF1wXYZ",
    "output": "{\"agent_id\":\"019d3674-d5ef-7121-9cbb-9fe5fd981865\",\"nickname\":\"Dirac\"}"
  }
}
```

### 6.3 Parent `wait_agent` Call (Join All Sub-Agents)

```json
{
  "timestamp": "2026-03-28T21:58:45.000Z",
  "type": "response_item",
  "payload": {
    "type": "function_call",
    "name": "wait_agent",
    "call_id": "call_0JfUzUCN0nTLNsp",
    "arguments": "{\"targets\":[\"019d3674-d5ef-7121-9cbb-9fe5fd981865\",\"019d3674-d69b-7242-9027-712ed2b570d6\",\"019d3674-d6b7-7f23-a188-dc58b86d9485\",\"019d3674-d6d5-74d0-82bd-9d3b8d3464b8\",\"019d3674-d702-78f1-9a3e-cbf301f2bbd1\"]}"
  }
}
```

### 6.4 Sub-Agent `session_meta` (First — With Spawn Metadata)

```json
{
  "timestamp": "2026-03-28T21:58:39.867Z",
  "type": "session_meta",
  "payload": {
    "id": "019d3674-d5ef-7121-9cbb-9fe5fd981865",
    "forked_from_id": "019d35be-a638-77d1-abe9-f723fdc5b47d",
    "cwd": "/Users/edenmendel/Documents/GitHub/jin",
    "originator": "Codex Desktop",
    "cli_version": "0.118.0-alpha.2",
    "source": {
      "subagent": {
        "thread_spawn": {
          "parent_thread_id": "019d35be-a638-77d1-abe9-f723fdc5b47d",
          "depth": 1,
          "agent_path": null,
          "agent_nickname": "Dirac",
          "agent_role": "explorer"
        }
      }
    },
    "agent_nickname": "Dirac",
    "agent_role": "explorer",
    "model_provider": "openai"
  }
}
```

### 6.5 Sub-Agent `session_meta` (Second — Post-Compaction, Parent Context)

After compaction, sub-agents re-emit `session_meta` with the **parent's** ID
and `source: "vscode"` (no sub-agent metadata). This appears to restore
parent context:

```json
{
  "timestamp": "2026-03-28T22:30:15.000Z",
  "type": "session_meta",
  "payload": {
    "id": "019d35be-a638-77d1-abe9-f723fdc5b47d",
    "forked_from_id": "",
    "source": "vscode",
    "agent_nickname": "",
    "agent_role": ""
  }
}
```

### 6.6 Sub-Agent `web_search_call` (New Record Type)

```json
{
  "timestamp": "2026-03-28T22:00:13.780Z",
  "type": "response_item",
  "payload": {
    "type": "web_search_call",
    "status": "completed"
  }
}
```

### 6.7 Observed Sub-Agent Statistics

All 5 sub-agents from the same parent session:

| Nickname | Role | Lines | function_calls | custom_tool_calls | Compacted | web_search |
|----------|------|-------|----------------|-------------------|-----------|------------|
| Dirac | explorer | 781 | 138 | 4 | yes | 1 |
| Kant | explorer | 758 | 135 | 4 | yes | 0 |
| Mill | explorer | 716 | 124 | 4 | yes | 0 |
| Carver | explorer | 739 | 130 | 4 | yes | 0 |
| Bernoulli | explorer | 762 | 134 | 4 | yes | 0 |

**Key observations:**
- All sub-agents had both `function_call` (CLI tools) and `custom_tool_call`
  (Desktop tools), confirming Desktop sessions mix both types
- All 5 sub-agents hit compaction (each ~700+ lines of JSONL)
- All had exactly 4 `custom_tool_call` records each
- Each had 1 `turn_aborted` event
- Dirac was the only one with a `web_search_call`

---

## 7. Record Type Census (All Observed Sessions)

From 8 sessions across CLI + Desktop (2026-02 through 2026-03):

| Record Type | Count | Source |
|-------------|-------|--------|
| `response_item:function_call` | 85 | CLI |
| `response_item:function_call_output` | 85 | CLI |
| `event_msg:token_count` | 82 | Both |
| `response_item:message` | 81 | Both |
| `response_item:reasoning` | 56 | Both |
| `event_msg:agent_message` | 51 | Both |
| `turn_context` | 26 | Both |
| `event_msg:task_started` | 25 | Both |
| `event_msg:user_message` | 25 | Both |
| `event_msg:task_complete` | 23 | Both |
| `response_item:custom_tool_call` | 3 | Desktop |
| `response_item:custom_tool_call_output` | 3 | Desktop |
| `session_meta` | 8 | Both |
| `compacted` | 1 | Desktop |
| `event_msg:context_compacted` | 1 | Desktop |
| `event_msg:turn_aborted` | 1 | Desktop |

---

## Cross-References

- [overview.md](./overview.md) — Storage architecture and data models
- [investigation.md](./investigation.md) — Forensics log for layer discovery
- [orchestration.md](./orchestration.md) — CLI exec/resume experiment
- [index.md](./index.md) — Coverage gap summary
