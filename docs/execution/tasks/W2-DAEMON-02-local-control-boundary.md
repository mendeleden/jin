# W2-DAEMON-02: Local Control Boundary

## Role

Worker packet.

## Goal

Implement a stable local daemon control/status boundary so other local clients
can inspect and control the runtime without becoming a second runtime.

## Depends On

- `W1-LIFECYCLE-01-runtime-boundary.md`
- `W1-PIPE-01-pipeline-spine.md`

## Unblocks

- daemon-client surfaces such as Desktop or dashboard integrations

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/blueprint/BP-07-process-lifecycle.md`
3. `docs/blueprint/BP-Product-Strategy.md`
4. Current code:
   - `src/api/server.ts`
   - `src/api/routes.ts`
   - `src/lifecycle.ts`
   - any local control/status endpoints or helpers already present

## Owned Files

- local control/status boundary files under `src/api/**`
- any lifecycle DTO helpers needed for that boundary
- boundary-focused tests under `test/`

## Forbidden Files

- `src/pipeline/**` except read-only wiring use
- `src/db/**`
- `src/adapters/**`
- `src/sinks/**`
- desktop or dashboard UI code

## Frozen Contracts

- one runtime owner per store
- Desktop is a client of the daemon boundary
- lifecycle status model

## Deliverables

- start/stop/restart/status boundary for local clients
- health summary DTOs
- no duplicate ingest or hidden runtime behavior

## Non-Goals

- desktop UI work
- second runtime path
- Team/backend APIs

## Acceptance Checks

- boundary exposes lifecycle/status behavior without duplicating ingestion
- client-triggered control flows respect ownership rules
- tests cover stopped, running, and degraded status reporting

## Stop And Escalate

Stop if:

- transport choice itself becomes a BP-level policy question
- the boundary would require bypassing lifecycle ownership checks

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

BP alignment:
- BP-07: daemon boundary exposed without a second runtime
- BP-Product-Strategy: daemon/client separation preserved

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
