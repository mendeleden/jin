# Packet State

- packet: `W0-CODEX-01`
- title: `Contract Freeze`
- status: `approved`
- assigned agent: `codex-contract-freeze-01`
- branch: `feat/rewrite-ontology`
- worktree/container: `canonical repo workspace`
- depends on: `reviewed BP set`
- unblocks: `all Wave 1 packets`
- last transition: `2026-04-01`
- next Codex action: `dispatch the first Wave 1 lanes against the frozen contracts`
- latest review: `2026-04-01-W0-CODEX-01-cursor`

## Notes

- first Codex run created `docs/execution/04-frozen-contract-surface.md`
- first Codex run added `src/contracts/**`
- first Codex run updated several Wave 1 packets to consume frozen contracts
- Cursor review is sufficient and internally consistent after one explicit Codex resolution:
  `test/contract-freeze.test.ts` is accepted as a narrow verification artifact
  for the freeze even though the packet's owned-file list did not literally
  enumerate `test/`
- direct verification repeated at approval time:
  - `bun test test/contract-freeze.test.ts`
  - `bun run typecheck`
- `W0-CODEX-02` remains a separate packet and was not included in this approval
