# Packet State

- packet: `W3-PRODUCT-01`
- title: `Command Surface Reframe`
- status: `approved`
- assigned agent: `codex-BRAIN`
- branch: `feat/rewrite-ontology`
- worktree/container: `canonical repo workspace` / `local`
- depends on: `W2-CONFIG-02`, `W2-DAEMON-02`, `W3-MODULE-01 or equivalent stability`
- unblocks: `final product-surface coherence`
- last transition: `2026-04-05`
- next Codex action: `decide whether the remaining explicit compatibility bridges should become one or more follow-up hardening packets, then commit the scoped command-surface diff`
- latest review: `2026-04-04-W3-PRODUCT-01-claude`

## Notes

- this is the active Codex-owned integration lane after `W3-MODULE-01`
- command/help framing now centers:
  - `jin start` as the daemon-first local-first bootstrap path
  - `jin connect --team=<code>` as the workspace onboarding bridge
  - `jin sink ...` and `jin route ...` as the low-level generic integration surface
- canonical conversation-first aliases are now exposed without breaking existing clients:
  - CLI: `jin conversations` (legacy `jin sessions` kept)
  - API: `/api/conversations` and `/api/projects/:id/conversations` (legacy `/api/sessions*` kept)
- the remaining legacy one-shot/store/adapter surfaces are now explicit:
  - `src/adapters/types.ts` names the compatibility layer as `LegacyAdapter` / `LegacySession` / `LegacyMessage`
  - `src/store.ts` exposes `LegacyStore` for the remaining compatibility commands
  - `src/commands/{watch,ingest,benchmark}.ts` resolve runtime/store paths through the daemon runtime-path bridge instead of requiring the removed v1 `config.store` block
  - `src/commands/init.ts` remains as a compatibility helper, but it now skips one-shot ingest when a long-lived runtime is already active
- `jin connect` no longer creates generic sinks interactively; it now routes indexed repos onto existing destinations or a workspace onboarding sink
- the legacy `connect --directory` bridge is retired from help, dispatch, implementation, and focused tests
- daemon startup now honors BP-07/BP-08 config snapshot semantics within this packet scope:
  - `src/commands/watch.ts` no longer auto-enables disabled adapters or writes durable config during startup
- sink control naming is now `disable` / `enable`; dead `pause` / `resume` aliases were removed from `src/commands/sink.ts`
- `2026-04-04-W3-PRODUCT-01-claude` was rewritten on `2026-04-05` with an
  `approved` verdict after the packet addressed the prior blockers:
  - removed the `connect --directory` bridge
  - restored startup config-snapshot behavior in `src/commands/watch.ts`
  - constrained the retained `jin init` bridge to compatibility-only
    coordinator behavior and recorded the first-run gap as an explicit defer
- out of scope unless required by command-surface wiring:
  - sink dual-interface shims in `src/sinks/**`
  - config parsing compatibility in `src/config.ts` and `src/sink-resolver.ts`

## Bridges Removed

- hidden generic-integration CLI bridge removed: `src/index.ts` now exposes `jin sink ...`, `jin route ...`, and `jin ingest` directly instead of forcing generic integration setup through `jin connect`
- interactive generic sink-creation bridge removed: `src/commands/connect.ts` no longer offers Postgres/S3/webhook creation inside the guided `jin connect` flow
- legacy `connect --directory` bridge removed: help, CLI dispatch, implementation, and focused tests no longer expose directory-based repo routing
- dead sink control naming bridge removed: `src/commands/sink.ts` no longer carries unused `pause` / `resume` aliases alongside the BP-08 `disable` / `enable` naming

## Bridges Intentionally Left In Place

- `src/api/routes.ts` keeps `/api/sessions*` aliases and session-like payload field duplicates because existing local clients and tests still consume them; this packet adds canonical conversation aliases instead of breaking the client contract
- `src/store.ts` remains a legacy local-store bridge because `connect`, `init`, `ingest`, `watch`, `benchmark`, `status`, `analyze`, and `tui` still read the compatibility schema directly; replacing that path requires a broader v2 store/query migration
- `src/adapters/types.ts` keeps the legacy `sessions()` / `messages()` interface because the remaining one-shot/watch compatibility commands still depend on it; removing it would widen into the frozen adapter/runtime migration lane
- `src/commands/connect.ts` keeps `--postgres`, `--s3`, and `--webhook` as compatibility shortcuts because removing them would break existing BYO integration flows; they are now explicitly demoted behind `jin sink ...` + `jin route ...`
- `src/index.ts` and `src/commands/init.ts` keep `jin init` as a compatibility helper because removing it in this pass would break existing onboarding/setup flows; the primary story now points to `jin start`, and the retained bridge no longer runs one-shot ingest while a long-lived runtime is active
- `src/index.ts` keeps `jin sessions` as a compatibility alias because removing it in this pass would break existing read-only flows; the primary story now points to `jin conversations`

