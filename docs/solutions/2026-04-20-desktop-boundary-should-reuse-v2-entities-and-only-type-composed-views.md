---
title: Desktop boundary should reuse v2 entities and only type composed views
date: 2026-04-20
tags: [desktop, daemon, schema, routing]
related: [W4-DESKTOP-01, BP-03, BP-07]
---

# Desktop boundary should reuse v2 entities and only type composed views

## Problem

The new Desktop work needs stronger type safety across the daemon boundary, but
there was ambiguity about whether that meant creating a second DTO layer for
every core ontology object.

That ambiguity is risky because the current route layer already contains legacy
compatibility shaping. If future Desktop work copied that pattern forward, we
would keep two parallel contract surfaces alive:

- the v2 domain model
- a second Desktop-specific clone of the same entities

## Solution

Adopt a narrower rule:

- reuse the existing v2 domain/entity types for canonical objects such as
  `Conversation`, `Message`, and `ToolCall`
- define explicit boundary contract types only where the response is a composed
  product view rather than a single ontology object

Examples of composed views that still need explicit contract types:

- overview summary
- conversation detail
- trace view
- tree view
- local control/status

This keeps the daemon/Desktop boundary typed without creating a second type
universe for the same underlying data.

## Key Insight

The ontology is already the semantic source of truth for local data. The
missing piece is not "DTOs everywhere." The missing piece is a clean boundary
between:

- canonical v2 entities
- composed UI/API views built from those entities

## Prevention

- New Desktop routes should return canonical v2 entity shapes directly when the
  response is a single entity or a list of entities.
- New composed responses should define one explicit contract type and reuse the
  v2 entities inside it.
- Do not add v1 compatibility aliases such as `parentSessionId` or mixed
  snake_case/camelCase duplicates to future Desktop-facing contracts.
- Reviews for future Desktop packets should check for unnecessary parallel
  entity wrappers.

## Related

- `docs/jin-desktop-prd.md`
- `docs/desktop-daemon-architecture.md`
- `docs/blueprint/BP-03-conversation-model.md`
- `docs/blueprint/BP-07-process-lifecycle.md`
- `docs/execution/tasks/W4-DESKTOP-01-daemon-query-boundary.md`

## Files Changed

- `docs/jin-desktop-prd.md`
- `docs/desktop-daemon-architecture.md`
- `docs/solutions/2026-04-20-desktop-boundary-should-reuse-v2-entities-and-only-type-composed-views.md`
