# Review: W0-CODEX-02 Live Control Plane Bootstrap (Re-check)

- reviewer: `cursor-audit`
- packet: `W0-CODEX-02`
- date: `2026-04-01`
- verdict: `needs_codex` (S3 finding from prior review remains unfixed)

## Summary

Re-reviewed after Codex was expected to fix the one-line "four things" bug.
The fix has **not been applied**. `docs/execution/01-dispatch-protocol.md`
line 7 still reads "exactly four things" while listing five items.

All other findings from the prior review (`2026-04-01-W0-CODEX-02-cursor.md`)
remain valid and unchanged. The live control plane structure, ownership model,
templates, seeded state, and static/live split are all still aligned.

## Drift

### S3 — `01-dispatch-protocol.md` line 7: "exactly four things" lists five items

Still present. Same finding as the prior review. No code or doc change has
been committed or staged to address this.

- **File:** `docs/execution/01-dispatch-protocol.md` line 7
- **Rule:** internal consistency of the dispatch protocol spec
- **Fix:** Change "four" to "five"

## Codex Decisions Needed

1. Apply the trivial "four" → "five" fix, then move W0-CODEX-02 to `approved`.
