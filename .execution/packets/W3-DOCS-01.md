# Packet State

- packet: `W3-DOCS-01`
- title: `Experimental V2 Reset And Install Runbook`
- status: `in_progress`
- assigned agent: `codex-WORKER-experimental-reset-install-doc`
- branch: `feat/rewrite-ontology`
- worktree/container: `canonical repo workspace` / `local`
- depends on: `W3-TEAM-01`, `W3-STARTUP-01`
- unblocks: `operator guidance`, `dogfood onboarding`, `experimental v2 reset messaging`
- last transition: `2026-04-07`
- next Codex action: `dispatch the docs-only worker and commit the runbook when it lands`
- latest review: `none`

## Notes

- user direction: do not add a `jin reset-local` command yet
- the output should be one committed document we can reference later
- preferred content:
  - exact shell commands we can paste in chat
  - soft reset vs hard reset
  - fresh install path
  - team/postgres follow-up commands
