---
title: "Canonical Export User Identity for Generic Sinks"
status: proposed
created: 2026-04-28
relates-to: [BP-06, BP-08, BP-09, BP-Product-Strategy]
---

# Canonical Export User Identity for Generic Sinks

## Summary

External systems want to run analytics on conversations by user.

Today Jin does not provide a coherent, source-of-truth way to do that.
The first concrete customer is the Jin Team path that writes to Postgres,
but the requirement is broader than one sink:

- webhook receivers want per-user attribution
- object sinks may want per-user metadata for offline analysis
- future managed/team products will want a stable notion of who exported
  a conversation

This proposal recommends:

1. introduce canonical `userId` as **export identity**
2. make it available to **all generic sinks**
3. keep the canonical push payload unchanged
4. project `userId` into each sink's transport/storage shape
5. update `jin team schema` so the Postgres integration can store it
6. remove legacy sink/export identity references (`developerId`,
   `developer_id`) from canonical code paths and tests

The important constraint is that this must start at the blueprint layer.
Current BP-06/BP-08 semantics do not allow this cleanly.

## Business Need

The business need is simple:

> external systems need to run analytics on conversations per user

For the first customer:

- the external system is tightly coupled to Jin Team
- the current destination is Postgres
- analytics need a stable per-user attribute on exported conversations

Without that field:

- per-user dashboards are impossible or heuristic
- attribution has to be reconstructed out-of-band
- sink consumers cannot safely distinguish one developer's exports from
  another developer's exports

## Current State

Current source-of-truth contracts are identity-free:

- BP-06 keeps the generic sink push payload to:
  - `attemptedRevision`
  - `conversation`
  - `messages`
  - `toolCalls`
- BP-08 keeps generic sink config transport-shaped
- BP-06 currently says Postgres `team_id` / `developer_id` are
  schema-owner populated and Jin does not set them

At the same time, the codebase already contains drift:

- legacy sink shims still mention `developerId`
- webhook can emit `X-Jin-Developer`
- Postgres search/tests still refer to `developer_id`
- some tests and harnesses still assume legacy `jin_sessions`

So we have two problems:

1. no approved canonical identity model
2. existing partial identity plumbing is inconsistent

## Definition

This proposal introduces one new concept:

- **`userId`** = the export-side user identity for a Jin runtime

This is **not**:

- message author identity
- workspace membership object
- auth principal
- a guaranteed real-world legal name or email

It is the identity attached to exported conversations so remote systems
can attribute those exports to a user.

In other words:

- `userId` is **publisher/export identity**
- not **conversation content identity**

## Design Goals

- support per-user analytics for exported conversations
- keep the BP-06 snapshot payload stable if possible
- make identity available across generic sinks, not just Postgres
- avoid competing names (`developerId`, `userId`, `authorId`)
- remove legacy sink/export drift instead of preserving it indefinitely
- keep Jin Team/Postgres as the first fully implemented path

## Non-Goals

- do not solve workspace membership/auth in this proposal
- do not derive per-message human identity
- do not introduce automatic identity discovery from OS usernames
- do not decide obfuscation/hashing policy for all deployments
- do not expand local conversation storage to persist a user dimension

## Options Considered

### Option A: Keep Generic Sinks Identity-Free; Solve It Only in Jin Team

Description:

- leave BP-06/BP-08 unchanged
- solve per-user analytics only inside Jin Team / Postgres deployment logic
- keep generic sinks ignorant of user identity

Pros:

- minimal contract churn
- matches current BP language closely
- smallest immediate implementation surface

Cons:

- does not satisfy the broader requirement that all sinks may need
  per-user attribution
- hard-codes the first customer's architecture into product semantics
- leaves webhook and S3 paths without a coherent story
- preserves existing drift instead of resolving it

Verdict:

- reject

This is too narrow and turns a real product requirement into a
Jin-Team-only exception.

### Option B: Put `userId` into the Canonical Push Payload

Description:

- extend `PushPayload` with user identity
- potentially also extend the canonical conversation/export model

Pros:

- gives every sink the same identity in the same place
- strongest long-term normalization story

Cons:

- bigger contract change than we need
- risks conflating export identity with conversation model identity
- forces all sinks and tests to absorb payload churn
- raises the question of whether local store should persist user identity too

Verdict:

- reject for now

This is the right choice only if we later need per-conversation dynamic
identity, which we do not currently require.

### Option C: Add Canonical `userId` to Generic Sink Config and Project It Per Sink

Description:

- add optional `userId` to generic sink config
- keep the push payload unchanged
- each sink projects the configured value into its remote shape
- keep `teamId` sink-scoped for multi-tenant remotes

Pros:

- satisfies the business need now
- works across Postgres, webhook, and S3
- preserves the BP-06 snapshot payload shape
- keeps identity as export/integration metadata rather than conversation data
- allows sink-specific overrides where remote tenancy differs

Cons:

- requires BP-06/BP-08 amendments
- keeps identity in config rather than payload
- does not address future workspace membership semantics by itself

Verdict:

- recommend

This is the smallest coherent change that solves the actual business need.

## Recommendation

Adopt **Option C**.

### Canonical meaning

- canonical name: `userId`
- canonical behavior: sinks project `userId`

### Scope

- `userId` is an optional generic sink field
- `teamId` remains an optional sink field for remote multi-tenancy
- push payload stays unchanged

### Compatibility

This proposal intentionally does **not** preserve `developerId` as a
first-class compatibility alias in canonical code paths.

The rule is:

- migrate live paths that still carry value
- delete dead legacy paths and tests
- do not institutionalize dual naming in the final contract

