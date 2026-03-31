# Codex Storage Architecture

**Scope:** Complete map of where Codex stores conversation data on disk, what
each storage location contains, and how layers relate to each other.

**Codex version investigated:** `codex-cli 0.117.0-alpha.12` (Desktop:
`Codex.app`, macOS arm64, 2026-03-25)

---

## Architecture Overview

```
Codex (Desktop + CLI share the same storage)
  |
  +-- Layer 1: ~/.codex/state_5.sqlite                Thread metadata DB
  |     Tables: threads, logs, thread_dynamic_tools,
  |             stage1_outputs, agent_jobs, jobs
  |     Written by: Desktop (vscode) + CLI (exec)
  |
  +-- Layer 2: ~/.codex/sessions/YYYY/MM/DD/           Session rollouts
  |     rollout-<timestamp>-<thread-id>.jsonl
  |     RolloutLine envelope: {timestamp, type, payload}
  |     Written by: Desktop + CLI (identical format)
  |
  +-- Layer 3: ~/.codex/session_index.jsonl            Quick lookup index
  |     Written by: Desktop only
  |
  +-- Layer 4: ~/.codex/sqlite/codex-dev.db            Automations
  |     Tables: automations, automation_runs, inbox_items
  |
  +-- Layer 5: ~/.codex/.codex-global-state.json       Electron state
  |
  +-- Layer 6: ~/.codex/shell_snapshots/<id>.sh        Shell env captures
  |
  +-- Layer 7: ~/.codex/archived_sessions/             Old rollout files
```

**vs Cursor:** Cursor splits storage into 4 incompatible layers where CLI and
IDE use completely different formats. Codex unifies everything — Desktop and
CLI write to the same two primary stores (Layer 1 + 2) with identical formats.

---

## Layer 1: Thread Metadata (`state_5.sqlite`)

### Location

| Platform | Path |
|----------|------|
| macOS | `~/.codex/state_5.sqlite` |
| Linux | `~/.codex/state_5.sqlite` |
| Windows (native) | `%USERPROFILE%\.codex\state_5.sqlite` |
| Windows (WSL) | `~/.codex/state_5.sqlite` (Linux home, NOT shared with Windows Desktop) |

All paths are overrideable via the `CODEX_HOME` environment variable. If set,
replace `~/.codex` with `$CODEX_HOME` in all paths throughout this document.

