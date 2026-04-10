# W3-ADAPTER-06 Codex Review

## verdict

- `approved`
- No blocking findings. Codex can move `W3-ADAPTER-06` to `approved`.
- `BP-02` and `BP-04` can return to `aligned`: `W3-PERF-01` already closed the representative Codex RSS evidence gap, and this packet closes the remaining Claude Code retained-bundle follow-on from `2026-04-07-W3-ADAPTER-05-codex`.

## scope of review

- reviewer session: `codex-REVIEWER-claude-code-memory-hardening`
- reviewed execution/control-plane inputs: `docs/execution/00-global-rules.md`, `docs/execution/01-dispatch-protocol.md`, `docs/execution/05-live-control-plane.md`, `docs/execution/tasks/W3-ADAPTER-06-claude-code-discover-load-memory-hardening.md`, `.execution/program.md`, `.execution/blueprints.md`, `.execution/packets/W3-ADAPTER-06.md`, `.execution/packets/W3-ADAPTER-05.md`, `.execution/agents/codex-WORKER-claude-code-memory-hardening.md`, `.execution/reviews/2026-04-07-W3-ADAPTER-05-codex.md`, `docs/execution/audits/2026-04-07-adapter-memory-contract-audit.md`, `docs/execution/audits/2026-04-08-claude-code-memory-hardening-validation.md`
- reviewed packet-owned BP/code/tests: `docs/blueprint/BP-02-data-flow.md`, `docs/blueprint/BP-04-adapter-contract.md`, `src/adapters/claude-code.ts`, `test/claude-code-reference-adapter.test.ts`
- fresh validation: `bun test test/claude-code-reference-adapter.test.ts` -> `5 pass`, `0 fail`

## blocking findings

- None. No blocking findings in the packet-owned Claude Code memory hardening lane.

## BP Acceptance Matrix verification

- `Claude Code discovery obeys the hardened BP-04 memory contract: bounded structural scan only, no retained full-bundle discovery cache across changed files` -> implemented in `src/adapters/claude-code.ts:225-279` and `src/adapters/claude-code.ts:518-680`. `findChanged()` now reads per-file indexes through `getFileIndex()`, `fileIndexCache` retains only `{ sessionId, refs }`, and full `FileModel` / `bundles` retention no longer spans discovery across multiple files. Verified by `test/claude-code-reference-adapter.test.ts:154-224` and the packet-local validation note at `docs/execution/audits/2026-04-08-claude-code-memory-hardening-validation.md:6-36`.
- `loadConversation()` still preserves deterministic IDs, parent linkage, compaction/sub-agent semantics, and bundle shape -> implemented in `src/adapters/claude-code.ts:281-299`, `src/adapters/claude-code.ts:682-790`, and `src/adapters/claude-code.ts:1076-1129`. The full bundle builder and parent-link resolution path remain intact, now behind a one-source load cache. Verified by `test/claude-code-reference-adapter.test.ts:21-152`.
- `The fix does not widen adapter/store/sink contracts or spill into runtime/store recovery lanes` -> verified by diff scope. The packet changes are limited to `src/adapters/claude-code.ts`, `test/claude-code-reference-adapter.test.ts`, and `docs/execution/audits/2026-04-08-claude-code-memory-hardening-validation.md`; no edits landed in `src/contracts/**`, runtime/store code, or sink code.
- `Representative packet-local validation makes the memory improvement explicit enough to close the follow-on noted by W3-ADAPTER-05` -> verified in `test/claude-code-reference-adapter.test.ts:154-224` and `docs/execution/audits/2026-04-08-claude-code-memory-hardening-validation.md:6-36`. The validation uses a five-file fixture, proves discovery leaves `loadedFileCache` empty, proves `fileIndexCache` entries do not retain `bundles`, and proves cross-file loads replace the prior full-model cache entry instead of accumulating multi-file bundle state.

## V1 comparison

- Parity kept for observable adapter output. Deterministic IDs, compaction splitting, spawned-parent linkage, tool-call extraction, and the `{ conversation, messages }` bundle shape still pass the focused contract tests in `test/claude-code-reference-adapter.test.ts:21-152`.
- The intentional change is memory-only: discovery no longer retains multi-file `ConversationBundle[]`, and load-time reuse is now explicitly bounded to one source via `loadedFileCache` (`src/adapters/claude-code.ts:225-299`, `src/adapters/claude-code.ts:518-606`).

## aligned

- The packet removes the exact retained-bundle path called out by `W3-ADAPTER-05`. Discovery now computes lightweight per-file ref indexes and releases full parsed models before moving to the next source (`src/adapters/claude-code.ts:225-279`, `src/adapters/claude-code.ts:535-680`), matching the BP-02/BP-04 memory-contract language in `docs/blueprint/BP-02-data-flow.md:114-148` and `docs/blueprint/BP-04-adapter-contract.md:123-162`.
- The load path still honors the frozen adapter semantics. `loadConversation()` clones from the same full bundle builder, and parent resolution still derives `traceId`, `parentId`, and `forkPoint` from the parent source at load time (`src/adapters/claude-code.ts:281-299`, `src/adapters/claude-code.ts:682-790`, `src/adapters/claude-code.ts:1076-1129`).
- The packet-local validation is specific to Claude Code rather than analogy to other adapters. It measures the retained-state boundary directly, which is the exact follow-on `W3-ADAPTER-05` asked this lane to close (`docs/execution/audits/2026-04-08-claude-code-memory-hardening-validation.md:6-36`).

## drift

- No packet-owned BP/code/test drift remains.
- Expected control-plane lag remains outside reviewer ownership: `.execution/packets/W3-ADAPTER-06.md` still shows `latest review: none` and `review_ready` until `codex-BRAIN` records this artifact and applies the packet transition.

## unowned spread

- The workspace contains unrelated concurrent changes and untracked execution files outside this packet. They were not evaluated for `W3-ADAPTER-06` approval and should not be folded into this lane.
- No unowned write spread was introduced by this review; reviewer output is limited to this artifact plus `.execution/blueprints.md`.

## progress

- `W3-ADAPTER-06` closes the explicit Claude Code follow-on opened by `2026-04-07-W3-ADAPTER-05-codex`.
- Claude Code now matches the hardened BP-02/BP-04 memory contract: discovery is bounded to structural ref indexes and full bundle reuse is bounded to one loaded source.
- The remaining work is control-plane transition, not more adapter hardening.

## Codex decisions needed

- Move `W3-ADAPTER-06` to `approved`.
- Update `.execution/program.md` and `.execution/packets/W3-ADAPTER-06.md` to record this review artifact and the approval transition.
- Keep `.execution/blueprints.md` at `BP-02: aligned` and `BP-04: aligned` after the packet state change.
