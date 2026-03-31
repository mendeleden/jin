# Bugs

Confirmed bugs found during the v2 code review. Ordered by severity.

---

## BUG-1: Route matching uses string equality, not glob (Q15)

**Severity: High** — documented feature doesn't function.

`matchesRoute` in `routing.ts:41-51` uses `===` comparison. Config
comments and all design docs show wildcards (`github.com/company/*`,
`/Users/*/personal/*`) that don't work. Additionally, multiple fields
in one `RouteMatch` are OR (any match triggers) instead of AND (all
must match), making monorepo routing impossible.

**Files:** `src/routing.ts:41-51`

**Fix:** Implement glob evaluation (minimatch or simple wildcard
matcher). Change multiple fields to AND semantics.

---

## BUG-2: Stat cache invalidates ALL sessions for shared-DB adapters (Q32)

**Severity: High** — affects Cursor, Kiro, Warp.

The `ingestStatCache` in `watch.ts:428` checks file `size + mtime`.
For shared-database adapters (Cursor's `state.vscdb` with 65+ sessions,
Kiro, Warp), all sessions share one `sourcePath`. Any change to any
session invalidates the cache for all of them → full re-parse of
everything on every change.

**Files:** `src/commands/watch.ts:428-478`

**Fix:** Delete `ingestStatCache` from ingest layer. Move change
detection into adapters — they know their own storage model (Q34).

---

## BUG-3: `insertMessages` missing `record_type` column (Q11)

**Severity: Medium** — messages inserted via delta path get empty
record_type.

`insertMessages` has 12 columns, `upsertMessages` has 13. The delta
ingest path (`watch.ts:463`) uses `insertMessages`, so messages
added via the watcher's `newMessages` optimization silently lose
their `record_type`.

**Files:** `src/store.ts:274-291`

**Fix:** Delete `insertMessages`. Always use `upsertMessages` (Q11).

---

## BUG-4: `newMessages` afterIndex semantics wrong (Q31)

**Severity: Medium** — reads from wrong offset if records were filtered.

`watch.ts:458` passes `store.messageCountForSession()` (DB row count)
as `afterIndex`. `claude-code.ts:303` uses it to skip JSONL lines.
If any record types are dropped during ingest (progress, file-history,
etc.), DB row count < JSONL line count → reads from wrong position →
duplicate or missing messages.

**Files:** `src/commands/watch.ts:458-461`, `src/adapters/claude-code.ts:303`

**Fix:** Move delta logic into adapter-internal concern (Q34). Adapter
tracks its own byte offset, not message count.

---

## BUG-5: Windows `isServiceActive` compares localized string (Q24)

**Severity: Medium** — silent failure on non-English Windows.

`runguard.ts:65` compares `Get-ScheduledTask.State` output against
`"Running"`. Localized Windows returns translated strings (e.g.,
`"En cours d'exécution"` in French).

**Files:** `src/runguard.ts:60-66`

**Fix:** Use exit code or structured output (`Format-List`) instead
of comparing a localized display string.

---

## BUG-6: Config file write race (Q6)

**Severity: Low** — rare in practice (config writes are infrequent).

`loadConfig()`/`saveConfig()` are plain file reads/writes with no
locking. If `jin connect` runs while the daemon is auto-detecting
adapters at startup, last writer wins and changes are lost.

**Files:** `src/config.ts:96-110`

**Fix:** Accept the race (pragmatic), or implement daemon-owns-writes
pattern where CLI sends config mutations via API.

---

## BUG-7: Redundant guard checks run 3-4x per `jin start` (Q29, Q30)

**Severity: Low** — wastes subprocess calls, but doesn't corrupt data.

`jin start` hits "is jin running?" guards in `startCommand`, again in
`watchCommand`, and again in the spawned child process. Different
guards have different behavior (some SIGKILL, some don't).

**Files:** `src/commands/start.ts`, `src/commands/watch.ts:23-56`

**Fix:** Guards live only in `startCommand`. `watchCommand` trusts
its caller. Child processes trust env vars (`JIN_DAEMON`,
`JIN_LAUNCHED_BY_SERVICE`).
