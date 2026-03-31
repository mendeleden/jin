# Dispatch Protocol

This file explains how to launch work for a fresh-context agent.

## What To Send

Every dispatch should include exactly four things:

1. `docs/execution/00-global-rules.md`
2. this file
3. one task packet from `docs/execution/tasks/`
4. only the BP docs and current code files named in that packet

Do not send the whole repo. Do not say "read all the docs."

## Worker Prompt Skeleton

Use this structure when dispatching a worker:

```md
Work in /path/to/repo.

Read in order:
1. docs/execution/00-global-rules.md
2. docs/execution/01-dispatch-protocol.md
3. docs/execution/tasks/<packet>.md

Then execute the packet exactly.

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
