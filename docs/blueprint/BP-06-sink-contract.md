---
title: "BP-06: Sink Contract"
status: reviewed
created: 2026-03-29
depends-on: [BP-01, BP-02, BP-05]
informs: []
---

# BP-06: Sink Contract

## Principle

A sink pushes data to a remote system. It receives a full conversation
snapshot from the pipeline, formats it for the target, and transmits it.
A sink never reads from the store, never decides what to push, and never
performs privileged remote provisioning as part of normal push.

The pipeline (BP-02) owns scheduling and eligibility. The sink owns
formatting and transmission.

Generic sinks may also project optional sink-scoped **export metadata**
configured at the sink boundary, such as remote multi-tenant scoping
(`teamId`) and export-side user attribution (`userId`). This metadata belongs
to the integration/export boundary, not to the canonical conversation payload.

**Scope:** This blueprint defines **generic integration sinks** only.
Per [BP-Product-Strategy.md](/Users/edenmendel/Documents/GitHub/jin/docs/blueprint/BP-Product-Strategy.md),
`jin team` is a separate product boundary and is not defined by this sink
contract.

---

## Interface

```typescript
interface Sink {
  /** Identifier used in config and _jin_push_state */
  id: string;

  /** Human-readable name for CLI output */
  name: string;

  /**
   * Push one or more conversation snapshots to the remote.
   *
   * Each payload is a complete snapshot: conversation + messages +
   * toolCalls + the revision that was loaded for this push.
   * The sink formats and transmits. It does not decide what to push.
   *
   * Push is best-effort: the sink attempts ALL payloads in the batch,
   * not fast-fail on first error. PushResult.pushed + PushResult.failed
   * must equal payloads.length. The pipeline records per-conversation
   * results from PushResult.errors.
   *
   * Retry is the pipeline's responsibility: failed conversations remain
   * eligible for the next push cycle (periodic scan, default 60s).
   * Sinks do not retry internally.
   */
  push(payloads: PushPayload[]): Promise<PushResult>;

  /**
   * Check if the remote is reachable and ready to accept pushes.
   * Returns ok: true if ready, ok: false with a reason if not.
   */
  healthCheck(): Promise<{ ok: boolean; error?: string }>;

  /** Close connection, release resources */
  close(): Promise<void>;
}

type PushPayload = {
  attemptedRevision: number;     // From writeBundle() — the local revision being pushed
  conversation: Conversation;    // With derived fields (counts, cost)
  messages: Message[];
  toolCalls: ToolCall[];
};

type PushResult = {
  pushed: number;
  failed: number;
  errors: Array<{ conversationId: string; error: string }>;
};
```

### Why `attemptedRevision` is on the Payload

BP-05 captures the local revision at load time. Passing it through to the
sink enables:
- **Postgres:** Can store the revision for auditing (optional, not required)
- **S3:** Can include revision in object metadata (optional)
- **Webhook:** Derives `idempotencyKey` as `${conversation.id}:r${attemptedRevision}`
  and includes it in the POST body, giving receivers a stable dedup key

The pipeline records `attemptedRevision` in `_jin_push_state` on success
(BP-05). The sink receives it so both sides agree on what was pushed.

**What's NOT on the interface:**
- No `family` property — sink families are a documentation concept, not
  a runtime type. The coordinator does not branch on family.
- No `supportsDelta` — the pipeline always sends full snapshots.
- No `ensureTables()` or `migrate()` — sinks do not provision remote resources.
- No `connect()` — sinks lazily connect on first `push()` or `healthCheck()`.

### Interruptibility and Worker Hosting

The parent pipeline may host sink `push()` execution inside a disposable
subprocess worker. That is an internal BP-02 execution policy, not sink API
surface.

Why this matters:

- stop and config-generation cutovers may need to interrupt in-flight delivery
  immediately
- the parent should be able to kill a push worker without widening the generic
  sink interface for every transport
- durable local push state remains the source of truth for what Jin considers
  confirmed

The acknowledgement rule is:

- a payload is considered pushed only when the parent receives a completed
  `PushResult` and records success in `_jin_push_state`
- if a push worker is interrupted or dies before returning, the parent records
  no new success for payloads that were still in that worker
- the parent records interruption metadata sufficient for status/diagnostics:
  generation, sink target, and the fact that dirty replay remains pending
- those payloads remain dirty and are retried later under at-least-once
  delivery semantics

This means the remote may already have received bytes before the local
interrupt. Jin's contract is to stop cooperating immediately and rely on
idempotency plus dirty-state replay for recovery.

