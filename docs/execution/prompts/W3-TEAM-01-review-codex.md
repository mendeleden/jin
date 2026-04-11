Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-REVIEWER-team-bootstrap`.

This is a review-only lane. Do not edit product code. You may write only:

- `.execution/reviews/2026-04-06-W3-TEAM-01-codex.md`
- `.execution/blueprints.md`

Read in order:

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/tasks/W3-TEAM-01-team-bootstrap-and-schema-escape-hatch.md`

Then read the live control plane:

- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-TEAM-01.md`
- `.execution/agents/claude-WORKER-team-bootstrap.md`
- `.execution/packets/W3-PRODUCT-01.md`
- `docs/blueprint/BP-09-cli-split.md`

Then read only the packet-owned code and tests:

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

Review goals:

- audit the `jin` versus `jin team` split against BP-09 and BP-Product
- verify the BP Acceptance Matrix row by row against code and test citations
- verify the V1 Comparison claims are accurate
- confirm developer onboarding remains `jin connect --team=<code>`
- confirm operator bootstrap is limited to `jin team bridge` and `jin team schema ...`
- confirm top-level `jin schema` and `jin team connect` are not part of the live surface
- confirm `jin team init` / `jin team status` remain explicitly deferred
- confirm whether Codex can move `W3-TEAM-01` to `approved`

If useful, run only:

- `bun test test/team-bootstrap.test.ts`
- `bun test test/init.test.ts test/connect.test.ts test/config-mutation-control.test.ts`
- `bun src/index.ts --help`
- `bun src/index.ts help team`
- `bun src/index.ts team schema`

Write the review artifact at:

- `.execution/reviews/2026-04-06-W3-TEAM-01-codex.md`

Use this review structure:

- verdict
- scope of review
- blocking findings
- BP Acceptance Matrix verification
- V1 comparison
- aligned
- drift
- unowned spread
- progress
- Codex decisions needed

Important:

- findings first, ordered by severity
- omitted in-scope requirements are blocking, not informational
- if there are no blockers, say that explicitly
- update `.execution/blueprints.md`
- do not edit `.execution/program.md` or `.execution/packets/*.md`
