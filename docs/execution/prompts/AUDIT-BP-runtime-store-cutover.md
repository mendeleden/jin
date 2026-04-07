Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-AUDIT-bp-runtime-store-cutover`.

This is a read-only audit. Do not edit files.

Read only:
- `.execution/program.md`
- `.execution/blueprints.md`
- `docs/blueprint/BP-02-data-flow.md`
- `docs/blueprint/BP-05-store-and-migration.md`
- `src/commands/watch.ts`
- `src/commands/start.ts`
- `src/store.ts`
- `src/db/store.ts`
- `src/pipeline/loop.ts`
- `src/pipeline/watcher.ts`
- `src/pipeline/file-watcher.ts`

Audit goals:
- determine whether the live runtime path actually matches the v2 pipeline/store design
- identify remaining v1 bridge dependencies in the production runtime path
- distinguish architectural blocker from acceptable defer

Return only:
1. findings ordered by severity
2. exact file paths + BP sections
3. classification: code drift, doc drift, or explicit defer
4. the smallest packet/follow-up that should own each real fix
