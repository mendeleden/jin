Work in `/Users/edenmendel/Documents/GitHub/jin`.

You are `codex-WORKER-desktop-routing-fixed-edges`.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `.execution/program.md`
5. `.execution/packets/W4-DESKTOP-04.md`
6. `docs/execution/tasks/W4-DESKTOP-04-react-ui-foundation-and-routing-graphs.md`
7. Current code:
   - `desktop/graph-components.tsx`
   - `desktop/styles.css`
   - `test/desktop-renderer.test.ts`

Then execute only this tiny follow-up.

User feedback to implement:
- The Routing graph is visually better, but the legs from project nodes to the sink should not have different widths.
- They are currently weighted by routed conversation count. Remove that weighting.
- Make every project-to-sink leg fixed width.
- Keep muted/unrouted edges visually distinct by color/dash/opacity, not by variable width.
- Update the legend so it no longer says thickness is routed conversations.
- Add/adjust a renderer assertion so Routing output does not emit multiple stroke widths for project-to-sink flow paths.

Implementation boundaries:
- Edit only `desktop/graph-components.tsx`, `desktop/styles.css`, and `test/desktop-renderer.test.ts`.
- Do not edit `src/api/**`, `src/contracts/**`, routing semantics, sinks, pipeline, DB, commands, daemon, or adapters.
- Do not change route matching or sink selection behavior.
- Do not add packages.
- Do not change Home in this worker.

Validation target:
- `bun run desktop:typecheck`
- `bun test test/desktop-renderer.test.ts test/desktop-shell-service.test.ts test/desktop-home-route.test.ts`

Update `.execution/agents/codex-WORKER-desktop-routing-fixed-edges.md` while working.

Return the completion report in the exact format from `docs/execution/00-global-rules.md`.
