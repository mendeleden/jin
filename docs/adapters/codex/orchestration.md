# Codex Orchestration & Traceability

**Scope:** How to programmatically drive Codex agent sessions and trace those
sessions through all storage layers. Findings from Claude Code driving Codex
via CLI `exec --json`, `exec resume`, and Desktop GUI verification.

**Date:** 2026-03-25
**Codex version:** `codex-cli 0.117.0-alpha.12` (Desktop: `Codex.app`)
**Investigator:** Claude Code (Opus 4.6) driving Codex CLI + Eden Mendel
driving Desktop GUI

---

## 1. Orchestration Interfaces

Codex exposes five programmatic interfaces for driving agent sessions:

| Interface | Transport | Multi-turn | Persistent | Layers hit |
|-----------|-----------|------------|------------|------------|
| `codex exec --json` | CLI stdio (JSONL stream) | Via `exec resume` | Yes (Layer 1+2) | 1, 2 |
| `codex exec --ephemeral` | CLI stdio | No | **No** (nothing written) | None |
| `@openai/codex-sdk` | TypeScript library | Yes (`thread.run()`) | Yes | 1, 2 |
| `codex mcp-server` | MCP over stdio | Via MCP protocol | Yes | 1, 2 |
| Desktop app (GUI) | Electron UI | Yes | Yes (all layers) | 1, 2, 3, 5 |

### 1.1 CLI `exec --json` (Primary for orchestration)

The most capable non-interactive interface. Spawns a single-turn session and
streams JSONL events to stdout.

```bash
codex exec --json --sandbox read-only -C /path/to/project "your prompt here"
```

Key flags:
- `--json` — JSONL event stream on stdout
- `--sandbox read-only|workspace-write|danger-full-access` — sandbox policy
- `-C <dir>` — working directory
- `--ephemeral` — don't persist session to disk
- `--model <model>` — override model
- `--output-schema <file>` — enforce JSON Schema on final response
- `-o <file>` — write final message to file

**Event types returned:**

| `type` | Contains |
|--------|----------|
| `thread.started` | `thread_id` |
| `turn.started` | Lifecycle marker |
| `item.started` | `item.id`, `item.type` |
| `item.completed` | `item.id`, `item.type`, `item.text` (for messages) |
| `turn.completed` | `usage` with `input_tokens`, `output_tokens`, `cached_input_tokens` |

Item types: `agent_message`, `command_execution`, `file_read`, `file_change`,
`mcp_tool_call`, `web_search`, `plan_update`.

### 1.2 CLI `exec resume` (Multi-turn)

Resume a previous session with a new prompt:

```bash
codex exec resume --json <thread-id> "follow-up prompt"
```

Verified behavior:
- Appends new records to the same JSONL rollout file
- Updates `threads.tokens_used` and `threads.updated_at` in SQLite
- Agent has full context from prior turns
- `thread.started` event reuses the same `thread_id`

**Caveat:** `--sandbox` is not valid for the `resume` subcommand — it inherits
the sandbox policy from the original session.

### 1.3 CLI `exec --ephemeral`

```bash
codex exec --json --ephemeral "say ACK"
```

Verified: returns events on stdout but writes **nothing** to disk — no SQLite
row, no JSONL file, no index entry.

### 1.4 TypeScript SDK

```bash
npm install @openai/codex-sdk
```

```typescript
import { Codex } from "@openai/codex-sdk";

const codex = new Codex();
const thread = codex.startThread();
const result = await thread.run("your prompt");

// Multi-turn
const result2 = await thread.run("follow-up");

// Resume from ID
const thread2 = codex.resumeThread("<thread-id>");
```

More flexible than CLI exec — supports persistent multi-turn without
separate process invocations.

### 1.5 MCP Server

```bash
codex mcp-server
```

Runs Codex as an MCP server over stdio. Other tools (including the OpenAI
Agents SDK) can connect and drive sessions via MCP protocol.

### 1.6 Desktop GUI (AppleScript)

For macOS, the Desktop app can be driven via AppleScript (same pattern as
Cursor investigation):

```applescript
tell application "Codex" to activate
delay 1
tell application "System Events"
  tell process "Codex"
    keystroke "your prompt here"
    keystroke return
  end tell
end tell
```

This is the only method that writes to Layer 3 (`session_index.jsonl`) and
Layer 5 (global state).

