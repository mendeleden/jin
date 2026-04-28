# W3-TEAM-02: Canonical Export User Identity

## Role

Codex review packet.

## Goal

Review the source-of-truth amendment for canonical sink-scoped `userId`
export identity before implementation resumes.

This packet is doc-first. It is not an implementation packet.

## Problem

External systems need per-user analytics on exported conversations.
The first concrete customer is the Jin Team Postgres path.

Current BP/docs were identity-free for generic sinks and explicitly said Jin
does not set remote Postgres identity columns. The repo also contains drift:

- legacy `developerId` / `developer_id` naming
- stale `jin_sessions`-shaped read/test assumptions
- partial sink/export identity behavior without BP approval

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/proposals/canonical-export-user-identity.md`
3. `docs/blueprint/BP-06-sink-contract.md`
4. `docs/blueprint/BP-08-routing-and-config.md`
5. `docs/blueprint/BP-09-cli-split.md`
6. `docs/ontology.md`

## Review Questions

1. Do the amended blueprints now coherently allow sink-scoped `userId`?
2. Is the boundary clear that `userId` is export metadata, not conversation
   payload identity?
3. Is the hard-cut legacy purge direction coherent?
4. Are there remaining BP contradictions around Postgres, webhook, or S3
   identity projection?
5. Is the Postgres-first rollout described precisely enough to unblock
   implementation?

## Deliverable

- a review artifact identifying:
  - blocking BP/doc contradictions
  - unresolved scope drift
  - whether the doc set is ready for implementation

## Non-Goals

- editing product code
- changing runtime behavior
- writing migrations

