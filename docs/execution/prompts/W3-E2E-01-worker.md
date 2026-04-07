Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-WORKER-persona-e2e-local-postgres`.

You are not alone in the shared canonical workspace. Stay strictly inside this
packet's owned files, do not revert anyone else's edits, and do not absorb
unrelated product-surface or adapter-contract work.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/tasks/W3-E2E-01-persona-cuj-local-postgres.md`

Then execute the packet exactly.

Read the shared control plane first:
- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-STARTUP-01.md`
- `.execution/packets/W3-TEAM-01.md`

Before coding, create or update your heartbeat at
`.execution/agents/codex-WORKER-persona-e2e-local-postgres.md` with:
- preferred session name: `codex-WORKER-persona-e2e-local-postgres`
- packet id: `W3-E2E-01`
- branch / worktree / container: `feat/rewrite-ontology` / `canonical repo workspace` / `local`
- status: `in_progress`

Only then read the exact BP docs and code files named in the packet:
- `docs/blueprint/BP-Product-Strategy.md`
- `docs/blueprint/BP-07-process-lifecycle.md`
- `docs/blueprint/BP-08-routing-and-config.md`
- `docs/blueprint/BP-09-cli-split.md`
- `docs/blueprint/BP-06-sink-contract.md`
- `package.json`
- `test/docker-compose.integration.yml`
- `test/integration.test.ts`
- `test-harness/docker-compose.yml`
- `src/index.ts`
- `src/commands/connect.ts`
- `src/commands/team-config.ts`
- `src/commands/schema.ts`
- `src/commands/start.ts`
- `src/commands/status.ts`
- `src/sinks/postgres.ts`

Current program context:
- `W3-STARTUP-01` and `W3-PRODUCT-01` are approved
- `W3-TEAM-01` must define the operator/bootstrap surface this packet exercises
- this lane is for persona-driven E2E validation, not a general product rewrite

Constraints:
- prefer extending the existing Docker/Postgres integration harness instead of
  inventing a separate stack
- preserve the CLI boundary:
  - operator/admin flow under `jin team ...`
  - developer onboarding at `jin connect --team=<code>`
- if automation is too expensive, produce a concrete runbook plus the smallest
  useful automated coverage
- do not change frozen contracts to make the demo easier

Target deliverables:
- a persona matrix covering `team admin A`, `dev A`, and `dev B`
- a repeatable local Postgres Docker runbook for the end-to-end flow
- explicit operator and developer command sequences
- if viable, a focused automated integration test or harness update proving the
  critical path

Acceptance checks:
- operator can bootstrap local Postgres schema explicitly
- operator can generate a bridge/onboarding code
- developers onboard with `jin connect --team=<code>`
- local daemon path can push to the Dockerized Postgres sink
- verification path is explicit and reproducible

Return the completion report in the exact format from
`docs/execution/00-global-rules.md`.
