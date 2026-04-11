# Packet State

- packet: `W2-ADAPTER-04`
- title: `Simple Adapters Bulk Port`
- status: `approved`
- assigned agent: `codex-WORKER-simple-adapters-bulk-port`
- branch: `feat/rewrite-ontology`
- worktree/container: `canonical repo workspace` / `local`
- depends on: `W1-ADAPTER-01`, `W2-ADAPTER-02`, `W2-ADAPTER-03`
- unblocks: `broad BP-04 coverage`
- last transition: `2026-04-04`
- next Codex action: `commit the scoped simple-adapter diff, then carry the review's informational adapter cleanup notes as non-blocking follow-up`
- latest review: `2026-04-03-W2-ADAPTER-04-cursor`

## Notes

- worker heartbeat: `.execution/agents/codex-WORKER-simple-adapters-bulk-port.md`
- review artifact: `.execution/reviews/2026-04-03-W2-ADAPTER-04-cursor.md`
- owned diff:
  - `src/adapters/amp.ts`
  - `src/adapters/gemini-cli.ts`
  - `src/adapters/kiro.ts`
  - `src/adapters/opencode.ts`
  - `src/adapters/pi.ts`
  - `src/adapters/piagent.ts`
  - `src/adapters/warp.ts`
  - `test/simple-adapters-bulk-port.test.ts`
- packet checks re-run on `2026-04-04`:
  - `bun x tsc --noEmit --pretty false src/adapters/amp.ts src/adapters/gemini-cli.ts src/adapters/kiro.ts src/adapters/opencode.ts src/adapters/pi.ts src/adapters/piagent.ts src/adapters/warp.ts test/simple-adapters-bulk-port.test.ts`
  - `bun test test/simple-adapters-bulk-port.test.ts`
- `2026-04-03-W2-ADAPTER-04-cursor` approves the packet with informational follow-ups only:
  - file-backed adapters still parse full conversations during `buildRef()` discovery
  - `resolveGit()` and file readers still use silent defensive catches, consistent with the approved reference adapters
  - shared utility duplication and legacy bridge methods remain intentionally local to the adapter files
