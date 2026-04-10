# Review: W1-DB-01 Store Spine (claude-code)

- reviewer: `claude-code-REVIEWER-db-store-spine`
- packet: `W1-DB-01`
- date: `2026-04-01`
- verdict: `approved`

## Scope Of Review

Second-pass review of the W1-DB-01 store spine implementation, cross-checking
the prior cursor review against the blueprints and frozen contracts. All files
under `src/db/` and `test/db-store-spine.test.ts` were read line-by-line against:

- `docs/blueprint/BP-05-store-and-migration.md`
- `docs/blueprint/BP-03-conversation-model.md`
- `docs/blueprint/BP-02-data-flow.md`
- `src/contracts/store.ts` (frozen)
- `src/contracts/conversations.ts` (frozen)
- `docs/execution/tasks/W1-DB-01-store-spine.md` (packet)

Tests verified: `bun test test/db-store-spine.test.ts` — 7 pass, 0 fail,
41 expect() calls.

## Aligned

### BP-05: Schema DDL

All six tables (`conversations`, `messages`, `tool_calls`, `_jin_sync`,
`_jin_push_state`, `_jin_push_attempts`) and the `messages_fts` virtual table
match the ontology and BP-05 definitions. CHECK constraints on `relationship`
and `source_format` are derived from the frozen contract arrays in
`src/contracts/conversations.ts`.
(`src/db/schema.ts`:16-129)

### BP-05: PRAGMA user_version migrations

Migration model matches BP-05 exactly: forward-only, version-gated, each
migration wrapped in `db.transaction()`. `LATEST_USER_VERSION` derived from
the array. `getUserVersion()` reads the pragma correctly.
(`src/db/schema.ts`:134-160)

### BP-05: getStore() singleton

`getStore(configDir)` resolves to `{configDir}/store.db`, caches by path,
opens with WAL mode, busy_timeout, foreign_keys, and runs migrations. Matches
BP-05 singleton access pattern.
(`src/db/store.ts`:28-128)

### BP-05: computeBundleHash determinism contract

Hash covers all `ParsedConversation` fields and all `ParsedMessage` fields
(including `thinkingContent`, `thinkingTokens`, and tool call `output`).
Messages sorted by `sequence`, tool calls sorted by `id`. Uses `satisfies`
for compile-time field coverage. Canonical JSON + SHA-256 matches BP-05
algorithm exactly.
(`src/db/bundle.ts`:30-89)

### BP-05: writeBundle composition

Single transaction wrapping: hash check -> skip-if-unchanged -> upsert
conversation -> delete tool_calls -> delete messages -> insert messages
+ tool_calls -> FTS refresh -> recompute derived -> bump revision.
Order matches BP-05 pseudocode. Delete order (tool_calls before messages)
respects FK constraints.
(`src/db/bundle.ts`:91-141)

### BP-05: Write semantics — upsert vs replace

Conversation: ON CONFLICT(id) DO UPDATE with adapter-sourced fields only
(no derived fields in the upsert SET). Matches BP-05 exactly.
(`src/db/conversations.ts`:43-98)

Messages + Tool Calls: DELETE + INSERT (full replacement). Matches BP-05
rationale: "The source is the authority, the store is the materialized view."
(`src/db/bundle.ts`:112-120, `src/db/messages.ts`:80-85, `src/db/tool-calls.ts`:51-55)

### BP-05: Derived fields

All 9 derived fields computed: `duration_ms` (JS Date.parse, not julianday),
`message_count`, `tool_count`, `turn_count`, `input_tokens`, `output_tokens`,
`cache_read`, `cache_write`, `est_cost`. `est_cost` computed in application
code via `src/pricing.ts` per BP-05.
(`src/db/conversations.ts`:100-197)

### BP-05: Push eligibility

`conversationsNeedingPush()` uses the exact BP-05 query with LEFT JOIN +
COALESCE. `recordPushResult()` records `attemptedRevision` (not current
`local_revision`) per BP-05. Success path clears `last_error`. Failure path
preserves `last_successful_revision`.
(`src/db/sync.ts`:89-168)

### BP-05: Integrity checks

Orphan detection query matches BP-05 exactly. Sync consistency query matches
BP-05. Both return properly typed results per the frozen `ConversationStore`
interface.
(`src/db/sync.ts`:170-217)

### BP-05: FTS5 maintenance

External-content FTS5 table. `refreshConversationFts()` captures old rowids
before delete, issues explicit FTS DELETE commands, then re-inserts from new
messages. Runs inside the writeBundle transaction. Matches BP-05.
(`src/db/search.ts`:20-41)

### BP-03: Relationship model

`parent_id` is NOT a foreign key (intentional per BP-03 invariant 10 — child
before parent must not fail). CHECK constraint enforces the 4 relationship
values. `trace_id` and `parent_id` are indexed. The child-before-parent test
confirms this works.
(`src/db/schema.ts`:24, `src/db/schema.ts`:120-121)

### BP-02: Store as buffer

