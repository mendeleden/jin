# Audit — Blueprint Drift After Wave 2 + W3-MODULE-01

- Date: 2026-04-04
- Reviewer: claude (Opus 4.6)
- Scope: read-only audit of substantive BP drift that remains after all Wave 2
  packets plus `W3-MODULE-01` were approved. Cross-checked the BP set
  (`BP-01`, `BP-02`, `BP-04`, `BP-06`, `BP-07`, `BP-08`, `BP-Product`) against
  the current `src/` tree and the scope of `W3-PRODUCT-01`.
- Constraint: no product code edits; no staging/committing.

## Summary

The v2 pipeline (`src/pipeline/loop.ts`) and v2 store (`src/db/`) exist and
are tested, but the live runtime path that `jin start` takes is still the
v1 coordinator in `src/commands/watch.ts`, backed by the v1 SQLite schema in
`src/store.ts` and the v1 `Adapter` interface in `src/adapters/types.ts`.
`runPipeline()` has zero callers in `src/`. This is the central remaining
drift and it is squarely what `W3-PRODUCT-01` is chartered to close.

Beyond that central lane, there is contract drift on sinks, on the HTTP
API wire shape, and on command framing (`init`/`connect`/`team-config`),
plus a few hardening-level gaps already flagged in `program.md`.

---

## Findings, ordered by severity

### Severity 1 — runtime still on v1 (product/runtime drift)

#### D1. `jin start` boots v1 `watchCommand`, not the BP-02 pipeline
- **Files / evidence:**
  - `src/commands/start.ts:85-87` — `startCommand` imports `./watch` and
    calls `watchCommand({ daemon: true })`.
  - `src/commands/watch.ts:1-531` — v1 coordinator: imports `Store` from
    `../store`, uses `FileWatcher` with `WatchEvent{session_created,...}`,
    uses a per-file `FILE_COOLDOWN_MS`, calls `adapter.sessions()` /
    `adapter.messages()`.
  - `src/pipeline/loop.ts:38` — `runPipeline()` defined here. Grep across
    `src/` shows **zero callers**.
- **BP violated:** BP-01 §pipeline and BP-02 §"The Brain" require one serial
  coordinator (`pipeline/loop.ts`) with a work queue, change-gated push,
  per-adapter timeouts, RSS enforcement, 15 s drain budget, and
  preempting stop. None of those invariants are present in the live path.
- **Drift class:** runtime drift (user-observable, load-bearing).
- **Routing:** already the central deliverable of `W3-PRODUCT-01`.

#### D2. `src/store.ts` is the v1 schema
- **File:** `src/store.ts:7-130` — tables `sessions`, `projects`,
  `session_projects`, `tags`, `session_tags`, `messages` with
  `tool_uses`/`thinking_blocks` as JSON blobs.
- **BP violated:** BP-05 + ontology.md §7.1 define `conversations` +
  `messages` + `tool_calls` + `_jin_sync` + `_jin_push_state`, with
  `thinking_content`/`thinking_tokens` as columns, no `projects`/`tags`
  tables. The v2 store lives at `src/db/` but only the read-only query
  surface reaches it.
- **Drift class:** runtime drift (on-disk schema).
- **Routing:** `W3-PRODUCT-01`.

#### D3. `src/commands/ingest.ts` is a v1 one-shot path
- **File:** `src/commands/ingest.ts:1-77` — `new Store(...)`,
  `adapter.sessions()`, `adapter.messages()`.
- **BP violated:** BP-07 §One-shot Mode + BP-02 §One-shot mode require the
  one-shot to reuse the brain (`detectAdapters` + `ingestAll` +
  `pushDirty`). Current code does not, and if a daemon is running it
  would also race the single-coordinator invariant (BP-07 §Core Invariant 2).
- **Drift class:** runtime drift.
- **Routing:** `W3-PRODUCT-01`.

#### D4. v1 `Store` is still load-bearing for status / analyze / tui
- **Files:**
  - `src/commands/status.ts:5, 222` — `import { Store } from "../store"`;
    `new Store(storePath)`.
  - `src/commands/analyze.ts:2, 10` — same.
  - `src/tui/app.tsx` — imports from `../store`.
  - `src/tagger.ts`, `src/commands/init.ts`, `src/commands/connect.ts`,
    `src/commands/benchmark.ts`, `src/commands/ingest.ts` — all
    `import { Store } from "../store"`.
- **BP violated:** BP-01 §commands (commands compose over `pipeline/`, `db/`,
  `daemon/`). BP-07 §Read-only commands — read commands should open the
  canonical (v2) store. Today `jin status` and the TUI show users data
  drawn from the v1 schema.
- **Drift class:** runtime drift (surfaces v1 shapes in `jin status` and
  TUI).
