# W3-ADAPTER-07: Claude Code Path Precedence and Live Runtime Hardening

## Role

Codex worker packet.

## Goal

Fix the newly exposed Claude Code live-adapter failures:

1. default path precedence selects an empty path instead of the real populated
   source directory
2. once the real Claude dataset is in scope, `loadConversation()` hits stack
   overflow and drives RSS into the gigabytes on the live machine

This lane exists because `W3-ADAPTER-06` hardened Claude discovery/load memory
in packet-local validation, but it did not cover:

- default-path precedence against competing real directories
- platform-path behavior on macOS/Linux/Windows
- the live local Claude dataset on this machine

## Depends On

- `docs/execution/tasks/W3-ADAPTER-06-claude-code-discover-load-memory-hardening.md`
- `docs/execution/audits/2026-04-08-claude-code-memory-hardening-validation.md`
- `docs/solutions/2026-04-08-adapter-default-path-selection-must-prefer-populated-sources.md`
- `docs/execution/audits/2026-04-08-W3-PERF-02-full-runtime-rss-shutdown-flush.md`

## Unblocks

- correct default Claude Code ingestion on real developer machines
- platform path-precedence coverage
- stable live Claude Code runtime behavior under the v2 daemon

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/blueprint/BP-02-data-flow.md`
6. `docs/blueprint/BP-04-adapter-contract.md`
7. `docs/execution/tasks/W3-ADAPTER-07-claude-code-path-precedence-and-live-hardening.md`
8. `docs/solutions/2026-04-08-adapter-default-path-selection-must-prefer-populated-sources.md`
9. Current code:
   - `src/adapters/claude-code.ts`
   - `test/claude-code-reference-adapter.test.ts`
   - `test/integration.test.ts`

## Owned Files

- `src/adapters/claude-code.ts`
- `test/claude-code-reference-adapter.test.ts`
- `test/integration.test.ts` only if needed for a default-path precedence case
- packet-local audits under `docs/execution/audits/`

## Forbidden Files

- `src/contracts/**`
- `src/pipeline/**`
- `src/sinks/**`
- service/version/PR/UI work
- other adapter files unless the live RCA proves a shared helper gap

## Frozen Contracts

- adapter v2 interface
- pipeline/store/sink contracts
- ontology conversation model

## Deliverables

- fix default path precedence so an empty preferred path does not shadow a
  populated fallback
- add explicit tests for default path precedence, including competing-path cases
- review Linux and Windows path-selection behavior and harden it if needed
- root-cause and fix the live Claude Code stack overflow / RSS blowup if the
  smallest safe fix is adapter-local
- durable audit evidence from the real local Claude dataset

## Non-Goals

- general pipeline/runtime rewrites
- release workflow changes
- unrelated adapter rewrites
- changing frozen runtime contracts

## BP Acceptance Matrix

| Requirement | Blueprint | Expected evidence |
|-------------|-----------|-------------------|
| Default path selection prefers a populated source or user override over an empty preferred directory | BP-04 | code diff + focused tests |
| Platform path rules are explicit and reviewed for macOS/Linux/Windows | BP-04 | code/test/audit citations |
| The live Claude dataset no longer stack-overflows or explodes RSS if the fix remains adapter-local | BP-02, BP-04 | durable audit artifact + focused validation |
| The lane does not widen frozen pipeline/store/sink contracts | BP-02, BP-04, BP-05, BP-06 | diff scope |

## Acceptance Checks

- a focused test reproduces the empty-preferred-dir / populated-fallback case
- completion report states whether the stack/RSS failure was fixed here or
  escalated as a non-adapter blocker
- the audit cites exact live commands and observed runtime/log outcomes

## Stop And Escalate

Stop if:

- the stack/RSS root cause is outside `src/adapters/claude-code.ts`
- the smallest safe fix requires pipeline/store contract changes
- the real live dataset issue cannot be reproduced without product-surface
  changes outside the packet boundary

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

Validation run:
- exact live/local commands
- path-selection outcome
- stack/RSS outcome

BP acceptance matrix:
- <requirement> -> implemented in <file>, tested by <test or artifact>
- <requirement> -> deferred with Codex approval
- <requirement> -> out of scope per packet boundary

Platform path review:
- macOS:
- Linux:
- Windows:

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
