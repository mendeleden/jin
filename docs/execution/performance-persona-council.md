# Performance Persona Council

Use this as a structured critique aid for perf, scale, and release-gate work.
These are archetypes, not claims about what any specific real person would say.

## How To Use It

- do not treat these lenses as authority
- do use them to force stronger questions before declaring perf work "done"
- in packet completion reports, include a short `Persona council` section when
  the packet touches perf, scale, runtime budgets, local-store pressure, or
  release validation

## Persona 1: Telemetry Agent Engineer

Archetype:
- ex-Datadog / observability-agent engineer

What this person cares about:
- idle RSS and steady-state RSS
- per-check / per-adapter working-set ceilings
- whether one bad source can take down the whole daemon
- whether instrumentation is cheap enough to leave on by default

Questions:
- what is the per-adapter memory budget?
- which phase owns the peak?
- is there a bounded unit of work, or can one scan absorb the whole process?
- what metrics would catch this regression before a user does?

## Persona 2: Streaming Pipeline Reliability Engineer

Archetype:
- ex-Vector / log-agent / stream-runtime engineer

What this person cares about:
- decoupling ingest from push
- bounded queues and backpressure
- replay / retry behavior after crashes
- whether restart loops redo too much work

Questions:
- where is the checkpoint boundary?
- what survives restart, and what intentionally does not?
- does a partial success still get pushed, or is it stranded behind one bad run?
- can one adapter or sink poison the full cycle?

## Persona 3: SQLite and Local-State Engineer

Archetype:
- engineer experienced with SQLite, WAL, local caches, and crash recovery

What this person cares about:
- WAL/SHM lifecycle
- checkpoint discipline
- what state is ephemeral versus repairable
- how much data is duplicated in memory before it reaches SQLite

Questions:
- what memory belongs to the adapter versus SQLite/page cache?
- what are the crash signatures and recovery paths?
- what can be persisted safely, and what should never be cached on disk?
- do shutdown and checkpoint paths allocate too much?

## Persona 4: High-Throughput Storage Engineer

Archetype:
- ex-ClickHouse / ingestion / storage-engine engineer

What this person cares about:
- batch sizing
- avoidable copies and full-structure serialization
- whether hashing, deletes, or recomputation are doing more work than needed
- asymptotic behavior at `10x` and `100x`

Questions:
- what is `O(files)`, `O(bytes)`, `O(conversations)`, and `O(messages)`?
- where are we cloning or stringifying whole bundles?
- does this design degrade cleanly at `100x`, or does it fall off a cliff?
- what work can move from hot path to bounded index/precompute?

## Persona 5: Developer Tooling and Release Engineer

Archetype:
- ex-Homebrew / Stripe CLI / large-scale developer-tool maintainer

What this person cares about:
- repeatable pre-release validation
- one command to reproduce the perf verdict
- actionable failures and known-good artifacts
- whether support burden is being offloaded onto users

Questions:
- what exact command runs before a release?
- what artifact proves the result?
- what is the failure message and next step?
- can someone other than the original author run this locally and in CI?

## What Good Looks Like

- each perf packet names which lenses matter most
- completion reports include a short synthesis, not just raw numbers
- release gates cite artifacts, not impressions
- if two lenses disagree, the packet states the tradeoff explicitly
