# Packet State

- packet: `W3-BIN-01`
- title: `Rebuild and Local Binary Smoke`
- status: `completed`
- assigned agent: `codex-WORKER-local-binary-smoke`
- branch: `feat/rewrite-ontology`
- worktree/container: `canonical repo workspace` / `local`
- depends on: `W3-RUNTIME-01`, `W3-V2-01`
- unblocks: `current-binary local smoke confidence while perf review runs`
- last transition: `2026-04-08`
- next Codex action: `none`
- latest review: `none`

## Notes

- this is a bounded smoke lane, not a release approval lane
- the packet should rebuild the current repo binary, run a local smoke set, and
  write a durable audit artifact with exact commands and outcomes
- do not widen this into service-install debugging, perf tuning, or E2E repro
