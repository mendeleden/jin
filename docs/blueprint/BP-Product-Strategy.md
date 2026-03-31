---
title: "BP: Product Strategy — Daemon, Desktop, Team"
status: draft
created: 2026-03-29
depends-on: [BP-01, BP-05, BP-06]
informs: [BP-07, BP-08]
---

# BP: Product Strategy

## Purpose

This blueprint defines the enduring product boundaries for jin.

It is not a rollout plan, naming exercise, or feature checklist. It exists
to answer the architectural question:

> What are the products in the jin family, what does each one own, and what
> must never be conflated?

The goal is to keep implementation, commands, and future platform work aligned
to one clear product model.

---

## Product Principles

### 1. Jin is local-first

The core user value starts on the developer's machine:
- local indexing
- local history and search
- local agent visibility
- local queries over prior sessions

Jin must be useful before any remote setup exists.

### 2. Team is a product plane, not a sink flavor

`jin team` is not "the Postgres sink with extra features."

It is a remote workspace product with its own:
- identity model
- auth model
- onboarding flow
- storage and migration strategy
- deployment story

### 3. Integrations remain first-class

Postgres, S3, webhook, OTLP, and similar destinations remain valid and
important. They are not legacy leftovers.

They are the supported escape hatch for:
- startups
- OSS teams
- power users
- customers with existing data infrastructure

### 4. Developer, team, and operator workflows are different

The everyday developer experience must not be shaped by operator or
deployment concerns.

Likewise, infrastructure and migration concerns must not leak into the
main developer product story.

### 5. Desktop is a surface over Daemon

Desktop must not become a shadow backend.

It should build on a stable daemon boundary rather than duplicating
ingestion, storage, or query logic.

---

## Product Boundaries

## 1. Jin Daemon

The daemon is the canonical local runtime.

Owns:
- adapter ingestion from local sources
- canonical local ontology and store
- local query/search surface
- sync scheduling
- outbound integration delivery

Does not own:
- team backend schema lifecycle
- enterprise deployment workflows
- remote workspace provisioning

The daemon is the system of record for local session reconstruction.

## 2. Jin Desktop

Desktop is the primary personal command center.

Owns:
- session browsing
- trace and sub-agent visibility
- local search and exploration
- local status and health visibility
- higher-level user workflows over daemon data

Does not own:
- parsing
- canonical storage
- a second ingestion pipeline

Desktop is a product surface, not a second runtime.

## 3. Jin Team

Team is the remote workspace product for shared visibility and governance.

Owns:
- organizations, workspaces, teams, roles
- remote ingest API
- shared search and analytics
- summaries, digests, reports, governance
- backend storage and migration strategy
- hosted and self-hosted deployment modes

Does not need to expose:
- raw backend schema as the product contract
- direct database details as the developer onboarding model
- `jin schema apply` as part of the normal user story

## 4. Integration Sinks

Integration sinks are supported destinations for canonical jin data.

Examples:
- Postgres
- S3-compatible object storage
- webhook
- OTLP

They are for:
- exporting data
- integrating with existing infrastructure
- self-directed/custom deployments
- enterprise plumbing outside the Team product

Strategic rule:

> Generic sinks are integrations. Team is a product.

---

## Deployment Modes

Jin should support three enduring deployment modes.

## 1. Personal

Shape:
- Jin Daemon
- Jin Desktop
- no required remote dependency

Best for:
- solo developers
- side projects
- open-source maintainers
- lightweight personal use

The user should be able to install and start indexing immediately.

## 2. Workspace

Shape:
- Jin Daemon
- Jin Desktop
- Jin Team

Best for:
- startups
- internal teams
- managed/shared visibility
- organizations that want an opinionated team product

The daemon syncs to Team through a product API contract, not through direct
customer-managed table writes as the primary model.

## 3. BYO Integration

Shape:
- Jin Daemon
- optional Desktop
- one or more integration sinks

Best for:
- startups that want their own stack
- OSS teams with self-managed infrastructure
- customers who want Postgres/S3/webhook/OTLP rather than Jin Team

This mode is first-class and must remain first-class.

It is the strategic escape hatch that keeps jin useful even when customers
do not want the full Team product.

---

## Self-Hosted Quality Bar

For small-team self-hosting, the bar should be closer to Dokploy than to a
manual enterprise integration checklist.

The important lesson from Dokploy is not its specific implementation, but its
product packaging:
- time to first success is short
- one-box install is possible
- web-admin bootstrap comes early
- optional complexity comes later

For Jin Team, the desired self-hosted experience is:
1. provision a host
2. install the product
3. open a web admin/setup surface
4. create the first admin/workspace
5. connect developer daemons to that workspace

Not:
1. provision backend storage by hand
2. run developer-facing migration commands
3. explain sink plumbing to every user

This is a product quality bar, not a claim that jin must copy Dokploy's
exact deployment model.

