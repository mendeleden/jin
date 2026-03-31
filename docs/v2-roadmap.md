# Jin v2 Implementation Roadmap

Consolidated from: `ontology.md` (spec), `ontology-discussion.md` (decisions),
`code-review-qa.md` (33 findings), `code-syllabus.md` (file map).

Date: 2026-03-24

---

## Phase 0: Foundation — Types, Schema, Store

**Goal:** The v2 data model exists and compiles. No adapters changed yet.

### 0.1 Types (`src/adapters/types.ts`)

- [ ] Rename `Session` → `Conversation`
- [ ] Add fields: `traceId`, `parentId`, `relationship`, `forkPoint`, `cwd`,
      `gitRemote`, `branch`, `model`, `inputTokens`, `outputTokens`,
      `cacheRead`, `cacheWrite`, `toolCount`, `turnCount`, `sourceFormat`,
      `labels`
- [ ] Remove: `adapterName`, `isActive`, `totalTokens`, `isSubAgent`,
      `parentSessionId`, `isCompacted`
- [ ] Add `ToolCall` interface (id, messageId, conversationId, name, input,
      output, isError, durationMs, timestamp)
- [ ] Update `Message`: add `parentMessageId`, `sequence`, `turn`,
      `isSidechain`, `estCost`, `thinkingContent`, `thinkingTokens`.
      Remove `toolUses` (→ tool_calls table), `thinkingBlocks` (→ columns)
- [ ] Update `Adapter` interface: `sessions()` → `conversations()`,
      `messages(sessionId)` → `messages(conversationId)`
- [ ] Add optional typed methods: `newMessages?()`, `conversationForFile?()`
      (Q31 — properly typed, not duck-typed)
- [ ] `SinkConfig` → discriminated union (Q19)
- [ ] `PushPayload` → `{ conversation, messages, toolCalls }`

### 0.2 Store (`src/store.ts`) — Full Rewrite

- [ ] Replace `const SCHEMA` string + `migrate()` with PRAGMA user_version
      migration array (Q9)
- [ ] Migration 0: create v2 schema (conversations, messages, tool_calls,
      _jin_sync, _jin_push_log, FTS5, indexes)
- [ ] Add `branch`, `labels` columns (Q15)
- [ ] Singleton getter `getStore()` — don't run migrations in constructor (Q10)
- [ ] Migrations called explicitly by daemon startup / `jin ingest`, not by
      read-only commands
- [ ] Single `upsertMessages()` — drop `insertMessages()` (Q11)
- [ ] Drop dead code: `unpushedSessions` (Q12), all project methods (Q13),
      all tag methods (Q15), all artifact methods, `tool_usage` methods
- [ ] `sessionsNeedingPush` → `conversationsNeedingPush` (uses `_jin_sync`)
- [ ] Consider splitting into `src/db/` directory if >400 lines remain (Q11)

### 0.3 Config (`src/config.ts`)

- [ ] `RouteMatch`: drop `project`, add `adapter`, `name` (Q15)
- [ ] `RouteMatch` semantics: multiple fields = AND (Q15)
- [ ] Drop `rawDir` from `StoreConfig` (Q4)
- [ ] Drop `syncMode`, `syncIntervalMs` from `TeamConfig` (Q5)
- [ ] `SinkConfig` → discriminated union with `SinkConfigBase` (Q19)

---

## Phase 1: Infrastructure Cleanup

**Goal:** Process lifecycle is clean. No more PID file scattering.

### 1.1 Process State (`src/process-state.ts`) — Merge runguard + lifecycle

- [ ] Merge `runguard.ts` + `lifecycle.ts` into `src/process-state.ts` (Q25)
- [ ] Single `PID_FILE` constant, exported
- [ ] Single `isDaemonRunning()`, `isServiceActive()`, `isServiceInstalled()`
- [ ] Single `stopWatcher()`, `stopDashboard()`, `stopAll()`
- [ ] Add `startDashboard()` — closes start/stop asymmetry (Q25)
- [ ] Delete `runguard.ts`, `lifecycle.ts`

### 1.2 Start Command Cleanup

- [ ] Remove `--service` from `jin start` (Q27) — use `jin service install`
- [ ] Remove `--ui`, `--all` from `jin start` (Q23 — TUI removed)
- [ ] Route `--foreground` through `startCommand`, not directly from index.ts (Q25)
- [ ] Guards live ONLY in `startCommand` (Q29)

