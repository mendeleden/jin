# Review: W0-CODEX-01 Contract Freeze

- reviewer: `cursor-audit`
- packet: `W0-CODEX-01`
- date: `2026-04-01`
- verdict: `approved`

## Scope Of Review

Audited the first Codex contract-freeze run against:

- all 8 BP docs (BP-01 through BP-08)
- the ontology (docs/ontology.md)
- the W0-CODEX-01 task packet
- all uncommitted changes attributable to W0-CODEX-01

Changes attributable to W0-CODEX-02 (live control plane bootstrap) are present
in the working tree but were excluded from this review.

## Aligned

### conversations.ts vs BP-03 and BP-04

- `ConversationRelationship` enum matches BP-03 relationship types exactly:
  `root`, `compacted`, `spawned`, `forked`. (BP-03 lines 62-139, code lines 1-6)
- `ParsedConversation` fields match BP-04 data shapes one-for-one, including
  `traceId`, `parentId`, `relationship`, `forkPoint`. (BP-04 lines 327-343,
  code lines 56-72)
- `ParsedMessage` fields match BP-04 one-for-one, including `toolUses`,
  `thinkingContent`, `thinkingTokens`, `parentMessageId`, `isSidechain`.
  (BP-04 lines 351-369, code lines 36-54)
- `ParsedToolCall` fields match BP-04 one-for-one. (BP-04 lines 375-383,
  code lines 26-34)
- `ConversationBundle` shape matches BP-04 `{ conversation, messages }`.
  (BP-04 lines 88-91, code lines 74-77)
- `ConversationRef` matches BP-04 `{ id, sourcePath, adapterId }`.
  (BP-04 lines 81-85, code lines 20-24)
- `Conversation` stored type extends `ParsedConversation` with the correct
  9 derived fields from BP-04. (BP-04 lines 393-403, code lines 79-89)
- `Message` and `ToolCall` stored types add the correct FK fields
  (`conversationId`, `messageId`). (code lines 91-98)
- `ConversationSourceFormat` matches ontology source formats.
  (ontology line 75, code lines 11-18)

### adapters.ts vs BP-04

- `Adapter` interface has all 4 required methods: `detect`, `findChanged`,
  `loadConversation`, `watchPaths`. (BP-04 lines 22-74, code lines 16-23)
- `ChangeHint` shape matches BP-04 supporting types. (BP-04 lines 95-99,
  code lines 11-14)
- `ChangeHintKind` values match BP-04 and BP-02 trigger model.
  (code lines 3-7)
- Correctly omits `conversations()`, `messages()`, `newMessages()`, and
  `artifacts()` from the v2 interface. (BP-04 line 119-122)

### store.ts vs BP-05

- `WriteBundleResult` matches BP-05 `{ changed, revision }`.
  (BP-05 lines 86-87, code lines 9-12)
- `SyncStateRecord` fields match BP-05 `_jin_sync` columns.
  (BP-05 lines 281-289, code lines 14-19)
- `PushStateRecord` fields match BP-05 `_jin_push_state` columns.
  (BP-05 lines 300-311, code lines 21-29)
- `ConversationStore` interface provides the read/write surface BP-05
  and BP-02 require: `writeBundle`, `getConversation`, `getMessages`,
  `getToolCalls`, `getRevision`, `conversationsNeedingPush`,
  `recordPushResult`, integrity queries. (code lines 43-57)

### sinks.ts vs BP-06

- `Sink` interface matches BP-06 exactly: `id`, `name`, `push(payloads)`,
  `healthCheck()`, `close()`. (BP-06 lines 31-64, code lines 26-32)
- `PushPayload` includes `attemptedRevision` per BP-06 requirement.
  (BP-06 lines 66-71, code lines 8-13)
- `PushResult` reports per-conversation errors via `PushError[]`.
  (BP-06 lines 73-77, code lines 20-24)
- Correctly omits `supportsDelta`, `connect()`, `migrate()`, `family`.
  (BP-06 lines 93-97)

### config.ts vs BP-08

- `RouteMatch` has the correct 4 fields: `remote`, `adapter`, `branch`,
  `name`. (BP-08 lines 48-53, code lines 10-15)
- `SinkConfig` is a proper discriminated union by `type`.
  (BP-08 lines 173-203, code lines 30-63)
- `JinConfig` shape matches BP-08 config schema. (BP-08 lines 153-168,
  code lines 65-70)
- No `defaultSinks`, `routeUnmatchedToAll`, `projects`, `directory`,
  `team`, `store.rawDir`. (BP-08 lines 441-456)

### lifecycle.ts vs BP-07

- `RUNTIME_MODES` matches BP-07 runtime modes table. (BP-07 lines 106-112,
  code lines 1-3)
- `RUNTIME_STATES` matches BP-07 health model table. (BP-07 lines 441-459,
  code lines 5-12)
