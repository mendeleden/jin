You are `codex-WORKER-home-dynamic-layout`.

Work in `/Users/edenmendel/Documents/GitHub/jin-dynamic-layout`.

You are not alone in the codebase. There may be unrelated dirty or untracked
files. Do not revert, stage, or rewrite changes outside this packet.

Read in order:

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/context/W4-DESKTOP-09-bootstrap.md`
5. `docs/execution/tasks/W4-DESKTOP-09-home-dynamic-layout.md`
6. `.execution/program.md`
7. `.execution/blueprints.md`
8. `.execution/packets/W4-DESKTOP-09.md`
9. `docs/plans/2026-05-23-desktop-dynamic-layouts.md`
10. Current code named by the packet.

Then execute the packet exactly.

Current state:

- Dynamic layout commits already exist through `22e2af7`.
- Your next job is to continue from that state, run visual/static validation if
  possible, and fix only packet-scoped review findings or clear defects.
- If no code change is required, update your heartbeat and return a completion
  report with validation evidence.

Owned files:

- `desktop/layout/**`
- `desktop/react-renderer.tsx`
- `desktop/views/home/**`
- `desktop/ui/button.tsx`
- `desktop/ui/primitives.tsx`
- `test/desktop-layout-engine.test.ts`
- `test/desktop-renderer.test.ts`
- `test/desktop-shell-service.test.ts`
- `docs/plans/2026-05-23-desktop-dynamic-layouts.md`
- `.execution/agents/codex-WORKER-home-dynamic-layout.md`

Forbidden files and frozen boundaries are listed in the packet. Do not edit
daemon, API, contract, bridge, shell-service, DB, routing, sink, lifecycle,
main/preload, or blueprint files.

Validation target:

- `bun run desktop:typecheck`
- `bun test test/desktop-layout-engine.test.ts test/desktop-renderer.test.ts test/desktop-shell-service.test.ts`
- `bun run desktop:build`
- `git diff --check`

Return the completion report in the exact format from
`docs/execution/00-global-rules.md`.
