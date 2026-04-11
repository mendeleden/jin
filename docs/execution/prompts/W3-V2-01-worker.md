Work in `/Users/edenmendel/Documents/GitHub/jin`.

You are executing the Codex-owned integration packet `W3-V2-01`.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/tasks/W3-V2-01-final-steps-before-e2e.md`

Then execute the packet exactly.

Read the shared control plane first:
- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-TEAM-01.md`
- `.execution/packets/W3-RUNTIME-01.md`
- `.execution/reviews/2026-04-06-W3-TEAM-01-codex.md`
- `.execution/reviews/2026-04-06-W3-TEAM-01-codex-recheck.md` if present
- `.execution/reviews/2026-04-07-W3-RUNTIME-01-codex.md`
- `docs/execution/tasks/W3-E2E-01-persona-cuj-local-postgres.md`

Then read the local E2E assets:
- `package.json`
- `test/docker-compose.integration.yml`
- `test/integration.test.ts`
- `src/index.ts`
- `src/commands/schema.ts`
- `src/commands/connect.ts`
- `src/commands/start.ts`
- `src/commands/status.ts`

Goals:
- produce the concrete final-steps sequence before E2E and experimental preview
- separate:
  - what must land before local E2E
  - what must land before an experimental preview binary
  - what is still deferred until the real runtime/store cutover

Guardrail:
- if `W3-RUNTIME-01` is still unresolved, make that the first blocking item in
  the output instead of writing around it

Constraints:
- do not claim the v2 pipeline/store is already the live runtime path
- do not widen into the full runtime/store cutover
- keep the output concrete and operator-usable

Required output:
- concise completion report in the `00-global-rules.md` format
- an ordered checklist for:
  - `W3-RUNTIME-01` finalize
  - local Docker/Postgres E2E
  - rebuild/install current binary
  - experimental preview decision
