---
title: Hidden contract extensions must be explicit before implementation
date: 2026-04-12
tags: [adapter, pipeline, daemon]
related: [W3-PERF-04, W3-PERF-05, BP-04, BP-02]
---

# Hidden contract extensions must be explicit before implementation

## Problem

`W3-PERF-04` closed a real RSS blocker by adding adapter-specific cold-start
direct-to-store hooks for heavy adapters. That improved the runtime, but it
also drifted past `BP-04`.

`BP-04` says adapters are read-only parsers that return `ConversationBundle`
objects and never write to the store. The implementation added a second ingest
path where some adapters write directly into SQLite during startup via an
optional duck-typed hook in the pipeline.

That is not a harmless internal optimization. It changes the effective
adapter/pipeline boundary while leaving the frozen contract and review surface
looking unchanged.

## Solution

Treat this class of change as architecture work first, not just performance
work.

When a fix needs behavior outside the frozen contract:

- stop and surface the drift explicitly in the packet, review, and user update
- decide whether to:
  - formalize the new capability in the contract and blueprint, or
  - keep the contract intact by introducing a narrower abstraction owned by the
    pipeline/store boundary
- only then land the implementation

For this case, the clean follow-on is not to silently bless adapter-owned store
writes. The next step is to replace the packet-local hook with an explicit
staged-writer capability or formally amend `BP-04` if that is truly the new
intended architecture.

## Key Insight

Hidden contract extensions are worse than ordinary drift because they create
two truths at once:

- the docs and type surface still describe the old system
- the runtime now depends on a stronger, undocumented capability

That is how performance fixes turn into long-lived architectural smells.

## Prevention

- if a change requires a frozen contract exception, call it out before writing
  code
- do not use duck-typed optional hooks to extend core architecture without a
  paired contract decision
- make packet reviews answer whether the implementation stayed within the
  documented boundary or intentionally changed it
- prefer explicit capability types or staged-writer abstractions over raw store
  knowledge inside adapters

## Related

- `BP-04` still states the intended read-only adapter contract
- `W3-PERF-04` and `W3-PERF-05` exposed the pressure that led to this drift
- `AGENTS.md` now requires architectural drift to be surfaced before
  implementation

## Files Changed

- `src/adapters/claude-code.ts`
- `src/adapters/codex.ts`
- `src/pipeline/ingest.ts`
- `AGENTS.md`
