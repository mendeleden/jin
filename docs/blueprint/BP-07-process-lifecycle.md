---
title: "BP-07: Process Lifecycle"
status: draft
created: 2026-03-29
depends-on: [BP-01, BP-02, BP-05, BP-Product-Strategy]
informs: [BP-08]
---

# BP-07: Process Lifecycle

## Principle

Jin has **one runtime** and several ways to host it.

The same pipeline (BP-02) and store (BP-05) logic should run whether jin is:
- invoked once for a one-shot command
- running interactively in the foreground
- detached as a background daemon
- launched under an OS service manager

Lifecycle code decides **who owns the runtime, how it starts, and how it
stops**. It does not change the data-flow logic.

---

## Core Invariants

### 1. One long-lived runtime owner per local store

At most one long-lived jin runtime may own a given local config/store at a
time.

That owner may be:
- a foreground process
- a detached daemon
- an OS service instance

There must never be two concurrent long-lived pipeline owners for the same
store path.

### 2. Only one ingest/push coordinator may write at a time

Long-lived runtime ownership is the normal writer lock, but the deeper rule is:

> there must be only one active ingest/push coordinator per local store,
> regardless of whether it is long-lived or one-shot.

This means:
- read-only commands may run while the daemon is active
- write-capable one-shot commands must not race a running daemon
- if a daemon/service is already active, bounded write commands should either
  fail fast or delegate through the daemon boundary

The primary reason for this exclusion is **runtime coordination and adapter
state**, not SQLite write safety alone. SQLite WAL can tolerate more than one
process reading and writing, but jin adapters and the pipeline hold in-memory
change-detection and scheduling state that must not diverge across two active
coordinators.

### 3. Query commands do not require the daemon

Commands that only read local state may open SQLite directly and exit:
- `jin show`
- `jin conversations`
- `jin search`
- `jin stats`
- `jin export`

Jin remains useful even when no long-lived runtime is active.

### 4. Long-lived modes share one runtime path

Foreground mode, background daemon mode, and service mode all execute the same
pipeline/runtime logic after startup handoff.

There is not a separate "service brain" or "desktop brain."

### 5. Desktop is a client of the daemon boundary

Per [BP-Product-Strategy.md](/Users/edenmendel/Documents/GitHub/jin/docs/blueprint/BP-Product-Strategy.md),
Desktop must not duplicate ingestion, storage, or process control logic.

Desktop talks to a stable local daemon boundary for:
- runtime status
- start/stop/restart requests
- health and sync visibility
- higher-level local workflows

Desktop is a surface over the daemon, not a parallel runtime.

### 6. Config is snapshotted at process start

The long-lived runtime loads config on startup and treats it as immutable for
that run.

Changing config while jin is running requires:
- restart, or
- a future explicit reload path

Hot config reload is not a v2 lifecycle invariant.

---

## Runtime Modes

| Mode | Lifetime | Owns watcher/timers? | Typical entry |
|------|----------|----------------------|---------------|
| One-shot | Short-lived | No | `jin ingest`, read commands |
| Foreground | Long-lived | Yes | `jin start --foreground` or equivalent |
| Background daemon | Long-lived | Yes | `jin start` |
| OS service | Long-lived | Yes | service manager launches jin |

### One-shot Mode

One-shot commands perform a bounded task and exit.

Examples:
- `jin ingest`
- read-only commands
- future bootstrap/repair commands if they exist

One-shot mode may:
- open the store
- run migrations
- run a bounded ingest or query
- exit without creating long-lived process state

It must not leave behind watcher state, timers, or daemon ownership records.

If a one-shot command intends to write conversation state (`jin ingest`,
future bootstrap commands, future repair commands), it must respect the
single-coordinator rule:
- if no long-lived runtime is active, it may run directly
- if a long-lived runtime is active, it must fail fast or delegate through the
  daemon boundary rather than race the active coordinator

### Foreground Mode

Foreground mode runs the full pipeline in the current terminal session.

This is the canonical interactive runtime:
- useful for local development
- useful for debugging
- useful for service wrappers that want one direct process

