# Codex Data Investigation

**Scope:** Reproducible forensics log documenting how Codex's storage layers
were discovered. Every finding is backed by a command you can run yourself.

**Date:** 2026-03-25
**Codex version:** `codex-cli 0.117.0-alpha.12` (Desktop: `Codex.app`)
**Platform verified on:** macOS (darwin 25.2.0, arm64)
**Platforms pending verification:** Linux, Windows (native + WSL)
**Investigator:** Claude Code (Opus 4.6) + Eden Mendel

---

## Cross-Platform Reproduction Guide

This investigation was performed on macOS. The storage format (SQLite + JSONL)
should be identical across platforms, but **paths and installation differ**.
Engineers on Linux/Windows should follow this setup before running the commands
in this doc.

### Platform Paths

| Item | macOS | Linux | Windows (native) | Windows (WSL) |
|------|-------|-------|-------------------|---------------|
| `CODEX_HOME` | `~/.codex` | `~/.codex` | `%USERPROFILE%\.codex` | `~/.codex` (Linux home) |
| CLI install | `npm i -g @openai/codex` or Codex.app bundle | `npm i -g @openai/codex` | `npm i -g @openai/codex` | `npm i -g @openai/codex` |
| Desktop app | `/Applications/Codex.app` | N/A (CLI only) | Codex Desktop (installer) | Use Windows Desktop |
| State DB | `$CODEX_HOME/state_5.sqlite` | Same | Same | Same |
| Sessions | `$CODEX_HOME/sessions/YYYY/MM/DD/` | Same | Same | Same |
| Config | `$CODEX_HOME/config.toml` | Same | Same | Same |

**Important:** `CODEX_HOME` can be overridden via the `CODEX_HOME` environment
variable. If set, all paths below use that instead of `~/.codex`.

**WSL caveat:** The WSL CLI and the Windows Desktop app use **separate**
`CODEX_HOME` directories (`~/.codex` in Linux vs `%USERPROFILE%\.codex` in
Windows). Sessions created in one are NOT visible in the other.

### Setup Steps for Cross-Platform Verification

1. **Install Codex CLI:**
   ```bash
   npm i -g @openai/codex
   codex --version          # should print codex-cli 0.1xx.x-alpha.xx
   ```

2. **Authenticate:**
   ```bash
   codex login              # OAuth flow, or:
   codex login --with-api-key <<< "sk-..."
   ```

3. **Verify `CODEX_HOME` exists and has data:**
   ```bash
   ls "$HOME/.codex/"       # Linux/macOS/WSL
   # or on Windows cmd:
   dir "%USERPROFILE%\.codex"
   ```

4. **Verify SQLite access:**
   ```bash
   sqlite3 "$HOME/.codex/state_5.sqlite" "SELECT count(*) FROM threads;"
   ```
   If this returns 0, create at least one session first:
   ```bash
   codex exec --json --sandbox read-only "Say hello"
   ```

5. **Run the trace experiment:**
   ```bash
   # Clone jin repo, then:
   bun tools/codex-trace-session.ts
   ```
   Or manually run the individual commands from sections 2-6 below,
   substituting `$HOME/.codex` for any macOS-specific paths.

### What to Verify on Your Platform

After running the experiment, check these assertions hold:

