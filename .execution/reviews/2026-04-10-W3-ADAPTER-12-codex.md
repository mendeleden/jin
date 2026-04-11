# W3-ADAPTER-12 Codex Review

## verdict

- `approved`
- `W3-ADAPTER-12` can move to `approved`. No blocking findings remain. The current Cursor patch now uses exact `toolCallId` matching before any name fallback in both Layer 3 stitching paths, keeps Layer 1 `cwd` / `thinkingContent` enrichment inside the existing adapter contract, narrows fallback naming to the leading synthetic Cursor prelude instead of user-authored prompt content, and stays inside the owned Cursor adapter/test/doc surface (`src/adapters/cursor.ts:1153-1158`, `src/adapters/cursor.ts:1283-1365`, `src/adapters/cursor.ts:1382-1407`, `src/adapters/cursor.ts:1506-1642`).

## scope of review

- Read the required execution docs, live control-plane files, `W3-ADAPTER-10` / `W3-VALIDATE-01` packet state, the worker heartbeat, and both relevant Cursor audits.
- Reviewed the current packet-owned blueprint/code/test/doc surfaces in `docs/blueprint/BP-02-data-flow.md`, `docs/blueprint/BP-04-adapter-contract.md`, `src/adapters/cursor.ts`, `test/cursor-adapter.test.ts`, `docs/adapters/cursor/index.md`, `docs/adapters/cursor/orchestration.md`, and `docs/ontology.md`.
- Reviewed the current packet diff in `src/adapters/cursor.ts`, `test/cursor-adapter.test.ts`, `docs/adapters/cursor/index.md`, `docs/adapters/cursor/orchestration.md`, and `docs/ontology.md`.
- Re-ran:
  - `bun test test/cursor-adapter.test.ts`
  - the packet-local live ref-split probe
  - the packet-local Layer 3 naming probe
  - the packet-local repeated same-name tool-result probe
  - the packet-local representative repeated-tool session probe
  - the packet-local Layer 1 `cwd` / `thinkingContent` probe
  - the packet-local representative Layer 1 thinking sample probe

## blocking findings

- No blocking findings.

## BP Acceptance Matrix verification

- Layer 3 tool-result stitching now uses exact `toolCallId` matching before any name fallback in both stitching paths. Inline `tool-result` attachment in `extractLayer3Content()` calls `findLayer3ToolUseInList()` with exact-id matching first and only then name/tail fallback (`src/adapters/cursor.ts:1146-1158`, `src/adapters/cursor.ts:1338-1365`). Cross-message stitching in `applyLayer3ToolResults()` now does a full reverse pass over all older messages by `toolCallId` before any name-based pass or global fallback (`src/adapters/cursor.ts:1268-1335`). Focused regression coverage is in `test/cursor-adapter.test.ts:276-330`. The live probes still show `6` Layer 3 conversations, `20` messages with repeated same-name tools, `58` repeated same-name tool calls, and `0` repeated same-name tool calls with empty outputs; the representative live session `3c29dee7-efd4-46d1-984d-abad992f016a` still loads one `Read` cluster with `12` non-empty outputs.
- Layer 1 `cwd` and `thinkingContent` enrichment stays inside the current adapter contract. The adapter only populates existing `ParsedConversation.cwd` and `ParsedMessage.thinkingContent` fields from Layer 1 bubble data (`src/adapters/cursor.ts:450-504`, `src/adapters/cursor.ts:1506-1557`), which matches BP-04’s parsed adapter surface and remains outside store/pipeline ownership (`docs/blueprint/BP-04-adapter-contract.md:346-363`, `docs/blueprint/BP-04-adapter-contract.md:389-434`). Regression coverage is in `test/cursor-adapter.test.ts:151-158`, and the live probe still reports `90` Layer 1 conversations, `15` with non-empty `cwd`, and `140` messages with non-empty `thinkingContent`.
- Layer 3 fallback naming now ignores only Cursor’s synthetic wrapper prelude rather than user-authored prompt content. `pickConversationName()` uses `stripCursorSyntheticPrelude()` to reject synthetic-only user turns and derive titles from the first real prompt (`src/adapters/cursor.ts:1382-1407`), while the helper now strips only leading wrapper blocks and only unwraps a top-level `<user_query>` envelope (`src/adapters/cursor.ts:1581-1642`). Focused regression coverage is in `test/cursor-adapter.test.ts:332-390`, and the live naming probe shows all `6` Layer 3 conversations now have prompt-derived names with no leading synthetic wrapper text.
- Packet-owned Cursor docs and the Cursor mapping in `docs/ontology.md` are materially refreshed and match the current code plus packet-local live evidence. `docs/adapters/cursor/index.md:5-40` now describes Layer 1 + Layer 3 ingestion, partial Layer 1 tool-result capture, and partial Layer 1 thinking capture. `docs/adapters/cursor/orchestration.md:274-290` now describes Layer 1 token, thinking, and tool-result availability as partial rather than absent. `docs/ontology.md:352-370` now maps Layer 1 `workspaceUris`, `thinking.text` / `allThinkingBlocks[]`, and Layer 3 `tool-result` blobs onto the v2 fields the adapter actually emits.
- The lane remains inside the packet boundary. The reviewed functional/doc diff is confined to `src/adapters/cursor.ts`, `test/cursor-adapter.test.ts`, `docs/adapters/cursor/index.md`, `docs/adapters/cursor/orchestration.md`, and `docs/ontology.md`, with packet-local audit material under `docs/execution/audits/`; no store, pipeline, sink, or contract file is part of the packet-local change surface.

