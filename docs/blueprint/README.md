# Jin v2 Architectural Blueprints

Principled design documents that define **how each subsystem works and why**.
These are the source of truth for implementation — code follows blueprints,
not the other way around.

## Blueprints

| # | Title | Status | Core Question |
|---|-------|--------|---------------|
| [BP-01](BP-01-module-map.md) | Module Map & File Layout | **reviewed** | What are the subsystems? What does each own? |
| [BP-02](BP-02-data-flow.md) | Data Flow: Adapter → Store → Sink | **reviewed** | What's the contract at each boundary? |
| [BP-03](BP-03-conversation-model.md) | Conversation Model | **reviewed** | How do trace_id, parent_id, relationship work? |
| [BP-04](BP-04-adapter-contract.md) | Adapter Contract | **reviewed** | What must an adapter provide? |
| [BP-05](BP-05-store-and-migration.md) | Store & Migration | **reviewed** | How does the DB work? |
| [BP-06](BP-06-sink-contract.md) | Sink Contract | **reviewed** | What is the timeless contract for integration sinks? |
| [BP-07](BP-07-process-lifecycle.md) | Process Lifecycle | **reviewed** | How does one runtime behave across foreground, daemon, service, and Desktop boundary modes? |
| [BP-08](BP-08-routing-and-config.md) | Routing & Configuration | **reviewed** | How do conversations match to sinks? How does config mutation work? |
| [BP-09](BP-09-cli-split.md) | CLI Split — jin vs jin team | **reviewed** | Which commands belong to the developer? Which to the operator? |
| [BP-Product-Strategy](BP-Product-Strategy.md) | Product Strategy | **draft** | What are the enduring product boundaries for Daemon, Desktop, Team, and integrations? |

## Dependency Order

```
BP-01 (Module Map)
  ↓
BP-04 (Adapter Contract) ──→ BP-03 (Conversation Model)
  ↓                              ↓
BP-02 (Data Flow) ←─────────────+
  ↓
BP-05 (Store)    BP-06 (Sinks)    BP-07 (Lifecycle)    BP-08 (Routing)
```

BP-01 and BP-04 come first — everything else references them.

Preview-friendly standalone Mermaid diagrams derived from these blueprint docs
live under `docs/blueprint/mermaid/`.

## How to Use

1. **Read before implementing** — code follows blueprints
2. **Review via `/plan-arch-review`** — each blueprint gets a technical review
3. **Update when reality diverges** — if implementation reveals a better approach, update the blueprint first, then the code
4. **Reference from plans** — implementation plans in `docs/plans/` link to the relevant blueprints

## Blueprint Writing Guardrails

- Keep blueprint files high-level: contract, ownership, invariants, data flow,
  and the reasoning behind decisions.
- Keep tool-specific field maps, storage quirks, and investigation evidence in
  adapter docs or research docs, then link out from the blueprint when needed.
- If a detail would likely go stale when Cursor, Claude Code, or Codex changes
  an internal field name, it probably does not belong in the blueprint.
