# Worker Prompt - W4-CONFIG-01

You are implementing `docs/execution/tasks/W4-CONFIG-01-daemon-reload-control.md` on branch `fix/config-mutation-boundary-19`.

You are not alone in the codebase. Do not revert changes made by others. Keep your writes inside the packet-owned files unless you stop and explain why the packet boundary is insufficient.

## Mission

Move first-party config mutation apply from indirect file-watch-only behavior to an explicit daemon local API reload request.

## Required Read Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/tasks/W4-CONFIG-01-daemon-reload-control.md`
4. `docs/ontology.md`
5. `docs/blueprint/BP-07-process-lifecycle.md`
6. `docs/blueprint/BP-08-routing-and-config.md`
7. `src/commands/config-control.ts`
8. `src/commands/watch.ts`
9. `src/api/control.ts`
10. `src/api/routes.ts`
11. `src/api/server.ts`

## Implementation Constraints

- Durable config write happens before daemon notification.
- The daemon route must use existing local auth.
- The daemon route delegates to the coordinator reload path, not a command-side runtime.
- Keep file-watch reload as fallback.
- Add tests before or with the implementation.
- Do not touch Desktop UI code, adapters, sinks, or store schema.

## Required Validation

- `bun run typecheck`
- `bun test test/config-mutation-control.test.ts test/local-control-boundary.test.ts`

## Final Response

Include changed files, tests run, BP acceptance result, V1 comparison, and any follow-up needed for W4-CONFIG-02.
