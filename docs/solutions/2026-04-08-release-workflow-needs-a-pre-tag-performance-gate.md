---
title: Release workflow needs a pre-tag performance gate
date: 2026-04-08
tags: [pipeline, daemon, adapter, config]
related: [W3-PERF-03, W3-SCALE-01, W3-BP-01]
---

# Release workflow needs a pre-tag performance gate

## Problem

The current GitHub Actions setup only builds release binaries on tag push:

- [.github/workflows/release.yml](/Users/edenmendel/Documents/GitHub/jin/.github/workflows/release.yml)

That workflow:

- checks out code
- installs Bun
- builds the dashboard
- compiles binaries
- uploads artifacts
- creates a GitHub release

It does not run:

- adapter scale datasets
- v2 performance harnesses
- phase-level RSS validation
- release-gate checks before tagging

This means a candidate can be packaged and published without any automated proof
that the real v2 runtime path still meets its memory and lifecycle budgets.

## Solution

Do not overload the tag-only release workflow with ad hoc checks.

Instead:

- build repeatable perf/scale artifacts first
- define the release gate at the blueprint level
- then add a pre-tag CI workflow that consumes those artifacts

This is why the repo now has dedicated lanes for:

- `W3-SCALE-01` deterministic scale datasets
- `W3-PERF-03` repeatable v2 performance harness
- `W3-BP-01` performance-validation blueprint hardening

## Key Insight

The release workflow is not the right place to invent the performance contract.
It is the right place to enforce a contract that already exists.

Until the harness, datasets, and blueprint are settled, the current release
workflow should be treated as packaging only, not as evidence of runtime safety.

## Prevention

- Add a pre-tag CI workflow once `W3-SCALE-01`, `W3-PERF-03`, and `W3-BP-01`
  are approved
- Gate release packaging on machine-readable perf artifacts rather than human
  interpretation of logs
- Keep the tag-push release job focused on binary packaging and distribution

## Related

- `W3-PERF-03`
- `W3-SCALE-01`
- `W3-BP-01`

## Files Changed

- none yet; this note captures the workflow gap and sequencing decision
