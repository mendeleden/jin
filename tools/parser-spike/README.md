# Go parser spike

Throwaway experiment comparing a Go-based Claude Code JSONL parser against the
existing TS adapter. See `docs/spikes/go-parser-claude-code.md` for full
findings.

## Reproduce

```bash
# stage a real Claude Code transcript (NOT committed — contains private data)
cp ~/.claude/projects/<project>/<sessionId>.jsonl .spike-target.jsonl

# TS baseline
/usr/bin/time -v bun run tools/parser-spike/ts-bench.ts \
    .spike-target.jsonl /tmp/bundle-ts.json

# build Go
cd tools/parser-spike/go-parser && go build -o ../go-parser-bin . && cd -

# Go run
/usr/bin/time -v ./tools/parser-spike/go-parser-bin \
    -out=/tmp/bundle-go.json .spike-target.jsonl
```

## Layout

- `ts-bench.ts` — calls the existing `ClaudeCodeAdapter`, emits a bundle JSON + summary stats
- `go-parser/main.go` — pure stdlib Go parser (~350 LOC), emits the same bundle shape
- `go-parser/go.mod` — module file (no external deps)

## Results (in short)

- **2.0–2.6× faster** parse, **2.4–2.5× faster** end-to-end wall
- **7–8× lower** peak RSS (Go ~11–12 MB vs Bun ~85–88 MB)
- Aggregate parity (counts, totals) is exact
- Field-level hash parity is **not** yet exact — 6 known semantic gaps documented in the findings doc

## Out of scope (correctness gaps left open)

- SHA256-derived deterministic message IDs
- Sub-agent resolution
- `gitRemote` lookup
- Discovery cache export/import
- Compact-boundary placement (boundary record currently lands in the wrong segment)
- Per-segment sequence numbering

These are mechanical fixes if/when the spike graduates to a real port.
