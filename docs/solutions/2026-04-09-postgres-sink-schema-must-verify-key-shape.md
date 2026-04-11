---
title: Postgres sink schema must verify key shape, not just version
date: 2026-04-09
tags: [sink, schema, postgres, migration, bp-06, bp-05]
related: [W3-SINK-04, BP-05, BP-06]
---

# Postgres sink schema must verify key shape, not just version

## Problem

The clean-start sink validation showed a misleading partial success:

- local SQLite ingest completed
- Postgres delivery started working again after the `sql.begin(...)` fix
- but many pushes still failed with `duplicate key value violates unique constraint "jin_tool_calls_pkey"`

The root cause was schema drift inside the remote Postgres integration:

- the local v2 store uses composite tool-call identity:
  `(conversation_id, message_id, id)`
- the Postgres integration schema still defined `jin_tool_calls` with
  `PRIMARY KEY (id)`

Schema version compatibility alone did not catch this, because the remote
reported a matching major version while still carrying an incompatible key.

## Solution

The fix had three parts:

1. update the Postgres integration schema so `jin_tool_calls` uses
   `PRIMARY KEY (conversation_id, message_id, id)`
2. make `jin team schema apply` repair existing installs that still have the
   old `PRIMARY KEY (id)` shape
3. make `PostgresSink.healthCheck()` verify the live primary-key definition
   instead of trusting `schema_version` alone

This turned the sink from “optimistically write and fail late” into “refuse the
old shape and tell the operator to rerun `jin team schema apply`.”

## Key Insight

For sink families that mirror local ontology into a remote store, compatibility
is not just a version string. It is the combination of:

- schema version
- key shape
- write semantics

If local identity becomes composite, remote health checks must validate the
composite key explicitly. Otherwise the system can look healthy while silently
dropping or rejecting live data.

## Prevention

- keep persona-level sink tests that assert the actual remote key definition
- when remote schema identity changes, add a repair path to the operator DDL
  and a sink-side readiness check in the same change
- treat “partial delivery with matching schema version” as a signal to inspect
  constraints, not just version metadata

## Related

- `W3-SINK-04`
- `BP-05` store spine
- `BP-06` sink contract

## Files Changed

- `src/commands/schema.ts`
- `src/sinks/postgres.ts`
- `test/postgres-reference-sink.test.ts`
- `test/team-bootstrap.test.ts`
- `test/persona-local-postgres.test.ts`
