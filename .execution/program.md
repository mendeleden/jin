# Program State

- phase: `release recovery`
- current date: `2026-05-10`
- current focus: `continue W4-DESKTOP-GA Windows Desktop parity on feat/desktop-add-windows after the auth/transport hardening slice; preserve W3 release recovery state`

## TL;DR

```mermaid
flowchart LR
  Cleanup02["W3-CLEANUP-02<br/>approved<br/>legacy CI cleanup landed"]
  Validate02["W3-VALIDATE-02<br/>in_progress<br/>release-gate hardening"]
  DesktopGA["W4-DESKTOP-GA<br/>in_progress<br/>Windows Desktop parity"]
  MainCI["main CI<br/>currently red"]
  Release["v0.8.12 retag/release"]

  Cleanup02 --> MainCI
  Cleanup02 --> Validate02
  Validate02 --> MainCI
  MainCI --> Release
  DesktopGA -. sidecar GA hardening .-> Release
```

## Packet State

- archived packet state: `.execution/archive/packets/`
- live packets:
  - `W3-CLEANUP-02` — `approved`
  - `W3-VALIDATE-02` — `in_progress`
  - `W3-SINK-04` — `needs_codex`
  - `W3-E2E-01` — `review_ready`
  - `W3-SERVICE-01` — `blocked`
  - `W3-PR-01` — `blocked`
  - `W4-DESKTOP-GA` - `in_progress`
- historical nonterminal packet files from the old Wave 3 rollout remain in
  `.execution/packets/` for now and should be normalized or archived in a
  second pass:
  - `W3-ADAPTER-08`
  - `W3-DOCS-01`
  - `W3-PERF-04`
  - `W3-PERF-07`
  - `W3-PERF-09`
  - `W3-PERF-10`
  - `W3-PERF-11`
  - `W3-SINK-05`
  - `W3-UI-01`

## Active Agents

- `codex-BRAIN`
- `codex-WORKER-release-gate-hardening`

Archived historical heartbeats live under:

- `.execution/archive/agents/`

## Next Dispatches

- drive `W3-VALIDATE-02` to review-ready from the cleaned baseline
- reconcile `W3-SINK-04` once release-path CI noise is gone
- continue `W4-DESKTOP-GA` after the landed auth/transport slice: Electron
  security, lifecycle reliability, diagnostics, packaging/update, and release
  validation remain
- retag/release only after `main` CI is green again

## Blockers

- `main` CI is red on stale legacy release/unit surfaces
- release `v0.8.12` must not be tagged until cleanup + validation hardening land
- `.execution/blueprints.md` still reflects pre-merge `W3-SINK-06` / `W3-TEAM-03`
  state and needs a separate reviewer-owned refresh
- `W4-DESKTOP-GA` blocks Desktop beta/GA until remaining Electron security,
  lifecycle reliability, diagnostics, packaging/update, and release validation
  are complete

## Notes

- terminal packet-state files were archived to `.execution/archive/packets/`
- stale tmp diagrams were moved to `docs/execution/archive/tmp-diagram/`
- `docs/execution/tasks/` and `docs/execution/prompts/` were intentionally left
  in place for now because they are still referenced by historical audits and
  reviews; archive/migration of those docs should be a separate pass
- `feat/desktop-add-windows` contains the first W4 Windows parity slice:
  Desktop API auth, Windows strict loopback transport, endpoint persistence, and
  occupied-port diagnostics.
