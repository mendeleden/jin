Work in `/Users/edenmendel/Documents/GitHub/jin`.

You are `codex-WORKER-desktop-full-react-cutover`.

Read in order:

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `.execution/program.md`
5. `.execution/packets/W4-DESKTOP-06.md`
6. `docs/execution/tasks/W4-DESKTOP-06-full-react-cutover-and-home-observatory.md`

Then execute the packet exactly.

Only read the BP docs and code files named in the packet. Only edit the owned
files named in the packet.

Control plane:

- Create/update `.execution/agents/codex-WORKER-desktop-full-react-cutover.md`.
- Keep heartbeat/current focus updated while working.
- Do not edit `.execution/program.md`, `.execution/packets/**`, or
  `.execution/reviews/**`.

Required outcome:

- Finish the Desktop React cutover by removing the remaining legacy HTML adapter
  from source.
- Implement React-native Conversations, Logs, and Settings workspaces.
- Fix Home Token & Cost Observatory so the main Home page has a populated
  stacked graph and does not show empty/unpopulated middle panels when aggregate
  data exists.
- Fix the sidebar `Cost (estimated)` `(i)` interaction. The popup must work on
  hover/focus in the Electron UI. Prefer Radix `Tooltip.Portal` or equivalent so
  the content is not clipped by the sidebar runtime panel overflow. Do not
  replace it with always-visible inline explanatory text.
- Preserve daemon boundary contracts. Do not edit `src/api/**`,
  `src/contracts/**`, `src/db/**`, `src/pipeline/**`, `src/commands/**`, or
  package manifests.

Validation:

- `bun run desktop:typecheck`
- `bun test test/desktop-renderer.test.ts test/desktop-shell-service.test.ts test/desktop-home-route.test.ts`
- `bun run desktop:build`
- `rg -n "dangerouslySetInnerHTML|data-legacy-html-view|LegacyHtmlView" desktop --glob '!dist/**'`
- `rg -n "legacy-entry|mountDesktopRenderer" desktop scripts test --glob '!dist/**'`

Stop and return `needs_codex` if:

- you need to change daemon API/contract payloads
- a frozen BP contract must change
- the owned file list is insufficient
- a test requires deleting coverage instead of migrating it

Return the completion report in the exact format from
`docs/execution/00-global-rules.md`.
