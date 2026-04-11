Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-REVIEWER-v2-final-steps`.

This is a review-only lane. Do not edit product code. You may write only:
- `.execution/reviews/2026-04-07-W3-V2-01-codex.md`
- `.execution/blueprints.md`

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/tasks/W3-V2-01-final-steps-before-e2e.md`

Then read the live control plane:
- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-V2-01.md`
- `.execution/packets/W3-RUNTIME-01.md`
- `.execution/packets/W3-TEAM-01.md`
- `.execution/packets/W3-STARTUP-01.md`
- `.execution/agents/codex-WORKER-v2-final-steps.md`
- `.execution/reviews/2026-04-07-W3-RUNTIME-01-codex-recheck.md`

Then read the packet-owned docs and supporting files:
- `docs/execution/audits/2026-04-07-W3-V2-01-final-steps.md`
- `docs/execution/tasks/W3-E2E-01-persona-cuj-local-postgres.md`
- `package.json`
- `test/docker-compose.integration.yml`
- `test/integration.test.ts`
- `src/commands/service.ts`
- `src/commands/start.ts`
- `src/commands/status.ts`
- `src/commands/schema.ts`
- `src/commands/connect.ts`
- `src/index.ts`

Review goals:
- verify the final-steps checklist matches current approved packet state
- verify `W3-RUNTIME-01` is treated as approved and committed, not still pending
- verify the binary rebuild/install instructions match the current CLI/service discovery path
- verify the local Docker/Postgres E2E sequence preserves the BP-09 boundary:
  operator actions under `jin team ...`, developer onboarding under `jin connect --team=<code>`
- verify preview caveats are explicit and do not overclaim a full v2 completion
- confirm whether Codex can move `W3-V2-01` to `approved`

If useful, run only:
- `git rev-parse --short HEAD`
- `bun src/index.ts help team`
- `bun src/index.ts team schema`

Write the review artifact at:
- `.execution/reviews/2026-04-07-W3-V2-01-codex.md`

Use this review structure:
- verdict
- scope of review
- blocking findings
- BP Acceptance Matrix verification
- aligned
- drift
- unowned spread
- progress
- Codex decisions needed

Important:
- findings first, ordered by severity
- omitted in-scope release/pre-E2E gates are blocking, not informational
- if there are no blockers, say that explicitly
- update `.execution/blueprints.md`
- do not edit `.execution/program.md` or `.execution/packets/*.md`
