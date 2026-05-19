Work in `/Users/edenmendel/Documents/GitHub/jin`.

You are `codex-REVIEWER-desktop-ui-architecture`.

Review only. Do not edit product code.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `.execution/program.md`
5. `.execution/packets/W4-DESKTOP-04.md`
6. `docs/execution/tasks/W4-DESKTOP-04-react-ui-foundation-and-routing-graphs.md`
7. `docs/blueprint/BP-07-process-lifecycle.md`
8. `docs/blueprint/BP-08-routing-and-config.md`
9. `docs/blueprint/BP-Product-Strategy.md`
10. `docs/blueprint/BP-11-desktop-daemon-boundary.md`
11. `docs/jin-desktop-prd.md`

Focus:
- Evaluate the approved package cut: Radix primitives, `lucide-react`,
  Recharts, `@xyflow/react`, `d3-shape`, `d3-sankey`.
- Verify whether this package direction fits BP-11 and the Desktop PRD.
- Identify one-way-door risks, dependency risks, bundle/build risks, or places
  the implementation worker must not cross.
- Confirm that no daemon/runtime/routing semantics need to change for Home and
  Routing graphs.

Write findings first, ordered by severity. Keep it concrete and actionable.

Write the review artifact to:
- `.execution/reviews/2026-05-16-W4-DESKTOP-04-architecture-codex.md`

Return a short completion report with the artifact path.
