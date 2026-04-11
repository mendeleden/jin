Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-REVIEWER-v2-final-steps-recheck`.

This is a review-only lane. Do not edit product code. You may write only:
- `.execution/reviews/2026-04-07-W3-V2-01-codex-recheck.md`
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
- `.execution/reviews/2026-04-07-W3-V2-01-codex.md`
- `.execution/reviews/2026-04-07-W3-RUNTIME-01-codex-recheck.md`
- `.execution/agents/codex-WORKER-v2-final-steps.md`

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
- verify the stale `W3-RUNTIME-01` wording is corrected
- verify the final-steps checklist now starts from runtime already approved and committed in `45529f8`
- verify the binary rebuild/install, BP-09 operator/developer split, and preview caveats remain intact
- confirm whether Codex can move `W3-V2-01` to `approved`

If useful, run only:
- `git rev-parse --short HEAD`
- `bun src/index.ts help team`
- `bun src/index.ts team schema`

Write the review artifact at:
- `.execution/reviews/2026-04-07-W3-V2-01-codex-recheck.md`

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
- this is a narrow docs-only recheck
- if there are no blockers, say that explicitly
- update `.execution/blueprints.md`
- do not edit `.execution/program.md` or `.execution/packets/*.md`
