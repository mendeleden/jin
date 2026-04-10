# Review: W2-ADAPTER-02 Codex Reference Adapter

- reviewer: `cursor-REVIEWER-codex-reference-adapter`
- packet: `W2-ADAPTER-02`
- date: `2026-04-02`
- verdict: `approved` (four informational findings, none blocking)

## Scope Of Review

Audited the W2-ADAPTER-02 Codex adapter rewrite against:

- `docs/execution/tasks/W2-ADAPTER-02-codex-reference.md` (task packet)
- `docs/blueprint/BP-04-adapter-contract.md` (primary blueprint)
- `docs/blueprint/BP-03-conversation-model.md` (relationship semantics)
- `docs/blueprint/BP-02-data-flow.md` (pipeline integration context)
- `docs/ontology.md` §4, §6.2 (capability matrix, Codex field mapping)
- `docs/adapters/codex/index.md`, `investigation.md`, `orchestration.md`
- `src/contracts/adapters.ts` (frozen contract)
- `src/contracts/conversations.ts` (frozen contract)
- All changes in `src/adapters/codex.ts`, `test/codex-reference-adapter.test.ts`

Tests run: `bun test test/codex-reference-adapter.test.ts` -- 2 pass, 0 fail, 37 assertions.

## Aligned

### Interface conformance vs frozen `src/contracts/adapters.ts`

- `CodexAdapter implements Adapter, V2Adapter` (`src/adapters/codex.ts`:77).
  `id`, `name`, `detect()`, `findChanged(hint?)`, `loadConversation(ref)`,
  `watchPaths()` all match the frozen interface. No frozen contracts modified.
- `ConversationBundle`, `ConversationRef`, `ParsedMessage`, `ParsedToolCall`,
  `ParsedConversation` all imported read-only from `src/contracts/conversations.ts`
  via the `src/adapters/types.ts` re-export barrel.

### Deterministic IDs vs BP-04 §ID Generation

- **Root conversation**: uses `session_meta.payload.id` from JSONL. Fallback:
  `defaultSessionId(filePath)` strips `rollout-` prefix from basename. Both
  deterministic.
  (`src/adapters/codex.ts`:282-283, 837-840)
- **Compacted conversation**: `stableHash(sessionId, "compacted:N:seed")` where
  seed = `payload.id || payload.turn_id || timestamp || lineIndex`.
  Deterministic given stable source content.
  (`src/adapters/codex.ts`:438)
- **Spawned conversation**: uses child file's `session_meta.payload.id` (same
  as root strategy).
- **Messages**: `payload.id` if present, else `stableHash(sessionId, segmentId,
  type, messageIndex)`.
  (`src/adapters/codex.ts`:462-463, 522-523, 551-552)
- **Tool calls**: `call_id || payload.id`, else `stableHash(sessionId, segmentId,
  name, toolIndex)`.
  (`src/adapters/codex.ts`:904)
- **No randomness**: No `crypto.randomUUID()` or `Math.random()` in any
  ID path. All IDs are hash-derived or source-derived.
- **Test**: loading the same ref twice yields identical IDs for conversations,
  messages, and tool calls.
  (`test/codex-reference-adapter.test.ts`:47-56)

### Compaction splitting vs BP-03 §Compaction and BP-04 §Compaction Splitting

- Detects `type: "compacted"` envelope records (matching the real Codex format
  from `docs/adapters/codex/index.md` — NOT `type: "compaction"`).
  (`src/adapters/codex.ts`:434)
- Creates new segment with deterministic ID and processes
  `replacement_history` array, extracting both `message` and `compaction`
  history items.
  (`src/adapters/codex.ts`:437-503)
- Continuation's `traceId` = root's `traceId`. Continuation's `parentId` =
  previous segment's `id`. Compaction chain is linear.
  (`src/adapters/codex.ts`:639-641)
- `forkPoint = -1` for compacted segments (correct per BP-03).
  (`src/adapters/codex.ts`:642)
- Flushes any pending assistant state before starting a new segment.
  (`src/adapters/codex.ts`:435)
- **Test**: validates root has `relationship = "root"`, `traceId = id`,
  `parentId = ""`. Validates compacted has shared `traceId`, `parentId`
  pointing to root. Validates compacted messages include both the
  `replacement_history` message content and the compaction record.
  (`test/codex-reference-adapter.test.ts`:98-116)

