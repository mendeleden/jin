# Ontology Discussion Log

Record of the design conversation that shaped jin's data model.
Date: 2026-03-21

---

## 1. The Problem

Jin normalizes conversation data from 10 AI coding tools into a flat
`Session + Message[]` model stored in SQLite. This works for basic analytics
but silently discards structural data:

- Message DAG (`parentUuid`) — lost on ingest
- Compaction boundaries — `isCompacted` flag exists but no lineage tracked
- Sub-agent spawn context — which turn spawned which sub-agent is unknown
- Tool calls — stored as JSON blobs, impossible to query via SQL
- Sidechains, progress records, custom titles — dropped entirely

## 2. Real Data Survey (749 Claude Code JSONL files)

| Record Type | Count | Currently Captured? |
|-------------|-------|-------------------|
| assistant | 20,955 | Yes |
| progress | 20,446 | No (to be added) |
| user | 14,983 | Yes |
| file-history-snapshot | 989 | No |
| queue-operation | 490 | No |
| system (various subtypes) | 424 | Partially |
| last-prompt | 30 | No |
| pr-link | 24 | No |
| custom-title | 3 | No |

Key finding: `type: "summary"` never exists in any file. The adapter code
that checks for it is dead code. Compaction produces `type: "system",
subtype: "compact_boundary"` + a `type: "user"` record with
`isCompactSummary: true`.

## 3. Sub-Agent Discovery

Initial assumption was that only Claude Code had sub-agents. Investigation
of local data revealed:

- **Codex**: Has `agent_message` records in JSONL, `agent_jobs` +
  `agent_job_items` tables in `state_5.sqlite`, and `threads` table with
  `agent_nickname`/`agent_role` columns.
- **Cursor**: Stores agent transcripts at
  `~/.cursor/projects/<project>/agent-transcripts/<uuid>/<uuid>.jsonl`.
  Has `create-subagent` skill. Sub-agents can spawn sub-agents (tree).
- **Claude Code**: `{sessionId}/subagents/agent-*.jsonl` directory structure.

All three major tools have sub-agent support. Jin's Codex and Cursor
adapters don't capture it yet.

## 4. Palantir Ontology Comparison

Palantir's ontology is their core differentiator — the semantic layer
between raw data and operational decisions. Three primitives:

- **Object Types** → jin's Conversation, Message
- **Link Types** → relationships between conversations (compacted, forked, spawned)
- **Action Types** → operations (export, reingest, show)

Key lesson: the ontology IS the product, not the storage format. Jin's value
isn't "we store JSONL in SQLite" — it's "we understand conversation lineage,
sub-agent trees, and tool usage patterns."

## 5. Three-Persona Debate on Data Model

Three domain perspectives were brought in to debate the entity hierarchy:

### Palantir Ontology Architect
- Everything is an Object with typed Links
- No embedded hierarchy — relationships are first-class entities
- Separate link table for maximum flexibility
- **Verdict**: Correct in theory but over-engineered for 1 object type
  and 3 relationship types. Link table doubles query complexity for
  every downstream consumer.

### Git Internals Architect
- Conversations are commits. Compaction is squash. Forking is branching.
- One parent pointer, infer type from context
- **Verdict**: Too minimal. Downstream consumers can't infer relationship
  types without documentation. Need explicit `relationship` column.

### OpenTelemetry Architect
- Conversations are Spans. Related conversations form a Trace.
- `trace_id` groups all related conversations (one indexed scan vs recursive CTE)
- `parent_id` + `relationship_type` on each span
- **Verdict**: The winning approach. `trace_id` is the key contribution —
  turns graph traversal into a flat indexed lookup.

### Synthesis (Martin Kleppmann as decisive voice)

Three columns on conversations. No join table. No recursive queries.

```sql
trace_id      TEXT    -- groups all related conversations
parent_id     TEXT    -- who created this conversation
relationship  TEXT    -- root | compacted | forked | spawned
fork_point    INTEGER -- which turn in parent triggered this
```

**Why not a link table:** Jin has 1 object type and 3 relationship types.
A conversation has exactly one origin (no multi-parent merges). Putting
the relationship on the row makes the schema self-describing — any agent
or analyst querying Postgres understands it without documentation.

