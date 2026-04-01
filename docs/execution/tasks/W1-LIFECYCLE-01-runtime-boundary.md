# W1-LIFECYCLE-01: Runtime Boundary

## Role

Worker packet.

## Goal

Implement the runtime ownership and lifecycle control boundary from BP-07 so
the v2 pipeline has one long-lived owner per local store.

## Depends On

- `W0-CODEX-01-contract-freeze.md`

## Unblocks

- accurate start/stop/status behavior
- any daemon-boundary consumer such as later desktop-facing work

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/04-frozen-contract-surface.md`
3. `docs/blueprint/BP-07-process-lifecycle.md`
4. `docs/blueprint/BP-08-routing-and-config.md`
5. `docs/blueprint/BP-Product-Strategy.md`
6. Frozen contract files:
   - `src/contracts/lifecycle.ts`
   - `src/contracts/config.ts`
   - `src/contracts/pipeline.ts`
7. Current code:
   - `src/lifecycle.ts`
   - `src/runguard.ts`
   - `src/commands/start.ts`
   - `src/commands/stop.ts`
   - `src/commands/status.ts`
   - `src/commands/service.ts`

## Owned Files

- `src/lifecycle.ts`
- `src/runguard.ts`
- `src/commands/start.ts`
- `src/commands/stop.ts`
- `src/commands/status.ts`
- `src/commands/service.ts`
- lifecycle-focused tests under `test/`

## Forbidden Files

- `src/pipeline/**`
- `src/contracts/**`
- `src/db/**`
- `src/adapters/**`
- `src/sinks/**`
- `src/config.ts` except for read-only consumption
- dashboard and site code

## Frozen Contracts

- one active coordinator per local store
- config snapshot semantics
- Desktop is a client of the daemon boundary, not a second runtime

## Deliverables

- runtime ownership detection
- service precedence over detached daemon start
- lifecycle state model: stopped, starting, running, degraded, stopping
- start/stop/restart/status behavior aligned to BP-07
- bounded graceful shutdown hooks and actionable status reporting

## Non-Goals

- pipeline queue implementation
- desktop UI behavior
- team backend or onboarding behavior

## Acceptance Checks

- starting a second long-lived owner is blocked
- service-owned runtime is reported instead of spawning a daemon
- status works while stopped
- stop behaves as a control-plane action, not an unbounded wait
- tests cover ownership checks and service precedence

## Stop And Escalate

Stop if:

- the packet needs queue redesign from BP-02
- the packet needs a second runtime for Desktop
- the packet needs to edit any frozen file under `src/contracts/**`
- transport details become mandatory and are not already frozen by Codex

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

BP alignment:
- BP-07: ownership, lifecycle commands, status model
- BP-Product-Strategy: daemon/desktop boundary preserved

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
