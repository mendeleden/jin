# Packet State

- packet: `W3-ADAPTER-07`
- title: `Claude Code Path Precedence and Live Runtime Hardening`
- status: `approved`
- assigned agent: `codex-WORKER-claude-code-live-hardening`
- branch: `feat/rewrite-ontology`
- worktree/container: `canonical repo workspace` / `local`
- depends on: `W3-ADAPTER-06`, `W3-PERF-02`
- unblocks: `correct default Claude Code ingestion on macOS/Linux`, `platform path-precedence coverage`, `stable live Claude Code runtime behavior`
- last transition: `2026-04-08`
- next Codex action: `keep the adapter-local fixes landed and treat the remaining 812 MB full-bundle pressure as a separate contract/runtime follow-up`
- latest review: `2026-04-08-W3-ADAPTER-07-codex.md`

## Notes

- live validation showed `claude-code` was enabled but not detected because
  `~/.config/claude/projects` existed and shadowed the real populated
  `~/.claude/projects`
- that bug also exists on `main`
- after correcting `dataDir` locally, the daemon detected `claude-code` but the
  adapter then failed with repeated `Maximum call stack size exceeded` errors
  and roughly `5 GB` RSS before the temporary `500 MB` cap shut the runtime
  down
