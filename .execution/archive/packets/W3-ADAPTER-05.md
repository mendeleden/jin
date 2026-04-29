# Packet State

- packet: `W3-ADAPTER-05`
- title: `Adapter Memory Contract Audit and Blueprint Hardening`
- status: `approved`
- assigned agent: `codex-WORKER-adapter-memory-contract-audit`
- branch: `feat/rewrite-ontology`
- worktree/container: `canonical repo workspace` / `local`
- depends on: `W3-PERF-01`, `W3-RECOVERY-01`
- unblocks: `cross-adapter confidence after the Codex RSS regression`, `explicit BP-02/BP-04 memory-contract guidance`
- last transition: `2026-04-08`
- next Codex action: `dispatch the narrow Claude Code memory-contract follow-on packet`
- latest review: `2026-04-07-W3-ADAPTER-05-codex`

## Notes

- `W3-PERF-01` fixed a concrete Codex memory bug, but the broader question was
  whether other adapters violate the intended discover/load memory split
- review approved the audit and blueprint hardening lane on
  `2026-04-07-W3-ADAPTER-05-codex`
- the explicit follow-on from this packet is `W3-ADAPTER-06`, which should
  harden Claude Code so discovery no longer retains full bundles across
  changed files
