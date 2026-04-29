# Packet State

- packet: `W3-ADAPTER-06`
- title: `Claude Code Discover/Load Memory Hardening`
- status: `approved`
- assigned agent: `codex-WORKER-claude-code-memory-hardening`
- branch: `feat/rewrite-ontology`
- worktree/container: `canonical repo workspace` / `local`
- depends on: `W3-ADAPTER-05`, `W3-PERF-01`
- unblocks: `BP-02/BP-04 alignment on adapter memory contract`, `cross-adapter confidence after the Codex RSS regression`
- last transition: `2026-04-08`
- next Codex action: `none`
- latest review: `2026-04-08-W3-ADAPTER-06-codex`

## Notes

- `W3-ADAPTER-05` review approved the adapter memory audit and identified
  `claude-code` as the one remaining adapter-side retained-bundle hazard
- this lane should keep the fix narrow: discovery must stop retaining full
  bundles across changed files, while `loadConversation()` still returns the
  same deterministic bundle shape
- the lane should add representative packet-local validation rather than widen
  runtime/store/sink scope