---

## No Privileged Remote Provisioning

**Jin's daemon does not create, alter, or provision remote resources as
part of normal push.**

This applies across all sink types:
- **Table sinks (Postgres):** No CREATE TABLE, ALTER TABLE, or DDL
- **Object sinks (S3):** No bucket creation or policy changes
- **Delivery sinks (Webhook):** No endpoint registration or schema negotiation

### Why

1. **Least privilege.** The daemon runs on a developer's machine. It should
   not have permissions to provision infrastructure on shared systems.

2. **Schema ownership.** In enterprise deployments (Jin Team / Prismatic),
   infrastructure is managed by dedicated migration pipelines. Jin inserting
   DDL or creating buckets would conflict.

3. **Predictability.** A background daemon that silently provisions remote
   resources is surprising. These operations should be explicit, auditable,
   and human-initiated.

### Who Provisions Remote Resources

| Sink Type | Who Provisions | How |
|-----------|---------------|-----|
| Postgres | Admin or platform owner | Versioned SQL, migration tooling, or other admin workflow |
| S3 | Infrastructure team | Terraform, AWS console, or equivalent |
| Webhook | Receiving service | Endpoint exists before jin pushes to it |

---

## Sink Families

Sinks fall into three families. These are **documentation categories**,
not runtime types — the coordinator treats all sinks uniformly through
the `Sink` interface.

### Table Sinks (Postgres)

Sinks that write to schema-managed databases with row-level semantics.

**Characteristics:**
- Remote tables must already exist (no DDL from daemon)
- Schema version handshake verifies compatibility before pushing
- Write format: parameterized INSERT with ON CONFLICT upsert
- Idempotency is inherent (upsert on primary key)

**Schema version handshake** (Postgres-specific):

When a Postgres sink connects, it reads the schema version from `jin_meta`:

```sql
SELECT value FROM jin_meta WHERE key = 'schema_version';
```

```
versions match     → push normally
remote > local     → PAUSE pushing (jin binary is outdated)
local > remote     → PAUSE pushing (remote schema is outdated)
no jin_meta table  → REFUSE to push (schema never initialized)
```

Major version mismatch blocks pushes. Minor mismatch warns but continues.
Data stays safe in local SQLite when paused. `jin status` shows the state:

```
$ jin status
  Sinks:
    ✓ postgres-team    schema v2.3, revision 142/142 synced
    ⚠ postgres-finance schema v2.1, PAUSED — remote schema outdated
                       Run the Postgres integration's schema migration workflow
```

**Wire format:**
```sql
INSERT INTO jin_conversations (...) VALUES ($1, $2, ...)
ON CONFLICT (id) DO UPDATE SET ...;

INSERT INTO jin_messages (...) VALUES ($1, $2, ...)
ON CONFLICT (id) DO UPDATE SET ...;

INSERT INTO jin_tool_calls (...) VALUES ($1, $2, ...)
ON CONFLICT (id) DO UPDATE SET ...;
```

Table names are prefixed with `jin_` in Postgres to avoid collisions.

**Type mapping:**

| SQLite | Postgres |
|--------|----------|
| TEXT (timestamps) | TIMESTAMPTZ |
| INTEGER (booleans) | BOOLEAN |
| REAL (cost) | DOUBLE PRECISION |

**Postgres-only columns**:
- `team_id TEXT` — multi-tenant scoping
- `user_id TEXT` — export-side user attribution
- `content_tsv tsvector` — auto-populated FTS

`content_tsv` remains schema-owner populated. When configured with sink-level
export metadata, Jin may set `team_id` and `user_id` on conversation rows.
These columns are integration metadata, not part of the canonical snapshot
payload shape.

### Object Sinks (S3 / R2 / MinIO)

Sinks that write files to object storage.

**Characteristics:**
- No schema handshake — readiness is about bucket/credentials/permissions
- Write format: JSON file upload, one file per conversation
- Idempotency is inherent (overwrite same key)
- No version negotiation — last-write-wins

**Key path:**
```
{prefix}/{adapter_id}/{conversation_id}.json
```

**Payload:** The JSON file contains the full snapshot:
```json
{
  "conversation": { ... },
  "messages": [ ... ],
  "toolCalls": [ ... ]
}
```

If configured with sink-level export metadata, object sinks may include a
separate top-level `_meta` envelope:

```json
{
  "_meta": {
    "teamId": "jin-team",
    "userId": "eden"
  },
  "conversation": { ... },
  "messages": [ ... ],
  "toolCalls": [ ... ]
}
```

