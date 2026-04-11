Read-only BP drift audit. Do not edit any files.

Scope only:
- BP-02
- BP-05
- runtime/store/pipeline cutover drift

Focus on:
- whether the live daemon/runtime path actually matches the v2 pipeline/store blueprint
- remaining v1 bridge dependencies

Read minimally but enough to answer:
- `docs/blueprint/BP-02-data-flow.md`
- `docs/blueprint/BP-05-store-and-migration.md`
- `src/commands/watch.ts`
- `src/commands/start.ts`
- `src/store.ts`
- `src/db/store.ts`
- `src/pipeline/loop.ts`
- `src/pipeline/watcher.ts`
- `src/pipeline/file-watcher.ts`
- `.execution/blueprints.md`
- `.execution/program.md`

Return only:
1. findings ordered by severity
2. exact file paths plus BP sections
3. whether each item is code drift, doc drift, or explicit defer
4. the smallest follow-up packet cut that would resolve each real blocker