### 1.3 Watch Command Cleanup

- [ ] Remove guard block (lines 23-56) — trust caller (Q29)
- [ ] Remove `isRunning()`, `PID_FILE`, `cleanup()` — use process-state (Q25)
- [ ] Remove `daemonize()` — move to process-state (Q25)
- [ ] Trust `JIN_DAEMON` / `JIN_LAUNCHED_BY_SERVICE` env vars (Q30)
- [ ] Extract ingest functions to `src/ingest.ts`
- [ ] Result: ~200 lines — setup → ingest → watch → periodic → shutdown (Q33)

### 1.4 Service Command Cleanup

- [ ] Delete `stopExistingDaemon()` — call `stopWatcher()` from process-state (Q25)

### 1.5 Delete TUI

- [ ] Delete `src/tui/` (6 files) (Q23)
- [ ] Remove `--tui` flag and dynamic import from `index.ts`

---

## Phase 2: Sinks

**Goal:** Postgres sink is INSERT-only. Schema version handshake works.

### 2.1 Postgres Sink Rewrite (`src/sinks/postgres.ts`)

- [ ] Delete `ensureTables()` — all 80 lines of DDL (Q18)
- [ ] Delete `tablesEnsured` flag
- [ ] Add schema version check on connect: read `jin_meta`, compare to
      `SCHEMA_VERSION`, pause if mismatch
- [ ] Update INSERT: `jin_conversations` (v2 columns), `jin_messages` (v2),
      `jin_tool_calls` (new table)
- [ ] Batch tool_calls INSERT alongside messages

### 2.2 Postgres Search Rewrite (`src/sinks/postgres-search.ts`)

- [ ] Delete `ensureSearchSchema()` — same DDL violation (Q18)
- [ ] Update table/column names to v2
- [ ] Extract shared Postgres connection logic with PostgresSink (Q18)

### 2.3 Webhook + S3 Updates

- [ ] Webhook: add `toolCalls` to POST payload body
- [ ] S3: add `toolCalls` to JSON, update key path session→conversation
- [ ] S3: add `pathStyle` config flag, auto-detect R2 region (Q20)

### 2.4 Schema Apply Command (NEW)

- [ ] New file: `src/commands/schema.ts` *(file and CLI route do not exist in `src/` yet — blueprints and ontology describe intended behavior)*
- [ ] `jin schema apply --connection=<url>` — creates Postgres tables + jin_meta
- [ ] Admin-only CLI command, not part of daemon (operator escape hatch; core product story does not depend on it — `docs/blueprint/BP-Product-Strategy.md`)

---

## Phase 3: Adapters — v2 Data Model

**Goal:** Adapters produce Conversations with trace_id, tool_calls, git_remote.

### 3.1 Claude Code Adapter

- [ ] `sessions()` → `conversations()` with v2 fields
- [ ] Compaction splitting: detect boundaries, return multiple Conversations
      linked by trace_id (adapters own splitting — discussion doc §14)
- [ ] Segment IDs: root keeps original, continuations get deterministic hash
- [ ] Extract tool_calls from ContentBlock[] → separate ToolCall objects
- [ ] thinking blocks → `thinkingContent` + `thinkingTokens` columns
- [ ] Resolve `gitRemote` + `branch` from cwd (with cache — Q15)
- [ ] Sub-agent detection → `relationship='spawned'`, `parent_id`
- [ ] Populate `sequence`, `turn`, `isSidechain`, `parentMessageId`

### 3.2 Codex Adapter

- [ ] Same v2 interface changes as Claude Code
- [ ] Compaction splitting (Codex `type: "compaction"` records)
- [ ] Sub-agent capture (`agent_message` records — currently not captured)
- [ ] Tool call extraction from `function_call` / `function_call_output`
- [ ] Reasoning blocks → thinking columns

### 3.3 Cursor Adapter — Multi-Layer Rewrite

- [ ] Primary: Layer 1 (`state.vscdb`) for IDE sessions — tokens, timestamps,
      tool calls, sub-agent links (currently not read at all)
- [ ] Supplement: Layer 2 (`agent-transcripts/`) for sub-agent content and
      CLI sessions
