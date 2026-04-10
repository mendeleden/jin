# Review: W2-CONFIG-02 Mutation And Control Commands

- reviewer: `cursor-REVIEWER-config-mutation-control`
- packet: `W2-CONFIG-02`
- date: `2026-04-02`
- verdict: `approved` (with one S2 and one S3 finding for Codex awareness)

---

## Scope Of Review

Audited the W2-CONFIG-02 config mutation and selective control work against:

- `docs/execution/tasks/W2-CONFIG-02-mutation-and-control-commands.md` (task packet)
- `docs/blueprint/BP-08-routing-and-config.md` (primary blueprint)
- `docs/blueprint/BP-07-process-lifecycle.md` (lifecycle invariants)
- `docs/blueprint/BP-Product-Strategy.md` (Team vs generic sink boundary)
- Prior approved packets: `W1-ROUTING-01`, `W1-LIFECYCLE-01`

Files reviewed:

- `src/commands/config-control.ts` (new)
- `src/commands/sink.ts` (new)
- `src/commands/route.ts` (new)
- `src/commands/connect.ts` (modified)
- `src/commands/init.ts` (modified)
- `src/commands/team-config.ts` (modified)
- `test/config-mutation-control.test.ts` (new)

Tests run:

- `bun test test/config-mutation-control.test.ts` — 5/5 pass, 19 assertions

---

## Aligned

### Config mutation is restart-based by default vs BP-08 §288-340

`persistConfigChange()` in `config-control.ts:9-39` writes durable config
via `saveConfig()`, then checks watcher status. If running without `--yes`,
it prints "Restart jin to apply config changes." With `--yes`, it calls
`restartCommand()`. No hidden hot-reload. Matches BP-08 §288-330 exactly.

Test coverage: "sink add writes durable config and requires explicit restart
by default" verifies restart is not called without `--yes`.

### Service-aware controlled restart vs BP-08 §331-339

`persistConfigChange()` at line 37 passes `{ service: true }` to
`restartCommand()` when the current owner is in service mode. This delegates
restart to the service manager per BP-08 §331-339.

Test coverage: "route add --yes performs a service-aware controlled restart"
verifies `restartCalls` receives `{ service: true }` for a service-mode
owner.

### Selective sink disable is an exception to no-hot-patch vs BP-08 §378-422

`applySinkPauseControl()` in `config-control.ts:41-67` writes a
`RuntimeIssue` with `subsystem: "push"` and `paused: true` via
`markRuntimeRunning()`. This updates the runtime state file without a full
restart. The durable config is also written (in `sink.ts:266-285`).

This matches BP-08's explicit exception: "disable is different — it only
sets a filter flag" (§403-409). The implementation uses the runtime issue
mechanism from W1-LIFECYCLE-01's `degraded` state, which is the right
abstraction — operator-paused sinks show as degraded with a named issue.

Test coverage: "sink pause and resume update the control plane without a
full restart" verifies `markRuntimeRunning` is called with the right issues
and no restart occurs.

### Durable disable survives restart vs BP-08 §397-401

`setSinkEnabled()` in `sink.ts:236-264` writes `enabled: false` to the
durable config via `saveConfig()`. The runtime is also updated via
`applySinkPauseControl()`. Because the config is persisted, disable survives
restart. Matches BP-08's "durable disable" requirement.

### Sink add validates connection before persisting vs BP-08 §248-249

`validateSink()` in `sink.ts:224-234` calls `createSink()` then
`healthCheck()` before the sink is added to config. Matches BP-08 step 1
("Validate connection").

### `jin sink remove` cleans up associated routes vs BP-08 §264-265

`sinkRemoveCommand()` in `sink.ts:54-92` removes the sink and strips it
from all routes, removing routes that become empty. Matches BP-08 §264-265.

### Route mutation uses the frozen routing normalization from W1-ROUTING-01

`normalizeRouteMatchInput()` in `route.ts:108-125` applies
`normalizeRemote()` and `normalizeAdapterId()` from `src/routing.ts` —
reusing the normalization layer approved in W1-ROUTING-01. `branch` and
`name` are kept case-sensitive. Consistent with BP-08 §67-73.

### Team vs generic sink boundary preserved vs BP-Product-Strategy

**`connect.ts`**: The `--team=<code>` path decodes a base64 team config
and creates a standard sink definition via `ensureSinkConfigured()`. No
`team` property is written to the top-level config. The workspace metadata
(`teamId`, `developerId`) from the encoded blob does not leak into the
generic config. Routes use `remote` match keys, not `project` or
`directory`.

**`init.ts`**: The `--team` path similarly decodes team config into a
standard sink via `ensureSinkConfigured()`. No `team` key on config.

**`team-config.ts`**: Generates a base64 onboarding code and explicitly
separates "workspace onboarding" (`jin connect --team=...`) from
"low-level BYO integration" (`jin sink add / jin route add`).

Test coverage: "connect resolves project routing to remote matches and
keeps team data out of generic config" verifies no `team` property and no
`project`/`directory` match keys. "init --team keeps generic config
separate from workspace metadata" verifies the same for init.

### `connect` maps project selection to remote-based routes vs BP-08