Foreground mode owns:
- watcher
- periodic scan timer
- sink push scheduling
- shutdown handling

### Background Daemon Mode

Background daemon mode is a wrapper around the same foreground runtime.

Its lifecycle responsibilities are:
- ensure another long-lived owner is not already active
- detach from the terminal
- redirect logs/output appropriately
- publish process-state metadata

After detachment, the child process runs the same long-lived runtime as
foreground mode.

### OS Service Mode

Service mode is also a wrapper around the same foreground runtime.

The service manager owns:
- restart policy
- boot-time launch
- process supervision

Jin still owns:
- pipeline startup
- graceful shutdown
- process-state reporting

Service mode should not create a second daemon layer under the service manager.
The service should launch the foreground runtime directly.

### Managed Deployment

Enterprise rollout may install and manage jin through device-management or
enterprise IT tooling such as MDM-style systems.

This may include:
- pre-installing the jin binary or desktop app
- pre-seeding config or workspace enrollment material
- pre-registering jin as an OS service

This does **not** create a separate lifecycle model.

Managed deployment changes:
- how jin is installed
- how config is provisioned
- whether service mode is enabled by default

It does not change:
- runtime ownership rules
- the single-coordinator invariant
- graceful shutdown semantics
- config snapshot semantics for a running process

---

## Ownership and Exclusivity

### Runtime Ownership Record

The daemon layer owns a small local process-state record for the active
long-lived runtime.

Conceptually, this record contains:
- process identifier
- runtime mode (`foreground`, `daemon`, `service`)
- start time
- config/store path
- optional log path

The implementation may use:
- a PID file
- a lock file
- a small JSON/TOML state file
- or a combination of those

The blueprint requirement is not the exact file format. The requirement is:

> jin can reliably answer "is a long-lived runtime already active for this
> store, and if so, who owns it?"

**Preferred v2 shape:**
- a lock file (or `flock`-style equivalent) is the primary writer exclusion
  mechanism
- a PID/state file is metadata for humans and tooling

The lock answers "may another coordinator start?" The PID/state metadata
answers "what is running and how do I report or stop it?"

### Service Takes Precedence

If an OS service-managed runtime is active, `jin start` must not spawn a
second detached daemon.

Instead, user-facing commands should surface that:
- jin is already running
- it is owned by the service manager
- service control is the appropriate path

### No Split Ownership

Jin must not permit:
- foreground runtime + daemon runtime on the same store
- daemon runtime + service runtime on the same store
- desktop helper process that independently runs ingest/push

There is one writer/coordinator per local store.

---

## Startup Sequence

The long-lived runtime startup sequence is:

1. Resolve the config directory, runtime state directory, and store path.
2. Check for an existing long-lived owner.
3. If a service runtime is active, surface that and stop.
4. If a daemon/foreground runtime is already active, surface that and stop.
5. Acquire runtime ownership.
6. Open the store and run pending SQLite migrations.
7. Load config and snapshot it for this run.
8. Detect active adapters and create sinks.
9. Start the local control/status boundary.
10. Start the pipeline coordinator.
11. Report running status.

The order matters:
- ownership must be established before background work starts
- store migration must complete before pipeline work starts
- the status boundary should not claim "running" before the runtime is
  actually ready

---

## First-Run Experience

For personal/local-first use, `jin start` should be sufficient on a fresh
machine.

On first run, if no durable config exists yet, jin should:
1. create default local config
2. detect available adapters
3. open/create the local store
4. start the runtime

This keeps the primary user journey simple:
- install jin
- run `jin start`
- indexing begins

There is no separate `jin init` command. `jin start` handles bootstrap.

Managed deployment may pre-seed config or workspace enrollment before first
launch, but that is an enterprise packaging concern layered on top of the same
runtime model.

---

## Shutdown Sequence

Graceful shutdown is part of normal operation, not an edge case.

### Stop is a control-plane priority event

Stop is not "just another work item eventually drained in FIFO order."
When a user types `jin stop` — especially in a panic — they mean "freeze
the system as soon as safely possible," not "after the next 200 queued
things, please stop."

