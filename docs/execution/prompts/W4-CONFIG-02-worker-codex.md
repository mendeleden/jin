# Worker Prompt - W4-CONFIG-02

You are implementing `docs/execution/tasks/W4-CONFIG-02-runtime-reload-status.md` on branch `fix/config-mutation-boundary-19`.

You are not alone in the codebase. Do not revert changes made by others. Keep your writes inside the packet-owned files unless you stop and explain why the packet boundary is insufficient.

## Mission

Expose immutable, secret-safe runtime queue and config reload status through Jin's daemon-owned status boundary.

## Required Read Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/tasks/W4-CONFIG-02-runtime-reload-status.md`
4. `docs/ontology.md`
5. `docs/blueprint/BP-07-process-lifecycle.md`
6. `docs/blueprint/BP-08-routing-and-config.md`
7. `src/pipeline/types.ts`
8. `src/pipeline/queue.ts`
9. `src/pipeline/loop.ts`
10. `src/commands/watch.ts`
11. `src/commands/status.ts`
12. `src/api/control.ts`
13. `src/api/routes.ts`

## Implementation Constraints

- Do not expose mutable queue objects.
- Do not leak config secrets, sink URLs, tokens, or credentials.
- Keep DTOs typed and small.
- Do not change config mutation command behavior; W4-CONFIG-01 owns that.
- Do not touch Desktop renderer code.

## Required Validation

- `bun run typecheck`
- `bun test test/pipeline-spine.test.ts test/local-control-boundary.test.ts`

## Final Response

Include changed files, tests run, BP acceptance result, V1 comparison, and any fields deferred.
