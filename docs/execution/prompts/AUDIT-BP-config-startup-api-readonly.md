Read-only BP drift audit. Do not edit any files.

Scope only:
- BP-08
- startup gating
- read/query/API compatibility drift

Focus on:
- config/routing semantics
- protected-source startup policy
- whether session-like API shims or team-config bridges are still larger than the explicit defer

Read minimally but enough to answer:
- `docs/blueprint/BP-08-routing-and-config.md`
- `docs/blueprint/BP-07-process-lifecycle.md`
- `src/config.ts`
- `src/routing.ts`
- `src/commands/start.ts`
- `src/commands/watch.ts`
- `src/api/routes.ts`
- `src/commands/team-config.ts`
- `.execution/blueprints.md`
- `.execution/program.md`

Return only:
1. findings ordered by severity
2. exact file paths plus BP sections
3. whether each item is code drift, doc drift, or explicit defer
4. which items are safe to defer past an experimental release
