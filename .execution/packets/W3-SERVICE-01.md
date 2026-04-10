# Packet State

- packet: `W3-SERVICE-01`
- title: `Bump to 0.8.4 and Local Service Rollout`
- status: `in_progress`
- assigned agent: `codex-WORKER-local-service-rollout`
- branch: `w3-service-01-20260408`
- worktree/container: `/tmp/jin-w3-service-01` / `local`
- depends on: `W3-PERF-01`, `W3-V2-01`
- unblocks: `local 0.8.4 service-mode validation on a clean baseline`
- last transition: `2026-04-08`
- next Codex action: `execute the isolated version-bump, build, install, and service-mode smoke lane`
- latest review: `none`

## Notes

- this lane runs from an isolated worktree on the approved baseline so it does
  not pick up the in-progress `W3-ADAPTER-06` changes from the canonical
  workspace
- the lane should bump the product version to `0.8.4`, rebuild/install the
  binary, and bring the local launchd service up with bounded verification
- do not widen this into unrelated product fixes or merge work