- [ ] `state_5.sqlite` exists at `$CODEX_HOME/state_5.sqlite`
- [ ] `threads` table schema matches Section 2.2 (same columns)
- [ ] CLI `exec` creates a thread with `source=exec`
- [ ] Desktop creates a thread with `source=vscode` (if Desktop available)
- [ ] JSONL files appear under `$CODEX_HOME/sessions/YYYY/MM/DD/`
- [ ] JSONL envelope format is `{timestamp, type, payload}` (RolloutLine)
- [ ] Record types match: `session_meta`, `turn_context`, `response_item`, `event_msg`
- [ ] `token_count` events contain `total_token_usage` and `last_token_usage`
- [ ] `--ephemeral` mode writes nothing to disk
- [ ] `exec resume <id>` appends to existing JSONL and updates SQLite
- [ ] Markers in prompts are stored verbatim in both JSONL and SQLite
- [ ] `session_index.jsonl` — confirm whether CLI exec writes here (it doesn't on macOS)

### Platform-Specific Concerns to Investigate

**Linux:**
- [ ] Does the sandbox (`--sandbox workspace-write`) use Landlock? Does it affect storage paths?
- [ ] Is `state_5.sqlite` the same version number (5)?
- [ ] Does `codex-dev.db` exist at `$CODEX_HOME/sqlite/codex-dev.db`?

**Windows (native):**
- [ ] Does the AppContainer sandbox affect where sessions are written?
- [ ] Are JSONL paths using backslashes in `rollout_path`?
- [ ] Is `sqlite3` available or does the engineer need to install it?
- [ ] Does the Desktop app bundle a CLI binary like macOS does?

**Windows (WSL):**
- [ ] Confirm that WSL sessions are NOT visible in the Windows Desktop app
- [ ] Verify `$HOME/.codex` is the correct location (not `/mnt/c/Users/...`)

---

## Prerequisites

- Codex CLI in PATH (`npm i -g @openai/codex`) or Desktop app installed
- `sqlite3` CLI (pre-installed on macOS/most Linux; Windows may need separate install)
- `python3` for JSON parsing
- At least one prior Codex conversation (or run `codex exec "Say hello"` first)

---

## 1. Discovery: Finding All Storage Locations

### 1.1 Codex Home and Config

```bash
ls ~/.codex/
# archived_sessions  auth.json  config.toml  models_cache.json
# session_index.jsonl  sessions  shell_snapshots  skills  sqlite
# state_5.sqlite  state_5.sqlite-shm  state_5.sqlite-wal
# tmp  vendor_imports  worktrees

cat ~/.codex/config.toml
# model = "gpt-5.4"
# model_reasoning_effort = "xhigh"
```

### 1.2 CLI Binary Location

```bash
file /Applications/Codex.app/Contents/Resources/codex
# Mach-O 64-bit executable arm64

/Applications/Codex.app/Contents/Resources/codex --version
# codex-cli 0.117.0-alpha.12
```

**Note:** The binary is NOT symlinked into PATH by default. Either symlink it
(`ln -s /Applications/Codex.app/Contents/Resources/codex /usr/local/bin/codex`)
or use the full path.

### 1.3 Finding All Databases

```bash
find ~/.codex -name "*.sqlite" -o -name "*.db" -o -name "*.sqlite3" 2>/dev/null
```

Result:
```
~/.codex/state_5.sqlite              # Layer 1 (main thread DB)
~/.codex/sqlite/codex-dev.db         # Layer 4 (automation DB)
```

### 1.4 Finding Session Files

```bash
find ~/.codex/sessions -name "*.jsonl" 2>/dev/null
```

Result: files organized as `sessions/YYYY/MM/DD/rollout-<timestamp>-<thread-id>.jsonl`

### 1.5 macOS System Locations

```bash
ls ~/Library/HTTPStorages/com.openai.codex/    # HTTP cache
ls ~/Library/Logs/com.openai.codex/            # App logs
ls ~/Library/Caches/com.openai.codex/          # Sparkle updates
```

---

## 2. Layer 1: `state_5.sqlite` Investigation

### 2.1 Schema Discovery

```bash
sqlite3 ~/.codex/state_5.sqlite ".tables"
# _sqlx_migrations  backfill_state  stage1_outputs
# agent_job_items   jobs            thread_dynamic_tools
# agent_jobs        logs            threads
```

### 2.2 Threads Table

```bash
sqlite3 ~/.codex/state_5.sqlite ".schema threads"
```

Key columns:
```sql
CREATE TABLE threads (
    id TEXT PRIMARY KEY,
    rollout_path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    source TEXT NOT NULL,           -- "exec" or "vscode"
    model_provider TEXT NOT NULL,   -- "openai"
    cwd TEXT NOT NULL,
    title TEXT NOT NULL,            -- first user message (or thread name)
    sandbox_policy TEXT NOT NULL,
    approval_mode TEXT NOT NULL,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    has_user_event INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    git_sha TEXT,
    git_branch TEXT,
    git_origin_url TEXT,
    cli_version TEXT NOT NULL DEFAULT '',
    first_user_message TEXT NOT NULL DEFAULT '',
    agent_nickname TEXT,
    agent_role TEXT,
    memory_mode TEXT NOT NULL DEFAULT 'enabled'
);
```

### 2.3 Thread Enumeration

```bash
sqlite3 ~/.codex/state_5.sqlite "
  SELECT id, source, tokens_used,
         substr(first_user_message,1,60),
         git_branch
  FROM threads
  ORDER BY updated_at DESC;"
```

Observed: All threads have `source` of either `exec` (CLI) or `vscode` (Desktop).
Both interfaces write to the same table with the same schema.

### 2.4 Logs Table

```bash
sqlite3 ~/.codex/state_5.sqlite "SELECT count(*) FROM logs;"
# 60970+ entries (structured application logs, not conversation data)

sqlite3 ~/.codex/state_5.sqlite "
  SELECT level, count(*)
  FROM logs GROUP BY level ORDER BY count(*) DESC;"
# DEBUG: majority, INFO, WARN, ERROR
```

**Finding:** The `logs` table contains application debug logs, NOT conversation
messages. Conversation data lives in the JSONL rollout files (Layer 2).

### 2.5 Thread Dynamic Tools

```bash
sqlite3 ~/.codex/state_5.sqlite "SELECT * FROM thread_dynamic_tools LIMIT 3;"
```

Result: Desktop sessions (`source=vscode`) register a `read_thread_terminal`
tool for reading the app's terminal output. CLI sessions do not register
any dynamic tools.

### 2.6 Other Tables

```bash
sqlite3 ~/.codex/state_5.sqlite "SELECT count(*) FROM stage1_outputs;"
# 0 (memory pipeline — not yet populated on this system)

sqlite3 ~/.codex/state_5.sqlite "SELECT count(*) FROM agent_jobs;"
# 0 (batch agent jobs — not yet used)
```

---

## 3. Layer 2: Session JSONL Investigation

### 3.1 File Layout

```bash
find ~/.codex/sessions -name "*.jsonl" | sort
```

Result:
```
~/.codex/sessions/2026/02/21/rollout-2026-02-21T12-48-43-<uuid>.jsonl
~/.codex/sessions/2026/02/21/rollout-2026-02-21T14-50-48-<uuid>.jsonl
~/.codex/sessions/2026/03/21/rollout-2026-03-21T15-00-53-<uuid>.jsonl
~/.codex/sessions/2026/03/25/rollout-2026-03-25T20-47-02-<uuid>.jsonl
~/.codex/sessions/2026/03/25/rollout-2026-03-25T20-59-14-<uuid>.jsonl
```

Naming pattern: `rollout-<ISO-timestamp>-<thread-id>.jsonl`
Date-partitioned: `YYYY/MM/DD/`

### 3.2 RolloutLine Envelope Format

Every line in the JSONL file has the same envelope:

```json
{
  "timestamp": "2026-03-25T20:59:14.893Z",
  "type": "<record_type>",
  "payload": { ... }
}
```

The `type` field determines what `payload` contains.

### 3.3 Record Type Enumeration

```bash
cat <session>.jsonl | python3 -c "
import sys, json
types = {}
for line in sys.stdin:
    obj = json.loads(line.strip())
    t = obj['type']
    if t == 'response_item':
        t += ':' + obj.get('payload',{}).get('type','')
    elif t == 'event_msg':
        t += ':' + obj.get('payload',{}).get('type','')
    types[t] = types.get(t, 0) + 1
for t, c in sorted(types.items(), key=lambda x: -x[1]):
    print(f'  {t}: {c}')
"
```

Result (from a 2-turn session with tool calls):
```
response_item:message        11
event_msg:token_count         9
event_msg:agent_message       5
event_msg:task_started        4
turn_context                  4
event_msg:user_message        4
response_item:reasoning       4
event_msg:task_complete        4
session_meta                  1
response_item:function_call   1
response_item:function_call_output  1
```

### 3.4 `session_meta` Record

First line in every JSONL file:

```json
{
  "id": "019d27a7-1649-73a2-abd0-0d411f7e9849",
  "timestamp": "2026-03-26T00:59:14.893Z",
  "cwd": "/Users/edenmendel/Documents/GitHub/jin",
  "originator": "codex_exec",
  "cli_version": "0.117.0-alpha.12",
  "source": "exec",
  "model_provider": "openai",
  "base_instructions": { "text": "You are Codex, a coding agent based on GPT-5..." }
}
```

### 3.5 `turn_context` Record

Emitted at the start of each turn:

```json
{
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
```

### 3.6 `response_item` Records

**User message:**
```json
{
  "type": "message",
  "role": "user",
  "content": [{ "type": "input_text", "text": "[JIN-CODEX-TRACE-01] ..." }]
}
```

**Assistant message:**
```json
{
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "output_text", "text": "The first import statement..." }]
}
```

**Developer message (system prompt injection):**
```json
{
  "type": "message",
  "role": "developer",
  "content": [{ "type": "input_text", "text": "<skills_instructions>..." }]
}
```

**Function call:**
```json
{
  "type": "function_call",
  "name": "exec_command",
  "arguments": "{\"cmd\":\"find src/adapters -maxdepth 1 -type f | sort\",\"workdir\":\"...\"}",
  "call_id": "call_XU7iYq6KM4iMlOcgiznrBso7"
}
```

**Function call output:**
```json
{
  "type": "function_call_output",
  "call_id": "call_XU7iYq6KM4iMlOcgiznrBso7",
  "output": "Command: /bin/zsh -lc 'find src/adapters...' ... Output:\nsrc/adapters/amp.ts\n..."
}
```

**Reasoning (encrypted):**
```json
{
  "type": "reasoning",
  "summary": [],
  "content": null,
  "encrypted_content": "gAAAAABpxITrkYJ56sMCr2tZ-57d..."
}
```

**Critical finding:** Unlike Claude Code where thinking blocks contain
plaintext, Codex reasoning is encrypted with what appears to be Fernet
(gAAAAA prefix). The `summary` array is always empty in observed sessions.
This data is not recoverable by the adapter.

### 3.7 `event_msg` Records

**`token_count` — the richest data source:**
```json
{
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
    "primary": { "used_percent": 2.0, "window_minutes": 300, "resets_at": 1774504009 },
    "secondary": { "used_percent": 3.0, "window_minutes": 10080, "resets_at": 1774724455 },
    "plan_type": "plus"
  }
}
```

Key fields:
- `total_token_usage` — cumulative for the entire session
- `last_token_usage` — for the most recent API call only
- `reasoning_output_tokens` — separate from `output_tokens`
- `cached_input_tokens` — prompt cache hits
- `model_context_window` — 258,400 tokens for GPT-5.4
- `rate_limits` — usage percentages and reset windows

**`user_message` / `agent_message`** — duplicate of the `response_item` text
(useful for grep but no additional data).

**`task_started` / `task_complete`** — session lifecycle markers.

### 3.8 Multi-turn / Resume Behavior

When a session is resumed via `codex exec resume <id>`, new records are
**appended** to the same JSONL file. A new `turn_context` is emitted at the
start of each resumed turn, followed by the user prompt, reasoning, and
response items.

Verified: session `019d27a7-...` grew from 25 lines (turn 1) to 35 lines
(after resume turn 2), all in the same `.jsonl` file.

### 3.9 Ephemeral Mode

```bash
codex exec --ephemeral "say ACK"
```

When `--ephemeral` is passed, the session:
- Gets a `thread_id` in the JSON stream
- Does NOT write to `state_5.sqlite` (no threads row)
- Does NOT create a JSONL rollout file
- Does NOT write to `session_index.jsonl`

Verified: thread `019d27a7-66b2-...` returned results but left zero traces
across all storage layers.

---

## 4. Layer 3: Session Index

### 4.1 Format

```bash
head -3 ~/.codex/session_index.jsonl
```

```json
{"id":"019c8151-...","thread_name":"Plan deep security review","updated_at":"2026-03-21T19:00:16.945Z"}
{"id":"019c81c1-...","thread_name":"Plan security review for Nextjs app","updated_at":"2026-03-21T19:00:16.970Z"}
```

### 4.2 Desktop vs CLI

**Finding:** Only Desktop sessions (`source=vscode`) write to
`session_index.jsonl`. CLI `exec` sessions are NOT added to this index.

---

## 5. Layer 4: Automation DB (`codex-dev.db`)

### 5.1 Schema

```bash
sqlite3 ~/.codex/sqlite/codex-dev.db ".tables"
# automation_runs  automations  inbox_items

sqlite3 ~/.codex/sqlite/codex-dev.db ".schema automations"
```

```sql
CREATE TABLE automations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    next_run_at INTEGER,
    last_run_at INTEGER,
    cwds TEXT NOT NULL DEFAULT '[]',
    rrule TEXT NOT NULL DEFAULT 'FREQ=HOURLY;INTERVAL=24;BYMINUTE=0',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE automation_runs (
    thread_id TEXT PRIMARY KEY,
    automation_id TEXT NOT NULL,
    status TEXT NOT NULL,
    -- ... inbox_title, inbox_summary, archived messages
);

CREATE TABLE inbox_items (
    id TEXT PRIMARY KEY,
    title TEXT,
    description TEXT,
    thread_id TEXT,
    read_at INTEGER,
    created_at INTEGER
);
```

This layer handles the "Automations" feature visible in the Desktop sidebar.
Low priority for conversation ingestion — but `automation_runs.thread_id`
links to Layer 1 threads.

---

## 6. Layers 5-7: Supporting Files

### 6.1 Layer 5: Global State

```bash
cat ~/.codex/.codex-global-state.json | python3 -c "import sys,json; print(sorted(json.load(sys.stdin).keys()))"
# ['active-workspace-roots', 'electron-main-window-bounds',
#  'electron-persisted-atom-state', 'electron-saved-workspace-roots',
#  'electron-workspace-root-labels', 'queued-follow-ups', 'thread-titles']
```

Electron window state. No conversation data.

### 6.2 Layer 6: Shell Snapshots

```bash
ls ~/.codex/shell_snapshots/
# 019d11c5-90dc-7490-8caa-b6cfd73b215a.sh  (116KB)
# 019d11c5-c7ad-7562-9581-854517bbd26b.sh  (88KB)
```

Full `env` dump captured at session start. Only some sessions create these.
Useful for reproducing the exact shell environment.

### 6.3 Layer 7: Archived Sessions

```bash
ls ~/.codex/archived_sessions/
# rollout-2026-02-21T14-46-07-019c81bc-e81d-7a60-bb47-477488e8d8e7.jsonl
```

Same JSONL format as Layer 2 — old sessions moved here (manually or by the app).
The adapter should scan this directory too.

---

## 7. Cross-Layer Correlation: Desktop vs CLI

### 7.1 Traceability Experiment

We ran a controlled experiment (see [orchestration.md](./orchestration.md)):

1. **CLI `exec --json`** with marker `[JIN-CODEX-TRACE-01]`
2. **CLI `exec resume`** on the same thread with `[JIN-CODEX-TRACE-02]`
3. **CLI `exec --ephemeral`** with `[JIN-CODEX-TRACE-03]`
4. **CLI `exec --json`** with tool calls `[JIN-CODEX-TRACE-04]`
5. **Desktop app** with markers `[JIN-DESKTOP-TEST-01/02/03]`

### 7.2 Results: Where Each Interface Writes

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

### 7.3 Key Differences Between Desktop and CLI

| Field | Desktop (`vscode`) | CLI (`exec`) |
|-------|---|---|
| `threads.source` | `vscode` | `exec` |
| `threads.approval_mode` | `on-request` | `never` |
| `thread_dynamic_tools` | `read_thread_terminal` (1 tool) | None |
| `session_index.jsonl` | Written | Skipped |
| JSONL record types | Identical | Identical |
| JSONL record format | Identical | Identical |
| Token data in JSONL | Identical | Identical |

**Conclusion:** Unlike Cursor where CLI and IDE use completely different storage
formats requiring separate adapter strategies, Codex uses the **same format
for both interfaces**. A single adapter that reads Layer 1 + Layer 2 covers
all cases.

### 7.4 Marker Verification

All markers were found stored verbatim in both Layer 1 (`first_user_message`)
and Layer 2 (JSONL `response_item` + `event_msg` records). The Desktop app
response text ("DESKTOP_ACK_01", "import { VERSION }", "how would we use
sub-agents") was also captured exactly.

---

## 8. Testing Notes

The investigation was run **without mocks** — we drove Codex CLI and Desktop
with real prompts and verified storage on disk. This is directly translatable
to integration tests:

- **Trace markers** (`[JIN-CODEX-TRACE-XX]`, `[JIN-DESKTOP-TEST-XX]`) make
  sessions grep-able and verifiable. Future tests should embed unique markers
  in prompts to identify test-created sessions.
- **Pre/post snapshots** of `state_5.sqlite` thread count and JSONL file count
  can detect whether a session was persisted correctly.
- **Ephemeral mode** (`--ephemeral`) is the escape hatch for tests that
  should NOT leave traces — useful for load/perf tests that shouldn't pollute
  the session history.
- **`codex exec --json`** produces a JSONL event stream on stdout that can be
  captured and asserted against in tests (event types, token counts, tool
  calls).
- **Resume** (`codex exec resume <id>`) can be tested by asserting that the
  same JSONL file grows and the `threads.tokens_used` column increases.

A solid test suite for the Codex adapter should cover:

1. **Unit tests:** Parse each `RolloutLine` record type (`session_meta`,
   `turn_context`, `response_item:message`, `response_item:function_call`,
   `response_item:function_call_output`, `response_item:reasoning`,
   `event_msg:token_count`). Use fixture JSONL files with known content.
2. **Integration tests:** Run `codex exec --json --ephemeral` with a marker
   prompt, capture stdout, verify event stream structure. Then run a
   non-ephemeral exec, verify Layer 1 + Layer 2 entries appear.
3. **Snapshot tests:** Capture `state_5.sqlite` thread metadata before/after
   adapter ingestion and verify field mapping is correct.
4. **Edge cases:** Compacted sessions (`compacted` records — see Section 8.1),
   archived sessions (Layer 7), sessions with no tool calls, sessions with many
   tool calls, resumed sessions (multi-turn in single JSONL), Desktop sessions
   with `custom_tool_call` (different schema from CLI `function_call`),
   interrupted turns (`turn_aborted` events).

See `tools/codex-trace-session.ts` for the automated driver that runs
phases 1-4 of the experiment and audits all layers.

---

## 8.1 Compaction Experiment (2026-03-28)

### Method

A long-running Desktop session reviewing jin blueprint documents was used until
Codex hit its context window limit and triggered compaction. A marker message
(`MARKER-FOR-CODEX-COMPACT-SESSION`) was sent after the compaction boundary to
verify the session remained functional and the marker was stored verbatim.

### Session Details

- **File:** `~/.codex/sessions/2026/03/28/rollout-2026-03-28T14-39-40-019d35be-a638-77d1-abe9-f723fdc5b47d.jsonl`
- **Total lines:** 496
- **Record type census:**
  - `response_item:function_call`: 84
  - `response_item:function_call_output`: 84
  - `event_msg:token_count`: 73
  - `response_item:message`: 70
  - `response_item:reasoning`: 52
  - `event_msg:agent_message`: 46
  - `turn_context`: 22
  - `event_msg:task_started`: 21
  - `event_msg:user_message`: 21
  - `event_msg:task_complete`: 19
  - `response_item:custom_tool_call`: 3
  - `response_item:custom_tool_call_output`: 3
  - `session_meta`: 1
  - `compacted`: 1
  - `event_msg:context_compacted`: 1
  - `event_msg:turn_aborted`: 1

### Key Findings

**1. Compaction record type is `compacted`, not `compaction` or `rollout_compaction`.**

Our earlier docs listed the wrong type names. The actual envelope `type` is
`compacted` (past tense).

**2. `replacement_history` structure.**

The `compacted` payload contains a `replacement_history` array — the full
condensed conversation that replaces pre-compaction context:
- 38 `type: "message"` items (condensed user/assistant pairs)
- 1 `type: "compaction"` item (encrypted summary, same Fernet format as reasoning)
- `payload.message` is empty string

This is fundamentally different from Claude Code's compaction model (boundary
marker + summary injected as user message). Codex provides the entire condensed
conversation inline.

**3. Three previously undocumented record types discovered:**

| New Type | Schema |
|----------|--------|
| `response_item:custom_tool_call` | Desktop tool calls (e.g. `apply_patch`). Fields: `status`, `call_id`, `name`, `input` |
| `response_item:custom_tool_call_output` | Desktop tool results. Fields: `call_id`, `output` (JSON with `exit_code`, `duration_seconds`) |
| `event_msg:turn_aborted` | User-interrupted turn. Fields: `turn_id`, `reason` (e.g. `"interrupted"`) |

**4. `custom_tool_call` vs `function_call` (CLI vs Desktop divergence).**

Despite our earlier finding that "CLI and Desktop use identical JSONL format,"
tool call records actually differ:
- CLI: `function_call` with `arguments` (JSON string)
- Desktop: `custom_tool_call` with `input` (raw string, e.g. a unified diff)

The output format also differs — `custom_tool_call_output` wraps output in JSON
with structured metadata (`exit_code`, `duration_seconds`).

**5. `phase` field on post-compaction messages.**

After compaction, `response_item:message` records include `"phase": "final_answer"`.
The companion `event_msg:agent_message` also carries `phase` and `memory_citation: null`.

**6. Compaction boundary sequence.**

```
line 459-460: response_item:function_call_output  (last pre-compaction results)
line 461:     compacted                           (replacement_history: 39 items)
line 462:     turn_context                        (new turn begins)
line 463:     event_msg:token_count               (5.1M cumulative input tokens)
line 464:     event_msg:context_compacted          (companion lifecycle marker)
line 465:     response_item:reasoning              (first post-compaction response)
```

**7. Token count at compaction: 5.1M input tokens cumulative.**

The `token_count` event at the compaction boundary shows `total_token_usage.input_tokens: 5,061,915`
and `model_context_window: 258,400`. The session had consumed ~20x the context
window in cumulative input before compaction was triggered.

**8. Post-compaction marker verification.**

The `MARKER-FOR-CODEX-COMPACT-SESSION` prompt and response were stored verbatim
in both `response_item:message` and `event_msg:user_message`/`agent_message`
records after the compaction boundary — confirming the session continued
normally post-compaction.

### Sub-Agent Findings (Same Session)

The same session that hit compaction also spawned 5 sub-agents, providing
the first real sub-agent data for Codex.

**9. Sub-agents spawn via `function_call` with `name: "spawn_agent"`.**

The parent session calls `spawn_agent` as a regular `function_call`. Arguments
include `agent_type`, `model`, `reasoning_effort`, `fork_context`, and `message`.
The `function_call_output` returns `{agent_id, nickname}`.

**10. Sub-agents have their own JSONL files in the same directory (not a subdirectory).**

Unlike Claude Code (which puts sub-agents in a `subagents/` subdirectory),
Codex sub-agent JSONL files sit alongside the parent in `sessions/YYYY/MM/DD/`.
They're identifiable by `session_meta.source.subagent` or `forked_from_id`.

**11. Sub-agent `session_meta.source` is a structured object, not a string.**

For root sessions, `source` is a string (`"vscode"` or `"exec"`). For
sub-agents, it's `{subagent: {thread_spawn: {parent_thread_id, depth, agent_path, agent_nickname, agent_role}}}`.

**12. `forked_from_id` links child to parent.**

Present on sub-agent `session_meta` — the parent's thread ID. Provides the
same linkage as `source.subagent.thread_spawn.parent_thread_id`.

**13. Sub-agents also compact.**

All 5 sub-agents (700-780 lines each) hit their own compaction boundaries.
Post-compaction, they re-emit `session_meta` with the **parent's** ID and
`source: "vscode"` (no sub-agent metadata). This may be context restoration.

**14. `wait_agent` function_call joins sub-agents.**

The parent calls `wait_agent` with `targets` = array of all sub-agent IDs.
The output contains the sub-agents' results.

**15. `web_search_call` is a new record type.**

One sub-agent (Dirac) had a `response_item:web_search_call` with `status: "completed"`.
Minimal payload — results presumably in a subsequent message.

**16. Desktop sessions mix both tool call types.**

All 5 sub-agents had both `function_call` (CLI tools like `exec_command`) and
`custom_tool_call` (Desktop tools like `apply_patch`). This confirms Desktop
sessions use both types simultaneously, not exclusively one or the other.

**17. Auto-generated nicknames follow a pattern.**

Observed: Dirac, Kant, Mill, Carver, Bernoulli — all historical scientists/
philosophers. Likely a curated name list.

### Documentation Updates

These findings prompted updates to:
- `overview.md` — Record types table corrected, compaction data model added,
  `custom_tool_call` schema documented, adapter fix table expanded
- `examples.md` — Real compaction, `custom_tool_call`, `turn_aborted`, and
  `context_compacted` samples added, record type census added
- `index.md` — Coverage gap table expanded with 3 new missing capabilities

---

## 9. Open Questions

- [ ] Does `state_5.sqlite` use WAL mode? (it has `-shm` and `-wal` files, likely yes)
- [ ] Does `stage1_outputs` (memory pipeline) get populated after enough sessions?
- [ ] Can `agent_jobs` / `agent_job_items` be triggered from CLI? (batch mode)
- [ ] What creates shell snapshots? Only some sessions have them.
- [ ] Is the `reasoning.encrypted_content` decryptable? (Fernet key location?)
- [ ] Does `codex review` (non-interactive code review) create a different thread type?
- [ ] What does `codex fork <id>` write? New thread with copied JSONL?
- [ ] Linux and Windows path verification needed for all layers
- [ ] Does Codex Cloud (`codex cloud exec`) write to local storage at all?
- [ ] What is the `models_cache.json` file used for and how often is it refreshed?
- [x] What does compaction look like? → `compacted` record with `replacement_history` (see Section 8.1)
- [x] How are sub-agents represented? → `spawn_agent`/`wait_agent` function_calls in parent, `session_meta.source.subagent` in child (see Section 8.1)
- [x] Is there a parent-child link? → Yes: `forked_from_id` and `source.subagent.thread_spawn.parent_thread_id`
- [x] Does Desktop use `custom_tool_call` for ALL tools? → No, Desktop mixes both `function_call` (CLI tools) and `custom_tool_call` (IDE tools) in the same session
- [ ] Does `phase: "final_answer"` appear on non-compacted sessions too, or only post-compaction?
- [ ] Are there other `phase` values besides `"final_answer"`?
- [ ] What does `web_search_call` output look like? (Only `status: "completed"` observed, results location unknown)
- [ ] Can sub-agents spawn sub-agents? (`depth: 1` observed, depth > 1 not yet seen)
- [ ] What does the `wait_agent` output contain? (Full sub-agent response, summary, or status?)
- [ ] What happens to sub-agent `session_meta` with parent's ID post-compaction? Context restoration or identity confusion for the adapter?

---

## Cross-References

- [overview.md](./overview.md) — Structured summary of all findings
- [examples.md](./examples.md) — Concrete data samples from these investigations
- [orchestration.md](./orchestration.md) — CLI exec/resume experiment, SDK, MCP server
- [index.md](./index.md) — Coverage gap summary
