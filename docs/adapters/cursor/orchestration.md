# Cursor Orchestration & Traceability

**Scope:** How to programmatically drive Cursor agent sessions and trace those
sessions through all storage layers. Findings from Claude Code driving Cursor
via ACP (CLI), AppleScript (IDE GUI), and Chrome DevTools Protocol (CDP).

**Date:** 2026-03-25 (updated 2026-03-26)
**Cursor version:** 2.6.21 (`fea2f546c979a0a4ad1deab23552a43568807590`)
**Agent CLI version:** `2026.03.20-44cb435`
**Investigator:** Claude Code (Opus 4.6) driving Cursor Agent via ACP + AppleScript + CDP

---

## 1. Orchestration Interfaces

Cursor exposes four programmatic interfaces for driving agent sessions:

| Interface | Transport | Auth | Multi-turn | Layer 1 | Sub-agents |
|-----------|-----------|------|------------|---------|------------|
| **CDP** (Chrome DevTools Protocol) | WebSocket | None (local) | Yes | **Yes** | **Yes** (with Max mode) |
| ACP (Agent Client Protocol) | JSON-RPC 2.0 over stdio | `CURSOR_API_KEY` / login | Yes | No | No |
| Headless CLI (`-p --resume`) | stdin/stdout | Same | Yes | No | No |
| AppleScript (macOS) | OS keystroke injection | None | Fragile | **Yes** | Untested |

**CDP is the recommended interface** — it drives the actual IDE renderer, writes
to Layer 1, supports Max mode, triggers sub-agents, and is cross-platform
(any OS with Electron).

### 1.1 CDP (Chrome DevTools Protocol) — Best Interface

Launch Cursor with remote debugging enabled:

```bash
/Applications/Cursor.app/Contents/MacOS/Cursor --remote-debugging-port=9222
```

Connect to the renderer's WebSocket endpoint:

```bash
# Discover targets
curl -s http://localhost:9222/json/list
# Returns: [{ "type": "page", "title": "jin", "webSocketDebuggerUrl": "ws://..." }]
```

**Capabilities proven:**
- Full DOM access to the Cursor IDE renderer
- Open new chat sessions (Cmd+L / Cmd+Shift+L via `Input.dispatchKeyEvent`)
- Type and send prompts (via `Input.insertText` + Enter)
- Messages flow through the real IDE pipeline → Layer 1 (`state.vscdb`)
- With Max mode enabled, complex tasks trigger **sub-agent spawning**
- Tool calls (`read_file_v2`, `glob_file_search`, `ripgrep_raw_search`) recorded in `toolFormerData`

**Working implementation pattern:**

```typescript
// Connect to renderer
const ws = new WebSocket("ws://localhost:9222/devtools/page/<id>");

// Enable Runtime domain
send("Runtime.enable", {});

// Open new chat: Cmd+L then Cmd+Shift+L
send("Input.dispatchKeyEvent", {
  type: "keyDown", key: "l", code: "KeyL",
  windowsVirtualKeyCode: 76, modifiers: 4  // meta
});
// ... keyUp, then same with modifiers: 12 (meta+shift)

// Focus the input
evaluate(`(() => {
  const e = document.querySelector('[contenteditable="true"]');
  if (e) e.focus();
})()`);

// Type message (fast — single insertText call)
send("Input.insertText", { text: "your prompt here" });

// Send (Enter)
send("Input.dispatchKeyEvent", {
  type: "keyDown", key: "Enter", code: "Enter",
  windowsVirtualKeyCode: 13
});
```

**Input element:** `DIV.aislash-editor-input` (contenteditable)

### 1.2 ACP (Agent Client Protocol)

Best for CLI-based persistent multi-turn orchestration. Spawns
`cursor agent acp` as a subprocess, communicates via NDJSON over stdio.

**Lifecycle:**
```
initialize → authenticate → session/new → session/prompt (loop) → kill
```

**Key methods:**

