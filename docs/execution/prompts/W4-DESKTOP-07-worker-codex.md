Work in `/Users/edenmendel/Documents/GitHub/jin`.

You are `codex-WORKER-desktop-skinny-ui`.

Read in order:

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `.execution/program.md`
5. `.execution/packets/W4-DESKTOP-07.md`
6. `docs/execution/tasks/W4-DESKTOP-07-skinny-luxury-ui-overhaul.md`

Then execute the packet exactly.

Only read the BP docs and code files named in the packet. Only edit the owned
files named in the packet.

Control plane:

- Create/update `.execution/agents/codex-WORKER-desktop-skinny-ui.md`.
- Keep heartbeat/current focus updated while working.
- Do not edit `.execution/program.md`, `.execution/packets/**`, or
  `.execution/reviews/**`.

Required outcome:

- Overhaul Home and Conversations toward a skinny, high-density, premium
  Stripe/Linear/Apple-style Desktop UI.
- Keep implementation in React components and CSS; do not reintroduce legacy
  HTML.
- Preserve all typed daemon IPC/view-model contracts.
- Save screenshots under `docs/execution/artifacts/W4-DESKTOP-07/`.

Validation:

- `bun run desktop:typecheck`
- `bun test test/desktop-renderer.test.ts test/desktop-shell-service.test.ts test/desktop-home-route.test.ts`
- `bun run desktop:build`

Stop and return `needs_codex` if:

- you need daemon API/contract payload changes
- you need package manifest/lockfile changes
- a frozen BP contract must change
- the owned file list is insufficient

Return the completion report in the exact format from
`docs/execution/00-global-rules.md`.
