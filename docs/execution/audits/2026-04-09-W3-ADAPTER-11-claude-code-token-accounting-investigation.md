# W3-ADAPTER-11 Claude Code Token Accounting Investigation

**Packet:** `W3-ADAPTER-11`  
**Validation date:** `2026-04-09`  
**Scope:** `src/adapters/claude-code.ts`, `src/db/query-surface.ts`, `src/commands/analyze.ts`, `test/claude-code-reference-adapter.test.ts`, `test/runtime-store-cutover.test.ts`

## Questions

- Does Claude replay identical billed `usage` across multiple assistant rows for one logical turn?
- Does Jin currently sum those replays directly?
- Are Jin token totals and estimated cost describing the same accounting surface?

## Raw Evidence

### 1. Repo fixture proves exact duplicate billed usage

Source: `test/fixtures/claude-code/00c4c4e7.jsonl`

- line `3`
  - `message.id`: `msg_01DZw5eRUjAQqErxGNfDtVPe`
  - `requestId`: `req_011CXw2UrVFENqG4dVEeaHQh`
  - `usage`: `input=10`, `output=5`, `cache_read=10349`, `cache_write=14248`
- line `4`
  - same `message.id`
  - same `requestId`
  - same `usage`

Naive raw-row totals from those two assistant rows:

- `input`: `20`
- `output`: `10`
- `cacheRead`: `20698`
- `cacheWrite`: `28496`
- estimated cost: `$0.188799`

Post-fix adapter bundle totals from the same file:

- `input`: `10`
- `output`: `5`
- `cacheRead`: `10349`
- `cacheWrite`: `14248`
- estimated cost: `$0.0943995`

This is a direct 2x overcount if Jin sums both raw rows as independently billed.

### 2. Live local Claude data shows the same overcount pattern at scale

Probe date: `2026-04-09`  
Source root: `~/.claude/projects`

Exact duplicate example observed in:

- `/Users/edenmendel/.claude/projects/-Users-edenmendel-Documents-GitHub-auth-alternative/87d19613-73a8-47da-a187-fb975319e9e0/subagents/agent-a0b9451b3b5ce2f38.jsonl`
- repeated rows at lines `2`, `3`, `6`, and `9`
- same `message.id`: `msg_01JMXxBWFcaskG2h3kEHa8f3`
- same `requestId`: `req_011CYZPajGfFmC47dgABnBRL`
- same billed token fields on all four rows:
  - `input=3`
  - `output=1`
  - `cache_read=15196`
  - `cache_write=3841`

Corpus-wide exact-fingerprint totals:

- files scanned: `905`
- refs discovered after current local changes: `921`
- naive assistant-row totals:
  - `input`: `2188462`
  - `output`: `4875525`
  - `cacheRead`: `1631464337`
  - `cacheWrite`: `157520189`
  - estimated cost: `$1542.5221014499975`
- exact logical totals by `(requestId, message.id, input, output, cacheRead, cacheWrite)`:
  - `input`: `1151108`
  - `output`: `4797473`
  - `cacheRead`: `1323663086`
  - `cacheWrite`: `87974098`
  - estimated cost: `$1124.0103965000003`
- overcount removed by exact dedupe:
  - `input`: `1037354`
  - `output`: `78052`
  - `cacheRead`: `307801251`
  - `cacheWrite`: `69546091`
  - estimated cost: `$418.51170494999724`

After the landed adapter change, the loaded-bundle totals match the exact logical totals exactly:

- adapter totals:
  - `input`: `1151108`
  - `output`: `4797473`
  - `cacheRead`: `1323663086`
  - `cacheWrite`: `87974098`

## Findings

### 1. Jin was overcounting exact Claude usage replays

- The adapter previously copied `raw.message.usage` onto every assistant row.
- Conversation aggregates and query-surface totals are derived by summing stored message token fields.
- Real Claude data replays identical billed usage across multiple assistant rows for one logical turn, so naive row summation overstates both token totals and estimated cost.

### 2. The safe narrow rule is exact billed-usage dedupe, not broader collapse

