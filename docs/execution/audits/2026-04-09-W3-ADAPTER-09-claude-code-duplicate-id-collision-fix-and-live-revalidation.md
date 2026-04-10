# W3-ADAPTER-09 Claude Code Duplicate-ID Collision Fix And Live Revalidation

**Packet:** `W3-ADAPTER-09`  
**Validation date:** `2026-04-09`  
**Scope:** `src/adapters/claude-code.ts`, `test/claude-code-reference-adapter.test.ts`

## Root Cause

- Claude subagent conversation identity was not globally stable on the real dataset:
  - some live subagent files reused the same short raw `agentId` across different
    parent sessions
  - the adapter used that raw `agentId` directly as the loaded conversation ID
- Claude message identity was also not globally safe for the disposable-store path:
  - side-question / subagent transcripts can replay parent/root rows verbatim,
    including the same raw message `uuid`
  - some subagent transcripts repeat the same raw message `uuid` twice within a
    single file
  - the adapter trusted raw `uuid` values directly for `messages.id`, which
    violates the store's global `messages.id` primary key

## Fix

- Subagent conversation IDs are now parent-scoped deterministic IDs:
  - `agent-<hash(parent scope, raw source id, file stem)>`
- Parsed message IDs are now conversation-scoped deterministic IDs:
  - `hash(conversation id, raw/synthetic message seed, occurrence count)`
- `parentMessageId` now resolves against the latest parsed message ID seen for a
  raw `parentUuid` within the same conversation instead of storing the raw UUID
  directly

This keeps the fix adapter-local and inside the frozen store/pipeline contracts.

## Focused Commands

### 1. Packet-local regression tests

```sh
bun test test/claude-code-reference-adapter.test.ts
```

Observed:

- exit code: `0`
- `13` tests passed
- new focused coverage proves:
  - spawned child transcripts can replay parent rows and repeat raw UUIDs while
    still producing unique deterministic parsed message IDs
  - reused raw subagent IDs across different parent sessions no longer collide

### 2. Real-data duplicate conversation ID probe

```sh
bun -e 'import { ClaudeCodeAdapter } from "./src/adapters/claude-code"; const adapter = new ClaudeCodeAdapter({ projectsDir: `${process.env.HOME}/.claude/projects` }); const refs = await adapter.findChanged({ kind: "startup-scan" }); const byId = new Map(); for (const ref of refs) { const list = byId.get(ref.id) ?? []; list.push(ref.sourcePath); byId.set(ref.id, list); } const duplicates = [...byId.entries()].filter(([, paths]) => paths.length > 1).sort((a, b) => a[0].localeCompare(b[0])); console.log(JSON.stringify({ refCount: refs.length, uniqueIds: byId.size, duplicateCount: duplicates.length }, null, 2));'
```

Observed:

- `refCount`: `919`
- `uniqueIds`: `919`
- duplicate loaded conversation IDs: `0`

### 3. Real-data message collision probe

```sh
bun -e 'import { ClaudeCodeAdapter } from "./src/adapters/claude-code"; const adapter = new ClaudeCodeAdapter({ projectsDir: `${process.env.HOME}/.claude/projects` }); const refs = await adapter.findChanged({ kind: "startup-scan" }); const messageOwners = new Map(); const collisions = new Map(); let internalCollisionBundles = 0; for (const ref of refs) { const bundle = await adapter.loadConversation(ref); if (!bundle) continue; const seenInBundle = new Set(); let bundleHasInternal = false; for (const message of bundle.messages) { if (seenInBundle.has(message.id)) bundleHasInternal = true; seenInBundle.add(message.id); const owner = { conversationId: bundle.conversation.id, sourcePath: bundle.conversation.sourcePath }; const seen = messageOwners.get(message.id); if (!seen) { messageOwners.set(message.id, owner); continue; } if (seen.conversationId !== owner.conversationId) { const existing = collisions.get(message.id) ?? [seen]; if (!existing.some((entry) => entry.conversationId === owner.conversationId && entry.sourcePath === owner.sourcePath)) existing.push(owner); collisions.set(message.id, existing); } } if (bundleHasInternal) internalCollisionBundles += 1; } console.log(JSON.stringify({ collisionCount: collisions.size, internalCollisionBundles }, null, 2));'
```

Observed:

- cross-conversation message ID collisions: `0`
- bundles with internal duplicate message IDs: `0`

### 4. Claude-only disposable-store live validation

```sh
bun scripts/live-validation/run.ts \
  --adapters=claude-code \
  --output-dir="$(mktemp -d /tmp/jin-live-validation-claude-XXXXXX)" \
  --claude-projects-dir="$HOME/.claude/projects"
```

Observed:

- exit code: `0`
- output dir: `/tmp/jin-live-validation-claude-UVJqaK`
- artifacts:
  - report: `/tmp/jin-live-validation-claude-UVJqaK/report.json`
  - reconciliation: `/tmp/jin-live-validation-claude-UVJqaK/reconciliation.json`
  - config: `/tmp/jin-live-validation-claude-UVJqaK/config/config.json`
  - store: `/tmp/jin-live-validation-claude-UVJqaK/config/store.db`

## Claude Validation Result

- source files touched: `903`
- refs discovered: `919`
- bundles loaded: `919`
- null bundles: `0`
- unique conversations loaded: `919`
- duplicate loaded conversation IDs: `0`
- source messages: `45466`
- source tool calls: `16571`
- write attempts: `919`
- write errors: `0`
- stored conversations: `919`
- stored messages: `45466`
- stored tool calls: `16571`
- store sync rows: `919`
- issues: `0`
- `report.summary.ok`: `true`

Store footprint:

- `store.db`: `202M`
- `store.db-shm`: `32K`
- `store.db-wal`: `0B`

## Residual Note

- `resolveGit()` still emits `fatal: not a git repository` lines for source
  `cwd` values that are not git working trees. The live validation run still
  exited cleanly and the report recorded no Claude adapter errors, so this
  remains a non-blocking follow-up rather than a packet blocker.

## Durable Lesson

### Problem

- Claude's raw source identifiers are only locally meaningful:
  - subagent IDs need parent scope
  - message UUIDs need conversation scope and row-occurrence disambiguation

### Solution

- Treat raw Claude IDs as source-local seeds, not store-safe primary keys.
- Derive loaded conversation/message IDs from normalized scope plus the raw
  source seed.

### Reusable Insight

- Rich adapters should not trust upstream IDs to satisfy Jin's global store
  uniqueness constraints unless the live dataset proves that those IDs are
  globally unique across parent/child replay, compaction, and duplicate-row
  edge cases.

### Prevention

- Keep a real-data probe that checks:
  - duplicate loaded conversation IDs
  - cross-conversation message ID collisions
  - within-bundle duplicate message IDs
- Re-run the disposable-store validation before release-facing adapter
  confidence calls.