The store exposes the exact read-side methods BP-02 requires:
`conversationsNeedingPush`, `getConversation`, `getMessages`, `getToolCalls`,
`recordPushResult`. No business logic in `src/db/` — it doesn't know about
adapters, sinks, or the pipeline. Clean buffer boundary.
(`src/db/store.ts`:50-95)

### Frozen contract compliance

`SqliteConversationStore` implements `ConversationStore` from
`src/contracts/store.ts`. All 8 interface methods present with matching
signatures and return types. Additionally exposes `searchMessages()` and
`close()` beyond the interface (not a contract violation — additions are fine).
(`src/db/store.ts`:30-111)

### BP-05: File organization

Module split matches BP-05 exactly: `store.ts` (singleton), `schema.ts`
(migrations), `conversations.ts`, `messages.ts`, `tool-calls.ts`, `sync.ts`,
`search.ts`, `bundle.ts` (composition point). `bundle.ts` is the only file
that knows the full write sequence.
(`src/db/index.ts`)

### Acceptance checks (packet)

All 5 acceptance checks pass:

1. Unchanged bundle does not bump revision — test line 134-136
2. Changed bundle bumps revision exactly once — test line 137-138
3. Push eligibility is revision-based, not timestamp-based — test lines 141-184
4. Child rows can exist before parent rows — test lines 187-211
5. Bundle hash determinism and full replacement semantics — test lines 43-83, 214-271

## Drift

### S3: Missing indexes from ontology (informational, not blocking)

The ontology lists `idx_msg_turn`, `idx_msg_parent`, `idx_tc_msg`, and
`idx_sync_revision`. The implementation omits these four. BP-05 does not
mandate the full index set — these can be added when query patterns require
them. **No semantic drift.**

File: `src/db/schema.ts`:120-128
BP ref: ontology §7.1 vs BP-05 §Indexes

### S3: `tool_calls` PK differs from ontology

Ontology §7.1 defines `id TEXT PRIMARY KEY` for tool_calls. The implementation
uses a composite PK `(conversation_id, message_id, id)`. This is arguably
more correct (tool call IDs may only be unique within a message, not globally),
but it is a deviation from the ontology DDL. The frozen `ToolCall` interface
has `id`, `conversationId`, and `messageId` — the composite PK aligns with
the interface better than the ontology's single-column PK.

File: `src/db/schema.ts`:78
BP ref: ontology §7.1, BP-05 §Schema

**Recommendation:** This is a pragmatic improvement. If Codex agrees, the
ontology should be updated to reflect the composite PK. Not blocking.

### S3: `duration_ms` default differs for tool_calls

Ontology says `duration_ms INTEGER DEFAULT -1` for tool_calls. Implementation
uses `DEFAULT 0`. The frozen `ParsedToolCall.durationMs` is typed as `number`
with no explicit -1 sentinel. Low risk.

File: `src/db/schema.ts`:76
BP ref: ontology §2.3

### S3: `est_cost` column absent from messages table

The ontology §2.2 defines `est_cost REAL` on messages (per-message cost).
The implementation does not include this column — cost is only computed at
the conversation level. This is consistent with BP-05 which says "Derived
fields are never set by adapters" and computes cost per-conversation. The
`ParsedMessage` frozen contract does not include `estCost`. **Not blocking.**

File: `src/db/schema.ts`:47-66
BP ref: ontology §2.2 vs `src/contracts/conversations.ts`:37-54

## Unowned Spread

None.

The commit `cd5c290` also touches `src/config.ts`, `src/routing.ts`,
`test/config.test.ts`, and `test/routing.test.ts` — but those belong to
`W1-ROUTING-01`, not this packet. The DB worker's heartbeat confirms these
were pre-existing and untouched by the DB work. The single commit bundles
two packets' work, which is a process artifact of the shared workspace.
**No boundary violation by the DB worker.**

## Progress

- BP-05: `mostly_aligned` — schema, write semantics, sync state, integrity
  helpers, FTS, revision-based push eligibility all implemented and tested.
  Remaining BP-05 surface (Postgres handshake, downstream query patterns)
  is out of scope for this packet.
- BP-03: `frozen` (unchanged) — relationship storage assumptions preserved.
- BP-02: `frozen` (unchanged) — store-as-buffer contract satisfied.

## Codex Decisions Needed

None blocking.

**Informational items for Codex:**

1. The composite PK on `tool_calls` deviates from ontology §7.1 but is
   arguably more correct. Codex should update the ontology to match if
   this is intentional.
2. The `duration_ms DEFAULT 0` vs ontology's `DEFAULT -1` for tool_calls
   is minor but should be reconciled in the ontology.
3. Per-message `est_cost` column from ontology §2.2 is absent. If it's not
   needed, the ontology should drop it. If it is, a future packet should add it.

**Verdict: `codex-BRAIN` can move `W1-DB-01` to `approved`.** The
implementation is clean, tested, and aligned to BP-05 and the frozen contracts.
The three informational items above are ontology housekeeping, not blockers.