**Why `trace_id` is essential:** Without it, "show me everything related"
is a recursive CTE with N round-trips (where N = compaction depth). With
it, it's `WHERE trace_id = ?` — one indexed scan regardless of depth.

## 6. Consumer Profile

Primary consumers will be **agents**, not humans. Agents run post-
conversation analysis, find inefficiencies, make recommendations. Example:
"This engineer made 17 raw curl commands with custom auth headers — suggest
a Jira MCP."

Requirements from this:
- Schema must be self-describing (agents read column names)
- Tool calls must be queryable via SQL (not JSON blobs)
- Full trace traversal must be efficient (deep compaction chains)
- Support UI visualization of conversation flow/progression

## 7. Naming Decisions

| Rejected | Chosen | Reason |
|----------|--------|--------|
| Session | **Conversation** | Each compacted segment is its own conversation |
| Epoch | **(removed)** | Replaced by `relationship = 'compacted'` between conversations |
| `is_sub_agent` | `relationship = 'spawned'` | Unified relationship model |
| `is_compacted` | `relationship = 'compacted'` exists in trace | Query the trace, not a boolean |
| `tool_uses` JSON blob | **`tool_calls` table** | Must be queryable by agents via SQL |

"Epoch" was rejected because it implies a subdivision within a larger
container. The decision is that each segment is a peer conversation linked
by `trace_id` + `parent_id`.

## 8. Blank-Page Schema (v2)

Three data tables, one FTS virtual table, two internal tables:

**Data (consumer-facing):**
- `conversations` — the primary entity with trace/parent/relationship
- `messages` — content records with DAG edges, sequence, turn, cost-per-message
- `tool_calls` — extracted from JSON blob, properly indexed by name

**Internal (jin operational state):**
- `_jin_sync` — ingestion bookkeeping (file hash, mtime, pushed_at)
- `_jin_push_log` — sink push history

