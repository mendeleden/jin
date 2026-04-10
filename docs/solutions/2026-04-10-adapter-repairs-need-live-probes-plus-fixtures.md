---
title: Adapter repairs need live probes plus fixtures
date: 2026-04-10
tags: [adapter, pipeline, validation, testing]
related: [W3-ADAPTER-09, W3-ADAPTER-10, W3-ADAPTER-11, W3-ADAPTER-12, W3-VALIDATE-01, BP-04]
---

# Adapter repairs need live probes plus fixtures

## Problem

The recent adapter bugs were not "generic parser bugs." They were live-data pathologies:

- Claude Code replayed exact billed-usage rows and overcounted tokens
- Claude Code reused short ids across parent sessions and produced duplicate conversation/message identities
- Cursor layer-3 roots were pointer blobs, not direct JSON payloads
- Cursor emitted repeated same-name tool calls where naive fallback stitched results onto the wrong call
- Cursor layer-1 metadata was present in real bubbles but absent from the simplified adapter shape

The common failure mode was the same: synthetic assumptions survived until they met live local data.

## Solution

We now repair adapters in a fixed order:

1. Reproduce on real local data first.
2. Narrow the failure to one concrete source shape.
3. Add the smallest parser/identity fix that preserves the BP-04 surface.
4. Capture the shape in a focused fixture/regression test.
5. Re-run the live probe before calling the packet done.

Current status:

| Adapter | Bug class | Fix status | Guardrail |
| --- | --- | --- | --- |
| Claude Code | duplicate conversation/message ids across parent-scoped subagents | fixed in `W3-ADAPTER-09` | fixture + live disposable-store validation |
| Claude Code | exact replayed usage rows double-counting billed tokens | fixed in `W3-ADAPTER-11` | fixture asserting billed tokens count once |
| Cursor | layer-3 pointer-root decode returned null bundles | fixed in `W3-ADAPTER-10` | live Cursor-only validation |
| Cursor | repeated same-name tool results stitched to the wrong tool | fixed in `W3-ADAPTER-12` | repeated-tool and late-result regressions |
| Cursor | missing layer-1 `cwd` / `thinkingContent` | fixed in `W3-ADAPTER-12` | live-style layer-1 fixture coverage |
| Claude Code | headless traces from missing parent JSONL roots | still open | needs its own narrow packet |
| Codex | no current correctness blocker | monitor only | re-check with fresh stores before reopening |

## Key Insight

The durable pattern is not "refactor the adapter until it looks cleaner." The durable pattern is:

- live probe
- isolate source shape
- fixture it
- patch only the failing behavior
- re-run live validation

That is what kept the Cursor and Claude fixes reviewable without reopening the BP-04 contract.

## Prevention

- Every adapter packet should include both a live probe and at least one fixture that encodes the discovered source shape.
- Keep adapter fixes narrow; do not hide correctness work inside large structural refactors.
- When a live report sounds surprising, compare it to the current adapter code before assuming the report is still true.
- Treat "null bundle", "duplicate id", and "wrong stitched tool result" as first-class regression classes.

## Related

- `W3-VALIDATE-01` exposed the live failures.
- `W3-ADAPTER-09`, `W3-ADAPTER-10`, `W3-ADAPTER-11`, and `W3-ADAPTER-12` closed the recent correctness follow-ups.
- `BP-04` remains the contract surface that these fixes preserve.

## Files Changed

- `src/adapters/cursor.ts`
- `test/cursor-adapter.test.ts`
- `docs/adapters/cursor/index.md`
- `docs/adapters/cursor/orchestration.md`
- `docs/ontology.md`
- `src/adapters/claude-code.ts`
- `test/claude-code-reference-adapter.test.ts`
