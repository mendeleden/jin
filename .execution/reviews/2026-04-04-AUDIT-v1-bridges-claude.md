# Audit — Remaining v1 Leftovers & User-Facing Bridges

- date: `2026-04-04`
- packet: `W3-PRODUCT-01` (scoping audit, not a review)
- auditor: `claude-opus-4-6 (1M)`
- session: `claude-AUDIT-v1-leftovers`
- scope: read-only audit of remaining user-facing v1 bridges before the
  packet executes
- inputs read:
  - `.execution/program.md`
  - `.execution/packets/W3-PRODUCT-01.md`
  - `docs/blueprint/BP-Product-Strategy.md`
  - `docs/blueprint/BP-07-process-lifecycle.md`
  - `docs/blueprint/BP-08-routing-and-config.md`
  - `src/commands/watch.ts`
  - `src/commands/ingest.ts`
  - `src/commands/init.ts`
  - `src/commands/benchmark.ts`
  - `src/commands/connect.ts`
  - `src/commands/team-config.ts`
  - `src/commands/status.ts`
  - `src/commands/start.ts`
  - `src/api/routes.ts`
  - `src/store.ts` (skimmed, 816 lines, v1 schema)
  - `src/adapters/types.ts`
  - `src/db/index.ts`
  - `src/index.ts` (CLI dispatch + help)
  - `src/pipeline/loop.ts` (exports `runPipeline`, unused)

---

## TL;DR

The v1 runtime is **still the runtime**. `jin start` / `jin start
--foreground` call `watchCommand` in `src/commands/watch.ts`, which writes
into the v1 `Store` from `src/store.ts` with the full v1 schema
(`sessions`, `session_projects`, `projects`, `tags`, `session_tags`,
`tool_uses` JSON blob on messages, etc.). The v2 pipeline in
`src/pipeline/loop.ts:38` (`runPipeline`) exists but is **not wired from
any command**. Fourteen production files still import from `src/store.ts`.

Every Wave 1/Wave 2 contract that was approved is bypassed at runtime. The
scoreboard's "aligned" / "mostly_aligned" states describe the v2 module
surface, not the user-facing product. Until `watchCommand` is replaced
with `runPipeline` and `src/store.ts` is retired, the running product is
still v1.

---

## Top Findings (by impact)

### P0-1 — User-facing runtime still runs the v1 pipeline
`src/commands/watch.ts:24` (`watchCommand`) is the target of:
- `jin start` via `src/commands/start.ts:87` (`await watchCommand({ daemon: true })`)
- `jin start --foreground` via `src/index.ts:268` (`await watchCommand({ daemon: false })`)

It loads the **v1 `Store`** from `../store`, calls
`adapter.sessions()` / `adapter.messages()` on the v1 `Adapter`
interface, does its own session-based sink routing, and never touches
`src/pipeline/loop.ts` or `src/db/store.ts`. The v2 `runPipeline` is
exported (`src/pipeline/loop.ts:38`) but `Grep "runPipeline"` finds only
its own declaration — no callers.

**Impact:** every BP-02/BP-05/BP-06 contract validated by W1/W2 packets
is live only inside isolated v2 modules. Production data keeps landing in
the v1 schema.

### P0-2 — `src/store.ts` is the v1 schema, still the production writer
`src/store.ts:6-130` declares the full v1 DDL and is imported by 14
production files (`grep -l "from \"../store\"" | wc -l` = 14). Violates
ontology.md §7.3 "Removed from v1" (every listed table is still present):

- `sessions` table (v2: `conversations`)
- `projects` + `session_projects` M:N join (v2: `git_remote` column)
- `tags` + `session_tags` (v2: dropped)
- `messages.tool_uses` JSON blob + `messages.thinking_blocks` JSON blob
  (v2: `tool_calls` table + `thinking_content`/`thinking_tokens` columns)
- `artifacts` (v2: out of scope)
- `push_log` (v2: `_jin_sync` + `_jin_push_state` + `_jin_push_attempts`)

Importers (must all be retargeted):
`src/commands/watch.ts`, `src/commands/status.ts`, `src/commands/init.ts`,
`src/commands/connect.ts`, `src/commands/ingest.ts`,
`src/commands/benchmark.ts`, `src/commands/analyze.ts`,
`src/tui/screens/Sessions.tsx`, `src/tui/screens/Overview.tsx`,
`src/tui/screens/Detail.tsx`, `src/tui/app.tsx`, `src/tagger.ts`,
`src/db/index.ts` (re-exports `./store` — own `src/db/store.ts`, safe),
`src/contracts/index.ts`.