- [ ] Fallback: Layer 3 (`store.db`) for CLI-only edge cases
- [ ] Sub-agent detection from `composerData.subagentComposerIds`
- [ ] Change detection: use `composerData.lastUpdatedAt` per session instead
      of file-level stat cache (Q32)

### 3.4 Simple Adapters (Amp, Gemini, Kiro, OpenCode, Pi, PiAgent, Warp)

- [ ] Session → Conversation rename throughout
- [ ] `relationship = 'root'`, `traceId = id` for all
- [ ] `gitRemote` + `branch` from cwd where applicable
- [ ] Shared-DB adapters (Kiro, Warp): adapter-internal change detection (Q32)

---

## Phase 4: Routing + Ingest Pipeline

**Goal:** Routing works with v2 fields. Ingest pipeline is clean.

### 4.1 Routing (`src/routing.ts`)

- [ ] Implement glob matching (not string equality — Q15 bug fix)
- [ ] AND semantics for multiple fields in one RouteMatch
- [ ] Read `conversation.gitRemote` + `conversation.cwd` directly (no join)
- [ ] Delete `ProjectInfo` interface, `getSessionProjects()` calls
- [ ] Add `adapter` and `name` matching

### 4.2 Tagger Removal

- [ ] Delete `src/tagger.ts` entirely
- [ ] Remove all `autoTagSession` calls from watch.ts, ingest.ts
- [ ] `gitRemote` + `branch` populated by adapters, not tagger
- [ ] `git_remote get-url origin` cache by cwd within ingest pass (Q15)

### 4.3 Ingest Refactor

- [ ] Extract ingest logic from watch.ts to `src/ingest.ts` (Q33)
- [ ] **Drop `ingestSingleFile()` entirely.** It assumes one file change =
      one session, which is only true for Claude Code. Shared-DB adapters
      (Cursor, Kiro, Warp) need to re-scan all sessions on any file change.
- [ ] **Change detection is the adapter's responsibility.** The ingest layer
      calls `adapter.conversations()` on each watcher event. The adapter
      knows its own storage model and returns only changed conversations:
      - Claude Code: offset cache → only re-parse changed JSONL
      - Cursor: check `composerData.lastUpdatedAt` per session in vscdb
      - Codex: stat per JSONL file (file-per-session, like Claude Code)
      - Kiro/Warp: adapter-internal DB query for changed sessions
- [ ] Remove duck-typed `newMessages` / `sessionForFile` — adapter handles
      delta logic internally via `conversations()` + `messages()` (Q31)
- [ ] Remove file-level stat cache from ingest layer — adapters own their
      own change detection (Q32)
- [ ] Remove empty `catch {}` blocks — log errors

---

## Phase 5: CLI + API Surface

**Goal:** Commands use v2 terminology and schema.

### 5.1 Command Updates

- [ ] `jin sessions` → `jin conversations` (or keep `sessions` as alias)
- [ ] `jin show <id>` → add `--trace`, `--tree` flags
- [ ] `jin stats` → use `conversations` table, add `git_remote` grouping
- [ ] `jin search` → update table references
- [ ] `jin export` → add tool_calls to output
- [ ] `jin status` → show schema version for each sink
- [ ] `jin connect` → routing changes for `git_remote` matching

### 5.2 API Routes (`src/api/routes.ts`)

- [ ] All endpoints: sessions → conversations
- [ ] `enrichedSessions` → simple SELECT (no joins — Q17)
- [ ] `getSessionTree` → `WHERE trace_id = ?`
- [ ] `costByProjectAndTool` → `GROUP BY git_remote, adapter_id`
- [ ] Add tool_calls to session detail response

### 5.3 Index.ts (`src/index.ts`)

- [ ] Command renames in help text
- [ ] Route all start paths through startCommand (Q30)
- [ ] Add `jin schema apply` command
- [ ] Remove TUI references

---

## Phase 6: Prismatic Coordination

**Goal:** Prismatic reads v2 tables.

### 6.1 Prismatic Migration

- [ ] Drop `jin_sessions`, `jin_messages` tables
- [ ] Create `jin_conversations` (v2), `jin_messages` (v2), `jin_tool_calls`
- [ ] Create `jin_meta` with schema version
- [ ] Clear `prismatic.*` enrichment tables
- [ ] Update all Prismatic queries (~30) to use v2 table/column names
- [ ] Update Drizzle schema definitions

### 6.2 Deploy Sequence

