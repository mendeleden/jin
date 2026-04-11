Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-WORKER-experimental-reset-install-doc`.

You are executing the docs-only packet `W3-DOCS-01`.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/tasks/W3-DOCS-01-experimental-reset-install-runbook.md`

Then execute the packet exactly.

Read:
- `.execution/program.md`
- `.execution/blueprints.md`
- `docs/blueprint/BP-05-store-and-migration.md`
- `docs/blueprint/BP-07-process-lifecycle.md`
- `docs/blueprint/BP-09-cli-split.md`
- `package.json`
- `src/db/schema.ts`
- `src/index.ts`
- `src/commands/schema.ts`
- `src/commands/connect.ts`
- `src/commands/start.ts`

Write only:
- `docs/execution/experimental-v2-reset-and-install.md`

Requirements:
- assume experimental v2, not GA migration guarantees
- give exact shell commands we can paste into chat
- include soft reset vs hard reset
- include rebuild/install steps for the local binary
- include the basic `jin team schema ...` / `jin team bridge` / `jin connect --team=...` path
- do not invent a `jin reset-local` command
- do not write scripts; document the commands and note that a script can come later if needed

Return the completion report in the format required by `00-global-rules.md`.