**Key design differences from v1:**
1. `tool_calls` as a proper table (biggest win for analytics)
2. `cwd` and `model` as columns (not buried in metadata JSON)
3. `thinking_content`/`thinking_tokens` as message columns (not JSON blob)
4. `est_cost` per message (not just per session)
5. `_jin_sync` separated from data model (consumers don't see operational state)
6. Projects/tags/artifacts omitted (to be discussed — are they core or derived?)

## 9. Projects Decision

**Decision: Projects are NOT first-class entities.**

The key insight: `cwd` is an accident of where someone cloned the repo.
Three engineers on the same project have three different `cwd` values.
But they all share one `git_remote` — that's the project identity.

```sql
-- git_remote as a column on conversations, not a separate table
ALTER TABLE conversations ADD COLUMN git_remote TEXT DEFAULT '';
CREATE INDEX idx_conv_remote ON conversations(git_remote);
```

What this replaces:
- `projects` table — gone
- `session_projects` M:N join — gone
- `refreshProjectStats()` — gone (use `GROUP BY git_remote` instead)
- `projectIdFromCwd()` hashing — gone

Routing matches directly on `git_remote`:
```json
{ "match": { "remote": "github.com/company/*" }, "sinks": ["postgres-company"] }
```

For non-git conversations, `git_remote` is empty and `cwd` is the fallback
grouping. For worktrees and forks, `git remote get-url origin` returns the
same URL regardless of which worktree — so everything links back
automatically.

## 10. Sinks Decision

**Sinks are purely operational — not part of the consumer-facing schema.**

Push log (`_jin_push_log`) is internal, not queryable by consumers.
Sink status exposed via CLI (`jin sync-status`) or API, not via the
data tables.

## 11. Prismatic Findings

Prismatic is jin's enterprise analytics layer — it consumes jin's Postgres
data and builds hierarchical intelligence on top of it. Reviewing the
prismatic repo (README, ARCHITECTURE, ROADMAP, pitches, pilot roadmap,
traceability doc) revealed critical requirements for jin's ontology.

### Hierarchical Summarization Pipeline

```
Conversations → Session Summaries → Daily Digests → Period Reports → Team Reports
```

Each layer reads from the layer below. Traceability milestone (M2.96) adds
`sourceSessionIds` at every layer so team reports can drill down to specific
conversations. This means `trace_id` and `parent_id` on conversations are
foundational — Prismatic's entire traceability chain depends on them.

### Data Flow Architecture

```
jin CLI → webhook POST → Prismatic API → Postgres
                                            │
public schema (jin writes):          prismatic schema (Prismatic writes):
  jin_sessions                         session_metadata (quality signals)
  jin_messages                         session_analyses (LLM summaries)
                                       daily_digests
                                       team_reports
                                       developer_period_reports
                                       usage_metrics
```

Clean boundary: jin writes raw conversation data, Prismatic enriches it.
The `jin_*` tables must be consumer-friendly because Prismatic queries
them directly.

### Three Product Pitches → Three Ontology Requirements

1. **Session Intelligence** (automated standups, sprint reports, Jira
   updates) — needs traceable conversations with tool usage and cost.
   Sub-agent work must be attributable to parent conversations.

2. **Enterprise Knowledge Engine** (cross-org search, "why did we choose
   Redis?") — needs FTS on messages, `record_type` to filter noise,
   `tool_calls` table for pattern detection, `git_remote` for project
   grouping across machines.

3. **Context Engine for AI Tools** (MCP server providing institutional
   knowledge) — needs conversations queryable by `git_remote`, topic
   tags. This IS the MCP server from section 10 of the ontology doc.

### Cursor Token Blindness (Pilot Risk)

First enterprise customer uses Cursor primarily — zero token data from
Cursor sessions. Prismatic estimates tokens from message content length.

Implications for jin's schema:
- Need to distinguish actual vs estimated token counts (don't overwrite
  real 0 values with estimates — store estimates separately or as metadata)
- `tool_calls` table becomes even more important — for Cursor, structured
  tool data is the richest signal available once the adapter captures it
- Both Cursor and Codex adapters are missing sub-agent capture — fixing
  these is prerequisite for Prismatic's quality assessment

### `tool_uses` JSON Blob is a Problem NOW

Prismatic's quality assessment (`pipeline/assess.ts`) currently parses
the `tool_uses` JSON blob to detect:
- Tool use presence (significance signal)
- Agentic loops (3+ consecutive assistant messages with tool use)
- Sub-agent spawning patterns

With a `tool_calls` table, these become simple SQL:
```sql
-- Detect agentic loops
SELECT conversation_id, count(*) as tool_streak
FROM tool_calls tc
JOIN messages m ON m.id = tc.message_id
WHERE m.role = 'assistant'
GROUP BY conversation_id
HAVING count(*) >= 3;
```

### What Prismatic Owns (NOT part of jin's ontology)

- Users, teams, organizations, SSO
- Secret redaction
- LLM summarization + topic tagging
- Daily digests, period reports, team reports
- Quality assessment (significance scoring)
- Jira integration
- Usage metering

All of this lives in `prismatic.*` schema. Jin's ontology is strictly
the raw conversation data in `public.*` tables.

## 12. Consolidated v2 Schema Requirements

Based on all discussions (sections 1-11), the v2 schema needs:

**`conversations` table (replaces `sessions`):**
- Core identity: `id`, `trace_id`, `parent_id`, `relationship`, `fork_point`
- Context: `adapter_id`, `name`, `cwd`, `git_remote`, `model`
- Time: `started_at`, `ended_at`, `duration_ms`
- Cost: `input_tokens`, `output_tokens`, `cache_read`, `cache_write`, `est_cost`
- Counts: `message_count`, `tool_count`, `turn_count`
- Source: `source_path`, `source_format`
- Extension: `metadata` (adapter-specific only)

**`messages` table:**
- Identity: `id`, `conversation_id`, `parent_message_id`
- Content: `role`, `content`, `record_type`, `model`
- Position: `sequence`, `turn`, `is_sidechain`
- Tokens: `input_tokens`, `output_tokens`, `cache_read`, `cache_write`, `est_cost`
- Thinking: `thinking_content`, `thinking_tokens`
- Time: `timestamp`

**`tool_calls` table (NEW — extracted from JSON blob):**
- Identity: `id`, `message_id`, `conversation_id` (denormalized)
- Data: `name`, `input`, `output`, `is_error`, `duration_ms`
- Time: `timestamp`

**`_jin_sync` (internal):**
- `conversation_id`, `ingested_at`, `pushed_at`, `file_hash`, `file_size`, `file_mtime`

**`_jin_push_log` (internal):**
- Push history per conversation per sink

**Removed from v1:**
- `projects` table → replaced by `git_remote` column
- `session_projects` M:N join → gone
- `tags` / `session_tags` → deferred (nice-to-have, not core)
- `tool_usage` aggregate table → replaced by `tool_calls` (query directly)
- `artifacts` table → separate concern, not core conversation model

## 13. Migration System Design

### Local SQLite: Jin Owns It

SQLite's `PRAGMA user_version` tracks which migration version the database
is at. Migrations are sequential functions (TypeScript, not just SQL —
some need JSON parsing for backfills). Each migration is wrapped in a
transaction. If it fails, the DB stays at the previous version.

```
PRAGMA user_version = 0  → unmigrated
PRAGMA user_version = 3  → current v1 schema
PRAGMA user_version = 7  → v2 schema fully applied
```

Migrations run on daemon startup, blocking until complete. For the v1→v2
transition, a bootstrap migration detects the existing schema and sets
`user_version = 3` to skip already-applied changes.

Backfills (e.g., extracting `tool_calls` from JSON blobs) run as numbered
migrations with progress tracking. If interrupted, they resume from the
last batch on next startup.

`jin update` now includes a database backup step:
```
cp store.db store.db.v{current_version}
```
Rollback restores both binary AND database backup.

### Remote Postgres: Jin is a Writer, NOT an Owner

**Critical decision from tooling council review:**

Five engineers running different jin versions against the same Postgres
is a race condition for migrations and a data integrity risk without them.

**Jin clients must NEVER run Postgres migrations.**

Schema ownership:
- **With Prismatic:** Prismatic's migration runner manages all tables
  (`prismatic_migrations` tracking table, sequential SQL files)
- **Standalone Postgres sink:** Admin runs `jin schema apply` once (a
  separate CLI command, not part of the daemon)
- **S3:** Schemaless, no migrations needed

Jin's Postgres sink is a **parameterized INSERT** — it writes data to
tables that already exist. It never creates tables, never alters columns,
never runs DDL.

**IMPORTANT NOTE (user input pending):** The jin client should never run
CREATE TABLE commands against remote databases. The user indicated they
will explain the reasoning in more detail. This may further constrain
the sink's behavior — potentially requiring ALL remote schema setup to
happen outside of jin entirely (via Prismatic, a setup script, or a
separate admin tool).

### Schema Contract: Version Handshake on Push

**The core problem:** When jin's schema version doesn't match the remote
Postgres schema version, pushing data is dangerous:

**Scenario A — Postgres is newer than jin (admin migrated, engineer didn't update):**
```
Postgres v7 has tool_calls table, trace_id column
Jin v5 pushes sessions WITHOUT trace_id, WITHOUT tool_calls rows
Result: Data misrepresentation — engineer appears to use zero tools
        Prismatic analytics draw wrong conclusions from absent data
        No error visible to anyone. Looks correct but isn't.
```

**Scenario B — Jin is newer than Postgres (engineer updated, admin didn't migrate):**
```
Jin v7 tries to INSERT into tool_calls table
Table doesn't exist → INSERT fails → push fails
Result: Data loss at remote level, or silent degradation
```

**Both are dangerous. Misrepresentation is worse than failure because
nobody gets an error.**

### The Fix: Schema Version Check on Connect

```
jin daemon starts
  → connects to Postgres sink
  → reads schema version from jin_meta table (ONE read, not DDL)
  → compares to local SCHEMA_VERSION

  versions match     → push normally
  remote > local     → PAUSE pushing, tell engineer to update jin
  local > remote     → PAUSE pushing, tell admin to run migrations
```

Data stays in local SQLite when paused — nothing is lost. The sink
resumes automatically once versions align.

### Major vs Minor Version Drift

Not all version mismatches are equally dangerous:

```
schema_version = "2.3"
  major = 2 → must match (new tables, restructured data)
  minor = 3 → warn but continue (added nullable column with default)
```

Adding `git_remote TEXT DEFAULT ''` is minor — old jin pushes without it,
column defaults to empty, consumers know to ignore empty values. But
extracting `tool_calls` into a separate table is major — old jin can't
write to a table it doesn't know about.

Major mismatch → block pushes, show in `jin status`
Minor mismatch → warn, push what you can, log the gap

### What Engineers See

```
$ jin status

  Daemon:    running (PID 4821)
  Database:  ~/.config/jin/store.db (schema v7)
  Sessions:  342 conversations, 12,847 messages

  Sinks:
    ✓ postgres-team    schema v7, last push 2m ago, 340/342 synced
    ⚠ postgres-finance schema v5, PAUSED — remote schema outdated
                       2 conversations queued, waiting for admin migration
                       Run: jin schema apply --connection=<url>
```

The engineer sees the problem. The admin can see it via monitoring.
Nobody is silently pushing incomplete data.

### MDM / Fleet Deployment

For sys-admins managing a group of engineers:

1. **Update Postgres schema first** (via Prismatic deploy or
   `jin schema apply`)
2. **Push new jin binary via MDM** (Jamf, Intune, Homebrew tap)
3. **jin daemons auto-restart** → detect matching schema version →
   resume pushing queued data

Order matters: schema first, then binary. Never the other way around.
If an engineer auto-updates jin before the admin migrates Postgres,
pushes pause safely until the admin catches up.

### Rollback

If a migration causes issues:

- **Local SQLite:** `jin update --rollback` restores binary + database
  backup. Safe because each engineer owns their own SQLite.
- **Remote Postgres:** Admin rolls back the Postgres migration (separate
  process, not jin's responsibility). Jin clients auto-detect the version
  change and pause/resume accordingly.
- **No coordinated rollback needed.** Each layer (binary, local DB,
  remote DB) can roll back independently because the schema contract
  handles version drift gracefully.

## 14. Migration Strategy

Date: 2026-03-24

### Decision: Nuclear — Fresh Start, Re-Ingest Everything

Evaluated five migration paths (big-bang, incremental, parallel tables,
fresh start, hybrid). Chose the nuclear option: drop all existing data,
create fresh v2 schema, re-ingest everything from source files on disk.

**Why nuclear wins:**

1. **Backfill quality is the deciding factor.** Incremental paths can infer
   `relationship` from v1 booleans (`is_sub_agent`, `is_compacted`) but
   cannot reconstruct correct `trace_id` groupings for compacted chains
   without re-parsing source files. `trace_id` is the foundation of v2.
   Getting it wrong defeats the purpose.

2. **Re-ingest is cheap.** Source files are still on disk. Adapters already
   know how to parse them. 2-5 minutes on daemon startup, once.

3. **IDs are stable.** Session IDs come from source data (UUIDs from JSONL,
   hashes of file paths), not from the database. Re-ingesting the same
   source file produces the same conversation ID. Prismatic's foreign keys
   (`session_analyses.session_id`, etc.) would survive... but we're dropping
   Prismatic's enrichment data too (nuclear option).

4. **No migration code.** No ALTER TABLE chains, no dual-column periods, no
   compatibility shims. The v2 schema is the only schema.

**What gets destroyed and how it recovers:**

| Layer | Destroyed | Recovery |
|-------|-----------|----------|
| SQLite `store.db` | All data, push_log, FTS | Re-ingest from source files (automatic on startup) |
| Postgres `jin_*` tables | Raw conversation data | Re-pushed from fresh SQLite |
| Prismatic `prismatic.*` | Analyses, digests, reports, metadata | Re-generated by pipeline after data flows in |

**Update flow:**
```
jin update
  → backs up store.db as store.db.v1
  → creates fresh store.db with v2 schema
  → daemon starts → all adapters scan watch paths
  → every source file looks "new" (not in _jin_sync)
  → full ingest runs, all conversations created with v2 fields
  → all conversations unpushed → sink loop sends everything
```

### Decided: Adapter Interface (Option A — Keep Simple)

Adapters continue to return Conversations (renamed from Sessions) directly.
No parse/ingest split refactor.

```typescript
interface Adapter {
  conversations(): Promise<Conversation[]>;
  messages(conversationId: string, sourcePath?: string): Promise<Message[]>;
  // ... detect(), watchPaths(), artifacts() unchanged
}
```

### Decided: Postgres Table Naming

Nuclear option means no backward compat needed. Clean names:
- `jin_conversations` (replaces `jin_sessions`)
- `jin_messages` (same name, v2 columns)
- `jin_tool_calls` (new table)

The `jin_` prefix is a namespace that prevents collision with other schemas
and makes ownership clear.

### Decided: Re-Ingest Burst

No throttling needed. POC scale (10-30 developers, ~1000-3000 conversations
per fleet) is easily handled by Postgres batch upserts. Prismatic's ingest
already handles batches.

### Decided: Prismatic Coordination

Order: Prismatic migrates Postgres first, then jin binary ships.

Prismatic migration:
1. Drop old `jin_sessions`, `jin_messages`
2. Create `jin_conversations`, `jin_messages` (v2), `jin_tool_calls`
3. Clear `prismatic.*` enrichment tables (analyses, digests, etc.)
4. Pipeline automatically re-assesses and re-summarizes as data flows in

### Decided: Compaction Splitting — Adapters Own It

Each adapter detects compaction boundaries and returns multiple
Conversations from one source file. The adapter owns splitting, ID
generation, and trace_id assignment.

**Why not centralize in the ingest layer:**

1. Compaction signals are adapter-specific. Claude Code uses
   `record_type = 'system:compact_boundary'` + `isCompactSummary: true`.
   Codex uses `type: "compaction"` records with different structure.
   Other tools may have entirely different mechanisms.

2. Summary text location varies. Claude Code puts it in the next `user`
   record with `isCompactSummary`. Codex embeds it in the compaction
   record itself. Centralizing would require adapter-specific branches
   in the ingest layer — which is just adapter logic in the wrong place.

3. The adapter already walks messages during `messages()`. Detecting
   boundaries during that walk is natural. Computing per-segment
   aggregates (timestamps, token sums) is part of the same pass.

4. Sub-agent detection follows the same pattern — file structure
   (Claude Code), record fields (Codex), directory layout (Cursor).
   Each adapter knows its own relationship signals.

The ingest loop stays simple: iterate conversations → get messages → store.

### Decided: Segment ID Scheme — Deterministic Short Hash

When a source file is split into multiple conversations (compaction),
the root keeps its original file-derived ID. Continuations get a
deterministic hash.

```
root:            abc123                            (original ID)
continuation 1:  hash(abc123 + boundary_1_uuid)  → "f7a2b3c4d8e9"
continuation 2:  hash(abc123 + boundary_2_uuid)  → "a1b2c3d4e5f6"
```

**Why not a sequential suffix** (`abc123:1`, `abc123:2`): Encodes a
position within a container — which is the epoch hierarchy we eliminated.
Each conversation is a peer linked by `trace_id`, not "segment N of
file X." Also, colon in IDs complicates URL routing.

**Why not first-message UUID:** Only works for sources with per-message
UUIDs (Claude Code has them, others may not). Deterministic hash is
uniform across all adapters.

Relationships are discovered via `trace_id`, not by inspecting the ID.

### Decided: CREATE TABLE Restriction — Jin Clients Never Run DDL

Jin clients must never run CREATE TABLE, ALTER TABLE, CREATE INDEX,
CREATE FUNCTION, CREATE TRIGGER, CREATE EXTENSION, or any other DDL
against remote databases. Two reasons:

**1. Least privilege.** Jin is a data writer running on developer
laptops. Its Postgres credentials should grant INSERT, UPDATE, SELECT
— not CREATE, ALTER, DROP. If a jin binary is compromised or
misconfigured, the blast radius is limited to data, not schema.

**2. Version skew is a race condition.** Multiple engineers run
different jin versions against the same Postgres. `CREATE TABLE IF
NOT EXISTS` silently succeeds regardless of whether the existing schema
matches what this version expects:

```
User A (v0.8.1):  CREATE TABLE IF NOT EXISTS ... (trace_id TEXT)
User B (v0.7.5):  CREATE TABLE IF NOT EXISTS ... (no trace_id)
```

Whoever connects first wins. The other client either inserts rows
missing expected columns (silent data gaps) or fails on columns that
don't exist. Both are invisible until downstream analytics draw wrong
conclusions.

**What this removes from jin's Postgres sink:**
- `ensureTables()` method — all ~80 lines of DDL (CREATE TABLE,
  CREATE INDEX, CREATE OR REPLACE FUNCTION, CREATE TRIGGER, CREATE
  EXTENSION)
- `tablesEnsured` flag and health check DDL
- Any schema creation or modification logic

**What replaces it:**
- Schema created by `jin schema apply` (admin CLI, not daemon) or
  by Prismatic's migration runner
- Jin's Postgres user gets INSERT/UPDATE/SELECT only at the DB level
- Schema version read from `jin_meta` table on connect (SELECT, not DDL)
- Version mismatch → pause pushes, surface in `jin status`

**Where `jin_meta` comes from:** The same admin process that creates
the tables also creates `jin_meta` with the schema version. Jin reads
it, never writes it.

### Decided: Artifacts — Dropped from v2

Artifacts (CLAUDE.md, MCP configs, rules, skills) are not part of v2.

**Why:** Jin is a post-hoc file parser. It cannot reliably determine which
artifacts were active during a specific conversation — only what's on disk
NOW. Config files change between conversations, MCP servers can be
enabled/disabled mid-conversation, and overlapping conversations may have
different runtime configs. The per-conversation artifact linking model
produces misleading data for "available" status.

The "used" signal (which MCP tools were actually invoked) is already
captured accurately in the `tool_calls` table via tool name patterns
(e.g., `name LIKE 'mcp__%'`). No additional table needed.

If tools start recording config state in their conversation files in the
future, this decision can be revisited.

## 15. Architecture Review — Routing, Tags, Non-Git Conversations

Date: 2026-03-24

Council review of the v2 routing mental model surfaced several gaps.

### Bug Fix: Route Matching Needs Glob, Not Equality

The v1 `matchesRoute` in `routing.ts` uses string equality (`===`),
not glob matching. Config comments and design docs show wildcards
(`github.com/company/*`, `/Users/*/personal/*`) that don't actually
work. V2 must implement glob evaluation.

Additionally, multiple fields in one `RouteMatch` are evaluated as OR
(any match triggers). They must be AND (all specified fields must
match) to support monorepo routing where both `remote` and `directory`
need to match in the same rule.

### Decided: Tags System — Dropped, Replaced by Columns

All tag infrastructure removed: `tags` table, `session_tags` table,
`ensureTag`, `tagSession`, `getSessionTags`, `listTags`, and
`autoTagSession` in tagger.ts.

Replacements: `adapter_id` (tool), `model` (model), `git_remote`
(project), `relationship` + `est_cost` (status tags). Two gaps filled
by new columns:

- `branch TEXT DEFAULT ''` on conversations — populated during ingest
  alongside `git_remote`
- `labels TEXT DEFAULT '[]'` (JSON array) on conversations — stopgap
  for user-applied custom tags without a join table

Language detection has no column but is queryable from `tool_calls`:
`SELECT input FROM tool_calls WHERE name IN ('Read','Edit','Write')`.
Not routable — acceptable limitation.

### Decided: RouteMatch v2 — With Adapter and Name Fields

```typescript
interface RouteMatch {
  remote?: string;     // glob against conversation.git_remote
  directory?: string;  // glob against conversation.cwd
  adapter?: string;    // exact match against conversation.adapter_id
  name?: string;       // glob against basename(conversation.cwd)
  // Multiple fields = AND (all specified must match)
}
```

`adapter` solves non-git routing for fleet deployments:
```json
{ "match": { "adapter": "warp" }, "sinks": ["s3-personal"] }
```

`name` replaces the removed `match.project` — globs against the last
path component of `cwd`, which is how developers think about projects
("any directory named jin").

### Decided: Git Info Caching During Ingest

Nuclear re-ingest triggers `git remote get-url origin` +
`git rev-parse --abbrev-ref HEAD` for every conversation. Cache results
by `cwd` within each ingest pass — most conversations share a `cwd`,
reducing 500+ subprocess spawns to ~10-20 unique lookups.

### Documented Edge Cases

- **Monorepo:** AND semantics on route fields handles sub-repo routing
- **Worktrees:** `git remote get-url origin` returns same URL — works
- **Forks:** Different remote, won't match parent routes — acceptable
- **Mid-conversation cwd change:** Launch-time cwd used — acceptable
- **Offline:** `git_remote = ''`, falls to directory/adapter/default
