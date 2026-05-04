Review only. Do not implement changes.

Work in `/home/edmininode/here-we-code/jin`.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/tasks/W3-ADAPTER-13-codex-go-worker-parity.md`
5. `.execution/program.md`
6. `.execution/packets/W3-ADAPTER-13.md`

Then review the packet / PRD and any worker diff for:
- frozen-contract discipline
- Codex-only scope discipline
- TDD completeness across unit, worker streaming, persisted-result, hash, and
  end-to-end validation
- BP Acceptance Matrix completeness
- V1 comparison completeness against the current TS Codex worker path

BP docs in scope:
- `docs/blueprint/BP-02-data-flow.md`
- `docs/blueprint/BP-03-conversation-model.md`
- `docs/blueprint/BP-04-adapter-contract.md`
- `docs/blueprint/BP-05-store-and-migration.md`
- `docs/blueprint/BP-10-performance-validation.md`

Required review output:
- findings first, ordered by severity
- verify every BP Acceptance Matrix row against code/tests or mark the gap
- verify the V1 comparison is explicit
- verify the packet references current blueprint filenames and the required
  `docs/execution/audits/` validation artifact before reviewing implementation claims
- call out any place where parity is claimed without a verifiable test or hash
  proof

Write the review artifact under:
- `.execution/reviews/<date>-W3-ADAPTER-13-codex.md`

If there are no findings, say that explicitly and note any residual validation
gaps.
