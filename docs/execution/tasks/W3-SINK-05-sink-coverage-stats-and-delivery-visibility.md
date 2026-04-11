# W3-SINK-05: Sink Coverage Stats And Delivery Visibility

## Role

Codex-owned future packet.

## Goal

Add an operator-facing read surface for per-sink delivery coverage, so local
status can answer questions like:

- how many conversations currently route to sink `X`
- how many of those have a successful push recorded for the current revision
- how many are still pending
- how many have a last error recorded

This is observability work, not sink-transport work. The point is to make sink
delivery state easier to inspect without manual SQL.

## Depends On

- `W2-SINK-02`
- `W3-SINK-04`
- `docs/blueprint/BP-02-data-flow.md`
- `docs/blueprint/BP-06-sink-contract.md`
- `docs/blueprint/BP-08-routing-and-config.md`

## Unblocks

- faster operator diagnosis during sink incidents
- clearer release validation evidence
- better `jin status` ergonomics for real local deployments

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/blueprint/BP-02-data-flow.md`
5. `docs/blueprint/BP-06-sink-contract.md`
6. `docs/blueprint/BP-08-routing-and-config.md`
7. `docs/execution/tasks/W3-SINK-05-sink-coverage-stats-and-delivery-visibility.md`
8. Current code:
   - `src/commands/status.ts`
   - `src/db/query-surface.ts`
   - `src/db/sync.ts`
   - `src/routing.ts`
   - read-only sink/runtime status surfaces

## Likely Shape

- derive routed conversation count per sink from route matching over local
  conversations
- derive success/pending/error counts from `_jin_sync` and `_jin_push_state`
- show the summary in `jin status`
- optionally expose the same numbers in `jin status --json`

## Example Output

```text
  sinks
    • team-railway-postgres   routed 85   synced 75   pending 10   failed 0
    • analytics-webhook       routed 12   synced 12   pending 0    failed 0
    • archive-s3              routed 85   synced 84   pending 1    failed 0
```

## Non-Goals

- changing sink push semantics
- changing `_jin_push_state` contract unless absolutely necessary
- release-blocker work ahead of Claude/Cursor/sink correctness follow-ups
- remote sink-side reporting or dashboard work

## BP Acceptance Matrix

| Requirement | Blueprint | Expected evidence |
|-------------|-----------|-------------------|
| Sink coverage stats reflect explicit route targeting, not hidden defaults | BP-08 | code + status evidence |
| Synced/pending/error counts derive from store push state, not sink-specific heuristics | BP-02, BP-06 | code + focused tests |
| The read surface works while stopped and remains local-first | BP-07, BP-08 | `jin status` evidence |
| The lane does not widen sink contracts or push behavior | BP-02, BP-06 | diff scope |

## Notes

- This is a low-priority observability packet.
- The current execution order remains:
  1. Claude Code full fix + revalidation
  2. Cursor follow-up + revalidation
  3. sink correctness / reconciliation
  4. workspace-member / `userId`
  5. sink coverage visibility like this packet
