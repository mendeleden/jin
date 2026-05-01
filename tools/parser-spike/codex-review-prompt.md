You are reviewing a feasibility spike that benchmarks a Go-based parser
for Claude Code JSONL transcripts vs the existing TypeScript adapter in
this repository.

## Your task

Critically review the findings — be adversarial, push back on overclaims,
identify methodology weaknesses, and flag any conclusions that don't follow
from the data. Confirm what you can confirm, dispute what you can dispute.

## Inputs to review

1. Findings doc: `docs/spikes/go-parser-claude-code.md`
2. Full benchmark results: `docs/spikes/go-parser-benchmarks.md`
3. Go parser source: `tools/parser-spike/go-parser/main.go`
4. TS harness: `tools/parser-spike/ts-bench.ts`
5. Bench runner: `tools/parser-spike/bench.py`
6. Existing TS adapter (the thing being compared against):
   `src/adapters/claude-code.ts`
7. Existing IPC contract: `src/contracts/adapters.ts`,
   `src/contracts/conversations.ts`
8. Existing subprocess bridge: `src/pipeline/ingest-worker.ts`

## Specific questions

1. **Is the perf comparison fair?** The TS harness instantiates the adapter
   and calls `findChanged()` + `loadConversation()`. The Go binary parses
   one file and writes JSON. Are these doing comparable work? What's
   missing or over-counted on either side?

2. **Are the synthetic 10/50 MB fixtures meaningful?** They're produced by
   `cat real.jsonl >> out.jsonl` N times. What does that hide or reveal?

3. **Is the "7-8x RSS reduction" claim defensible** given that ~75 MB of
   the TS number is Bun runtime overhead and not parser working set?

4. **The 6 documented semantic-parity gaps** — are any of them load-bearing
   in a way the doc understates? (compact_boundary placement, sequence
   numbering, sub-agent turn=-1, tool-only content fallbacks.)

5. **Production port estimate** — the doc says 600-800 LOC for a real port.
   Reality check that against:
   - SHA256 message-id determinism (TS uses `stableHash()` over a specific
     input string layout)
   - Sub-agent resolution (walks parent bundles to match tool_use needles)
   - Discovery cache export/import (`exportDiscoveryState()`)
   - Git remote lookup (`execFileSync("git", ...)` with caching)
   - The full IPC contract (JSON-RPC 2.0 over Content-Length framed stdio)

6. **Distribution / deployment risk** — embedding 5 platform binaries
   (linux x64+arm64, darwin x64+arm64, windows x64) ≈ 15 MB binary bloat.
   Is the doc honest about this, or is it sweeping it under the rug?

7. **What's the real bottleneck for jin's daemon?** PERF_FINDINGS.md
   suggests Phase 2 byte-offset tail-reads in TS would close most of the
   re-parse problem. Does the spike establish that Go is *additionally*
   beneficial, or is it solving a problem that's already addressable in TS?

## Output format

Markdown. Sections:
- "Verdict" (one paragraph)
- "What holds up" (bullets — claims supported by the data)
- "What's overstated" (bullets — claims that go beyond the data)
- "Methodology issues" (bullets — biases in the measurement)
- "Production-port reality check" (bullets — concrete LOC + risk)
- "Recommendation" (proceed / don't proceed / proceed with conditions)

Be specific. Cite file:line where relevant. Don't be polite if you disagree.
