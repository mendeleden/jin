Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-REVIEWER-live-config-cutover-blueprint`.

This is a review-only lane. Do not edit product code. You may write only:
- `.execution/reviews/2026-05-03-W3-BP-02-codex.md`
- `.execution/blueprints.md`

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/tasks/W3-BP-02-live-config-cutover-blueprint-hardening.md`

Then read the live control plane:
- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-BP-02.md`
- `.execution/reviews/2026-05-03-config-reload-push-worker-tooling-council.md`

Then read only the packet-owned docs:
- `docs/blueprint/BP-02-data-flow.md`
- `docs/blueprint/BP-06-sink-contract.md`
- `docs/blueprint/BP-07-process-lifecycle.md`
- `docs/blueprint/BP-08-routing-and-config.md`
- `docs/execution/audits/2026-05-03-W3-BP-02-live-config-cutover-cuj-matrix.md`
- `docs/solutions/2026-05-03-live-config-reload-needs-atomic-writes-and-coordinator-owned-apply.md`

Review goals:
- verify the generation lifecycle and stale-work retirement rules are explicit
- verify invalid config is fail-closed across daemon and service mode
- verify `_jin_push_state` acknowledgement semantics remain intact
- verify the status/diagnostic contract explains interruption, abandonment, and
  replay clearly enough for operators
- explicitly compare the updated docs against the five blocker themes from the
  prior tooling-council review
- confirm whether Codex can move `W3-BP-02` to `approved`

If useful, run only:
- `git diff --check -- docs/blueprint/BP-02-data-flow.md docs/blueprint/BP-06-sink-contract.md docs/blueprint/BP-07-process-lifecycle.md docs/blueprint/BP-08-routing-and-config.md docs/execution/audits/2026-05-03-W3-BP-02-live-config-cutover-cuj-matrix.md docs/execution/tasks/W3-BP-02-live-config-cutover-blueprint-hardening.md`

Write the review artifact at:
- `.execution/reviews/2026-05-03-W3-BP-02-codex.md`

Use this review structure:
- verdict
- scope of review
- blocking findings
- BP Acceptance Matrix verification
- V1 comparison
- aligned
- drift
- unowned spread
- progress
- Codex decisions needed

Important:
- findings first, ordered by severity
- if there are no blockers, say that explicitly
- update `.execution/blueprints.md`
- do not edit `.execution/program.md` or `.execution/packets/*.md`
