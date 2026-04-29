# Packet State

- packet: `W2-ADAPTER-03`
- title: `Cursor Reference Adapter`
- status: `approved`
- assigned agent: `codex-WORKER-cursor-reference-adapter`
- branch: `feat/rewrite-ontology`
- worktree/container: `canonical repo workspace` / `local`
- depends on: `W0-CODEX-01`
- unblocks: `shared-db adapter validation`
- last transition: `2026-04-03`
- next Codex action: `isolate and commit the scoped Cursor adapter diff alongside the rest of the approved adapter wave`
- latest review: `2026-04-02-W2-ADAPTER-03-cursor`

## Notes

- verified worker heartbeat exists at
  `.execution/agents/codex-WORKER-cursor-reference-adapter.md`
- preferred session name: `codex-WORKER-cursor-reference-adapter`
- verified branch/worktree are `feat/rewrite-ontology` in the canonical repo
  workspace
- verified actual diff: `src/adapters/cursor.ts` and `test/cursor-adapter.test.ts`
- verified packet test run: `bun test test/cursor-adapter.test.ts`
- verified packet-local typecheck: `bun x tsc --noEmit --pretty false src/adapters/cursor.ts test/cursor-adapter.test.ts`
- `2026-04-02-W2-ADAPTER-03-cursor` re-review is approved:
  - `toolUses` now matches the frozen contract
  - unsafe `as unknown as` casts are removed from the v2 bundle path
  - `thinkingTokens` is explicitly set to `0`
  - turn numbering now follows role-transition semantics
  - `durationMs` for unknown tool-call timing is `-1`
- remaining findings are informational only:
  - `gitRemote` and `branch` stay empty when Cursor source data does not expose a usable cwd
  - JSON decode helpers still use narrow bare catches for malformed blobs
  - Layer 3 timestamps remain coarse because the source store lacks per-message timestamps
