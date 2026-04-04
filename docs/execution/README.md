# Execution System

This directory is the operating system for blueprint-driven implementation.

It exists to answer one question:

> How do we let fresh-context agents write code in parallel without drifting
> away from the BP docs or stepping on each other's work?

The answer is:

- blueprint docs are the source of truth
- `codex-BRAIN` freezes contracts and integrates
- `cursor-REVIEWER-*` or `claude-code-REVIEWER-*` audits drift and reports progress
- `codex-WORKER-*` executes one narrow packet at a time
- live progress is tracked in a shared control plane outside branch-local docs

## Static Vs Live

The execution OS now has two layers:

- `docs/execution/`
  - committed, reviewable, branchable specification
- shared control plane
  - a single live state directory, usually `.execution/`, shared across all
    agents on the machine

The spec explains how the system works.
The control plane tells you what is happening right now.

## Contents

- `00-global-rules.md`
  - universal rules for every agent and every packet
- `01-dispatch-protocol.md`
  - how to launch work, what to send, how to host agents
- `02-progress-and-audit.md`
  - status vocabulary, Cursor report shape, Codex merge gate
- `03-blueprint-task-map.md`
  - canonical mapping from each BP file to one or more execution packets
- `05-live-control-plane.md`
  - the centralized live-state model for multi-agent progress tracking
- `templates/`
  - templates for initializing the live control plane
- `prompts/`
  - reusable launch prompts for the first Codex and Cursor sessions
- `tasks/`
  - concrete execution packets

## Operator Quick Start

1. Start with `00-global-rules.md`.
2. Read `01-dispatch-protocol.md`.
3. Read `03-blueprint-task-map.md`.
4. Read `05-live-control-plane.md`.
5. Initialize the shared control plane at `.execution/` or another chosen
   control directory.
6. Execute `tasks/W0-CODEX-01-contract-freeze.md`.
7. Start `tasks/W0-CURSOR-01-drift-audit.md` and keep it running as the
   audit lane.
8. After contract freeze, dispatch Wave 1 worker packets in parallel.
9. Use Wave 2 and Wave 3 packets to finish blueprint coverage and surface
   cleanup.
10. Let Codex perform the integration pass for any glue that packets
   intentionally forbid.

## Core Roles

### `codex-BRAIN`

`codex-BRAIN` owns:

- contract freeze
- cross-boundary decisions
- packet maintenance
- authoritative packet assignment state
- review and approval
- integration glue across lanes

### `*-REVIEWER-*`

`cursor-REVIEWER-*` or `claude-code-REVIEWER-*` owns:

- drift detection
- progress reporting
- boundary-spread detection
- blueprint scoreboard updates in the control plane
- review artifacts

Reviewers do not own architecture or implementation policy.

### `codex-WORKER-*`

`codex-WORKER-*` owns:

- one bounded code slice
- one packet at a time
- only the files listed in the packet
- their live heartbeat and progress notes in the control plane

`codex-WORKER-*` does not own:

- global contracts
- packet redesign
- cross-lane integration
- the overall program scoreboard

## Packet Catalog

### Wave 0

- `W0-CODEX-01-contract-freeze.md`
  - Codex-only. Freezes the one-way doors and updates packets if needed.
- `W0-CODEX-02-live-control-plane-bootstrap.md`
  - Codex-only. Initializes the shared control plane and packet registry.
- `W0-CURSOR-01-drift-audit.md`
  - Cursor-only. Reports drift and progress across the whole program.

### Wave 1

- `W1-DB-01-store-spine.md`
  - v2 store, migration, revision, and bundle-write path
- `W1-ROUTING-01-routing-config-core.md`
  - pure routing engine and v2 config core
- `W1-LIFECYCLE-01-runtime-boundary.md`
  - runtime ownership, lifecycle commands, status model
- `W1-ADAPTER-01-claude-code-reference.md`
  - reference rich adapter on the v2 contract
- `W1-SINK-01-webhook-reference.md`
  - reference thin sink on the v2 push contract
- `W1-PIPE-01-pipeline-spine.md`
  - serial coordinator wiring ingest, store, routing, and sinks

### Wave 2

- `W2-ADAPTER-02-codex-reference.md`
  - second reference adapter for BP-04 and BP-03 semantics
- `W2-ADAPTER-03-cursor-reference.md`
  - shared-database adapter reference lane
- `W2-ADAPTER-04-simple-adapters-bulk-port.md`
  - bulk port of lower-complexity adapters onto frozen contracts
- `W2-SINK-02-postgres-reference.md`
  - table sink reference implementation
- `W2-SINK-03-s3-reference.md`
  - object sink reference implementation
- `W2-CMD-01-read-only-query-surface.md`
  - v2 read-only CLI and trace/tree query surface
- `W2-CONFIG-02-mutation-and-control-commands.md`
  - sink/route/config mutation commands and pause/resume behavior
- `W2-DAEMON-02-local-control-boundary.md`
  - stable local control/status boundary for daemon clients

### Wave 3

- `W3-MODULE-01-layout-alignment.md`
  - align repo structure to BP-01 and retire legacy bridges
- `W3-PRODUCT-01-command-surface-reframe.md`
  - finish product-boundary and command-surface alignment to BP-Product

## Recommended Dispatch Order

1. Codex completes `W0-CODEX-01-contract-freeze.md`.
2. Codex completes `W0-CODEX-02-live-control-plane-bootstrap.md`.
3. Cursor starts `W0-CURSOR-01-drift-audit.md`.
4. Dispatch these in parallel:
   - `W1-DB-01-store-spine.md`
   - `W1-ROUTING-01-routing-config-core.md`
   - `W1-LIFECYCLE-01-runtime-boundary.md`
5. Once the frozen contracts are stable enough, dispatch:
   - `W1-ADAPTER-01-claude-code-reference.md`
   - `W1-SINK-01-webhook-reference.md`
6. Dispatch `W1-PIPE-01-pipeline-spine.md` once the store and sink contracts
   are stable enough to wire together cleanly.
7. Dispatch Wave 2 reference lanes and command lanes.
8. Finish with Wave 3 structural cleanup and command-surface reframe.

## The Central Progress Rule

At any moment, the answer to "what is happening across agents right now?"
should be available in one place:

- shared control plane directory, usually `.execution/`

If the answer only exists in:

- a branch
- a chat thread
- a worker's memory
- an unmerged diff

then the execution OS is failing.

## Design Principle

The unit of parallelism is not "a ticket."

The unit of parallelism is:

- one blueprint-owned boundary
- one owned file set
- one completion contract

If a proposed task crosses more than one boundary, it should be split or
pulled back to Codex.
