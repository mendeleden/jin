# Code Smells Audit — 2026-03-29

Five specialized reviewers independently analyzed the Jin codebase. This document consolidates their findings, deduplicates overlapping issues, and prioritizes by cross-persona agreement.

## Reviewers

| Persona | Focus | Findings |
|---------|-------|----------|
| Security Engineer | Injection, secrets, trust boundaries | 16 (0C, 3H, 7M, 6L) |
| Performance Engineer | N+1 queries, memory, I/O efficiency | 18 (3C, 4H, 5M, 6L) |
| DX Engineer | Error messages, naming, CLI UX | 16 (1C, 4H, 5M, 3L) |
| SRE / Reliability | Daemon lifecycle, crash recovery, shutdown | 16 (2C, 4H, 6M, 4L) |
| Software Architect | Module boundaries, coupling, duplication | 15 (2C, 4H, 8M, 1L) |

**Total raw findings: 81 | After deduplication: ~45 unique issues**

---

## Cross-Persona Agreement (Issues flagged by 3+ reviewers)

These issues were independently identified by multiple personas, indicating high confidence and priority.

### 1. Silent `catch {}` blocks in ingest pipeline (5/5 reviewers)
**Flagged by: Security, Performance, DX, SRE, Architect**

40+ empty catch blocks throughout `watch.ts` (lines 110, 122, 476, 487, 496, 549) and `adapters/registry.ts`. Errors in adapter detection, message parsing, and ingest are silently swallowed. This makes debugging impossible, masks security issues, hides performance problems, and means the daemon appears healthy while data stops flowing.

**Violates project's own rule:** "Silent `catch {}` blocks are forbidden in adapters."

### 2. God files: `watch.ts` (576 lines) and `store.ts` (816 lines) (4/5 reviewers)
**Flagged by: Performance, DX, SRE, Architect**

- `watch.ts` handles 8 distinct responsibilities: PID lifecycle, daemon forking, process guards, sink pushing, ingest engine, single-file ingest, file watcher setup, memory kill switch
- `store.ts` mixes 8+ concerns: schema DDL, migrations, CRUD for 7 tables, FTS5, analytics, tree queries, artifacts

### 3. PID file management duplicated in 4 places (4/5 reviewers)
**Flagged by: DX, SRE, Architect, Reliability**

`PID_FILE` constant independently defined in `watch.ts:15`, `lifecycle.ts:7`, `runguard.ts:6`, `service.ts`. `isRunning()` logic also duplicated between `watch.ts` and `runguard.ts` with different return shapes.

### 4. Duck-typed adapter methods via `as any` (3/5 reviewers)
**Flagged by: DX, Architect, Performance**

`newMessages()` and `sessionForFile()` are not on the `Adapter` interface but called via runtime `in` checks and `as any` casts in 3 locations in `watch.ts`. Violates project rule: "All adapter methods must be typed on the Adapter interface."

### 5. Postgres sink runs DDL despite contract (3/5 reviewers)
**Flagged by: Security, SRE, Architect**

Both `postgres.ts` and `postgres-search.ts` run CREATE TABLE, CREATE INDEX, CREATE FUNCTION, etc. Violates documented principle: "Jin never runs DDL on Postgres" and "Sinks never run DDL."

### 6. Duplicate Postgres connection logic in two files (3/5 reviewers)
**Flagged by: Performance, Security, Architect**

`PostgresSink` and `PostgresSearcher` independently implement connection management, dual-mode query dispatch, HTTP queries, and DDL. Verbatim copies.

---

## Priority 1: Critical / High Issues

### Security
- **H-1: SQL injection via unsanitized table/schema names in Postgres sinks** — `this.schema` and `config.table` interpolated directly into SQL. Exploitable via malicious `--team` base64 config.
- **H-2: Secrets stored in plaintext** — Postgres passwords and AWS keys in `~/.config/jin/config.json` with default umask.
- **H-3: Base64 team config is not encryption** — Credentials shared as plain base64 strings.

### Performance
- **C-1: N+1 query storm in `autoTagSession`** — ~25 DB round-trips per session (INSERT+SELECT for each tag, upsertProject, linkSession, upsertToolUsage).
- **C-2: `newMessages()` reparses entire file** — Reads and parses full JSONL, then slices. Delta optimization is an illusion.
- **C-3: `retagAll()` is unbounded N+1** — Loads ALL sessions, ALL messages, runs `autoTagSession` (~25 queries) for each. 342 sessions = 8,500+ DB calls.
- **H-4: `sessionsNeedingPush()` uses NOT IN subquery** — Forces full table scan. Should use LEFT JOIN / NOT EXISTS.
- **H-5: Blocking `execSync` for git commands** — Blocks event loop up to 3s per call, called per session with no caching by cwd.

### Reliability
- **C-4: PID file race between parent and child in `daemonize()`** — Both parent and child write to PID file.
- **H-6: No unhandled promise rejection handler** — Daemon can crash without PID cleanup.
- **H-7: No Postgres reconnect logic** — Dead connection cached forever after transient failure.
- **H-8: Shutdown flush has no timeout** — `pushToSinks()` awaited without timeout; can block for minutes.
- **H-9: FD leak in `daemonize()` on spawn failure** — `openSync` not in try/finally.

### Architecture
- **H-10: Routing reaches into Store for project data** — Couples routing to projects table (dead in v2).
- **H-11: SinkConfig is a bag type** — All sink-type fields optional in one flat interface.

