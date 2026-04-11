# W3-VALIDATE-01 Live Adapter Validation And Store Reconciliation

## Scope

- validation date: `2026-04-08`
- packet: `W3-VALIDATE-01`
- harness surface:
  - `scripts/live-validation/run.ts`
  - `test/live-validation/run.test.ts`
- validation mode:
  - disposable output root at `/tmp/jin-live-validation-xNrhYL`
  - disposable config dir and SQLite store under `/tmp/jin-live-validation-xNrhYL/config`
  - real local data roots for `cursor`, `claude-code`, and `codex`
  - no configured sinks and no remote push

## What Changed

This lane adds a packet-local Bun harness that:

- runs the v2 adapter discover/load/write path directly:
  - `findChanged({ kind: "startup-scan" })`
  - `loadConversation(ref)`
  - `store.writeBundle(bundle)`
- writes a disposable `config.json` plus `store.db`
- emits machine-readable artifacts:
  - `report.json`
  - `reconciliation.json`
- compares source-derived counts against the stored `conversations`,
  `message_count`, `tool_count`, and `_jin_sync` rows
- treats null bundles as reconciliation failures so "detected refs but no
  stored data" is visible immediately instead of being mistaken for a clean run

## Exact Commands

### Focused automated validation

```sh
bun test test/live-validation/run.test.ts
```

Observed:

- `2` tests passed
- coverage now includes:
  - harness-side Claude populated-path precedence
  - end-to-end artifact emission for Codex + Claude fixture overrides

### Live adapter validation run

```sh
bun scripts/live-validation/run.ts \
  --adapters=cursor,claude-code,codex \
  --output-dir=/tmp/jin-live-validation-xNrhYL \
  --cursor-chats-dir="$HOME/.cursor/chats" \
  --cursor-db-path="$HOME/Library/Application Support/Cursor/User/globalStorage/state.vscdb" \
  --claude-projects-dir="$HOME/.claude/projects" \
  --codex-home="$HOME/.codex"
```

Observed:

- exit code: `1`
- packet-local artifacts were still written
- stderr included:
  - `[cursor adapter] Failed to list Layer 1 composer snapshots: unable to open database file`
  - repeated `fatal: not a git repository` lines from adapter git-resolution on
    source `cwd` values that are not git working trees

### Cursor SQLite follow-up checks

```sh
bun -e 'import { Database } from "bun:sqlite"; const db = new Database(process.argv[1], { readonly: true }); const row = db.query("SELECT name FROM sqlite_master WHERE type = \"table\" ORDER BY name LIMIT 5").all(); console.log(JSON.stringify(row)); db.close();' "$HOME/Library/Application Support/Cursor/User/globalStorage/state.vscdb"
```

Observed:

- failed with `SQLiteError: unable to open database file`
- error code: `SQLITE_CANTOPEN`

```sh
bun -e 'import { Database } from "bun:sqlite"; const db = new Database(process.argv[1], { readonly: true }); const row = db.query("SELECT name FROM sqlite_master WHERE type = \"table\" ORDER BY name LIMIT 10").all(); console.log(JSON.stringify(row)); db.close();' "$HOME/.cursor/chats/96cf2bae0b7505f5ec5749e5e0c44142/0ff480c6-bdcd-4a4f-b94a-09158715eba0/store.db"
```

Observed:

- succeeded
- returned tables: `blobs`, `meta`

## Observed Artifacts

- aggregate report:
  - `/tmp/jin-live-validation-xNrhYL/report.json`
- adapter reconciliation JSON:
  - `/tmp/jin-live-validation-xNrhYL/reconciliation.json`
- disposable config:
  - `/tmp/jin-live-validation-xNrhYL/config/config.json`
- disposable store:
  - `/tmp/jin-live-validation-xNrhYL/config/store.db`

Store footprint at handoff:

- `store.db`: `314007552` bytes
- `store.db-shm`: `32768` bytes
- `store.db-wal`: `0` bytes

## Adapter Reconciliation

### Cursor

- source files touched: `6`
- refs discovered: `6`
- bundles loaded: `0`
- null bundles: `6`
- unique conversations loaded: `0`
- write attempts: `0`
- stored conversations: `0`
- stored messages: `0`
- stored tool calls: `0`
- issues: `6`
  - `null-bundle`: `6`

