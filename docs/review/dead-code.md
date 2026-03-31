# Dead Code

Unused, unreachable, or superseded code identified during the v2 review.
Total: ~785 lines removable.

---

## DEAD-1: `rawDir` in StoreConfig (Q4)

Directory `~/.config/jin/raw/` is created but never written to. The
`raw_copy_path` column exists on sessions but is never populated.
`sourcePath` already points to the original file.

**Remove:** `rawDir` from StoreConfig, `raw_copy_path` from schema,
`mkdirSync(rawDir)` calls in ingest/watch. ~10 lines.

---

## DEAD-2: `syncMode` / `syncIntervalMs` in TeamConfig (Q5)

Set to `"realtime"` during `jin init`, never read by any code. The
daemon always pushes via the watcher loop regardless.

**Remove:** Both fields from TeamConfig. ~5 lines.

---

## DEAD-3: `self-observation.ts` (Q8)

36-line file with one function, one caller (`watch.ts:208`), 5 lines
of actual logic (one `startsWith` check). Over-engineered for "is
this path inside `~/.config/jin/`?"

**Remove:** Inline into `watch.ts` or `watcher.ts`. Delete file. ~30 lines.

---

## DEAD-4: `unpushedSessions` in store.ts (Q12)

Replaced by `sessionsNeedingPush` which also catches sessions that
changed since last push. Zero callers.

**Remove:** Method and its SQL. ~10 lines.

---

## DEAD-5: All project infrastructure (Q13)

6 Store methods, 2 tables, 2 indexes, `projectIdFromCwd()` in tagger.
Replaced by `git_remote` column on conversations.

| What | Lines |
|------|------:|
| `upsertProject()` | ~15 |
| `linkSessionToProject()` | ~5 |
| `refreshProjectStats()` | ~20 |
| `getSessionProjects()` | ~15 |
| `listProjects()` | ~10 |
| `costByProjectAndTool()` | ~10 |
| `projects` + `session_projects` tables | ~25 |
| `projectIdFromCwd()` in tagger.ts | ~15 |
| Indexes | ~5 |

**Remove:** ~130 lines total.

---

## DEAD-6: All tag infrastructure (Q15)

4 Store methods, 2 tables, `autoTagSession()` in tagger.ts. Replaced
by columns: `adapter_id` (tool), `model` (model), `git_remote`
(project), `relationship` + `est_cost` (status), `branch`, `labels`.

| What | Lines |
|------|------:|
| `ensureTag()` | ~10 |
| `tagSession()` | ~5 |
| `getSessionTags()` | ~8 |
| `listTags()` | ~8 |
| `tags` + `session_tags` tables | ~20 |
| `autoTagSession()` in tagger.ts | ~65 |

**Remove:** ~100 lines total. Most of `tagger.ts` is deleted.

---

## DEAD-7: TUI (Q23)

6 files under `src/tui/` (app.tsx + 5 components/screens). Referenced
from `index.ts:363-364` behind `--tui` flag.

**Remove:** `src/tui/` directory, `--tui` flag in index.ts, help text.
~500 lines.

---

## DEAD-8: `stopExistingDaemon` in service.ts (Q25)

Weaker duplicate of `lifecycle.stopWatcher()` (3s wait, no SIGKILL vs
5s wait with SIGKILL). Only exists because service.ts doesn't import
lifecycle.

**Remove:** Replace with import of `stopWatcher()` from merged
process-state.ts. ~20 lines.

---

## DEAD-9: `isRunning()` + `cleanup()` + `PID_FILE` in watch.ts (Q25)

Duplicate of `isDaemonRunning()` in runguard.ts. Third independent
`PID_FILE` constant declaration.

**Remove:** Import from process-state.ts instead. ~15 lines.