### DX
- **H-12: Help text advertises dead features** — `--service`, `--ui`, `--all`, `--tui` documented but slated for removal.
- **H-13: Session vs Conversation naming split** — Docs say Conversation, code says Session everywhere.

---

## Priority 2: Medium Issues

| # | Issue | Personas | Location |
|---|-------|----------|----------|
| M-1 | Command injection via PID in benchmark.ts | Security | benchmark.ts:131,146,156 |
| M-2 | FTS5 MATCH query syntax not sanitized | Security | store.ts:318 |
| M-3 | SSRF via HTTP connection string | Security | postgres.ts:238-244 |
| M-4 | Webhook URL not validated against internal IPs | Security | webhook.ts:11 |
| M-5 | Self-updater downloads unverified binary | Security | updater.ts:276-334 |
| M-6 | Unsafe team config deserialization | Security | sinks/types.ts:63 |
| M-7 | `enrichedSessions()` 4-way JOIN with no LIMIT | Performance | store.ts:598-624 |
| M-8 | `findSessionFile()` reads entire file for ID check | Performance | claude-code.ts:317-356 |
| M-9 | S3 pushes sequential, not parallel | Performance | s3.ts:56-104 |
| M-10 | 5-minute "active" threshold magic number in 10 files | DX | All adapters |
| M-11 | Route matching uses string equality, not glob | DX, Architect | routing.ts:42-51 |
| M-12 | Push logged as success for partial failures | SRE | watch.ts:399-416 |
| M-13 | In-memory stat cache lost on restart | SRE | watch.ts:428 |
| M-14 | Async onChange errors unhandled in watcher | SRE | watcher.ts:31 |
| M-15 | No guard against concurrent periodic ingest | SRE | watch.ts:252-261 |
| M-16 | Dead code: projects, tags, artifacts, tool_usage | Architect, DX | store.ts, tagger.ts |
| M-17 | Feature envy: tagger manipulates 5 Store tables | Architect | tagger.ts |
| M-18 | Schema as raw string, no version tracking | Architect, DX | store.ts:6-132 |
| M-19 | Duplicate git/project utils in 2 files | Architect | tagger.ts, sink-resolver.ts |

---

## Priority 3: Low Issues

| # | Issue | Persona | Location |
|---|-------|---------|----------|
| L-1 | `fileLastIngestedAt` map grows unboundedly | Perf, SRE | watch.ts:21 |
| L-2 | `debounceTimers` map never evicts stale entries | Performance | watcher.ts:11 |
| L-3 | `getSessionTree()` does 3 sequential queries | Performance | store.ts:637-651 |
| L-4 | Missing index on `parent_session_id` | Performance | store.ts schema |
| L-5 | No rate limiting on API server | Security | api/server.ts |
| L-6 | Config file write race condition | Security, SRE | config.ts:96-110 |
| L-7 | JSON.parse on SQLite data without try/catch | Security | store.ts:782-814 |
| L-8 | `stopService()` swallows all errors | SRE | lifecycle.ts:118-146 |
| L-9 | Path concatenation uses template literals not path.join | SRE | watcher.ts:38 |
| L-10 | Dead `getExt()` function | DX | watch.ts:554-558 |
| L-11 | Inconsistent error exit behavior across commands | DX | index.ts |

---

## Alignment with v2 Roadmap

Many findings are already tracked in the v2 roadmap. Cross-reference:

| Finding | Roadmap Phase | Status |
|---------|--------------|--------|
| God file watch.ts | Phase 1.3 + 4.3 | Planned |
| God file store.ts | Phase 0.2 | Planned |
| PID duplication | Phase 1.1 | Planned |
| Duck-typed adapters | Phase 0.1 (Q31) | Planned |
| Postgres DDL | Phase 2.1 | Planned |
| Session→Conversation rename | Phase 0.1 | Planned |
| Route glob matching | Phase 4.1 (BUG-1) | Known bug |
| Schema migrations | Phase 0.2 (Q9) | Planned |
| Dead projects/tags/artifacts | Phase 0.2 | Planned |
| Tagger removal | Phase 4.2 | Planned |
| SinkConfig union | Phase 0.3 (Q19) | Planned |
| Help text cleanup | Phase 5.3 | Planned |

**New findings NOT in roadmap:**
- Silent catch blocks (systemic, should be Phase 0 prerequisite)
- SQL injection via table names (security, should be immediate fix)
- Plaintext secrets (security, should be immediate fix)
- No Postgres reconnect (reliability, Phase 2.1 scope)
- No shutdown timeout (reliability, Phase 1.3 scope)
- Unverified self-update binary (security, Phase 7 scope)
- N+1 in tagger (performance, moot if tagger removed in Phase 4.2)

---

## Recommended Action Order

1. **Immediate (security):** Sanitize Postgres table/schema names, validate team config input
2. **Phase 0 prerequisite:** Replace all empty `catch {}` with proper error logging
3. **Continue v2 roadmap as planned** — most architectural smells are already scoped
4. **Add to Phase 2.1:** Postgres reconnect logic, shutdown timeout
5. **Add to Phase 7:** Self-update signature verification, API rate limiting, config file permissions

---

*Audit performed by 5 parallel persona agents: Security Engineer, Performance Engineer, DX Engineer, SRE, Software Architect.*
