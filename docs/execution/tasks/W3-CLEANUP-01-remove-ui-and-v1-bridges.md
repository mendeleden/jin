# W3-CLEANUP-01: Remove UI Surface And Remaining V1 Bridges

## Role

Codex-owned cleanup packet.

## Goal

Remove the current TUI/dashboard surface and the explicit v1 compatibility
bridges that still shape the local CLI/runtime/onboarding path:

- `jin ui`
- dashboard lifecycle flags and process-state modeling
- `jin init`
- `jin team-config`
- `jin sessions`
- `jin connect --postgres|--s3|--webhook`
- `LegacyStore`
- the v1 SQLite carry-forward shim in `src/db/schema.ts`

This packet exists to clear the product/runtime surface before the next
workspace identity / `userId` work. It is a cleanup packet, not a redesign
packet.

## Depends On

- `W3-PRODUCT-01`
- `W3-RUNTIME-01`

## Unblocks

- workspace-member / `userId` modeling without legacy onboarding branches
- removal of the explicit `src/tui/app.tsx` `LegacyStore` defer
- a cleaner daemon-first CLI surface aligned with BP-07 / BP-08 / ontology

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/blueprint/BP-01-module-map.md`
5. `docs/blueprint/BP-07-process-lifecycle.md`
6. `docs/blueprint/BP-08-routing-and-config.md`
7. `docs/blueprint/BP-09-cli-split.md`
8. `docs/blueprint/BP-Product-Strategy.md`
9. `docs/ontology.md`
10. `.execution/program.md`
11. `.execution/blueprints.md`
12. `.execution/packets/W3-PRODUCT-01.md`
13. `.execution/packets/W3-RUNTIME-01.md`
14. `.execution/packets/W3-CLEANUP-01.md`
15. `package.json`
16. `src/index.ts`
17. `src/commands/connect.ts`
18. `src/commands/start.ts`
19. `src/commands/stop.ts`
20. `src/commands/status.ts`
21. `src/commands/init.ts`
22. `src/commands/team-config.ts`
23. `src/db/schema.ts`
24. `src/db/store.ts`
25. `src/db/query-surface.ts`
26. `src/store.ts`
27. `src/daemon/process-state.ts`
28. `src/api/control.ts`
29. `src/api/server.ts`
30. `src/api/routes.ts`
31. `scripts/embed-spa.ts`
32. `src/api/_spa.ts`
33. `src/tui/**`
34. `dashboard/**`
35. focused lifecycle/onboarding/control/help tests under `test/`
36. `test/perf-harness/**`

## Owned Files

- `docs/blueprint/BP-09-cli-split.md`
- `package.json`
- `src/index.ts`
- `src/commands/connect.ts`
- `src/commands/start.ts`
- `src/commands/stop.ts`
- `src/commands/status.ts`
- `src/commands/init.ts`
- `src/commands/team-config.ts`
- `src/commands/team-bridge.ts`
- `src/db/schema.ts`
- `src/db/query-surface.ts`
- `src/store.ts`
- `src/daemon/process-state.ts`
- `src/api/control.ts`
- `src/api/server.ts`
- `src/api/_spa.ts`
- `scripts/embed-spa.ts`
- `src/tui/**`
- `dashboard/**`
- focused lifecycle/onboarding/control/help tests under `test/`
- `test/perf-harness/**`

## Forbidden Files

- `src/contracts/**`
- adapter or sink contract/type files
- pipeline internals outside read-only verification
- future desktop-app code
- remote Team product modeling beyond the cleanup needed to unblock `userId`

## Deliverables

- no `jin ui` command surface remains
- no `--ui`, `--all`, or dashboard-specific lifecycle flags remain
- no compiled build step still embeds or builds the dashboard
- the current TUI and SPA files are removed
- runtime/control/status state no longer reports a `dashboard` component
- no `jin init`, `jin team-config`, or `jin sessions` compatibility alias remains
- `jin team bridge` remains the operator bridge command from a non-deprecated
  module path
- `jin connect` no longer exposes legacy one-step sink-creation shortcut flags
- `LegacyStore` export is removed; surviving onboarding/read surfaces use the
  v2 store/query path instead
- `src/db/schema.ts` no longer carries the v1 `prepareLegacyStoreForV2(...)`
  rename shim
- `BP-09` is updated so the blueprint matches the new command surface

## Non-Goals

- redesigning the future desktop app
- redesigning the future local daemon query mechanism
- changing adapter interface semantics
- changing sink payload or push semantics
- designing the full `userId` / workspace-member model

## BP Acceptance Matrix

| Requirement | Blueprint | Expected evidence |
|-------------|-----------|-------------------|
| Local CLI surface is daemon-first and no longer exposes removed dashboard / onboarding compatibility commands | BP-07, BP-08, BP-09, ontology | `src/index.ts`, focused help/CLI tests |
| Team/workspace onboarding stays under `jin connect --team` and `jin team bridge`, while generic integrations stay under `jin sink` / `jin route` | BP-08, BP-09, BP-Product | `src/index.ts`, `src/commands/connect.ts`, `src/commands/team-bridge.ts`, focused onboarding tests |
| Lifecycle/status/control no longer model a removed dashboard component | BP-07 | `src/commands/start.ts`, `src/commands/stop.ts`, `src/commands/status.ts`, `src/daemon/process-state.ts`, `src/api/control.ts`, focused lifecycle/control tests |
| Build/install path no longer embeds or depends on the SPA dashboard | BP-01 | `package.json`, removal of `scripts/embed-spa.ts` / `src/api/_spa.ts`, build/help checks |
| Local read/onboarding surfaces no longer depend on `LegacyStore` or the v1 schema carry-forward shim | BP-05, BP-08 | `src/commands/connect.ts`, `src/db/query-surface.ts`, `src/store.ts`, `src/db/schema.ts`, focused tests |
| BP-09 reflects the actual post-cleanup command surface | BP-09 | `docs/blueprint/BP-09-cli-split.md` |

Every row must be resolved in the completion report as:
- implemented, with code + test citation
- deferred, with Codex approval
- out of scope, with boundary citation

## V1 Comparison

This packet rewrites existing v1-era compatibility surfaces. The handoff must
state, for each removed surface, whether the outcome is:

- intentional BP-backed removal
- parity kept through a v2 replacement path
- deferred regression with explicit Codex approval

## Acceptance Checks

- `jin --help` no longer advertises `ui`, `init`, `team-config`, or `sessions`
- `jin start` / `jin stop` help no longer mention dashboard flags
- `jin connect` help/output no longer mentions `--postgres`, `--s3`, or `--webhook`
- `package.json` no longer builds the dashboard as part of the binary build
- `src/tui/**` and `dashboard/**` are removed or dead-free
- no runtime/status/control import still depends on dashboard process-state code
- no runtime/onboarding import still depends on `LegacyStore`
- `src/db/schema.ts` no longer defines `prepareLegacyStoreForV2`

## Stop And Escalate

Stop if:

- adapter or sink frozen contracts must change to finish cleanup
- userId/workspace identity design must be decided to complete the packet
- the smallest safe slice is narrower than “remove UI + explicit v1 bridges”
- a required blueprint update is broader than `BP-09` command-surface alignment

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

BP acceptance matrix:
- <requirement> -> implemented in <file>, tested by <test>
- <requirement> -> deferred with Codex approval
- <requirement> -> out of scope per packet boundary

V1 comparison:
- parity kept / intentional BP-backed change / deferred regression
- or `no prior v1 surface`

BP alignment:
- BP-XX: sections implemented

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