**Pending verification:** Linux and Windows paths are inferred from the
`CODEX_HOME` convention. See [investigation.md Cross-Platform Reproduction
Guide](./investigation.md#cross-platform-reproduction-guide) for verification
checklist.

### Schema: `threads` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUIDv7 thread identifier |
| `rollout_path` | TEXT | Relative path to JSONL file |
| `created_at` | INTEGER | Epoch timestamp |
| `updated_at` | INTEGER | Epoch timestamp |
| `source` | TEXT | `"exec"` (CLI) or `"vscode"` (Desktop) |
| `model_provider` | TEXT | `"openai"` |
| `cwd` | TEXT | Working directory |
| `title` | TEXT | Thread title (often = first user message) |
| `sandbox_policy` | TEXT | Sandbox mode used |
| `approval_mode` | TEXT | `"never"`, `"on-request"`, `"untrusted"` |
| `tokens_used` | INTEGER | Cumulative token count |
| `has_user_event` | INTEGER | Whether user interacted |
| `archived` | INTEGER | 0 or 1 |
| `git_sha` | TEXT | Git HEAD at session start |
| `git_branch` | TEXT | Git branch name |
| `git_origin_url` | TEXT | Git remote URL |
| `cli_version` | TEXT | e.g. `"0.117.0-alpha.12"` |
| `first_user_message` | TEXT | First user prompt (full text) |
| `agent_nickname` | TEXT | Custom agent name |
| `agent_role` | TEXT | Custom agent role |
| `memory_mode` | TEXT | `"enabled"` or `"disabled"` |

### Schema: `thread_dynamic_tools` Table

Desktop sessions register tools that are available to the agent:

| Column | Type | Description |
|--------|------|-------------|
| `thread_id` | TEXT | FK to threads |
| `position` | INTEGER | Tool ordering |
| `name` | TEXT | e.g. `"read_thread_terminal"` |
| `description` | TEXT | Tool description |
| `input_schema` | TEXT | JSON Schema for args |

### Schema: Other Tables

| Table | Purpose | Row count (observed) |
|-------|---------|---------------------|
| `logs` | Application debug logs (NOT conversations) | 60,970 |
| `stage1_outputs` | Memory extraction pipeline | 0 |
| `agent_jobs` / `agent_job_items` | Batch agent processing | 0 |
| `jobs` | Internal job queue | varies |
| `backfill_state` | Migration state | 1 |

### Jin Mapping (v2 ontology)

| state_5.sqlite field | v2 Entity.Field | Notes |
|---------------------|-----------------|-------|
| `threads.id` | `Conversation.id` | UUIDv7 |
| `threads.title` | `Conversation.name` | |
| `threads.cwd` | `Conversation.metadata.cwd` | |
| `threads.source` | `Conversation.metadata.source` | `exec` or `vscode` |
| `threads.model_provider` | `Conversation.metadata.provider` | Always `openai` |
| `threads.tokens_used` | `Conversation.total_tokens` | Cumulative |
| `threads.created_at` | `Conversation.started_at` | Epoch → ISO 8601 |
| `threads.updated_at` | `Conversation.ended_at` | Epoch → ISO 8601 |
| `threads.git_branch` | `Conversation.metadata.git_branch` | |
| `threads.git_origin_url` | `Conversation.metadata.git_remote` | |
| `threads.git_sha` | `Conversation.metadata.git_sha` | |
| `threads.cli_version` | `Conversation.metadata.cli_version` | |
| `threads.approval_mode` | `Conversation.metadata.approval_mode` | |
| `threads.sandbox_policy` | `Conversation.metadata.sandbox_policy` | |

---

## Layer 2: Session Rollouts (JSONL)

### Location

```
~/.codex/sessions/YYYY/MM/DD/rollout-<ISO-timestamp>-<thread-id>.jsonl
```

### Envelope Format

Every line follows the `RolloutLine` structure:

```json
{"timestamp": "2026-03-25T20:59:14.893Z", "type": "<record_type>", "payload": { ... }}
```

### Record Types

| type | payload.type (if applicable) | Frequency per turn | Contains |
|------|-----|---------|----------|
| `session_meta` | — | 1 per session | Thread ID, cwd, originator, cli_version, source, model_provider, base_instructions |
| `turn_context` | — | 1 per turn | turn_id, model, reasoning_effort, sandbox_policy, approval_policy, collaboration_mode |
| `response_item` | `message` (role=user) | 1 per turn | User prompt in `content[].text` (type=`input_text`). Post-compaction messages may include `phase` field. |
| `response_item` | `message` (role=assistant) | 1+ per turn | Response text in `content[].text` (type=`output_text`). May include `"phase": "final_answer"`. |
| `response_item` | `message` (role=developer) | 0-1 per session | System prompt / skill instructions |
| `response_item` | `function_call` | 0+ per turn | Tool name, arguments (JSON string), call_id. **CLI sessions only.** |
| `response_item` | `function_call_output` | 0+ per turn | call_id, full output text. **CLI sessions only.** |
| `response_item` | `custom_tool_call` | 0+ per turn | **Desktop sessions only.** IDE-integrated tools (e.g. `apply_patch`). Has `status`, `call_id`, `name`, `input`. |
| `response_item` | `custom_tool_call_output` | 0+ per turn | **Desktop sessions only.** Result for custom tools. Has `call_id`, `output` (JSON with `exit_code`, `duration_seconds`). |
| `response_item` | `reasoning` | 1+ per turn | **Encrypted** — `encrypted_content` field, `summary` always empty |
| `response_item` | `web_search_call` | 0+ per turn | Web search. Has `status` (`"completed"`). Minimal payload — results in subsequent message. |
| `event_msg` | `token_count` | 1+ per turn | total_token_usage, last_token_usage, rate_limits, model_context_window |
| `event_msg` | `user_message` | 1 per turn | Duplicate of user prompt text |
| `event_msg` | `agent_message` | 1+ per turn | Duplicate of assistant text. May include `"phase": "final_answer"` and `"memory_citation"`. |
| `event_msg` | `task_started` | 1 per turn | Lifecycle marker |
| `event_msg` | `task_complete` | 1 per turn | Lifecycle marker. Includes `turn_id` and `last_agent_message`. |
| `event_msg` | `turn_aborted` | 0-1 per turn | User interrupted the turn. Has `turn_id`, `reason` (e.g. `"interrupted"`). |
| `event_msg` | `context_compacted` | 0+ per session | Companion event emitted alongside `compacted` record. Minimal payload. |
| `compacted` | — | 0+ per session | Context compaction event (see Compaction section below) |

### Data Model: `token_count` Event

The richest single record type — contains both per-turn and cumulative usage:

| Field | Description |
|-------|-------------|
| `info.total_token_usage.input_tokens` | Cumulative input tokens for entire session |
| `info.total_token_usage.cached_input_tokens` | Cumulative cache hits |
| `info.total_token_usage.output_tokens` | Cumulative output tokens |
| `info.total_token_usage.reasoning_output_tokens` | Cumulative reasoning tokens (separate) |
| `info.total_token_usage.total_tokens` | Sum of all token types |
| `info.last_token_usage.*` | Same fields but for last API call only |
| `info.model_context_window` | Context window size (258,400 for GPT-5.4) |
| `rate_limits.primary.used_percent` | Primary rate limit usage % |
| `rate_limits.secondary.used_percent` | Secondary rate limit usage % |
| `rate_limits.plan_type` | `"plus"`, `"pro"`, etc. |

### Data Model: `function_call` / `function_call_output` (CLI)

| Field | Description |
|-------|-------------|
| `name` | Tool name (e.g. `exec_command`) |
| `arguments` | JSON string with tool args (e.g. `{"cmd":"...","workdir":"..."}`) |
| `call_id` | Unique ID linking call to output |
| `output` | Full tool output text (in `function_call_output`) |

### Data Model: `custom_tool_call` / `custom_tool_call_output` (Desktop)

Desktop sessions use `custom_tool_call` instead of `function_call` for
IDE-integrated tools. The schema differs slightly:

| Field | Description |
|-------|-------------|
| `name` | Tool name (e.g. `apply_patch`) |
| `input` | Raw input string (not JSON — e.g. unified diff for `apply_patch`) |
| `call_id` | Unique ID linking call to output |
| `status` | `"completed"` (observed) |
| `output` | JSON string: `{"output": "...", "metadata": {"exit_code": 0, "duration_seconds": 0.0}}` (in `custom_tool_call_output`) |

**Key difference from `function_call`:** CLI tools use `arguments` (JSON string),
Desktop tools use `input` (raw string, often a patch/diff). The output structure
also differs — `custom_tool_call_output.output` is a JSON string containing
both the result and structured metadata.

### Data Model: Compaction (`compacted`)

**Note:** Our earlier docs listed `compaction` and `rollout_compaction` as
expected types. The actual observed record type is **`compacted`** (past tense).

When Codex compacts context, it emits a `compacted` record containing
`replacement_history` — the condensed conversation that replaces pre-compaction
context. This is fundamentally different from Claude Code's compaction (which
emits a boundary marker + summary injected as a user message).

