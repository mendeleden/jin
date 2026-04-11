# W3-ADAPTER-12: Cursor Tool Stitching And Layer1 Metadata Follow-up

## Role

Codex worker packet.

## Goal

Verify and fix the post-approval Cursor follow-up report against the current
local dataset without widening beyond the Cursor adapter and packet-owned docs.

The current report is not stale enough to ignore. Codex has already confirmed
that the most severe claim still appears in the live file:

- Layer 3 tool-result stitching still mixes id-match and name-fallback inside a
  single reverse walk
- Layer 1 `cwd` still ignores `workspaceUris`
- Layer 1 assistant bubbles still hardcode `thinkingContent: ""`
- Layer 3 auto-naming still grabs the synthetic `<user_info>` prelude on real
  CLI sessions instead of the first user-authored prompt
- `docs/adapters/cursor/index.md` is still pre-`W3-ADAPTER-10` and materially
  stale
- `docs/adapters/cursor/orchestration.md` still claims tool call results are
  not captured

## Depends On

- `.execution/packets/W3-ADAPTER-10.md`
- `.execution/packets/W3-VALIDATE-01.md`
- `docs/execution/audits/2026-04-08-W3-VALIDATE-01-live-adapter-validation-and-reconciliation.md`

## Unblocks

- honest Cursor correctness after the approved `W3-ADAPTER-10` lane
- safe downstream validation/reporting on Cursor sessions
- keeping post-approval Cursor data-loss bugs out of sink and `userId` work

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/execution/tasks/W3-ADAPTER-12-cursor-tool-stitching-and-layer1-metadata-followup.md`
6. `docs/adapters/cursor/index.md`
7. `docs/adapters/cursor/overview.md`
8. `docs/adapters/cursor/investigation.md`
9. `docs/adapters/cursor/orchestration.md`
10. `.execution/packets/W3-ADAPTER-10.md`
11. Current code:
    - `src/adapters/cursor.ts`
    - `test/cursor-adapter.test.ts`
    - `docs/ontology.md`

## Owned Files

- `src/adapters/cursor.ts`
- `test/cursor-adapter.test.ts`
- `docs/adapters/cursor/index.md`
- `docs/adapters/cursor/orchestration.md`
- `docs/ontology.md`
- packet-local audits under `docs/execution/audits/`

## Forbidden Files

- `src/contracts/**`
- `src/pipeline/**`
- `src/sinks/**`
- non-Cursor adapter files
- runtime/service/perf lanes
- sink or `userId` work

## Frozen Contracts

- adapter v2 interface
- parsed output shapes
- relationship semantics
- store / sink / pipeline contracts

## Deliverables

- verify which items in the report are still real on the current local dataset
- fix the confirmed Layer 3 same-name tool-result stitching bug if it remains
  adapter-local
- fix Layer 1 `cwd` extraction if `workspaceUris` or adjacent raw fields prove
  to be the stable source
- fix Layer 1 thinking extraction if the raw bubble fields are present and map
  cleanly onto existing `thinkingContent` semantics
- fix Layer 3 conversation naming if the first current live user message is a
  synthetic Cursor prelude rather than the first real prompt
- refresh stale Cursor doc surfaces owned by this packet so they stop claiming
  the adapter is Layer 3-only
- add focused regression coverage
- write a packet-local audit with exact commands, local-data probes, and any
  residual issues

## Non-Goals

- adding Layer 2 support
- solving git remote / branch enrichment
- changing token semantics beyond what current Cursor raw data already provides
- runtime RSS work from `W3-PERF-04`
- broad Cursor adapter decomposition/refactors

## BP Acceptance Matrix

| Requirement | Blueprint | Expected evidence |
|-------------|-----------|-------------------|
| Layer 3 tool-result stitching no longer loses outputs when multiple same-name tools exist in one session and distinct `toolCallId`s are present | BP-04 | code diff + focused regression test + local-data audit |
| Layer 1 `cwd` and thinking fields reflect the richest stable raw source already present in Cursor's current local data without changing frozen output contracts | BP-04 | code diff + focused regression test and/or local-data audit |
| Layer 3 conversation naming skips synthetic Cursor session prelude text when choosing a fallback title so live sessions are named from user-authored prompts | BP-04 | code diff + focused regression test + local-data audit |
| Packet-owned Cursor docs and ontology references stop claiming the adapter is Layer 3-only or that tool results are categorically not captured when the current code/data proves otherwise | BP-04 | doc diff + audit citations |
| The lane stays inside Cursor adapter/test/doc owned files and does not widen into runtime/store/sink/contracts | BP-02, BP-04, BP-05, BP-06 | diff scope |

## Acceptance Checks

- at least one focused regression test reproduces the same-name tool-result
  stitching bug or the closest deterministic analogue
- completion report states which report items were confirmed, fixed, deferred,
  or already stale
- local validation cites exact counts or probe output from the current Cursor
  dataset where relevant

## Stop And Escalate

Stop if:

- the smallest safe fix requires store/pipeline/contract changes
- the local raw Cursor data does not support a stable `cwd` or thinking mapping
  without guesswork
- the only way to close the lane is a broader Cursor decomposition/refactor

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

Validation:
- exact local-data probes / adapter tests
- which report items were confirmed or disproved

BP acceptance matrix:
- <requirement> -> implemented in <file>, tested by <test or artifact>
- <requirement> -> deferred with Codex approval
- <requirement> -> out of scope per packet boundary

V1 comparison:
- parity kept / intentional BP-backed change / deferred regression

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
