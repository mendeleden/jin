# Blueprint To Task Map

This file is the canonical mapping from each blueprint to the execution
packets that implement it.

Use it to answer:

- which packet is responsible for a given BP concept
- which blueprints are already covered by existing packets
- which packets are prerequisite to full blueprint alignment

## Coverage Rule

One blueprint may map to multiple packets.

That is expected. The important requirement is:

> every BP must have at least one explicit implementing packet, and every
> packet must name the BPs it advances.

## Map

| Blueprint | What It Owns | Primary Packets | Notes |
|---|---|---|---|
| `BP-01-module-map.md` | system layering, directory ownership, dependency boundaries | `W0-CODEX-01`, `W1-DB-01`, `W1-PIPE-01`, `W1-LIFECYCLE-01`, `W3-MODULE-01` | BP-01 is spread across the structure of the codebase, so it lands through several packets plus a final layout alignment pass. |
| `BP-02-data-flow.md` | ingest → store → push flow, queue semantics, shutdown flush | `W0-CODEX-01`, `W1-DB-01`, `W1-PIPE-01`, `W1-SINK-01`, `W2-SINK-02`, `W2-SINK-03` | BP-02 is the heart of the runtime and depends on stable store and sink contracts. |
| `BP-03-conversation-model.md` | trace tree, parent/child semantics, compacted/spawned/forked relationships | `W0-CODEX-01`, `W1-DB-01`, `W1-ADAPTER-01`, `W2-ADAPTER-02`, `W2-ADAPTER-03`, `W2-CMD-01` | BP-03 lands partly in schema, partly in adapter output, and partly in the read/query surface. |
| `BP-04-adapter-contract.md` | adapter interface, deterministic IDs, change detection, tool calls | `W0-CODEX-01`, `W1-ADAPTER-01`, `W2-ADAPTER-02`, `W2-ADAPTER-03`, `W2-ADAPTER-04` | One reference adapter is not enough for BP-04. At least one append-only and one shared-db adapter should validate the contract. |
| `BP-05-store-and-migration.md` | store schema, bundle writes, revisions, sync state | `W0-CODEX-01`, `W1-DB-01`, `W2-CMD-01` | BP-05 is primarily a store lane with some downstream query/read-surface implications. |
| `BP-06-sink-contract.md` | generic sink interface, sink families, no remote provisioning | `W0-CODEX-01`, `W1-SINK-01`, `W2-SINK-02`, `W2-SINK-03`, `W2-CONFIG-02` | BP-06 needs one delivery sink, one table sink, and one object sink to be pressure-tested in code. |
| `BP-07-process-lifecycle.md` | one runtime owner, lifecycle states, shutdown, daemon boundary | `W0-CODEX-01`, `W1-LIFECYCLE-01`, `W1-PIPE-01`, `W2-DAEMON-02`, `W2-CMD-01` | BP-07 spans both process control and the read-only command/query behavior that works when stopped. |
| `BP-08-routing-and-config.md` | routing semantics, config schema, mutation commands, pause/resume | `W0-CODEX-01`, `W1-ROUTING-01`, `W2-CONFIG-02`, `W2-CMD-01` | BP-08 is not done when matching works; mutation and control semantics must land too. |
| `BP-Product-Strategy.md` | daemon vs desktop vs team vs integrations product boundary | `W0-CODEX-01`, `W1-LIFECYCLE-01`, `W2-DAEMON-02`, `W2-CONFIG-02`, `W3-PRODUCT-01` | BP-Product is mostly a boundary/command-surface concern inside this repo. |

## Wave Summary

### Wave 0

Freeze the one-way doors so all later packets can execute safely.

### Wave 1

Build the thin vertical spine:

- store
- routing/config core
- lifecycle boundary
- one rich adapter
- one thin sink
- serial pipeline

### Wave 2

Expand coverage to the remaining critical blueprint surfaces:

- more adapters
- more sink families
- read-only query surface
- config mutation/control commands
- stable daemon control boundary

### Wave 3

Finish structure and product-surface alignment:

- file layout and module ownership cleanup
- CLI/product-boundary reframe

## Progress Rule

When reporting progress, use this file to decide whether a BP is:

- only frozen
- partially implemented
- mostly aligned
- fully aligned

A blueprint is not `aligned` until the implementing packets named here are
done and Cursor finds no unresolved drift.