| Method | Direction | Purpose |
|--------|-----------|---------|
| `initialize` | Client → Agent | Handshake, declare capabilities |
| `authenticate` | Client → Agent | Auth (skipped if env var set) |
| `session/new` | Client → Agent | Create session with `cwd` and `mcpServers` |
| `session/prompt` | Client → Agent | Send user message, receive streaming response |
| `session/update` | Agent → Client (notification) | Streamed text chunks, tool calls, plans |
| `session/request_permission` | Agent → Client (request) | Permission for file edits, shell commands |
| `session/cancel` | Client → Agent (notification) | Abort current operation |
| `fs/read_text_file` | Agent → Client (request) | Agent asks client to read a file |
| `fs/write_text_file` | Agent → Client (request) | Agent asks client to write a file |

**Limitation:** Only creates Layer 3 data (store.db). No Layer 1 or Layer 2.

**Working implementation:** `tools/cursor-acp-driver.ts` (interactive REPL),
`tools/cursor-trace-session.ts` (automated multi-round).

### 1.3 Headless CLI with Resume

Simpler alternative — each turn is a separate CLI invocation:

```bash
CHAT_ID=$(cursor agent create-chat)
cursor agent -p --output-format stream-json --resume="$CHAT_ID" "first prompt"
cursor agent -p --output-format stream-json --resume="$CHAT_ID" "second prompt"
```

**Limitation:** Creates Layer 2+3 only. `create-chat` sessions cannot be loaded
via ACP's `session/load` — ACP sessions are process-scoped.

### 1.4 AppleScript (macOS IDE automation)

Uses OS-level keystroke injection to drive the Cursor IDE GUI:

```applescript
tell application "Cursor" to activate
tell application "System Events"
  tell process "Cursor"
    keystroke "l" using command down
    delay 0.5
    keystroke "l" using {command down, shift down}
  end tell
end tell
delay 1
tell application "System Events"
  tell process "Cursor"
    keystroke "your prompt here"
    keystroke return
  end tell
end tell
```

**Limitation:** macOS-only, fragile (timing-dependent), no feedback channel.
Superseded by CDP for all practical purposes.

---

## 2. CDP Experiments & Results

### 2.1 Basic Verification

Sent a tagged message via CDP:

```
[JIN-CDP-TEST-01] 🔍🦔 This message was sent via Chrome DevTools Protocol
from Claude Code. Reply with ONLY: CDP_LAYER1_ACK
```

**Result:** Created `composerData:b1dc3bea-98e6-4e2e-aaef-a0b910a11c7f` in
state.vscdb with 3 bubbles:

```
type=1, 2026-03-26T00:49:02.714Z, [JIN-CDP-TEST-01] 🔍🦔 This message was sent...
type=2, 2026-03-26T00:49:03.607Z, (empty — tool call)
type=2, 2026-03-26T00:49:03.891Z, CDP_LAYER1_ACK
```

Marker text stored **verbatim** with real per-message timestamps.

### 2.2 Multi-Tool Stress Test

Three sessions testing different Cursor behaviors:

| Tag | Task | Bubbles | Tools Observed |
|-----|------|---------|----------------|
| `JIN-CDP-STRESS-01` | Read + grep + read | 8 | `glob_file_search`, `read_file_v2` x3 |
| `JIN-CDP-STRESS-02` | Parallel adapter analysis | 20 | `glob_file_search`, `read_file_v2` x12 |
| `JIN-CDP-STRESS-03` | Design question (thinking) | 6 | `read_file_v2` |

All tool calls recorded in `bubbleId.toolFormerData.name`. Model was
`composer-2-fast` — tokens reported as 0 (known: this model doesn't populate
`tokenCount` in bubbles).

### 2.3 Sub-Agent Spawning (Max Mode)

**This is the key result.** With Max mode enabled in Cursor settings, we sent
a complex parallel investigation task via CDP:

```
[JIN-CDP-SUBAGENT-01] 🔍🦔 PARALLEL INVESTIGATION REQUEST.
I need you to investigate FOUR independent things simultaneously.
Use sub-agents to run these in parallel:
1. Adapter Coverage Audit [...]
2. Test Coverage Gap Analysis [...]
3. Documentation Completeness [...]
4. Dependency Audit [...]
```

**Result: 4 sub-agents spawned successfully.**

Session count went from 71 → 76 (parent + 4 sub-agents + 1 duplicate).

**Parent session** (`46fbe75-43ea-46c6-90b8-69bc70fdec24`):
- Model: `composer-2-fast`, Max mode: `1` (ON)
- 12 bubbles
- `subagentComposerIds`: array of 4 UUIDs

**Sub-agent sessions:**

