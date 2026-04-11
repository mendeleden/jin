# W0-CODEX-02: Live Control Plane Bootstrap

## Role

Codex only. Do not dispatch this packet to a worker.

## Goal

Initialize the shared live control plane so the program has one authoritative
place to track packet status, blueprint status, reviews, and agent heartbeats.

## Depends On

- `docs/execution/05-live-control-plane.md`
- preferably `W0-CODEX-01-contract-freeze.md`

## Unblocks

- trustworthy cross-agent progress tracking
- safe parallel dispatch with centralized visibility

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/02-progress-and-audit.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/execution/03-blueprint-task-map.md`
6. current repo state and any active agent outputs

## Owned Files

- shared control directory contents
- any bootstrap notes or docs needed to explain the initialized state

## Forbidden Files

- broad implementation changes unrelated to the control plane

## Deliverables

- initialized shared control directory
- `program.md`
- `blueprints.md`
- packet registry under `packets/`
- any current agent heartbeat files if relevant

## Non-Goals

- blueprint implementation work itself
- replacing packet docs with the control plane

## Acceptance Checks

- a human can answer "what is happening right now?" by opening the control
  directory
- every known packet has a live state entry
- the current blueprint scoreboard is visible in one file

## Stop And Escalate

If there are competing notions of the canonical control directory, Codex must
choose one before dispatch continues.

## Completion Report

```md
Completed:
- live control plane initialized
- packet registry seeded
- blueprint scoreboard seeded

Files changed:
- ...

Tests run:
- ...

BP alignment:
- execution OS: centralized live state established

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
