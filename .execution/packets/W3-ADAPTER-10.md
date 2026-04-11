# Packet State

- packet: `W3-ADAPTER-10`
- title: `Cursor Live Layer3 Decode And Revalidation`
- status: `approved`
- assigned agent: `codex-WORKER-cursor-live-layer3`
- branch: `feat/rewrite-ontology`
- worktree/container: `canonical repo workspace` / `local`
- depends on: `W2-ADAPTER-03`, `W3-VALIDATE-01`
- unblocks: `clean Cursor live validation`, `honest sequencing before sink reconciliation`, `workspace-member / userId work on a cleaner ingestion baseline`
- last transition: `2026-04-09`
- next Codex action: `keep the Cursor adapter change isolated for commit, then return the live blocker focus to Claude/runtime RSS and sink reconciliation`
- latest review: `2026-04-09-W3-ADAPTER-10-codex`

## Notes

- this is the next adapter priority after the approved Claude fix in
  `W3-ADAPTER-09`
- final worker handoff on `2026-04-09` reports a clean Cursor-only rerun:
  - `96` refs discovered
  - `96` bundles loaded
  - `0` null bundles
  - `96` write attempts
  - `0` write errors
  - `96` stored conversations / `1730` stored messages / `876` stored tool
    calls
- live split on the current local dataset:
  - `90` layer1 refs from
    `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`
  - `6` layer3 refs from `~/.cursor/chats/**/store.db`
- the packet-local fix surface is now:
  - recursive decode of binary layer3 pointer roots
  - tool-result stitching onto earlier assistant tool calls
  - conversation-scoped layer3 message/tool ids to avoid content-addressed
    cross-conversation collisions
- direct readonly open of `state.vscdb` succeeded on the final packet run, so
  the earlier `SQLITE_CANTOPEN` report is now treated as transient or
  environment-specific rather than the primary adapter blocker
- operator note:
  - the current live config at `~/.config/jin/config.json` has
    `adapters.cursor.allowProtectedSource: false`, so repeated macOS “read
    other apps' data” prompts likely came from an earlier explicit protected
    source run or override path rather than the current default runtime config
