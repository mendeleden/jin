# W3-ADAPTER-09 Codex Review

## verdict

- `approve-ready`
- Detached verification matched the worker handoff: `bun test test/claude-code-reference-adapter.test.ts` passed `13/13`; the two packet-local live probes returned `919` refs, `919` unique loaded conversation IDs, `0` duplicate loaded IDs, `0` cross-conversation message-ID collisions, and `0` within-bundle duplicate message IDs; the audit-cited `/tmp/jin-live-validation-claude-UVJqaK/report.json` still records `919` write attempts, `0` write errors, `0` issues, and `report.summary.ok: true`.

## scope of review

- Read, in order, `docs/execution/00-global-rules.md`, `docs/execution/01-dispatch-protocol.md`, `docs/execution/05-live-control-plane.md`, and `docs/execution/tasks/W3-ADAPTER-09-claude-code-duplicate-id-collision-fix-and-live-revalidation.md`.
- Read live control plane and evidence files: `.execution/program.md`, `.execution/blueprints.md`, `.execution/packets/W3-ADAPTER-09.md`, `.execution/packets/W3-VALIDATE-01.md`, `.execution/agents/codex-WORKER-claude-code-id-collision.md`, `docs/execution/audits/2026-04-09-W3-ADAPTER-09-claude-code-duplicate-id-collision-fix-and-live-revalidation.md`, and `docs/execution/audits/2026-04-08-W3-VALIDATE-01-live-adapter-validation-and-reconciliation.md`.
- Inspected packet-owned blueprint/code/tests only: `docs/blueprint/BP-02-data-flow.md`, `docs/blueprint/BP-04-adapter-contract.md`, `src/adapters/claude-code.ts`, `test/claude-code-reference-adapter.test.ts`, and `scripts/live-validation/run.ts`.
- Re-ran the allowed focused checks and inspected the audit-cited live-validation artifacts under `/tmp/jin-live-validation-claude-UVJqaK/`.

## blocking findings

- None. I did not find a blocker in the adapter-local ID derivation, spawned/compaction linkage, or the worker evidence.

## BP Acceptance Matrix verification

- `Claude live conversation identity is stable across refs loaded from the real local dataset` -> implemented in `src/adapters/claude-code.ts:772`, `src/adapters/claude-code.ts:1202`, and `src/adapters/claude-code.ts:1328`; `inspectFile()` now derives spawned conversation IDs from parent scope + raw source ID + file stem, and `resolveParentLink()` preserves `traceId` / `parentId` linkage under the new IDs. Verified by `test/claude-code-reference-adapter.test.ts:567` and the detached duplicate-ID probe (`919` refs -> `919` unique IDs -> `0` duplicates).
- `Disposable-store validation no longer fails on messages.id uniqueness for the Claude live run if the fix remains adapter-local` -> implemented in `src/adapters/claude-code.ts:912`, `src/adapters/claude-code.ts:1405`, `src/adapters/claude-code.ts:1427`, and `src/adapters/claude-code.ts:1433`; parsed message IDs are now conversation-scoped deterministic hashes with occurrence disambiguation, and `parentMessageId` resolves through the parsed-ID map instead of raw UUIDs. Verified by `test/claude-code-reference-adapter.test.ts:241`, the detached message-collision probe (`0` cross-conversation collisions, `0` internal duplicate bundles), and the audit-cited `/tmp/jin-live-validation-claude-UVJqaK/report.json` (`919` write attempts, `0` write errors).
- `The lane stays inside Claude adapter/harness owned files and does not widen into sink/store contracts` -> satisfied. The functional fix is confined to `src/adapters/claude-code.ts` plus packet-local tests/audit; I found no need for `src/contracts/**`, `src/pipeline/**`, `src/sinks/**`, or schema changes to explain the clean live result. `scripts/live-validation/run.ts` remains supporting evidence, not a contract change requirement for this packet.
- `Remaining duplicate loaded conversation IDs are either eliminated or explicitly explained as expected overlap with Codex approval` -> eliminated. The detached read-only probe and the audit-cited `report.json` both record `duplicateConversationIdsLoaded: 0`, so there is no remaining overlap to defer or explain away.

## V1 comparison

- Prior Claude behavior trusted raw upstream IDs too directly: child conversations used raw subagent IDs, and messages used raw `uuid` values, which matched the `W3-VALIDATE-01` live failures (`6` duplicate loaded conversation IDs and `29` `messages.id` write failures).
- This lane is an intentional BP-04-backed bug fix, not a contract rewrite: the adapter now derives deterministic, adapter-local conversation/message IDs while preserving the same root/compacted/spawned relationship model and the same store/pipeline/sink interfaces.
- Compaction and spawned linkage parity is preserved: compaction splitting still comes from the source-file boundary markers in `buildFileModel()`, and spawned parent selection still prefers the matched parent bundle, defaulting to the latest parent bundle when a compacted parent emitted the child (`src/adapters/claude-code.ts:804`, `src/adapters/claude-code.ts:1254`).

## aligned

- `BP-04` deterministic identity requirement is now satisfied for the live Claude dataset: child IDs are parent-scoped and message IDs are conversation-scoped.
- `BP-02` buffer/store boundary remains intact: the fix removes the `messages.id` collision class without any store or sink contract change.
- The worker audit is honest on the evidence I could check directly: the detached probes and the persisted `/tmp` artifacts all match the counts recorded in `docs/execution/audits/2026-04-09-W3-ADAPTER-09-claude-code-duplicate-id-collision-fix-and-live-revalidation.md`.

## drift

- Non-blocking drift remains in `resolveGit()`: live probes still emit `fatal: not a git repository` stderr for source `cwd` values that are not git working trees. The audit calls this out explicitly, the detached probe reproduced it, and it did not invalidate the Claude counts or the clean disposable-store result.
- Packet-external live validation drift is now narrower: the outstanding adapter follow-up from `W3-VALIDATE-01` is Cursor `null-bundle` / DB-open failure, not Claude ID collisions.

## unowned spread

- The workspace is dirty outside this packet, including unrelated files and earlier approved Claude-path work in the same adapter/test files. I treated that as ambient branch state, not as `W3-ADAPTER-09` ownership.
- Within the review lane, I did not find evidence that this packet widened into unowned store, sink, or contract files.

## progress

- `W3-ADAPTER-09` is review-complete from the Codex lane.
- The Claude duplicate loaded conversation ID class is fixed on the live dataset.
- The Claude `messages.id` collision class is fixed adapter-locally, and the audit-cited disposable-store run is consistent with a clean ingest.

## Codex decisions needed

- Codex can move `W3-ADAPTER-09` from `review_ready` to `approved`.
- After approval, the next adapter priority remains the Cursor follow-up from `W3-VALIDATE-01`; no additional Claude-specific design decision is needed for this packet.
