---
title: Release validation must prove sink delivery, not just local ingest
date: 2026-04-08
tags: [sink, release, pipeline, postgres]
related: [W2-SINK-02, W3-VALIDATE-01, W3-SINK-04, BP-06, BP-10]
---

# Release validation must prove sink delivery, not just local ingest

## Problem

The fresh-start litmus test rebuilt the current binary, removed
`~/.config/jin`, reprovisioned both Postgres sinks from scratch, and ran a
clean ingest.

That proved several things were working:

- schema bootstrap
- sink and route creation
- local SQLite ingest on a clean store

It did **not** prove remote delivery. Both configured Postgres sinks stayed
empty even though the local store populated successfully:

- local store after ingest: `1085` conversations, `56176` messages,
  `30644` tool calls
- local Docker Postgres: `0` conversations, `0` messages
- Railway Postgres: `0` conversations, `0` messages

The local `_jin_push_state.last_error` rows showed the same sink-side failure
for the clean store:

- `Only use sql.begin, sql.reserved or max: 1`

This means we can currently pass a large part of the release-prep story while
still failing the actual sink-delivery contract.

## Solution

Treat sink delivery as its own release-facing gate.

The new `W3-SINK-04` lane exists for two purposes:

1. fix the current Postgres push regression
2. define a repeatable validation path that proves configured sinks deliver
   rows to both:
   - a local reference destination
   - a remote/operator-style destination

That validation must start from a disposable local config and show all of these
in one artifact:

- local store counts after ingest
- local sink row counts after push
- remote sink row counts after push
- `_jin_push_state` success or failure state

## Key Insight

For Jin, "ingest works" and "sinks work" are different release claims.

Local ingest can succeed while every configured sink remains empty. A release
candidate is not real until a fresh-start run proves end-to-end delivery into
at least one local sink and one remote sink.

## Prevention

- keep sink delivery as a distinct release lane rather than assuming adapter or
  store validation implies remote push is healthy
- require fresh-start validation to include:
  - sink provisioning from the CLI
  - local store population
  - local and remote sink row-count checks
  - `_jin_push_state` inspection
- treat outbound identity fields such as `userId` / developer identity as a
  separate product/contract decision unless a concrete sink failure proves they
  are required for delivery

## Related

- `W2-SINK-02` established the Postgres reference sink contract
- `W3-VALIDATE-01` proves source-to-store reconciliation before sink behavior
- `W3-SINK-04` owns the current clean-start Postgres push regression and the
  release-facing local/remote sink validation path

## Files Changed

- `docs/solutions/2026-04-08-release-validation-must-prove-sink-delivery.md`
- `docs/execution/audits/2026-04-08-clean-start-postgres-push-regression.md`
- `.execution/packets/W3-SINK-04.md`
- `docs/execution/tasks/W3-SINK-04-postgres-push-regression-and-release-sink-validation.md`
- `docs/execution/prompts/W3-SINK-04-worker-codex.md`
