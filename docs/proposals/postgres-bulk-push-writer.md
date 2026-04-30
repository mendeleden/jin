---
title: "Bulk Postgres Push Writer for Backfill and Repush"
status: proposed
created: 2026-04-30
relates-to: [BP-06, BP-08, BP-10]
---

# Bulk Postgres Push Writer for Backfill and Repush

## Summary

The current Postgres sink is correct but operationally too slow for real
remote backfills.

Today the sink writes one conversation at a time and then inserts every
message and tool call one row at a time inside that conversation's
transaction. Over a remote Postgres connection, that turns a historical
backfill into thousands of SQL round trips for a small number of
conversations.

This proposal recommends:

1. keep the current v2 sink contract and routing semantics unchanged
2. keep the current per-conversation replacement semantics unchanged
3. replace row-at-a-time message and tool-call inserts with bulk inserts
4. add a targeted benchmark plan at `10`, `100`, and `1000` conversations
5. use those measurements to decide whether repush/runtime batch sizes also
   need tuning

The goal is not a theoretical cleanup. The goal is to make:

- first push after `jin sink add`
- `jin sink repush`
- historical backfill to Postgres

finish in a reasonable time on a real remote target.

## Problem

The live Railway run shows two distinct issues:

1. transport behavior is sensitive
2. even when writes land, throughput is far below what operators should
   expect

The transport issue mattered:

- `?sslmode=require` produced repeated `Connection closed` failures
- removing `sslmode=require` allowed rows to land

But transport sensitivity is not the whole problem.

Even after that change, throughput remained too low.

### Current writer shape

The current writer in
[postgres.ts](/Users/edenmendel/Documents/GitHub/jin/src/sinks/postgres.ts)
does this for every conversation:

1. upsert one conversation row
2. delete that conversation's tool calls
3. delete that conversation's messages
4. insert each message individually
5. insert each tool call individually

Relevant code:

