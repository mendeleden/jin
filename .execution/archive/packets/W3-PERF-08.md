# Packet State

- packet: `W3-PERF-08`
- title: `Long-Running Coordinator Soak`
- status: `completed`
- assigned agent: `local-soak-runner`
- branch: `feat/post-ontology-rewrite-fixes`
- worktree/container: `canonical repo workspace` / `local`
- depends on: `W3-PERF-04`, `W3-PERF-06`, `W3-PERF-07`
- unblocks: `honest decision on long-lived parent RSS viability for workerized ingest`
- last transition: `2026-04-14`
- next action: `use the completed soak as evidence in W3-PERF-09 proposal review`
- latest review: `none`

## Notes

- `W3-PERF-07` already proved targeted child-exit amortization on the known
  cliff refs
- this lane produced the overnight evidence it was supposed to produce
- the parent stayed bounded enough for the current proposal discussion, but it
  does not answer the separate question of whether heavy non-startup hints
  should also use workers
