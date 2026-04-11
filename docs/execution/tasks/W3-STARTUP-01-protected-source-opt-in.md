# W3-STARTUP-01: Protected Source Opt-In

## Role

Codex-owned hardening packet.

## Goal

Stop unconsented startup probing of protected or app-private data stores and
replace the current auto-detect behavior with an explicit opt-in model that is
clear, testable, and documented per OS.

## Depends On

- `W3-PRODUCT-01-command-surface-reframe.md` or stable enough equivalent

## Unblocks

- experimental release confidence on macOS
- adapter startup behavior that does not surprise users with OS privacy prompts
- a stable per-OS policy for adapter discovery

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/04-frozen-contract-surface.md`
3. `docs/blueprint/BP-04-adapter-contract.md`
4. `docs/blueprint/BP-07-process-lifecycle.md`
5. `docs/blueprint/BP-08-routing-and-config.md`
6. Current code:
   - `src/config.ts`
   - `src/adapters/registry.ts`
   - `src/adapters/cursor.ts`
   - `src/adapters/kiro.ts`
   - `src/adapters/opencode.ts`
   - `src/adapters/warp.ts`
   - `src/adapters/claude-code.ts`
   - `src/adapters/codex.ts`
   - `src/commands/start.ts`
   - `src/commands/watch.ts`
   - `src/commands/init.ts`
   - any adapter startup or detection tests under `test/`

## Owned Files

- `src/config.ts`
- `src/adapters/registry.ts`
- adapter detection code for adapters that probe protected/app-private paths
- startup command surfaces that trigger adapter detection
- startup/detection-focused tests under `test/`

## Forbidden Files

- `src/contracts/**`
- `src/db/**`
- `src/pipeline/**`
- `src/sinks/**`
- unrelated command/product framing files outside startup/detection behavior

## Frozen Contracts

- adapter bundle/load semantics
- conversation/store schema
- routing and sink push semantics
- lifecycle ownership invariants

## Deliverables

- inventory of startup adapter probes and their path classes by OS
- explicit startup policy for protected/app-private adapter sources on macOS,
  Linux, and Windows
- no startup probe of protected/app-private sources without explicit opt-in
- removal of daemon startup auto-enable behavior for previously disabled
  adapters
- operator-visible help/config wording for the opt-in behavior
- focused tests proving protected-source gating behavior

## Non-Goals

- changing adapter parsing or bundle semantics
- removing adapters entirely
- OS entitlement hacks or installer-specific permission workarounds
- sink, routing, or store migration work

## BP Acceptance Matrix

| Requirement | Blueprint | Expected evidence |
|-------------|-----------|-------------------|
| Startup does not probe protected or app-private adapter sources unless the adapter is explicitly enabled/opted in for that OS | BP-07 config snapshot + local ownership expectations | `src/adapters/registry.ts`, protected adapter files, startup tests |
| Daemon startup does not auto-enable previously disabled adapters or write discovery results back into durable config | BP-07 §config snapshot; BP-08 config lifecycle | `src/commands/watch.ts` and focused startup/config tests |
| macOS paths under `~/Library/Application Support/**` that trigger TCC/privacy prompts are classified as opt-in-only startup sources | BP-Product local-first trust expectations | packet notes + `src/adapters/cursor.ts` / related adapter tests |
| Linux and Windows adapter discovery behavior is explicitly classified by path class instead of relying on silent probing | BP-04 adapter boundary + BP-Product trust model | packet notes + config/help text + detection tests |
| User-provided adapter data paths remain allowed without widening frozen adapter contracts | BP-04 adapter contract | adapter constructors/config plumbing + focused tests |

Every row must be resolved in the completion report as:
- implemented, with code + test citation
- deferred, with Codex approval
- out of scope, with boundary citation

## V1 Comparison

- Required comparison targets:
  - `src/commands/watch.ts` startup auto-detect / auto-enable behavior
  - any pre-v2 adapter detection that silently probed app-private locations
- The worker must record which startup probes are intentionally being made
  stricter and why.

## Acceptance Checks

- starting `jin` on macOS does not touch Cursor or other protected
  Application Support stores unless the user has explicitly opted in
- disabled adapters stay disabled at startup; daemon startup does not rewrite
  config to auto-enable them
- per-OS detection policy is documented in code/help/config comments or user
  surface
- focused tests cover at least one protected-source adapter and the
  no-auto-enable startup path

## Stop And Escalate

Stop if:

- the packet would require frozen adapter contract changes
- the packet needs installer- or entitlement-level OS integration beyond repo
  code changes
- command-surface reframing from `W3-PRODUCT-01` is still moving enough to make
  startup ownership ambiguous

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

BP acceptance matrix:
- <requirement> -> implemented in <file>, tested by <test>
- <requirement> -> deferred with Codex approval
- <requirement> -> out of scope per packet boundary

V1 comparison:
- parity kept / intentional BP-backed change / deferred regression

BP alignment:
- BP-04: adapter discovery remains inside adapter-owned boundaries
- BP-07/BP-08: startup config and detection semantics are explicit and stable
- BP-Product: startup trust model no longer surprises users with protected-data prompts

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
