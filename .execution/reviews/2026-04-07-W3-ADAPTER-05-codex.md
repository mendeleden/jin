# W3-ADAPTER-05 Codex Review

## verdict

- `approved`
- No blocking findings. Codex can move `W3-ADAPTER-05` to `approved`.
- Approval should not be read as `BP-04` staying fully aligned: the hardened contract plus packet-owned evidence leaves `claude-code` as an explicit follow-on packet, so the blueprint scoreboard should reflect `mostly_aligned`, not `aligned`.

## scope of review

- reviewer session: `codex-REVIEWER-adapter-memory-contract-audit`
- reviewed execution/control-plane inputs: `docs/execution/00-global-rules.md`, `docs/execution/01-dispatch-protocol.md`, `docs/execution/04-frozen-contract-surface.md`, `docs/execution/05-live-control-plane.md`, `docs/execution/tasks/W3-ADAPTER-05-adapter-memory-contract-audit.md`, `.execution/program.md`, `.execution/blueprints.md`, `.execution/packets/W3-ADAPTER-05.md`, `.execution/packets/W3-PERF-01.md`, `.execution/packets/W3-RECOVERY-01.md`, `.execution/agents/codex-WORKER-adapter-memory-contract-audit.md`, `docs/solutions/2026-04-08-adapter-memory-contract-gap.md`, `docs/execution/audits/2026-04-07-v2-runtime-bug-audit.md`
- reviewed packet-owned BP/code/tests: `docs/blueprint/BP-02-data-flow.md`, `docs/blueprint/BP-04-adapter-contract.md`, `docs/execution/audits/2026-04-07-adapter-memory-contract-audit.md`, `src/pipeline/ingest.ts`, `src/adapters/*.ts`, `test/codex-reference-adapter.test.ts`, `test/claude-code-reference-adapter.test.ts`, `test/cursor-adapter.test.ts`, `test/simple-adapters-bulk-port.test.ts`, `test/pipeline-spec-gap-closure.test.ts`
- fresh validation: `bun test test/codex-reference-adapter.test.ts test/claude-code-reference-adapter.test.ts test/cursor-adapter.test.ts test/simple-adapters-bulk-port.test.ts test/pipeline-spec-gap-closure.test.ts` -> `23 pass`, `0 fail`

## blocking findings

- None. No blocking findings in the packet-owned audit and blueprint-hardening lane.

## BP Acceptance Matrix verification

- `The blueprint now states an explicit adapter memory contract, not just a qualitative discover/load split` -> verified in `docs/blueprint/BP-02-data-flow.md:112-148` and `docs/blueprint/BP-04-adapter-contract.md:121-162`. The hardening is explicit and reviewable: bounded discovery, source-boundary reclamation, retained full-bundle discovery marked out of contract, and review questions future rich adapters must answer.
- `The audit classifies every active adapter against the memory-contract questions` -> verified in `docs/execution/audits/2026-04-07-adapter-memory-contract-audit.md:25-38`. All 10 active adapters are classified exactly once as `safe`, `blueprint/doc gap only`, or `follow-on packet needed`, with packet-owned code citations for each class.
- `The packet does not widen frozen adapter/store/sink interfaces` -> verified by scope and diff. The packet-owned change is docs/audit only; no edits landed under `src/contracts/**`, store/sink surfaces, or adapter interface types. The new simple-adapter exception is tightly bounded to one-source/one-ref local reparses and documents already-existing behavior rather than changing the frozen interface shape.
- `The prevention path for future adapters is explicit enough to use in packet reviews` -> verified in `docs/blueprint/BP-04-adapter-contract.md:150-162` and `docs/execution/audits/2026-04-07-adapter-memory-contract-audit.md:96-112`. Future rich-adapter packets now have a reusable question set and checklist instead of relying on the old qualitative “discover cheap, load expensive” wording.

## cross-adapter findings