- [watch.ts](/Users/edenmendel/Documents/GitHub/jin/src/commands/watch.ts#L155)
- [push.ts](/Users/edenmendel/Documents/GitHub/jin/src/pipeline/push.ts#L136)
- [postgres.ts](/Users/edenmendel/Documents/GitHub/jin/src/sinks/postgres.ts#L98)
- [postgres.ts](/Users/edenmendel/Documents/GitHub/jin/src/sinks/postgres.ts#L130)
- [postgres.ts](/Users/edenmendel/Documents/GitHub/jin/src/sinks/postgres.ts#L267)

### Live baseline

On the live `jin sink repush` run against Railway:

- repush batch size was `20`
- batch `1` completed with `20` successful conversations
- batch `2` then ran for multiple minutes

For those first `20` successful conversations, the local store contained:

- `1356` messages
- `1422` tool calls

That implies a minimum of about:

- `20` conversation upserts
- `40` delete statements
- `1356` message inserts
- `1422` tool-call inserts
- total: about `2838` SQL statements

for only `20` conversations.

That is the dominant reason the run is slow.

### Why this is not just a queue bug

Local push bookkeeping now looks coherent:

- `_jin_push_state` records successful rows
- dirty conversations decrease when a batch completes
- the sink does eventually land rows remotely

So the primary problem is not "push state is broken."

The primary problem is:

- too many SQL statements
- over a high-latency remote Postgres path

## Design Goals

- preserve current v2 sink contract
- preserve current route-at-push-time semantics
- preserve per-conversation replace semantics
- keep correctness easier to reason about than a cross-conversation merge plan
- reduce round trips by at least one order of magnitude for realistic batches
- leave behind a repeatable benchmark that makes regressions obvious

## Non-Goals

- do not redesign routing
- do not redesign `_jin_push_state`
- do not introduce a new sink contract
- do not change identity projection semantics (`team_id`, `user_id`)
- do not solve all Railway transport issues in the same packet

## Recommendation

Implement this in two steps.

### Step 1: bulk rows within one conversation transaction

Keep one transaction per conversation, but change the write shape from:

- `1 upsert + 2 deletes + N message inserts + M tool-call inserts`

to:

- `1 upsert + 2 deletes + 1 bulk message insert + 1 bulk tool-call insert`

That keeps the current correctness model intact:

- one conversation succeeds or fails as a unit
- push result mapping still stays per conversation
- partial batch failures still degrade cleanly

But it cuts SQL statement count dramatically.

For the measured `20`-conversation batch above:

- current floor: about `2838` statements
- proposed floor: about `100` statements
- rough statement reduction: about `28x`

That does not guarantee `28x` faster wall time, but it is the right order of
magnitude change.

### Step 2: benchmark repush/runtime batch sizing after Step 1

After the writer is no longer row-at-a-time, re-measure:

- repush with batch size `20`
- repush with batch size `50`
- repush with batch size `100`

Runtime push currently uses batch size `2` in
[watch.ts](/Users/edenmendel/Documents/GitHub/jin/src/commands/watch.ts#L155).

That tiny runtime batch may still be the right choice for a live daemon, but
we should not guess. We should measure it after the sink itself stops being
pathologically chatty.

## Alternatives Considered

### Option A: only raise push batch size

Description:

- leave the writer as-is
- push more conversations per batch

Why reject it:

- the writer still processes payloads sequentially
- each conversation still emits hundreds of statements
- this makes each batch heavier without fixing the root cause

This treats the symptom, not the cost model.

### Option B: one transaction for the entire push batch

Description:

- rewrite one whole push batch in a shared transaction

Why not first:

- much harder failure isolation
- much harder result mapping
- higher blast radius if one row shape is bad
- more review surface than needed for the first throughput win

This may be worth revisiting later, but it is not the right first change.

### Option C: copy/load path (`COPY`, temp tables, merge)

Description:

- stage payload rows into temp tables and merge server-side

Pros:

- potentially best absolute throughput

Why not first:

- much larger implementation and test surface
- harder to keep portable across Bun SQL behavior and hosted Postgres quirks
- overkill before measuring the simpler bulk-insert path

This is a good second-wave option only if Step 1 still misses the target badly.

## Proposed Implementation

### Postgres sink

In
[postgres.ts](/Users/edenmendel/Documents/GitHub/jin/src/sinks/postgres.ts):

1. keep one conversation transaction
2. keep conversation upsert unchanged
3. keep message/tool-call deletes unchanged
4. replace `for ... await insertMessage(...)` with a multi-row insert builder
5. replace `for ... await insertToolCall(...)` with a multi-row insert builder

That likely means new helpers along the lines of:

- `insertMessagesBulk(messages, query)`
- `insertToolCallsBulk(toolCalls, query)`

Implementation constraints:

- preserve parameterization
- chunk oversized inserts if needed
- keep column order identical to the current single-row inserts
- keep empty-array behavior cheap

### Diagnostics

Keep the current push diagnostics and add one more useful signal if needed:

- rows/messages/toolCalls in the batch

That will let us correlate throughput drops to payload shape, not just
conversation count.

### Runtime tuning

Do not change runtime push batch size in the same first patch unless the
benchmark makes the need obvious.

Reason:

- sink writer inefficiency is already enough to explain the current slowness
- changing both at once will muddy the benchmark story

## Benchmark Plan

This work is not complete until we can show the gain at `10`, `100`, and
`1000` conversations.

### Why these scales

- `10` conversations catches small-backfill/operator feel
- `100` conversations catches normal repush/backfill behavior
- `1000` conversations catches whether the design still bends under realistic
  history depth

### Benchmark dimensions

Measure at each scale:

1. total push wall time
2. per-conversation throughput
3. per-message/tool-call throughput
4. peak parent RSS during push
5. number of successful conversations
6. number of failed conversations

### Benchmark environments

Run each scale in two environments:

1. local Postgres
2. representative remote Postgres target

Reason:

- local Postgres isolates SQL statement volume and transaction shape
- remote Postgres exposes the actual WAN/hosted-latency cost

If local improves dramatically and remote does not, the next problem is
transport/host behavior, not the writer shape.

### Benchmark matrix

At minimum:

| Scale | Dataset | Sink target | Batch size | Expected purpose |
|------|---------|-------------|------------|------------------|
| 10 conversations | representative Codex-heavy sample | local Postgres | 20 | small backfill sanity |
| 100 conversations | representative mixed sample | local Postgres | 20 | statement reduction proof |
| 1000 conversations | representative mixed sample | local Postgres | 20 | scaling curve |
| 10 conversations | same | remote Postgres | 20 | operator feel |
| 100 conversations | same | remote Postgres | 20 | practical improvement |
| 1000 conversations | same | remote Postgres | 20 | real backfill feasibility |

After Step 1, repeat the remote runs with:

- batch size `50`
- batch size `100`

only if Step 1 already stabilizes correctness.

### Dataset shape

Use conversation samples with real message/tool-call density, not just flat
"one message each" fixtures.

The current live run already shows why:

- conversation count alone is not predictive
- tool-call heavy Codex sessions dominate write cost

So the benchmark report should include:

- total conversations
- total messages
- total tool calls
- average and max messages per conversation
- average and max tool calls per conversation

### Harness

Use the existing perf harness and BP-10 artifact model as the base:

- [BP-10-performance-validation.md](/Users/edenmendel/Documents/GitHub/jin/docs/blueprint/BP-10-performance-validation.md)
- [test/perf-harness/README.md](/Users/edenmendel/Documents/GitHub/jin/test/perf-harness/README.md)

But this packet should add a targeted push-throughput surface rather than rely
only on ingest-heavy end-to-end numbers.

That can be either:

- a new focused benchmark mode, or
- a narrow script under `test/perf-harness/scripts/`

as long as it produces reviewable artifacts.

### Pass criteria

This packet should not declare success on "seems faster."

It should show:

1. no correctness regression in pushed rows
2. meaningful wall-time reduction at `10`, `100`, and `1000` conversations
3. a visibly flatter scaling curve than the current row-at-a-time writer

The exact percentage target should come from the measured baseline, but the
bar should be high enough that the improvement is obvious, not statistical
noise.

## Risks

### Risk: oversized SQL statements

Bulk inserts can become too large for one statement.

Mitigation:

- chunk message and tool-call inserts by row count or parameter count

### Risk: hidden correctness drift in column ordering

Bulk builders can silently scramble parameters.

Mitigation:

- keep the single-row helper as the source of truth while building the bulk
  variant
- add focused tests that compare single-row and bulk-row outcomes

### Risk: transport issues still dominate remote runs

The writer change may expose a second bottleneck.

Mitigation:

- benchmark both local and remote
- keep the proposal honest about what the writer fix did and did not solve

## Validation Plan

Before merge:

1. focused Postgres sink tests for bulk message/tool-call writes
2. repush path verification with a real Postgres target
3. benchmark artifacts at `10`, `100`, `1000` conversations
4. explicit before/after comparison in the packet report

## Recommendation

Proceed with Step 1 now:

- bulk message inserts
- bulk tool-call inserts
- no contract changes
- no batch-size changes in the same first patch

Then benchmark the result at `10`, `100`, and `1000` conversations and decide
whether batch-size tuning or a deeper batch-transaction design is still needed.
