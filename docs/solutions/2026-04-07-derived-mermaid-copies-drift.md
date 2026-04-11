---
title: Avoid derived Mermaid copies from non-source docs
date: 2026-04-07
tags: [pipeline, daemon, sink, config]
related: [BP-01, BP-02, BP-04, BP-06, BP-07, BP-09]
---

# Avoid derived Mermaid copies from non-source docs

## Problem

Standalone `.mmd` files were extracted from `contributing/ELI5/*.md` so they
could be previewed directly in VS Code. Those ELI5 docs are explanatory and no
longer match the v2 source of truth in `docs/ontology.md` and
`docs/blueprint/`.

The extracted diagrams therefore duplicated stale concepts and command flows,
including:

- old adapter interfaces like `sessions()` and `messages(sessionId)`
- old conversation fields like `isSubAgent`
- old onboarding commands like `jin init --team` and `jin team-config`
- old sink behavior such as remote provisioning in normal push flows

## Solution

Remove the extracted `.mmd` copies rather than keeping a second artifact layer
that looks editable and current.

Keep Mermaid embedded in the original docs unless one of these is true:

- the standalone `.mmd` file is generated from the canonical source
- the standalone `.mmd` file is itself the canonical owned artifact
- the diagram is refreshed directly against the current blueprint packet

## Key Insight

When blueprints and ontology docs are the source of truth, derived diagram
copies made from explanatory docs drift faster than the implementation. They
create a false sense that the diagrams are current just because they are easy
to preview.

## Prevention

- Before adding or keeping a standalone diagram, check its commands, contracts,
  and entities against `docs/ontology.md` and the relevant `docs/blueprint/`
  packet.
- Prefer generated derivatives over hand-maintained copies.
- If a doc is already known to be non-canonical, do not promote its diagrams
  into separately maintained assets.

## Related

- `docs/ontology.md`
- `docs/blueprint/BP-01-module-map.md`
- `docs/blueprint/BP-02-data-flow.md`
- `docs/blueprint/BP-04-adapter-contract.md`
- `docs/blueprint/BP-06-sink-contract.md`
- `docs/blueprint/BP-07-process-lifecycle.md`
- `docs/blueprint/BP-09-cli-split.md`

## Files Changed

- `AGENTS.md`
- `docs/solutions/2026-04-07-derived-mermaid-copies-drift.md`
- `contributing/ELI5/mermaid/*` (local extracted copies removed)
