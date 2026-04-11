# Packet State

- packet: `W3-SINK-05`
- title: `Sink Coverage Stats And Delivery Visibility`
- status: `queued`
- assigned agent: `unassigned`
- branch: `feat/rewrite-ontology`
- worktree/container: `canonical repo workspace` / `local`
- depends on: `W2-SINK-02`, `W3-SINK-04`
- unblocks: `faster operator diagnosis`, `clear per-sink delivery visibility`, `more honest local status output`
- last transition: `2026-04-09`
- next Codex action: `keep this behind the Claude Code, Cursor, and sink-correctness follow-ups; treat it as a low-priority observability lane once correctness is stable`
- latest review: `none`

## Notes

- target value is a local/operator-facing stat like:
  - `sink X: 75 / 85 routed conversations synced`
  - `sink X: 10 pending`
  - `sink X: 0 failed` or representative paused/error state
- likely data sources are existing route matching plus `_jin_sync` and
  `_jin_push_state`; this should not require a new sink contract
- this is intentionally P3-style visibility work, not a functional blocker
