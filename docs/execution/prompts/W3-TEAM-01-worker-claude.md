Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `claude-WORKER-team-bootstrap`.

You are not alone in the shared canonical workspace. Stay strictly inside this
packet's owned files, do not revert anyone else's edits, and do not absorb
backend/team platform work outside this repo.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/tasks/W3-TEAM-01-team-bootstrap-and-schema-escape-hatch.md`

Then execute the packet exactly.

Read the shared control plane first:
- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-TEAM-01.md`
- `.execution/packets/W3-PRODUCT-01.md`

Before coding, create or update your heartbeat at
`.execution/agents/claude-WORKER-team-bootstrap.md` with:
- agent id: `claude-WORKER-team-bootstrap`
- preferred session name: `claude-WORKER-team-bootstrap`
- external session id: `d9a9d3a5-92d7-4acd-9ce8-d6b561860508`
- packet id: `W3-TEAM-01`
- branch / worktree / container: `feat/rewrite-ontology` / `canonical repo workspace` / `local`
- status: `in_progress`

Only then read the exact BP docs and code files named in the packet:
- `docs/blueprint/BP-Product-Strategy.md`
- `docs/blueprint/BP-01-module-map.md`
- `docs/blueprint/BP-05-store-and-migration.md`
- `docs/blueprint/BP-06-sink-contract.md`
- `docs/blueprint/BP-08-routing-and-config.md`
- `src/index.ts`
- `src/commands/team-config.ts`
- `src/commands/connect.ts`
- `src/commands/init.ts`
- `src/sinks/postgres.ts`
- focused team/bootstrap tests under `test/`

Current program context:
- `W3-PRODUCT-01` is approved
- `W3-STARTUP-01` is already in progress as a separate hardening lane
- there is no current `jin team` command group
- current team/bootstrap behavior is mostly a compatibility/onboarding-code path
- BP-Product says Team is a product plane, not a sink flavor
- BP-Product also says `jin schema apply` may remain an operator escape hatch,
  but must not become the main user story

Constraints:
- only edit packet-owned command/help files and focused tests
- do not edit `src/contracts/**`, `src/db/**`, `src/pipeline/**`,
  `src/adapters/**`, or sink internals beyond read-only consumption of current
  Postgres readiness behavior
- if the right answer requires backend/team API implementation beyond this
  repo, stop and escalate to Codex with a narrow split recommendation

Return the completion report in the exact format from
`docs/execution/00-global-rules.md`.