- **Routing:** `W3-PRODUCT-01` names `status.ts`/`analyze.ts`/`tui` only
  obliquely through the "v1-facing command surfaces in `src/store.ts`"
  line. Recommend **expanding `W3-PRODUCT-01` primary inputs** to name
  `status.ts`, `analyze.ts`, and `tui/app.tsx` explicitly — they will
  block D2 (v1 `Store` removal) otherwise.

### Severity 2 — contract drift (type surface or wire shape)

#### D5. `src/adapters/types.ts` still exports v1 `Adapter`
- **File:** `src/adapters/types.ts:20-39` exports an `Adapter` with
  `sessions()`, `messages(sessionId, sourcePath?)`, `artifacts?()`. The
  v2 contract is re-exported as `V2Adapter` from
  `src/contracts/adapters`.
- **BP violated:** BP-04 §Interface freezes the adapter contract at
  `findChanged()` / `loadConversation()` / `detect()` / `watchPaths()`.
  All 10 adapters still implement the v1 methods so `commands/watch.ts`,
  `commands/ingest.ts`, and `FileWatcher` can type against them
  (program.md §65 "legacy bridge methods in all 10 adapters").
- **Drift class:** contract drift (live type surface).
- **Routing:** named in `W3-PRODUCT-01`.

#### D6. Sink dual-interface shims (`LegacySink` + `SnapshotSink`)
- **Files:**
  - `src/sinks/webhook.ts:10-16, 42, 103-126, 314-327` —
    `implements LegacySink, SnapshotSink` with overloaded `push()`.
  - `src/sinks/postgres.ts:3-14, 33, 68-86, 443-496` — same pattern,
    plus a `_sessions` table-name bridge in
    `normalizePostgresConfig()`-style logic.
  - `src/sinks/s3.ts` — same dual-interface shape.
- **BP violated:** BP-06 §Interface freezes `push(payloads: PushPayload[])`
  around exactly one `PushPayload` shape
  (`{ attemptedRevision, conversation, messages, toolCalls }`). The shims
  keep `LegacyPushPayload{ session, messages, adapter }` on every sink's
  type surface.
- **Drift class:** contract drift (type surface + runtime branch). Low
  runtime risk because v2 callers can no longer emit legacy payloads.
- **Routing:** `W3-PRODUCT-01` declares these out of scope. Belongs in a
  **new narrow hardening packet** (e.g. `W3-SINK-03 Legacy Payload Strip`)
  once `W3-PRODUCT-01` removes the last caller that could emit legacy
  payloads.

#### D7. `/api/sessions` + `/api/projects` wire shape
- **File:** `src/api/routes.ts:80-197, 231-281` — `GET /api/sessions`,
  `GET /api/sessions/:id`, `GET /api/projects`,
  `GET /api/projects/:id/sessions`, `toSessionLike()` producing
  `parentSessionId` and session-flavored fields.
- **BP violated:** BP-01 §api + BP-Product §Desktop — Desktop is a surface
  over the daemon boundary, not a consumer of v1 shapes. BP-08 +
  ontology §5 retire the projects concept (`git_remote` replaces it).
- **Drift class:** contract drift (wire-visible).
- **Routing:** named in `W3-PRODUCT-01` primary inputs.

#### D8. `init` / `connect` / `team-config` conflate integrations with Team
- **Files:** `src/commands/init.ts` (164 lines),
  `src/commands/connect.ts` (659 lines),
  `src/commands/team-config.ts` (86 lines).
- **BP violated:**
  - BP-08 §"Reserved: `connect` / `disconnect`" reserves those names for
    workspace/team enrollment and points v2 users at `jin sink add/remove`
    + `jin route add/remove`.
  - BP-07 §First-Run Experience removes `jin init` — `jin start` handles
    bootstrap.
  - BP-Product §3 — "Generic sinks are integrations. Team is a product."
    Current `connect.ts` bundles sink creation + route creation +
    `decodeTeamConfig` through the generic sink path.
- **Drift class:** product-framing drift, plus residual runtime drift
  (both still import v1 `Store`).
- **Routing:** `W3-PRODUCT-01` lists `connect.ts` and `team-config.ts`.
  Recommend `init.ts` be explicitly retired in the same packet.

#### D9. `src/commands/benchmark.ts` uses v1 Store + v1 Adapter
- **File:** `src/commands/benchmark.ts` (394 lines).
- **Drift class:** runtime drift (internal/dev tool, not user-facing).
- **Routing:** `W3-PRODUCT-01` names it.

### Severity 3 — documentation / wording drift (non-runtime)

#### D10. BP-01 module-map vs. actual `src/` layout
- **BP-01** names only: `pipeline/{loop,ingest,push,watcher}.ts`,
  `daemon/{process-state,daemonize}.ts`, and a single `db/` set.
