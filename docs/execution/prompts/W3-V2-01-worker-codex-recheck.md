Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-WORKER-v2-final-steps-recheck`.

You are not alone in the shared canonical workspace. This is a narrow docs-only
correction. Do not edit product code and do not widen scope.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/tasks/W3-V2-01-final-steps-before-e2e.md`

Then read:
- `.execution/program.md`
- `.execution/packets/W3-V2-01.md`
- `.execution/reviews/2026-04-07-W3-V2-01-codex.md`
- `.execution/reviews/2026-04-07-W3-RUNTIME-01-codex-recheck.md`
- `docs/execution/audits/2026-04-07-W3-V2-01-final-steps.md`
- `.execution/agents/codex-WORKER-v2-final-steps.md`

Task:
Repair the docs-only blocker for `W3-V2-01` so the final-steps sequence starts
from the actual current state:
- `W3-RUNTIME-01` is already approved and committed in `45529f8`
- the checklist should no longer instruct a runtime re-review/commit loop

Write scope:
- `docs/execution/audits/2026-04-07-W3-V2-01-final-steps.md`
- `docs/execution/tasks/W3-V2-01-final-steps-before-e2e.md`
- `.execution/agents/codex-WORKER-v2-final-steps.md`

Required changes:
- replace stale wording that says `W3-RUNTIME-01` is still `review_ready`
- make the first gate the already-completed runtime approval/commit, then move
  directly to binary rebuild/install and persona E2E
- keep preview caveats explicit
- leave packet status changes to Codex/BRAIN; just set the worker heartbeat back
  to `review_ready` when done

Do not:
- edit `.execution/program.md`
- edit `.execution/packets/*.md`
- change product code

If useful, run only:
- `git rev-parse --short HEAD`
- `sed -n '1,220p' docs/execution/audits/2026-04-07-W3-V2-01-final-steps.md`

Return the completion report in the exact format from `docs/execution/00-global-rules.md`.
