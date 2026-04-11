# W3-PERF-01 Codex Recheck

## verdict

- `approved`
- No blocking findings remain. The 2026-04-07 evidence blocker is closed by `docs/execution/audits/2026-04-07-W3-PERF-01-codex-rss-validation.md:5-13` and `docs/execution/audits/2026-04-07-W3-PERF-01-codex-rss-validation.md:161-219`, which record the exact `ingestOne()` harness, dataset scope (`106` files / `181` refs), measurement method, observed `224.4 MB` peak RSS, and zero hard-limit log mentions while the BP-02 guard stays fixed at `200 MB` warning / `256 MB` hard limit in `src/pipeline/loop.ts:30-31` and `src/pipeline/loop.ts:342-365`.

## scope of review

- reviewer session: `codex-REVIEWER-codex-ingest-rss-budget`
- reviewed execution/control-plane inputs: `docs/execution/00-global-rules.md`, `docs/execution/01-dispatch-protocol.md`, `docs/execution/05-live-control-plane.md`, `docs/execution/tasks/W3-PERF-01-codex-ingest-rss-budget.md`, `.execution/program.md`, `.execution/blueprints.md`, `.execution/packets/W3-PERF-01.md`, `.execution/packets/W3-E2E-01.md`, `.execution/agents/codex-WORKER-codex-ingest-rss-budget.md`, `.execution/reviews/2026-04-07-W3-PERF-01-codex.md`, `docs/execution/audits/2026-04-07-W3-PERF-01-codex-rss-validation.md`, `docs/execution/audits/2026-04-07-W3-E2E-01-persona-local-postgres.md`, `docs/solutions/2026-04-07-codex-ingest-timeouts-pin-bundles.md`, `docs/solutions/2026-04-08-rss-shutdown-poisons-local-sqlite-store.md`
- reviewed packet-owned BP/code/tests: `docs/blueprint/BP-02-data-flow.md`, `docs/blueprint/BP-07-process-lifecycle.md`, `src/adapters/codex.ts`, `src/pipeline/ingest.ts`, `src/pipeline/loop.ts`, `src/commands/benchmark.ts`, `test/codex-reference-adapter.test.ts`, `test/pipeline-spec-gap-closure.test.ts`
- fresh validation: `bun test test/codex-reference-adapter.test.ts test/pipeline-spec-gap-closure.test.ts` -> `7 pass`, `0 fail`

## blocking findings

- None. No packet-owned blockers surfaced in this recheck.

## BP Acceptance Matrix verification

- `Pipeline checks still enforce the BP-02 RSS warning/hard-limit behavior` -> verified in `src/pipeline/loop.ts:30-31` and `src/pipeline/loop.ts:342-365`, consistent with `docs/blueprint/BP-02-data-flow.md:473-481`; rechecked by `test/pipeline-spec-gap-closure.test.ts:177-242`.
- `Codex ingest work is batched or streamed so peak RSS stays within the budget on representative validation input` -> verified in `src/pipeline/ingest.ts:43-48`, `src/pipeline/ingest.ts:124-140`, `src/pipeline/ingest.ts:203-255`, `src/adapters/codex.ts:119-177`, `src/adapters/codex.ts:317-675`, and `src/adapters/codex.ts:844-1052`, matching the BP-02 adapter-memory/backpressure contract at `docs/blueprint/BP-02-data-flow.md:112-149`; fixture-scale parity reran in `test/codex-reference-adapter.test.ts:20-148` and `test/pipeline-spec-gap-closure.test.ts:109-145`, and representative-input proof now exists in `docs/execution/audits/2026-04-07-W3-PERF-01-codex-rss-validation.md:5-13` and `docs/execution/audits/2026-04-07-W3-PERF-01-codex-rss-validation.md:161-219`.
- `The fix does not widen adapter or sink contracts` -> verified by scope. No edits under `src/contracts/**` or `src/sinks/**`; the packet-owned code diff remains limited to `src/adapters/codex.ts`, `src/pipeline/ingest.ts`, and `test/pipeline-spec-gap-closure.test.ts`.
- `Runtime lifecycle semantics remain the same apart from avoiding kill-switch shutdown on normal ingest` -> verified. `src/pipeline/loop.ts:330-365` preserves the bounded-shutdown path described in `docs/blueprint/BP-07-process-lifecycle.md:311-361`, and the representative audit at `docs/execution/audits/2026-04-07-W3-PERF-01-codex-rss-validation.md:203-219` shows the normal local Codex ingest path now stays below the guard instead of relying on that shutdown path.

