---
title: Go parser spike ground-truth verification
date: 2026-05-01
status: review
related:
  - docs/spikes/go-parser-claude-code.md
  - docs/spikes/go-parser-benchmarks.md
  - tools/parser-spike/go-parser/main.go
  - tools/parser-spike/ts-bench.ts
  - src/adapters/claude-code.ts
---

# Go parser spike ground-truth verification

This note compares the written spike claims against fresh reruns and direct
source inspection. It is intentionally adversarial. The question is not
whether the Go spike is promising. The question is whether the current docs
accurately describe what was actually proven.

## Verification scope

- Re-read `docs/spikes/go-parser-claude-code.md`
- Re-read `docs/spikes/go-parser-benchmarks.md`
- Inspect `tools/parser-spike/go-parser/main.go`
- Inspect `tools/parser-spike/ts-bench.ts`
- Inspect `src/adapters/claude-code.ts`
- Re-run both implementations on:
  - `.spike-target.jsonl`
  - `.spike-target-1.77mb.jsonl`
- Compare emitted bundle hashes and message-content signatures

## Fresh rerun numbers

### Primary fixture: `.spike-target.jsonl`

Fresh rerun from this workstation:

| Implementation | Conversations | Messages | Tool calls | Input tokens | Output tokens | Cache read | Cache write | Internal time | Peak RSS |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| TS harness | 2 | 813 | 269 | 866 | 121,996 | 41,191,515 | 1,915,463 | 101.96 ms | 75.31 MB |
| Go spike | 2 | 813 | 269 | 866 | 121,996 | 41,191,515 | 1,915,463 | 45.27 ms | 16.77 MB |

These fresh reruns confirm the aggregate-parity claim for this fixture and
confirm a real speed/RSS win on this machine.

### Sub-agent fixture: `.spike-target-1.77mb.jsonl`

Fresh rerun from this workstation:

| Implementation | Conversations | Messages | Tool calls | Input tokens | Output tokens | Cache read | Cache write | Internal time | Peak RSS |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| TS harness | 1 | 547 | 193 | 2,083 | 73,100 | 28,497,665 | 1,071,126 | 68.63 ms | 67.75 MB |
| Go spike | 1 | 547 | 193 | 2,083 | 73,100 | 28,497,665 | 1,071,126 | 32.59 ms | 12.77 MB |

Again: aggregate parity holds. Exact semantic parity does not.

## Exact-parity result

The spike docs are correct that hashes do not match. Fresh normalized bundle
hashes for `.spike-target.jsonl` still differ:

| Bundle | TS hash | Go hash | Match |
|---|---|---|---|
| 0 | `114694054f22ce3903e200875fe66c6147a24155a1f8494f588f30ebd393df22` | `cc93c2cdc0ec7d4f05de189ee1d595c5b462bf460bb949e3f0f8a3fd9235adde` | no |
| 1 | `c4481582ec15186a3c1e75cc01b0fdb211b2111be9b27cdacb8d818faccfb987` | `f5157def1406f34a417a393d468fc70389ed334eb2078532fe91e9c93f6f952b` | no |

The first content-signature mismatch on bundle 0 is a tool-only assistant
message:

- TS content: `"[tool:Bash]"`
- Go content: `""`

That difference is real and repeatable.

## Claim-by-claim comparison

### Claim: 2.0-2.5x faster wall time, 7-8x lower RSS

Source:
- `docs/spikes/go-parser-claude-code.md:12`
- `docs/spikes/go-parser-benchmarks.md:48-55`

Ground truth:
- Supported for the small real fixtures listed in the benchmark doc.
- Fresh reruns on the primary fixture were `101.96 ms` TS vs `45.27 ms` Go
  and `75.31 MB` TS vs `16.77 MB` Go.

Assessment:
- Substantively true for the measured batch harness.
- Not by itself proof of production memory behavior.

### Claim: exact aggregate parity

Source:
- `docs/spikes/go-parser-claude-code.md:39-57`

Ground truth:
- Supported for the two rerun fixtures above.
- Counts and token totals matched exactly on both fresh reruns.

Assessment:
- True as stated for the checked fixtures.

### Claim: only 6 semantic discrepancies block hash parity

Source:
- `docs/spikes/go-parser-claude-code.md:61-72`

