# W3-ADAPTER-11: Claude Code Token Accounting Investigation

## Role

Codex worker packet.

## Goal

Determine whether Jin's Claude Code token and cost accounting is semantically
wrong on real source data, and if so, whether the smallest safe fix is:

1. adapter-local deduplication or normalization of repeated Claude usage rows
2. stats/query-surface clarification around cache tokens versus billed tokens
3. both

The lane starts from a concrete operator suspicion plus raw local evidence:

- Claude JSONL often emits multiple assistant rows for one logical turn
- those rows can reuse the same `message.id`, `requestId`, and `usage`
- Jin currently stores per-message `inputTokens`, `outputTokens`, `cacheRead`,
  and `cacheWrite`
- top-level `jin stats` / summary totals currently sum only
  `input_tokens + output_tokens`, while estimated cost includes cache tokens

## Depends On

- `.execution/packets/W3-ADAPTER-09.md`
- `.execution/packets/W3-VALIDATE-01.md`
- `docs/execution/audits/2026-04-09-W3-ADAPTER-09-claude-code-duplicate-id-collision-fix-and-live-revalidation.md`

## Unblocks

- honest Claude token and cost reporting
- later workspace-member / `userId` reporting work on trustworthy usage data
- sink/reporting follow-ups if usage fields need clearer semantics downstream

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/execution/tasks/W3-ADAPTER-11-claude-code-token-accounting-investigation.md`
6. `.execution/program.md`
7. `.execution/packets/W3-VALIDATE-01.md`
8. `.execution/packets/W3-ADAPTER-09.md`
9. Current code:
   - `src/adapters/claude-code.ts`
   - `src/db/conversations.ts`
   - `src/db/query-surface.ts`
   - `src/commands/analyze.ts`
   - `src/pricing.ts`
   - `test/claude-code-reference-adapter.test.ts`
   - `test/runtime-store-cutover.test.ts`
   - `test/fixtures/claude-code/00c4c4e7.jsonl`

## Owned Files

- `src/adapters/claude-code.ts`
- `src/db/conversations.ts`
- `src/db/query-surface.ts`
- `src/commands/analyze.ts`
- `test/claude-code-reference-adapter.test.ts`
- `test/runtime-store-cutover.test.ts`
- packet-local audits under `docs/execution/audits/`
- packet-local solution notes under `docs/solutions/` only if the lesson is
  durable

## Forbidden Files

- `src/pipeline/**`
- `src/sinks/**`
- non-Claude adapter files
- service/runtime ownership code
- `userId` / workspace identity design work

## Frozen Contracts

- v2 adapter interface
- store schema shape unless Codex explicitly widens the lane
- sink payload contract
- relationship / trace semantics from `W3-ADAPTER-09`

## Deliverables

- raw evidence for whether Claude token usage is currently overcounted,
  undercounted, or merely mislabeled
- a written distinction between:
  - billed tokens
  - input/output display tokens
  - cache-read/cache-write tokens
- if safe and narrow, implement the fix plus focused regression coverage
- rerun the smallest useful local validation proving the corrected semantics
- write a packet-local audit with exact source rows, before/after totals, and
  residual ambiguity

## Non-Goals

- broad Claude adapter restructuring from `W3-ADAPTER-08`
- Cursor work
- sink delivery work
- service RSS work

## BP Acceptance Matrix

| Requirement | Blueprint | Expected evidence |
|-------------|-----------|-------------------|
| Claude usage accounting is derived from raw source rows in a way that does not double-count streamed duplicates | BP-04, BP-05 | code diff or audit proof + focused tests |
| Reported token totals and estimated cost have honest, non-contradictory semantics around cache tokens | BP-05, BP-09 | code diff or audit proof + CLI/query evidence |
| The lane stays narrow and does not widen into service/sink/runtime changes | BP-02, BP-04, BP-05, BP-06 | diff scope |

## Acceptance Checks

- completion report includes one real Claude raw sample showing repeated or
  non-repeated usage fields
- if code changes land, focused tests cover the discovered accounting rule
- if no code changes land, the audit still states exactly what is wrong and
  what the safest fix boundary is

## Stop And Escalate

Stop if:

- the smallest honest fix requires store schema changes outside packet scope
- Claude raw files do not support a clear dedupe/accounting rule
- the issue is actually upstream data ambiguity that Jin should expose, not fix

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

Validation:
- exact raw-source probe
- before/after totals

BP acceptance matrix:
- <requirement> -> implemented in <file>, tested by <test or artifact>
- <requirement> -> deferred with Codex approval

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