## V1 comparison

- Fixture-scale parity remains preserved. `test/codex-reference-adapter.test.ts:20-148` still proves stable ref IDs, message/tool IDs, compaction splitting, and spawned linkage.
- I infer representative-dataset parity from `docs/execution/audits/2026-04-07-W3-PERF-01-codex-rss-validation.md:181-199` plus `docs/execution/audits/2026-04-07-W3-PERF-01-codex-rss-validation.md:203-219`: the real `~/.codex` run discovered `181` refs and loaded `181` conversations with no warning/error output, so this recheck found no evidence that the memory fix drops conversations while reducing RSS. There is still no separate before/after transcript diff in this packet.
- The only intended behavior change remains memory profile: lighter discovery indexing, streamed full-file parsing, single-ref Codex batch cadence, and a clearable timeout helper that no longer pins successful results until timeout expiry.

## aligned

- `src/pipeline/loop.ts:30-31` and `src/pipeline/loop.ts:342-365` keep the BP-02 warning/hard-limit constants and enforcement unchanged; no limit tuning or guard removal occurred.
- `src/pipeline/ingest.ts:43-48` and `src/pipeline/ingest.ts:124-140` tighten Codex batch cadence to one ref and force reclamation between Codex refs, which is stricter than the BP-02 default backpressure boundary in `docs/blueprint/BP-02-data-flow.md:137-149`, not weaker.
- `src/pipeline/ingest.ts:203-255` replaces the uncancelled timeout race with a clearable timer, directly addressing the out-of-contract retention called out in `docs/blueprint/BP-02-data-flow.md:131-135`.
- `src/adapters/codex.ts:119-177` and `src/adapters/codex.ts:844-1052` keep discovery on a lightweight index path, bound full-model reuse to one loaded file, and reclaim scan memory per source file, which matches the BP-02 adapter-memory contract at `docs/blueprint/BP-02-data-flow.md:112-149`.
- `docs/execution/audits/2026-04-07-W3-PERF-01-codex-rss-validation.md:203-219` is durable packet-local evidence that closes the prior review blocker from `.execution/reviews/2026-04-07-W3-PERF-01-codex.md:17-21`.

## drift

- No blocking drift remains.
- Codex still hard-overrides the configured ingest batch size to `1` in `src/pipeline/ingest.ts:47-48`. That is a Codex-specific specialization tighter than the general BP-02 default of `20`, so I do not treat it as contract drift.
- `src/commands/benchmark.ts:252-307` remains unchanged and was not used as the approval artifact; the durable real-dataset audit is the packet-local evidence source for this review.

## unowned spread

- No packet-owned code spread found.
- No forbidden-file edits under `src/contracts/**` or `src/sinks/**` were needed for the fix.
- The supporting evidence expansion is confined to the expected audit document, not product-code surfaces outside the packet.

## progress

- The previous blocker in `.execution/reviews/2026-04-07-W3-PERF-01-codex.md:17-21` is resolved by the new audit artifact.
- Fresh focused validation passed: `bun test test/codex-reference-adapter.test.ts test/pipeline-spec-gap-closure.test.ts` -> `7 pass`, `0 fail`.
- The representative local Codex ingest path now has durable packet-local evidence: `106` `.jsonl` files, `181` refs loaded, `224.4 MB` peak RSS, and no `256 MB` / `hard limit` logger output.
- `W3-PERF-01` can move to `approved`.

## Codex decisions needed

- Move `W3-PERF-01` to `approved`.
- Keep `BP-02` at `mostly_aligned` until `W3-ADAPTER-06` removes Claude Code's retained full-bundle discovery/load path.
