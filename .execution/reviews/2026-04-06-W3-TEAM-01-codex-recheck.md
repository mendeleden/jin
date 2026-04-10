# W3-TEAM-01 Codex Re-Review

## verdict

- `approved`
- No blocking findings remain. The prior blocker is resolved: `schemaApplyCommand()` now keeps post-apply guidance inside the `jin team` operator surface, and Codex can move `W3-TEAM-01` to `approved`.

## scope of review

- Re-read in required order:
  - `docs/execution/00-global-rules.md`
  - `docs/execution/01-dispatch-protocol.md`
  - `docs/execution/05-live-control-plane.md`
  - `docs/execution/tasks/W3-TEAM-01-team-bootstrap-and-schema-escape-hatch.md`
- Re-read live control plane and prior review:
  - `.execution/program.md`
  - `.execution/blueprints.md`
  - `.execution/packets/W3-TEAM-01.md`
  - `.execution/agents/claude-WORKER-team-bootstrap.md`
  - `.execution/reviews/2026-04-06-W3-TEAM-01-codex.md`
  - `docs/blueprint/BP-09-cli-split.md`
- Re-read packet-owned BP/code/tests with focus on the claimed fix:
  - `docs/blueprint/BP-Product-Strategy.md`
  - `docs/blueprint/BP-01-module-map.md`
  - `docs/blueprint/BP-05-store-and-migration.md`
  - `docs/blueprint/BP-06-sink-contract.md`
  - `docs/blueprint/BP-08-routing-and-config.md`
  - `src/index.ts`
  - `src/commands/team-config.ts`
  - `src/commands/connect.ts`
  - `src/commands/init.ts`
  - `src/commands/schema.ts`
  - `src/sinks/postgres.ts`
  - `test/team-bootstrap.test.ts`
  - `test/init.test.ts`
  - `test/connect.test.ts`
  - `test/config-mutation-control.test.ts`
- Ran allowed verification commands:
  - `bun test test/team-bootstrap.test.ts`
  - `bun test test/init.test.ts test/connect.test.ts test/config-mutation-control.test.ts`
  - `bun src/index.ts help team`
  - `bun src/index.ts team schema`

## blocking findings

- None. The old blocker from `.execution/reviews/2026-04-06-W3-TEAM-01-codex.md` is resolved.

## BP Acceptance Matrix verification

- Team remains a distinct product plane in the local CLI surface, not a renamed Postgres sink flow -> implemented. Evidence: `src/index.ts:281-298`, `src/index.ts:321-350`, `src/index.ts:678-744`, `src/commands/team-config.ts:25-43`, `docs/blueprint/BP-Product-Strategy.md:283-320`, `docs/blueprint/BP-09-cli-split.md:121-137`, `test/team-bootstrap.test.ts:97-107`, `test/team-bootstrap.test.ts:266-282`, `bun src/index.ts help team`.
- Developer onboarding stays at top-level `jin connect --team=<code>` rather than moving under `jin team` -> implemented. Evidence: `src/index.ts:335-350`, `src/commands/connect.ts:73-85`, `src/commands/connect.ts:483-486`, `docs/blueprint/BP-09-cli-split.md:245-266`, `test/connect.test.ts:145-159`, `test/team-bootstrap.test.ts:142-155`.
- Any remote Postgres bootstrap path is explicit operator/admin surface under `jin team schema ...`, not the default onboarding story -> implemented. Evidence: `src/index.ts:287-297`, `src/index.ts:702-744`, `src/commands/schema.ts:111-159`, `src/commands/schema.ts:230-238`, `docs/blueprint/BP-09-cli-split.md:183-266`, `docs/blueprint/BP-09-cli-split.md:417-432`, `test/team-bootstrap.test.ts:160-238`, `bun src/index.ts team schema`.
- Existing workspace onboarding (`team-config`, `connect --team`, `init --team`) does not regress -> implemented. Evidence: `src/commands/team-config.ts:22-89`, `src/commands/connect.ts:73-85`, `src/commands/init.ts:24-50`, `src/commands/init.ts:164-178`, `test/init.test.ts:89-152`, `test/connect.test.ts:145-159`, `test/config-mutation-control.test.ts:255-315`.
- Generic sink wiring stays separate from Team/product framing -> implemented. Evidence: `src/index.ts:255-267`, `src/index.ts:341-350`, `src/commands/team-config.ts:78-81`, `src/commands/schema.ts:234-237`, `docs/blueprint/BP-06-sink-contract.md:21-24`, `docs/blueprint/BP-08-routing-and-config.md:32-36`, `test/team-bootstrap.test.ts:227-238`.
- `jin team init` / `jin team status` remain deferred unless workspace identity is real and non-heuristic -> implemented. Evidence: `src/index.ts:292-297`, `src/index.ts:683-742`, `docs/blueprint/BP-09-cli-split.md:138-146`, `docs/blueprint/BP-09-cli-split.md:318-337`, `test/team-bootstrap.test.ts:284-290`, `bun src/index.ts help team`.

