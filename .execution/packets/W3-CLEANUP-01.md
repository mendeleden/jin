# Packet State

- packet: `W3-CLEANUP-01`
- title: `Remove UI Surface And Remaining V1 Bridges`
- status: `approved`
- assigned agent: `codex-REVIEWER-v1-surface-cleanup`
- branch: `feat/rewrite-ontology`
- worktree/container: `canonical repo workspace` / `local`
- depends on: `W3-PRODUCT-01`, `W3-RUNTIME-01`
- unblocks: `userId modeling`, `cleaner CLI/runtime surface`, `removal of TUI + LegacyStore compatibility bridges`
- last transition: `2026-04-09`
- next Codex action: `use the approved cleanup baseline to unblock workspace-member / userId follow-up work without reviving the removed UI or v1 bridge surfaces`
- latest review: `2026-04-09-W3-CLEANUP-01-codex`

## Notes

- this packet supersedes the narrower `W3-UI-01` queue entry for actual
  execution because the requested cleanup crosses into onboarding/store
  compatibility bridges
- the detached worker handoff is now in `.execution/agents/codex-WORKER-v1-surface-cleanup.md`
  and `.execution/logs/codex-WORKER-v1-surface-cleanup-last.txt`
- approval is recorded in `.execution/reviews/2026-04-09-W3-CLEANUP-01-codex.md`
- the packet intentionally stops short of the full Team identity / `userId`
  design; it only clears the blocking legacy surfaces first