- **Actual `src/` tree also contains:**
  - `src/pipeline/file-watcher.ts`, `queue.ts`, `types.ts`, `index.ts`
  - `src/daemon/runtime-state.ts`
  - `src/contracts/`, `src/tagger.ts`, `src/self-observation.ts`,
    `src/progress.ts`, `src/updater.ts`, `src/tui/`, `src/sink-resolver.ts`,
    `src/store.ts` (v1)
- **Drift class:** doc-only (`blueprints.md` already flags "minor BP-01
  file-level wording drift").
- **Routing:** BP-01 doc sync, not a packet. Can be folded into
  `W3-PRODUCT-01` closing or handled standalone.

#### D11. `WatchEvent` / `FileWatcher` still carry v1 record shape
- **File:** `src/pipeline/file-watcher.ts:2, 32-40` — imports
  `WatchEvent` from `adapters/types` and emits
  `type: "session_created" | "session_updated"` with `sessionId`.
- **Drift class:** wording/type-naming drift — no wire impact because
  the v2 pipeline only reads `adapterId` + `path` from the event.
- **Routing:** folds into the D5 adapter-types sweep.

#### D12. Config parsing compatibility
- **Files:** `src/config.ts` (460 lines), `src/sink-resolver.ts` (107
  lines) — `normalizeConfig()` still expands legacy sink types.
- **BP violated:** BP-08 §Config Schema freezes the discriminated union.
  program.md §56 already marks this as a remaining non-blocking
  follow-up.
- **Drift class:** contract drift at the parsing boundary (not wire).
- **Routing:** `W3-PRODUCT-01` declares this out of scope. **New narrow
  hardening packet** after D6/D8 land.

#### D13. `CPUQuota=10%` service-unit mismatch
- **File:** `src/commands/service.ts` (program.md §67).
- **Drift class:** daemon/service-unit drift.
- **Routing:** already earmarked as a separate daemon follow-up packet.

#### D14. Missing hardening: BP-02 consecutive adapter error tracking,
#### BP-06 minor-version warning
- **Source:** program.md §49 ("decide whether BP-02 consecutive adapter
  error tracking and BP-06 minor-version warnings deserve explicit
  follow-up packets"); `blueprints.md` BP-02 line 10 and BP-06 line 26.
- **Drift class:** runtime drift (missing feature) at hardening level.
- **Routing:** two small hardening packets, one per blueprint.

---

## Classification — doc drift vs. product/runtime drift

| # | Summary | Class |
|---|---------|-------|
| D1 | Live runtime on v1 `watchCommand`; `runPipeline()` unused | runtime |
| D2 | `src/store.ts` v1 schema (sessions/projects/tags/JSON blobs) | runtime |
| D3 | v1 `ingest.ts` bypasses the brain | runtime |
| D4 | v1 `Store` still used by status / analyze / tui / tagger | runtime |
| D5 | v1 `Adapter` interface still exported | contract (type surface) |
| D6 | Sink `LegacySink` + `SnapshotSink` dual shims | contract (type + wire tolerance) |
| D7 | `/api/sessions`, `/api/projects`, `toSessionLike` | contract (wire) |
| D8 | `init`/`connect`/`team-config` framing | product framing + runtime |
| D9 | `benchmark.ts` on v1 | runtime (internal) |
| D10 | BP-01 module-map vs. actual tree | doc only |
| D11 | `WatchEvent` naming on `pipeline/file-watcher.ts` | wording (type names) |
| D12 | Config parsing legacy-type expansion | contract (parsing layer) |
| D13 | `CPUQuota=10%` | service-unit config drift |
| D14 | Missing BP-02 error streak + BP-06 minor warning | runtime (hardening) |

---

## Packet assignment

| Drift | Target |
|-------|--------|
| D1, D2, D3, D5, D7, D8, D9 | `W3-PRODUCT-01` (already in scope) |
| D4 | **expand `W3-PRODUCT-01` primary inputs** to explicitly include `src/commands/status.ts`, `src/commands/analyze.ts`, and `src/tui/app.tsx` — they block D2 |
| D6 | **new narrow hardening packet** after `W3-PRODUCT-01` (Legacy Sink Payload Strip) |
| D11 | fold into D5 sweep |
| D12 | **new narrow hardening packet** (config parsing legacy-type strip) |
| D13 | separate daemon/service follow-up (already flagged in program.md §67) |
| D14 | two small hardening packets |
| D10 | BP-01 doc sync — not a runtime packet |

## Immediate Codex attention

None outside `W3-PRODUCT-01`. The only procedural recommendation is to
**widen `W3-PRODUCT-01`'s "primary inputs" list** to name
`src/commands/status.ts`, `src/commands/analyze.ts`, and
`src/tui/app.tsx` explicitly (D4), because removing the v1 `Store` (D2)
requires them to be migrated to the v2 query surface in the same packet.
