# Review: W2-ADAPTER-03 Cursor Reference Adapter (Re-Review)

- reviewer: `cursor-REVIEWER-cursor-reference-adapter`
- packet: `W2-ADAPTER-03`
- date: `2026-04-02`
- prior review: `2026-04-02-W2-ADAPTER-03-cursor` (verdict: `needs_codex`)
- verdict: `approved` (all prior blockers resolved; three informational items remain)

## Scope Of Review

Re-reviewed the Cursor adapter after Codex fix pass, against:

- `src/contracts/conversations.ts` (frozen `ParsedConversation`, `ParsedMessage`, `ParsedToolCall`)
- `src/contracts/adapters.ts` (frozen `Adapter` interface)
- `docs/blueprint/BP-04-adapter-contract.md`
- `docs/blueprint/BP-03-conversation-model.md`
- `src/adapters/cursor.ts` (1311 lines, post-fix)
- `test/cursor-adapter.test.ts` (380 lines, post-fix)

Tests run: `bun test test/cursor-adapter.test.ts` -- 5 pass, 0 fail, 48 assertions.
Typecheck: `tsc --noEmit src/adapters/cursor.ts test/cursor-adapter.test.ts` -- clean.

## Prior Findings: Resolution Status

### P1 `toolUses`/`toolCalls` field mismatch -- RESOLVED

The adapter now constructs `ParsedMessage` objects with `toolUses` directly
(cursor.ts:439, 459, 680). The helper is renamed `buildLayer1ToolUses`.
Layer 3 extraction returns `toolUses` (cursor.ts:1034-1036). The duplicate
`tool_calls` and `toolCalls` fields are gone.

Tests assert on `message.toolUses[0]?.name` (test:135, 138, 151, 207, 210)
using the real contract type, not `as any`.

### P1 `as unknown as` type-safety bypass -- RESOLVED

Both `loadLayer1Conversation` and `loadLayer3Conversation` now construct
`ParsedConversation` and `ParsedMessage` objects directly with typed
literals (cursor.ts:475-494, 663-681, 699-715). The `asParsedConversation`,
`asParsedMessage`, and `asParsedToolCall` helper functions are removed.
`ParsedToolCall` objects are also constructed as typed literals
(cursor.ts:1017-1027, 1087-1095).

Extra non-contract fields (`title`, `adapterName`, `trace_id`, `parent_id`,
`tool_calls`, `toolCallCount`, `durationMs`, `totalTokens`,
`totalInputTokens`, `totalOutputTokens`, `messageCount`, `metadata`) are all
eliminated from the v2 bundle path. Legacy fields are confined to
`toLegacySession`/`toLegacyMessage`.

Tests access contract fields directly without `as any` (test:126-143,
199-221).

### P2 `thinkingTokens` never set -- RESOLVED

Both layers now explicitly set `thinkingTokens: 0` (cursor.ts:457, 678).
Layer 3 extraction returns `thinkingTokens` (cursor.ts:1037, 1123).
Tests verify: `message.thinkingTokens === 0` (test:142, 220).

### P2 Turn detection `turn = sequence` -- RESOLVED

New `nextTurnNumber()` function (cursor.ts:1197-1206) increments on
`role === "user"`, matching the ontology Section 2.2 role-transition
strategy. Both Layer 1 (cursor.ts:437-438) and Layer 3 (cursor.ts:661)
use it. Tests verify: user and assistant in same turn share `turn: 0`
(test:133-134, 150, 205-206).

### P2 `cwd`/`gitRemote`/`branch` always empty -- PARTIALLY RESOLVED

