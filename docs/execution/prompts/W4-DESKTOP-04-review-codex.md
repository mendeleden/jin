Work in `/Users/edenmendel/Documents/GitHub/jin`.

You are `codex-REVIEWER-desktop-ui-foundation`.

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

Review scope:
- Desktop renderer and React foundation changes
- typed Desktop daemon IPC/contracts
- Home graph and Routing graph behavior
- focused Desktop tests

Primary questions:
- Does the change restore compile/test health?
- Does it keep Desktop behind typed daemon IPC?
- Does Routing visualize existing semantics without changing route behavior?
- Does the UI/library direction reduce hand-authored CSS/string-template sprawl,
  or does it add another inconsistent layer?
- Are any dependencies justified and bounded?
- Are BP Acceptance Matrix and V1 Comparison complete?

Write findings first, ordered by severity, with file/line references.

Write the review artifact to:
- `.execution/reviews/2026-05-16-W4-DESKTOP-04-codex.md`

Also update `.execution/blueprints.md` only if you find BP drift.
