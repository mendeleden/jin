# Packet State

- packet: `W3-PERF-02`
- title: `Full Runtime RSS / Shutdown Flush Budget`
- status: `approved`
- assigned agent: `codex-WORKER-full-runtime-rss-shutdown-flush`
- branch: `feat/rewrite-ontology`
- worktree/container: `canonical repo workspace` / `local`
- depends on: `W3-PERF-01`, `W3-ADAPTER-06`, `W3-BIN-01`
- unblocks: `stable local 0.8.3 daemon/service`, `meaningful remote Postgres validation`, `dogfood confidence`
- last transition: `2026-04-08`
- next Codex action: `keep the runtime RSS fix landed and let the sink lane own the remaining remote push failure`
- latest review: `2026-04-08-W3-PERF-02-codex.md`

## Notes

- `W3-PERF-01` fixed the packet-local Codex ingest harness, but the real daemon
  still dies on the local workload with:
  - `RSS 260 MB exceeded the 256 MB hard limit during ingest batch for adapter codex (149/186)`
  - `RSS 290 MB exceeded the 256 MB hard limit during pipeline work item ingest-adapter`
  - `RSS 290 MB exceeded the 256 MB hard limit during pipeline work item shutdown-flush`
- disabling the dead local Postgres sink did not change the failure; the daemon
  still dies with only the Railway sink enabled
- Railway schema is initialized at `v2.3`, but `jin_conversations` and
  `jin_messages` remain empty because the runtime dies before successful push
