Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-AUDIT-bp-config-startup-api`.

This is a read-only audit. Do not edit files.

Read only:
- `.execution/blueprints.md`
- `docs/blueprint/BP-07-process-lifecycle.md`
- `docs/blueprint/BP-08-routing-and-config.md`
- `src/config.ts`
- `src/commands/start.ts`
- `src/commands/watch.ts`
- `src/commands/init.ts`
- `src/commands/status.ts`
- `src/api/routes.ts`

Audit goals:
- find blueprint drift in config lifecycle, startup behavior, read surfaces, and API compatibility shims
- identify anything that still violates the approved startup/privacy and config semantics

Return only:
1. findings ordered by severity
2. exact file paths + BP sections
3. classification: code drift, doc drift, or explicit defer
4. the smallest packet/follow-up that should own each real fix