### P0-3 — `src/adapters/types.ts` v1 `Adapter` is still the default export
File header says "legacy migration shim" but the v1 `Adapter` interface
(`.sessions()`, `.messages(id, path)`, `ContextArtifact`,
`Session { isSubAgent, parentSessionId, totalTokens, isCompacted, ... }`,
`Message { toolUses: ToolUse[], thinkingBlocks: ... }`, `WatchEvent { type:
"session_created" | ... }`) is still the type exported as `Adapter` and
is the shape `watch.ts`, `ingest.ts`, `benchmark.ts`, `init.ts`, and
`FileWatcher` call against. The v2 contracts in `src/contracts/adapters.ts`
are re-exported as `V2Adapter` — v1 remains the default name.

### P0-4 — Duck-typed `as any` on adapters in `watch.ts`
`src/commands/watch.ts:417`, `:476`, `:489` cast the adapter to `any` to
call `newMessages()` and `sessionForFile()`. Directly forbidden by
`.claude/rules/adapters.md` ("never duck-type via `as any`") and
`CLAUDE.md` ("Adapter methods must be typed on the interface"). Leftover
from ARCH-10.

### P1-5 — `src/commands/ingest.ts` is a v1 one-shot bypass
77-line command using v1 `Store`, v1 adapter surface, and
`store.refreshProjectStats()` (v1 projects table). Not wired into
`src/index.ts`, but `src/commands/init.ts:6` imports it and **calls it on
every `jin init`**. Also has no single-coordinator check (BP-07
§Write-capable one-shot commands).

### P1-6 — `jin init` still exists and contradicts BP-07 §First-Run
BP-07: *"There is no separate `jin init` command. `jin start` handles
bootstrap."* But:
- `src/index.ts:309-317` still dispatches `init`
- `src/index.ts:155-169` / `:209` still document it as "Getting started"
- `COMMAND_HELP.init` advertises `--team`/`--skills`
- `initCommand` opens its own `new Store(getRuntimePaths().storePath)` at
  `src/commands/init.ts:82` and calls `store.listProjects()` (v1 table),
  then calls `ingestCommand()` (v1 pipeline) — all without checking for a
  running daemon, violating the single-coordinator invariant (BP-07 §2).

### P1-7 — `src/api/routes.ts` session-like bridge payload
`toSessionLike()` at `src/api/routes.ts:231-284` returns **both camelCase
and snake_case** for every field plus v1-only keys:
`sessionId`, `adapterName`/`adapter_name`, `totalTokens`/`total_tokens`,
`tags: []`, `isSubAgent`, `parentSessionId`, `isCompacted`,
`thinkingBlocks: [{content,tokenCount}]`. Routes are still named
`/api/sessions`, `/api/tags`, `/api/artifacts`, `/api/projects`. `tags`
and `artifacts` return empty-array stubs (misleading: look implemented,
return nothing). This locks Desktop/TUI/Prismatic clients into the v1
contract.

### P1-8 — `src/commands/connect.ts` depends on v1 `projects` table + keeps `--directory`
- `loadProjects()` at `connect.ts:427-439` reads `store.listProjects()`
  off the v1 `projects` table
- `interactiveConnect` shows `project.directory`, `project.git_remote`,
  `project.git_branch` (v1 columns)
