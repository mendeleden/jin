# W2-CONFIG-02: Mutation And Control Commands

## Role

Worker packet.

## Goal

Implement the v2 config mutation and selective control command behavior from
BP-08 without collapsing Team concepts into generic sink configuration.

## Depends On

- `W1-ROUTING-01-routing-config-core.md`
- `W1-LIFECYCLE-01-runtime-boundary.md`

## Unblocks

- safe user-facing config mutation on top of frozen routing/config semantics

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/blueprint/BP-08-routing-and-config.md`
3. `docs/blueprint/BP-07-process-lifecycle.md`
4. `docs/blueprint/BP-Product-Strategy.md`
5. Current code:
   - `src/commands/connect.ts`
   - `src/commands/team-config.ts`
   - `src/commands/init.ts`
   - `src/commands/start.ts`
   - `src/commands/stop.ts`
   - any sink/route/config mutation commands present in `src/commands/`

## Owned Files

- config mutation and control command files in `src/commands/`
- related tests under `test/`

## Forbidden Files

- `src/pipeline/**`
- `src/db/**`
- `src/adapters/**`
- `src/sinks/**` except for read-only use of frozen sink types
- dashboard or site code

## Frozen Contracts

- config schema
- routing semantics
- lifecycle ownership semantics
- Team vs generic sink product boundary

## Deliverables

- v2 sink and route mutation command behavior
- controlled restart semantics where required
- selective `pause` / `resume` semantics
- user-facing command behavior that respects BP-08 and BP-Product

## Non-Goals

- broad product renaming beyond the packet
- daemon internals
- Team backend behavior

## Acceptance Checks

- generic sink configuration stays separate from Team/workspace concepts
- runtime-affecting config changes are restart-based unless BP-08 says
  otherwise
- selective pause/resume works as a distinct control-plane behavior
- tests cover no-hidden-hot-reload semantics

## Stop And Escalate

Stop if:

- the packet needs to change core config semantics
- Team onboarding and generic sink config can no longer be kept separate

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

BP alignment:
- BP-08: config mutation and control semantics implemented
- BP-Product-Strategy: Team vs generic sink boundary preserved

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
