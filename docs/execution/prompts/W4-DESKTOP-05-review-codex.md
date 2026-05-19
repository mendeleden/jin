Work in `/Users/edenmendel/Documents/GitHub/jin`.

You are `codex-REVIEWER-desktop-react-cutover`.

Review only. Do not edit files.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `.execution/program.md`
5. `.execution/packets/W4-DESKTOP-05.md`
6. `docs/execution/tasks/W4-DESKTOP-05-react-component-cutover.md`
7. `docs/blueprint/BP-07-process-lifecycle.md`
8. `docs/blueprint/BP-08-routing-and-config.md`
9. `docs/blueprint/BP-Product-Strategy.md`
10. `docs/blueprint/BP-11-desktop-daemon-boundary.md`
11. Current diff for Desktop files and tests.

Review scope:
- Verify the Desktop shell, sidebar, Home, and Routing are actually React
  components and not just string-template output moved around.
- Verify Home mission-control graph and Routing project-to-sink graph render in
  the React path.
- Verify any legacy HTML path is explicit and narrow.
- Verify no daemon API, contract, sink, routing, pipeline, DB, command, adapter,
  release, or blueprint files changed.
- Verify W4-DESKTOP-04 behavior remains intact: fixed Routing edges, bounded
  labels, trimmed GitHub labels, no sidebar `Traces`, `Cost` final, no duplicate
  Routing refresh.
- Verify sidebar Cost is not compacted/truncated, is labeled estimated, and has
  info/help text clarifying it is API-pricing-derived and not subscription usage
  or billing-plan spend. This must be an actual tooltip/popover-style
  interaction, not always-visible inline explanatory copy.
- Verify Routing local-only projects say `local only`, do not say `unrouted`,
  and do not draw dashed placeholder route legs.
- Verify the sidebar no longer renders `Next surfaces`, `Search`, `Projects`,
  or `Health` placeholder content.
- Verify tests are meaningful and validation results are credible.

Write findings first, ordered by severity, to:
- `.execution/reviews/2026-05-16-W4-DESKTOP-05-codex.md`

Use the review style from `docs/execution/00-global-rules.md`.