1. Prismatic migration runs (Postgres schema updated)
2. Jin binary ships (via MDM or manual update)
3. Jin daemons restart → fresh store.db → re-ingest → push to Postgres
4. Prismatic pipeline re-assesses and re-summarizes as data arrives

---

## Phase 7: Misc Cleanup

- [ ] Pricing: external `pricing.json` file instead of hardcoded (Q7)
- [ ] Config file locking or daemon-owns-writes pattern (Q6)
- [ ] Self-observation: inline into watch.ts (Q8)
- [ ] Service: add resource limits to macOS launchd plist (Q28)
- [ ] Windows: fix locale-dependent `isServiceActive` string comparison (Q24)
- [ ] Add unit tests for `isDaemonRunning` PID logic (Q24)

---

## Adapter Validation Plan: Cursor + Codex

Both adapters are "largely unproved" per the code review. Before shipping v2,
each needs a rigorous data validation pass against real source files.

### Cursor Validation

**Current state:** Adapter reads Layer 3 (`store.db`) only. Misses tokens,
tool calls, thinking blocks, timestamps, sub-agents. Layer 1 (`state.vscdb`)
has all of this but isn't read.

**Step 1: Data Collection (manual)**

Collect a test corpus from a real Cursor installation:

```
test/fixtures/cursor/
  state.vscdb                    # copy of globalStorage/state.vscdb
  agent-transcripts/             # copy of a project's agent-transcripts/
    <uuid-1>/
      <uuid-1>.jsonl             # root agent
      subagents/
        <sub-uuid>.jsonl         # sub-agent
    <uuid-2>/
      <uuid-2>.jsonl             # another session
  chats/<hash>/<session>/
    store.db                     # CLI blob store (current adapter target)
```

Sanitize: strip sensitive content from messages but preserve structure,
field names, token counts, tool call names, timestamps.

**Step 2: Layer-by-Layer Verification**

For each layer, write a test that:
1. Reads the fixture
2. Asserts expected conversation count
3. Asserts expected message count per conversation
4. Asserts specific fields are populated (not zero/empty when data exists)

```
test/cursor-layer1.test.ts — state.vscdb
  - [ ] Can read composerData entries → Conversations
  - [ ] composerId maps to Conversation.id
  - [ ] name, createdAt, lastUpdatedAt populated
  - [ ] modelConfig.modelName → Conversation.model
  - [ ] subagentComposerIds → spawned relationships
  - [ ] bubbleId entries → Messages with correct conversation linkage
  - [ ] bubbleId.type 1→user, 2→assistant role mapping
  - [ ] bubbleId.tokenCount → inputTokens, outputTokens (non-zero)
  - [ ] bubbleId.createdAt → real per-message timestamps (not interpolated)
  - [ ] bubbleId.toolFormerData → ToolCall rows with name, input
  - [ ] bubbleId.allThinkingBlocks → thinkingContent populated

test/cursor-layer2.test.ts — agent-transcripts
  - [ ] JSONL files found and parsed
  - [ ] role mapping: user, assistant
  - [ ] tool_use content blocks → ToolCall rows (name + input, no output)
  - [ ] subagents/ directory → spawned relationship with parent
  - [ ] Directory UUID → Conversation.id
  - [ ] Conversation without Layer 1 entry still ingests (CLI-only sessions)

test/cursor-layer3.test.ts — store.db (current adapter)
  - [ ] Blob tree traversal produces messages in correct order
  - [ ] Protobuf blobs are skipped gracefully (not crash)
  - [ ] JSON blobs with reasoning → thinkingContent
  - [ ] JSON blobs with tool-call → ToolCall rows
  - [ ] JSON blobs with tool-result → matched to prior tool-call output

test/cursor-cross-layer.test.ts — Layer correlation
  - [ ] composerData.composerId (L1) = transcript directory UUID (L2)
  - [ ] composerData.subagentComposerIds (L1) = subagents/*.jsonl (L2)
  - [ ] Layer 1 sessions that have no Layer 2 transcript: IDE-only, valid
  - [ ] Layer 2 sessions that have no Layer 1 entry: CLI-only, valid
  - [ ] No duplicate conversations from reading both layers
```

**Step 3: v2 Field Coverage Matrix**

For each v2 Conversation/Message/ToolCall field, document where Cursor
provides it:

