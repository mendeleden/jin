---
title: Codex Segment Index Keeps Large JSONL Loads Bounded
date: 2026-05-29
tags: [adapter, pipeline, performance, discovery-cache]
related: []
---

# Codex Segment Index Keeps Large JSONL Loads Bounded

## Problem

A single Codex session JSONL can contain many compacted conversations and very large records. In the observed case, a 573 MB Codex file included a 17 MB `compacted` line whose `replacement_history` embedded base64 PNG screenshots. The old Codex adapter rebuilt the full file model for each ref, so loading one compacted conversation could parse unrelated large records and push worker RSS close to 1 GB.

Discovery had a separate failure mode: building the lightweight ref list still used full JSON parsing and a line scanner that repeatedly concatenated partial buffers, so even indexing could allocate far more than the final index required.

## Solution

The Codex discovery cache payload now stores adapter-local segment metadata: ref ids, byte offsets, turn/model context, and file-level metadata. Worker loads receive only the discovery state for the ref source path, then `loadConversation(ref)` reads only that segment byte range when offsets are available.

Discovery indexing now scans raw JSONL bytes, parses only small metadata lines, and avoids expanding large `replacement_history` payloads. The line scanner accumulates chunks and performs one concat per complete line instead of repeatedly copying long partial lines.

## Key Insight

For adapters where one source file can contain multiple conversations, `ConversationRef` must be treated as a precise pointer, not just a post-filter after full parsing. Adapter-owned discovery cache payloads are the right place for source-format-specific offsets because the pipeline should not need to understand Codex compaction semantics.

## Prevention

Tests should compare cached targeted loads against full-file parse bundles, not only check that a compacted ref loads. The regression test now asserts root-name preservation, segment timestamps, and matching bundle hashes between the full parse path and the cached targeted path.

When optimizing ingestion memory, measure both phases separately:

- discovery/ref indexing
- targeted conversation loading

Both can parse the same large physical file, but they have different correctness and memory risks.

## Related

- Real repro file: 573 MB Codex JSONL with 81 refs and a 17 MB `compacted.replacement_history` line.
- Contained repro after fix: discovery around 342 MB RSS, targeted worker loads around 190-201 MB RSS for the two large refs measured.

## Files Changed

- `src/adapters/codex.ts`
- `src/pipeline/ingest.ts`
- `src/pipeline/ingest-worker.ts`
- `test/codex-reference-adapter.test.ts`
