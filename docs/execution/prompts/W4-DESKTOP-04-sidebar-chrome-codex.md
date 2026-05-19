Work in `/Users/edenmendel/Documents/GitHub/jin`.

You are `codex-WORKER-desktop-sidebar-chrome`.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `.execution/program.md`
5. `.execution/packets/W4-DESKTOP-04.md`
6. `docs/execution/tasks/W4-DESKTOP-04-react-ui-foundation-and-routing-graphs.md`
7. Current code:
   - `desktop/renderer.ts`
   - `test/desktop-renderer.test.ts`

Then execute only this focused UI chrome follow-up.

User feedback to implement:
- In the left sidebar runtime card, remove the `Traces` metric.
- Keep `Cost` in that same sidebar runtime card, and make it the bottom/final
  metric row.
- In the Routing workspace, remove the duplicate section-level `Refresh` button.
  The shell/top-level toolbar already has a Refresh button and should remain.

Implementation guidance:
- This is a renderer chrome cleanup, not a daemon/API change.
- Do not remove the Home-page `Traces` summary metric unless an existing test
  proves that surface is the sidebar runtime card. The requested removal is the
  left/sidebar runtime component.
- Make tests precise enough to distinguish sidebar runtime metrics from Home or
  routing content.
- Prefer deleting the duplicate Routing refresh markup over hiding it with CSS.

Implementation boundaries:
- Edit only `desktop/renderer.ts` and `test/desktop-renderer.test.ts`.
- Do not edit `desktop/graph-components.tsx`; another worker owns Routing graph
  overflow.
- Do not edit `src/api/**`, `src/contracts/**`, routing semantics, sinks,
  pipeline, DB, commands, daemon, or adapters.
- Do not add packages.

Validation target:
- `bun run desktop:typecheck`
- `bun test test/desktop-renderer.test.ts test/desktop-shell-service.test.ts test/desktop-home-route.test.ts`

Update `.execution/agents/codex-WORKER-desktop-sidebar-chrome.md` while
working.

Return the completion report in the exact format from
`docs/execution/00-global-rules.md`.
