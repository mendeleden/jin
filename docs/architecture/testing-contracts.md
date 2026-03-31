# Testing and behavioral contracts

**Scope:** What the `test/` tree (and perf harness) encodes as “must not break” behavior for contributors.

## Shared infrastructure (`test/helpers.ts`)

- **`createTestEnv()`** — Sets `JIN_CONFIG_DIR` to a temp directory, opens `Store`, cleanup with retries (Windows SQLite mmap).
- **Fixtures** — `SAMPLE_PROJECTS` (including worktree-style same-remote cases), `SAMPLE_SESSIONS`, **`seedStore()`** for projects / sessions / links.
- **Fakes** — `makeSession()`, `createFakeSink()` for sink health/push tests.
- **CLI helpers** — `writeTestConfig` / `readTestConfig`, `captureConsole`, `mockProcessExit` / `ExitError`.

## Integration pipeline (`test/integration.test.ts`)

Requires Docker (`test/docker-compose.integration.yml`). Covers:

- **Adapters (fixtures on disk):** Claude Code, Codex, Gemini CLI — `detect`, non-empty `sessions`, `adapterId`, `messageCount`, message roles/content where asserted. Notes `CODEX_HOME` vs cached `os.homedir()` for Codex.
- **SQLite store:** ingest counts, `analyzeByAdapter` includes expected adapter ids, idempotent re-upsert.
- **Postgres sink:** health, push counts vs sessions, row counts, re-push idempotence, message columns (`role`, JSON `tool_uses` / `thinking_blocks`), `team_id` / `developer_id`.
- **Postgres FTS:** schema (`content_tsv`, index, trigger), backfill, search snippets, adapter filter, empty queries.
- **S3 (MinIO):** push expectations when objects are written.
- **Multi-push semantics:** Postgres second push appends **delta** messages; S3 second push expects **full** object; regression that delta-only S3 would lose data — documents `supportsDelta` false for S3, true for Postgres.

## Connect CLI (`test/connect.test.ts`)

Mocks `createSink` / `availableSinks`. Asserts:

- Postgres URL connect creates sink + route; duplicate project updates vs new CS; `--sink` reuses id; bad id exits; `--team` decodes sink; `--remote` / `--directory` routes; JSON output shape; errors when sink type or match target missing; duplicate connection string dedupes sink; `interactiveConnect` JSON fields; **disconnect** / **remove-sink** / **connections** listing.

## Routing (`test/routing.test.ts`)

- **`matchesRoute`:** project case-insensitivity, remote normalization (`.git`, trailing slash, case), directory case-insensitivity, negative cases.
- **`sinksForSession`:** first route wins, empty when no match, `routeUnmatchedToAll`, `defaultSinks`, worktree + remote route matching two linked sessions.

## Search (`test/search.test.ts`)

- **`resolveSinksForCwd`:** project match, postgres-only results, `defaultSinks`, empty when no routes/defaults.
- **`findSinkById`**, **`allPostgresSinks`**.
- **`store.searchMessages` (FTS5):** hits, snippet markers, `adapterId` filter, limit, nonsense query.

## Init and progress (`test/init.test.ts`, `test/progress.test.ts`)

- Team sink append / duplicate skip / warnings; auto-ingest when adapters detected; `--json` projects; progress cleared after ingest; status output when progress active/stale (see tests).

## Other suites

- **`self-observation.test.ts`** — excludes jin output from watch triggers.
- **`upsert-gaps.test.ts`** (if present) — store upsert edge cases.

## Perf harness (`test/perf-harness/`)

Shell-driven **dogfood** (not `bun test`): real `jin init --team`, `connect`, `start --foreground`, log scraping, optional S3.

**Gates (when run):** Postgres session/message counts, `team_id` / `developer_id`, role validity, SQLite vs Postgres parity threshold, S3 object shape when enabled.

**Supporting files:** `run.sh` (copies local tool dirs into fixtures), `docker-compose.yml` (Postgres + MinIO, tmpfs for stable timing), `scripts/*.ts` for verification helpers.

## How to use this doc

When changing **routing**, **connect**, **push**, **search sink resolution**, **adapter ingest**, or **Store schema**, run the matching unit tests and, when appropriate, integration + perf harness before merging.
