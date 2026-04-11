Read-only BP drift audit. Do not edit any files.

Scope only:
- BP-04
- BP-06
- adapter/sink drift

Focus on:
- contract alignment
- remaining legacy bridge surfaces
- mismatches between current adapter/sink behavior and blueprint expectations that matter for release

Read minimally but enough to answer:
- `docs/blueprint/BP-04-adapter-contract.md`
- `docs/blueprint/BP-06-sink-contract.md`
- `src/adapters/types.ts`
- `src/adapters/registry.ts`
- `src/sinks/postgres.ts`
- `src/sinks/s3.ts`
- `src/sinks/webhook.ts`
- `src/sinks/types.ts`
- `.execution/blueprints.md`

Return only:
1. findings ordered by severity
2. exact file paths plus BP sections
3. whether each item is code drift, doc drift, or explicit defer
4. whether any item should block an experimental v2 preview