| Field | Description |
|-------|-------------|
| `message` | Empty string (observed) |
| `replacement_history` | Array of items representing the condensed conversation |

**`replacement_history` item types:**

| type | Description |
|------|-------------|
| `message` | Condensed user/assistant message pair. Same structure as `response_item:message` — has `role`, `content[]` blocks. |
| `compaction` | Encrypted compaction summary. Has `encrypted_content` (Fernet), `content: null`. Appears as the last item. |

**Sequence around compaction boundary (observed):**

```
line N:   response_item:function_call_output  (last pre-compaction turn)
line N+1: compacted                           (replacement_history with condensed messages)
line N+2: turn_context                        (new turn starts post-compaction)
line N+3: event_msg:token_count               (cumulative token count at boundary)
line N+4: event_msg:context_compacted          (companion event, minimal payload)
line N+5: response_item:reasoning              (first post-compaction response)
```

**Jin v2 implications:** Unlike Claude Code where compaction creates two linked
Conversations (original + continuation), Codex keeps everything in one JSONL
file. The adapter could either:
1. Treat the `compacted` record as a boundary and split into linked
   Conversations (consistent with Claude Code handling)
2. Treat it as a single Conversation with a compaction marker (simpler,
   since the replacement_history preserves context continuity)

Option 1 is recommended for consistency with the v2 ontology.

### Data Model: Sub-Agents (`spawn_agent` / `wait_agent`)

**Verified 2026-03-28** from a Desktop session that spawned 5 sub-agents.

Codex sub-agents are spawned via `function_call` with `name: "spawn_agent"` in
the **parent** session's JSONL. Each sub-agent gets its own JSONL file in the
same `sessions/YYYY/MM/DD/` directory (not a subdirectory like Claude Code's
`subagents/`).

**Parent session — spawn:**

```json
{
  "type": "response_item",
  "payload": {
    "type": "function_call",
    "name": "spawn_agent",
    "call_id": "call_MdxGRTsh6H6RF1w...",
    "arguments": "{\"agent_type\":\"explorer\",\"model\":\"gpt-5.4-mini\",\"reasoning_effort\":\"high\",\"fork_context\":true,\"message\":\"Act as a distributed systems architect...\"}"
  }
}
```

