# Review: W1-ROUTING-01 Routing And Config Core

- reviewer: `cursor-audit`
- packet: `W1-ROUTING-01`
- date: `2026-04-01`
- verdict: `approved` (with one S2 and one S3 finding for Codex awareness)

## Scope Of Review

Audited the uncommitted W1-ROUTING-01 routing/config work against:

- `docs/execution/tasks/W1-ROUTING-01-routing-config-core.md` (task packet)
- `docs/blueprint/BP-08-routing-and-config.md` (primary blueprint)
- `docs/blueprint/BP-06-sink-contract.md` (sink boundary)
- `src/contracts/config.ts` (frozen contract)
- All changes in `src/config.ts`, `src/routing.ts`, `test/routing.test.ts`,
  `test/config.test.ts`

## Aligned

### RouteMatch fields and AND semantics vs BP-08 §48-89

- `RoutableConversation` has the correct 4 fields: `gitRemote`, `adapterId`,
  `branch`, `name`. (`src/routing.ts`:8-13)
- `matchesRoute()` uses AND semantics: all specified fields must match, omitted
  fields are treated as wildcards. Matches BP-08 §64-66.
  (`src/routing.ts`:59-67)
- Empty match object `{}` is a wildcard route. Test confirms this.
  (`test/routing.test.ts`: "treats an empty match object as a wildcard route")

### Case sensitivity vs BP-08 §67-73

- `remote` matching uses `normalizeRemote()` which lowercases. Case-insensitive.
  ✓ (`src/routing.ts`:60, 69-79)
- `adapter` matching uses `normalizeAdapterId()` which lowercases.
  Case-insensitive. ✓ (`src/routing.ts`:61, 81-83)
- `branch` matching uses default `identity` normalizer. Case-sensitive. ✓
  (`src/routing.ts`:62)
- `name` matching uses default `identity` normalizer. Case-sensitive. ✓
  (`src/routing.ts`:63)