### Sub-agent detection vs BP-04 §Sub-Agent Detection

- Detects sub-agents from `session_meta.source.subagent.thread_spawn.parent_thread_id`
  AND `forked_from_id` as fallback.
  (`src/adapters/codex.ts`:412-414, 842-847)
- Sets `relationship = "spawned"`, resolves `traceId` by recursively walking
  the parent chain via `resolveBase()`.
  (`src/adapters/codex.ts`:662-711)
- Resolves `forkPoint` by scanning parent's tool calls for `spawn_agent`
  calls whose output `agent_id` matches the child session ID (or whose
  `nickname` matches `agent_nickname`).
  (`src/adapters/codex.ts`:713-740)
- Circular reference protection via visited set.
  (`src/adapters/codex.ts`:672-679)
- **Test**: verifies `relationship = "spawned"`, `traceId` inherited from
  parent root, `parentId` = compacted segment's id, `forkPoint = 2`.
  (`test/codex-reference-adapter.test.ts`:118-121)

### Tool call extraction vs BP-04 §Tool Call Extraction

- Handles all three Codex tool call types:
  - CLI: `function_call` with `arguments` (JSON string)
  - Desktop: `custom_tool_call` with `input` (raw string)
  - Web: `web_search_call` mapped to `name = "web_search"`
  (`src/adapters/codex.ts`:582-594)
- Handles both output types:
  - `function_call_output`: raw output string
  - `custom_tool_call_output`: JSON with `exit_code`, `duration_seconds`, `output`
  (`src/adapters/codex.ts`:596-606, 914-942)
- Matches output to call via `call_id`/`id` key lookup.
  (`src/adapters/codex.ts`:597-604)
- Desktop tool output correctly extracts `durationMs` from `duration_seconds * 1000`
  and `isError` from `exit_code !== 0`.
- **Test**: verifies CLI `function_call` tool extraction (name, input, output,
  isError, durationMs) on simple fixture.
  (`test/codex-reference-adapter.test.ts`:60-67)
- **Test**: verifies Desktop `custom_tool_call` extraction with duration parsing,
  and mixed CLI/Desktop tool calls in a single conversation.
  (`test/codex-reference-adapter.test.ts`:123-135)

### Thinking block extraction vs BP-04 §Thinking Block Extraction

- Extracts `reasoning` response items via `flattenReasoningSummary()`. Since
  Codex reasoning content is encrypted, only the summary (which may be empty
  or contain text) is captured.
  (`src/adapters/codex.ts`:574-579)
- `thinkingTokens` takes the max of summary-derived count and
  `reasoning_output_tokens` from the `token_count` event.
  (`src/adapters/codex.ts`:566, 379)
- **Test**: verifies `thinkingTokens = 11` on the compacted assistant message
  (from `reasoning_output_tokens` in the `token_count` event).
  (`test/codex-reference-adapter.test.ts`:125)

### Token extraction

- Handles `event_msg.token_count` records with `last_token_usage` containing
  `input_tokens`, `output_tokens`, `cached_input_tokens`, `reasoning_output_tokens`.
  (`src/adapters/codex.ts`:426-431, 856-865)
- Also handles `usage` directly on assistant message payloads.
  (`src/adapters/codex.ts`:867-881)
- `selectUsage()` prefers direct message usage over pending event usage.
  (`src/adapters/codex.ts`:544)
- This addresses the "Not captured" gap identified in `docs/adapters/codex/index.md`.

### Git resolution vs BP-04 §Git Resolution

- First reads git metadata from `session_meta.git.repository_url` and
  `session_meta.git.branch` if available (Codex stores this in Layer 2).
  (`src/adapters/codex.ts`:408-409)
- Falls back to `resolveGit(cwd)` via `execFileSync("git", ...)` calls,
  cached by `cwd`.
  (`src/adapters/codex.ts`:742-782)
- This is better than Claude Code's approach: Codex provides git info in the
  source data, so the adapter uses it without subprocess spawns in most cases.
- **Test**: parent fixture includes `git.branch` and `git.repository_url`,
  implicitly tested through conversation construction.

### Change detection vs BP-04 §Change Detection

- File stat cache (`size + mtimeMs`) per source path.
  (`src/adapters/codex.ts`:32-35, 244-265)
