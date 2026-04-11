# Packet State

- packet: `W3-ADAPTER-11`
- title: `Claude Code Token Accounting Investigation`
- status: `approved`
- assigned agent: `codex-WORKER-claude-code-token-accounting`
- branch: `feat/rewrite-ontology`
- worktree/container: `canonical repo workspace` / `local`
- depends on: `W3-ADAPTER-09`, `W3-VALIDATE-01`
- unblocks: `honest Claude token and cost reporting`, `safe stats/userId planning on trustworthy usage data`, `later sink/reporting fixes if usage fields need propagation changes`
- last transition: `2026-04-09`
- next Codex action: `keep the accounting semantics narrow while the active Claude runtime RSS lane continues on the same adapter surface; only split or commit once the overlapping Claude diff stays reviewable`
- latest review: `2026-04-09-W3-ADAPTER-11-codex.md`

## Notes

- this is a narrow follow-up after the approved functional Claude fix in
  `W3-ADAPTER-09`
- the immediate trigger is an operator concern that Claude Code token totals
  look wrong compared with raw source data and an external gist sample
- two concrete mismatch classes are already plausible:
  - Claude reuses the same `message.id`, `requestId`, and `usage` across
    multiple assistant rows in one logical turn, which can double-count billed
    usage if Jin sums each row independently
  - Jin top-level token totals currently report `input_tokens + output_tokens`
    while cost estimation includes `cache_read` and `cache_write`, so “tokens”
    and “cost” may be describing different accounting surfaces
- this lane is investigation-first; only land code if the fix stays narrow and
  the semantics are clearly defensible
- worker handoff now claims:
  - exact duplicate Claude billed-usage replays are adapter-deduped safely
  - aggregate `tokens` now mean billed tokens
  - `analyzeCommand` exposes explicit display/cache breakdowns
  - focused tests passed in `test/claude-code-reference-adapter.test.ts` and
    `test/runtime-store-cutover.test.ts`