- `safe`: `codex`, `cursor`, `kiro`, and `warp`. Their current implementations keep discovery bounded to file indexes, DB locators, or signatures, and full bundle materialization remains in `loadConversation()` or in a one-source cache (`src/adapters/codex.ts:119-177`, `src/adapters/codex.ts:879-909`, `src/adapters/cursor.ts:104-139`, `src/adapters/cursor.ts:220-279`, `src/adapters/kiro.ts:87-149`, `src/adapters/warp.ts:91-150`).
- `blueprint/doc gap only`: `amp`, `gemini-cli`, `opencode`, `pi`, and `piagent`. Each reparses one file in `findChanged()` to derive one root ref, then reparses that same file in `loadConversation()`, but none retain full bundles across files or fan one source into many refs (`src/adapters/amp.ts:61-100`, `src/adapters/gemini-cli.ts:48-87`, `src/adapters/opencode.ts:57-96`, `src/adapters/pi.ts:48-87`, `src/adapters/piagent.ts:48-87`).
- `follow-on packet needed`: `claude-code`. `findChanged()` forces `getFileModel(filePath, true)` for every changed file, `getFileModel()` persists `FileModel` objects with full `bundles` in `parsedFileCache`, and `loadConversation()` then serves clones from that retained cache (`src/adapters/claude-code.ts:206-281`, `src/adapters/claude-code.ts:501-642`). Parent resolution can also pull parent bundles into memory (`src/adapters/claude-code.ts:912-965`). The focused tests verify deterministic refs, compaction, linkage, and bundle extraction, but they do not bound memory use (`test/claude-code-reference-adapter.test.ts:21-152`).
- The audit cleanly distinguishes the classes the packet asked for. I did not find a misclassified active adapter in the packet-owned evidence.

## blueprint hardening

- `BP-02` now states that batching, yielding, RSS warnings, and the hard limit assume bounded adapter discovery, and it names the source-boundary reclamation rule explicitly (`docs/blueprint/BP-02-data-flow.md:112-148`).
- `BP-04` now treats discover/load as a memory contract, allows only bounded structural scans, constrains sibling-ref reuse, and adds a review checklist rich adapters must answer (`docs/blueprint/BP-04-adapter-contract.md:121-162`, `docs/blueprint/BP-04-adapter-contract.md:223-226`).
- This is hardening, not contract widening. The packet does not alter adapter method shape, store/sink interfaces, or lifecycle ownership. The “simple adapter” language is narrow enough that it clarifies existing bounded one-file adapters without reopening rich-adapter retained-bundle discovery.

## aligned

- The packet-owned audit is complete and reviewable: all active adapters are accounted for, the safe/doc-gap/follow-on split is explicit, and the follow-on recommendation is packetized rather than hand-waved.
- The claimed `claude-code` follow-on is justified by packet-owned evidence. The cache path is real and structurally opposite the hardened contract: discovery retains full bundles and load reads them back.
- Focused validation reran cleanly: `23` tests passed across the five allowed files.

## drift

- `.execution/blueprints.md` was stale for this lane. It still showed `BP-04` as `aligned` from pre-hardening adapter reviews even though the hardened contract now leaves `claude-code` as an explicit follow-on. I updated the scoreboard to `mostly_aligned`.
- `BP-02` also needed a control-plane refresh. The adapter-memory contract is now explicit, but the blueprint cannot return to `aligned` while `W3-PERF-01` still lacks durable representative RSS evidence and `claude-code` still retains full bundles during discovery.

## unowned spread

- The workspace contains concurrent non-packet changes in `src/adapters/codex.ts`, `src/pipeline/ingest.ts`, `test/pipeline-spec-gap-closure.test.ts`, and other prompt/task/solution files. They were reviewed only as packet-owned evidence where the prompt allowed read access; they should not be folded into `W3-ADAPTER-05` landings.
- No unowned write spread was introduced by this review. The review output is limited to this artifact plus the blueprint scoreboard update.

## progress

- `W3-ADAPTER-05` now has the required review artifact for the approval gate.
- The packet delivered the intended durable outputs: adapter-by-adapter audit, explicit BP-02/BP-04 hardening, and a reusable checklist future adapter packets can cite.
- The remaining work is correctly packetized outside this lane: representative Codex RSS evidence in `W3-PERF-01` and a narrow Claude Code discover/load memory-split hardening packet.

## Codex decisions needed

- Move `W3-ADAPTER-05` to `approved`.
- Keep `BP-04` at `mostly_aligned` until a Claude Code memory-contract follow-on lands.
- Keep `BP-02` below `aligned` until both the `W3-PERF-01` evidence gap and the Claude Code retained-bundle follow-on are closed.