```
test/cursor-coverage.test.ts
  - [ ] Conversation.traceId: root = id, spawned = parent's traceId
  - [ ] Conversation.parentId: from subagentComposerIds
  - [ ] Conversation.relationship: root or spawned (no compaction in Cursor)
  - [ ] Conversation.gitRemote: from cwd (Layer 1 doesn't store cwd —
        need to check if it's in the workspace path or needs git command)
  - [ ] Conversation.branch: same question as gitRemote
  - [ ] Conversation.model: from modelConfig.modelName
  - [ ] Message.sequence: from bubble order in fullConversationHeadersOnly
  - [ ] Message.turn: computed from role transitions
  - [ ] Message.parentMessageId: from blob parentId (Layer 3) or
        bubble order (Layer 1)
  - [ ] ToolCall.name: from toolFormerData.name (L1) or tool_use.name (L2)
  - [ ] ToolCall.input: from rawArgs (L1) or tool_use.input (L2)
  - [ ] ToolCall.output: NOT AVAILABLE in Layer 2 transcripts.
        Available in Layer 3 tool-result blobs. Layer 1 unknown — investigate.
```

**Step 4: Change Detection Test**

```
test/cursor-change-detection.test.ts
  - [ ] Modify one session in state.vscdb fixture → only that session
        re-ingested (not all 65)
  - [ ] Use composerData.lastUpdatedAt for per-session change detection
  - [ ] New session added to state.vscdb → detected and ingested
  - [ ] New agent-transcript JSONL file → detected and ingested
```

### Codex Validation

**Current state:** Adapter reads JSONL from `~/.codex/sessions/`. Handles
bare format and RolloutLine envelope. Does NOT capture sub-agents
(`agent_message` records, `agent_jobs` table in `state_5.sqlite`).

**Step 0: Investigation**

No Codex investigation doc exists (unlike Cursor). First task:

```
docs/adapters/codex/
  overview.md        — storage architecture (JSONL + state_5.sqlite)
  investigation.md   — how data was discovered
  examples.md        — real data samples (sanitized)
```

Key questions to answer:
- [ ] What record types exist in Codex JSONL? Full enumeration like the
      Claude Code survey (749 files → record type counts)
- [ ] How does `state_5.sqlite` relate to the JSONL files?
- [ ] What's in `agent_jobs` + `agent_job_items` tables?
- [ ] What's in `threads` table (`agent_nickname`, `agent_role` columns)?
- [ ] How are sub-agents represented? Is there a parent-child link?
- [ ] Does Codex support compaction? What does the record look like?
- [ ] What token fields are available per record type?

**Step 1: Data Collection**

```
test/fixtures/codex/
  sessions/
    <session-1>.jsonl     # bare format
    <session-2>.jsonl     # RolloutLine envelope format
    <session-3>.jsonl     # session with compaction
    <session-4>.jsonl     # session with agent_message (sub-agent)
  state_5.sqlite          # copy of state database
```

**Step 2: JSONL Format Verification**

```
test/codex-jsonl.test.ts
  - [ ] Bare format records parsed correctly
  - [ ] RolloutLine envelope unwrapped (payload extracted)
  - [ ] All observed record types handled:
        message, function_call, function_call_output, reasoning, compaction
  - [ ] Unknown record types don't crash (graceful skip)

test/codex-messages.test.ts
  - [ ] type:"message" → correct role, content
  - [ ] type:"function_call" → ToolCall with name + input (arguments)
  - [ ] type:"function_call_output" → matched to prior function_call → output
  - [ ] type:"reasoning" → thinkingContent + thinkingTokens
  - [ ] type:"compaction" → boundary detection, summary text extraction
  - [ ] Token fields: usage.input_tokens, output_tokens, cached_input_tokens
```

**Step 3: Compaction + Sub-Agent Tests**

```
test/codex-compaction.test.ts
  - [ ] Compaction record detected → file splits into N conversations
  - [ ] Root conversation keeps original ID
  - [ ] Continuation gets deterministic hash ID
  - [ ] trace_id links all segments
  - [ ] parent_id chains sequentially
  - [ ] Summary text correctly assigned to continuation's first message

test/codex-subagent.test.ts
  - [ ] agent_message records detected
  - [ ] Sub-agent conversations created with relationship='spawned'
  - [ ] parent_id points to parent conversation
  - [ ] trace_id inherited from parent
  - [ ] state_5.sqlite agent_jobs table cross-referenced (if applicable)
```

