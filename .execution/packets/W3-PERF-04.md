# Packet State

- packet: `W3-PERF-04`
- title: `Claude Runtime RSS Budget On Live Dataset`
- status: `in_progress`
- assigned agent: `codex-WORKER-claude-runtime-rss-budget`
- branch: `feat/rewrite-ontology`
- worktree/container: `canonical repo workspace` / `local`
- depends on: `W3-PERF-02`, `W3-ADAPTER-07`, `W3-ADAPTER-09`, `W3-ADAPTER-10`
- unblocks: `stable local foreground/service runtime on the real multi-adapter workload`, `honest Cursor visibility in steady state`, `return to sink reconciliation from a stable runtime`
- last transition: `2026-04-09`
- next Codex action: `run a detached investigation/fix lane against the live Claude-first RSS failure and stop only if the evidence proves a frozen-contract gap`
- latest review: `none`

## Notes

- the current real blocker is no longer Cursor decode correctness; `W3-ADAPTER-10`
  is approved
- the original local `0.8.5` service run detected Cursor successfully but
  exited during Claude ingest with:
  - `RSS 422 MB exceeded the 256 MB hard limit during ingest batch for adapter claude-code (20/921)`
- `W3-ADAPTER-07` fixed Claude path selection and the live recursion/stack-overflow
  class, but its audit already recorded that full live Claude load still peaked
  around `812 MB`
- the benchmark harness now forwards adapter/store reclaim hooks honestly and
  fails phases when runtime logs hard-limit errors
- latest honest benchmark rerun on `2026-04-10`:
  - discovery / load / load-write / push all complete
  - runtime fails honestly with hard-limit logs after fully ingesting Claude and
    then loading `20/96` Cursor refs
  - shutdown-flush also fails honestly on the same RSS budget
  - summary verdict is `fail`, so this lane remains the only active blocker