**Parent session — spawn result:**

```json
{
  "type": "response_item",
  "payload": {
    "type": "function_call_output",
    "call_id": "call_MdxGRTsh6H6RF1w...",
    "output": "{\"agent_id\":\"019d3674-d5ef-7121-9cbb-9fe5fd981865\",\"nickname\":\"Dirac\"}"
  }
}
```

**Parent session — wait for results:**

```json
{
  "type": "response_item",
  "payload": {
    "type": "function_call",
    "name": "wait_agent",
    "arguments": "{\"targets\":[\"019d3674-d5ef...\",\"019d3674-d69b...\",...]}"
  }
}
```

**Sub-agent session — `session_meta.source` structure:**

```json
{
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
  "forked_from_id": "019d35be-a638-77d1-abe9-f723fdc5b47d",
  "agent_nickname": "Dirac",
  "agent_role": "explorer"
}
```

**Sub-agent `session_meta` has a second entry** — post-compaction, sub-agents
re-emit `session_meta` with the **parent's** `id` and `source: "vscode"` (no
sub-agent metadata). This appears to be how Codex restores parent context
after a sub-agent compacts.

**Key observations:**

| Property | Value |
|----------|-------|
| Spawn mechanism | `function_call` with `name: "spawn_agent"` |
| Wait mechanism | `function_call` with `name: "wait_agent"`, targets = array of agent IDs |
| Agent ID | UUIDv7 in `function_call_output.output.agent_id` |
| Agent nickname | Auto-generated (Dirac, Kant, Mill, Carver, Bernoulli) |
| Agent role | From `agent_type` argument (observed: `"explorer"`) |
| File location | Same `sessions/YYYY/MM/DD/` dir as parent (NOT a subdirectory) |
| `forked_from_id` | Parent thread ID — present on sub-agent `session_meta` |
| Depth | `thread_spawn.depth` = 1 (depth-2+ sub-agents not yet observed) |
| `fork_context` | When `true`, sub-agent receives parent's conversation context |
| Sub-agent compaction | Sub-agents also compact (all 5 had `compacted` records) |
| Sub-agent tool calls | Sub-agents use both `function_call` (CLI tools) and `custom_tool_call` (Desktop tools) |

**New record type: `web_search_call`**

One sub-agent (Dirac) had a `response_item:web_search_call` record:

```json
{"type": "web_search_call", "status": "completed"}
```

Minimal payload — the search results are presumably in a subsequent message.

**Jin v2 mapping:**

| Source | v2 Field |
|--------|----------|
| `spawn_agent` function_call in parent | Detect sub-agent creation |
| `function_call_output.output.agent_id` | `Conversation.id` for sub-agent |
| `session_meta.forked_from_id` | `Conversation.parent_id` |
| `session_meta.source.subagent.thread_spawn.parent_thread_id` | Same as `forked_from_id` |
| `session_meta.agent_nickname` | `Conversation.metadata.agent_nickname` |
| `session_meta.agent_role` | `Conversation.metadata.agent_role` |
| `thread_spawn.depth` | `Conversation.metadata.agent_depth` |
| All sub-agents in same trace | `Conversation.trace_id` = parent's `trace_id` |
| `relationship` | `spawned` |

### Jin Mapping (v2 ontology)

| JSONL field | v2 Entity.Field | Notes |
|------------|-----------------|-------|
| `session_meta.id` | `Conversation.id` | |
| `turn_context.model` | `Message.model` | e.g. `"gpt-5.4"` |
| `response_item[message,user].content` | `Message.content` | Concatenate `input_text` blocks |
| `response_item[message,assistant].content` | `Message.content` | Concatenate `output_text` blocks |
| `response_item[function_call]` | `ToolCall.name`, `.input` | CLI sessions |
| `response_item[function_call_output]` | `ToolCall.output` | Link via `call_id` (CLI sessions) |
| `response_item[custom_tool_call]` | `ToolCall.name`, `.input` | Desktop sessions — `input` field (not `arguments`) |
| `response_item[custom_tool_call_output]` | `ToolCall.output` | Link via `call_id` (Desktop sessions) — parse JSON for output text |
| `compacted.replacement_history` | Creates linked `relationship='compacted'` conversation | Boundary detection — split pre/post compaction |
| `event_msg[token_count].last_token_usage` | `Message.inputTokens`, `.outputTokens` | Per-turn breakdown |
| `event_msg[token_count].total_token_usage` | `Conversation.total_tokens` | Session cumulative |
| `event_msg[turn_aborted]` | Mark turn as incomplete | `reason` field indicates why (e.g. `"interrupted"`) |
| `session_meta.source.subagent` | `Conversation.relationship = 'spawned'` | Sub-agent detection |
| `session_meta.forked_from_id` | `Conversation.parent_id` | Parent thread reference |
| `session_meta.agent_nickname` | `Conversation.metadata.agent_nickname` | Auto-generated name (Dirac, Kant, etc.) |
| `session_meta.agent_role` | `Conversation.metadata.agent_role` | e.g. `"explorer"` |
| `function_call[spawn_agent]` | `ToolCall` + sub-agent Conversation linkage | Parent-side spawn record |
| `function_call[wait_agent]` | `ToolCall` (targets = sub-agent IDs) | Parent-side wait/join |
| `function_call_output[spawn_agent].agent_id` | Sub-agent `Conversation.id` | Cross-reference to sub-agent JSONL |
| `response_item[web_search_call]` | `ToolCall` (name=`web_search`) | Minimal payload, results in next message |
| `timestamp` (envelope) | `Message.timestamp` | Real per-record ISO 8601 |

