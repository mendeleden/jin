# Packet State

- packet: `W0-CURSOR-01`
- title: `Drift Audit`
- status: `approved`
- assigned agent: `cursor-audit`
- branch: `n/a`
- worktree/container: `n/a`
- depends on: `W0-CODEX-01`
- unblocks: `approval of W0-CODEX-01 and Wave 1 dispatch`
- last transition: `2026-04-01`
- next Codex action: `reuse the audit lane for W0-CODEX-02 when the live control-plane bootstrap is ready for review`
- latest review: `2026-04-01-W0-CODEX-01-cursor`

## Notes

- first required audit completed against `W0-CODEX-01`
- Codex accepted one narrow boundary interpretation from that audit:
  `test/contract-freeze.test.ts` is treated as an allowed verification artifact
  for the Codex-owned contract-freeze packet
- a separate audit is still required before `W0-CODEX-02` can move beyond
  `review_ready`