Interpretation:

- the live harness can now fail fast on Cursor before dogfood, but the current
  local validation result is not clean
- Bun could not open the live Cursor global-storage database at
  `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`
- the layer-3 per-chat `store.db` files are readable, but every discovered ref
  still resolved to a null bundle, so no Cursor conversations reached the temp
  store

### Claude Code

- source files touched: `900`
- refs discovered: `916`
- bundles loaded: `916`
- unique conversations loaded: `910`
- duplicate loaded conversation IDs: `6`
- source messages across unique conversations: `45096`
- source tool calls across unique conversations: `16435`
- write attempts: `887`
- write errors: `29`
- stored conversations: `881`
- stored messages: `36948`
- stored tool calls: `13892`
- store sync rows: `881`
- issues: `35`
  - `duplicate-loaded-conversation-id`: `6`
  - `missing-store-conversation`: `29`

Observed write-error class:

- all `29` write failures were `UNIQUE constraint failed: messages.id`
- the `29` missing store conversations line up exactly with those `29`
  failed writes

Representative missing conversations from the artifact:

- `aside_question-2fc336cb9230930f`
- `aside_question-c130ba6021b4a170`
- `acompact-c4a7f98559f56afc`
- `ca95bce7-24cd-48f7-afe8-b5d08a49ab01`

Interpretation:

- the live harness proves Claude now gets far enough to discover and load the
  real dataset before release
- reconciliation also proves the current store ingest is still not safe on a
  subset of the live dataset because message IDs collide across some loaded
  conversations
- the duplicate-loaded conversation IDs and the `messages.id` uniqueness
  failures are now visible from a temp-store sanity pass instead of surfacing
  later in a full local runtime attempt

### Codex

- source files touched: `121`
- refs discovered: `201`
- bundles loaded: `201`
- null bundles: `0`
- unique conversations loaded: `201`
- source messages: `19121`
- source tool calls: `16621`
- write attempts: `201`
- write errors: `0`
- stored conversations: `201`
- stored messages: `19121`
- stored tool calls: `16621`
- issues: `0`

Interpretation:

- Codex is clean under this harness
- source-derived conversation, message, and tool-call counts matched the temp
  store exactly on the real local dataset

## Overall Result

- `report.summary.ok`: `false`
- adapters validated: `3`
- adapters with issues: `cursor`, `claude-code`
- total refs discovered: `1123`
- total unique conversations loaded: `1111`
- total stored conversations: `1082`
- total stored messages: `56069`
- total stored tool calls: `30513`

## Durable Lesson

### Problem

Adapter confidence was previously gated by local dogfood and fixture-scale
checks, which meant source-vs-store drift could survive until a full runtime
attempt failed on a real workstation.

### Solution

The packet-local harness writes a disposable store from the real v2
discover/load/write path and reconciles source-derived counts against stored
rows for each adapter before any sink or daemon behavior is involved.

### Reusable Insight

For pre-release live validation, `detect()` and `findChanged()` counts are not
enough. The useful release signal is whether those refs survive `loadConversation`
and `writeBundle()` into a disposable store without count drift, null bundles,
or store-level integrity failures.

### Prevention

Run this harness before future local dogfood or release-candidate attempts and
treat any of these as immediate blockers:

- discovered refs with null bundles
- loaded conversations that never reach the temp store
- write-time uniqueness failures
- source/store message or tool-call count mismatches

## Follow-Ups

- Cursor:
  - root-cause why Bun cannot open the live global-storage DB even though the
    file exists and the adapter still detects the source
  - root-cause why all six live layer-3 refs load as null bundles
- Claude Code:
  - fix the live `messages.id` collision class so the `29` missing-store
    conversations can be ingested cleanly
  - investigate whether the `6` duplicate loaded conversation IDs are expected
    source overlap or an adapter identity bug
- Codex:
  - no blocking reconciliation issue from this run
- Harness:
  - keep the live sanity pass packet-local and reusable before release
  - if future packets need a repo-wide release checklist entry, promote this
    command from the audit into the broader release runbook from a Codex-owned
    lane
