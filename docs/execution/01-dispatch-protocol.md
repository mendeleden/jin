# Dispatch Protocol

This file explains how to launch work for a fresh-context agent.

## What To Send

Every dispatch should include exactly four things:

1. `docs/execution/00-global-rules.md`
2. this file
3. `docs/execution/05-live-control-plane.md`
4. one task packet from `docs/execution/tasks/`
5. only the BP docs and current code files named in that packet

Do not send the whole repo. Do not say "read all the docs."

## The Shared Control Directory

All agents must share one live control directory.

Default:

- `<canonical repo root>/.execution/`

If you are using worktrees or containers, mount the same host control
directory into every agent environment.

Recommended environment variable:

- `JIN_EXEC_CONTROL_DIR=/absolute/path/to/shared/.execution`

## Worker Prompt Skeleton

Use this structure when dispatching a worker:

```md
Work in /path/to/repo.

Read in order:
1. docs/execution/00-global-rules.md
2. docs/execution/01-dispatch-protocol.md
3. docs/execution/05-live-control-plane.md
4. docs/execution/tasks/<packet>.md

Then execute the packet exactly.

Read the shared control plane first:
- <control-dir>/program.md
- <control-dir>/blueprints.md
- <control-dir>/packets/<packet>.md
- any reviews for that packet

Only read the BP docs and code files named in the packet.
Only edit the owned files named in the packet.
Stop on any forbidden-file pressure or frozen-contract change.

Return the completion report in the exact format from 00-global-rules.md.
```

## Hosting Model

The packet system is about semantic boundaries. Hosting is a separate choice.

Recommended order:

1. per-task git worktree
2. optional per-task container

### Worktree Default

Use a separate git worktree per task when:

- the task is normal code work
- you want simple local iteration
- you do not need special isolation

### Container Optional

Use a per-task container when:

- the worker needs broad local permissions
- the worker needs isolated dependencies
- the worker runs risky or long-lived processes
- you want clean teardown and reproducibility

If you use containers:

- mount only the task worktree writable
- mount the shared control directory writable into every container
- avoid broad host mounts unless required
- do not confuse runtime isolation with semantic safety

## Branch And Worktree Naming

Use one branch and one worktree per packet.

Suggested branch pattern:

- `codex/w0-contract-freeze`
- `codex/w1-db-store-spine`
- `codex/w1-routing-config-core`

Suggested worktree path pattern:

- `.worktrees/<packet-id>/`

## Handoff States

Use these states for every packet:

- `queued`
- `in_progress`
- `needs_codex`
- `review_ready`
- `approved`
- `merged`
- `blocked`

## Live State Files

The control directory should contain:

- `program.md`
  - Codex-owned high-level state
- `blueprints.md`
  - Cursor-owned BP scoreboard
- `packets/<packet-id>.md`
  - Codex-owned packet assignment and transition state
- `agents/<agent-id>.md`
  - worker-owned live heartbeat and progress notes
- `reviews/<timestamp>-<packet-id>-<auditor>.md`
  - Cursor-owned review artifacts

Workers do not update the global scoreboard.
Workers update only their own agent file and any progress subsection explicitly
allowed by Codex.

## Required State Transitions

At minimum:

1. Codex creates or updates the packet file before dispatch.
2. Worker creates or updates its agent file on start.
3. Worker updates heartbeat and current focus during execution.
4. Worker marks itself ready for review in its agent file at handoff.
5. Cursor writes a review artifact.
6. Codex moves packet state to `approved`, `needs_codex`, `blocked`, or
   `merged`.

## Integration Rule

Some packets intentionally forbid registry glue, CLI glue, or other
cross-boundary edits. That is on purpose.

Workers build the lane.
Codex performs the integration pass.

## Failure Rule

If the worker reaches outside the packet:

- do not quietly continue
- do not widen scope ad hoc
- stop and return the problem to Codex