New `resolveCursorCwd()` function (cursor.ts:1256-1276) tries multiple
candidate keys from the raw source data (`cwd`, `workingDirectory`,
`workspacePath`, `workspaceRoot`, `projectPath`, `path`). Both Layer 1
(cursor.ts:474) and Layer 3 (cursor.ts:698) call it. `gitRemote` and
`branch` remain empty -- this is correct since there is no automated
`git remote get-url origin` call (which would require the `cwd` to be
populated first, and Cursor sources don't reliably provide it).

This is acceptable as-is. When cwd is available from source data, it will
be picked up. Git resolution can be a follow-up when the pipeline has a
shared git-resolution utility.

### P2 Invented `"tool"` record type -- RESOLVED

Both layers now set `recordType: ""` unconditionally (cursor.ts:445, 667).
Tests verify: `message.recordType === ""` (test:143).

### P3 Silent `catch {}` blocks -- RESOLVED

All four previously-silent catches now call `logCursorWarning()` with a
descriptive message and the error detail (cursor.ts:332, 412-413, 633-634,
757-758). `openReadonlyDb` also logs (cursor.ts:856-857). The
`logCursorWarning` function (cursor.ts:1278-1281) formats the error and
writes to `console.warn`. This satisfies the adapter rule.

Two utility functions (`parseJsonObject`, `decodeHexJsonObject`) still
have bare `catch` blocks (cursor.ts:907-909, 921-922), but these are
data-parsing helpers where the input is untrusted external data -- silently
returning `null` for unparseable individual records is appropriate and
doesn't mask adapter-level failures.

### P3 `durationMs` default `0` on tool calls -- RESOLVED

Tool call `durationMs` is now `-1` (cursor.ts:1025, 1093), matching the
ontology's "unknown" sentinel.

## Remaining Informational Items (Not Blocking)

### I1: `gitRemote` and `branch` are always empty

As noted above, Cursor source data rarely provides `cwd`, so git resolution
cannot run. This is a known source-data gap, not an adapter bug. The adapter
correctly returns `""` for both fields. Routing by `git_remote` will not
work for Cursor conversations until either (a) the source data provides cwd,
or (b) a workspace-path-to-cwd mapping is built.

### I2: `parseJsonObject` and `decodeHexJsonObject` have bare catches

These are narrow data-parsing utilities that return `null` for malformed
individual records. Logging every unparseable blob would be noisy (Layer 3
blobs are often protobuf, not JSON). The adapter-level catch blocks that
call `logCursorWarning` adequately surface operational failures.

### I3: Layer 3 timestamp resolution is coarse

Layer 3 (store.db) lacks per-message timestamps. The adapter falls back
to the meta `createdAt` or file mtime (cursor.ts:660). This is a known
limitation of the CLI blob store format per the investigation docs. Real
per-message timestamps are only available in Layer 1.

## Aligned

All items from the prior review's "Aligned" section remain valid:

- Two-phase discover/load contract (BP-04)
- Shared-db change detection via per-conversation signatures (BP-04 Section 1)
- Deterministic IDs (BP-04 Section 2)
- Relationship semantics: spawned detection, traceId walking, forkPoint (BP-03)
- Tool call extraction from both layers (BP-04 Section 6)
- Boundary discipline: no forbidden-file edits
- Cross-platform path handling
- Legacy v1 shim confined to owned file

Additionally, the fix pass resolved:

- Direct frozen-type construction (no more `as unknown as`)
- `toolUses` field on contract type (not `toolCalls`)
- `thinkingTokens` explicitly set
- Role-transition turn detection
- Best-effort `cwd` resolution
- Logged catch blocks
- Correct `durationMs: -1` sentinel

## Drift

None. All prior drift items are resolved.

## Unowned Spread

None detected. All changes confined to `src/adapters/cursor.ts` and
`test/cursor-adapter.test.ts`.

## Progress

### Acceptance checks (from packet)

| Check | Status |
|-------|--------|
| Change detection works without global pipeline cache | Pass |
| Repeated loads yield stable IDs | Pass |
| Shared-db storage model obeys two-phase discover/load | Pass |
| Tests cover change detection | Pass (3 change-detection tests) |
| Tests cover representative relationship extraction | Pass (spawned + root) |

All 5 acceptance checks pass. The packet is ready for `approved`.

## Codex Decisions Needed

None blocking. Three informational items (I1-I3) are documented as known
limitations, not action items.
