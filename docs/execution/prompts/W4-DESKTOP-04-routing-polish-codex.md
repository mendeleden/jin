Work in `/Users/edenmendel/Documents/GitHub/jin`.

You are `codex-WORKER-desktop-routing-polish`.

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

Then execute only this visual-polish follow-up.

User feedback to implement:
- The current Routing graph is moving in the right direction.
- Make project node/label widths consistent across all visible project rows.
- Trim `https://github.com/` from visible project labels. Prefer compact labels such as `mendeleden/jin.git` or `owner/repo.git`.
- Reduce inline information density in each project row. Do not show the full metric/adapters sentence directly under each visible project label.
- Move overloaded project details into a hover popup/tooltip on the project node/row. Include useful details there: full remote URL, routed/total conversations, token count, adapters, and sink targets.
- Preserve the current one-visual-node-per-configured-sink behavior.
- Preserve a fluid graph feel: project nodes aligned left, sink nodes aligned right, flows readable, no fixed clipped region.

Implementation boundaries:
- Edit only `desktop/graph-components.tsx`, `desktop/styles.css`, and focused Desktop renderer tests unless a typecheck proves a narrower adjacent Desktop file is required.
- Do not edit `src/api/**`, `src/contracts/**`, routing semantics, sinks, pipeline, DB, commands, daemon, or adapters.
- Do not change route matching or sink selection behavior.
- Do not add new packages.
- Do not convert this into a broad React migration. Keep the polish scoped.

Validation target:
- `bun run desktop:typecheck`
- `bun test test/desktop-renderer.test.ts test/desktop-shell-service.test.ts test/desktop-home-route.test.ts`

Update `.execution/agents/codex-WORKER-desktop-routing-polish.md` while working.

Return the completion report in the exact format from `docs/execution/00-global-rules.md`.