Ground truth:
- The six listed discrepancy classes are real.
- Fresh diffs confirmed at least these concrete mismatches:
  - `compact_boundary` belongs to the continuation segment in TS but the root
    segment in Go.
  - TS uses synthetic fallback content for tool-only assistant messages; Go
    leaves content empty.
  - TS extracts `tool_result` text into message content; Go can leave content
    empty.
  - TS sets system/summary turns to `-1`; Go uses current turn state for
    system messages.
  - TS message sequences are per-segment and 1-indexed; Go uses one global
    counter starting at `0`.
  - TS resolves `parentMessageId` through parsed-message IDs; Go copies raw
    `parentUuid`.

Assessment:
- Directionally true but incomplete as written.
- The doc understates that some listed categories cascade into bundle shape
  differences, message-count-per-bundle differences, and parent-link
  differences.

### Claim: all six are mechanical fixes, ~5-15 lines each

Source:
- `docs/spikes/go-parser-claude-code.md:72`

Ground truth:
- Not proven.
- Some isolated content fallbacks are small.
- But compact-boundary placement, per-segment sequence semantics,
  `parentMessageId` mapping via parsed IDs, and TS-consistent turn handling are
  entangled with how the parse loop stages messages and segments.

Assessment:
- Overstated.
- The fixes may still be straightforward, but the current evidence does not
  justify the line-count estimate.

### Claim: the Go spike treats sub-agent files as standalone roots

Source:
- `docs/spikes/go-parser-claude-code.md:79`

Ground truth:
- Supported.
- The Go spike initializes the root segment lazily from the first
  `user`/`assistant` record and does not implement parent resolution:
  `tools/parser-spike/go-parser/main.go:288-295`.
- The TS adapter resolves spawned relationships and fork points through parent
  bundle inspection in `src/adapters/claude-code.ts:1302-1360`.

Assessment:
- True.

### Claim: replacing the Bun subprocess with Go is a drop-in swap at one seam

Source:
- `docs/spikes/go-parser-claude-code.md:87-93`

Ground truth:
- Overstated.
- The IPC seam is real in `src/pipeline/ingest-worker.ts`, but the Go spike
  does not implement the JSON-RPC protocol, deterministic IDs,
  `exportDiscoveryState()`, or sub-agent parent resolution.
- The current spike emits one JSON file and exits.

Assessment:
- The seam exists.
- “Drop-in swap” is not yet demonstrated.

### Claim: benchmark harnesses do equivalent work

Source:
- `docs/spikes/go-parser-benchmarks.md:22-24`

Ground truth:
- False as written.
- TS stages a temp Claude project layout and exercises both `findChanged()` and
  `loadConversation()` in `tools/parser-spike/ts-bench.ts:23-59`.
- Go parses a single file directly and writes JSON from one process in
  `tools/parser-spike/go-parser/main.go:488-552`.
- The TS adapter path also includes behavior the Go spike explicitly marks out
  of scope, including deterministic IDs, git lookup, and sub-agent handling.

Assessment:
- The benchmark is still useful.
- It is not an apples-to-apples replacement proof.

### Claim: streaming Go would likely hold ~15 MB constant and show ~10x RSS reduction at scale

Source:
- `docs/spikes/go-parser-benchmarks.md:109-127`

Ground truth:
- Unverified estimate.
- No streaming Go worker was implemented or measured.
- The claim may be directionally plausible, but the repo contains no evidence
  proving this number.

Assessment:
- Speculation, not measurement.

### Claim: reproduction instructions are complete

Source:
- `docs/spikes/go-parser-benchmarks.md:145-163`

Ground truth:
- False.
- The doc references `tools/parser-spike/stage-fixtures.sh`, but that file does
  not exist in the repo.

Assessment:
- Reproduction section is incomplete.

## Source-level discrepancies confirmed

### 1. Compact-boundary placement

TS opens the new compacted segment before parsing the `compact_boundary`
message:
- `src/adapters/claude-code.ts:946-959`
- `src/adapters/claude-code.ts:1098-1102`

Go appends the boundary to the current segment, then opens the new one:
- `tools/parser-spike/go-parser/main.go:297-320`

Observed effect on `.spike-target.jsonl`:
- TS bundles: `802` messages + `11` messages
- Go bundles: `803` messages + `10` messages

### 2. Tool-only assistant fallback content

TS synthesizes fallback content:
- `src/adapters/claude-code.ts:1203-1207`

Go does not:
- `tools/parser-spike/go-parser/main.go:352-440`

Observed effect:
- TS: `"[tool:Bash]"`
- Go: `""`

### 3. Tool-result content extraction

TS appends extracted `tool_result` output into message content:
- `src/adapters/claude-code.ts:1185-1193`