**Stop preempts scheduling, not in-flight code.** The coordinator:

1. Immediately stops accepting/enqueuing normal work
2. Closes watchers immediately
3. Cancels timers immediately
4. Skips any queued ingest/push work not yet started
5. If a work item is already in flight: lets it finish (or hit a bounded
   cancellation point), then proceeds to shutdown

This gives low stop latency without partial-state interruption inside
arbitrary code. See BP-02 for how the coordinator implements this.

### Shutdown steps

1. Mark runtime state as `stopping`.
2. **Preempt the queue:**
   - discard all pending normal work items (ingest, push, reconcile)
   - close watchers
   - cancel periodic timers
3. Wait for any in-flight work item to complete (bounded by work-item
   timeout, not the full queue backlog).
4. Run a final best-effort flush:
   - one shutdown ingest scan (captures debounced file changes)
   - one final push of accumulated changes
   - close sinks
5. Close the store.
6. Remove runtime ownership state.
7. Exit.

This ordering preserves the BP-02 invariant that push is derived from
durable store state, while bounding stop latency to the cost of one
in-flight work item plus the final flush — not the full queue depth.

### Shutdown Budget

Graceful shutdown should have a bounded timeout of **15 seconds**.

If the pipeline has not completed its final flush within that budget, jin
should:
- log what work was abandoned
- rely on durable local state for recovery on next start
- exit rather than hang indefinitely

### Signals

SIGINT and SIGTERM should both trigger graceful shutdown.

If graceful shutdown exceeds the timeout budget, jin may:
- log the problem
- exit non-zero
- rely on durable local state for recovery on next start

The local store is the safety net. Shutdown should be graceful, but it does
not need to guarantee that every push completes before process death.

---

## Lifecycle Commands

Exact command names may evolve, but the lifecycle surface needs these roles.

### Start

`start` ensures a long-lived runtime exists.

Behavior:
- if already running, report success/no-op with current ownership info
- if service-managed runtime is active, report that instead of spawning daemon
- if not running, start the requested mode

### Stop

`stop` requests shutdown of the active long-lived runtime for this store.

Behavior:
- if stopped, no-op with clear output
- if daemon-owned, signal the daemon and wait for exit
- if service-owned, surface that service control is required or route through
  the service abstraction

### Restart

`restart` is lifecycle sugar:
- stop active runtime
- start again in the requested/default mode

### Status

`status` reports:
- whether a long-lived runtime exists
- which mode owns it
- process health
- adapter health
- sink health
- store path / config path
- paused/degraded conditions

`status` must work even when jin is stopped. It should not require the daemon
to be healthy in order to report useful information.

### Error Message Contract

Lifecycle commands must return actionable errors.

Every lifecycle error should tell the user:
- what happened
- which runtime owner is involved, if any
- what to do next

Examples:
- "jin is already running under launchd; use service control or stop the
  service before starting a detached daemon"
- "config changed on disk, but the active runtime will not see it until
  restart; run `jin restart` to apply"

---

## Runtime Health Model

The process lifecycle layer should distinguish at least these states:

| State | Meaning |
|-------|---------|
| `stopped` | No long-lived runtime is active |
| `starting` | Runtime ownership acquired; startup not yet complete |
| `running` | Pipeline is active and healthy enough to serve |
| `degraded` | Runtime is active but one or more subsystems are failing or paused |
| `stopping` | Graceful shutdown in progress |

`degraded` is still "running." It should not be treated as equivalent to
process death.

`degraded` must carry component-level detail. At minimum, status reporting
should distinguish:
- ingest-side degradation
- push-side degradation
- both

This keeps the top-level lifecycle state simple while still telling users
which subsystem is unhealthy.

Examples:
- one adapter timing out repeatedly → `degraded`
- one sink paused on schema mismatch → `degraded`
- no active process → `stopped`

---

## Command Interaction Rules

BP-07 does not define the entire command set, but it does define the lifecycle
rules that all commands must respect.

### Read-only commands

Read-only commands may run whether or not a long-lived runtime is active.

