Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-AUDIT-bp-adapters-sinks`.

This is a read-only audit. Do not edit files.

Read only:
- `.execution/blueprints.md`
- `docs/blueprint/BP-04-adapter-contract.md`
- `docs/blueprint/BP-06-sink-contract.md`
- `src/adapters/types.ts`
- `src/adapters/claude-code.ts`
- `src/adapters/codex.ts`
- `src/adapters/cursor.ts`
- `src/sinks/webhook.ts`
- `src/sinks/postgres.ts`
- `src/sinks/s3.ts`

Audit goals:
- find remaining blueprint drift in adapter legacy bridges and sink compatibility layers
- separate live contract drift from explicitly deferred compatibility shims

Return only:
1. findings ordered by severity
2. exact file paths + BP sections
3. classification: code drift, doc drift, or explicit defer
4. the smallest packet/follow-up that should own each real fix
