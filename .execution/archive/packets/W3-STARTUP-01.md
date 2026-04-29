# Packet State

- packet: `W3-STARTUP-01`
- title: `Protected Source Opt-In`
- status: `approved`
- assigned agent: `codex-WORKER-protected-source-opt-in`
- branch: `feat/rewrite-ontology`
- worktree/container: `canonical repo workspace` / `local`
- depends on: `W3-PRODUCT-01 or equivalent startup-surface stability`
- unblocks: `experimental release confidence`, `per-OS startup discovery policy`
- last transition: `2026-04-06`
- next Codex action: `commit the scoped startup hardening diff and then continue tracking W3-TEAM-01`
- latest review: `2026-04-06-W3-STARTUP-01-codex`

## Notes

- created from the macOS privacy prompt investigation after `jin` attempted to
  access protected app-private data on startup
- most likely trigger currently identified:
  - `src/adapters/cursor.ts` probing
    `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`
- current startup risk surface also includes adapter detection from:
  - `src/commands/watch.ts`
  - `src/commands/init.ts`
  - `src/adapters/registry.ts`
  - any other adapter `detect()` paths that read app-private stores
- target outcome:
  - no startup probe of protected/app-private data without explicit opt-in
  - no auto-enable/writeback of newly detected adapters during daemon startup
  - documented per-OS policy for protected adapter discovery on macOS, Linux,
    and Windows
- live worker artifacts:
  - heartbeat: `.execution/agents/codex-WORKER-protected-source-opt-in.md`
  - detached session: `tmux attach -t jin-w3-startup`
  - log: `.execution/logs/codex-W3-STARTUP-01.jsonl`
- approved on the Codex review pass:
  - review artifact: `.execution/reviews/2026-04-06-W3-STARTUP-01-codex.md`
  - focused rerun: `bun test test/startup-protected-source-opt-in.test.ts test/config-mutation-control.test.ts test/init.test.ts test/cursor-adapter.test.ts`
  - remaining notes are informational only:
    - `detectAdapters()` does not apply protected-source gating, but it is not on the startup path
    - `jin init` still saves normalized config as a retained compatibility helper