## V1 comparison

- Intentional BP-backed improvement with no regression found in this re-review. Relative to the prior approved Cursor surface, this packet tightens Layer 3 repeated-tool stitching, fills Layer 1 `cwd` / `thinkingContent` inside the existing parsed adapter fields, and narrows fallback title cleanup to the leading synthetic Cursor prelude without widening frozen store/pipeline semantics.

## aligned

- Exact-`toolCallId`-first matching is now shared by both Layer 3 stitching paths, and the focused tests plus live repeated-tool probes support the worker audit’s claim.
- Layer 1 metadata enrichment is adapter-local only and stays within BP-04’s existing `ParsedConversation` / `ParsedMessage` fields rather than widening store or pipeline behavior.
- The refreshed Cursor docs and Cursor-specific ontology mapping no longer claim the adapter is Layer 3-only or that tool results / thinking are categorically absent.
- Focused validation matches the worker audit counts on this workspace: `12` tests passed, `96` refs discovered, `90` Layer 1 refs, `6` Layer 3 refs, `20` repeated-name Layer 3 messages, `58` repeated-name Layer 3 tool calls with `0` empty outputs, `15` Layer 1 conversations with `cwd`, and `140` messages with non-empty `thinkingContent`.

## drift

- `test/cursor-adapter.test.ts` still uses the describe label `W2-ADAPTER-03 Cursor reference adapter`; this is informational only.
- `.execution/program.md` and `.execution/packets/W3-ADAPTER-12.md` still describe the earlier blocker / re-review state. That control-plane narrative is now stale relative to the current code, tests, and live probes, but those files are Codex-owned rather than reviewer-owned.

## unowned spread

- None in the packet diff. The repo worktree is dirty in many unrelated files, but the packet-local functional/doc changes reviewed here remain confined to the Cursor adapter/test/doc surface plus packet-local audit material.

## progress

- `W3-ADAPTER-12` is review-complete on the current tree and is ready to move from `review_ready` to `approved`.
- The focused rerun still matches the packet-local audit: `bun test test/cursor-adapter.test.ts` passed `12/12`, the live ref split remains `96` total refs (`90` Layer 1, `6` Layer 3), the repeated same-name tool probe reports `0` empty outputs, and the live naming / Layer 1 metadata probes remain clean.

## Codex decisions needed

- Move `W3-ADAPTER-12` to `approved`.
- Update `.execution/program.md` and `.execution/packets/W3-ADAPTER-12.md` so the live control plane no longer advertises the stale earlier blocker / `needs_codex` narrative.
- Keep remaining Cursor follow-ups limited to the already-documented out-of-scope gaps (`Layer 2` transcript ingestion, git enrichment, Layer 3 token availability), not this now-closed lane.