---

## Layer Relationships and Recommended Strategy

### How Layers Overlap

```
                    Desktop (vscode)   CLI exec    CLI exec --ephemeral
Layer 1 (SQLite)       Yes               Yes          No
Layer 2 (JSONL)        Yes               Yes          No
Layer 3 (Index)        Yes               No           No
Layer 4 (Automation)   If automation     No           No
Layer 5 (Global)       Yes               No           No
Layer 6 (Snapshots)    Sometimes         No           No
Layer 7 (Archive)      If archived       If archived  No
```

### ID Correlation

- `threads.id` (Layer 1) = `session_meta.id` (Layer 2) = filename UUID in JSONL path
- `threads.rollout_path` (Layer 1) points to the Layer 2 JSONL file
- `automation_runs.thread_id` (Layer 4) = `threads.id` (Layer 1)
- Shell snapshot filename (Layer 6) = `threads.id` (Layer 1)

### Recommended Adapter Strategy

Unlike Cursor (which needs 3 separate read strategies), Codex needs only one:

1. **Primary: Layer 2 (JSONL rollouts)** — Contains everything: messages, tool
   calls, token counts, turn context, timestamps. Both Desktop and CLI write
   here with identical format.
2. **Enrich: Layer 1 (`state_5.sqlite`)** — Adds git metadata, source type,
   approval mode, and cumulative token count. Also useful for listing sessions
   without parsing every JSONL file.
3. **Include: Layer 7 (archived sessions)** — Same format as Layer 2, just in
   a different directory.
4. **Defer: Layers 3-6** — Low priority for conversation ingestion.

### What the Adapter Should Fix

The current adapter (`src/adapters/codex.ts`) reads Layer 2 but misses:

| Gap | Fix |
|-----|-----|
| `token_count` events ignored | Parse `event_msg` with `payload.type === "token_count"` |
| `turn_context` ignored | Extract `model`, `reasoning_effort`, `sandbox_policy` |
| No Layer 1 reads | Query `threads` for git metadata, source, approval_mode |
| `reasoning` blocks noted but empty | Content is encrypted — mark as `[encrypted]` |
| Archived sessions not scanned | Add `~/.codex/archived_sessions/` to `findAllSessionFiles()` |
| `developer` role messages mixed in | Filter or tag as `system` role |
| `custom_tool_call` not handled | Desktop tool calls use different schema than CLI `function_call` — need unified ToolCall mapping |
| `compacted` records not handled | Detect compaction boundary, split into linked Conversations, parse `replacement_history` |
| `turn_aborted` events ignored | Mark interrupted turns, exclude from turn count or flag as incomplete |
| `phase` field on messages ignored | Post-compaction messages may carry `"phase": "final_answer"` — capture in metadata |
| Sub-agent sessions not linked | `session_meta.source.subagent` + `forked_from_id` provide full parent→child linkage |
| `spawn_agent`/`wait_agent` not detected | These function_calls in parent session create and join sub-agents — detect for relationship mapping |
| `web_search_call` not handled | New tool call type with minimal payload — map to ToolCall |
| Sub-agent files not correlated | Sub-agent JSONLs live in same `sessions/YYYY/MM/DD/` dir (not a subdirectory) — match via `forked_from_id` or `spawn_agent` output `agent_id` |

---

## Cross-References

- [index.md](./index.md) — Coverage gap summary
- [investigation.md](./investigation.md) — How these layers were discovered
- [examples.md](./examples.md) — Real data from each layer
- [orchestration.md](./orchestration.md) — CLI exec, resume, SDK, MCP server
