# W3-ADAPTER-10 Cursor Live Layer3 Decode And Revalidation

## Scope

- validation date: `2026-04-09`
- packet: `W3-ADAPTER-10`
- owned code:
  - `src/adapters/cursor.ts`
  - `test/cursor-adapter.test.ts`
- validation mode:
  - focused adapter tests plus packet-local typecheck
  - real local Cursor dataset under `~/.cursor/chats`
  - disposable live-validation outputs under `/tmp`
  - no sink or pipeline contract changes

## What Changed

- live layer3 decoding no longer assumes `meta.latestRootBlobId` points at a
  JSON message with a `parentId` chain
- the adapter now:
  - loads all blob rows as raw bytes plus JSON when available
  - recursively expands protobuf-framed pointer blobs by following embedded
    32-byte blob references in order
  - keeps JSON message rows as the actual emitted messages
  - stitches separate `role: "tool"` result rows back onto the earlier
    assistant tool call when they share a `toolCallId`
- layer3 message ids and tool-call ids are now conversation-scoped so Cursor’s
  content-addressed blob ids do not collide across conversations in the local
  store
- focused tests now cover:
  - live-style binary pointer roots
  - cross-conversation layer3 id collisions
  - honest warning-and-continue behavior when the shared layer1 DB path exists
    but cannot be opened

## Exact Commands

### Focused automated validation

```sh
bun test test/cursor-adapter.test.ts
```

Observed:

- `7` tests passed
- coverage now includes:
  - protobuf-framed pointer-root decoding
  - recursive pointer flattening
  - tool-result stitching across separate `tool` rows
  - conversation-scoped layer3 ids
  - degraded layer1 warning-and-continue behavior

```sh
bun x tsc --noEmit --pretty false src/adapters/cursor.ts test/cursor-adapter.test.ts
```

Observed:

- exit code: `0`

### Direct layer1 DB-open probe

```sh
bun -e 'import { Database } from "bun:sqlite"; const db = new Database(process.argv[1], { readonly: true }); const row = db.query("SELECT name FROM sqlite_master WHERE type = \"table\" ORDER BY name LIMIT 5").all(); console.log(JSON.stringify(row)); db.close();' "$HOME/Library/Application Support/Cursor/User/globalStorage/state.vscdb"
```

Observed:

- exit code: `0`
- returned tables:
  - `ItemTable`
  - `cursorDiskKV`

Interpretation:

- the earlier `SQLITE_CANTOPEN` symptom from `W3-VALIDATE-01` did not
  reproduce on this final packet run
- no adapter code change was required to “unlock” layer1
- the adapter still keeps the warning-and-continue degraded path covered by
  test if this workstation-level failure recurs later

### Ref-split probe on the real local dataset

```sh
bun -e 'import { CursorAdapter } from "./src/adapters/cursor"; const adapter = new CursorAdapter({ chatsDir: process.env.HOME + "/.cursor/chats", globalStorageDbPath: process.env.HOME + "/Library/Application Support/Cursor/User/globalStorage/state.vscdb" }); const refs = await adapter.findChanged({ kind: "startup-scan" }); const globalDb = process.env.HOME + "/Library/Application Support/Cursor/User/globalStorage/state.vscdb"; const layer1 = refs.filter((ref) => ref.sourcePath === globalDb).length; const layer3 = refs.length - layer1; console.log(JSON.stringify({ total: refs.length, layer1, layer3 }, null, 2));'
```

Observed:

- total refs discovered: `96`
- layer1 refs: `90`
- layer3 refs: `6`

### First live Cursor-only rerun after pointer decode

```sh
bun scripts/live-validation/run.ts \
  --adapters=cursor \
  --output-dir=/tmp/jin-live-validation-cursor-layer3-20260409 \
  --cursor-chats-dir="$HOME/.cursor/chats" \
  --cursor-db-path="$HOME/Library/Application Support/Cursor/User/globalStorage/state.vscdb"
```

Observed:

- exit code: `1`
- decode outcome:
  - refs discovered: `96`
  - bundles loaded: `96`
  - null bundles: `0`
  - unique conversations loaded: `96`
- store outcome:
  - write attempts: `92`
  - write errors: `4`
  - stored conversations: `92`
  - stored messages: `1632`
  - stored tool calls: `779`
- write-error class:
  - `UNIQUE constraint failed: messages.id`

Interpretation:

- fixing the pointer-root decode removed the original `6/6` null-bundle
  failure class from `W3-VALIDATE-01`
- the first clean load surfaced a second adapter-local issue: raw layer3 blob
  ids are content-addressed and can repeat across different conversations

### Final live Cursor-only rerun after conversation-scoped layer3 ids

```sh
bun scripts/live-validation/run.ts \
  --adapters=cursor \
  --output-dir=/tmp/jin-live-validation-cursor-layer3-20260409b \
  --cursor-chats-dir="$HOME/.cursor/chats" \
  --cursor-db-path="$HOME/Library/Application Support/Cursor/User/globalStorage/state.vscdb"
```

Observed:

- exit code: `0`
- source files touched: `7`
- refs discovered: `96`
- bundles loaded: `96`
- null bundles: `0`
- unique conversations loaded: `96`
- duplicate loaded conversation ids: `0`
- write attempts: `96`
- write errors: `0`
- stored conversations: `96`
- stored messages: `1730`
- stored tool calls: `876`
- store sync rows: `96`
- issues: `0`

Cross-checks:

```sh
sqlite3 /tmp/jin-live-validation-cursor-layer3-20260409b/config/store.db "SELECT adapter_id, COUNT(*) FROM conversations GROUP BY adapter_id;"
sqlite3 /tmp/jin-live-validation-cursor-layer3-20260409b/config/store.db "SELECT COUNT(*) AS conversations, SUM(message_count) AS messages, SUM(tool_count) AS tool_calls FROM conversations WHERE adapter_id = 'cursor';"
```

Observed:

- `cursor|96`
- `96|1730|876`

## Root Cause

The current layer3 loader had two live-data mismatches:

1. it treated `latestRootBlobId` as though it should parse directly into a JSON
   message row with a `parentId` chain
2. it used raw layer3 blob ids as stable message ids even though Cursor’s blob
   store is content-addressed and can reuse the same blob id in more than one
   conversation

On the real dataset, the six `store.db` roots were binary pointer nodes, not
JSON messages. Once those nodes were decoded, the adapter loaded the real
messages and immediately exposed the second issue via store write collisions.

## Final Outcome

- live Cursor layer3 refs on the real local dataset no longer collapse into
  null bundles
- the real local Cursor validation rerun is now clean end to end
- the layer1 global DB-open issue is **not** a current packet blocker because:
  - direct readonly open succeeded on `2026-04-09`
  - the final validation run ingested `90` layer1 refs plus `6` layer3 refs
- the adapter still covers the degraded warning path in tests if the earlier
  `state.vscdb` open failure returns on this workstation

## Artifacts

- aggregate report:
  - `/tmp/jin-live-validation-cursor-layer3-20260409b/report.json`
- adapter reconciliation JSON:
  - `/tmp/jin-live-validation-cursor-layer3-20260409b/reconciliation.json`
- disposable config:
  - `/tmp/jin-live-validation-cursor-layer3-20260409b/config/config.json`
- disposable store:
  - `/tmp/jin-live-validation-cursor-layer3-20260409b/config/store.db`

## Residual Issues

- no Cursor-specific validation issue remained in the final rerun
- the earlier `state.vscdb` `SQLITE_CANTOPEN` report now looks transient or
  environment-specific, but the packet does not claim to explain that
  workstation-level change