## Why `userId` and Not `developerId`

`developerId` bakes in an implementation-era assumption about the actor.

The actual requirement is broader:

- a person
- or a pseudonymous stable export identity
- or a workspace-assigned analytics identity

`userId` is the better long-term product term.

## First Order of Business: Legacy Purge

Before or alongside implementation, remove legacy sink/export identity
references that no longer serve the v2 model.

This applies to:

- `developerId` / `developer_id` naming
- legacy Postgres `jin_sessions`-shaped verification where the live v2
  path is `jin_conversations`
- legacy sink/export tests that only validate dead code paths

Rules:

1. If a test still validates a live v2 path, migrate it to `userId`.
2. If a test only protects a dead legacy path, delete it.
3. Do not keep compatibility branches merely to satisfy stale tests.

Important nuance:

- this purge applies to **sink/export** identity surfaces
- it does **not** mean blindly deleting all `session_id` references across
  the repo, because some adapters legitimately parse source records that
  still use that field name

## BP Cascade

This proposal requires explicit amendments to the following blueprints.

### BP-06: Sink Contract

Amendments:

1. keep `PushPayload` unchanged
2. allow generic sinks to be configured with optional export identity
3. define sink projection rules:
   - Postgres:
     - may write `team_id`
     - should write canonical `user_id`
   - Webhook:
      - may emit `X-Jin-Team`
      - should emit `X-Jin-User`
   - S3:
      - may include `_meta.teamId`
      - should include `_meta.userId`

This also means BP-06 must stop saying Jin never sets these columns when
configured to do so.

### BP-08: Routing & Configuration

Amendments:

1. extend `SinkConfigBase` with:
   - `teamId?: string`
   - `userId?: string`
2. keep them optional
3. explicitly define them as export/integration metadata, not routing fields

This keeps config-scoped identity at the sink boundary, which is the
lowest-risk place to add it.

### BP-09: CLI Split

Amendments:

1. `jin sink add` gains `--team-id` and `--user-id`
2. `jin team bridge` gains `--team-id` and `--user-id`
3. `jin connect --team=<code>` must preserve those values when creating
   a sink
4. `jin team schema apply` becomes responsible for the identity-column
   migration story for the generic Postgres integration

### Ontology

Amendments:

1. make `user_id` canonical in the Postgres integration schema docs
2. remove `developer_id` from canonical sink/export docs
3. describe webhook/S3 identity projection as sink metadata, not
   conversation model fields

## Postgres Schema Plan

The first complete customer path is Postgres.

### Canonical schema

Identity remains conversation-scoped only:

- `team_id TEXT`
- `user_id TEXT`

No identity columns are needed on:

- `jin_messages`
- `jin_tool_calls`

### Migration behavior

`jin team schema apply` must:

1. `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
   - `team_id`
   - `user_id`
2. set the new schema version only after the table shape is actually valid

### Validation behavior

`jin team schema check` and Postgres sink `healthCheck()` must verify:

- schema version
- tool-call PK shape
- presence of identity columns

Version string alone is not enough.

### Reader compatibility

Remote query/search/verification surfaces should read canonical `user_id`.
Any read path that still assumes `developer_id` is part of the legacy purge.

## Rollout

### Phase 1: Blueprint and contract approval

- approve BP-06/BP-08/BP-09/ontology amendments
- explicitly bless `userId` as canonical export identity

### Phase 2: Postgres-first implementation

- add config support
- preserve values through `team bridge` and `connect`
- update `jin team schema`
- update health checks

### Phase 3: Other generic sinks

- webhook headers
- S3 `_meta`
- test/perf harness alignment

### Phase 4: Cleanup

- remove remaining `developerId` / `developer_id` sink-export references
- delete dead legacy tests and docs

## Risks

### Risk: contract sprawl

Adding identity to generic sink config may be seen as reintroducing
workspace/product concerns into BP-08.

Mitigation:

- define `userId` strictly as export metadata
- keep workspace membership/auth out of scope
- keep push payload unchanged

### Risk: ambiguous meaning of user

Consumers may assume `userId` is the human author of every message.

Mitigation:

- define it explicitly as export identity
- document that it belongs to the runtime/export boundary

### Risk: migration drift

Search/test/perf harness surfaces are already split between
`jin_sessions` and `jin_conversations`.

Mitigation:

- align the Postgres read/test tooling to the v2 table family as part of
  the same lane

### Risk: hard cut breaks stale consumers

Removing `developerId` and legacy table assumptions without a compatibility
window will break stale tests, harnesses, and any external consumer still
bound to the old shape.

Mitigation:

- treat those consumers as explicit migration work
- migrate or delete them in the same lane
- do not pretend compatibility exists when the source of truth no longer
  wants it

## Rejected Add-Ons for This Proposal

These are valid future discussions, but not part of this change:

- automatic OS-derived identity
- generated pseudonymous IDs by default
- top-level global `identity` config
- authenticated workspace membership model
- per-conversation or per-message dynamic user attribution

## Council Questions

1. Is `userId` accepted as the canonical export identity term?
2. Is sink-scoped identity the right first implementation boundary?
3. Is the council comfortable with a hard cut to `userId` on generic
   sink/export surfaces rather than a long-lived alias?
4. Should Jin set Postgres identity columns when configured, rather than
   treating them as schema-owner-only enrichment?

## Recommendation to Council

Approve the BP amendments for **sink-scoped canonical `userId`** and
Postgres-first schema support.

Do not change the canonical push payload in this lane.

That gives us:

- a coherent answer to the real business need
- a clean first customer path for Jin Team + Postgres
- a smaller contract change than expanding the conversation or payload
  model
