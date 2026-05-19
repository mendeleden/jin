Work in `/Users/edenmendel/Documents/GitHub/jin`.

You are `codex-WORKER-desktop-routing-overflow`.

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

Then execute only this focused follow-up.

User screenshot feedback to implement:
- The Routing graph is structurally better, but text is leaking/clipping.
- The right sink card can extend beyond the graph viewport; in the screenshot,
  `earlywarning-postgres` is cut off on the right edge.
- The graph still feels too rigid. It needs a better structure: stable left
  project lane, stable center flow lane, stable right sink lane, and text that
  is constrained inside node cards.
- Long project remotes and long sink ids should render as compact labels in the
  graph, with full details available through the existing hover/focus detail
  pattern.

Implementation guidance:
- Prefer a layout fix over adding more ad hoc absolute offsets.
- Keep one visual node per sink.
- Keep project-to-sink legs fixed width; do not reintroduce weighted edge
  thickness.
- Keep `https://github.com/` trimmed from visible project labels.
- Make all long labels visually bounded with ellipsis or equivalent SVG text
  clipping, and expose full labels through hover/focus detail content.
- If the SVG needs a wider or better-scaled viewBox, adjust it deliberately so
  both left project cards and right sink cards are fully inside the viewport.
- Add/adjust renderer assertions covering a long sink id and long remote so the
  output includes bounded label affordances and does not rely on full raw labels
  as always-visible text.

Implementation boundaries:
- Edit only `desktop/graph-components.tsx`, `desktop/styles.css`, and
  `test/desktop-renderer.test.ts`.
- Do not edit `src/api/**`, `src/contracts/**`, routing semantics, sinks,
  pipeline, DB, commands, daemon, or adapters.
- Do not change route matching or sink selection behavior.
- Do not add packages.
- Do not change Home in this worker.

Validation target:
- `bun run desktop:typecheck`
- `bun test test/desktop-renderer.test.ts test/desktop-shell-service.test.ts test/desktop-home-route.test.ts`

Update `.execution/agents/codex-WORKER-desktop-routing-overflow.md` while
working.

Return the completion report in the exact format from
`docs/execution/00-global-rules.md`.