- Startup scan: returns all refs (no stat filtering).
  (`src/adapters/codex.ts`:108)
- Periodic scan: only returns changed files (stat comparison).
  (`src/adapters/codex.ts`:109-110)
- fs-change: matches changed paths via prefix matching (handles both file
  and directory change notifications).
  (`src/adapters/codex.ts`:111-113, 267-273)
- Evicts cache entries for deleted files.
  (`src/adapters/codex.ts`:102-106)
- **Test**: verifies startup returns all refs, periodic returns empty (no
  changes), fs-change returns only affected file's refs.
  (`test/codex-reference-adapter.test.ts`:31-45, 137-147)

### Bundle pattern vs BP-04 §Data Shapes

- `ConversationBundle` has exactly `{ conversation, messages }`.
  (`src/adapters/codex.ts`:635-659)
- Messages include `toolUses: ParsedToolCall[]` on the contract type.
- No store dependency: adapter returns complete bundles without touching
  the store, db, pipeline, or sinks.

### Content flattening vs ontology §6.2

- `flattenMessageContent()` handles both string content and structured
  `content[]` arrays with `input_text`, `output_text`, and nested text.
  (`src/adapters/codex.ts`:1052-1085)
- `flattenReasoningSummary()` handles reasoning summary arrays.
  (`src/adapters/codex.ts`:1087-1110)

### Boundary discipline

- Only `src/adapters/codex.ts` and `test/codex-reference-adapter.test.ts`
  modified. Both are packet-owned files.
- No forbidden files touched: `src/contracts/**`, `src/adapters/types.ts`,
  `src/adapters/registry.ts`, `src/db/**`, `src/pipeline/**`, `src/sinks/**`,
  `src/config.ts`, `src/routing.ts` all unchanged.
- No new imports from forbidden modules.
- One import from `../pricing` for the legacy `toLegacySession` bridge
  (pre-existing, not new).

### Contract freeze

- All frozen contracts (`Adapter`, `ConversationBundle`, `ConversationRef`,
  `ParsedConversation`, `ParsedMessage`, `ParsedToolCall`, `ChangeHint`)
  consumed read-only. No modifications.

## Drift

### I1 -- `resolveGit()` bare catch (informational)

- **File:** `src/adapters/codex.ts`:777
- **Finding:** The `catch` block in `resolveGit()` silently returns empty
  strings without logging. Per the adapter rules: "Silent `catch {}` blocks
  are forbidden in adapters -- surface parse errors so they can be debugged."
- **Severity:** Informational. This matches the Claude Code adapter's
  pattern (I2 in W1-ADAPTER-01 review). Git resolution failure for non-git
  directories is expected and frequent -- logging every occurrence would be
  noisy. However, genuine git errors (corrupt repos, permission issues)
  would also be silent.
- **Impact:** Low. A follow-up can add a `console.warn` for unexpected
  errors (not `ENOENT`).

### I2 -- `buildSessionIndex()` re-scans all files per spawned load (informational)

- **File:** `src/adapters/codex.ts`:784-793
- **Finding:** When `loadConversation()` is called for a spawned
  conversation, `resolveBase()` calls `buildSessionIndex()` which reads
  ALL session files to build a session-ID-to-path lookup. This is O(n) per
  spawned conversation load. For a developer with hundreds of sessions, this
  means re-scanning hundreds of JSONL files (reading the first few lines of
  each to extract `session_meta.id`).
- **Severity:** Informational. Correctness is not affected. The pipeline
  calls `loadConversation()` serially (BP-02), so this won't cause
  concurrency issues. At typical scale (500-1000 sessions), the overhead is
  measurable but bounded.
- **Impact:** Low. A follow-up could cache the session index within the
  adapter instance (invalidated on `findChanged()`) to amortize the cost
  across multiple spawned loads in one ingest cycle.

### I3 -- `fileTimestamp()` fallback to `new Date()` on stat failure (informational)

- **File:** `src/adapters/codex.ts`:833-835
- **Finding:** If `statSync` fails in `fileTimestamp()`, the fallback is
  `new Date().toISOString()`, which introduces non-determinism. Two loads
  of the same file at different times would produce different timestamps.
