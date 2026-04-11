Read-only BP drift audit. Do not edit any files.

Scope only:
- BP-Product
- BP-07
- BP-09
- current command/help surface

Focus on:
- developer vs operator vs desktop/daemon boundaries
- command namespace drift
- any mismatch between approved BP intent and current implementation

Read minimally but enough to answer:
- `docs/blueprint/BP-Product-Strategy.md`
- `docs/blueprint/BP-07-process-lifecycle.md`
- `docs/blueprint/BP-09-cli-split.md`
- `src/index.ts`
- `src/commands/connect.ts`
- `src/commands/init.ts`
- `src/commands/team-config.ts`
- `src/commands/schema.ts`
- `src/api/routes.ts`
- `.execution/blueprints.md`
- `.execution/program.md`

Return only:
1. findings ordered by severity
2. exact file paths plus BP sections
3. whether each item is code drift, doc drift, or explicit defer
4. which packet should own each fix if any
