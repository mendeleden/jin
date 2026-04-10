# W3-SINK-04 Worker Prompt

You own `W3-SINK-04: Postgres Push Regression and Release Sink Validation`.

Read first:

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/blueprint/BP-05-store-spine.md`
6. `docs/blueprint/BP-06-sink-contract.md`
7. `docs/blueprint/BP-10-performance-validation.md`
8. `docs/execution/tasks/W3-SINK-04-postgres-push-regression-and-release-sink-validation.md`
9. `docs/execution/audits/2026-04-08-clean-start-postgres-push-regression.md`

Task:

- fix the Postgres push regression behind:
  - `Only use sql.begin, sql.reserved or max: 1`
- keep ownership inside the frozen sink/store/pipeline boundaries
- add focused regression coverage
- produce a durable audit artifact for the clean-start local+remote Postgres
  validation path

Ownership:

- you own:
  - `src/sinks/postgres.ts`
  - `test/postgres-reference-sink.test.ts`
  - packet-local sink validation artifacts under `docs/execution/audits/`
- only touch `src/pipeline/push.ts` or `src/db/store.ts` if the proven fix
  strictly requires it
- you are not alone in the codebase; do not revert unrelated edits

Boundaries:

- do not widen BP-06
- do not change adapter code
- do not change version/service/PR/UI files
- treat `userId` / developer identity as an explicit open question unless the
  root cause proves it is required for delivery

Validation target:

- local Docker Postgres receives rows
- remote Railway Postgres receives rows
- `_jin_push_state` reflects success

Completion report must include:

- exact RCA
- files changed
- tests run
- clean-start validation commands and row counts
- whether identity fields were relevant or remain open