---

## 2. Traceability Experiment

### 2.1 Method

We ran a multi-phase experiment with identifiable markers in every prompt:
- Tag: `[JIN-CODEX-TRACE-XX]` (XX = 01 through 04)
- Emoji pair: `🔍🦔` (unique, grep-able)
- Desktop markers: `[JIN-DESKTOP-TEST-XX]` with `🦊🔬`

### 2.2 Phases

| Phase | Method | Prompt tag | Thread ID |
|-------|--------|-----------|-----------|
| 1 | `codex exec --json` | `[JIN-CODEX-TRACE-01]` | `019d27a7-1649-73a2-abd0-0d411f7e9849` |
| 2 | `codex exec resume` | `[JIN-CODEX-TRACE-02]` | Same as Phase 1 |
| 3 | `codex exec --ephemeral` | `[JIN-CODEX-TRACE-03]` | `019d27a7-66b2-...` (ephemeral) |
| 4 | `codex exec --json` (tool calls) | `[JIN-CODEX-TRACE-04]` | `019d27a7-7a90-...` |
| 5 | Desktop GUI (3 prompts) | `[JIN-DESKTOP-TEST-01/02/03]` | `019d279b-eabe-...` |

### 2.3 Where Each Phase Appeared

| Phase | Layer 1 (SQLite) | Layer 2 (JSONL) | Layer 3 (Index) |
|-------|-----------------|-----------------|-----------------|
| 1 (exec) | **YES** (`source=exec`) | **YES** (25 lines) | No |
| 2 (resume) | Updated (tokens grew) | **YES** (appended to 35 lines) | No |
| 3 (ephemeral) | **No** | **No** | No |
| 4 (exec + tools) | **YES** (`source=exec`) | **YES** (21 lines) | No |
| 5 (Desktop) | **YES** (`source=vscode`) | **YES** (48 lines) | **YES** |

### 2.4 Pre/Post Storage Diff

```
  Threads:       5 → 7 (+2)     # Phase 1 + Phase 4 (ephemeral didn't persist)
  Session files: 4 → 6 (+2)
  Index entries: 4 → 4 (+0)     # CLI exec doesn't write to index
```

### 2.5 Marker Recovery

All markers were recoverable from storage:

```bash
# CLI markers in JSONL
grep -c "JIN-CODEX-TRACE" ~/.codex/sessions/2026/03/25/rollout-*019d27a7-1649*.jsonl
# 4 hits (2 per prompt: response_item + event_msg)

# Desktop markers in JSONL
grep -c "JIN-DESKTOP-TEST" ~/.codex/sessions/2026/03/25/rollout-*019d279b*.jsonl
# 6 hits (2 per prompt x 3 prompts)

# CLI markers in SQLite
sqlite3 ~/.codex/state_5.sqlite "SELECT count(*) FROM threads WHERE first_user_message LIKE '%JIN-CODEX-TRACE%';"
# 2

# Desktop response text stored verbatim
grep "DESKTOP_ACK_01" ~/.codex/sessions/2026/03/25/rollout-*019d279b*.jsonl
# 5 hits (user prompt + assistant response + event duplicates)
```

### 2.6 Desktop vs CLI: Side-by-Side Comparison

| Property | Desktop (`019d279b-...`) | CLI exec (`019d27a7-...`) |
|----------|---|---|
| `threads.source` | `vscode` | `exec` |
| `threads.tokens_used` | 69,589 | 44,861 |
| `threads.approval_mode` | `on-request` | `never` |
| `thread_dynamic_tools` | 1 (`read_thread_terminal`) | 0 |
| Tool call record type | `custom_tool_call` / `custom_tool_call_output` | `function_call` / `function_call_output` |
| Tool call input field | `input` (raw string, e.g. unified diff) | `arguments` (JSON string) |
| JSONL message records | Identical format | Identical format |
| `session_index.jsonl` | Present | Absent |
| `shell_snapshots` | Not present | Not present |

**Update (2026-03-28):** An earlier version of this doc stated "JSONL record
types: Identical set". This is true for message, reasoning, token_count, and
lifecycle records. However, tool calls diverge: Desktop uses `custom_tool_call`
(with `input` and `status` fields) while CLI uses `function_call` (with
`arguments` field). The adapter must handle both schemas to produce unified
`ToolCall` rows.

