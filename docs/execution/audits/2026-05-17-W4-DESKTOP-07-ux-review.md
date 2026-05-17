# W4-DESKTOP-07 UX Review

Reviewed screenshots:

- `docs/execution/artifacts/W4-DESKTOP-07/home-iteration-2.png`
- `docs/execution/artifacts/W4-DESKTOP-07/conversations-iteration-2.png`

Two UX/UI reviewer lanes converged on these findings:

- P1: Conversations rows/header/metadata were too bulky and had visible
  overflow/clipping risk.
- P1: Home lower content felt clipped because heavyweight KPI/chart cards and
  unfinished collapsed Stats bars dominated the first viewport.
- P2: Mission Control needed shorter project labels and less decorative noise.
- P2: Conversations detail, timeline, and inspector panels needed tighter
  hierarchy and less repeated metadata.
- P3: Typography, status pills, shadows, and nested rounded cards needed more
  restraint to match the Stripe/Linear/Apple-luxury direction.

Folded changes in the committed iteration:

- Removed Home collapsed Stats bars from the primary dashboard.
- Slimmed Home metric cards, top controls, graph/chart panels, and chart
  heights.
- Shortened GitHub/project labels for Home graph and project lists.
- Normalized long conversation titles for display while preserving full values
  in tooltips.
- Reduced Conversations row metadata and fixed the row clipping regression.
- Hid low-value timeline metadata when turns are negative or models are absent.
- Converted inspector sections toward compact property rows with thin
  separators.

Current visual checkpoint:

- `docs/execution/artifacts/W4-DESKTOP-07/home-iteration-4.png`
- `docs/execution/artifacts/W4-DESKTOP-07/conversations-iteration-4.png`

Validation:

- `bun run desktop:typecheck`
- `bun test test/desktop-renderer.test.ts test/desktop-shell-service.test.ts test/desktop-home-route.test.ts`
- `bun run desktop:build`

Residual risk: this is a saved visual iteration, not the final design system.
Home still has dashboard bones, and Conversations still needs deeper transcript
semantics for user/assistant/tool/cost events.
