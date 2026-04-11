---
title: Packet-owned runbooks must validate against live state
date: 2026-04-08
tags: [execution, review, docs]
related: [W3-V2-01, W3-RUNTIME-01, BP-05, BP-07, BP-09]
---

# Packet-owned runbooks must validate against live state

## Problem

`W3-V2-01` failed review for a docs-only reason even though the underlying
runtime work was already approved and committed.

The packet-owned final-steps audit still described `W3-RUNTIME-01` as pending,
while the live control plane, packet state, review artifacts, and current HEAD
already showed that runtime was approved in `45529f8`.

That created a false first gate:

- the live state was current
- the release-prep checklist was stale
- a fresh-context session could over-trust the packet-owned runbook because it
  looked like the packet deliverable

## Solution

Treat packet-owned runbooks, checklists, and audit notes as **derived state**.

Before handoff or approval, any packet-owned doc that describes:

- current program state
- gating steps
- release-prep sequence
- approval or commit checkpoints

must be revalidated against:

- `.execution/program.md`
- the current packet file
- the latest relevant review artifact(s)
- current git/commit state when the checklist depends on an approval or commit
  checkpoint

If the packet-owned doc disagrees with live state, the doc is wrong and must be
refreshed before the packet can move forward.

## Key Insight

In this execution model, packet-owned operational docs are not independent
sources of truth. They are convenience views over live state.

That means they drift faster than packet status or review artifacts unless the
workflow explicitly forces a freshness check.

## Prevention

- require packet-owned runbooks and audits to cite the live-state files they
  were validated against
- require approval to verify that any current-state checklist was refreshed
  against live control-plane state and current HEAD
- prefer linking to canonical packet and review state rather than rephrasing
  approval checkpoints from memory

## Related

- `W3-V2-01` exposed the issue when its checklist kept a stale pre-approval
  runtime gate
- `W3-RUNTIME-01` was already approved and committed in `45529f8`; the
  checklist drifted, not the runtime state

## Files Changed

- `docs/execution/00-global-rules.md`
- `docs/execution/01-dispatch-protocol.md`
- `docs/solutions/2026-04-08-packet-runbooks-must-validate-live-state.md`
