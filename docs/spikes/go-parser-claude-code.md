---
title: Go-based Claude Code JSONL parser — feasibility spike
date: 2026-05-01
status: spike (validated, not production)
related: [PERF_FINDINGS.md, BP-04, claude-code adapter]
---

# Go-based Claude Code JSONL parser — feasibility spike

## TL;DR

A throwaway Go parser of Claude Code JSONL achieves **2.0–2.5x faster wall time** and **7–8x lower peak RSS** than the existing TS adapter, with **byte-exact aggregate parity** but **6 semantic content discrepancies** that prevent hash-level parity. The perf hypothesis holds. The correctness boundary is well-defined and tractable. Recommend proceeding to a real subprocess port with the gaps below closed first.

## Setup

- **Hardware**: Linux x86_64, Bun runtime (TS), Go 1.26.2 (Go binary)
- **Test corpus**: two real Claude Code JSONL files staged in repo as `.spike-target.jsonl` (1.89 MB / 1012 lines / 1 compact_boundary) and `.spike-target-big.jsonl` (3.6 MB / 1352 lines, sub-agent file)
- **TS harness**: `tools/parser-spike/ts-bench.ts` — instantiates `ClaudeCodeAdapter`, calls `findChanged()` + `loadConversation()` against a temp projects dir holding only the target file
- **Go harness**: `tools/parser-spike/go-parser/main.go` — pure stdlib (`bufio.Scanner` + `encoding/json`), one-pass parse, emits matching bundle JSON
- **Measurement**: `/usr/bin/time -v` for wall clock + peak RSS, 5 iterations each

## Performance results

| Metric | File | TS (Bun) | Go | Delta |
|---|---|---|---|---|
| Parse-only ms | primary 1.89MB | ~108 | **~42** | **2.6x faster** |
| Parse-only ms | big 3.6MB | ~102 | **~51** | **2.0x faster** |
| Process wall ms | primary | 150 | **60** | 2.5x |
| Process wall ms | big | 145 | **60** | 2.4x |
| Peak RSS MB | primary | ~85 | **~11** | **7.7x lower** |
| Peak RSS MB | big | ~88 | **~12** | **7.3x lower** |