Go resolves tool output onto the prior tool call but does not append that
output to the current message content:
- `tools/parser-spike/go-parser/main.go:417-425`

Observed effect:
- Some user messages carry tool-result text in TS and empty content in Go.

### 4. Sequence semantics

TS sequence is per-segment and 1-indexed:
- `src/adapters/claude-code.ts:1041`
- `src/adapters/claude-code.ts:1059`

Go sequence is global and 0-indexed:
- `tools/parser-spike/go-parser/main.go:275`
- `tools/parser-spike/go-parser/main.go:306`
- `tools/parser-spike/go-parser/main.go:335`
- `tools/parser-spike/go-parser/main.go:365`

This means the spike doc's wording about TS using “source line number” is too
strong. The code increments per parsed message, not per raw line.

### 5. Turn semantics for system/sub-agent flows

TS explicitly pins summary/system messages to `turn: -1`:
- `src/adapters/claude-code.ts:1075`
- `src/adapters/claude-code.ts:1105`
- non-sidechain assistant/user turns in `src/adapters/claude-code.ts:1133-1141`

Go uses `current.turn` for system rows and increments user turns directly:
- `tools/parser-spike/go-parser/main.go:307`
- `tools/parser-spike/go-parser/main.go:336`
- `tools/parser-spike/go-parser/main.go:354-357`

Observed effect on `.spike-target-1.77mb.jsonl`:
- TS turns sample: `[-1]`
- Go turns sample: `[0]`

### 6. `parentMessageId` semantics

TS resolves `parentMessageId` from the map of parsed message IDs:
- `src/adapters/claude-code.ts:1060-1062`
- `src/adapters/claude-code.ts:1087`
- `src/adapters/claude-code.ts:1117`
- `src/adapters/claude-code.ts:1244-1247`

Go copies raw `parentUuid` directly:
- `tools/parser-spike/go-parser/main.go:368`

This is a real semantic difference beyond message IDs alone.

## Bottom line

### What Claude’s writeup got right

- The Go spike is real code, not just a memo.
- The benchmark results show a real speed and RSS advantage in the measured
  batch harness.
- Aggregate parity can be reached on the checked fixtures.
- Exact semantic parity has not been reached.

### What Claude’s writeup overstated

- “Equivalent work” between harnesses.
- “Drop-in swap at one seam.”
- “All six fixes are mechanical and tiny.”
- The streaming-memory numbers as if they were already evidenced.
- The completeness of the reproduction instructions.

## Recommended doc fixes

1. Change “equivalent work” to “comparable aggregate-output benchmark, but not
   production-equivalent behavior.”
2. Change “drop-in swap” to “promising seam, but JSON-RPC worker parity is not
   implemented.”
3. Remove or soften the “5-15 lines each” estimate.
4. Mark the streaming RSS numbers as explicit estimates, not validated results.
5. Fix the reproduction section or add the missing staging script.
6. Add `parentMessageId` semantics to the documented mismatch list.

## Should the adapter design be revisited?

Yes. This review suggests the current adapter surface is carrying more
tool-specific semantic reconstruction than the spike docs acknowledge, and that
is exactly what makes a cross-language port look deceptively small.

### Why this matters

- The adapter contract looks simple at the top level: return
  `ConversationBundle`.
- The real Claude adapter behavior is not just parsing rows into that shape.
  It also reconstructs:
  - compacted segment boundaries
  - per-segment message sequencing
  - synthetic content fallbacks
  - parsed-message parent linkage
  - sub-agent lineage and fork points
  - discovery-state reuse
- Those semantics are currently implicit in one TS implementation rather than
  called out as an explicit portability surface.

### What this means for the Go experiment

- If the goal is only “faster parser for one adapter,” the current spike is a
  useful direction.
- If the goal is “repeatable multi-language adapter strategy,” the adapter
  contract likely needs a design pass first.
- Right now too much correctness lives in adapter-local behavior that is easy
  to miss when reimplementing from another language.

### Recommended follow-up

1. Document the Claude adapter’s semantic obligations explicitly, separate from
   the high-level `ConversationBundle` type.
2. Decide which fields are true contract and which are derived convenience.
3. Consider narrowing the adapter surface so cross-language workers can emit a
   lower-level normalized event stream, with some reconstruction moved into a
   shared parent layer if that better matches BP-04 and BP-02 constraints.
4. If the current adapter shape stays frozen, treat the TS Claude adapter as
   the executable spec and require fixture-level hash parity before claiming a
   replacement is viable.