- `SHUTDOWN_DRAIN_TIMEOUT_MS = 15_000` matches BP-07 shutdown budget.
  (BP-07 lines 355-358, code line 14)
- `RuntimeOwnershipRecord` captures the fields BP-07 requires for ownership
  detection. (BP-07 lines 210-226, code lines 16-23)
- `RuntimeIssue.subsystem` distinguishes ingest vs push degradation per
  BP-07. (BP-07 lines 456-459, code lines 25-29)

### pipeline.ts vs BP-02

- `DEFAULT_INGEST_BATCH_SIZE = 20` matches BP-02 resource budget.
  (BP-02 line 448)
- `DEFAULT_PUSH_BATCH_SIZE = 20` matches BP-02 resource budget.
  (BP-02 line 449)
- `DEFAULT_WATCH_DEBOUNCE_MS = 500` matches BP-02 watcher debounce.
  (BP-02 line 450)
- `DEFAULT_FIND_CHANGED_TIMEOUT_MS = 60_000` matches BP-02 adapter timeout.
  (BP-02 line 451)
- `DEFAULT_LOAD_CONVERSATION_TIMEOUT_MS = 30_000` matches BP-02 adapter
  timeout. (BP-02 line 451)

### Frozen contract surface doc

- `docs/execution/04-frozen-contract-surface.md` lists all 8 contract files.
- Ownership map correctly maps each W1 packet to the contract files it reads.
- Allowed shim rules are explicit and scoped.
- Stop rule is clear: escalate to Codex, do not patch around the freeze.

### Wave 1 packet updates

- All 6 packets now include `04-frozen-contract-surface.md` in their read
  list.
- All 6 packets now include the specific frozen contract files they consume.
- All 6 packets now list `src/contracts/**` as forbidden.
- All 6 packets now include the contract stop condition.
- Changes are strictly additive. No existing ownership, deliverable, or
  acceptance check was removed or altered.

### Legacy shim re-exports

- `src/adapters/types.ts` re-exports v2 types with `V2` prefix.
- `src/sinks/types.ts` re-exports v2 types with `V2` prefix.
- `src/config.ts` re-exports v2 types with `V2` prefix.
- Legacy v1 types are retained intact for the existing runtime.
- Comment headers clearly mark these as migration shims.

### Test coverage

- `test/contract-freeze.test.ts` freezes all enum-like values and operational
  constants via exact equality assertions.
- Tests pass: 2 pass, 0 fail, 15 expect() calls.
- Typecheck passes cleanly.

## Drift

None found.

Every field in every contract file was verified against the corresponding
blueprint section. No contradictions, no omitted fields, no extra fields
that diverge from the BP intent.

## Unowned Spread

None attributable to W0-CODEX-01.

The W0-CODEX-01 packet owns:

- cross-cutting shared type files
- packet files under `docs/execution/tasks/`
- minimal contract publication docs

All changes fall within this scope:

- `src/contracts/**` — new shared type files (owned)
- `docs/execution/04-frozen-contract-surface.md` — contract publication doc (owned)
- `test/contract-freeze.test.ts` — test for frozen contracts (owned)
- `src/adapters/types.ts`, `src/sinks/types.ts`, `src/config.ts` — minimal
  re-export bridges in existing shared type files (owned, per "cross-cutting
  shared type files" in packet)
- `docs/execution/tasks/W1-*.md` — packet updates (owned, per "packet files
  under docs/execution/tasks/")

Changes to `docs/execution/00-global-rules.md`, `01-dispatch-protocol.md`,
`02-progress-and-audit.md`, `README.md`, `.execution/**`, and
`docs/execution/05-live-control-plane.md` belong to W0-CODEX-02 and are
not under review here.

## Progress

- BP-01: `frozen` — module boundaries encoded in ownership map
- BP-02: `frozen` — pipeline defaults frozen (batch sizes, timeouts, debounce)
- BP-03: `frozen` — conversation relationship semantics frozen (trace_id,
  parent_id, relationship, fork_point)
- BP-04: `frozen` — adapter interface frozen (discover/load, ConversationBundle,
  all parsed shapes)
- BP-05: `frozen` — store write semantics frozen (writeBundle result, sync/push
  state, integrity queries)
- BP-06: `frozen` — sink contract frozen (PushPayload with attemptedRevision,
  PushResult with per-conversation errors)
- BP-07: `frozen` — lifecycle ownership frozen (runtime modes/states, 15s drain
  budget, ownership record)
- BP-08: `frozen` — routing/config frozen (RouteMatch fields, AND semantics,
  discriminated sink union, safe zero-state)

## Codex Decisions Needed

None. The contract freeze is complete and aligned to every cited blueprint.
Codex can move W0-CODEX-01 to `approved` and proceed with Wave 1 dispatch.