Notes:
- Bun runtime baseline is ~75 MB before any parsing happens. The 85–88 MB peaks are mostly runtime overhead, not parser working set.
- Go peak RSS is dominated by the bundle being marshalled to JSON for the diff harness. A streaming-frame-emitting Go worker (matching the TS subprocess's `INGEST_MESSAGE_METHOD` notification protocol) would stay under ~10 MB regardless of file size.

## Correctness — aggregate parity

Both files produce **exact** matches on aggregate counts and totals after two corrections were made to the Go parser:

| Field | TS | Go |
|---|---|---|
| conversations (primary / big) | 2 / 1 | 2 / 1 |
| messages (primary / big) | 813 / 586 | 813 / 586 |
| tool calls (primary / big) | 269 / 203 | 269 / 203 |
| input_tokens (primary) | 866 | 866 |
| output_tokens (primary) | 121,996 | 121,996 |
| cache_read (primary) | 41,191,515 | 41,191,515 |
| cache_write (primary) | 1,915,463 | 1,915,463 |
| max turn | 318 | 318 |
| role distribution | user:326 assistant:461 system:26 | identical |
| recordType distribution | identical 5-way split | identical |

Two non-obvious corrections were needed before parity:

1. **Usage dedup by `requestId + messageId + tokens` fingerprint.** Claude streams assistant chunks across multiple records that replay identical billed token counts. Without dedup, Go double-counted ~80% of tokens. The TS adapter does this in `usageFingerprint()` at `src/adapters/claude-code.ts:270`.
2. **System records as messages.** TS emits `system:turn_duration`, `system:compact_boundary`, `system:away_summary` as `role:"system"` messages. Without this, Go was 26 messages short on the primary file.

## Correctness — semantic parity (where it breaks)

After aggregate parity, a normalized-content SHA-256 hash comparison was run, projecting each message to deterministic fields (excluding `id` since TS uses SHA256-derived IDs and the spike Go uses raw uuids). **Hashes do not match.** Six real semantic differences:

| # | Issue | TS behavior | Go (spike) behavior |
|---|---|---|---|
| 1 | `compact_boundary` placement | First message of **continuation** segment | Last message of **root** segment |
| 2 | `sequence` base | 1-indexed, **source line number** (counts dropped lines too: 1..1352 for 1012-line file because TS counts up across both segments) | 0-indexed, monotonic per parsed message |
| 3 | `sequence` reset across segments | TS does NOT reset; sequences continue across compaction | Go does NOT reset either, but starts from 0 |
| 4 | `turn` for sub-agent files | All messages get `turn = -1` | Go assigns `turn = 0..N` based on user records |
| 5 | Assistant content with only `tool_use` blocks | Falls back to `"[tool:ToolName]"` synthetic content | Empty string |
| 6 | User content with only `tool_result` blocks | Extracts result text into `content` | Empty string |

All six are mechanical fixes (each is ~5–15 lines of Go). None reveal a structural problem with the Go approach.

## What was deliberately out of scope

These would block a production port but were not implemented in the spike. Each is correctness work, not perf work:

- **Deterministic message IDs.** TS uses `stableHash()` over `(sessionId, raw uuid, recordType, timestamp, optional tool_use_id)`. Spike uses raw uuid. v2 nuclear-migration depends on ID determinism, so a real port must replicate this byte-for-byte (Go's `crypto/sha256` is fine; the input string layout is the trick).
- **Sub-agent resolution.** TS walks parent bundles to match tool_use needles, then synthesizes `relationship='spawned'` + `parent_id` + `fork_point`. Spike treats sub-agent files as standalone roots.
- **`gitRemote` lookup.** TS calls `git remote get-url origin` per cwd with caching. Spike emits empty string.
- **Discovery cache export/import.** TS adapter exports `DiscoveryCacheState` so daemon restart skips full re-parse. Spike has no checkpoint surface.
- **Thinking-block extraction across multi-block messages.** Spike concatenates `thinking.thinking` strings; TS has more elaborate handling that the corpus didn't exercise.
- **Tool input pre-stringification.** TS calls `JSON.stringify(input)` before storage; spike emits raw JSON bytes which differ in formatting.

## Architectural fit

The existing ingest pipeline already runs the adapter as a **JSON-RPC subprocess** with Content-Length framing (`src/pipeline/ingest-worker.ts`). Replacing the inner Bun process with a Go binary is a **drop-in swap at one seam**. The IPC contract:

- Request: `WorkerLoadConversationRequest` JSON with `{ref, adapterConfig}`
- Response: streaming notifications `INGEST_CONVERSATION_METHOD` (one), `INGEST_MESSAGE_METHOD` (N), terminator
- Tool calls travel embedded in `ParsedMessage.toolUses[]`

A real Go worker would implement only this protocol; the parent daemon, store, and sinks remain untouched.

## Updated feasibility verdict

Numbers vs my pre-spike estimate:

| Dimension | Pre-spike estimate | Measured |
|---|---|---|
| Parse-time speedup | 2–3x | 2.0–2.5x ✓ |
| Peak RSS reduction | 3–5x | **7–8x** (better than expected) |
| Cold-start cost | wash | wash ✓ |
| Blast radius | 800–1200 LOC | 350 LOC for spike, ~600–800 for production-quality port |

**Updated take: worth pursuing for the memory floor specifically.** The CPU win is nice but Phase 2 byte-offset tail-reads in TS would close most of the gap. The **memory floor** (Go worker capping at ~15 MB regardless of input size, vs Bun's 85 MB baseline) is what enables jin to ingest 100 MB+ power-user transcripts without runaway RSS.

## Recommended next steps (in order)

1. **Codex parity spike** — same exercise on `~/.codex/sessions/*.jsonl`. Codex has different streaming/usage shape (`token_count.last_token_usage` vs `total_token_usage`) and `compacted` records use a different schema. Validate the 2-language approach before committing.
2. **Close the 6 semantic gaps** — fix the boundary placement, sequence numbering, sub-agent turn=-1, content fallbacks. Verify with the same normalized-hash test until it matches.
3. **Port `stableHash` and sub-agent resolution.** This is the gap between "spike" and "could replace TS adapter."
4. **Wire as JSON-RPC subprocess** — replace stdout-JSON with the existing frame protocol from `src/pipeline/ingest-worker.ts`. Measure end-to-end ingest perf, not just isolated parse.
5. **Distribution decision** — embed binaries (5 platforms × ~3 MB = 15 MB binary bloat) vs download-on-first-run vs require Go installed. Almost certainly embed.

## Artifacts in this commit

- `tools/parser-spike/ts-bench.ts` — TS baseline harness
- `tools/parser-spike/go-parser/main.go` — Go parser (350 LOC)
- `tools/parser-spike/go-parser/go.mod` — Go module file
- `tools/parser-spike/README.md` — how to reproduce

Excluded by `.gitignore` (contain user transcript data or are build outputs):
- `.spike-target*.jsonl` — staged corpus, contains private conversation content
- `tools/parser-spike/bundle-*.json` — emitted bundles, contain private conversation content
- `tools/parser-spike/go-parser-bin` — 3.2 MB build output

## How to reproduce

```bash
# 1. stage a real Claude Code JSONL
cp ~/.claude/projects/<some-project>/<sessionId>.jsonl .spike-target.jsonl

# 2. TS baseline
/usr/bin/time -v bun run tools/parser-spike/ts-bench.ts .spike-target.jsonl /tmp/bundle-ts.json

# 3. build + run Go
cd tools/parser-spike/go-parser && go build -o ../go-parser-bin . && cd ../../..
/usr/bin/time -v ./tools/parser-spike/go-parser-bin -out=/tmp/bundle-go.json .spike-target.jsonl

# 4. normalized hash diff (see docs/spikes/go-parser-claude-code.md commit body for the python script)
```
