# W3-ADAPTER-10 Codex Review

## verdict

- `approve`
- No blocking findings. The current diff fixes the original live Cursor `6/6` null-bundle failure inside the adapter/test lane only, and the current local rerun is still clean at `96` refs discovered, `96` bundles loaded, `0` null bundles, and `0` write errors.

## scope of review

- Read the required execution docs, current control-plane state, `W3-VALIDATE-01` audit, `W3-ADAPTER-10` audit, solution note, and the packet-owned BP/code/test files.
- Reviewed the current diff in `src/adapters/cursor.ts` and `test/cursor-adapter.test.ts`; `scripts/live-validation/run.ts` has no packet-local diff.
- Re-ran:
  - `bun test test/cursor-adapter.test.ts`
  - the packet-local readonly `state.vscdb` probe
  - the packet-local live ref-split probe
  - `bun scripts/live-validation/run.ts --adapters=cursor --output-dir=/tmp/jin-live-validation-cursor-review --cursor-chats-dir="$HOME/.cursor/chats" --cursor-db-path="$HOME/Library/Application Support/Cursor/User/globalStorage/state.vscdb"`
  - the packet-local store cross-check queries against `/tmp/jin-live-validation-cursor-review/config/store.db`

## blocking findings

- None.

## BP Acceptance Matrix verification

- Live Cursor layer3 refs no longer collapse into null bundles because the adapter now decodes binary pointer roots into ordered blob chains and emits only resolved JSON message rows in `src/adapters/cursor.ts:653-769` and `src/adapters/cursor.ts:1211-1264`. Focused regression coverage is in `test/cursor-adapter.test.ts:192-231`. The current live rerun verifies this on the real dataset: `96` refs discovered, `96` bundles loaded, `0` null bundles.
- Layer3 tool-result stitching is implemented where the packet says it is: `extractLayer3Content()` records unmatched tool results, and `applyLayer3ToolResults()` patches them onto earlier assistant tool calls before empty tool rows are skipped in `src/adapters/cursor.ts:672-707`, `src/adapters/cursor.ts:1059-1183`, and `src/adapters/cursor.ts:1266-1295`. The live-style fixture proving separate `role: "tool"` rows are stitched back into the earlier assistant message is in `test/cursor-adapter.test.ts:192-231` and `test/cursor-adapter.test.ts:391-507`.
- The content-addressed layer3 collision class is fixed adapter-locally by conversation-scoping emitted layer3 message IDs and tool-call IDs in `src/adapters/cursor.ts:689-706` and `src/adapters/cursor.ts:1185-1209`, with cross-conversation regression coverage in `test/cursor-adapter.test.ts:233-268`. No store, sink, pipeline, or contract file is part of the packet diff.
- Mixed layer1/layer3 discovery still behaves honestly. Layer1 open failures remain warning-and-continue through `openReadonlyDb()` in `src/adapters/cursor.ts:866-871`, and the degraded path is covered in `test/cursor-adapter.test.ts:270-295`. On the current workstation, the readonly probe now succeeds and `findChanged({ kind: "startup-scan" })` still returns the expected `90` layer1 refs plus `6` layer3 refs.
- Cursor-only live validation still records the exact packet-local counts required by `BP-10`: the current rerun produced `96` refs discovered, `96` unique conversations loaded, `96` write attempts, `0` write errors, `96` stored conversations, `1730` stored messages, and `876` stored tool calls in `/tmp/jin-live-validation-cursor-review/report.json`.
- Diff scope remains inside the lane. `git diff --stat -- src/adapters/cursor.ts test/cursor-adapter.test.ts docs/execution/audits/2026-04-09-W3-ADAPTER-10-cursor-live-layer3-decode-and-revalidation.md docs/solutions/2026-04-09-cursor-live-layer3-pointer-roots-and-content-addressed-ids.md` reports only adapter/test changes plus packet-local docs, and there is no packet-local diff in `scripts/live-validation/run.ts`.

## V1 comparison

- Intentional BP-backed change. The prior layer3 path assumed JSON `parentId` chains and reused raw blob IDs as emitted message/tool IDs, which is why the live `W3-VALIDATE-01` run collapsed into `6/6` null bundles and the first post-decode rerun exposed `messages.id` collisions. The current adapter keeps the frozen store/sink contracts intact but intentionally changes layer3 decode and emitted layer3 IDs to meet BP-04/BP-10 live-data correctness.

## aligned

- The code matches the packet-local audit claim that live layer3 roots are binary pointer blobs, not direct JSON message rows.
- Separate `role: "tool"` result rows are stitched honestly into earlier assistant tool calls rather than being dropped or emitted as standalone assistant messages.
- Conversation-scoped layer3 IDs fix the content-addressed collision class without widening into store or sink semantics.
- The current workstation rerun matches the worker audit counts exactly, including the mixed `90` layer1 / `6` layer3 discovery split and the clean `96`-conversation disposable-store write.

## drift

- The operator review prompt referenced `docs/blueprint/BP-10-release-validation.md`, but the current blueprint source-of-truth file is `docs/blueprint/BP-10-performance-validation.md`. This did not block review because the current blueprint index and content clearly point to the renamed file.
- `test/cursor-adapter.test.ts` still uses the describe label `W2-ADAPTER-03 Cursor reference adapter`; this is informational only.

## unowned spread

- None in the packet diff. The repo worktree is dirty in unrelated files, but the packet-local functional changes reviewed here remain confined to the Cursor adapter/test surface plus packet-local audit/solution docs.

## progress

- `W3-ADAPTER-10` is review-complete and can move from `review_ready` to `approved`.
- This closes the remaining Cursor adapter follow-up from `W3-VALIDATE-01` and returns the next release-gate focus to sink reconciliation rather than adapter decode correctness.

## Codex decisions needed

- Move `W3-ADAPTER-10` to `approved`.
- Optionally clean up the stale BP-10 filename reference in packet/review prompts on a docs lane.
