# W3-ADAPTER-11 Codex Review

## verdict

- `approve`
- Detached verification matched the narrow worker claim. `bun test test/claude-code-reference-adapter.test.ts` passed `14/14`, `bun test test/runtime-store-cutover.test.ts` passed `5/5`, a fresh fixture probe reproduced naive assistant-row totals `20/10/20698/28496` versus adapter totals `10/5/10349/14248`, and direct inspection of the two audit-cited live Claude JSONL files confirmed both required raw shapes: exact repeated billed fingerprints and same-`requestId`/same-`message.id` rows whose billed payload changes and therefore must not be collapsed. The packet-local diff I reviewed stays inside the adapter/query/analyze/test lane.

## scope of review

- Reviewer session: `codex-REVIEWER-claude-code-token-accounting`.
- Read, in order, `docs/execution/00-global-rules.md`, `docs/execution/01-dispatch-protocol.md`, `docs/execution/05-live-control-plane.md`, and `docs/execution/tasks/W3-ADAPTER-11-claude-code-token-accounting-investigation.md`.
- Read live control plane and packet-local evidence: `.execution/program.md`, `.execution/blueprints.md`, `.execution/packets/W3-ADAPTER-11.md`, `.execution/agents/codex-WORKER-claude-code-token-accounting.md`, `docs/execution/audits/2026-04-09-W3-ADAPTER-11-claude-code-token-accounting-investigation.md`, and `docs/solutions/2026-04-09-claude-usage-accounting-must-dedupe-exact-replays-and-separate-billed-vs-display-tokens.md`.
- Inspected only the packet-owned code/tests requested for review: `src/adapters/claude-code.ts`, `src/db/query-surface.ts`, `src/commands/analyze.ts`, `test/claude-code-reference-adapter.test.ts`, `test/runtime-store-cutover.test.ts`, and `test/fixtures/claude-code/00c4c4e7.jsonl`.
- Re-ran focused validation only:
  - `bun test test/claude-code-reference-adapter.test.ts`
  - `bun test test/runtime-store-cutover.test.ts`
  - a detached fixture raw-vs-adapter probe against `test/fixtures/claude-code/00c4c4e7.jsonl`
  - a detached synthetic probe whose two assistant rows shared one `requestId` / `message.id` pair but carried different usage payloads
  - direct row inspection of `/Users/edenmendel/.claude/projects/-Users-edenmendel-Documents-GitHub-auth-alternative/87d19613-73a8-47da-a187-fb975319e9e0/subagents/agent-a0b9451b3b5ce2f38.jsonl` and `/Users/edenmendel/.claude/projects/-Users-edenmendel-Documents-GitHub-prismatic/1861232a-9bb0-4c9c-9ff6-e8e9b6409ba4/subagents/agent-affb9c29a5135f973.jsonl`

## blocking findings

- None. I did not find a blocker in the adapter-local dedupe rule, the billed/display/cache query semantics, or the packet boundary.

## BP Acceptance Matrix verification

