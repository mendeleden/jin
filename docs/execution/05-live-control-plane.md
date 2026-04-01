# Live Control Plane

This file defines the centralized live-state model for the execution system.

## Why This Exists

The original execution OS was strong on:

- packet boundaries
- blueprint alignment
- dispatch discipline

But weak on one operational need:

> knowing, at any given moment, what every agent is doing and what the overall
> program status is

Versioned docs alone are not enough for this because they are:

- branch-local
- merge-delayed
- not inherently live

So the execution OS now has a second layer:

- committed spec in `docs/execution/`
- live control plane in one shared directory

## Control Directory

Default control directory:

- `<canonical repo root>/.execution/`

Recommended environment variable:

- `JIN_EXEC_CONTROL_DIR=/absolute/path/to/shared/.execution`

If agents run in:

- separate worktrees
- containers
- local VMs

they should still all mount or point to the same control directory.

## Ownership Model

### Codex-Owned

- `program.md`
- `packets/*.md`
- assignment state
- approval / blocked / merged transitions

### Cursor-Owned

- `blueprints.md`
- `reviews/*.md`
- drift and progress updates

### Worker-Owned

- `agents/*.md`
- heartbeat
- current focus
- handoff-ready note

Workers do not own:

- the program scoreboard
- packet approval state

## File Layout

```text
.execution/
  program.md
  blueprints.md
  packets/
    W0-CODEX-01.md
    W1-DB-01.md
    ...
  agents/
    codex-main.md
    claude-db-01.md
    cursor-audit.md
    ...
  reviews/
    2026-04-01-W0-CODEX-01-cursor.md
    ...
```

## Required Files

### `program.md`

High-level operational summary:

- current phase
- active agents
- packets in progress
- next dispatches
- major blockers

### `blueprints.md`

One line per BP with:

- status
- active packet(s)
- last review reference
- blocker if any

### `packets/<packet-id>.md`

Canonical packet state:

- packet title
- status
- assigned agent
- branch / worktree
- depends on
- unblocks
- last transition time
- next Codex action
- links to latest review(s)

### `agents/<agent-id>.md`

Live worker heartbeat:

- agent id
- packet id
- branch / worktree / container
- status
- last heartbeat
- current focus
- recent updates
- current blocker

### `reviews/*.md`

Immutable or append-only review artifacts from Cursor or Codex.

## Status Semantics

### Packet Status

Use:

- `queued`
- `in_progress`
- `needs_codex`
- `review_ready`
- `approved`
- `merged`
- `blocked`

These are packet-level execution states.

### Blueprint Status

Use:

- `unstarted`
- `frozen`
- `in_progress`
- `review_ready`
- `mostly_aligned`
- `aligned`
- `drifted`

These are blueprint alignment states.

## Operating Rhythm

### On Dispatch

Codex:

1. updates `program.md`
2. updates `packets/<packet-id>.md`
3. records assigned agent, branch, and expected next action

### On Agent Start

Worker:

1. reads `program.md`, `blueprints.md`, and its packet file
2. writes or updates `agents/<agent-id>.md`
3. starts heartbeat updates

### During Work

Worker:

- updates `last heartbeat`
- updates `current focus`
- records blockers immediately

### On Handoff

Worker:

- marks its own agent file as `review_ready`
- records files changed and tests run

Cursor:

- writes a review artifact
- updates `blueprints.md`

Codex:

- updates packet state and next action

## Concurrency Rule

To minimize write conflicts:

- Codex writes `program.md` and `packets/*.md`
- Cursor writes `blueprints.md` and `reviews/*.md`
- workers write only `agents/*.md`

This is the key design choice that keeps one centralized location without
everyone fighting over one file.

## Templates

Templates live in:

- `docs/execution/templates/control-plane/`

Use them to initialize a new control directory or recover a lost one.