---

## What Prismatic Already Proves

The sibling `prismatic` codebase is valuable because it demonstrates the
team/enterprise use cases jin already cares about in practice.

From [README.md](/Users/edenmendel/Documents/GitHub/prismatic/README.md),
[setup-self-hosted.md](/Users/edenmendel/Documents/GitHub/prismatic/docs/setup-self-hosted.md),
[setup-saas.md](/Users/edenmendel/Documents/GitHub/prismatic/docs/setup-saas.md),
and [user-guide.md](/Users/edenmendel/Documents/GitHub/prismatic/docs/user-guide.md),
the durable use cases are:

- role-scoped visibility
- shared session browsing
- remote ingest
- summaries and digests
- team reports
- developer identity mapping
- manager/admin workflows
- hosted and self-hosted deployment variants

These are Team product requirements, not generic sink requirements.

The migration from Prismatic to Jin Team should preserve these use cases
while changing the framing:

- from "analytics product bolted onto jin"
- to "the remote/team plane of the jin product family"

---

## Command Surface Principles

Exact command names are not the concern of this blueprint.

What is in scope is the separation of concerns those commands should reflect.

### Developer-facing commands

Should be:
- local-first
- product-oriented
- simple to discover

They should not require users to understand backend schema or sink plumbing
before jin becomes useful.

### Team/workspace commands

Should be:
- workspace-oriented
- auth and onboarding oriented
- clearly distinct from generic sink configuration

The mental model should be "connect to a workspace," not "configure a
database sink."

### Operator/admin commands

Should be:
- deployment-oriented
- clearly separate from the everyday developer experience

If schema or infrastructure provisioning commands exist, they belong here,
not in the normal developer path.

---

## Strategic Decision: Remove `jin schema apply` from the Core User Story

`jin schema apply` may remain useful as an implementation escape hatch for a
generic Postgres integration.

It should not remain central to the product story.

Why:
- it makes the product feel Postgres-first
- it couples developer workflows to backend schema lifecycle
- it blurs the boundary between product and integration
- it muddies the split between developer and operator personas

Therefore:
- Postgres may remain a supported integration sink
- backend schema application belongs to deployment/admin material or tooling
- the main product journey should not rely on `jin schema apply`

In short:

> Postgres integration may remain. Postgres-first product framing should not.

---

## Architectural Consequences

## 1. Team should be an API destination

Daemon → Team should use a product API contract.

That API is the right place for:
- auth
- workspace context
- versioning
- future backend evolution

This keeps backend implementation details behind the Team product boundary.

## 2. Desktop needs a stable daemon boundary

Desktop should consume daemon capabilities through a stable boundary.

This preserves one runtime, one source of truth, and one place where local
session reconstruction happens.

## 3. BP-06 should describe integrations, not Team

BP-06 is the right place for:
- Postgres
- S3
- webhook
- OTLP
- other generic sinks

It is not the right place to define the full product architecture of Team.

## 4. Identity is a product concern

Prismatic already demonstrates that developer identity mapping is critical.

Team must make identity and workspace membership first-class product concepts,
not incidental fields hidden inside sink configuration.

---

## Implications for the Blueprint Set

If this blueprint is accepted, the rest of the docs should be aligned to it:

- [BP-06-sink-contract.md](/Users/edenmendel/Documents/GitHub/jin/docs/blueprint/BP-06-sink-contract.md)
  should describe integration sinks, not Team as a product.

- BP-08 should separate workspace/team configuration from generic sink
  configuration.

- BP-07 should clarify the Daemon ↔ Desktop boundary.

- [BP-01-module-map.md](/Users/edenmendel/Documents/GitHub/jin/docs/blueprint/BP-01-module-map.md)
  should reflect Team as a distinct boundary rather than implicitly treating
  all remote destinations the same.

- Cross-cutting references that place `jin schema apply` in the main user
  story should be removed or demoted into integration/admin material.

---

## References

- Dokploy installation guide: [docs.dokploy.com/docs/core/installation](https://docs.dokploy.com/docs/core/installation)
- Dokploy remote servers: [docs.dokploy.com/docs/core/remote-servers](https://docs.dokploy.com/docs/core/remote-servers)
- Dokploy Docker Compose: [docs.dokploy.com/docs/core/docker-compose](https://docs.dokploy.com/docs/core/docker-compose)

- Prismatic overview: [README.md](/Users/edenmendel/Documents/GitHub/prismatic/README.md)
- Prismatic self-hosted setup: [setup-self-hosted.md](/Users/edenmendel/Documents/GitHub/prismatic/docs/setup-self-hosted.md)
- Prismatic SaaS setup: [setup-saas.md](/Users/edenmendel/Documents/GitHub/prismatic/docs/setup-saas.md)
- Prismatic user guide: [user-guide.md](/Users/edenmendel/Documents/GitHub/prismatic/docs/user-guide.md)