| Sub-agent ID | Auto-generated Name | Model | Bubbles | Tool Calls |
|--------------|-------------------|-------|---------|------------|
| `a44e6ce6` | Adapter coverage audit for Jin codebase | `composer-2` | 25 | `glob_file_search`, `ripgrep_raw_search` |
| `0931ad2a` | Test coverage gap analysis for Jin codebase | `composer-2` | 23 | `glob_file_search` x3 |
| `a185a226` | Documentation completeness audit for adapters | `composer-2` | 22 | `read_file_v2`, `glob_file_search` x2, `ripgrep_raw_search` |
| `59d43d9d` | Dependency audit for Jin codebase | `composer-2` | 29 | `read_file_v2`, `ripgrep_raw_search` x2 |

**Key observations:**
- Parent uses `composer-2-fast` (agent mode); sub-agents use `composer-2` (chat mode)
- Sub-agents have `isAgentic: false` — they run in a simpler execution mode
- Each sub-agent gets its own `composerData` entry with full bubble history
- Tool calls (`toolFormerData`) are recorded per-bubble in sub-agent sessions
- `subagentComposerIds` on the parent links to sub-agent `composerData` entries
- Sub-agents ran **truly in parallel** (timestamps overlap across sub-agents)
- Tokens are 0 across all sub-agent bubbles (`composer-2` doesn't populate them)

### 2.4 Sub-Agent Data Model in Layer 1

```
composerData:parent-uuid
  ├── subagentComposerIds: [sub1-uuid, sub2-uuid, sub3-uuid, sub4-uuid]
  ├── fullConversationHeadersOnly: [{bubbleId, type}, ...]
  └── modelConfig: { modelName: "composer-2-fast", maxMode: true }

bubbleId:parent-uuid:spawn-bubble
  ├── type: 2 (assistant)
  ├── toolFormerData:
  │     name: "task_v2"
  │     status: "completed"
  │     params: { description, prompt, subagentType: "explore", model: "composer-2" }
  │     result: { agentId: "sub1-uuid" }
  │     additionalData: { status: "success", subagentComposerId: "sub1-uuid", terminationReason: "completed" }
  └── (this is the spawn event — task_v2 tool on parent → sub-agent ID in result)

composerData:sub1-uuid
  ├── name: "Adapter coverage audit for Jin codebase"
  ├── modelConfig: { modelName: "composer-2" }
  ├── isAgentic: false
  └── fullConversationHeadersOnly: [{bubbleId, type}, ...]  (25 entries)

bubbleId:sub1-uuid:bubble-uuid
  ├── type: 2 (assistant)
  ├── createdAt: "2026-03-26T00:52:52.385Z"
  ├── toolFormerData: { name: "glob_file_search", status: "completed", ... }
  └── tokenCount: { inputTokens: 0, outputTokens: 0 }
```

**Three ways to find sub-agents:**
1. `composerData.subagentComposerIds` array — lists all sub-agent UUIDs
2. Parent bubbles with `toolFormerData.name === "task_v2"` — the spawn event,
   with `result.agentId` and `additionalData.subagentComposerId` pointing to the sub-agent
3. `task_v2` params include `description`, `prompt` (the delegated task),
   `subagentType` (e.g. `"explore"`), and `model`

**Verified on both macOS and Windows (2026-03-26).**

### 2.5 What Layer 1 Captures (Summary)

| Data Point | Captured | Notes |
|-----------|----------|-------|
| Message text | **Yes** | Verbatim including emoji markers |
| Per-message timestamps | **Yes** | Real ISO 8601, ~100ms granularity |
| Message roles | **Yes** | type 1 = user, type 2 = assistant |
| Tool call names | **Yes** | `toolFormerData.name` (glob, read, grep, etc.) |
| Tool call args | **Yes** | `toolFormerData.rawArgs` (JSON string) |
| Model name | **Yes** | `modelConfig.modelName` per session |
| Max mode flag | **Yes** | `modelConfig.maxMode` boolean |
| Sub-agent IDs | **Yes** | `subagentComposerIds` array on parent |
| Sub-agent sessions | **Yes** | Full `composerData` + `bubbleId` entries per sub-agent |
| Session auto-naming | **Yes** | Cursor auto-generates names from content |
| Token counts | **Partial** | Present on Layer 1 bubbles, but many remain zero depending on model/runtime path |
| Thinking blocks | **Partial** | `allThinkingBlocks` is empty on current local data, but `thinking` objects and durations are present on assistant bubbles; text is usually empty |
| Tool call results | **Partial** | `toolFormerData.result` / `additionalData` are often present, but not every tool stores a rich result payload |

---

## 3. ACP Traceability Experiment

### 3.1 Method

We ran a 15-round ACP session with identifiable markers in every prompt:
- Tag: `[JIN-TRACE-XX]` (XX = 01 through 15)
- Emoji pair: `🔍🦔` (unique, grep-able)
- Session ID embedded in later prompts for self-referential queries

### 3.2 Session Details

| Property | Value |
|----------|-------|
| Session ID | `6c8791ad-2dc5-4f8d-a0bd-697c476766bc` |
| Rounds | 15 |
| Total tool calls | 39 |
| Duration | ~10 minutes |
| Driver | `tools/cursor-trace-session.ts` |
| Tags | `[JIN-TRACE-01]` through `[JIN-TRACE-15]` |

### 3.3 Where the ACP Session Appeared

| Layer | Found | Evidence |
|-------|-------|----------|
| Layer 1 (`state.vscdb`) | **No** | ACP/CLI sessions don't write here |
| Layer 2 (JSONL transcripts) | **No** | ACP sessions skip JSONL transcripts |
| Layer 3 (`store.db`) | **Yes** | `~/.cursor/chats/96cf2bae.../6c8791ad-.../store.db` — 170 blobs |

### 3.4 Marker Traceability in store.db

**57 of 170 blobs** contain our `🔍🦔` / `JIN-TRACE` markers. They appear in:
- **User JSON blobs**: `{"role":"user","content":[{"type":"text","text":"[JIN-TRACE-01] 🔍🦔 ..."}]}`
- **Protobuf-framed blobs**: markers embedded as UTF-8 strings within binary framing

Markers are **fully recoverable** via text search:
```bash
sqlite3 store.db "SELECT count(*) FROM blobs WHERE cast(data as text) LIKE '%JIN-TRACE%';"
```

---

## 4. Storage Layer Coverage by Interface

```
                          IDE (GUI)   CLI --print   ACP    CDP→IDE    AppleScript→IDE
Layer 1 (state.vscdb)       Yes          No         No      Yes           Yes
Layer 2 (JSONL)              Yes          Yes        No      Yes           Yes
Layer 3 (store.db)           No           Yes        Yes     No            No
Layer 4 (ai-tracking)        Yes          Partial    ?       Yes           Yes
Sub-agents                   Yes          No         No      Yes (Max)     Untested
```

**Key insight:** CDP is the only programmatic interface that hits Layer 1 AND
triggers sub-agents. It requires launching Cursor with
`--remote-debugging-port=9222` but gives full control over the IDE.

---

## 5. Sub-Agent Architecture

Sub-agents are a first-class Cursor feature, shipped in **Cursor 2.4**
(January 22, 2026). Official docs: [cursor.com/docs/subagents](https://cursor.com/docs/subagents)

### 5.1 How They Work

- Parent agent (orchestrator) breaks complex tasks into subtasks
- Up to **4 sub-agents run in parallel** (community-observed limit)
- Each sub-agent gets its own context window, tool access, and model
- Results return to the parent for synthesis

### 5.2 What Triggers Sub-Agents

- **Max mode must be ON** — without it, `composer-2-fast` handles everything inline
- Task must be **complex enough** to benefit from parallel decomposition
- Explicitly requesting "parallel" or "simultaneous" investigation helps
- Any model in Agent mode can spawn sub-agents when Max mode is enabled

### 5.3 Sub-Agent Model Selection

| Component | Model (observed) | Mode |
|-----------|-----------------|------|
| Parent (orchestrator) | `composer-2-fast` | Agent (`isAgentic: true`) |
| Sub-agents | `composer-2` | Chat (`isAgentic: false`) |

With Max mode, sub-agents may use the user's selected model instead of
defaulting to `composer-2`. Without Max mode, sub-agents fall back to
`composer-2` or `composer-1.5`.

### 5.4 Storage Layout

```
composerData:parent-uuid
  subagentComposerIds: [sub1, sub2, sub3, sub4]

composerData:sub1-uuid        # separate session entry
composerData:sub2-uuid        # with own bubbles, tools, model
composerData:sub3-uuid
composerData:sub4-uuid

agent-transcripts/
  parent-uuid/
    parent-uuid.jsonl
    subagents/
      sub1-uuid.jsonl          # JSONL transcript per sub-agent
      sub2-uuid.jsonl
```

Layer 1 (`state.vscdb`) has the **richest sub-agent data**: parent→child
linking, per-sub-agent bubble history, tool calls, and timestamps.

Layer 2 (JSONL transcripts) has the **conversation text** but no tokens,
no timestamps, and no tool results.

### 5.5 Custom Sub-Agents

Users can define custom sub-agents as Markdown files with YAML frontmatter:
- Project-scoped: `.cursor/agents/` (committed to repo)
- Global: `~/.cursor/agents/`

---

## 6. Implications for Jin

### 6.1 For Adapter Development

The multi-layer storage means jin needs **multiple read strategies**:

1. **Primary: Layer 1 reader** — For IDE sessions. Query `composerData:*` and
   `bubbleId:*` from state.vscdb. Richest data (tokens, timestamps, tools,
   sub-agents). Must handle WAL mode (confirmed: `journal_mode = wal`).
2. **Supplement: Layer 2 reader** — For CLI `--print` sessions and sub-agent
   content. Parse JSONL files.
3. **Fallback: Layer 3 reader** — For ACP sessions (and legacy). Current
   `cursor.ts` adapter covers this.

### 6.2 For Sub-Agent Tracking

The `subagentComposerIds` array in `composerData` provides the parent→child
relationship. Each sub-agent has its own `composerData` entry that can be
read with the same Layer 1 reader. Jin should:

- Check `subagentComposerIds` on every conversation
- Create `ConversationBundle` entries with `relationship: 'spawned'` and `parentId` set (see [BP-03](../../blueprint/BP-03-conversation-model.md))
- Use Layer 2 JSONL transcripts as supplementary source for sub-agent text

### 6.3 For Testing / Seeding Conversations

| Goal | Method |
|------|--------|
| Seed Layer 1 data | CDP → Cursor IDE (any OS, needs `--remote-debugging-port`) |
| Seed Layer 1 + sub-agents | CDP → Cursor IDE with Max mode + complex parallel task |
| Seed Layer 2 data | `cursor agent -p --workspace <path> "prompt"` |
| Seed Layer 3 data | `cursor agent acp` (or `cursor agent -p`) |
| Seed all layers | CDP for IDE + CLI `--print` for CLI coverage |

### 6.4 For Conversation Tracking (jin watch)

The watcher daemon should monitor:
- `state.vscdb` mtime for IDE session changes (Layer 1) — primary
- `agent-transcripts/` directory for new JSONL files (Layer 2)
- `chats/` directory for new store.db files (Layer 3)

Since Layer 1 is the richest source and covers the most common case (IDE
sessions including sub-agents), it should be the primary watch target.

---

## 7. Answered Questions

- [x] **Can CDP drive Cursor?** Yes. Launch with `--remote-debugging-port=9222`,
  connect to the `page` target via WebSocket, use `Input.dispatchKeyEvent` and
  `Input.insertText` to drive the composer.
- [x] **Does CDP create Layer 1 entries?** Yes. Full `composerData` + `bubbleId`
  entries with real timestamps, tool data, and sub-agent links.
- [x] **Can CDP trigger sub-agents?** Yes, with Max mode enabled and a complex
  enough task. Confirmed 4 sub-agents spawned from a single CDP-driven prompt.
- [x] **Are sub-agents real?** Yes. Shipped Cursor 2.4 (Jan 2026), documented at
  `cursor.com/docs/subagents`. Confirmed on this machine: 9 sub-agents from a
  prior IDE session, 4 from our CDP test.
- [x] **Does ACP `session/load` work?** No for `create-chat` IDs. ACP sessions
  are process-scoped.
- [x] **What triggers JSONL transcripts?** `--print` mode creates them. ACP does
  not. IDE sessions also create them.
- [x] **Does CDP work on Windows?** Yes. Confirmed independently on Windows
  (2026-03-26): CDP basic, multi-tool, and sub-agent tests all passed.
  Layer 1 + Layer 2 created. `task_v2` tool with `result.agentId` confirmed
  as the sub-agent spawn mechanism on both platforms.

## 8. Open Questions

- [ ] Can CDP be used without restarting Cursor? (SIGUSR1 opened Node inspector
  on main process but not on the renderer — need renderer-specific approach)
- [ ] Does `cursor serve-web` create Layer 1 entries?
- [ ] Can a VS Code extension create composer sessions via internal API?
- [ ] Do thinking-capable models (Opus) populate `allThinkingBlocks` in bubbles?
- [ ] Which models populate `tokenCount` in bubbles? (Only 25/964 bubbles have
  non-zero tokens across all historical sessions)
- [ ] Can we programmatically enable Max mode via CDP? (Currently requires UI toggle)
- [ ] What's the maximum sub-agent tree depth? (Can sub-agents spawn sub-agents?)

---

## 9. Cross-Platform Verification Guide

This section enables a developer on **any platform** to reproduce our findings.

### 9.1 Paths by Platform

| Location | macOS | Windows | Linux |
|----------|-------|---------|-------|
| state.vscdb | `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` | `%APPDATA%\Cursor\User\globalStorage\state.vscdb` | `~/.config/Cursor/User/globalStorage/state.vscdb` |
| CLI chats | `~/.cursor/chats/` | `%USERPROFILE%\.cursor\chats\` | `~/.cursor/chats/` |
| Transcripts | `~/.cursor/projects/<slug>/agent-transcripts/` | `%USERPROFILE%\.cursor\projects\<slug>\agent-transcripts\` | `~/.cursor/projects/<slug>/agent-transcripts/` |
| AI tracking | `~/.cursor/ai-tracking/ai-code-tracking.db` | `%USERPROFILE%\.cursor\ai-tracking\ai-code-tracking.db` | `~/.cursor/ai-tracking/ai-code-tracking.db` |
| Cursor binary | `/Applications/Cursor.app/Contents/MacOS/Cursor` | `%LOCALAPPDATA%\Programs\Cursor\Cursor.exe` | `/usr/bin/cursor` or AppImage |
| CLI agent | `~/.local/bin/cursor-agent` | `%LOCALAPPDATA%\Programs\Cursor\resources\app\bin\cursor-agent.cmd` | `~/.local/bin/cursor-agent` |

### 9.2 Launch Cursor with CDP

```bash
# macOS
/Applications/Cursor.app/Contents/MacOS/Cursor --remote-debugging-port=9222

# Windows (PowerShell)
& "$env:LOCALAPPDATA\Programs\Cursor\Cursor.exe" --remote-debugging-port=9222

# Linux
cursor --remote-debugging-port=9222
```

Verify CDP is active:
```bash
curl -s http://localhost:9222/json/list
# Should return JSON array with at least one "type": "page" entry
```

### 9.3 CDP Keyboard Modifiers by Platform

| Key combo | macOS modifier | Windows/Linux modifier |
|-----------|---------------|----------------------|
| Open chat (Cmd/Ctrl+L) | `modifiers: 4` (meta) | `modifiers: 2` (ctrl) |
| New chat (Cmd/Ctrl+Shift+L) | `modifiers: 12` (meta+shift) | `modifiers: 10` (ctrl+shift) |
| Send (Enter) | `modifiers: 0` | `modifiers: 0` |

The rest of the CDP flow (target discovery, `Runtime.evaluate`, `Input.insertText`,
`Input.dispatchKeyEvent` for Enter) is identical across platforms.

### 9.4 Verification Checklist

Run these queries against `state.vscdb` to confirm findings. Replace `$DB` with
your platform's path.

```bash
DB="<path-to-state.vscdb>"

# 1. Confirm schema
sqlite3 "$DB" ".tables"
# Expected: ItemTable  cursorDiskKV

# 2. Count sessions and bubbles
sqlite3 "$DB" "SELECT 'composerData', count(*) FROM cursorDiskKV WHERE key LIKE 'composerData:%' UNION ALL SELECT 'bubbleId', count(*) FROM cursorDiskKV WHERE key LIKE 'bubbleId:%';"

# 3. List recent sessions with model + subagent info
sqlite3 "$DB" "SELECT substr(key,15) as id, json_extract(value, '$.name') as name, json_extract(value, '$.modelConfig.modelName') as model, json_extract(value, '$.modelConfig.maxMode') as maxMode, json_array_length(json_extract(value, '$.subagentComposerIds')) as subagents FROM cursorDiskKV WHERE key LIKE 'composerData:%' ORDER BY json_extract(value, '$.lastUpdatedAt') DESC LIMIT 10;"

# 4. Find sessions with sub-agents
sqlite3 "$DB" "SELECT substr(key,15) as id, json_extract(value, '$.name') as name, json_array_length(json_extract(value, '$.subagentComposerIds')) as sub_count FROM cursorDiskKV WHERE key LIKE 'composerData:%' AND json_array_length(json_extract(value, '$.subagentComposerIds')) > 0;"

# 5. Inspect bubbles for a session (replace <composerId>)
sqlite3 "$DB" "SELECT json_extract(value, '$.type') as type, json_extract(value, '$.createdAt') as ts, CASE WHEN json_extract(value, '$.toolFormerData.name') IS NOT NULL THEN json_extract(value, '$.toolFormerData.name') ELSE '' END as tool, json_extract(value, '$.tokenCount.inputTokens') as inp, json_extract(value, '$.tokenCount.outputTokens') as out, substr(json_extract(value, '$.text'), 1, 80) as text FROM cursorDiskKV WHERE key LIKE 'bubbleId:<composerId>:%' ORDER BY json_extract(value, '$.createdAt');"

# 6. Check WAL mode
sqlite3 "$DB" "PRAGMA journal_mode;"
# Expected: wal

# 7. Verify CLI sessions are absent from Layer 1
# (run a cursor agent session first, note the session ID, then)
sqlite3 "$DB" "SELECT count(*) FROM cursorDiskKV WHERE key LIKE '%<cli-session-id>%';"
# Expected: 0

# 8. Check Layer 3 for CLI sessions
find ~/.cursor/chats -name "store.db" 2>/dev/null
# (Windows: dir /s /b %USERPROFILE%\.cursor\chats\store.db)

# 9. Check Layer 2 transcripts
find ~/.cursor/projects -name "*.jsonl" -path "*/agent-transcripts/*" 2>/dev/null
# (Windows: dir /s /b %USERPROFILE%\.cursor\projects\*agent-transcripts*\*.jsonl)
```

### 9.5 Triggering Sub-Agents (Reproducible)

Prerequisites:
- Cursor in **Agent mode** (not Ask or Plan)
- **Max mode ON** (toggle in the model selector dropdown)
- Workspace open with multiple files to analyze

Send this exact prompt (via CDP, IDE, or AppleScript/AutoHotkey):

```
I need you to investigate FOUR independent things simultaneously.
Use sub-agents to run these in parallel:
1. Read every file in src/ and count lines of code per file
2. Read every test file and list what each tests
3. Read package.json and list all dependencies with their purpose
4. Search for TODO/FIXME comments across the codebase
Present each as a separate table.
```

Then verify with query #4 above. The newest session should have
`subagentComposerIds` with 2-4 entries.

### 9.6 Platform-Specific UI Automation (non-CDP fallback)

| Platform | Tool | Notes |
|----------|------|-------|
| macOS | AppleScript (`osascript`) | Proven. See Section 1.4 |
| Windows | AutoHotkey or PowerShell `SendKeys` | Use Ctrl instead of Cmd. Same key combos otherwise |
| Linux | `xdotool` or `ydotool` (Wayland) | `xdotool key ctrl+l` then `xdotool type "prompt"` then `xdotool key Return` |

CDP is strongly preferred over all of these — it's cross-platform, reliable,
and doesn't depend on window focus or timing.

---

## Cross-References

- [overview.md](./overview.md) — Storage architecture and data models
- [investigation.md](./investigation.md) — Forensics log for layer discovery
- [examples.md](./examples.md) — Real data samples
- `tools/cursor-acp-driver.ts` — Interactive ACP REPL driver
- `tools/cursor-trace-session.ts` — Automated 15-round ACP trace session
- ACP spec: https://agentclientprotocol.com/protocol/overview
- TypeScript SDK: `@agentclientprotocol/sdk` (v0.16.1, by Zed Industries)
- Cursor sub-agents docs: https://cursor.com/docs/subagents
- Cursor 2.4 changelog: https://cursor.com/changelog/2-4