## BP Acceptance Matrix

| Requirement | Status | Evidence |
|-------------|--------|----------|
| BP-Product: daemon-first local-first onboarding is the primary story | implemented | `src/index.ts`, `src/commands/team-config.ts`, `src/commands/connect.ts`; verified by `bun src/index.ts --help`, `bun src/index.ts help connect`, and `bun test test/local-control-boundary.test.ts` |
| BP-07 / BP-08: write-capable one-shot compatibility ingest respects the single-coordinator rule | implemented | `src/commands/ingest.ts`, `src/commands/init.ts`; verified by `bun test test/init.test.ts` |
| BP-07 first-run rule ("jin start" is the only bootstrap path; no separate init command) | deferred with Codex approval | `src/index.ts`, `src/commands/init.ts`; retained explicit compatibility bridge while the help surface points to `jin start` as the primary path |
| BP-Product / BP-08: Team/workspace framing stays separate from generic sink wiring | implemented | `src/index.ts`, `src/commands/connect.ts`, `src/commands/team-config.ts`; verified by `bun test test/connect.test.ts` and `bun test test/config-mutation-control.test.ts` |
| BP-Product / BP-08: generic integrations stay available without becoming the product story | implemented | `src/index.ts`, `src/commands/sink.ts`; verified by `bun src/index.ts help sink` and `bun test test/config-mutation-control.test.ts` |
| BP-08: removed v1 directory-based repo routing from the command surface | implemented | `src/index.ts`, `src/commands/connect.ts`; verified by `bun src/index.ts help connect` and `bun test test/connect.test.ts` |
| BP-Product / BP-07: canonical local read surfaces can speak in conversation-first terms without breaking clients | implemented | `src/index.ts`, `src/api/routes.ts`; verified by `bun src/index.ts help show` and `bun test test/read-only-query-surface.test.ts` |
| BP-07 / BP-08: legacy one-shot/watch/benchmark compatibility commands operate against the BP-08 config shape without reviving a `store` config block | implemented | `src/commands/ingest.ts`, `src/commands/watch.ts`, `src/commands/benchmark.ts`, `src/store.ts`; verified by `bun test test/init.test.ts` and `bun test test/config-mutation-control.test.ts` |
| BP-07 / BP-08: daemon startup treats config as a startup snapshot within this command surface | implemented | `src/commands/watch.ts`; verified by `bun test test/config-mutation-control.test.ts` |
| BP-04 / BP-06: remove legacy adapter `sessions()` / `messages()` compatibility surface | deferred with Codex approval | explicit defer in `src/adapters/types.ts`; removing it would widen into adapter ports plus frozen watch/ingest semantics outside this packet |
| BP-05 / BP-07: remove the remaining legacy local store bridge | deferred with Codex approval | explicit defer in `src/store.ts`; multiple compatibility/admin commands still depend on the legacy schema and query helpers |
| BP-Product / BP-07: remove session-like API aliases and payload duplicates entirely | deferred with Codex approval | explicit defer in `src/api/routes.ts`; existing clients/tests still consume `/api/sessions*` and duplicated payload fields, so this pass adds canonical aliases instead of breaking them |

## V1 Comparison

- intentional BP-backed change: `src/index.ts` now makes `jin start` the primary local-first path, while `jin init` is explicitly retained only as a compatibility helper and no longer runs one-shot ingest when a long-lived runtime is already active
- intentional BP-backed change: `src/index.ts` now exposes `jin sink ...` and `jin route ...` as the primary generic integration surface, while `src/commands/connect.ts` demotes `--postgres` / `--s3` / `--webhook` to compatibility shortcuts, per BP-08 and BP-Product
- intentional BP-backed change: `src/commands/connect.ts` no longer creates new generic sinks inside the guided `jin connect` flow; guided connect now routes repos onto existing destinations or workspace onboarding sinks
- intentional BP-backed change: `src/index.ts` and `src/commands/connect.ts` no longer expose the legacy `--directory` repo-routing bridge; repo routing now uses indexed repo names or explicit remotes only
- intentional BP-backed change: `src/index.ts` and `src/api/routes.ts` now expose canonical conversation-first aliases (`jin conversations`, `/api/conversations`) while keeping session aliases for compatibility
- parity kept: `src/commands/connect.ts` still creates/removes the same remote-based route rules and preserves existing sink reuse semantics across `connectCommand()` and `disconnectCommand()`
- parity kept: `src/commands/init.ts` still registers workspace destinations as generic sink config without leaking workspace metadata into the durable config
- intentional BP-backed change: `src/commands/watch.ts` no longer auto-enables disabled adapters or writes durable config during startup; startup now snapshots config instead of mutating it