---

## 3. Storage Layer Coverage by Interface

```
                    Desktop    CLI exec    CLI --ephemeral    SDK    MCP
Layer 1 (SQLite)      Yes        Yes           No            Yes    Yes
Layer 2 (JSONL)       Yes        Yes           No            Yes    Yes
Layer 3 (Index)       Yes        No            No            ?      ?
Layer 4 (Automation)  Yes*       No            No            No     No
Layer 5 (Global)      Yes        No            No            No     No
Layer 6 (Snapshots)   Sometimes  No            No            ?      ?
Layer 7 (Archive)     If arch.   If arch.      No            If     If

* Only for automation-triggered sessions
```

**Key insight:** Unlike Cursor (where no single interface covers all layers),
Codex's primary data (Layer 1 + 2) is written by ALL persistent interfaces.
The adapter doesn't need per-interface strategies.

---

## 4. Implications for Jin

### 4.1 For Adapter Development

One unified read strategy covers everything:

1. **List sessions:** Query `threads` table in `state_5.sqlite`, or scan
   `sessions/` directory for JSONL files
2. **Read messages:** Parse the JSONL rollout file (found via `threads.rollout_path`
   or filename pattern)
3. **Enrich metadata:** Pull git info and source type from `threads` table

### 4.2 For Testing

To generate test conversations that hit specific layers:

| Goal | Method |
|------|--------|
| Create a persistent session | `codex exec --json -C <dir> "prompt"` |
| Test multi-turn | `codex exec resume --json <id> "follow-up"` |
| Test without side effects | `codex exec --ephemeral --json "prompt"` |
| Verify Desktop compatibility | Send prompt via Desktop app, check same JSONL |
| Seed all layers | Desktop app (adds index + global state entries) |

### 4.3 For Conversation Tracking (jin watch)

The watcher daemon should monitor:
- `~/.codex/sessions/` for new JSONL files (covers CLI + Desktop)
- `~/.codex/state_5.sqlite` mtime for thread metadata updates
- `~/.codex/archived_sessions/` for archived sessions

Since both interfaces write to the same paths, a single watcher covers
all Codex sessions.

---

## 5. Comparison: Codex vs Cursor Orchestration

| Dimension | Codex | Cursor |
|-----------|-------|--------|
| CLI writes to main DB | **Yes** | No (skips state.vscdb) |
| CLI and IDE format match | **Yes** (identical JSONL) | No (different formats per layer) |
| Adapter strategies needed | **1** | 3 (Layer 1 + 2 + 3) |
| Multi-turn via CLI | **Yes** (`exec resume`) | No |
| Ephemeral mode | **Yes** (`--ephemeral`) | No |
| SDK available | **Yes** (`@openai/codex-sdk`) | Yes (ACP JSON-RPC) |
| MCP server mode | **Yes** (`mcp-server`) | No |
| Reasoning accessible | **No** (encrypted) | Yes (in store.db blobs) |
| Per-message token counts | **Yes** (`last_token_usage`) | Yes (bubbleId.tokenCount) |
| Sub-agent tracking | Not yet observed | Yes (subagentComposerIds) |

---

## 6. Open Questions

- [ ] Does the SDK (`@openai/codex-sdk`) create the same JSONL format as CLI?
- [ ] Can `codex fork <id>` be used for branching conversations?
- [ ] Does `codex review` create a standard thread or a special type?
- [ ] Can we use `codex cloud exec` and `codex cloud list` for Codex Cloud sessions?
- [ ] Does `codex mcp-server` create Layer 1+2 entries like CLI exec does?
- [ ] What triggers shell snapshot creation? (Only some Desktop sessions have them)
- [ ] Can we use `codex exec resume` on Desktop-created threads? (Cross-interface resume)

---

## Cross-References

- [overview.md](./overview.md) — Storage architecture and data models
- [investigation.md](./investigation.md) — Forensics log for layer discovery
- [examples.md](./examples.md) — Real data samples
- `tools/codex-trace-session.ts` — Automated trace experiment driver
- [Codex CLI Reference](https://developers.openai.com/codex/cli/reference)
- [Codex SDK](https://developers.openai.com/codex/sdk)
- [Codex Non-Interactive Mode](https://developers.openai.com/codex/noninteractive)
