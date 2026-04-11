---
title: "BP-10: Performance Validation & Release Gate"
status: draft
created: 2026-04-08
depends-on: [BP-02, BP-04, BP-05]
informs: []
---

# BP-10: Performance Validation & Release Gate

## Principle

Performance validation is a **release contract**, not a best-effort spot check.

`BP-02` defines the runtime budgets and queue semantics. `BP-04` defines the
adapter memory contract. `BP-10` defines how a packet proves those contracts on
the paths that actually matter before a release, approval, or merge is treated
as trustworthy.

The goal is to stop learning about RSS regressions, startup backlogs, or
shutdown-flush failures only from a live workstation after the packet was
already declared done.

---

## When This Blueprint Applies

Use this blueprint whenever a packet changes or investigates:

- adapter `findChanged()` or `loadConversation()` behavior
- ingest or push batching, queueing, backpressure, or RSS guards
- store write/hash paths that affect startup or backlog memory
- shutdown-flush behavior on the long-lived runtime path
- any proposal to persist adapter checkpoint state for cold-start speed

Small CLI or docs-only edits do not need a BP-10 artifact unless they are the
only place a perf verdict now lives.

---

## Validation Ladder

Perf-sensitive work is validated in stages. Do not jump straight to "real
runtime works on my machine" without isolating the layers below it.

| Stage | Purpose | Required workload | Pass condition |
|------|---------|-------------------|----------------|
| Discovery-only | Isolate `findChanged({ kind: "startup-scan" })` and source-index memory | representative local dataset for the touched rich adapter or source family | must never hit the `256 MB` hard limit; rich-adapter discovery should normally stay below the `200 MB` warning threshold because ingest and push still need headroom |
| Ingest with representative store shape | Isolate store write, hash, and revision costs | temp store plus, when relevant, a copy of a representative local store snapshot | must stay below the `256 MB` hard limit; any warning-threshold crossing must be recorded with the phase and peak |
| Integrated startup | Exercise `ingestAll -> pushDirty` with realistic backlog and routing shape | representative local config plus a real or shape-preserving sink target | must stay below the `256 MB` hard limit end-to-end |
| Real runtime / shutdown | Validate the foreground, daemon, or service path that operators actually run | representative local workload on the installed or canonical local runtime path | no hard-limit kill during `ingest-adapter`, `push`, or `shutdown-flush`; shutdown may time out per BP-07, but not because RSS already exceeded the hard limit |

### Interpreting Warnings

The `200 MB` warning threshold is not itself a release blocker, but it is not
noise either.

- warning-threshold crossings must appear in the artifact with the exact phase,
  peak, and whether later stages still completed within the hard limit
- repeated warnings in discovery-only or ingest-only stages usually mean the
  packet has spent too much headroom before the integrated path even starts
- a packet that suppresses the warning or raises the hard limit is changing the
  BP-02 contract and needs a separate Codex decision

---

## Required Artifacts

Every BP-10 validation leaves behind a reviewable artifact under
`docs/execution/audits/` that records:

- exact commands
- dataset scope at run time
- peak RSS or other relevant resource measurements
- the phase that owned the peak
- whether the warning or hard limit fired
- whether remote push or shutdown behavior stayed blocked for a separate reason

The artifact should make it possible for another worker to rerun the verdict
without rediscovering which dataset, sink backlog, or local-store shape mattered.

If a packet changes multiple layers, one artifact may cover them together as
long as it clearly names each stage that was rerun.

---

## Local Versus CI

Both environments matter, but they prove different things.

| Environment | What it proves | Required expectation |
|-------------|----------------|----------------------|
| CI or other repeatable fixture/scale run | deterministic regression coverage on a known dataset | rerun or add focused automated coverage whenever a stable packet-owned harness exists |
| Representative local workload | real workstation backlog shape, real source files, real startup/shutdown path, and live config pressure | required for rich adapters, startup/backpressure changes, shutdown work, or any bug class that did not reproduce in fixture-scale CI |

Rules:

- CI does not replace representative local validation for rich-adapter or
  runtime-memory packets
- a local-only perf conclusion is not enough if the packet can reasonably leave
  behind CI-facing regression coverage
- if CI cannot represent the bug class yet, the packet must say that explicitly
  and leave a local artifact that another worker can rerun

---

## Persisted Adapter State

Default adapter checkpoint state remains **ephemeral and in memory**. Persisting
it is a future optimization, not a default design move.

Lightweight persisted adapter state is acceptable only when all of the
following are true:

1. representative BP-10 validation shows the bounded in-memory startup path
   still misses the release budget
2. the persisted data is limited to checkpoint metadata such as offsets, file
   stats, signatures, source-local ref IDs, parent maps, or scan cursors
3. corruption, version mismatch, or deletion degrades to a bounded full scan,
   not incorrect conversation data or changed BP-03/BP-05 semantics
4. the store owns the persistence and migration story explicitly

Not acceptable as persisted adapter state:

- full `ConversationBundle`s
- message bodies or tool-call payloads
- whole-source JSON, JSONL, or SQLite row snapshots
- sink push payloads or sink-specific retry buffers
- any cache whose correctness depends on surviving longer than a bounded
  adapter/source unit

Persisting more than lightweight checkpoints is no longer a perf optimization;
it is a runtime/storage design change that needs a separate blueprint decision.

---

## Release Gate

A perf-sensitive packet is not ready for approval until its completion report
states:

- which BP-10 stages were rerun
- where the artifact lives
- whether warnings fired and why they were acceptable or not
- whether representative local validation and CI validation both ran
- which remaining failures are truly outside the packet boundary

Future adapter, runtime, and scale packets should be able to cite this blueprint
directly instead of inventing a new perf checklist in each handoff.

---

## What This Blueprint Does NOT Cover

- the implementation details of a specific harness or dataset generator
- sink-throughput benchmarking or product-level SLAs
- ontology or runtime contract changes themselves
- replacing BP-02, BP-04, or BP-05 as the subsystem source of truth
