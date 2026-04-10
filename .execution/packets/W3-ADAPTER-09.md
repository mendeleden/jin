# Packet State

- packet: `W3-ADAPTER-09`
- title: `Claude Code Duplicate-ID Collision Fix And Live Revalidation`
- status: `in_progress`
- assigned agent: `codex-WORKER-claude-code-id-collision`
- branch: `feat/rewrite-ontology`
- worktree/container: `canonical repo workspace` / `local`
- depends on: `W3-ADAPTER-07`, `W3-VALIDATE-01`
- unblocks: `clean Claude live validation`, `honest adapter confidence before Cursor/sink follow-ups`, `workspace-member / userId work on a cleaner ingestion baseline`
- last transition: `2026-04-09`
- next Codex action: `wait for the detached Claude worker handoff, then review whether the duplicate loaded conversation IDs and messages.id collisions are fixed on the live Claude dataset`
- latest review: `none`

## Notes

- this is the next functional priority from `W3-VALIDATE-01`
- the lane is narrower than `W3-ADAPTER-08`; it targets the live duplicate-ID
  failure class first and only widens into a structural split if that is
  required to land a safe fix
- current live symptoms from the validation audit:
  - `6` duplicate loaded conversation IDs
  - `29` `UNIQUE constraint failed: messages.id` write failures
