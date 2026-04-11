Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-AUDIT-bp-product-cli-boundaries`.

This is a read-only audit. Do not edit files.

Read only:
- `.execution/program.md`
- `.execution/blueprints.md`
- `docs/blueprint/BP-Product-Strategy.md`
- `docs/blueprint/BP-07-process-lifecycle.md`
- `docs/blueprint/BP-09-cli-split.md`
- `src/index.ts`
- `src/commands/connect.ts`
- `src/commands/init.ts`
- `src/commands/team-config.ts`
- `src/commands/schema.ts`
- `src/api/routes.ts`

Audit goals:
- find blueprint drift in developer vs operator vs desktop/daemon boundaries
- identify command namespace drift or accidental boundary collapse
- distinguish code drift from doc drift from explicit compatibility defers

Return only:
1. findings ordered by severity
2. exact file paths + BP sections
3. classification: code drift, doc drift, or explicit defer
4. the smallest packet/follow-up that should own each real fix