`resolveConnectTarget()` in `connect.ts:582-610` and
`resolveProjectTarget()` at lines 612-628 look up the project's
`git_remote` and use `normalizeRemote()` to build route match rules. The
function `requireProjectRemote()` (line 630) explicitly fails if a project
has no git remote, with the error message referencing BP-08's design choice.
This bridges the old project-based connect UX onto the v2 remote-based
routing model.

### No forbidden files touched

- `src/pipeline/**` — untouched ✓
- `src/db/**` — untouched ✓
- `src/adapters/**` — untouched ✓
- `src/sinks/**` — read-only use of `createSink()` and types ✓

---

## Drift

### S2 — `sinkPauseCommand` / `sinkResumeCommand` are dead aliases

- **File:** `src/commands/sink.ts:102-108`
- **Rule:** BP-08 §378-396 uses the terms "disable" / "enable", not
  "pause" / "resume" for the durable config mutation
- **Finding:** Two functions `sinkPauseCommand()` and `sinkResumeCommand()`
  exist as thin aliases over `sinkDisableCommand()` and
  `sinkEnableCommand()`. They are not imported or wired anywhere — no CLI
  registration, no tests. BP-08 uses "disable" / "enable" for the config
  mutation and "pause" is a concept in the runtime issue system. Having
  both `pause` and `disable` as command aliases could create user confusion
  about whether these are the same operation or different.
- **Severity:** S2 — dead code that could cause naming confusion. The
  packet deliverables say "selective `pause` / `resume` semantics" but
  BP-08 §383-395 uses "disable" / "enable" for the durable config level.
  The naming split is a product decision.
- **Recommendation:** Codex should decide whether the user-facing command
  name is `jin sink disable` or `jin sink pause` (or both). If both,
  clarify which maps to durable config and which to ephemeral runtime.
  If only one, remove the dead aliases.

### S3 — `connect.ts` reads v1 `Store.listProjects()` which returns `ProjectRow[]`

- **File:** `src/commands/connect.ts:427-438`
- **Rule:** The packet says no forbidden file edits, but the code reads
  the v1 store's `listProjects()` API to resolve project names to
  git remotes
- **Finding:** `loadProjects()` opens the v1 `Store` and calls
  `listProjects()`, which returns v1 `ProjectRow[]` with `git_remote`,
  `git_branch`, `directory` fields. This is a read-only bridge — it does
  not mutate the store. The bridge is necessary because v2 store
  (`conversations` table with `git_remote` column) is not yet available.
  The interactive connect flow depends on this bridge to map "project
  name" → "git remote" for route creation.
- **Severity:** S3 — expected bridge that will be absorbed when v2 store
  integration lands, similar to the `status.ts` v1 Store bridge noted in
  the W1-LIFECYCLE-01 review.
- **Recommendation:** Acknowledge as an explicit bridge. When the v2 store
  lands, `loadProjects()` should query
  `SELECT DISTINCT git_remote FROM conversations` instead.

---

## Unowned Spread

None. All changes are within `src/commands/` and `test/`. No forbidden
files touched.

---

## Progress

### Acceptance Checks

| # | Check | Status | Evidence |
|---|-------|--------|---------|
| 1 | Generic sink configuration stays separate from Team/workspace concepts | ✓ | `connect.ts` team path writes standard sink config with no `team` key; test verifies |
| 2 | Runtime-affecting config changes are restart-based unless BP-08 says otherwise | ✓ | `persistConfigChange()` requires `--yes` for restart; test verifies no restart without it |
| 3 | Selective pause/resume works as a distinct control-plane behavior | ✓ | `applySinkPauseControl()` updates runtime issues without restart; test verifies |
| 4 | Tests cover no-hidden-hot-reload semantics | ✓ | Tests verify `restartCalls.length === 0` when `--yes` is absent |

All four acceptance checks pass with tests.

### BP Alignment Summary

- **BP-08**: Config mutation and controlled restart semantics fully
  implemented. Sink add/remove, route add/remove, selective disable/enable,
  and service-aware restart all match the blueprint. The remaining BP-08
  surface (`adapter enable/disable`) is not addressed by this packet and
  would need a follow-up.
- **BP-07**: Config snapshot invariant respected. No hot-reload for
  structural config changes. The disable/enable exception uses the runtime
  state mechanism from W1-LIFECYCLE-01.
- **BP-Product-Strategy**: Team vs generic sink boundary is clean. Connect
  and init both route team config through the generic sink primitives
  without leaking workspace metadata into config.

---

## Codex Decisions Needed

1. **Decide the user-facing naming for sink pause/disable.** The S2 finding
   identifies dead `sinkPauseCommand`/`sinkResumeCommand` aliases. BP-08
   uses "disable"/"enable." The packet deliverables say "pause"/"resume."
   Codex should pick one naming scheme and remove the other. This is not
   blocking — the functional behavior is correct regardless of naming.

2. **Acknowledge the v1 Store bridge in `connect.ts`.** Same pattern as the
   `status.ts` bridge from W1-LIFECYCLE-01. Will be absorbed when v2 store
   integration lands.

3. **Codex can move `W2-CONFIG-02` to `approved`.** All acceptance checks
   pass. Boundary discipline is clean. The two findings are informational
   (naming choice + expected bridge), not blocking.