- Tests verify this explicitly.
  (`test/routing.test.ts`: "matches normalized remote globs case-insensitively",
  "matches adapter globs case-insensitively", "matches branch and name globs
  case-sensitively")

### Union-of-all-matches vs BP-08 §93-133

- `sinkIdsForConversation()` iterates all routes, collects all matching sink
  IDs, deduplicates via Set. All-matches union, not first-match-wins.
  Matches BP-08 §96-102. (`src/routing.ts`:17-37)
- Test verifies union from two matching routes with overlapping sink IDs.
  (`test/routing.test.ts`: "unions sink ids from all matching routes")

### Safe zero-state vs BP-08 §112-134

- No routes configured: returns empty array. ✓
  (`src/routing.ts`:19-21)
- Routes configured, none match: returns empty array. ✓
  (`test/routing.test.ts`: "returns an empty sink set when no routes match")
- No `defaultSinks` fallback in the v2 routing path. ✓
- No `routeUnmatchedToAll` in the v2 routing path. ✓

### Glob matching vs BP-08 §48-54

- `globToRegExp()` converts `*` to `.*` and `?` to `.`, escapes regex
  metacharacters. Correct glob semantics.
  (`src/routing.ts`:94-108)
- Applied via `matchesGlob()` which normalizes both pattern and value before
  matching. (`src/routing.ts`:85-97)

### normalizeRemote vs BP-08 §67-68

- Strips protocol (`https://`, `ssh://`, etc.)
- Converts SSH `user@host:path` to `host/path`
- Lowercases
- Strips trailing slashes and `.git` suffix
- (`src/routing.ts`:69-79)
- This goes beyond BP-08's stated "lowercase, strip .git suffix, trim trailing
  slashes" by also stripping protocol and SSH user prefix. This is a
  superset that enables matching SSH and HTTPS remotes to the same pattern
  (e.g., `github.com/acme/*` matches both `git@github.com:acme/repo.git`
  and `https://github.com/acme/repo.git`). This is useful behavior and
  does not contradict BP-08.

### Config normalization vs BP-08 §150-203

- `normalizeConfig()` produces a clean `JinConfig` from unknown input.
  (`src/config.ts`:155-167)
- Discriminated sink union by `type` field. Three concrete types:
  `PostgresSinkConfig`, `S3SinkConfig`, `WebhookSinkConfig`.
  Each validated with required fields, defaults applied.
  (`src/config.ts`:218-321)
- Route normalization strips unrecognized match fields (the `normalizeRouteMatch`
  function only copies `remote`, `adapter`, `branch`, `name`). Legacy fields
  like `project` and `directory` are silently dropped. ✓
  (`src/config.ts`:331-357)
- `defaultConfig()` returns v2 zero-state: empty sinks, empty routes, poll
  interval from frozen `DEFAULT_SCAN_INTERVAL_MS`. No `defaultSinks`, no
  `routeUnmatchedToAll`, no `store`, no `team`. Matches BP-08 §441-456.
  (`src/config.ts`:142-151)

### Config test coverage

- `test/config.test.ts` verifies:
  - Zero-state snapshot has no legacy fields ✓
  - Sink normalization applies defaults (region, prefix, timeoutMs) ✓
  - Sink validation rejects incomplete entries (missing required fields) ✓
  - Non-string header values are stripped ✓
  - Duplicate sink IDs in routes are deduplicated ✓
  - Legacy route match fields (`project`, `directory`) are stripped ✓
  - Legacy config fields (`defaultSinks`, `routeUnmatchedToAll`, `store`,
    `team`) are stripped ✓
  - `watch` normalization preserves valid `pollIntervalMs` ✓

### Routing test coverage

- `test/routing.test.ts` covers all 5 acceptance checks from the packet:
  - AND semantics ✓
  - Union behavior ✓
  - No match = empty sink set ✓
  - v1 behaviors absent from v2 path ✓
  - Glob matching, union, safe zero-state ✓

### Boundary discipline

- Owned files only: `src/config.ts`, `src/routing.ts`, `test/routing.test.ts`,
  `test/config.test.ts`. All within packet boundary.
- No forbidden files touched.
- Agent heartbeat confirms typecheck failures are in forbidden legacy files
  only.

## Drift

### S2 — Legacy bridge `sinksForSession()` retained with `unknown` parameters

- **File:** `src/routing.ts`:42-56
- **Rule:** BP-08 §441-456 (removed v1 fields), `00-global-rules.md` §5
  ("If a bridge from old code to new code is needed, keep the bridge explicit")
- **Finding:** The worker retained a `sinksForSession()` function that accepts
  `unknown` parameters and attempts to sniff the call shape. This is meant
  as a compatibility bridge for v1 callers. While the bridge is commented
  as a "Legacy wrapper," it uses aggressive type-erasure (`unknown` params
  with runtime sniffing) rather than typed overloads or a clear deprecation
  path. The `toRoutableConversation()`, `extractRoutes()`, and
  `extractSinks()` functions (lines 110-156) exist solely to support this
  bridge.
- **Severity:** S2 — the bridge is explicit (satisfying §5) but the runtime
  sniffing approach could mask call-site bugs. The bridge is in-boundary
  (the packet owns `src/routing.ts`) and the old callers are in forbidden
  files, so the worker could not have done better without violating boundary
  discipline.
- **Recommendation:** Codex should note this bridge for removal during the
  integration pass when v1 callers are updated. The bridge itself is not a
  blocker.

### S3 — `src/config.ts` local types extend frozen contract types with extra fields

- **File:** `src/config.ts`:43-85
- **Rule:** `00-global-rules.md` §4 (Contract Freeze Rule), frozen contract
  surface at `src/contracts/config.ts`
- **Finding:** The local `RouteMatch` type is declared as
  `ContractRouteMatch & { project?: string; directory?: string; }` — it
  extends the frozen type with two v1 legacy fields. Similarly, `SinkConfigBase`
  uses `Omit<ContractSinkConfigBase, "enabled">` and adds back `enabled?`
  as optional (the frozen contract has it as required `boolean`). `JinConfig`
  uses `Omit<ContractJinConfig, ...>` with `defaultSinks?` and
  `routeUnmatchedToAll?` re-added.
- **Severity:** S3 — these extensions are for backwards-compatible config
  parsing. The `normalizeConfig()` function strips legacy fields before
  the data reaches the v2 code path, so the frozen contract semantics are
  preserved at runtime. The extensions exist only in the parsing layer.
  However, the fact that `enabled` goes from required to optional in the
  local type is a subtle change that could let unchecked configs through
  if `normalizeConfig()` is bypassed.
- **Recommendation:** Document the intent clearly. The current approach is
  reasonable for a parsing layer that must accept both v1 and v2 configs.

## Unowned Spread

None. All changes are within `src/config.ts`, `src/routing.ts`,
`test/routing.test.ts`, `test/config.test.ts`.

## Progress

- BP-08: `in_progress` — config schema, route evaluation, glob matching,
  AND semantics, union-of-all-matches, safe zero-state, and config
  normalization are all implemented and tested. Remaining BP-08 surfaces
  (mutation commands, pause/resume, daemon reload) are in later packets
  (`W2-CONFIG-02`, `W2-CMD-01`).

## Codex Decisions Needed

1. **Acknowledge the S2 legacy bridge.** The `sinksForSession()` function
   with `unknown` params is an explicit bridge per §5. Codex should plan
   to remove it during the integration pass. No blocking action needed.

2. **Acknowledge the S3 local type extensions.** The parsing layer extends
   frozen types for v1 compatibility. This is reasonable but should be
   documented. No blocking action needed.

3. **Resolve the packet/agent state mismatch.** The packet file
   `.execution/packets/W1-ROUTING-01.md` still shows `status: queued` and
   `assigned agent: unassigned` while the agent heartbeat shows
   `status: review_ready`. Codex should update the packet file to reflect
   the actual state per `01-dispatch-protocol.md` §Required State
   Transitions §1.
