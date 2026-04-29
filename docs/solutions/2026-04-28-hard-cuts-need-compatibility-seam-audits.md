---
title: Hard cuts need compatibility seam audits
date: 2026-04-28
tags: [sink, schema, config, migration, review]
related: [W3-TEAM-02, W3-TEAM-03, BP-06, BP-08, BP-09]
---

# Hard cuts need compatibility seam audits

## Problem

The `developerId` to `userId` change looked like a straightforward hard cut,
but the live compatibility risk was not the field rename itself. The real
drift was hidden in adjacent seams:

- configurable legacy Postgres table families like `jin_sessions`
- schema apply stamping `schema_version` before repair DDL completed
- broad legacy tests masking which v2 read/write paths still mattered

That made it easy to think the cut was done while legacy sink/export behavior
could still stay live through configuration or schema state.

## Solution

The fix was to treat the change as a sink/export contract cut, not a string
rename.

We:

- removed live `developerId` / `developer_id` / `X-Jin-Developer` paths
- removed non-canonical Postgres table-family overrides from the live sink
  path
- moved `schema_version` stamping to the end of the schema apply DDL
- deleted dead Postgres search-side code instead of broadening compatibility
- kept sink-specific tests focused on the live writer/export paths

## Key Insight

For Jin, hard cuts are only real when all surviving compatibility seams are
closed or deleted:

- config normalization
- remote schema/version shape
- configurable table/path overrides
- focused tests and harnesses

If any of those still permit the old behavior, the cut is only nominal.

## Prevention

- When removing a legacy contract term, audit adjacent config and schema
  escape hatches, not just direct symbol references.
- Add focused tests for the canonical live path before deleting broad legacy
  suites.
- For schema-owned remotes, only stamp version metadata after repair DDL has
  completed.

## Related

- Packet: `W3-TEAM-02`
- Packet: `W3-TEAM-03`
- Blueprint: `BP-06`
- Blueprint: `BP-08`
- Blueprint: `BP-09`

## Files Changed

- `src/sinks/postgres.ts`
- `src/commands/schema.ts`
- `test/postgres-reference-sink.test.ts`
- `test/team-bootstrap.test.ts`