Landed rule:

- within one loaded conversation segment
- for assistant rows only
- if `requestId`, `message.id`, `input_tokens`, `output_tokens`, `cache_read_input_tokens`, and `cache_creation_input_tokens` all match a previously seen row
- zero the repeated row's stored token fields

Why this boundary is safe:

- it matches the fixture proof exactly
- it matches the live-corpus proof exactly
- it leaves message content, ordering, and tool extraction untouched
- it avoids guessing about Claude rows that reuse IDs but change token counts

### 3. Generic aggregate `tokens` and `cost` were previously describing different surfaces

Before this patch:

- aggregate `tokens` in `src/db/query-surface.ts` summed `input_tokens + output_tokens`
- aggregate `cost` already included `cache_read` and `cache_write` through `est_cost`

After this patch:

- generic aggregate `tokens` means billed tokens: `input + output + cache_read + cache_write`
- `analyzeCommand` now exposes the breakdown explicitly:
  - `totalTokens`
  - `displayTokens`
  - `cacheTokens`
- per-harness output now carries the same billed/display/cache split

Runtime test proof:

- seeded assistant usage: `input=11`, `output=7`, `cacheRead=5`, `cacheWrite=3`
- `analyzeCommand` JSON now reports:
  - `totalTokens=26`
  - `displayTokens=18`
  - `cacheTokens=8`

## Residual Ambiguity

Not every multi-row Claude response is an exact replay.

Live probe on `2026-04-09` also found:

- `7508` `(message.id, requestId)` groups with multiple assistant rows
- `5510` of those groups carried more than one distinct `usage` payload

Representative example:

- `/Users/edenmendel/.claude/projects/-Users-edenmendel-Documents-GitHub-prismatic/1861232a-9bb0-4c9c-9ff6-e8e9b6409ba4/subagents/agent-affb9c29a5135f973.jsonl`
- lines `2` and `29` repeat one usage state with `output_tokens=2`
- lines `3` and `30` repeat another usage state with `output_tokens=95`
- all four rows reuse the same `message.id` and `requestId`

This packet intentionally does **not** collapse distinct usage payloads that share IDs, because the raw data alone does not yet prove whether those rows are cumulative progress updates, separate billable phases, or another Claude logging mode. The landed fix only removes exact repeated billed fingerprints.

## Landed Changes

- `src/adapters/claude-code.ts`
  - exact replayed Claude usage fingerprints are counted once per segment
- `src/db/query-surface.ts`
  - aggregate `tokens` now mean billed tokens
  - overview and per-adapter analysis also expose display/cache breakdowns
- `src/commands/analyze.ts`
  - CLI/JSON output now makes billed vs display vs cache token semantics explicit

## Focused Validation

### 1. Claude adapter regression coverage

```sh
bun test test/claude-code-reference-adapter.test.ts
```

Observed:

- exit code: `0`
- `14` tests passed
- new coverage proves the repo fixture's duplicate Claude usage rows now produce the correct bundle totals

### 2. Query/analyze regression coverage

```sh
bun test test/runtime-store-cutover.test.ts
```

Observed:

- exit code: `0`
- `5` tests passed
- new coverage proves `analyzeCommand` reports billed tokens and explicit display/cache breakdowns from the v2 store

### 3. Fixture raw-vs-adapter probe

```sh
bun -e '...fixture raw probe plus ClaudeCodeAdapter loadConversation...'
```

Observed:

- raw naive totals: `input=20`, `output=10`, `cacheRead=20698`, `cacheWrite=28496`
- adapter bundle totals: `input=10`, `output=5`, `cacheRead=10349`, `cacheWrite=14248`

### 4. Live corpus raw-vs-adapter probe

```sh
bun -e '...scan ~/.claude/projects, compute naive vs exact logical totals, then compare with ClaudeCodeAdapter bundle totals...'
```

Observed:

- exact logical totals and adapter totals matched exactly on `2026-04-09`
- naive assistant-row sums remained materially higher, confirming the prior overcount