- `resolveConnectTarget` exposes `--directory` (BP-08 §"What Was Removed
  From v1": `RouteMatch.directory` "Removed — unreliable across
  machines")
- BP-08 §Reserved: `connect`/`disconnect` are reserved for workspace/team
  onboarding; v2 primitives are `jin sink add` / `jin route add`. The
  file itself acknowledges this in the `connectCommand` comment
  (`connect.ts:65` "Legacy compatibility bridge").

### P1-9 — `src/commands/status.ts` reads from v1 `Store`
`readStoreStats()` at `status.ts:222` constructs
`new Store(paths.storePath)` and calls `.sessionCount()`,
`.messageCount()`, `.analyzeByAdapter()`. Once the runtime switches, this
reports 0 for everything.

### P1-10 — `src/commands/team-config.ts` uses pre-union flat `SinkConfig`
Imports `SinkConfig` from `../sinks/types` (the flat bag) and casts
`type` into it. BP-08 §Config Schema mandates a discriminated union by
`type`. Output `jin init --team=<code>` path still feeds `initCommand`'s
`decodeTeamConfig` + `toTeamSinkCandidate` bridge. Also the framing
mixes Team (a product) with generic sinks (an integration) — see
BP-Product-Strategy §2/§4 "Generic sinks are integrations. Team is a
product."

### P1-11 — `watchCommand` mutates durable config at runtime
`src/commands/watch.ts:115-127` auto-flips `config.adapters[id].enabled =
true` for newly-detected adapters and calls `saveConfig(config)` during
daemon startup. Violates BP-07 §6 ("Config is snapshotted at process
start") and BP-08 §Config Lifecycle ("Config is durable intent. The
running daemon is a snapshot of that intent."). Daemon silently edits
user config.

### P2-12 — `src/commands/benchmark.ts` uses v1 `Store` + direct PID read
`benchmark.ts:107-117` reads `jin.pid` directly; `:251-299` opens v1
`Store` and calls `adapter.sessions()` / `adapter.messages()`. One of the
four PID-reading sites (ARCH-7).

### P2-13 — `watchCommand` holds its own PID/lock/cleanup
`src/commands/watch.ts:16-17, 53-57, 67, 516-531` own `PID_FILE` +
`LOG_FILE` + `isRunning()` + `cleanup()` + `writeFileSync(PID_FILE, ...)`
on top of `src/daemon/runtime-state.ts`. Writes PID without going through
`markRuntimeRunning()`, so the two ownership stores can drift.

### P2-14 — `watchCommand` points to `jin init`
`src/commands/watch.ts:130` logs "No active adapters detected. Run `jin
init` first." — contradicts BP-07 §First-Run.

---

## Remaining User-Facing v1 Bridges — Exact Paths

| Bridge | File | Lines |
|---|---|---|
| v1 watcher pipeline (the runtime) | `src/commands/watch.ts` | entire file (531 lines) |
| v1 `Store` class + full v1 schema | `src/store.ts` | entire file (816 lines) |
| v1 `Adapter`/`Session`/`Message`/`WatchEvent` types | `src/adapters/types.ts` | 20–74, 117–123 |
| Duck-typed adapter casts | `src/commands/watch.ts` | 417, 476, 489 |
| v1 one-shot ingest | `src/commands/ingest.ts` | entire file |
| Undocumented-by-BP `jin init` command | `src/commands/init.ts`, `src/index.ts` | init.ts full file; index.ts 309–317, 155–169 |
| `jin init` opens its own `new Store()` without coordinator check | `src/commands/init.ts` | 82–85 |
| Session-like API bridge (dual casing + v1-only fields) | `src/api/routes.ts` | 231–295 |
| v1 API route names + stubs | `src/api/routes.ts` | 80–164, 185–213 |
| `jin status` reads v1 `Store` | `src/commands/status.ts` | 5, 211–236 |
| `jin connect`/`disconnect`/`connections` depending on v1 `projects` | `src/commands/connect.ts` | 24, 427–439, 612–639 |
| `jin connect --directory` flag (removed by BP-08) | `src/commands/connect.ts` | 44, 594–607; `src/index.ts` 111, 219 |
| `jin benchmark` uses v1 `Store` + ad-hoc PID read | `src/commands/benchmark.ts` | 1–3, 107–117, 251–299 |
| `jin team-config` uses pre-union flat `SinkConfig` | `src/commands/team-config.ts` | entire file |
| `tagger.ts` invoked from ingest paths | `src/tagger.ts` (via watch.ts:8, ingest.ts:4) | — |
| TUI screens reading v1 `Store` | `src/tui/**` | — |
| PID/lock ownership duplicated in watcher | `src/commands/watch.ts` | 16–17, 53–57, 67, 516–531 |
| Runtime `saveConfig()` during daemon start | `src/commands/watch.ts` | 115–127 |
| Help/usage advertising v1 commands/flags | `src/index.ts` | 99–117, 155–202, 208–251 |

---

## Scope: In `W3-PRODUCT-01` vs Later Hardening

### In scope — packet charter is "retire remaining user-facing v1 bridges, align command surface to BP-Product"

1. **Wire `jin start` to `runPipeline`.** Replace `watchCommand`'s
   internal loop with a thin wrapper over `src/pipeline/loop.ts`
   `runPipeline()` operating on the v2 `src/db/store.ts`. Single highest-
   value move; unlocks everything else.
2. **Delete `src/store.ts`** (or collapse it to nothing) and retarget the
   14 importers onto `src/db/*`. Required by (1) to not double-write.
3. **Collapse `src/adapters/types.ts`** to re-export v2 contracts only.
   Remove v1 `Adapter`, `Session`, `Message`, `ToolUse`, `ThinkingBlock`,
   and v1 `WatchEvent`. Remove the `as any` casts in `watch.ts`.
4. **Remove `jin init` from dispatch + help** per BP-07 §First-Run. Fold
   adapter detection + default-config creation into `jin start`'s
   startup sequence (BP-07 steps 1–11). Delete `src/commands/init.ts` or
   shrink to a redirect message.
5. **Reframe `src/api/routes.ts`** to v2 names (`/api/conversations`,
   add `/api/traces`, `/api/tool-calls`), drop dual camel/snake payload,
   drop v1-only fields, drop `/api/tags` and `/api/artifacts` stubs.
6. **Align `jin connect`/`disconnect`/`connections` with BP-08.** Drop
   `--directory`, drop v1 `projects` table dependency (resolve via
   `conversations.git_remote`). Either reserve `connect` for workspace
   onboarding per BP-08 §Reserved, or document the onboarding-bridge
   carve-out explicitly.
7. **Update help/usage in `src/index.ts`** to reflect the v2 surface
   (drop `jin init`, reword connect/start, drop `--directory`).
8. **Remove runtime `saveConfig()` from watcher startup**
   (`watch.ts:115–127`) per BP-07 §6 snapshot invariant.
9. **Reframe `jin team-config`** per BP-Product-Strategy: scope it to a
   "share integration onboarding code" operation, stop using the flat
   `SinkConfig` shape, emit BP-08 discriminated-union payloads.

### Defer to later hardening packets

- `jin ingest` rewritten over v2 pipeline with single-coordinator check
- `jin benchmark` v2 port + daemon-boundary PID access
- TUI v2 rebuild (`src/tui/**`)
- `src/tagger.ts` — tags were dropped in v2; delete rather than port
- PID ownership consolidation (already handled implicitly by step 2)
- BP-02 consecutive-adapter-error tracking (already tracked)
- BP-06 minor-version warnings (already tracked)

---

## Unsafe Bridges to Remove (Not Deprecate In Place)

- **`src/store.ts` + v1 `src/adapters/types.ts`** — every hour they stay,
  new code wires to v1 shapes. Produces data in a schema the entire v2
  contract set rejects. Delaying the cut amplifies the eventual migration.
- **`watch.ts` duck-typed `(adapter as any).newMessages/sessionForFile`** —
  violates `.claude/rules/adapters.md`, masks breakage when v2 adapters
  omit v1 methods. Will silently crash the daemon on any adapter
  rewrite.
- **`watch.ts:115–127` `saveConfig()` at daemon startup** — daemon
  mutates user config without consent. Breaks BP-07/BP-08's durable-
  intent/snapshot invariant. Should be deleted immediately, independent
  of the bigger pipeline swap.
- **`watch.ts` PID/LOG_FILE ownership** — second source of truth next to
  `src/daemon/runtime-state.ts`; can drift because `watchCommand` writes
  the PID without calling `markRuntimeRunning()`. `jin status` and
  `jin stop` can disagree.
- **`connect --directory` flag** — BP-08 removed it for being
  "unreliable across machines" and it resolves via the v1
  `projects.directory` column. Double-broken after v2.
- **`init.ts` opening its own `new Store()` on the runtime store path** —
  races a running daemon, BP-07 §Write-capable one-shot violation, and
  is on the first-run path where users are least able to diagnose.
- **`team-config.ts` flat `SinkConfig` cast** — incompatible with BP-08's
  discriminated union. Encoded team codes will drift as sink fields
  evolve.
- **`api/routes.ts` dual camel+snake payloads + stub `/api/tags`/
  `/api/artifacts`** — long-lived API consumers (Desktop, Prismatic) will
  hard-code against v1 keys and empty-array stubs, making the eventual
  cut painful. The stubs are actively misleading.

---

## BP Drift Surfaced for `.execution/blueprints.md`

- **BP-05** is scored `mostly_aligned` based on the v2 module surface,
  but the production runtime writes to the v1 `src/store.ts` schema, not
  `src/db/store.ts`. The alignment is module-level, not runtime-level.
- **BP-07 §6 (config snapshot at startup)** is violated in production:
  `src/commands/watch.ts:115-127` calls `saveConfig()` during daemon
  startup.
- **BP-07 §First-Run ("There is no separate `jin init` command.")** is
  violated: `jin init` is dispatched in `src/index.ts:309`, documented in
  help, and called on first-run by users following the CLI preamble.
- **BP-08 §"What Was Removed From v1"** — `connect --directory` is still
  present (`src/commands/connect.ts:44, 594-607`; `src/index.ts:111`).
- **BP-08 §Config Schema (discriminated union by `type`)** — bypassed by
  `src/commands/team-config.ts` which still builds the pre-union flat
  shape.

No BP is *wrong*; the drift is all implementation catching up to
approved blueprints. W3-PRODUCT-01 is the right place to close it.
