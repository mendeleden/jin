# Re-Review: W2-SINK-02 Postgres Reference Sink (recheck)

- reviewer: `cursor-REVIEWER-postgres-reference-sink-recheck`
- packet: `W2-SINK-02`
- date: `2026-04-04`
- verdict: `approved` (prior blocker resolved; three informational items from
  `2026-04-02-W2-SINK-02-cursor` remain non-blocking)

## Scope Of Review

Narrow re-review after the fix pass following
`.execution/reviews/2026-04-02-W2-SINK-02-cursor.md`. Verified:

1. whether the P2 handshake misclassification is actually resolved
2. whether a regression test covers permission-denied on `jin_meta`
3. whether BP-06 readiness/handshake semantics still hold after the fix
4. whether boundary discipline was preserved (no spread outside packet-owned
   files)

Files read:

- `docs/blueprint/BP-06-sink-contract.md`
- `docs/blueprint/BP-05-store-and-migration.md`
- `docs/blueprint/BP-02-data-flow.md`
- `src/sinks/postgres.ts`
- `src/sinks/postgres-search.ts`
- `src/sinks/types.ts`
- `test/postgres-reference-sink.test.ts`
- `.execution/program.md`, `.execution/blueprints.md`,
  `.execution/packets/W2-SINK-02.md`,
  `.execution/agents/codex-WORKER-postgres-reference-sink.md`
- `.execution/reviews/2026-04-02-W2-SINK-02-cursor.md`,
  `.execution/reviews/2026-04-01-W1-SINK-01-cursor.md`

Verification run:

- `bun test test/postgres-reference-sink.test.ts` — 5 pass, 0 fail,
  24 expect() calls
- `git diff --stat src/sinks/postgres.ts test/postgres-reference-sink.test.ts`
  — 41 insertions, 8 deletions; no other files touched in this fix pass

## Blocking Findings

**None.** The previously blocking P2 handshake bug is resolved.

## BP Acceptance Matrix Verification

| Packet acceptance check | BP-06 requirement | Status | Evidence |
|-------------------------|-------------------|--------|----------|
| Remote schema/version mismatch blocks or pauses pushes | BP-06 §Schema version handshake (lines 150-175) | implemented | `src/sinks/postgres.ts`:338-354 (major-version pause, both directions); `test/postgres-reference-sink.test.ts`:33-55 (major-mismatch test) |
| No DDL emitted during normal push behavior | BP-06 §No Privileged Remote Provisioning (lines 101-124) and frozen `.claude/rules/sinks.md` | implemented | `src/sinks/postgres.ts`:89-148 (only SELECT/BEGIN/COMMIT/ROLLBACK/DELETE/INSERT); `test/postgres-reference-sink.test.ts`:121-136 (DDL filter asserts `[]`) |
| pushed + failed = payload count | BP-06 §48, interface contract lines 42-54 | implemented | `src/sinks/postgres.ts`:99-118, 511-523; `test/postgres-reference-sink.test.ts`:98-140 |
| Per-conversation result reporting | BP-06 §48 | implemented | `src/sinks/postgres.ts`:99-118 (per-payload try/catch records `{conversationId, error}`); `test/postgres-reference-sink.test.ts`:125-134 |
| Tests cover handshake success, mismatch, and no-schema scenarios | packet §Acceptance Checks | implemented | `test/postgres-reference-sink.test.ts`:20-96 (success, major-mismatch, missing-table, permission-denied) |
| Readiness failure accurately describes the failure mode (re-check gate) | BP-06 readiness reporting | implemented | `src/sinks/postgres.ts`:525-533 (tightened `looksLikeMissingMetaTable`) + `:543-555` (`readPostgresErrorCode`); `test/postgres-reference-sink.test.ts`:77-96 |

### Handshake re-verification in detail

BP-06 §150-163 specifies the readiness table:

```
versions match     → push normally
remote > local     → PAUSE pushing (jin binary is outdated)
local > remote     → PAUSE pushing (remote schema is outdated)
no jin_meta table  → REFUSE to push (schema never initialized)
```

The sink now implements this cleanly:

- **versions match:** `src/sinks/postgres.ts`:338-356 → `{ ok: true }`
- **remote > local:** `:338-344` → "Push paused until jin is upgraded"
- **local > remote:** `:347-354` → "Push paused until the remote schema
  is upgraded"
- **no `jin_meta` table:** `:358-362` via tightened
  `looksLikeMissingMetaTable(error)` (line 525-533) — now requires
  SQLSTATE `42P01` OR the substrings `does not exist` / `undefined table`,
  in addition to the `jin_meta` token
- **other failures (auth, network, unparseable version):** now correctly
  fall through to `toErrorMessage(error)` at line 365, surfacing the real
  cause

## V1 Comparison

`no prior v1 surface` — the v1 Postgres sink was a session-shaped writer.
The v2 reference sink is a new implementation behind a frozen v2 contract
and behind the BP-06 handshake. The explicit legacy-payload rejection at
`src/sinks/postgres.ts`:68-78, 496-509 is an intentional bridge, already
documented as informational in `2026-04-02-W2-SINK-02-cursor` (I3).

## Aligned

### P2 blocker resolved

