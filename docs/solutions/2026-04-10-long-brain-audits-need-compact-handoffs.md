---
title: Long brain audits need compact handoffs before compaction
date: 2026-04-10
tags: [execution, review, docs]
related: [W3-PERF-04, W3-ADAPTER-12, W3-SINK-04, BP-10]
---

# Long brain audits need compact handoffs before compaction

## Problem

A repo-wide brain pass across blueprint docs, ontology, live control-plane
state, packet reviews, and current code can consume a large amount of session
context.

If that work ends as chat output only, the next session has to either trust a
long transcript or re-read the same cross-cutting surfaces just to recover the
current state.

## Solution

When `codex-BRAIN` finishes a large cross-cutting audit, write a short restart
artifact into the live control plane before compaction:

- current stable baseline
- active blockers
- next two or three actions

For this repo, the natural home is the brain heartbeat in `.execution/agents/`,
because the control plane already owns live operational state and is where fresh
sessions are supposed to look first.

## Key Insight

The control plane is not just for worker packet progress. It is also the right
place to cache high-value brain state that would otherwise be expensive to
reconstruct from memory.

The compact handoff should be much smaller than the audit that produced it.

## Prevention

- after any long brain/status audit, leave a compact handoff in the relevant
  `.execution/agents/*.md` heartbeat before compacting
- keep the handoff to settled facts, active blockers, and immediate next steps
- only write a durable `docs/solutions/` note when the workflow lesson
  generalizes beyond one packet

## Related

- `W3-PERF-04` remains the main live blocker on the integrated runtime path
- `W3-ADAPTER-12` shows why a narrow follow-up should be captured explicitly
- `W3-SINK-04` is code-complete but still waiting on unrestricted proof

## Files Changed

- `.execution/agents/codex-control-plane-01.md`
- `docs/solutions/2026-04-10-long-brain-audits-need-compact-handoffs.md`
