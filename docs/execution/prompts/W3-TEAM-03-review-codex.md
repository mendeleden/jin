Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-REVIEWER-export-user-id-implementation`.

This is a review-only lane. Do not edit product code. You may write only:

- `.execution/reviews/2026-04-28-W3-TEAM-03-codex.md`
- `.execution/blueprints.md`

Read in order:

1. `docs/execution/00-global-rules.md`
2. `docs/execution/tasks/W3-TEAM-03-canonical-export-user-id-implementation.md`
3. `docs/proposals/canonical-export-user-identity.md`
4. `docs/blueprint/BP-06-sink-contract.md`
5. `docs/blueprint/BP-08-routing-and-config.md`
6. `docs/blueprint/BP-09-cli-split.md`
7. `docs/ontology.md`

Then review only the implementation files touched by the packet.

Review goals:

- verify the hard cut really removed live sink/export `developerId` / `developer_id`
- verify `userId` stays sink-scoped export metadata and does not leak into payload identity
- verify Postgres uses canonical `jin_*` + `user_id`
- verify webhook/S3 projection names match the approved BP
- verify good legacy tests were migrated and dead legacy sink/export tests were removed

Findings first, ordered by severity. Cite exact files/lines when useful.

Write the review artifact at:

- `.execution/reviews/2026-04-28-W3-TEAM-03-codex.md`