## V1 comparison

- Parity kept: developer onboarding is still `jin connect --team=<code>`, and the existing connect path still decodes the bridge code into a sink plus route without moving developers under `jin team` (`src/commands/connect.ts:73-85`, `src/commands/connect.ts:483-486`, `test/connect.test.ts:145-159`).
- Parity kept: compatibility onboarding helpers remain. `jin init --team` still appends or reuses a workspace sink and then guides repo routing, and `jin team-config` remains as a deprecated alias to the bridge flow (`src/index.ts:299-307`, `src/index.ts:754-770`, `src/commands/init.ts:24-50`, `test/init.test.ts:89-152`).
- Intentional BP-backed change is now complete: the operator escape hatch remains `jin team schema ...`, and after a successful apply the CLI now points operators to `jin team bridge` or `jin team help`, not to generic sink wiring (`src/commands/schema.ts:156-159`, `src/commands/schema.ts:230-238`, `docs/blueprint/BP-09-cli-split.md:127-137`, `docs/blueprint/BP-09-cli-split.md:386-390`).

## aligned

- The prior blocker is fixed in the live code path. `schemaApplyCommand()` now prints the extracted `schemaApplySuccessGuidance()` lines after success (`src/commands/schema.ts:156-159`), and that guidance stays inside `jin team` by pointing to `jin team bridge --type=postgres ...` and `jin team help` (`src/commands/schema.ts:230-238`).
- `jin team schema apply` no longer points operators to `jin sink add postgres ...`. The only remaining `jin sink add` references in the reviewed packet surface are the intentional generic integration docs outside the schema-apply success path (`src/index.ts:255-267`, `src/commands/team-config.ts:78-81`).
- Focused coverage was added for the fixed branch messaging. `test/team-bootstrap.test.ts:227-238` now asserts the success guidance includes `jin team bridge`, excludes `jin sink add postgres`, and mentions `jin team help`. This is helper-level coverage for the exact strings emitted by the success branch.
- Allowed verification passed:
  - `bun test test/team-bootstrap.test.ts` -> 15 pass, 0 fail
  - `bun test test/init.test.ts test/connect.test.ts test/config-mutation-control.test.ts` -> 42 pass, 0 fail
  - `bun src/index.ts help team` -> operator surface shows only `bridge`, `schema apply|check|version`, and deferred `init` / `status`
  - `bun src/index.ts team schema` -> only `apply|check|version`

## drift

- None in the rechecked scope. No new BP-09 drift remains after the post-apply guidance fix.

## unowned spread

- None detected. The reviewed worker diff remains inside packet-owned files: `src/index.ts`, `src/commands/team-config.ts`, `src/commands/schema.ts`, and `test/team-bootstrap.test.ts`.

## progress

- Narrow re-review completed.
- The old blocker is closed.
- `W3-TEAM-01` is ready for Codex approval.

## Codex decisions needed

- None. Codex can move `W3-TEAM-01` to `approved`.
