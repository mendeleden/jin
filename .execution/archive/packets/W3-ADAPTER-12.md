# Packet State

- packet: `W3-ADAPTER-12`
- title: `Cursor Tool Stitching And Layer1 Metadata Follow-up`
- status: `approved`
- assigned agent: `codex-WORKER-cursor-followup`
- branch: `feat/rewrite-ontology`
- worktree/container: `canonical repo workspace` / `local`
- depends on: `W3-ADAPTER-10`, `W3-VALIDATE-01`
- unblocks: `honest Cursor correctness after W3-ADAPTER-10`, `safe downstream validation/reporting on Cursor sessions`, `keeping post-approval data-loss bugs out of sink and userId work`
- last transition: `2026-04-10`
- next Codex action: `carry the approved Cursor follow-up as the stable adapter baseline while W3-PERF-04 and W3-SINK-04 stay open`
- latest review: `2026-04-10-W3-ADAPTER-12-codex.md` (`approved`)

## Notes

- this lane exists because a post-approval SWE report against the current local
  dataset is not stale enough to ignore
- current Codex implementation result:
  - repeated same-name Layer 3 tool results now match by exact `toolCallId`
    before any name fallback, in both inline and cross-message stitching paths
  - Layer 1 `cwd` now prefers decoded `workspaceUris` from bubble rows
  - Layer 1 `thinkingContent` now maps current raw `thinking` /
    `allThinkingBlocks` fields when text exists
  - Layer 3 fallback naming now strips Cursor synthetic wrappers
    (`<user_info>`, `<git_status>`, `<rules>`, `<user_query>`, etc.)
  - packet-local docs/ontology surfaces are refreshed to reflect the current
    Layer 1 + Layer 3 adapter
  - focused regression tests are green and packet-local live probes support the
    fixes
- this follow-up pass addresses both review blockers:
  - cross-message Layer 3 tool-result matching is now two-pass across all
    messages (`toolCallId` first, then name, then global fallback)
  - naming cleanup now strips only a leading synthetic envelope instead of
    globally removing wrapper-like tags from user-authored content
  - focused regression coverage now includes:
    - late cross-message tool-result stitching against older tools
    - preserving literal wrapper-like tags in user-authored prompts
  - focused validation rerun:
    - `bun test test/cursor-adapter.test.ts` -> `12/12` pass
    - live source split probe -> `96` total refs (`90` Layer 1, `6` Layer 3)
    - live repeated same-name probe -> `58` repeated tools, `0` missing outputs
- detached re-review is now approved:
  - `2026-04-10-W3-ADAPTER-12-codex.md`
  - no blocking findings remain
  - remaining Cursor gaps stay explicitly out of scope for this lane:
    Layer 2 transcripts, git enrichment, and Layer 3 token availability
- this is a Cursor-local follow-up lane; `W3-PERF-04` remains the main runtime
  blocker on the binary path