**Step 4: v2 Field Coverage**

```
test/codex-coverage.test.ts
  - [ ] Conversation.traceId: correct for compacted chains
  - [ ] Conversation.relationship: root, compacted, spawned
  - [ ] Conversation.model: tracked across records
  - [ ] Conversation.gitRemote: from cwd in session metadata
  - [ ] Message.sequence: from JSONL line order
  - [ ] Message.turn: from role transitions
  - [ ] ToolCall.name: from function_call.name
  - [ ] ToolCall.input: from function_call.arguments
  - [ ] ToolCall.output: from function_call_output.output
  - [ ] ToolCall.isError: detect error responses
```

### Shared Test Infrastructure

```
test/helpers/
  fixtures.ts          — load test fixtures from test/fixtures/
  assertions.ts        — shared assertion helpers:
    assertConversationValid(conv)  — all required v2 fields present
    assertMessageValid(msg)        — role, content, timestamp non-empty
    assertToolCallValid(tc)        — name non-empty, conversationId set
    assertTraceIntegrity(convs)    — trace_id consistent, parent_id valid
    assertNoDuplicateIds(convs)    — no ID collisions
```

### Test Execution Order

1. Fixture collection (manual, one-time)
2. Layer/format tests (pure parsing, no Store dependency)
3. Integration tests (adapter → Store → verify DB state)
4. Cross-adapter consistency (same conversation ingested by multiple
   adapters produces compatible output shapes)

### CI Integration

- [ ] Cursor fixtures committed to `test/fixtures/cursor/` (sanitized)
- [ ] Codex fixtures committed to `test/fixtures/codex/` (sanitized)
- [ ] `npm test` runs all adapter validation tests
- [ ] CI matrix: macOS + Linux (Cursor paths differ by platform)
- [ ] Windows CI: verify path handling for `%APPDATA%` Cursor paths

---

## Cross-Reference: Q&A Findings → Roadmap Tasks

| QA # | Finding | Phase |
|------|---------|-------|
| Q1 | Types/SQLite schema drift | 0.1, 0.2 |
| Q4 | rawDir is dead plumbing | 0.3 |
| Q5 | syncMode/syncIntervalMs dead config | 0.3 |
| Q6 | Config file write race | 7 |
| Q7 | Pricing hardcoded | 7 |
| Q8 | Self-observation should be inlined | 1.3 |
| Q9 | Schema as const string → migration array | 0.2 |
| Q10 | Store singleton, don't migrate in constructor | 0.2 |
| Q11 | insertMessages/upsertMessages duplication; store.ts crowded | 0.2 |
| Q12 | unpushedSessions is dead code | 0.2 |
| Q13 | All project methods dead in v2 | 0.2 |
| Q14 | v2 config→routing mental model | 4.1 |
| Q15 | Routing gaps, tags dead, branch/labels columns, git cache | 0.2, 4.1, 4.2 |
| Q16 | Model per-message — verify real data | Adapter validation |
| Q17 | FTS5 stays; dashboard methods rewritten | 0.2, 5.2 |
| Q18 | Sinks: DDL in search, duplicated connections, PushPayload | 2.1, 2.2, 2.3 |
| Q19 | SinkConfig discriminated union | 0.3 |
| Q20 | S3 keep generic, add pathStyle + R2 detection | 2.3 |
| Q21 | Each platform gets its own sink, webhook = escape hatch | Future |
| Q22 | Webhook healthCheck barely useful | 2.3 |
| Q23 | Delete TUI | 1.5 |
| Q24 | Service checks untested, Windows locale bug | 7 |
| Q25 | Merge runguard + lifecycle → process-state.ts | 1.1 |
| Q26 | Keep daemon mode, fix PID scattering | 1.1 |
| Q27 | Remove --service from jin start | 1.2 |
| Q28 | macOS launchd missing resource limits | 7 |
| Q29 | Guards duplicated across start.ts and watch.ts | 1.2, 1.3 |
| Q30 | Execution-level cycles via process spawning | 1.2, 1.3 |
| Q31 | newMessages duck typing | 4.3 |
| Q32 | Stat cache broken for shared-DB adapters | 4.3 |
| Q33 | watch.ts does 8 jobs | 1.3, 4.3 |
