# Packet State

- packet: `W3-ADAPTER-08`
- title: `Claude Code Internal Decomposition And Sibling Adapter Audit`
- status: `queued`
- assigned agent: `unassigned`
- branch: `feat/rewrite-ontology`
- worktree/container: `canonical repo workspace` / `local`
- depends on: `W3-ADAPTER-07`, `W3-VALIDATE-01`
- unblocks: `safer Claude follow-up work`, `smaller adapter review surfaces`, `clear Codex decision on codex/cursor structural follow-ups`
- last transition: `2026-04-08`
- next Codex action: `dispatch only if the Claude Code functional follow-up needs a structural split to stay safe and reviewable; otherwise keep this maintainability lane behind the Claude/Cursor validation fixes`
- latest review: `none`

## Notes

- `src/adapters/claude-code.ts` is currently `1466` LoC and still carries too
  many concerns in one file
- the same structural pressure exists in:
  - `src/adapters/codex.ts` (`1344` LoC)
  - `src/adapters/cursor.ts` (`1310` LoC)
- this packet keeps execution Claude-local and treats `codex` / `cursor` as
  read-only sibling audit surfaces so the lane does not widen prematurely
- this is a maintainability packet, not the next functional priority
- current operator order is:
  - Claude Code full fix + revalidation
  - Cursor follow-up + revalidation
  - sink reconciliation
  - workspace-member / userId modeling
