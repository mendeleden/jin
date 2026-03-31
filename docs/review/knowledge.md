# Knowledge Base

Understanding clarified during the review. No action required — these
are reference for future work.

---

## KB-1: Sink vs SinkConfig (Q2)

`Sink` = runtime behavior (live connection with `push()`, `close()`).
`SinkConfig` = static config from `config.json` (constructor input).
`teamId`/`developerId` are multi-tenant scoping stamped at push time.
They exist on SinkConfig AND JinConfig.team (parallel path, potential
confusion).

---

## KB-2: FTS5 and dashboard API methods (Q17)

FTS5 is SQLite's full-text search engine. `messages_fts` virtual table
with BM25 ranking powers `jin search` and dashboard search. Stays in v2.

Dashboard methods (`enrichedSessions`, `getSessionTree`, `timelineByDay`,
`costByProjectAndTool`) power the local SPA API. Most simplify or die
in v2 — `enrichedSessions` collapses from a 4-way JOIN to a simple
SELECT since tag/project data lives on conversation columns.

---

## KB-3: Webhook healthCheck (Q22)

HEAD request that tells you the URL is reachable. Doesn't validate
payload format, auth, or receiver compatibility. Keep as reachability
check, don't pretend it validates the integration.

---

## KB-4: Service → foreground indirection (Q28)

OS service runs `jin start --foreground`. The OS service manager IS the
daemon — it handles background execution, PID tracking, crash restart,
boot persistence. Jin runs in foreground because that's what service
managers want (a process to supervise). `--foreground` is the production
mode under service managers, not a debug flag.

---

## KB-5: watchCommand anatomy (Q33)

576 lines, 8 jobs: guards → setup → initial ingest → file watcher →
background loops → shutdown → daemonize → ingest functions. After v2
cleanup (move guards, daemonize, PID logic, ingest functions out),
the core loop is ~200 lines.

---

## KB-6: createSink call graph (not numbered)

4 call sites, 3 lifecycles:
- `watch.ts:87` — daemon startup, long-lived, calls `push()`
- `init.ts:43` — one-shot connection test, discarded
- `connect.ts:174,310` — one-shot connection test, discarded

Only the daemon pushes data. The other 3 are connection tests.