`_meta` means:

- optional export/integration metadata only
- top-level sibling to `conversation`, `messages`, and `toolCalls`
- not part of the canonical conversation snapshot
- not read back into Jin's local conversation model

`_meta` does **not** mean:

- a place to move canonical snapshot fields
- a second conversation payload
- a generic extension bag for arbitrary local runtime state

For this lane, the only canonical `_meta` keys are sink-scoped export metadata
such as `teamId` and `userId`.

Each push overwrites the previous file for that conversation. This is
correct for jin's full-snapshot model — the latest push is the complete
truth.

**Authentication:** AWS Signature V4. Supports AWS credentials,
R2 tokens, and MinIO access keys through the same S3-compatible API.

### Delivery Sinks (Webhook)

Sinks that push via HTTP to external endpoints.

**Characteristics:**
- No schema handshake — readiness is about reachability and auth
- Write format: HTTP POST with JSON body
- Idempotency requires explicit key (receiver's responsibility to dedup)
- Retries are relevant (429, 503 → retry; 401, 404 → fail)

**Wire format:**
```json
{
  "batch": [
    {
      "idempotencyKey": "conv-abc:r7",
      "conversation": { ... },
      "messages": [ ... ],
      "toolCalls": [ ... ]
    }
  ]
}
```

The webhook sink derives `idempotencyKey` from `${conversation.id}:r${attemptedRevision}`
and includes it in the POST body. This gives receivers a stable dedup key
for at-least-once delivery.

If configured with sink-level export metadata, delivery sinks may project that
metadata into transport-specific headers such as `X-Jin-Team` and
`X-Jin-User`. These headers are integration metadata, not part of the
canonical snapshot payload.

**Timeout:** Configurable per webhook sink. Default 30 seconds.
Timeout is treated as a failure — the conversation remains eligible for
the next push cycle.

---

## Sink-Internal Optimization

The pipeline always sends full conversation snapshots (BP-02). A sink may
optimize its write path internally. This optimization is invisible to the
pipeline — it happens inside `push()`.

For example, the Postgres sink could diff incoming messages against remote
state and only INSERT new rows. This is a **sink-internal concern**. The
pipeline sends the full snapshot, records `attemptedRevision`, and checks
the `PushResult`.

**Why the pipeline doesn't own delta logic:** The store uses replace
semantics (BP-05) and corrections can change existing messages without
increasing count. Pipeline-level delta was removed because it could
silently skip corrections. If a sink wants delta optimization, it
implements it internally with full knowledge of its remote storage model.

---

## One-Way Doors (Contract Invariants)

These are the load-bearing decisions in the sink contract. Changing any
of them after v2 ships would require coordinated migration.

| Invariant | Why It's a One-Way Door |
|-----------|------------------------|
| Push is based on full snapshots, not pipeline-level deltas | Sinks are built to receive complete data. Adding pipeline deltas later requires every sink to handle partial payloads. |
| The payload carries `attemptedRevision` | Sinks and push state recording depend on this value. Removing it breaks the revision model. |
| The daemon does not provision remote resources | Users and deployment pipelines are built around explicit provisioning. Silently adding DDL would break trust. |
| Sinks fall into families with different readiness contracts | Table sinks check schema version. Object sinks check bucket access. Delivery sinks check endpoint reachability. Unifying these would lose meaningful distinction. |

---

## Validation Conclusions

This contract was pressure-tested before being marked reviewed.

The enduring conclusions are:

- A single full-snapshot `PushPayload` shape works across the three
  integration families exercised during review: table, object, and delivery.
- `attemptedRevision` is sufficient as the sink-facing revision context for
  replay-safe upsert/overwrite behavior and stable delivery idempotency keys.
- The "no privileged remote provisioning" rule is workable in practice:
  sinks can operate correctly against admin-provisioned remote resources.
- A table sink's schema/version handshake should recover after remote state is
  fixed, without requiring a full process restart.

These are the architectural conclusions that matter. Experiment mechanics and
temporary spike artifacts are intentionally kept outside the blueprint.

---

## What This Blueprint Does NOT Cover

| Topic | Blueprint |
|-------|-----------|
| Push scheduling and eligibility | BP-02 |
| Revision tracking and push state | BP-05 |
| Route matching (which sinks receive which conversations) | BP-08 |
| `jin schema apply` command implementation | CLI command, not a blueprint |
| Jin Team / Prismatic backend migration | External coordination |
