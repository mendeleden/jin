# Packet State

- packet: `W3-SCALE-01`
- title: `Deterministic 1x / 10x / 100x Scale Datasets`
- status: `approved`
- assigned agent: `codex-WORKER-scale-datasets`
- branch: `feat/rewrite-ontology`
- worktree/container: `canonical repo workspace` / `local`
- depends on: `W3-ADAPTER-05`, `W3-ADAPTER-06`
- unblocks: `repeatable scale testing`, `adapter/perf regression reproduction`, `W3-PERF-03`
- last transition: `2026-04-08`
- next Codex action: `keep the dataset surface stable and let W3-PERF-03 consume it as the canonical scale-fixture contract`
- latest review: `2026-04-08-W3-SCALE-01-codex.md`

## Notes

- current perf validation depends too much on live local tool directories
- we need generated datasets that preserve compaction/spawn structure and can be
  reproduced at multiple scales on demand
- the deliverable is generator + manifest + usage, not committed giant fixture
  blobs
