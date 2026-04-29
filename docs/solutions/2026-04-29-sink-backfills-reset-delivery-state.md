---
title: Sink backfills should reset delivery state, not local revisions
date: 2026-04-29
tags: [sink, pipeline, config]
related: [W3-SINK-06, W3-TEAM-03, BP-02, BP-06, BP-08, BP-09]
---

# Sink backfills should reset delivery state, not local revisions

## Problem

Sink-scoped export metadata such as `teamId` and `userId` can change even when
the canonical local conversation bundle does not. Operators still need a way to
re-deliver existing conversations to one sink so the remote integration catches
up. Rewriting `_jin_sync.local_revision` or mutating conversation payload
identity to force that backfill would violate the BP-02/BP-06 split between
canonical local data and sink delivery state.

## Solution

`W3-SINK-06` keeps the backfill mechanism entirely inside per-sink push state:

- reset only `_jin_push_state` rows for the selected sink
- leave `_jin_sync`, bundle hashes, and conversation/message/tool-call rows
  untouched
- run the normal full-snapshot push path for that one sink
- tag diagnostics with `reason=repush` plus a distinct `repush:reset` event

This makes repush restart-safe and sink-scoped without widening `PushPayload`
or inventing a sink-specific remote mutation path.

## Key Insight

Backfill pressure is usually about the export boundary, not the canonical local
store. The clean lever is to forget one sink's delivery checkpoint and let the
existing full-snapshot contract replay from the current local revision. That
generalizes to config metadata changes, sink-side schema migrations, and remote
re-delivery after an operator fix.

## Prevention

- Keep backfill features off `_jin_sync` and revision rewrites unless a
  blueprint explicitly reopens canonical store semantics.
- Add tests that prove a reset affects only one sink's `_jin_push_state`.
- Include a diagnostic reason field when a push is operator-forced so
  `debug.jsonl` can distinguish repushes from normal scheduled delivery.

## Related

- `docs/execution/tasks/W3-SINK-06-sink-repush-and-push-diagnostics.md`
- `docs/blueprint/BP-02-data-flow.md`
- `docs/blueprint/BP-06-sink-contract.md`
- `docs/blueprint/BP-08-routing-and-config.md`
- `docs/blueprint/BP-09-cli-split.md`

## Files Changed

- `src/commands/sink.ts`
- `src/db/sync.ts`
- `src/pipeline/push.ts`
- `src/pipeline/diagnostic.ts`
- `tools/diagnostic-viewer.html`
- `test/db-store-spine.test.ts`
- `test/config-mutation-control.test.ts`
- `test/pipeline-spec-gap-closure.test.ts`
