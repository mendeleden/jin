Work in `/Users/edenmendel/Documents/GitHub/jin`.

You are `codex-REVIEWER-desktop-ui-visual`.

Review only. Do not edit product code.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `.execution/packets/W4-DESKTOP-04.md`
5. `docs/execution/tasks/W4-DESKTOP-04-react-ui-foundation-and-routing-graphs.md`
6. `docs/jin-desktop-prd.md`
7. current Desktop UI files:
   - `desktop/renderer.ts`
   - `desktop/react-renderer.tsx`
   - `desktop/styles.css`

If screenshots are present under `ed-screenshot-for-jin-desktop/`, inspect the
latest ones as visual input. Do not modify them.

Focus:
- Give the implementation worker a concrete visual target for Home and Routing
  using the approved package cut.
- Call out what should become component primitives now versus what should stay
  plain CSS for the first cut.
- Explain how to avoid the current bulky card/fixed-height feel.
- Explain how to make the graph surfaces feel fluid without overbuilding.

Write findings first, ordered by visual/product impact.

Write the review artifact to:
- `.execution/reviews/2026-05-16-W4-DESKTOP-04-visual-codex.md`

Return a short completion report with the artifact path.