- `looksLikeMissingMetaTable()` no longer matches on `relation` text alone.
  (`src/sinks/postgres.ts`:525-533)
- Matching now requires (a) `jin_meta` in the message AND (b) one of:
  - SQLSTATE `42P01` (`undefined_table`) when the driver exposes a
    structured error code, or
  - the substrings `does not exist` or `undefined table`.
- `readPostgresErrorCode(error)` (lines 543-555) pulls `code` /
  `sqlstate` / `sqlState` off driver-style error objects and ignores
  plain HTTP `Error` instances.
- Permission-denied errors like
  `permission denied for relation public.jin_meta` now fall through to
  the generic error arm at `:365`, so readiness reports the real auth
  failure instead of fabricating a missing-schema report.

### Regression test for permission-denied is present and specific

- `test/postgres-reference-sink.test.ts`:77-96 asserts:
  - `result.ok === false`
  - `result.error` contains `Postgres HTTP error 403`
  - `result.error` contains the original
    `permission denied for relation public.jin_meta`
  - `result.error` does NOT contain `Remote schema is not initialized`
  - the transport is invoked exactly once (no retry pressure added)
- This is the exact opposite of the previous misclassification; the
  regression is anchored in the assertion that the missing-schema string
  does not appear.

### Missing-schema test still green under the tighter matcher

- `test/postgres-reference-sink.test.ts`:57-75 mocks
  `relation "public.jin_meta" does not exist` with HTTP 400, which
  matches on both `jin_meta` and `does not exist`, so the
  schema-not-initialized branch still fires correctly.
- The happy-path handshake (`:20-31`) and the major-mismatch pause
  (`:33-55`) continue to pass with unchanged semantics.

### BP-06 readiness semantics after the fix

- The handshake SELECT still runs on every `healthCheck()` AND every
  `push()` readiness check (`src/sinks/postgres.ts`:64-66, 89-97), so
  the sink can still recover after remote state is fixed without a
  process restart (BP-06 §Validation Conclusions).
- `failAllPayloads()` (lines 511-523) still emits one explicit error per
  conversation on readiness failure, so `pushed + failed === payloads.length`
  continues to hold in the paused path.

### Boundary discipline

- `git diff --stat` shows only `src/sinks/postgres.ts` and
  `test/postgres-reference-sink.test.ts` changed in this fix pass —
  both packet-owned.
- `src/sinks/types.ts` is unchanged.
- No edits to `src/sinks/webhook.ts`, `src/sinks/s3.ts`, `src/db/**`,
  `src/pipeline/**`, or `src/config.ts`.
- `src/sinks/postgres-search.ts` was read as reference only and not
  touched.

## Drift

No new drift introduced by this fix pass.

The three informational items from `2026-04-02-W2-SINK-02-cursor` remain
open at the same severity. They were previously accepted as non-blocking
and have **not** become worse:

| Item | Prior severity | Current status |
|------|---------------|----------------|
| DELETE+INSERT write strategy for messages/tool_calls (I1) | Informational | Unchanged — `src/sinks/postgres.ts`:121-147, 236-307 |
| Minor-version mismatch continues silently, no operator warning (I2) | Informational | Unchanged — `src/sinks/postgres.ts`:338-354 still treats only major mismatch; minor drift path is absent |
| Legacy dual-interface bridge (I3) | Informational | Unchanged — `src/sinks/postgres.ts`:33, 68-78, 496-509 |

Minor tightening observation (not drift, not a new finding): the HTTP
transport path in `queryHttp()` (lines 396-413) throws a plain `Error`
without a `.code` property, so in the current HTTP integration only the
text-signal arm of `looksLikeMissingMetaTable()` can fire. This is fine
and matches how the existing tests exercise the path; the SQLSTATE arm
is available for the native psql transport (`queryPsql`) when the driver
surfaces `code` / `sqlstate` / `sqlState`. No action needed.

## Unowned Spread

None.

## Progress

- BP-06: moves from `in_progress` (blocked on Postgres) to the status
  where the Postgres reference-table family is **implemented and
  validated** against the BP-06 handshake contract. The only open BP-06
  surface is the S3 object-sink work (tracked separately under
  `W2-SINK-03`, already `approved`), and the three informational items
  on this sink, which are not blocking.
- Schema handshake, no-DDL push path, full-snapshot batch handling, and
  per-conversation result accounting are all implemented, covered by the
  packet test, and re-verified against BP-06 §Schema version handshake
  and §No Privileged Remote Provisioning.

## Codex Decisions Needed

1. `W2-SINK-02` is now approvable. The prior blocker is resolved and the
   regression test is specific enough to catch a regression of the same
   misclassification. Recommend moving `W2-SINK-02` from `needs_codex` to
   `approved` and updating `program.md`.
2. Decide whether to absorb the three informational items (DELETE+INSERT
   internal strategy, minor-version warning, legacy bridge) into a
   follow-up packet or leave them as open notes under BP-06. Neither
   choice blocks approval of this packet.
3. Confirm that the minor-version path should stay silent for now, or
   whether a small `console.warn` belongs in `checkSchemaCompatibility()`.
   This is deliberately left out of scope unless Codex schedules it.
