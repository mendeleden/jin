Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-REVIEWER-export-user-identity`.

This is a review-only lane. Do not edit product code. You may write only:

- `.execution/reviews/2026-04-28-W3-TEAM-02-codex.md`
- `.execution/blueprints.md`

Read in order:

1. `docs/execution/00-global-rules.md`
2. `docs/execution/tasks/W3-TEAM-02-canonical-export-user-identity.md`
3. `docs/proposals/canonical-export-user-identity.md`
4. `docs/blueprint/BP-06-sink-contract.md`
5. `docs/blueprint/BP-08-routing-and-config.md`
6. `docs/blueprint/BP-09-cli-split.md`
7. `docs/ontology.md`

Review goals:

- verify the amended BP/doc set now coherently allows sink-scoped `userId`
- verify `userId` is clearly defined as export metadata rather than
  conversation payload identity
- verify the hard-cut legacy purge direction is coherent
- find any remaining contradictions around:
  - Postgres `team_id` / `user_id`
  - webhook export headers
  - S3 `_meta`
  - `jin team bridge` / `jin connect --team`
- state whether implementation should proceed, and if not, what specific
  doc contradictions remain

If useful, cite exact lines/files. Findings first, ordered by severity.

Write the review artifact at:

- `.execution/reviews/2026-04-28-W3-TEAM-02-codex.md`