Examples:
- `jin show`
- `jin conversations`
- `jin search`
- `jin stats`
- `jin export`
- `jin status`

These commands may:
- read directly from the local store
- consult runtime ownership/status state
- return useful output even when jin is stopped

They must not:
- start a hidden second runtime
- mutate conversation state as a side effect

### Write-capable one-shot commands

Write-capable one-shot commands must respect the single-coordinator rule.

Examples:
- `jin ingest`
- future bootstrap/repair commands
- future repair/backfill commands

If no long-lived runtime is active, they may execute directly.

If a long-lived runtime is active, they must either:
- fail fast with a clear message, or
- delegate through the daemon boundary

They must not run a second independent ingest/push coordinator against the
same store.

### Config-mutating commands

Commands that change durable config may run while the daemon is active.

Examples:
- sink add/remove commands
- route/config update commands
- workspace connection commands

Their contract is:
- write durable config
- do not mutate the live runtime in place in v2
- surface clearly that the active runtime will see changes on restart or
  future explicit reload

This keeps runtime state and config state separate:
- config is durable intent
- the active runtime is a snapshot of that intent at process start

The same rule applies to managed deployment tooling:
- admins may place or update durable config on disk
- the active runtime does not absorb those changes until restart or future
  explicit reload

### Lifecycle commands

Lifecycle commands operate on the current runtime owner.

Examples:
- `start`
- `stop`
- `restart`

Their contract is:
- inspect runtime ownership first
- avoid creating duplicate owners
- route behavior based on whether ownership is foreground, daemon, or service

### Desktop interactions

Desktop must follow the same lifecycle rules as CLI commands.

It may:
- request start/stop/restart through the daemon boundary
- read runtime and health state
- trigger higher-level user workflows through stable local APIs

It must not:
- bypass runtime ownership checks
- start a second hidden coordinator
- hot-edit live runtime state behind the CLI's back

---

## Daemon ↔ Desktop Boundary

Desktop needs a stable local boundary from the daemon/runtime layer. BP-07 owns
the lifecycle invariant; BP-11 catalogs the concrete daemon routes and Electron
IPC channels exposed across that boundary.

### What belongs on that boundary

- lifecycle control:
  - start
  - stop
  - restart
- runtime status:
  - mode
  - pid or equivalent
  - uptime
  - state (`running`, `degraded`, etc.)
- health summary:
  - active adapters
  - adapter errors
  - sink readiness / paused state
  - queue/backlog summary

### What does NOT belong on that boundary

- duplicate ingestion logic
- a second watcher implementation
- direct sink control logic inside Desktop
- backend-specific Team migration concerns

### Query access

Desktop may use daemon-exposed query capabilities or other stable local APIs
that sit over the canonical store.

What it must not do is depend on:
- random filesystem scraping
- undocumented PID/log conventions
- a separate local database schema

BP-07 does not mandate the transport for this boundary. It may be:
- local HTTP
- a Unix domain socket
- a named pipe
- direct library calls inside a single packaged app

The invariant is architectural:

> Desktop is a client of the daemon boundary, not a second runtime.

The current route/channel surface is defined in
[BP-11: Desktop Daemon Boundary](BP-11-desktop-daemon-boundary.md).

---

## Relationship to One-shot Commands

One-shot commands reuse the same lower layers without becoming part of the
long-lived runtime.

Examples:
- `jin ingest` may call pipeline ingest/push helpers directly, then exit
- query commands may open the store, read, and exit

This is an intentional property of the architecture:
- pipeline logic is reusable
- daemon lifecycle is a wrapper around long-lived ownership
- not every command should need a background process

---

## What This Blueprint Does NOT Cover

| Topic | Blueprint |
|-------|-----------|
| Adapter parsing and change detection | BP-04 |
| Ingest → store → push flow | BP-02 |
| SQLite schema and revision tracking | BP-05 |
| Generic sink interface and provisioning rules | BP-06 |
| Workspace/team config and route matching | BP-08 |
| UI behavior inside Desktop | BP-Product-Strategy |
