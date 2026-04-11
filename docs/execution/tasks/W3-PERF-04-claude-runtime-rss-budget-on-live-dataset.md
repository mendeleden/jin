# W3-PERF-04: Claude Runtime RSS Budget On Live Dataset

## Role

Codex worker packet.

## Goal

Fix the current live runtime failure where the local `0.8.5` foreground/service
path exits during Claude ingest before the runtime can settle and before Cursor
gets a steady-state pass.

This lane exists because the current evidence is now very narrow:

- Cursor detection is working on the live machine
- Cursor-only validation is already approved in `W3-ADAPTER-10`
- the integrated runtime still exits on the frozen RSS guard during Claude
  ingest:
  - `RSS 422 MB exceeded the 256 MB hard limit during ingest batch for adapter claude-code (20/921)`
- `W3-ADAPTER-07` already proved that adapter-local hardening removed the
  recursion/stack-overflow failure but did **not** close full live Claude RSS;
  its audit recorded a peak around `812 MB`

## Depends On

- `.execution/packets/W3-PERF-02.md`
- `.execution/packets/W3-ADAPTER-07.md`
- `.execution/packets/W3-ADAPTER-09.md`
- `.execution/packets/W3-ADAPTER-10.md`
- `docs/solutions/2026-04-08-runtime-rss-needs-streamed-discovery-and-small-push-batches.md`
- `docs/solutions/2026-04-08-adapter-memory-contract-gap.md`
- `docs/solutions/2026-04-08-rss-shutdown-poisons-local-sqlite-store.md`

## Unblocks

- stable local foreground/service runtime on the real multi-adapter workload
- honest Cursor visibility in steady state instead of “detected then preempted”
- sink reconciliation from a stable runtime instead of an RSS-aborted one

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/execution/tasks/W3-PERF-04-claude-runtime-rss-budget-on-live-dataset.md`
6. `docs/blueprint/BP-02-data-flow.md`
7. `docs/blueprint/BP-04-adapter-contract.md`
8. `docs/blueprint/BP-07-process-lifecycle.md`
9. `docs/solutions/2026-04-08-runtime-rss-needs-streamed-discovery-and-small-push-batches.md`
10. `docs/solutions/2026-04-08-adapter-memory-contract-gap.md`
11. `docs/solutions/2026-04-08-rss-shutdown-poisons-local-sqlite-store.md`
12. `docs/execution/audits/2026-04-08-W3-ADAPTER-07-claude-code-live-hardening.md`
13. Current code:
    - `src/adapters/claude-code.ts`
    - `src/pipeline/ingest.ts`
    - `src/commands/watch.ts`
    - `test/claude-code-reference-adapter.test.ts`
    - `test/runtime-store-cutover.test.ts`

## Owned Files

- `src/adapters/claude-code.ts`
- `src/pipeline/ingest.ts`
- `src/commands/watch.ts` only if the smallest safe fix needs runtime-side
  validation plumbing already used by prior perf lanes
- `test/claude-code-reference-adapter.test.ts`
- `test/runtime-store-cutover.test.ts`
- packet-local audits under `docs/execution/audits/`

## Forbidden Files

- `src/contracts/**`
- `src/sinks/**`
- `src/commands/service.ts`
- `src/daemon/**`
- non-Claude adapter files other than the narrow ingest/runtime-owned files
- `userId` / workspace identity work
- sink observability or delivery lanes

## Frozen Contracts

- BP-02 RSS warning/hard-limit ownership and bounded shutdown semantics
- BP-04 adapter interface and bundle shape
- BP-07 service/foreground single-owner semantics

## Deliverables

- full RCA for why the integrated runtime still exceeds the hard limit during
  Claude ingest on the live dataset
- a measurement split across:
  - Claude discovery
  - representative / largest Claude `loadConversation()`
  - integrated startup ingest
  - real foreground/service startup if safe
- the smallest safe fix if the evidence still supports an adapter/runtime-local
  solution
- focused regression coverage for the chosen fix
- explicit statement whether the remaining failure, if any, proves a frozen
  contract gap rather than another local hardening issue
- packet-local audit with exact commands, counts, and RSS observations

## Non-Goals

- changing the `256 MB` hard limit
- changing launchd/systemd restart policy
- sink reconciliation or remote delivery work
- broad Claude adapter decomposition from `W3-ADAPTER-08`
- token-accounting work from `W3-ADAPTER-11`

## BP Acceptance Matrix

| Requirement | Blueprint | Expected evidence |
|-------------|-----------|-------------------|
| The representative live runtime path no longer trips the BP-02 hard limit during Claude ingest, or the packet stops with explicit evidence that the failure is a frozen-contract gap | BP-02, BP-04, BP-07 | code diff or audit proof + focused validation |
| The fix does not widen sink/service/contract surfaces outside the owned files | BP-02, BP-04, BP-06, BP-07 | diff scope |
| The packet distinguishes discovery, load, integrated ingest, and real runtime so conclusions are not based on a misleading narrow harness | BP-02 | packet-local audit |

## Acceptance Checks

- completion report includes the exact RSS breakpoint currently seen on the live
  machine and whether it still reproduces after the fix
- if code changes land, at least one focused test covers the discovered
  retention or batching rule
- if the packet stops without a fix, the audit still explains why prior local
  hardening is insufficient and what contract decision is actually needed

## Stop And Escalate

Stop if:

- the evidence shows a single valid Claude bundle cannot fit the frozen runtime
  budget without changing the bundle/store contract
- the smallest safe fix requires touching forbidden lifecycle, sink, or
  contract files
- the only remaining issue is launchd restart policy after an otherwise honest
  RSS shutdown

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

Validation:
- exact discovery/load/integrated/runtime commands
- observed peak RSS / hard-limit result

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