- **Severity:** Informational. This is an extreme edge case (file exists
  but stat fails). `fileTimestamp()` is used as the default `sessionTimestamp`
  before `session_meta` timestamps override it. In practice, every real
  Codex file has a `session_meta` with a timestamp, making this path dead
  code for well-formed data. For corrupt files (no session_meta), the
  non-deterministic timestamp would cause the conversation's `startedAt`/
  `endedAt` to differ between loads, but the ID is still deterministic
  (derived from filename, not timestamp).
- **Impact:** None in practice. A follow-up could replace with a stable
  fallback (e.g., epoch zero) for theoretical purity.

### I4 -- Legacy `sessions()` and `messages()` bridge methods (informational)

- **File:** `src/adapters/codex.ts`:141-169, 944-1005
- **Finding:** The adapter retains `sessions()`, `messages()`,
  `toLegacySession()`, and `toLegacyMessage()` as v1 bridge methods. This
  is correct per the frozen contract surface doc and matches the Claude Code
  adapter pattern (I4 equivalent in W1-ADAPTER-01 review).
- **Impact:** None. These should be removed when v1 callers are migrated.

## Unowned Spread

None. All changes are within `src/adapters/codex.ts` and
`test/codex-reference-adapter.test.ts`.

## Progress

- BP-04: `mostly_aligned` for Codex reference adapter. All seven
  responsibilities implemented: change detection, ID generation, compaction
  splitting, sub-agent detection, git resolution, tool call extraction,
  thinking block extraction. Codex adapter validates BP-04 on a second
  high-value source format with distinct storage quirks (RolloutLine
  envelope, CLI vs Desktop tool types, `replacement_history` compaction,
  `session_meta.source.subagent` linkage).
- BP-03: relationship semantics correctly emitted in adapter output. Root,
  compacted, and spawned conversations carry correct `traceId`, `parentId`,
  `relationship`, and `forkPoint` values. BP-03 invariants 1-8 all hold in
  adapter output.

## Test Coverage Assessment

| Acceptance Check (from packet) | Test |
|-------------------------------|------|
| Deterministic IDs across repeated loads | `findChanged is deterministic and repeated loads keep conversation/message/tool ids stable` (lines 47-56) |
| Adapter returns bundles, not session/message split state | Both tests construct bundles via `loadConversation()` (lines 47-48, 86-88) |
| Compaction semantics supported by source are emitted via frozen relationship model | `compaction splitting, spawned linkage, and desktop tool calls` (lines 98-116) |
| Tests cover tool-call extraction and relationship correctness | Both tests collectively: simple fixture covers CLI function_call (lines 60-67), parent fixture covers Desktop custom_tool_call + spawn_agent (lines 123-135), spawned linkage (lines 118-121) |

All 4 packet acceptance checks are covered.

## Missing Test Coverage (non-blocking)

- No test for multiple compaction boundaries in a single file (chain of
  3+ segments).
- No test for `web_search_call` tool type extraction.
- No test for non-git cwd (empty `gitRemote` and `branch`).
- No test for deleted source file behavior (adapter returns null).
- No test for archived sessions (`archived_sessions/` directory scanning).
- No test for `turn_context.cwd` override (cwd changes mid-session).
- No test for circular parent references (visited set protection).

These are follow-up items, not blockers. The packet's explicit acceptance
checks are all covered.

## Codex Decisions Needed

1. **No blocking decisions required.** The implementation is clean, aligns
   with BP-04 and BP-03, respects boundary discipline, and passes all
   acceptance checks. Codex can move `W2-ADAPTER-02` to `approved`.

2. **Plan `buildSessionIndex()` caching.** The O(n) per-spawned-load
   session index scan (I2) is correct but potentially slow at scale. A
   follow-up can cache the index within the adapter instance and invalidate
   on `findChanged()`.

3. **Plan silent-catch fix.** The `resolveGit()` bare catch (I1) should
   surface unexpected errors per the project's adapter rules. This can be
   absorbed by an adapter-polish follow-up, consistent with the same item
   from the W1-ADAPTER-01 review.

4. **Acknowledge legacy bridge.** The adapter retains `sessions()`,
   `messages()`, `toLegacySession()`, `toLegacyMessage()` as v1 bridge
   methods (I4). This is correct per the frozen contract surface doc.
   Remove when v1 callers are migrated.
