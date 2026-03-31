---
paths:
  - "src/sinks/**/*.ts"
---

# Sink Rules

- Sinks never run DDL (CREATE TABLE, ALTER TABLE, CREATE INDEX). Jin pushes data only.
- Schema on Postgres is owned by admin/Prismatic. Jin connects with least-privilege credentials.
- SinkConfig uses discriminated union pattern — each sink type has its own typed interface extending `SinkConfigBase`.
- PushPayload includes `{ attemptedRevision, conversation, messages, toolCalls }`. Sinks receive the revision for idempotency (webhook dedup keys) and auditing.
- Push is best-effort: sinks attempt ALL payloads in a batch, not fast-fail. Retry is the pipeline's responsibility via periodic cycle.
- No `supportsDelta` flag — the pipeline always sends full snapshots. Sinks may optimize internally (BP-06).
- Health checks are reachability checks only. They don't validate payload format or receiver compatibility.
