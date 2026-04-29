# Packet State

- packet: `W3-ADAPTER-09`
- title: `Claude Code Duplicate-ID Collision Fix And Live Revalidation`
- status: `approved`
- assigned agent: `codex-WORKER-claude-code-id-collision`
- branch: `feat/rewrite-ontology`
- worktree/container: `canonical repo workspace` / `local`
- depends on: `W3-ADAPTER-07`, `W3-VALIDATE-01`
- unblocks: `clean Claude live validation`, `honest adapter confidence before Cursor/sink follow-ups`, `workspace-member / userId work on a cleaner ingestion baseline`
- last transition: `2026-04-09`
- next Codex action: `open the Cursor null-bundle / DB-open follow-up from W3-VALIDATE-01, then rerun live validation`
- latest review: `2026-04-09-W3-ADAPTER-09-codex`

## Notes

- this is the next functional priority from `W3-VALIDATE-01`
- the lane is narrower than `W3-ADAPTER-08`; it targets the live duplicate-ID
  failure class first and only widens into a structural split if that is
  required to land a safe fix
- the worker handoff claims the live Claude rerun is now clean:
  - `919` refs discovered
  - `919` unique loaded conversation IDs
  - `0` duplicate loaded conversation IDs
  - `0` write errors in the disposable-store validation rerun
- detached review confirmed the worker evidence:
  - `13/13` focused Claude adapter tests passed
  - duplicate-ID probe stayed at `0`
  - cross-conversation and within-bundle message-ID collisions stayed at `0`
- detached Claude CLI verification did not run to first turn because Claude could
  not open its own transcript file under `~/.claude/projects`; this was treated
  as verifier-environment noise, not as a packet blocker
- current live symptoms from the validation audit:
  - `6` duplicate loaded conversation IDs
  - `29` `UNIQUE constraint failed: messages.id` write failures
