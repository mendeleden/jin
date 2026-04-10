# Packet State

- packet: `W1-ADAPTER-01`
- title: `Claude Code Reference Adapter`
- status: `approved`
- assigned agent: `codex-WORKER-claude-code-reference-adapter`
- branch: `feat/rewrite-ontology`
- worktree/container: `canonical repo workspace`
- depends on: `W0-CODEX-01`
- unblocks: `reference adapter validation`
- last transition: `2026-04-02`
- next Codex action: `carry the reference-adapter informational notes as follow-up only while the broader approved adapter wave is isolated for commit`
- latest review: `2026-04-02-W1-ADAPTER-01-cursor`

## Notes

- verified worker heartbeat exists at
  `.execution/agents/codex-WORKER-claude-code-reference-adapter.md`
- preferred session name: `codex-WORKER-claude-code-reference-adapter`
- verified branch/worktree are `feat/rewrite-ontology` in the canonical repo
  workspace
- verified actual diff: `src/adapters/claude-code.ts` and
  `test/claude-code-reference-adapter.test.ts`
- verified packet test run: `bun test test/claude-code-reference-adapter.test.ts`
- `2026-04-02-W1-ADAPTER-01-cursor` approves the packet with informational
  adapter-enrichment notes only