- `Claude usage accounting is derived from raw source rows in a way that does not double-count streamed duplicates` -> implemented in `src/adapters/claude-code.ts:257-280` and `src/adapters/claude-code.ts:1109-1137`. The adapter fingerprints assistant usage by `requestId`, `message.id`, and the four billed token fields, tracks those fingerprints per segment, and zeroes only exact repeats. Verified by `test/claude-code-reference-adapter.test.ts:183-220`, by the fixture raw rows at `test/fixtures/claude-code/00c4c4e7.jsonl:3` and `test/fixtures/claude-code/00c4c4e7.jsonl:4`, by the detached fixture probe (`20/10/20698/28496` naive vs `10/5/10349/14248` adapter totals), and by direct live-row inspection of the audit-cited `auth-alternative` file where lines `2`, `3`, `6`, and `9` all share `requestId=req_011CYZPajGfFmC47dgABnBRL`, `message.id=msg_01JMXxBWFcaskG2h3kEHa8f3`, and the same `3/1/15196/3841` billed fields.
- `Claude usage accounting does not collapse broader ambiguous multi-row Claude usage patterns` -> implemented by the same fingerprint boundary in `src/adapters/claude-code.ts:266-280` and `src/adapters/claude-code.ts:1109-1119`. Same-id rows with changed billed fields produce different fingerprints and remain counted. Verified by the detached synthetic probe, whose two assistant rows shared `requestId=req_same` and `message.id=msg_same` but loaded with preserved assistant totals `[3/2/11/13, 3/95/11/13]` and summed adapter totals `6/97/22/26`, and by direct live-row inspection of the audit-cited `prismatic` file where lines `29` and `30` repeat one usage state (`3/95/7637/2872`) while lines `32`, `33`, and `35` repeat a different usage state (`3/2/10509/1117`) under the same raw ids.
- `Reported token totals and estimated cost have honest, non-contradictory semantics around cache tokens` -> implemented in `src/db/query-surface.ts:199-275` and `src/db/query-surface.ts:327-375`, where aggregate `tokens` now sum billed tokens while `displayTokens` and `cacheTokens` remain explicit surfaces. `src/commands/analyze.ts:21-84` now emits those three views in both JSON and text output while preserving the `byAdapter` compatibility alias. Verified by `test/runtime-store-cutover.test.ts:192-216`, which seeds assistant usage `11/7/5/3` and observes `totalTokens=26`, `displayTokens=18`, and `cacheTokens=8`.
- `The lane stays narrow and does not widen into service/sink/runtime changes` -> satisfied. The implementation diff I reviewed is confined to `src/adapters/claude-code.ts`, `src/db/query-surface.ts`, `src/commands/analyze.ts`, and packet-local tests/audit/solution docs. I found no packet-driven edits to runtime implementation, sink implementation, or schema files.

## V1 comparison

- Prior behavior treated every Claude assistant row as independently billable and exposed generic top-line `tokens` as `input + output` even when `est_cost` already included cache reads and writes.
- This lane is a narrow BP-backed accounting fix, not a contract rewrite. Message content, ordering, tool extraction, conversation identity, store shape, and sink payloads remain untouched.
- The intentional behavior change is limited to two places: exact duplicate billed-usage replays are counted once per segment in `src/adapters/claude-code.ts:1109-1137`, and query/CLI aggregates now name billed versus display versus cache surfaces honestly in `src/db/query-surface.ts:199-275` and `src/commands/analyze.ts:35-84`.

## aligned

- The repo fixture and the audit-cited live `auth-alternative` file both show exact replayed Claude billed usage rows, so adapter-local exact dedupe is supported by raw evidence, not just by inference from tests.
- The audit-cited live `prismatic` file shows the opposite raw shape as well: same `requestId` and `message.id`, but different billed payloads. That supports the packet claim that broader collapse would be guesswork.
- The query surface and CLI now use a coherent accounting story: billed totals align with cost, while display/cache breakdowns remain visible instead of implicit.

## drift

- `docs/execution/audits/2026-04-09-W3-ADAPTER-11-claude-code-token-accounting-investigation.md:184-194` still says `bun test test/runtime-store-cutover.test.ts` observed `4` passing tests, but the current file/run is `5` passing tests because `W3-PERF-04` batching coverage now shares `test/runtime-store-cutover.test.ts`. The packet-local analyze assertions still passed, and this did not change the accounting semantics under review.
- The workspace is dirty outside this packet. I treated unrelated non-packet modifications as ambient branch state and limited review conclusions to the packet-owned files named above.

## unowned spread

- None in the packet implementation I reviewed. I did not find spread into sink code, runtime code, schema work, or frozen contracts.

## progress

- `W3-ADAPTER-11` is review-complete from the Codex lane.
- The defended Claude accounting rule is supported by direct raw evidence: dedupe exact repeated billed fingerprints, and do not collapse same-id rows when the billed payload changes.
- The top-level analyze/query surfaces now expose honest billed/display/cache semantics.

## Codex decisions needed

- Codex can move `W3-ADAPTER-11` from `review_ready` to `approved`.
- Optional follow-up only: refresh the packet-local audit's `runtime-store-cutover` test-count wording from `4` to `5` so the doc matches the current shared test file state exactly.
