---
title: Claude usage accounting must dedupe exact replays and separate billed vs display tokens
date: 2026-04-09
tags: [adapter, migration]
related: [W3-ADAPTER-11, W3-ADAPTER-09, W3-VALIDATE-01, BP-04, BP-05, BP-09]
---

# Claude usage accounting must dedupe exact replays and separate billed vs display tokens

## Problem

Claude Code JSONL transcripts can emit multiple assistant rows for one logical turn while reusing the same `requestId`, `message.id`, and billed token fields. Jin was copying each row's `usage` into stored messages and then summing those rows directly, which overstated Claude token totals and cost on real local data. At the same time, aggregate `tokens` only counted input/output while `est_cost` already included cache reads and writes, so top-line token and cost surfaces were describing different things.

## Solution

The safe narrow fix was:

- dedupe only exact repeated billed-usage fingerprints inside the Claude adapter
- fingerprint by `requestId`, `message.id`, `input_tokens`, `output_tokens`, `cache_read_input_tokens`, and `cache_creation_input_tokens`
- keep message content and ordering unchanged, but zero the repeated row's stored token fields
- redefine generic aggregate `tokens` on the v2 query surface to mean billed tokens
- expose explicit `displayTokens` and `cacheTokens` alongside billed totals in `analyzeCommand`

This corrected exact replay overcounts without guessing about Claude rows that reuse IDs but change token counts.

## Key Insight

For rich adapters, upstream message rows are not automatically billable accounting units. If the source format can replay or fragment one logical response across multiple rows, Jin should only count a token payload once when the raw source proves those billed fields are exact repeats, and downstream summary surfaces should distinguish billed totals from input/output-only display totals whenever cache tokens affect cost.

## Prevention

- Keep a real-data probe that compares naive assistant-row sums against exact deduped usage fingerprints.
- Add fixture coverage for repeated `requestId` / `message.id` / token-field replays.
- When a cost surface includes cache tokens, ensure any generic `tokens` aggregate names the same billed surface or exposes an explicit breakdown.

## Related

- Packet audit: `docs/execution/audits/2026-04-09-W3-ADAPTER-11-claude-code-token-accounting-investigation.md`
- Upstream cleanup baseline: `W3-ADAPTER-09`
- Live validation baseline: `W3-VALIDATE-01`

## Files Changed

- `src/adapters/claude-code.ts`
- `src/db/query-surface.ts`
- `src/commands/analyze.ts`
- `test/claude-code-reference-adapter.test.ts`
- `test/runtime-store-cutover.test.ts`
